class MiniX_Listener {
	constructor(options = {}) {
		this.options = { directiveNames: ['@', 'x-on:'], ...options };
		this._cleanups = new Set();
		this._computeds = new Map();
		this._registrars = new Map();
		this._watcherCleanups = new Set();
		this._timers = new Set();
		this._intervals = new Set();
	}

	_compileExpression(expression, scope = {}) {
		// Compute cacheKey and look up/compile the fn once at creation time,
		// not on every invocation of the returned closure.
		const cacheKey = String(expression);
		let fn = MiniX_Listener._exprFnCache.get(cacheKey);
		if (fn === undefined) {
			try {
				fn = new Function('__scope__', `with(__scope__) { return (${expression}); }`);
			} catch (_) {
				fn = null;
			}
			if (MiniX_Listener._exprFnCache.size >= 4000) _lruEvict(MiniX_Listener._exprFnCache);
			MiniX_Listener._exprFnCache.set(cacheKey, fn);
		}
		if (!fn) throw new SyntaxError(`Failed to compile expression: ${expression}`);
		return (extraScope = {}) => {
			let runtimeScope;
			if (extraScope && typeof extraScope === 'object') {
				let hasExtra = false;
				for (const _ in extraScope) { hasExtra = true; break; }
				if (hasExtra) {
					runtimeScope = Object.create(scope && typeof scope === 'object' ? scope : null);
					Object.assign(runtimeScope, extraScope);
				} else {
					runtimeScope = scope && typeof scope === 'object' ? scope : Object.create(null);
				}
			} else {
				runtimeScope = scope && typeof scope === 'object' ? scope : Object.create(null);
			}
			return fn(_minix_createEvalScope(runtimeScope));
		};
	}

	_runStatement(expression, scope = null) {
		const cacheKey = String(expression);
		let fn = MiniX_Listener._stmtFnCache.get(cacheKey);
		if (fn === undefined) {
			try {
				fn = new Function('__scope__', `with(__scope__) { ${expression} }`);
			} catch (_) {
				fn = null; 
			}
			if (MiniX_Listener._stmtFnCache.size >= 2000) _lruEvict(MiniX_Listener._stmtFnCache);
			MiniX_Listener._stmtFnCache.set(cacheKey, fn);
		}
		if (!fn) throw new SyntaxError(`Failed to compile statement: ${expression}`);
		return fn(_minix_createEvalScope(scope));
	}

	$watch(state, path, callback) {
		if (!state?.watch) throw new Error('$watch requires MiniX_State instance');
		const cleanup = state.watch(path, (newVal, oldVal) => callback.call(state.raw ? state.raw() : state, newVal, oldVal));
		this._watcherCleanups.add(cleanup);
		return () => { cleanup(); this._watcherCleanups.delete(cleanup); };
	}

	$computed(name, getter, context = {}) {
		if (typeof getter !== 'function') throw new Error('$computed getter must be function');
		const descriptor = {
			name,
			getter,
			value: undefined,
			dirty: true,
			effect: null,
			subscribers: new Set()
		};

		// Cache the MiniX_Effect reference once — it is always defined by the
		// time $computed descriptors are created, so the typeof guard on every
		// get() call is unnecessary overhead.
		const _Effect = MiniX_Effect;

		const scheduleSubscribers = () => {
			for (const effect of descriptor.subscribers) {
				if (effect?.active) effect.schedule();
				else descriptor.subscribers.delete(effect);
			}
		};

		const api = {
			get: () => {
				const active = _Effect.activeEffect;
				if (active) {
					// Only track active effects; stopped effects from prior renders
					// accumulate indefinitely if not filtered here.
					if (active.active) descriptor.subscribers.add(active);
					else descriptor.subscribers.delete(active);
				}

				if (!descriptor.effect) {
					descriptor.effect = new _Effect(() => getter.call(context), {
						lazy: true,
						scheduler: () => {
							descriptor.dirty = true;
							scheduleSubscribers();
						}
					});
				}

				if (descriptor.dirty) {
					descriptor.value = descriptor.effect.run();
					descriptor.dirty = false;
				}
				return descriptor.value;
			},
			invalidate: () => {
				descriptor.dirty = true;
				scheduleSubscribers();
			},
			stop: () => {
				descriptor.subscribers.clear();
				descriptor.effect?.stop?.();
			}
		};

		this._computeds.set(name, api);
		if (context && typeof context === 'object') {
			Object.defineProperty(context, name, { get: () => api.get(), configurable: true, enumerable: true });
		}
		return api;
	}

	$listen(target, eventName, handler, options = {}) {
		if (!target?.addEventListener) throw new Error('$listen requires valid event target');
		target.addEventListener(eventName, handler, options);
		const cleanup = () => {
			target.removeEventListener(eventName, handler, options);
			this._cleanups.delete(cleanup);
		};
		this._cleanups.add(cleanup);
		return cleanup;
	}

	$timeout(callback, delay = 0) {
		const id = setTimeout(() => { callback(); this._timers.delete(id); this._cleanups.delete(cleanup); }, delay);
		this._timers.add(id);
		const cleanup = () => { clearTimeout(id); this._timers.delete(id); this._cleanups.delete(cleanup); };
		this._cleanups.add(cleanup);
		return cleanup;
	}

	$interval(callback, delay = 0) {
		const id = setInterval(callback, delay);
		this._intervals.add(id);
		const cleanup = () => { clearInterval(id); this._intervals.delete(id); this._cleanups.delete(cleanup); };
		this._cleanups.add(cleanup);
		return cleanup;
	}

	listen(...args) { return this.$listen(...args); }
	watch(...args) { return this.$watch(...args); }
	computed(name, getter, options = {}) { return this.$computed(name, getter, options.context || {}); }
	registrar(name, handler) {
		if (typeof handler !== 'function') throw new Error('registrar handler must be function');
		this._registrars.set(name, handler);
		return () => this._registrars.delete(name);
	}

	parseDirectiveName(attributeName) {
		let raw = null;
		let syntax = null;
		if (attributeName.startsWith('@')) {
			raw = attributeName.slice(1);
			syntax = '@';
		} else if (attributeName.startsWith('x-on:')) {
			raw = attributeName.slice(5);
			syntax = 'x-on:';
		} else {
			return null;
		}

		const firstDot = raw.indexOf('.');
		const event = firstDot === -1 ? raw : raw.slice(0, firstDot);
		const modifiers = new Set();
		if (firstDot !== -1) {
			let start = firstDot + 1;
			for (let i = start; i <= raw.length; i++) {
				if (i === raw.length || raw.charCodeAt(i) === 46) {
					if (i > start) modifiers.add(raw.slice(start, i));
					start = i + 1;
				}
			}
		}
		return {
			type: 'event',
			event,
			raw: attributeName,
			syntax,
			modifiers
		};
	}

	bindDirective(element, attributeName, expression, scope = {}, options = {}) {
		const parsed = this.parseDirectiveName(attributeName);
		if (!parsed || !parsed.event) return () => { };

		const registrar = this._registrars.get(parsed.type) || this._registrars.get('event');
		if (registrar) {
			const maybeCleanup = registrar({ element, attributeName, expression, scope, parsed, listener: this, options });
			if (typeof maybeCleanup === 'function') {
				this._cleanups.add(maybeCleanup);
				return maybeCleanup;
			}
		}

		let cleanup = null;

		const handler = (event) => {
			if (parsed.modifiers?.has('self') && event.target !== element) return;
			if (parsed.modifiers?.has('prevent')) event.preventDefault();
			if (parsed.modifiers?.has('stop')) event.stopPropagation();

			const runtimeScope = { $event: event, event, $el: element, el: element };
			const maybeMethod = scope?.[expression];
			let result;
			if (typeof maybeMethod === 'function') {
				result = maybeMethod.call(scope, event, element);
			} else {
				try {
					const compiled = this._compileExpression(expression, scope);
					result = compiled(runtimeScope);
				} catch (error) {
					try {
						result = this._runStatement(expression, { ...scope, ...runtimeScope });
					} catch (statementError) {
						console.warn(`[MiniX_Listener] Failed directive ${attributeName}="${expression}"`, statementError || error);
					}
				}
			}

			if (parsed.modifiers?.has('once') && typeof cleanup === 'function') cleanup();
			return result;
		};

		cleanup = this.$listen(element, parsed.event, handler, options);
		return cleanup;
	}

	cleanup() {
		// Snapshot before iterating: individual cleanup fns call _cleanups.delete(self),
		// which can skip future entries in a live Set iteration.
		const fns = Array.from(this._cleanups);
		this._cleanups.clear();
		for (const fn of fns) { try { fn(); } catch (_) {} }
		const watcherFns = Array.from(this._watcherCleanups);
		this._watcherCleanups.clear();
		for (const fn of watcherFns) { try { fn(); } catch (_) {} }
		for (const id of this._timers) clearTimeout(id);
		for (const id of this._intervals) clearInterval(id);
		this._timers.clear();
		this._intervals.clear();
		for (const computed of this._computeds.values()) computed?.stop?.();
		this._computeds.clear();
		this._registrars.clear();
		return true;
	}
}

MiniX_Listener._exprFnCache = new Map();
MiniX_Listener._stmtFnCache = new Map();

