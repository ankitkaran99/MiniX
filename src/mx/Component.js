class MiniX_Component {
	static registry = new Map();
	// Shared frozen empty array — used as a default for scopeFactories/instanceAPIs
	// to avoid allocating a fresh [] on every child component mount.
	static _EMPTY_ARRAY = Object.freeze([]);
	static layoutRegistry = new Map();

	static register(name, definition) {
		if (!name || typeof name !== 'string') throw new Error('MiniX_Component.register requires valid name');
		this.registry.set(name, definition);
		return definition;
	}

	static registerLayout(name, definition) {
		if (!name || typeof name !== 'string') throw new Error('MiniX_Component.registerLayout requires valid name');
		this.layoutRegistry.set(name, definition);
		return definition;
	}

	static resolve(name, localRegistry = {}) {
		return localRegistry?.[name] || this.registry.get(name) || null;
	}

	static resolveLayout(name) {
		return this.layoutRegistry.get(name) || null;
	}

	constructor(ComponentClass, options = {}) {
		if (typeof ComponentClass !== 'function') {
			throw new Error('MiniX_Component requires a component class');
		}
	
		this.ComponentClass = ComponentClass;
		this.options = {
			props: {},
			parent: null,
			root: null,
			provider: null,
			eventBus: null,
			renderer: null,
			sanitizer: null,
			compiler: null,
			scopeFactories: [],
			instanceAPIs: [],
			autoMountChildren: false,
			dev: false,
			...options
		};
	
		this.parent = this.options.parent || null;
		this.root = this.options.root || null;
		this.instance = new this.ComponentClass();
		this._propDefs = this._normalizePropsDefinition(
			this.ComponentClass.props ||
			this.ComponentClass.propTypes ||
			this.instance.propsDefinition ||
			this.instance.propTypes ||
			this.instance.props
		);
	
		const initialProps = this._resolveProps(this.options.props || {}, {}, { phase: 'initial' });
		this.propsState = new MiniX_State(initialProps);
		this._propsSource = this.propsState.raw();
	
		this.props = new Proxy(this._propsSource, {
			get: (target, key) => target[key],
			set: (target, key, value) => {
				if (this.options.dev) {
					console.warn(`[MiniX] Cannot mutate prop "${String(key)}" from child component.`);
				}
				return true;
			},
			deleteProperty: (target, key) => {
				if (this.options.dev) {
					console.warn(`[MiniX] Cannot delete prop "${String(key)}" from child component.`);
				}
				return true;
			}
		});
	
		this.children = [];
		this.isMounted = false;
		this.isDestroyed = false;
		this.plugins = [];
		this._effects = new Set();
		this._childRecords = new Map();
		this._compilerCleanup = null;
		this._activeLayoutInst = null;
	
		this._initialTemplate = null;
		this._initialTemplateCaptured = false;
		this._rerenderQueued = false;
		this._lastRerenderMeta = null;
		this._baseScopeCache = null;
		this._staticScopeCache = null;
		this._staticScopeDirty = true;
	
		this.eventBus = this.options.eventBus || new MiniX_Event_Bus();
		this.sanitizer = this.options.sanitizer || new MiniX_Sanitizer();
		this.renderer = this.options.renderer || new MiniX_Renderer({ sanitizer: this.sanitizer });
		this.compiler = this.options.compiler || new MiniX_Compiler();
	
		this.renderer.modifiers = this.compiler.modifiers;
		this.provider = this.options.provider
			? this.options.provider.createChild()
			: new MiniX_Provider(this.parent?.provider || null);
		this._scopeFactories = Array.isArray(this.options.scopeFactories) ? [...this.options.scopeFactories] : [];
		this._instanceAPIFactories = Array.isArray(this.options.instanceAPIs) ? [...this.options.instanceAPIs] : [];
		this._localScopeFactories = [];
	
		this.listener = new MiniX_Listener({ component: this });
		
		let registeredComponents = {};

		if (typeof this.instance.registerComponents === 'function') {
			registeredComponents = this.instance.registerComponents() || {};
		} else if (this.instance.registerComponents && typeof this.instance.registerComponents === 'object') {
			registeredComponents = this.instance.registerComponents;
		}

		this.localComponents = { ...registeredComponents };
	
		this._bindCoreAPIs();
		this._setupState();
		this._setupMethods();
		this._setupComputed();
		this._setupWatchers();
		this._callHook('created');
	}

	_mergeScopeLayer(target, layer) {
		if (!layer || (typeof layer !== 'object' && typeof layer !== 'function')) return target;
		const descriptors = Object.getOwnPropertyDescriptors(layer);
		delete descriptors.__proto__;
		delete descriptors.constructor;
		delete descriptors.prototype;
		Object.defineProperties(target, descriptors);
		return target;
	}

	_applyScopeFactories(scope, el = null) {
		
		
		const applyOne = (factory) => {
			if (!factory) return;
			let layer = null;
			try {
				layer = typeof factory === 'function' ? factory(this, el) : factory;
			} catch (error) {
				if (this.options.dev) console.warn('[MiniX] Scope factory failed.', error);
				return;
			}
			this._mergeScopeLayer(scope, layer);
		};
		if (Array.isArray(this._scopeFactories)) {
			for (let i = 0; i < this._scopeFactories.length; i++) applyOne(this._scopeFactories[i]);
		}
		if (Array.isArray(this._localScopeFactories)) {
			for (let i = 0; i < this._localScopeFactories.length; i++) applyOne(this._localScopeFactories[i]);
		}
		return scope;
	}

	addScope(factory) {
		if (!factory) return this.instance;
		this._localScopeFactories.push(factory);
		this._baseScopeCache = null;
		this._staticScopeDirty = true;
		if (typeof MiniX_Compiler !== 'undefined') MiniX_Compiler._scopeGen = (MiniX_Compiler._scopeGen || 0) + 1;
		return this.instance;
	}

	










	addInstanceAPI(factory) {
		if (typeof factory !== 'function') return this.instance;
		if (!Array.isArray(this._instanceAPIFactories)) this._instanceAPIFactories = [];
		this._instanceAPIFactories.push(factory);
		try {
			const apis = factory(this, this.instance);
			if (apis && typeof apis === 'object') {
				Object.assign(this.instance, apis);
				this._baseScopeCache = null;
				this._staticScopeDirty = true;
			}
		} catch (err) {
			if (this.options.dev) console.warn('[MiniX] instanceAPI factory failed.', err);
		}
		return this.instance;
	}

	// Build and cache the parts of the base scope that do NOT depend on the state
	// shape: methods, prototype chain, computed descriptors, props, $ APIs, and
	// instance descriptors. Stored in _staticScopeCache and only rebuilt when
	// addScope()/addInstanceAPI() sets _staticScopeDirty=true. A state-shape
	// change (markShapeDirty) sets only _baseScopeCache=null, so on the next
	// _getBaseScope() call we skip straight to re-layering the cheap state
	// descriptors onto the already-built static prototype.
	_buildStaticScope() {
		const staticScope = Object.create(null);
		const instance = this.instance;
		const propsProxy = this._propsSource;
		const stateProxy = this.state.raw();
		const stateRaw = stateProxy?.__raw || stateProxy;

		// Methods declared on instance.methods
		if (instance.methods) {
			for (const key of Object.keys(instance.methods)) {
				if (key in staticScope) continue;
				const fn = instance.methods[key];
				if (typeof fn === 'function') staticScope[key] = fn.bind(instance);
			}
		}

		// Prototype-chain methods (class-based components)
		{
			let proto = Object.getPrototypeOf(instance);
			const objectProto = Object.prototype;
			while (proto && proto !== objectProto) {
				for (const key of Object.getOwnPropertyNames(proto)) {
					if (key === 'constructor' || key in staticScope) continue;
					const val = instance[key];
					if (typeof val === 'function') staticScope[key] = val.bind(instance);
				}
				proto = Object.getPrototypeOf(proto);
			}
		}

		// Computed properties (getter descriptors forwarding to instance)
		if (instance.computed) {
			for (const key of Object.keys(instance.computed)) {
				if (key in staticScope) continue;
				Object.defineProperty(staticScope, key, {
					get: () => instance[key],
					enumerable: true,
					configurable: true
				});
			}
		}

		// Props
		for (const key of Object.keys(propsProxy || {})) {
			if (key in staticScope) continue;
			Object.defineProperty(staticScope, key, {
				get: () => propsProxy[key],
				enumerable: true,
				configurable: true
			});
		}

		// Well-known $ APIs and meta-properties
		Object.defineProperty(staticScope, '$props', { get: () => this.props, enumerable: true, configurable: true });
		Object.defineProperty(staticScope, '__minix_state_proxy__', { value: stateProxy, enumerable: false, configurable: true });
		Object.defineProperty(staticScope, '__minix_track_state_shape__', {
			value: () => this.state._trackTargetEffect(stateRaw, MiniX_State.ITERATE_KEY),
			enumerable: false,
			configurable: true
		});

		const stateApi = this._createStateAPI();
		staticScope.$state = stateApi;
		staticScope.$component = instance;
		staticScope.$set = (path, val) => stateApi.set(path, val);
		staticScope.$batch = (fn) => this.state.batch(fn);
		staticScope.$patch = (path, fn) => {
			const current = this.state.get(path);
			const next = typeof fn === 'function' ? fn(current) : fn;
			return stateApi.set(path, next);
		};
		staticScope.$merge = (path, obj) => {
			const current = this.state.get(path) || {};
			return stateApi.set(path, { ...current, ...obj });
		};
		staticScope.$toggle = (path) => stateApi.set(path, !this.state.get(path));
		staticScope.$emit = (name, payload = null, meta = {}) => {
			let hasExtra = false;
			if (meta) { for (const _ in meta) { hasExtra = true; break; } }
			const emitMeta = hasExtra
				? { component: this.ComponentClass?.name || 'AnonymousComponent', componentInstance: instance, ...meta }
				: { component: this.ComponentClass?.name || 'AnonymousComponent', componentInstance: instance };
			return this.eventBus.emit(name, payload, emitMeta);
		};

		Object.defineProperty(staticScope, '$refs', { get: () => instance.$refs, enumerable: true, configurable: true });

		// Instance own-property descriptors (getters and non-function values)
		try {
			const instanceDescriptors = Object.getOwnPropertyDescriptors(instance || {});
			for (const key of Reflect.ownKeys(instanceDescriptors)) {
				if (typeof key !== 'string' || key in staticScope) continue;
				const desc = instanceDescriptors[key];
				if (typeof desc.get === 'function') {
					Object.defineProperty(staticScope, key, { get: () => instance[key], enumerable: true, configurable: true });
				} else if ('value' in desc && typeof desc.value !== 'function') {
					Object.defineProperty(staticScope, key, {
						get: () => instance[key],
						set: (v) => { instance[key] = v; },
						enumerable: true,
						configurable: true
					});
				}
			}
		} catch (_) {}

		// $ lifecycle / utility keys
		const dollarKeys = [
			'$parent', '$root', '$children', '$el', '$bus', '$provider',
			'$provide', '$inject', '$nextTick', '$listen', '$timeout', '$interval',
			'$computed', '$watch', '$effect', '$mountChild', '$destroy', '$refresh',
			'$setProps', '$fetch', '$get', '$snapshot', '$addScope', '$addInstanceAPI',
			'$layout', '$view'
		];
		if (this.options.dev) dollarKeys.push('$history', '$clearHistory');
		for (let i = 0; i < dollarKeys.length; i++) {
			const key = dollarKeys[i];
			if (key in staticScope) continue;
			const val = instance[key];
			if (val !== undefined) staticScope[key] = typeof val === 'function' ? val.bind(instance) : val;
		}

		return staticScope;
	}

	_getBaseScope() {
		if (this._baseScopeCache) return this._baseScopeCache;

		// Rebuild the static layer only when methods/APIs/instance changed.
		// A pure state-shape change leaves _staticScopeDirty false, so we reuse it.
		if (!this._staticScopeCache || this._staticScopeDirty) {
			this._staticScopeCache = this._buildStaticScope();
			this._staticScopeDirty = false;
		}

		// Layer the state-shape-sensitive descriptors on top via prototype inheritance
		// so re-builds are cheap: only enumerate stateRaw own keys.
		const stateProxy = this.state.raw();
		const stateRaw = stateProxy?.__raw || stateProxy;
		const scope = Object.create(this._staticScopeCache);

		for (const key in stateRaw) {
			if (!Object.hasOwn(stateRaw, key)) continue;
			// State keys shadow same-named entries from the static layer.
			Object.defineProperty(scope, key, {
				get: () => stateProxy[key],
				set: (v) => { stateProxy[key] = v; },
				enumerable: true,
				configurable: true
			});
		}

		this._baseScopeCache = scope;
		return scope;
	}

	_createStateAPI() {
		const topLevelPathKey = (path) => {
			const raw = String(path || '');
			const dot = raw.indexOf('.');
			const bracket = raw.indexOf('[');
			const end = dot === -1 ? (bracket === -1 ? raw.length : bracket) : (bracket === -1 ? dot : Math.min(dot, bracket));
			return raw.slice(0, end);
		};
		const markShapeDirty = () => {
			this._baseScopeCache = null;
			if (typeof MiniX_Compiler !== 'undefined') MiniX_Compiler._scopeGen = (MiniX_Compiler._scopeGen || 0) + 1;
		};
		const setAndRefreshShape = (path, val) => {
			const root = topLevelPathKey(path);
			const hadRoot = root ? this.state.has(root) : true;
			const result = this.state.set(path, val);
			if (root && !hadRoot && this.state.has(root)) markShapeDirty();
			return result;
		};
		return {
			get: (path) => this.state.get(path),
			set: setAndRefreshShape,
			batch: (fn) => this.state.batch(fn),
			increment: (path, amount = 1) => {
				const current = Number(this.state.get(path, 0));
				return setAndRefreshShape(path, current + amount);
			},

			push: (path, val) => {
				const arr = this.state.get(path);
				if (Array.isArray(arr)) {
					arr.push(val);
				} else {
					setAndRefreshShape(path, [val]);
				}
			},

			pop: (path) => {
				const arr = this.state.get(path);
				if (Array.isArray(arr) && arr.length) {
					arr.pop();
				}
			},

			map: (path, fn) => {
				const arr = this.state.get(path) || [];
				setAndRefreshShape(path, arr.map(fn));
			},

			filter: (path, fn) => {
				const arr = this.state.get(path) || [];
				setAndRefreshShape(path, arr.filter(fn));
			}
		};
	}

	_createRenderScope(extra = null, el = null) {
		const base = this._getBaseScope();
		let scope = base;

		const hasScopeFactories = (this._scopeFactories && this._scopeFactories.length) || (this._localScopeFactories && this._localScopeFactories.length);
		if (hasScopeFactories) {
			scope = Object.create(base);
			this._applyScopeFactories(scope, el);
		}

		let hasExtra = false;
		if (extra !== null && extra !== undefined) {
			for (const _ in extra) { hasExtra = true; break; }
		}
		if (hasExtra) {
			if (scope === base) scope = Object.create(base);
			this._mergeScopeLayer(scope, extra);
		}

		return scope;
	}

	_bindCoreAPIs() {
		const target = this.instance;
		const stateApi = this._createStateAPI();
		target.$component = this;
		target.$refs = {};
		target.$parent = this.parent?.instance || null;
		target.$root = this.parent ? this.parent.instance?.$root || this.parent.instance : target;
		target.$children = this.children;
	
		Object.defineProperty(target, 'props', {
			get: () => this.props,
			enumerable: true,
			configurable: true
		});
	
		Object.defineProperty(target, '$props', {
			get: () => this.props,
			enumerable: true,
			configurable: true
		});
	
		target.$el = this.root;
		target.$bus = this.eventBus;
		target.$provider = this.provider;
		target.$addScope = (factory) => this.addScope(factory);
		target.$addInstanceAPI = (factory) => this.addInstanceAPI(factory);
		target.$provide = (key, value) => this.provider.provide(key, value);
		target.$inject = (key, fallback) => this.provider.inject(key, fallback);
		target.$nextTick = (callback) => Promise.resolve().then(() => callback.call(target));
		target.$listen = (...args) => this.listener.$listen(...args);
		target.$timeout = (...args) => this.listener.$timeout(...args);
		target.$interval = (...args) => this.listener.$interval(...args);
		target.$computed = (name, getter) => this.listener.$computed(name, getter, target);
	
		target.$watch = (source, callback) => {
			if (typeof source === 'function') {
				let oldValue;
				let effect = null;

				const runGetter = () => source.call(target);

				effect = new MiniX_Effect(runGetter, {
					lazy: true,
					scheduler: () => {
						const newValue = effect.run();
						if (!Object.is(newValue, oldValue)) {
							const prev = oldValue;
							oldValue = newValue;
							callback.call(target, newValue, prev);
						}
					}
				});

				oldValue = effect.run();
				this._effects.add(effect);

				return () => {
					effect.stop();
					this._effects.delete(effect);
				};
			}
	
			return this.listener.$watch(
				this.state,
				source,
				(newVal, oldVal) => callback.call(target, newVal, oldVal)
			);
		};
	
		target.$effect = (fn, options = {}) => {
			const effect = new MiniX_Effect(() => fn.call(target), options);
			this._effects.add(effect);
			return () => {
				effect.stop();
				this._effects.delete(effect);
			};
		};
	
		target.$emit = (name, payload = null, meta = {}) => {
			let hasExtra = false;
			if (meta) { for (const _ in meta) { hasExtra = true; break; } }
			const emitMeta = hasExtra
				? { component: this.ComponentClass.name || 'AnonymousComponent', componentInstance: this.instance, ...meta }
				: { component: this.ComponentClass.name || 'AnonymousComponent', componentInstance: this.instance };
			return this.eventBus.emit(name, payload, emitMeta);
		};
	
		target.$mountChild = (name, element, props = {}, meta = {}) =>
			this.mountChild(name, element, props, meta);
	
		target.$destroy = () => this.destroy();
		target.$refresh = (meta = {}) => this.rerender({ reason: 'manual-refresh', ...meta });
		target.$setProps = (props = {}, options = {}) => this.updateProps(props, options);

		/**
		 * Dynamically swap the layout at runtime.
		 * Pass a string, function, or layout class. Pass null/false to remove the layout.
		 *   this.$layout(AppShell)
		 *   this.$layout('<div class="auth">…</div>')
		 *   this.$layout(null)   // strip layout
		 */
		target.$layout = (newLayout) => {
			this.instance.layout = newLayout;
			return this.rerender({ reason: 'layout-change' });
		};

		/**
		 * Dynamically swap the view template at runtime.
		 *   this.$view('<h2>New content</h2>')
		 */
		target.$view = (newView) => {
			this.instance.view = newView;
			return this.rerender({ reason: 'view-change' });
		};
	
		// Resolve the request instance once and share it between $request and $fetch
		// so both always use the same provider-injected (or global default) instance.
		const _resolvedRequest = this.provider.inject('__minix_request__', MiniX_Request.default());
		target.$request = _resolvedRequest;

		target.$fetch = (url, options = {}) => {
			const request = _resolvedRequest;

			const method = String(options?.method || 'GET').toUpperCase();
			const requestOptions = { ...options };

			delete requestOptions.method;

			if (method === 'GET') return request.get(url, requestOptions);
			if (method === 'DELETE') return request.delete(url, requestOptions);
			if (method === 'HEAD') return request.head(url, requestOptions);
			if (method === 'OPTIONS') return request.options(url, requestOptions);

			const body = requestOptions.body;
			delete requestOptions.body;

			if (method === 'POST') return request.post(url, body, requestOptions);
			if (method === 'PUT') return request.put(url, body, requestOptions);
			if (method === 'PATCH') return request.patch(url, body, requestOptions);

			return request._builder(method, url, body, requestOptions);
		};

		target.$state = stateApi;
		target.$get = (path, fallback) => this.state.get(path, fallback);
		target.$set = (path, val) => stateApi.set(path, val);
		target.$patch = (path, fn) => {
			const current = this.state.get(path);
			const next = typeof fn === 'function' ? fn(current) : fn;
			return stateApi.set(path, next);
		};
		target.$merge = (path, obj) => {
			const current = this.state.get(path) || {};
			return stateApi.set(path, { ...current, ...obj });
		};
		target.$toggle = (path) => {
			const current = !!this.state.get(path);
			return stateApi.set(path, !current);
		};
		target.$batch = (fn) => this.state.batch(fn);
		target.$snapshot = () => this.state.snapshot();
	
		if (this.options.dev) {
			target.$history = () => this.state.getHistory();
			target.$clearHistory = () => this.state.clearHistory();
		}

		
		
		
		if (Array.isArray(this._instanceAPIFactories)) {
			for (const factory of this._instanceAPIFactories) {
				if (typeof factory !== 'function') continue;
				try {
					const apis = factory(this, target);
					if (apis && typeof apis === 'object') {
						Object.assign(target, apis);
					}
				} catch (err) {
					if (this.options.dev) console.warn('[MiniX] instanceAPI factory failed.', err);
				}
			}
		}
	}

	_setupState() {
		const dataFactory = typeof this.instance.data === 'function' ? this.instance.data.bind(this.instance) : null;
		const initialData = dataFactory ? (dataFactory(this.props) || {}) : {};
		const stateOptions = {};
		if (this.options.dev) {
			stateOptions.dev = true;
			stateOptions.label = this.ComponentClass?.name || 'AnonymousComponent';
		}
		this.state = new MiniX_State(initialData, stateOptions);
		const snapshot = this.state.raw();
		for (const key in snapshot) {
			if (!Object.hasOwn(snapshot, key)) continue;
			Object.defineProperty(this.instance, key, {
				// Use the reactive proxy (state.raw()[key]) so reads inside computed
				// effects and watchers register proper reactive dependencies.
				get: () => this.state.raw()[key],
				set: (value) => this.state.set(key, value),
				configurable: true,
				enumerable: true
			});
		}

		
		
		
		
		
		const stateRef = this.state;
		const rawInstance = this.instance;
		const componentRef = this;
		this.instance = new Proxy(rawInstance, {
			get(target, prop, receiver) {
				
				
				if (prop in target) return Reflect.get(target, prop, receiver);
				
				// Access through the reactive proxy (stateRef.raw()) so that any active
				// effect (including computed getters) properly tracks the dependency.
				// stateRef.get(prop) bypasses the proxy and skips tracking entirely.
				if (typeof prop === 'string' && !prop.startsWith('__') && stateRef.raw() && prop in stateRef.raw()) {
					return stateRef.raw()[prop];
				}
				return Reflect.get(target, prop, receiver);
			},
			set(target, prop, value, receiver) {
				
				
				const desc = Object.getOwnPropertyDescriptor(target, prop);
				if (desc) return Reflect.set(target, prop, value, receiver);
				
				
				if (typeof prop === 'string' && !prop.startsWith('$') && !prop.startsWith('__')) {
					stateRef.set(prop, value);
					
					
					Object.defineProperty(target, prop, {
						get: () => stateRef.raw()[prop],
						set: (v) => stateRef.set(prop, v),
						configurable: true,
						enumerable: true
					});
					componentRef._baseScopeCache = null;
					if (typeof MiniX_Compiler !== 'undefined') MiniX_Compiler._scopeGen = (MiniX_Compiler._scopeGen || 0) + 1;
					return true;
				}
				return Reflect.set(target, prop, value, receiver);
			},
			has(target, prop) {
				if (prop in target) return true;
				if (typeof prop === 'string' && stateRef.raw() && prop in stateRef.raw()) return true;
				return false;
			}
		});

		if (!this.instance.$state || typeof this.instance.$state.set !== 'function' || typeof this.instance.$state.get !== 'function') {
			this.instance.$state = this.state;
		}
	}

	_setupMethods() {
		const methods = this.instance.methods || {};
		this._boundMethods = {};
		for (const key of Object.keys(methods)) {
			if (typeof methods[key] === 'function') {
				const fn = methods[key];
				const bound = (...args) => this.state.batch(() => fn.call(this.instance, ...args));
				Object.defineProperty(this.instance, key, {
					value: bound, writable: true, configurable: true, enumerable: true
				});
				this._boundMethods[key] = bound;
			}
		}
	}

	_setupComputed() {
		const computed = this.instance.computed || {};
		for (const key of Object.keys(computed)) {
			const getter = computed[key];
			if (typeof getter !== 'function') continue;
			this.listener.$computed(key, () => getter.call(this.instance, this.state.raw(), this.props), this.instance);
		}
	}

	_setupWatchers() {
		const watch = this.instance.watch || {};
		for (const path of Object.keys(watch)) {
			const handler = watch[path];
			if (typeof handler === 'function') {
				this.listener.$watch(this.state, path, (newVal, oldVal) => handler.call(this.instance, newVal, oldVal));
			}
		}
	}

	_createLifecyclePayload(phase, meta = {}) {
		return {
			phase,
			component: this.instance,
			componentClass: this.ComponentClass,
			root: this.root,
			props: this.props,
			parent: this.parent?.instance || null,
			children: this.children,
			mounted: this.isMounted,
			destroyed: this.isDestroyed,
			...meta
		};
	}

	_callHook(name, meta = {}) {
		const payload = this._createLifecyclePayload(name, meta);
		if (typeof this.instance[name] === 'function') return this.instance[name].call(this.instance, payload);
	}

	_resolvePropsExpression(node) {
		const expr = node.getAttribute('x-props');
		if (!expr) return {};
		try {
			return this.compiler._evaluate(expr, this._createRenderScope(), {}) || {};
		} catch (error) {
			console.warn(`[MiniX_Component] Failed to evaluate x-props="${expr}"`, error);
			return {};
		}
	}

	_resolveComponentName(rawName) {
		if (!rawName) return rawName;
		const scope = this._createRenderScope();
		if (this.localComponents?.[rawName] || MiniX_Component.resolve(rawName, this.localComponents)) return rawName;
		const evaluated = this.compiler._evaluate(rawName, scope, rawName);
		return typeof evaluated === 'string' ? evaluated : rawName;
	}

	_destroyChildren() {
		for (const record of this._childRecords.values()) record.component?.destroy?.();
		this._childRecords.clear();
		this.children = [];
		this.instance.$children = [];
	}

	_syncChildrenArray() {
		const components = [];
		const instances = [];
		for (const record of this._childRecords.values()) {
			components.push(record.component);
			instances.push(record.component?.instance);
		}
		this.children = components;
		this.instance.$children = instances;
	}

	_shallowEqual(a, b) { return _minix_shallowEqual(a, b); }

	_normalizePropsDefinition(definition) {
		if (!definition) return {};
		if (Array.isArray(definition)) {
			const acc = {};
			for (let i = 0; i < definition.length; i++) {
				const key = definition[i];
				if (typeof key === 'string' && key) acc[key] = {};
			}
			return acc;
		}
		if (typeof definition !== 'object') return {};

		const normalized = {};
		for (const key of Object.keys(definition)) {
			const raw = definition[key];
			if (raw == null) { normalized[key] = {}; continue; }
			if (typeof raw === 'function' || Array.isArray(raw) || typeof raw === 'string') {
				normalized[key] = { type: raw }; continue;
			}
			if (typeof raw === 'object') normalized[key] = { ...raw };
		}
		return normalized;
	}

	_hasPropDefault(def = {}) {
		return Object.hasOwn(def, 'default') ||
			Object.hasOwn(def, 'fallback');
	}

	_resolvePropDefault(key, def = {}, incoming = {}) {
		const hasDefault = Object.hasOwn(def, 'default');
		const value = hasDefault ? def.default : def.fallback;
		if (typeof value === 'function' && def.type !== Function) {
			return value.call(this.instance, incoming, key);
		}
		if (Array.isArray(value)) return value.slice();
		if (value && typeof value === 'object') return { ...value };
		return value;
	}

	_typeName(type) {
		if (typeof type === 'string') return type;
		return type?.name || String(type);
	}

	_matchesPropType(value, type) {
		if (type == null) return true;
		if (Array.isArray(type)) return type.some((entry) => this._matchesPropType(value, entry));
		if (typeof type === 'string') {
			const lower = type.toLowerCase();
			if (lower === 'array') return Array.isArray(value);
			if (lower === 'null') return value === null;
			if (lower === 'any') return true;
			return typeof value === lower;
		}
		if (type === String) return typeof value === 'string';
		if (type === Number) return typeof value === 'number' && !Number.isNaN(value);
		if (type === Boolean) return typeof value === 'boolean';
		if (type === Function) return typeof value === 'function';
		if (type === Array) return Array.isArray(value);
		if (type === Object) return value !== null && typeof value === 'object' && !Array.isArray(value);
		try { return value instanceof type; } catch (_) { return true; }
	}

	_validatePropValue(key, value, def = {}) {
		if (value === undefined || value === null) {
			return { valid: !def.required, reason: 'required' };
		}
		if (def.type && !this._matchesPropType(value, def.type)) {
			const expected = Array.isArray(def.type)
				? def.type.map((entry) => this._typeName(entry)).join(' | ')
				: this._typeName(def.type);
			return { valid: false, reason: `expected ${expected}` };
		}
		if (typeof def.validator === 'function') {
			let ok = false;
			try {
				ok = !!def.validator.call(this.instance, value, this.props || {}, key);
			} catch (error) {
				return { valid: false, reason: `validator threw: ${error?.message || error}` };
			}
			if (!ok) return { valid: false, reason: 'validator returned false' };
		}
		return { valid: true, reason: '' };
	}

	_resolveProps(inputProps = {}, previousProps = {}, options = {}) {
		const incoming = inputProps && typeof inputProps === 'object' ? inputProps : {};
		const resolved = { ...incoming };
		const definitions = this._propDefs || {};

		for (const key in definitions) {
			if (!Object.hasOwn(definitions, key)) continue;
			const def = definitions[key] || {};
			const hasIncoming = Object.hasOwn(incoming, key);
			if (!hasIncoming && this._hasPropDefault(def)) {
				resolved[key] = this._resolvePropDefault(key, def, incoming);
			}

			const value = resolved[key];
			const validation = this._validatePropValue(key, value, def);
			if (validation.valid) continue;

			let fallbackUsed = false;
			if (this._hasPropDefault(def)) {
				resolved[key] = this._resolvePropDefault(key, def, incoming);
				fallbackUsed = true;
			} else if (Object.hasOwn(previousProps || {}, key)) {
				resolved[key] = previousProps[key];
				fallbackUsed = true;
			}

			if (this.options.dev) {
				const componentName = this.ComponentClass?.name || 'AnonymousComponent';
				const suffix = fallbackUsed ? ' Using fallback value.' : '';
				console.warn(`[MiniX_Component] Invalid prop "${key}" on ${componentName}: ${validation.reason}.${suffix}`);
			}
		}

		return resolved;
	}

	_syncPropsToState(nextProps = {}) {
		if (!this.state || typeof this.state.raw !== 'function') return;
		const snapshot = this.state.raw();
		const raw = snapshot?.__raw || snapshot || {};
		const keys = Object.keys(nextProps || {});
		if (!keys.length) return;
		this.state.batch(() => {
			for (let i = 0; i < keys.length; i++) {
				const key = keys[i];
				if (Object.hasOwn(raw, key)) {
					this.state.set(key, nextProps[key]);
				}
			}
		});
	}

	_shouldRerenderForProps(previousProps = {}, nextProps = {}, options = {}) {
		if (options.forceRerender === true) return true;
		if (options.forceRerender === false) return false;
		if (options.soft === true) return false;

		if (typeof this.instance.shouldUpdateProps === 'function') {
			try {
				return !!this.instance.shouldUpdateProps.call(this.instance, previousProps, nextProps, options);
			} catch (error) {
				console.warn('[MiniX_Component] shouldUpdateProps failed:', error);
			}
		}

		return true;
	}

	_queueRerender(meta = {}) {
		if (this._rerenderQueued) {
			let hasExtra = false;
			if (meta) { for (const _ in meta) { hasExtra = true; break; } }
			if (hasExtra) this._lastRerenderMeta = { ...(this._lastRerenderMeta || {}), ...meta };
			return this;
		}

		this._rerenderQueued = true;
		this._lastRerenderMeta = meta || {};

		MiniX_State._scheduleMicrotask(() => {
			const queuedMeta = this._lastRerenderMeta || {};
			this._rerenderQueued = false;
			this._lastRerenderMeta = null;
			if ((!this.root && !this._inlineMount) || this.isDestroyed || !this.isMounted) return;
			this.rerender(queuedMeta);
		});

		return this;
	}

	_clearInlineFragment() {
		if (typeof this._compilerCleanup === 'function') {
			this._compilerCleanup();
			this._compilerCleanup = null;
		}

		this._destroyChildren();

		const start = this._inlineStart;
		const end = this._inlineEnd;

		if (!start || !end) {
			this._inlineNodes = [];
			return;
		}

		let cursor = start.nextSibling;
		while (cursor && cursor !== end) {
			const next = cursor.nextSibling;
			cursor.remove();
			cursor = next;
		}

		this._inlineNodes = [];
	}

	_renderInlineFragment() {
		if (!this._inlineStart || !this._inlineEnd) {
			throw new Error('MiniX_Component._renderInlineFragment() requires inline anchors');
		}

		const parent = this._inlineEnd.parentNode;
		if (!parent) {
			this._inlinePendingMount = true;
			return false;
		}

		this._clearInlineFragment();

		const layoutResult = this._resolveLayoutTemplate();
		const layoutHtml = layoutResult?.html ?? null;
		const layoutInst = layoutResult?.inst ?? null;
		// Fire layout activated/deactivated hooks — matches _render()'s behaviour.
		// Without this, inline-mounted components (loop rows, conditional branches,
		// dynamic x-component mounts) never trigger layout lifecycle hooks.
		this._syncActiveLayout(layoutInst, { reason: layoutHtml ? 'render' : 'layout-removed' });
		const viewHtml = this._resolveView();
		const template = layoutHtml ? this._injectLayout(layoutHtml, viewHtml, layoutInst) : viewHtml;
		const html = this.renderer.render(
			template,
			this._createRenderScope(),
			{ sanitizer: this.sanitizer, preserveMustaches: true }
		);

		const tpl = document.createElement('template');
		tpl.innerHTML = html;

		const fragment = tpl.content.cloneNode(true);
		const nodes = [];
		const textNodes = [];
		let _fc = fragment.firstChild;
		while (_fc) {
			nodes.push(_fc);
			if (_fc.nodeType === Node.TEXT_NODE && _fc.textContent.includes('{{')) textNodes.push(_fc);
			_fc = _fc.nextSibling;
		}
		let textEffectCleanup = null;

		if (textNodes.length) {
			for (const node of textNodes) {
				node.__minix_template__ = this.renderer._compileInterpolationTemplate(node.textContent);
			}

			textEffectCleanup = this.compiler._effect(this, () => {
				const scope = this._createRenderScope();
				for (const node of textNodes) {
					if (!node.__minix_template__) continue;
					node.textContent = this.renderer.interpolateCompiled(node.__minix_template__, scope);
				}
			});
		}

		const elementCleanups = [];
		for (const node of nodes) {
			if (node.nodeType !== Node.ELEMENT_NODE) continue;
			const cleanup = this.compiler.compile(node, this);
			if (typeof cleanup === 'function') elementCleanups.push(cleanup);
		}

		this._compilerCleanup = () => {
			textEffectCleanup?.();
			for (const cleanup of elementCleanups) cleanup?.();
		};

		const domFragment = document.createDocumentFragment();
		for (const node of nodes) domFragment.appendChild(node);
		parent.insertBefore(domFragment, this._inlineEnd);

		this._inlineNodes = nodes;
		this.root = this._inlineNodes.find((node) => node.nodeType === Node.ELEMENT_NODE) || null;
		this.instance.$el = this.root;
		this._inlinePendingMount = false;
		return true;
	}

	ensureInlineMounted() {
		if (!this._inlineMount || !this._inlineStart || !this._inlineEnd) return false;
		if (!this._inlineEnd.parentNode) return false;

		const wasMounted = !!this.isMounted;
		if (this._inlinePendingMount || !this._inlineNodes || this._inlineNodes.length === 0) {
			const rendered = this._renderInlineFragment();
			if (rendered && !wasMounted) {
				this.isMounted = true;
				this.isDestroyed = false;
				this._callHook('mounted', { reason: 'inline-mount' });
			}
			return !!rendered;
		}
		return true;
	}

	mountInline(startComment, endComment) {
		if (!startComment || !endComment) {
			throw new Error('MiniX_Component.mountInline() requires start and end comment nodes');
		}

		this._inlineMount = true;
		this._inlineStart = startComment;
		this._inlineEnd = endComment;
		this._inlineNodes = [];
		this._inlinePendingMount = true;
		this.isDestroyed = false;

		this._callHook('beforeMount', { reason: 'inline-mount' });
		this.ensureInlineMounted();

		return this;
	}

	getLiveNodes() {
		if (this._inlineMount) {
			const result = [this._inlineStart];
			const inlineNodes = this._inlineNodes;
			if (inlineNodes) for (const n of inlineNodes) result.push(n);
			result.push(this._inlineEnd);
			return result;
		}
		return this.root ? [this.root] : [];
	}

	/**
	 * Resolve the component's content template string.
	 * Reads `instance.view`, then falls back to the captured root innerHTML for root components.
	 */
	_resolveView() {
		if (typeof this.instance.view === 'function') {
			const result = this.instance.view(this.props);
			return result != null ? String(result) : '';
		}
		if (typeof this.instance.view === 'string') return this.instance.view;
		if (!this.parent) return this._initialTemplate || '';
		return '';
	}

	/**
	 * Resolve the layout wrapper string.
	 * `instance.layout` may be:
	 *   - a string  (raw HTML with <template x-yield> slot markers)
	 *   - a function that receives props and returns a string
	 *   - a component class with an instance `view` property
	 * Always returns { html: string, inst: object|null } or null (no layout).
	 *
	 * The layout class instance is cached on `_layoutInst` for the lifetime of the
	 * component so that partial methods are called on a stable object and the class
	 * is not re-instantiated on every render.
	 */
	_resolveLayoutTemplate() {
		const layout = this.instance.layout;
		if (!layout) {
			// Layout removed at runtime — clear any cached instance.
			this._layoutInst = null;
			this._layoutInstClass = null;
			return null;
		}
		// Plain string — no layout instance, partials are not supported.
		if (typeof layout === 'string') return { html: layout, inst: null };
		if (typeof layout === 'function') {
			// Re-use a cached result when the layout class/function hasn't changed.
			if (this._layoutInstClass === layout) {
				// _layoutInstClass matches — either a class instance or null (plain function).
				if (this._layoutIsPlainFn) {
					// Plain function: call it fresh each render (it may depend on props/state).
					const html = layout(this.props);
					return { html: html != null ? String(html) : '', inst: null };
				}
				// Class: return cached instance with fresh view string.
				const inst = this._layoutInst;
				if (typeof inst.view === 'function') return { html: String(inst.view(this.props) ?? ''), inst };
				if (typeof inst.view === 'string') return { html: inst.view, inst };
				return { html: '', inst };
			}

			// Detect class vs plain function without using exception-based control flow.
			// ES class constructors always have a non-writable 'prototype' descriptor;
			// plain arrow/regular functions have a writable one (or none at all).
			const isClass = Object.getOwnPropertyDescriptor(layout, 'prototype')?.writable === false;

			if (!isClass) {
				this._layoutInst = null;
				this._layoutInstClass = layout;
				this._layoutIsPlainFn = true;
				const html = layout(this.props);
				return { html: html != null ? String(html) : '', inst: null };
			}

			let inst;
			try {
				inst = new layout();
			} catch (e) {
				if (this.options.dev) console.warn('[MiniX] Layout constructor threw:', e);
				return { html: '', inst: null };
			}

			this._layoutInst = inst;
			this._layoutInstClass = layout;
			this._layoutIsPlainFn = false;

			if (typeof inst.view === 'function') return { html: String(inst.view(this.props) ?? ''), inst };
			if (typeof inst.view === 'string') return { html: inst.view, inst };
			return { html: '', inst };
		}
		return null;
	}

	_callLayoutHook(inst, name, meta = {}) {
		if (!inst || typeof inst[name] !== 'function') return;
		try {
			let hasExtra = false;
			if (meta) { for (const _ in meta) { hasExtra = true; break; } }
			const payload = hasExtra
				? { name, component: this.instance, props: this.props, root: this.root, ...meta }
				: { name, component: this.instance, props: this.props, root: this.root };
			return inst[name].call(inst, payload);
		} catch (error) {
			if (this.options.dev) console.warn(`[MiniX] layout hook "${name}" failed.`, error);
		}
	}

	_syncActiveLayout(nextInst, meta = {}) {
		const prevInst = this._activeLayoutInst;
		if (prevInst === nextInst) return;
		if (prevInst) this._callLayoutHook(prevInst, 'deactivated', meta);
		this._activeLayoutInst = nextInst || null;
		if (nextInst) this._callLayoutHook(nextInst, 'activated', meta);
	}

	// Pre-compiled helpers used by _extractSections — defined once to avoid per-call regex construction.
	static _TEMPLATE_CHAR_AFTER_RE = /[\s>]/;

	/**
	 * Extract named <template x-section="name">…</template> blocks from an HTML string,
	 * returning { sections: { name: html }, remainder: html }.
	 *
	 * Uses a character-level balanced-tag parser so that nested <template> tags
	 * inside a section (e.g. x-if, x-for) are handled correctly.
	 *
	 * Limitations (shared with all string-based HTML parsers):
	 *   - Attribute values containing a literal `>` will cause tagEnd to be misidentified.
	 *     This is an inherent constraint of parsing HTML as a string without a DOM.
	 */
	_extractSections(html) {
		const sections = {};
		// Use an array instead of string concatenation to avoid O(n²) allocations.
		const remainderParts = [];
		let i = 0;
		const len = html.length;
		const isTemplateChar = MiniX_Component._TEMPLATE_CHAR_AFTER_RE;

		while (i < len) {
			// Fast-scan for next '<'
			const tagStart = html.indexOf('<', i);
			if (tagStart === -1) { remainderParts.push(html.slice(i)); break; }

			// Check for <template (must be followed by whitespace or '>' to exclude <templates> etc.)
			// and for </template (same boundary guard, and '/' makes it unambiguous as a close tag).
			const c10 = html.slice(tagStart, tagStart + 10).toLowerCase();
			const c9  = c10.slice(0, 9);
			const charAfter9  = html[tagStart + 9]  ?? '>';
			const charAfter10 = html[tagStart + 10] ?? '>';

			const isOpenTemplate  = c9  === '<template'  && isTemplateChar.test(charAfter9);
			const isCloseTemplate = c10 === '</template' && isTemplateChar.test(charAfter10);

			if (!isOpenTemplate && !isCloseTemplate) {
				remainderParts.push(html.slice(i, tagStart + 1)); i = tagStart + 1; continue;
			}

			// Stray </template> outside any section — emit as-is into remainder.
			if (isCloseTemplate) {
				const closeEnd = html.indexOf('>', tagStart);
				const end = closeEnd === -1 ? len : closeEnd + 1;
				remainderParts.push(html.slice(i, end)); i = end; continue;
			}

			// Find end of opening tag (known limitation: '>' inside an attribute value
			// will be misidentified as the tag end).
			const tagEnd = html.indexOf('>', tagStart);
			if (tagEnd === -1) { remainderParts.push(html.slice(i)); break; }
			const openTag = html.slice(tagStart, tagEnd + 1);

			// Check for x-section attribute
			const sectionMatch = openTag.match(/\bx-section=["']([^"']+)["']/i);
			if (!sectionMatch) { remainderParts.push(html.slice(i, tagEnd + 1)); i = tagEnd + 1; continue; }

			const sectionName = sectionMatch[1];

			// Walk forward with a depth counter to find the balanced closing </template>.
			let depth = 1;
			let j = tagEnd + 1;
			let matched = false;
			while (j < len && depth > 0) {
				const next = html.indexOf('<', j);
				if (next === -1) break;

				const nc10 = html.slice(next, next + 10).toLowerCase();
				const nc9  = nc10.slice(0, 9);
				const nAfter9  = html[next + 9]  ?? '>';
				const nAfter10 = html[next + 10] ?? '>';

				if (nc10 === '</template' && isTemplateChar.test(nAfter10)) {
					depth--;
					const closeEnd = html.indexOf('>', next);
					const end = closeEnd === -1 ? len : closeEnd + 1;
					if (depth === 0) {
						sections[sectionName] = html.slice(tagEnd + 1, next);
						i = end;
						matched = true;
						break;
					}
					j = end;
				} else if (nc9 === '<template' && isTemplateChar.test(nAfter9)) {
					depth++;
					const openEnd = html.indexOf('>', next);
					j = openEnd === -1 ? len : openEnd + 1;
				} else {
					j = next + 1;
				}
			}

			if (!matched) {
				// Unmatched opening tag — emit as literal text and resume after it.
				remainderParts.push(html.slice(i, tagEnd + 1));
				i = tagEnd + 1;
			}
		}

		return { sections, remainder: remainderParts.join('') };
	}

	/**
	 * Inject view sections into layout yield points.
	 *
	 * Default yield:   <template x-yield></template>          receives the default view
	 * Named yields:    <template x-yield="sidebar"></template>
	 * Named sections:  defined via instance.sections = { sidebar: '<p>...</p>' }
	 *                  or inline in the view via <template x-section="sidebar">...</template>
	 * Partials:        <template x-partial="header"></template>  calls layoutInst.header()
	 */
	_injectLayout(layoutHtml, viewHtml, layoutInst) {
		// Replace <template x-partial="name"></template> by calling the matching method
		// on the layout instance (e.g. header(), footer()). Resolved before yield injection
		// so that partials can sit alongside yield markers freely in the layout template.
		//
		// Regex: x-partial may appear anywhere in the opening tag. \b word-boundary anchors
		// prevent the greedy [^>]* from consuming the attribute name, and the partial name
		// is the only capture group needed.
		//
		// layoutInst is intentionally NOT fallen back to this.instance — partials only
		// resolve against the layout class instance; plain-string layouts have inst:null
		// and produce no output for x-partial markers.
		let result = layoutHtml.replace(
			/<template\b[^>]*\bx-partial=["']([^"']+)["'][^>]*><\/template>/gi,
			(match, name) => {
				if (layoutInst && typeof layoutInst[name] === 'function') {
					try {
						const out = layoutInst[name](this.props);
						return out != null ? String(out) : '';
					} catch (e) {
						console.warn(`[MiniX] x-partial="${name}" threw:`, e);
						return '';
					}
				}
				return '';
			}
		);

		// Extract named sections from the view HTML using a balanced-tag parser so that
		// nested <template> tags inside a section (x-if, x-for, etc.) are handled correctly.
		const { sections, remainder: defaultHtml } = this._extractSections(viewHtml);

		// Also merge any sections defined directly on the instance.
		// Inline <template x-section="..."> in the view takes priority; instance.sections
		// only fills in names that were not defined inline.
		const instanceSections = this.instance.sections;
		if (instanceSections && typeof instanceSections === 'object' && !Array.isArray(instanceSections)) {
			for (const name in instanceSections) {
				if (!Object.hasOwn(instanceSections, name)) continue;
				if (!Object.hasOwn(sections, name)) {
					sections[name] = instanceSections[name];
				}
			}
		}

		// Replace <template x-yield="name"> with named section content.
		// \b word-boundary anchors prevent the greedy [^>]* from consuming the attribute,
		// mirroring the fix applied to x-partial above.
		// Section values are coerced to string to guard against null/non-string entries.
		result = result.replace(
			/<template\b[^>]*\bx-yield=["']([^"']+)["'][^>]*><\/template>/gi,
			(_, name) => sections[name] != null ? String(sections[name]) : ''
		);

		// Replace default <template x-yield> (no name) with the remaining view HTML
		result = result.replace(
			/<template([^>]*)x-yield([^="'\w][^>]*)?\s*><\/template>/gi,
			() => defaultHtml
		);

		return result;
	}

	_render() {
		const viewHtml = this._resolveView();
		const layoutResult = this._resolveLayoutTemplate();

		// _resolveLayoutTemplate returns { html, inst } or null.
		const layoutHtml = layoutResult?.html ?? null;
		const layoutInst = layoutResult?.inst ?? null;
		this._syncActiveLayout(layoutInst, { reason: layoutHtml ? 'render' : 'layout-removed' });

		// Compose: if a layout exists, inject the view into its yield slots.
		// Otherwise render the view directly (legacy behaviour preserved).
		const finalHtml = layoutHtml ? this._injectLayout(layoutHtml, viewHtml, layoutInst) : viewHtml;

		if (typeof this._compilerCleanup === 'function') {
			this._compilerCleanup();
			this._compilerCleanup = null;
		}

		if (!this.root) return;

		const savedScopeProvider = this.root.__minix_scope_provider__;

		this._destroyChildren();
		delete this.root.__minix_interp_hoist__;

		const renderScope = this._createRenderScope();

		if (!layoutHtml && !this.parent && !this.instance.view) {
			// Root component with truly static initial/captured HTML — no renderer pass needed
			this.root.innerHTML = finalHtml;
		} else {
			this.root.innerHTML = this.renderer.render(
				finalHtml,
				renderScope,
				{ sanitizer: this.sanitizer, preserveMustaches: true }
			);
		}

		this._compilerCleanup = this.compiler.compile(this.root, this);

		if (savedScopeProvider) this.root.__minix_scope_provider__ = savedScopeProvider;
	}

	mount(target = null) {
		if (target) {
			this.root = typeof target === 'string' ? document.querySelector(target) : target;
			this.instance.$el = this.root;
		}

		if (!this.root) {
			throw new Error('MiniX_Component.mount() requires valid target');
		}

		if (!this.parent && !this._initialTemplateCaptured) {
			this._initialTemplate = this.root.innerHTML;
			this._initialTemplateCaptured = true;
		}

		this._callHook('beforeMount', { reason: 'mount' });
		this._render();
		this.isMounted = true;
		this.isDestroyed = false;
		this._callHook('mounted', { reason: 'mount' });
		return this;
	}

	update(meta = {}) {
		if ((!this.root && !this._inlineMount) || this.isDestroyed) return this;
		const payload = { reason: meta.reason || 'state', soft: true, ...meta };
		this._callHook('beforeUpdate', payload);
		this._callHook('updated', payload);
		return this;
	}

	rerender(meta = {}) {
		if ((!this.root && !this._inlineMount) || this.isDestroyed) return this;
		const payload = { reason: meta.reason || 'rerender', soft: false, ...meta };
		this._callHook('beforeUpdate', payload);
		if (this._inlineMount) {
			this._renderInlineFragment();
		} else {
			this._render();
		}
		this._callHook('updated', payload);
		return this;
	}

	updateProps(nextProps = {}, options = {}) {
		const previous = { ...(this._propsSource || {}) };
		const next = this._resolveProps(nextProps || {}, previous, { phase: 'update', ...options });
		const propsChanged = !this._shallowEqual(previous, next);

		if (propsChanged) {
			for (const key in previous) {
				if (!Object.hasOwn(previous, key)) continue;
				if (!Object.hasOwn(next, key)) {
					this.propsState.delete(key);
				}
			}

			for (const key in next) {
				if (!Object.hasOwn(next, key)) continue;
				this.propsState.set(key, next[key]);
			}
			this._syncPropsToState(next);
		}

		const liveNextProps = propsChanged ? { ...(this._propsSource || {}) } : previous;
		const shouldRerender = this._shouldRerenderForProps(previous, liveNextProps, options);
		if (!propsChanged && !shouldRerender) {
			return this;
		}

		this._baseScopeCache = null;
	
		if (!this.isMounted || this.isDestroyed) {
			return this;
		}

		const payload = {
			reason: 'props',
			previousProps: previous,
			nextProps: liveNextProps,
			...options
		};
	
		if (shouldRerender) {
			return options.immediate === true
				? this.rerender(payload)
				: this._queueRerender(payload);
		}

		return this.update(payload);
	}

	use(plugin) {
		if (!plugin) return this;
		const definition = typeof plugin.install === 'function' ? plugin : MiniX_Plugin.define(plugin);
		definition.install?.(this);
		this.plugins.push(definition);
		return this;
	}

	warn(message, ...args) {
		this.compiler?._warn?.(message, ...args);
		return this;
	}

	mountChild(name, element, props = {}, meta = {}) {
		if (!element) return null;

		const normalizedName = this._resolveComponentName(name);
		const Child = MiniX_Component.resolve(normalizedName, this.localComponents);
		if (!Child) {
			console.warn(`[MiniX_Component] Unknown child component: ${normalizedName}`);
			return null;
		}

		const existing = this._childRecords.get(element);
		if (existing && existing.name === normalizedName && !existing.component.isDestroyed) {
			existing.slots = meta.slots || existing.slots || {};
			if (existing.slots) element.__minix_slots__ = existing.slots;
			let hasSlots = false;
			if (existing.slots) { for (const _ in existing.slots) { hasSlots = true; break; } }
			existing.component.updateProps(props, {
				forceRerender: hasSlots,
				immediate: hasSlots,
				reason: hasSlots ? 'props+slots' : 'props'
			});
			if (hasSlots) {
				this.compiler._projectSlots(element, existing.component.root);
				if (typeof existing.component._compilerCleanup === 'function') existing.component._compilerCleanup();
				existing.component._compilerCleanup = existing.component.compiler.compile(existing.component.root, existing.component);
			}
			this._syncChildrenArray();
			return existing.component;
		}

		if (existing?.component) {
			existing.component.destroy();
			this._childRecords.delete(element);
		}

		const _hasParentSF = Array.isArray(this._scopeFactories) && this._scopeFactories.length > 0;
		const _hasLocalSF = Array.isArray(this._localScopeFactories) && this._localScopeFactories.length > 0;
		const _hasInstanceAPIs = Array.isArray(this._instanceAPIFactories) && this._instanceAPIFactories.length > 0;

		const childComponent = new MiniX_Component(Child, {
			root: element,
			props,
			parent: this,
			provider: this.provider,
			eventBus: this.eventBus,
			renderer: this.renderer,
			sanitizer: this.sanitizer,
			compiler: this.compiler,
			scopeFactories: !_hasParentSF && !_hasLocalSF
				? MiniX_Component._EMPTY_ARRAY
				: (_hasParentSF ? this._scopeFactories : []).concat(_hasLocalSF ? this._localScopeFactories : []),
			instanceAPIs: _hasInstanceAPIs ? this._instanceAPIFactories : MiniX_Component._EMPTY_ARRAY,
			dev: this.options.dev
		});

		const finishMount = () => {
			if (meta.slots) element.__minix_slots__ = meta.slots;
			childComponent.mount(element);

			let hasSlots = false;
			if (meta.slots) { for (const _ in meta.slots) { hasSlots = true; break; } }
			if (hasSlots) {
				this.compiler._projectSlots(element, childComponent.root);
				if (typeof childComponent._compilerCleanup === 'function') childComponent._compilerCleanup();
				childComponent._compilerCleanup = childComponent.compiler.compile(childComponent.root, childComponent);
			}

			this._childRecords.set(element, { name: normalizedName, component: childComponent, slots: meta.slots || {} });
			this._syncChildrenArray();
			return childComponent;
		};

		if (typeof meta.beforeMount === 'function') {
			try {
				const setupResult = meta.beforeMount(childComponent);
				if (setupResult && typeof setupResult.then === 'function') {
					return setupResult.then(
						() => finishMount(),
						(error) => {
							try { childComponent.destroy(); } catch (_) {}
							if (this.options.dev) {
								console.warn('[MiniX] mountChild beforeMount hook failed.', error);
							}
							throw error;
						}
					);
				}
			} catch (error) {
				try { childComponent.destroy(); } catch (_) {}
				if (this.options.dev) {
					console.warn('[MiniX] mountChild beforeMount hook failed.', error);
				}
				throw error;
			}
		}

		return finishMount();
	}

	destroy() {
		if (this.isDestroyed) return true;
		this._callHook('beforeUnmount', { reason: 'destroy' });
		this._destroyChildren();
		if (typeof this._compilerCleanup === 'function') {
			this._compilerCleanup();
			this._compilerCleanup = null;
		}
		this.listener.cleanup();
		for (const effect of this._effects) effect.stop();
		this._effects = new Set();
		this._rerenderQueued = false;
		this._lastRerenderMeta = null;
		this._baseScopeCache = null;
		this._staticScopeCache = null;
		this._staticScopeDirty = false;
		this._syncActiveLayout(null, { reason: 'destroy' });
		if (this._inlineMount) {
			const nodes = this._inlineNodes || [];
			for (const node of nodes) node.remove();
			this._inlineNodes = [];
			this._inlineStart?.remove();
			this._inlineEnd?.remove();
			this._inlineStart = null;
			this._inlineEnd = null;
			this.root = null;
		}
		this.isMounted = false;
		this.isDestroyed = true;
		this._callHook('unmounted', { reason: 'destroy' });
		return true;
	}
}

