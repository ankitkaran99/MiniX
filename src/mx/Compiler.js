class MiniX_Compiler {
	static _pipeCache = new Map();
	static _scopeGen = 0;

	constructor(options = {}) {
		this.options = { directivePrefix: 'x-', eventPrefixes: ['@', 'x-on:'], dev: false, ...options };
		this.directives = new Map();
		this.modifiers = new Map();
		this._registerBuiltinModifiers();
		this._registerBuiltins();
	}

	_normalizeDirectiveName(name) {
		if (typeof name !== 'string') return String(name || '').trim().toLowerCase();
		// Fast-path: all lowercase ASCII with no whitespace anywhere
		let clean = true;
		for (let i = 0; i < name.length; i++) {
			const c = name.charCodeAt(i);
			if (c >= 65 && c <= 90) { clean = false; break; }  // uppercase A-Z
			if (c === 32 || c === 9 || c === 10 || c === 13) { clean = false; break; } // any whitespace
		}
		return clean ? name : name.trim().toLowerCase();
	}

	_warn(message, ...args) {
		if (!this.options.dev) return;
		console.warn(`[MiniX_Compiler] ${message}`, ...args);
	}

	_isSimplePath(expression) {
		// Accepts pre-trimmed string from _compileGetter to avoid double-trim.
		return _minix_SIMPLE_PATH_RE.test(expression);
	}

	_parseSimplePathSegments(expression) {
		return _minix_parseSimplePathSegments(expression);
	}

	_compileGetter(expression) {
		const expr = typeof expression === 'string' ? expression.trim() : String(expression || '').trim();
		if (this._isSimplePath(expr)) {
			let getter = MiniX_Compiler._getterCache.get(expr);
			if (!getter) {
				const segments = this._parseSimplePathSegments(expr);
				const len = segments.length;
				
				
				if (len === 1) {
					const s0 = segments[0];
					getter = (scope, fallback = undefined) => {
						if (scope == null) return fallback;
						const v = scope[s0];
						return v === undefined ? fallback : v;
					};
				} else if (len === 2) {
					const s0 = segments[0], s1 = segments[1];
					getter = (scope, fallback = undefined) => {
						if (scope == null) return fallback;
						const a = scope[s0];
						if (a == null) return fallback;
						const v = a instanceof Map ? a.get(s1) : a[s1];
						return v === undefined ? fallback : v;
					};
				} else if (len === 3) {
					const s0 = segments[0], s1 = segments[1], s2 = segments[2];
					getter = (scope, fallback = undefined) => {
						if (scope == null) return fallback;
						const a = scope[s0];
						if (a == null) return fallback;
						const b = a instanceof Map ? a.get(s1) : a[s1];
						if (b == null) return fallback;
						const v = b instanceof Map ? b.get(s2) : b[s2];
						return v === undefined ? fallback : v;
					};
				} else if (len === 4) {
					const s0 = segments[0], s1 = segments[1], s2 = segments[2], s3 = segments[3];
					getter = (scope, fallback = undefined) => {
						if (scope == null) return fallback;
						const a = scope[s0];
						if (a == null) return fallback;
						const b = a instanceof Map ? a.get(s1) : a[s1];
						if (b == null) return fallback;
						const c = b instanceof Map ? b.get(s2) : b[s2];
						if (c == null) return fallback;
						const v = c instanceof Map ? c.get(s3) : c[s3];
						return v === undefined ? fallback : v;
					};
				} else {
					getter = (scope, fallback = undefined) => {
						let current = scope;
						for (let i = 0; i < segments.length; i++) {
							if (current == null) return fallback;
							current = current instanceof Map ? current.get(segments[i]) : current[segments[i]];
						}
						return current === undefined ? fallback : current;
					};
				}
				getter.__minix_expr__ = expr;
				if (MiniX_Compiler._getterCache.size >= 5000) _lruEvict(MiniX_Compiler._getterCache);
				MiniX_Compiler._getterCache.set(expr, getter);
			}
			return getter;
		}
		const cacheKey = '\x00' + expr;
		let getter = MiniX_Compiler._getterCache.get(cacheKey);
		if (!getter) {
			getter = (scope, fallback = undefined) => this._evaluate(expr, scope, fallback);
			getter.__minix_expr__ = expr;
			if (MiniX_Compiler._getterCache.size >= 5000) _lruEvict(MiniX_Compiler._getterCache);
			MiniX_Compiler._getterCache.set(cacheKey, getter);
		}
		return getter;
	}

	_shallowEqual(a, b) { return _minix_shallowEqual(a, b); }

	_nextMeaningfulSibling(node) {
		let cursor = node?.nextSibling;
		while (cursor) {
			if (cursor.nodeType === Node.TEXT_NODE && !cursor.textContent.trim()) { cursor = cursor.nextSibling; continue; }
			if (cursor.nodeType === Node.COMMENT_NODE) { cursor = cursor.nextSibling; continue; }
			return cursor;
		}
		return null;
	}

	_previousMeaningfulSibling(node) {
		let cursor = node?.previousSibling;
		while (cursor) {
			if (cursor.nodeType === Node.TEXT_NODE && !cursor.textContent.trim()) { cursor = cursor.previousSibling; continue; }
			if (cursor.nodeType === Node.COMMENT_NODE) { cursor = cursor.previousSibling; continue; }
			return cursor;
		}
		return null;
	}

	modifier(name, handler) {
		const normalized = this._normalizeDirectiveName(name);
		if (!normalized || typeof handler !== 'function') return this;
		this.modifiers.set(normalized, handler);
		return this;
	}

	_registerBuiltinModifiers() {
		if (this._builtinModifiersRegistered) return;
		this._builtinModifiersRegistered = true;

		this.modifier('trim', ({ value }) => typeof value === 'string' ? value.trim() : value);
		this.modifier('number', ({ value }) => {
			if (value === '' || value == null) return value;
			const num = Number(value);
			return Number.isNaN(num) ? value : num;
		});
		this.modifier('lower', ({ value }) => typeof value === 'string' ? value.toLowerCase() : value);
		this.modifier('upper', ({ value }) => typeof value === 'string' ? value.toUpperCase() : value);
		this.modifier('capitalize', ({ value }) => typeof value === 'string' && value.length ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value);
		this.modifier('json', ({ value }) => {
			try { return JSON.stringify(value); } catch (_) { return value; }
		});
		this.modifier('boolean', ({ value }) => Boolean(value));
	}

	_parseAttributeModifiers(name) {
		const raw = String(name || '').trim();
		if (!raw) return [];
		let start = 0;
		if (raw.charCodeAt(0) === 64) start = 1;
		else if (raw.startsWith('x-on:')) start = 5;
		else if (raw.charCodeAt(0) === 58) start = 1;
		const firstDot = raw.indexOf('.', start);
		if (firstDot === -1) return [];
		const out = [];
		let segmentStart = firstDot + 1;
		for (let i = segmentStart; i <= raw.length; i++) {
			if (i === raw.length || raw.charCodeAt(i) === 46) {
				if (i > segmentStart) out.push(raw.slice(segmentStart, i));
				segmentStart = i + 1;
			}
		}
		return out;
	}

	_applyModifiers(value, modifiers = [], context = {}) {
		let current = value;
		const compiler = this;
		for (let i = 0; i < modifiers.length; i++) {
			const modName = modifiers[i];
			const handler = this.modifiers.get(this._normalizeDirectiveName(modName));
			if (!handler) continue;
			try {
				const arg = { value: current, modifier: modName, compiler };
				if (context && typeof context === 'object') {
					for (const k in context) {
						if (Object.hasOwn(context, k)) arg[k] = context[k];
					}
				}
				current = handler(arg);
			} catch (error) {
				this._warn(`Modifier ".${modName}" failed`, error);
			}
		}
		return current;
	}

	directive(name, handler, options = {}) {
		const normalized = this._normalizeDirectiveName(name);
		const record = {
			name: normalized,
			handler,
			priority: (typeof options.priority === 'number' && isFinite(options.priority)) ? options.priority : 0,
			structural: Boolean(options.structural),
			aliases: Array.isArray(options.aliases) ? options.aliases.map((alias) => this._normalizeDirectiveName(alias)) : []
		};
		this.directives.set(normalized, record);
		for (const alias of record.aliases) this.directives.set(alias, record);
		return this;
	}

	useDirectives(definitions = {}) {
		for (const name in definitions) {
			if (!Object.hasOwn(definitions, name)) continue;
			const def = definitions[name];
			if (typeof def === 'function') this.directive(name, def);
			else if (def && typeof def.handler === 'function') this.directive(name, def.handler, def);
		}
		return this;
	}

	createScope(component, extra = null, el = null) {
		// Fast-path: check the per-element scope cache before walking the DOM
		// provider chain in _resolveScope. On cache hit (same scopeGen, no extra)
		// we skip the entire DOM walk and provider invocation.
		if (!extra && el) {
			const gen = MiniX_Compiler._scopeGen;
			const cached = el.__minix_scope_cache__;
			if (cached !== undefined && el.__minix_scope_cache_gen__ === gen) {
				return cached;
			}
		}

		// Resolve the base scope from the component or from x-data providers
		const baseScope = this._resolveScope(component, false, MiniX_Compiler._scopeGen, el);

		// If we have extra properties, create a new scope that inherits from baseScope
		let hasExtra = false;
		if (extra !== null && extra !== undefined) {
			for (const _ in extra) { hasExtra = true; break; }
		}

		if (!hasExtra) {
			if (el) {
				const gen = MiniX_Compiler._scopeGen;
				el.__minix_scope_cache__ = baseScope;
				el.__minix_scope_cache_gen__ = gen;
			}
			return baseScope;
		}

		// Create a new scope that inherits from baseScope and includes extra properties
		const scope = Object.create(baseScope);
		for (const k in extra) {
			if (Object.hasOwn(extra, k)) {
				scope[k] = extra[k];
			}
		}
		return scope;
	}
	
	_resolveScope(component, _hasExtra, gen, el) {
		if (el) {
			let cursor = el;
			// Walk up the DOM tree to find a scope provider (from x-data or x-for)
			while (cursor) {
				if (typeof cursor.__minix_scope_provider__ === 'function') {
					const provider = cursor.__minix_scope_provider__;
					const scope = provider();
					if (scope && typeof scope === 'object') {
						return scope;
					}
				}
				cursor = cursor.parentNode || null;
			}
		}
		return component._createRenderScope(null, el);
	}

	_evaluate(expression, scope = null, fallback = undefined) {

		
		const expr = typeof expression === 'string' ? (expression.includes(' ') || expression !== expression.trim() ? expression.trim() : expression) : String(expression || '').trim();

		
		
		
		let pipeData = MiniX_Compiler._pipeCache.get(expr);
		if (!pipeData) {
			const pipes = this._splitPipes(expr);
			const base = pipes[0];
			const wrapped = /^\s*\{/.test(base) ? `(${base})` : base;
			
			
			
			
			let fn = null;
			try {
				fn = new Function('__scope__', `with(__scope__) { return (${wrapped}); }`);
			} catch (compileError) {
				this._warn(`Failed to compile expression: ${expr}`, compileError);
			}
			pipeData = { base, pipes: pipes.length > 1 ? pipes.slice(1).map(p => p.trim().toLowerCase()) : null, fn };
			if (MiniX_Compiler._pipeCache.size >= 2000) _lruEvict(MiniX_Compiler._pipeCache);
			MiniX_Compiler._pipeCache.set(expr, pipeData);
		}
		const pipeNames = pipeData.pipes;
		const fn = pipeData.fn;

		
		if (!fn) return fallback;

		
		
		
		let value;
		try {
			value = fn(_minix_createEvalScope(scope));
		} catch (error) {
			if (fallback === undefined) this._warn(`Failed to evaluate expression: ${expr}`, error);
			return fallback;
		}

		if (pipeNames) {
			const pipeCtx = { value };
			for (const pipeName of pipeNames) {
				const handler = this.modifiers.get(pipeName);
				if (handler) {
					try { pipeCtx.value = value; value = handler(pipeCtx); } catch (_) { }
				}
			}
		}

		return value;
	}

	_splitPipes(expr) { return _minix_splitPipes(expr); }

	_effect(component, fn, options = {}) {
		const effect = new MiniX_Effect(fn, options);
		if (!component._effects) component._effects = new Set();
		component._effects.add(effect);
		return () => {
			effect.stop();
			component._effects.delete(effect);
		};
	}

	_destroyMountedChildrenInSubtree(component, root) {
		if (!component || !root || !component._childRecords) return;
		
		
		const toDestroy = [];
		for (const [el, record] of component._childRecords) {
			if (!el) continue;
			if (el === root || (root.contains && root.contains(el))) {
				toDestroy.push({ el, record });
			}
		}
		if (!toDestroy.length) return;
		for (const { el, record } of toDestroy) {
			try { record?.component?.destroy?.(); } catch (_) { }
			component._childRecords.delete(el);
		}
		if (typeof component._syncChildrenArray === 'function') component._syncChildrenArray();
	}

	_walkElements(root, localComponents = null) {
		const elements = [];
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
		const structuralAttrs = MiniX_Compiler._STRUCTURAL_ATTRS;
		let node = walker.currentNode;
		while (node) {
			if (node.nodeType === Node.ELEMENT_NODE) {
				elements.push(node);
				let isStructural = false;
				if (node.hasAttributes()) {
					const attrNames = node.getAttributeNames();
					for (let ai = 0; ai < attrNames.length; ai++) {
						if (structuralAttrs.has(attrNames[ai])) { isStructural = true; break; }
					}
				}
				// Also treat auto-component elements as structural — their subtree is
				// owned by the child component and must not be compiled by the parent.
				if (!isStructural && node !== root) {
					const tn = node.tagName?.toLowerCase();
					if (tn && tn.includes('-') && !node.hasAttribute('x-component')) {
						const isLocal = localComponents && Object.hasOwn(localComponents, tn);
						if (isLocal || MiniX_Component.registry.has(tn)) isStructural = true;
					}
				}
				if (isStructural) {
					if (node !== root || node.hasAttribute('x-ignore')) {
						let jumped = false;
						let cursor = node;
						while (cursor && cursor !== root) {
							const sibling = cursor.nextElementSibling || cursor.nextSibling;
							if (sibling) {
								walker.currentNode = sibling;
								node = sibling.nodeType === Node.ELEMENT_NODE
									? sibling
									: walker.nextNode();
								jumped = true;
								break;
							}
							cursor = cursor.parentNode;
						}
						if (!jumped) break;
						continue;
					}
				}
			}
			node = walker.nextNode();
		}
		return elements;
	}

	_registerBuiltins() {
		if (this._builtinsRegistered) return;
		this._builtinsRegistered = true;

		this.directive('x-if', ({ el, expression, component }) => this._compileIfDirective(el, expression, component), { priority: 1000, structural: true });
		this.directive('x-else-if', () => () => { }, { priority: 999, structural: true });
		this.directive('x-else', () => () => { }, { priority: 998, structural: true });
		this.directive('x-for', ({ el, expression, component }) => this._compileForDirective(el, expression, component), { priority: 950, structural: true });
		this.directive('x-component', ({ el, expression, component }) => this._compileComponentDirective(el, expression, component), { priority: 900, structural: true });
		this.directive('x-portal', ({ el, expression, component }) => this._compilePortalDirective(el, expression, component), { priority: 850, structural: true, aliases: ['x-teleport'] });

		this.directive('x-ignore', ({ el }) => this._compileIgnoreDirective(el), { priority: 800 });
		this.directive('x-slot', ({ el, expression, component }) => this._compileSlotDirective(el, expression, component), { priority: 780 });
		this.directive('x-text', ({ el, expression, component }) => this._compileTextDirective(el, expression, component), { priority: 700 });
		this.directive('x-html', ({ el, expression, component }) => this._compileHtmlDirective(el, expression, component), { priority: 690 });
		this.directive('x-show', ({ el, expression, component }) => this._compileShowDirective(el, expression, component), { priority: 680 });
		this.directive('x-model', ({ el, expression, component }) => this._compileModelDirective(el, expression, component), { priority: 670 });
		this.directive('x-bind', ({ el, name, expression, component }) => this._compileBindDirective(el, name, expression, component), { priority: 660 });
		this.directive('x-class', ({ el, expression, component }) => this._compileClassDirective(el, expression, component), { priority: 650 });
		this.directive('x-style', ({ el, expression, component }) => this._compileStyleDirective(el, expression, component), { priority: 640 });
		this.directive('x-attr', ({ el, expression, component }) => this._compileAttrDirective(el, expression, component), { priority: 630 });
		this.directive('x-ref', ({ el, expression, component }) => this._compileRefDirective(el, expression, component), { priority: 620 });
		this.directive('x-init', ({ el, expression, component }) => this._compileInitDirective(el, expression, component), { priority: 610 });
		this.directive('x-focus', ({ el, expression, component }) => this._compileFocusDirective(el, expression, component), { priority: 600 });
		this.directive('x-disabled', ({ el, expression, component }) => this._compileDisabledDirective(el, expression, component), { priority: 590 });
		this.directive('x-value', ({ el, expression, component }) => this._compileValueDirective(el, expression, component), { priority: 580 });
		this.directive('x-cloak', ({ el }) => this._compileCloakDirective(el), { priority: 570 });
		this.directive('x-transition', ({ el, expression, component }) => this._compileTransitionDirective(el, expression, component), { priority: 560 });
		this.directive('x-once', ({ el, expression, component }) => this._compileOnceDirective(el, expression, component), { priority: 550 });
		this.directive('x-data', ({ el, expression, component }) => this._compileScopedDataDirective(el, expression, component), { priority: 790 });
	}

	_resolveDirectiveFromAttr(attr) {
		const name = attr.name;
		const expr = attr.value;

		if (name.startsWith('@') || name.startsWith('x-on:')) {
			const modifiers = this._parseAttributeModifiers(name);
			return {
				kind: 'event',
				priority: 665,
				name,
				expression: expr,
				modifiers,
				structural: false,
				run: (component, el) => this._compileEventDirective(el, name, expr, component, modifiers)
			};
		}

		if (name.startsWith(':') || name.startsWith('x-bind:')) {
			const modifiers = this._parseAttributeModifiers(name);
			return {
				kind: 'directive',
				priority: (this.directives.get('x-bind') || {}).priority || 660,
				name,
				expression: expr,
				modifiers,
				structural: false,
				run: (component, el) => this._compileBindDirective(el, name, expr, component, modifiers)
			};
		}

		if (name.startsWith('x-model.')) {
			const modifiers = this._parseAttributeModifiers(name);
			return {
				kind: 'directive',
				priority: (this.directives.get('x-model') || {}).priority || 670,
				name: 'x-model',
				expression: expr,
				modifiers,
				structural: false,
				run: (component, el) => this._compileModelDirective(el, expr, component, modifiers)
			};
		}

		const record = this.directives.get(this._normalizeDirectiveName(name));
		if (!record) return null;
		const modifiers = this._parseAttributeModifiers(name);
		return {
			kind: 'directive',
			priority: record.priority,
			name,
			expression: expr,
			modifiers,
			structural: record.structural,
			run: (component, el) => record.handler({
				el,
				expression: expr,
				component,
				compiler: this,
				name,
				attr,
				record,
				modifiers,
				applyModifiers: (value, extra = {}) => this._applyModifiers(value, modifiers, { el, expression: expr, component, name, attr, record, ...extra })
			})
		};
	}

	_collectDirectives(el, localComponents = null) {
		const attrs = el.attributes || [];
		const attrNames = el.getAttributeNames ? el.getAttributeNames() : null;
		const count = attrNames ? attrNames.length : attrs.length;

		// Auto-component: if the element's tag name matches a registered component
		// and it doesn't already have an explicit x-component attribute, synthesize
		// one so the existing compile pipeline handles it without any new code paths.
		const tagName = el.tagName ? el.tagName.toLowerCase() : null;
		const hasXComponent = tagName && el.hasAttribute('x-component');
		const autoComponentName = (!hasXComponent && tagName && tagName.includes('-'))
			? (localComponents?.[tagName] || MiniX_Component.registry.has(tagName) ? tagName : null)
			: null;

		const sigParts = [];
		if (autoComponentName) sigParts.push('x-component\x00' + autoComponentName);
		for (let i = 0; i < count; i++) {
			const name = attrNames ? attrNames[i] : attrs[i].name;
			const ch0 = name.charCodeAt(0);
			const isDirective = ch0 === 120 /* x */ || ch0 === 64 /* @ */ || ch0 === 58 /* : */;
			if (!isDirective) continue;
			// Use \0 as name/value separator and \1 as entry separator — neither can
			// appear in HTML attribute values, avoiding false cache hits from collisions.
			sigParts.push(name + '\0' + (attrNames ? el.getAttribute(name) : attrs[i].value));
		}
		const signature = sigParts.join('\x01');
		const cached = el.__minix_directives_cache__;
		if (cached && cached.signature === signature) return cached.value;
		const resolved = [];

		// Inject the synthetic x-component directive first (highest priority).
		if (autoComponentName) {
			const r = this._resolveDirectiveFromAttr({ name: 'x-component', value: autoComponentName });
			if (r) resolved.push(r);
		}

		for (let i = 0; i < count; i++) {
			const name = attrNames ? attrNames[i] : attrs[i].name;
			const attr = { name, value: attrNames ? el.getAttribute(name) : attrs[i].value };
			const r = this._resolveDirectiveFromAttr(attr);
			if (r && r.name !== 'x-props') resolved.push(r);
		}
		
		for (let i = 1; i < resolved.length; i++) {
			const cur = resolved[i];
			let j = i - 1;
			while (j >= 0 && resolved[j].priority < cur.priority) {
				resolved[j + 1] = resolved[j];
				j--;
			}
			resolved[j + 1] = cur;
		}
		el.__minix_directives_cache__ = { signature, value: resolved.slice() };
		return resolved;
	}

	_prepareCompileGraph(root, component = null) {
		const cached = root.__minix_graph_cache__;
		const gen = MiniX_Compiler._scopeGen;
		if (cached && cached.gen === gen) return cached.value;
		const localComponents = component?.localComponents || null;
		const entries = [];
		const elements = this._walkElements(root, localComponents);
		const conditionalSkip = new WeakSet();
		// Cache closest('[data-x-once]') and closest('[x-component]') per element
		// using ancestor tracking to avoid redundant DOM walks on every element.
		const onceAncestorCache = new WeakMap();
		const componentAncestorCache = new WeakMap();
		const hasOnceAncestor = (el) => {
			if (el === root) return false;
			const p = el.parentElement;
			if (!p || p === root) return false;
			if (onceAncestorCache.has(p)) return onceAncestorCache.get(p);
			const result = !!p.closest('[data-x-once]');
			onceAncestorCache.set(p, result);
			return result;
		};
		const isAutoComponentTag = (tn) => {
			if (!tn || !tn.includes('-')) return false;
			return (localComponents && Object.hasOwn(localComponents, tn)) || MiniX_Component.registry.has(tn);
		};
		const componentAncestorNotRoot = (el) => {
			if (el === root) return null;
			const p = el.parentElement;
			if (!p) return null;
			if (componentAncestorCache.has(p)) return componentAncestorCache.get(p);
			// Check for explicit x-component attribute first, then auto-component tag names.
			let found = p.closest('[x-component]') || null;
			if (!found) {
				// Walk ancestors looking for an auto-component element.
				let cursor = p;
				while (cursor && cursor !== root) {
					const tn = cursor.tagName?.toLowerCase();
					if (tn && !cursor.hasAttribute('x-component') && isAutoComponentTag(tn)) {
						found = cursor;
						break;
					}
					cursor = cursor.parentElement;
				}
			}
			componentAncestorCache.set(p, found);
			return found;
		};
		for (const el of elements) {
			const directives = this._collectDirectives(el, localComponents);
			const entry = { el, directives, skip: false };
			if (conditionalSkip.has(el)) entry.skip = true;
			if (el !== root && hasOnceAncestor(el)) entry.skip = true;
			if (el === root && root.__minix_skip_root_directives__) entry.skip = true;
			if (el === root) {
				const isComponentHost = el.hasAttribute('x-component')
					|| (el.tagName && isAutoComponentTag(el.tagName.toLowerCase()));
				if (isComponentHost || el.hasAttribute('x-for') || el.hasAttribute('x-portal') || el.hasAttribute('x-teleport')) entry.skip = true;
			}
			if (el !== root) {
				const compAnc = componentAncestorNotRoot(el);
				if (compAnc && compAnc !== root && !el.hasAttribute('x-component')) entry.skip = true;
			}
			if (el !== root) {
				const scopedRoot = el.closest('[x-data]');
				if (scopedRoot && (scopedRoot !== root || !root.__minix_skip_root_directives__)) entry.skip = true;
			}
			if (el.hasAttribute('x-if')) {
				let cursor = this._nextMeaningfulSibling(el);
				while (cursor && cursor.nodeType === Node.ELEMENT_NODE && (cursor.hasAttribute('x-else-if') || cursor.hasAttribute('x-else'))) {
					conditionalSkip.add(cursor);
					cursor = this._nextMeaningfulSibling(cursor);
				}
			}
			entries.push(entry);
		}
		root.__minix_graph_cache__ = { gen, value: entries };
		return entries;
	}

	_compileTextDirective(el, expression, component) {
		const getter = this._compileGetter(expression);
		let lastText = undefined;
		return this._effect(component, () => {
			const scope = this.createScope(component, null, el);
			const value = getter(scope, '');
			const text = value == null ? '' : String(value);
			if (text !== lastText) {
				el.textContent = text;
				lastText = text;
			}
		});
	}

	_compileHtmlDirective(el, expression, component) {
		const getter = this._compileGetter(expression);
		let lastRaw = Symbol('minix-html-init');
		let lastSanitized = '';
		let subtreeCleanup = null;
		return this._effect(component, () => {
			const scope = this.createScope(component, null, el);
			const raw = getter(scope, '');
			const nextRaw = raw == null ? '' : String(raw);
			if (nextRaw !== lastRaw) {
				const sanitized = component.sanitizer.sanitize(nextRaw);
				lastRaw = nextRaw;
				lastSanitized = sanitized;
			}
			if (el.__minix_html_last__ !== lastSanitized) {
				if (typeof subtreeCleanup === 'function') {
					subtreeCleanup();
					subtreeCleanup = null;
				}
				if (el.innerHTML !== lastSanitized) {
					el.innerHTML = lastSanitized;
					el.__minix_html_last__ = lastSanitized;
					subtreeCleanup = this.compile(el, component);
				}
			}
		});
	}

	_compileShowDirective(el, expression, component) {
		
		
		
		const inlineDisplay = el.style.display;
		const originalDisplay = inlineDisplay === 'none' ? '' : (inlineDisplay || '');
		const getter = this._compileGetter(expression);
		let lastVisible = undefined;
		return this._effect(component, () => {
			const scope = this.createScope(component, null, el);
			const visible = Boolean(getter(scope, false));
			if (visible === lastVisible) return;
			lastVisible = visible;
			if (el.__minix_transition__) {
				el.__minix_transition__.toggle(visible, originalDisplay);
				return;
			}
			if (visible) {
				if (el.style.display === 'none') el.style.display = originalDisplay;
			} else {
				if (el.style.display !== 'none') el.style.display = 'none';
			}
		});
	}

	_compileBindDirective(el, attrName, expression, component) {
		const targetAttr = attrName.startsWith(':') ? attrName.slice(1) : attrName.slice(7);
		if (targetAttr === 'class') return this._compileClassDirective(el, expression, component);
		if (targetAttr === 'style') return this._compileStyleDirective(el, expression, component);

		const getter = this._compileGetter(expression);
		let lastBoundValue = Symbol('unset');
		return this._effect(component, () => {
			const value = getter(this.createScope(component, null, el), undefined);
			if (Object.is(value, lastBoundValue)) return;
			lastBoundValue = value;
			MiniX_Compiler._patchAttrValue(el, targetAttr, value);
		});
	}

	
	static _KEY_MAP = {
		enter:     ['Enter'],
		escape:    ['Escape', 'Esc'],
		tab:       ['Tab'],
		space:     [' ', 'Spacebar'],
		up:        ['ArrowUp'],
		down:      ['ArrowDown'],
		left:      ['ArrowLeft'],
		right:     ['ArrowRight'],
		delete:    ['Delete'],
		backspace: ['Backspace'],
	};

	_compileEventDirective(el, attributeName, expression, component, modifiers = []) {
		const raw = attributeName.startsWith('@') ? attributeName.slice(1) : attributeName.slice(5);
		const eventDot = raw.indexOf('.');
		const eventName = eventDot === -1 ? raw : raw.slice(0, eventDot);
		const mods = (modifiers instanceof Set) ? modifiers : new Set(modifiers || []);

		
		const keyFilters = [];
		for (const mod of mods) {
			if (MiniX_Compiler._KEY_MAP[mod]) keyFilters.push(mod);
		}
		const hasKeyFilter = keyFilters.length > 0;
		// Pre-build a flat Set of accepted key strings at compile time so the hot
		// event path is a single O(1) Set.has() lookup instead of double-.some().
		let acceptedKeys = null;
		if (hasKeyFilter) {
			acceptedKeys = new Set();
			for (const mod of keyFilters) {
				for (const k of MiniX_Compiler._KEY_MAP[mod]) acceptedKeys.add(k);
			}
		}


		// Pre-compile the event handler expression at setup time.
		// _evaluate() internally calls _compileGetter() on every invocation which
		// does a cache lookup + potential new Function() compile — calling it once
		// here removes that overhead from the hot event dispatch path entirely.
		const _eventGetter = this._compileGetter(expression);

		// Reuse a single fireScope per directive instance to avoid allocating
		// Object.create(liveScope) + 4 property assignments on every event fire.
		let _fireScope = null;
		let _fireScopeBase = null;

		const listener = (event) => {
			if (mods.has('self') && event.target !== el) return;
			if (hasKeyFilter) {
				if (!acceptedKeys.has(event.key)) return;
			}
			if (mods.has('prevent')) event.preventDefault();
			if (mods.has('stop')) event.stopPropagation();

			const liveScope = this.createScope(component, null, el);
			if (_fireScope === null || _fireScopeBase !== liveScope) {
				_fireScope = Object.create(liveScope);
				_fireScope.$el = el;
				_fireScope.el  = el;
				_fireScopeBase = liveScope;
			}
			_fireScope.$event = event;
			_fireScope.event  = event;
			const result = _eventGetter(_fireScope, undefined);
			if (typeof result === 'function') result.call(_fireScope, event);
		};
		const delegateRoot = this._shouldDelegateEvent(eventName, mods) ? this._getDelegatedEventRoot(component) : null;
		if (delegateRoot) {
			const delegated = this._ensureDelegatedEventRoot(delegateRoot, eventName);
			let list = delegated.handlers.get(el);
			if (!list) { list = []; delegated.handlers.set(el, list); }
			delegated.refCount++;
			const removeFromDelegated = () => {
				const current = delegated.handlers.get(el);
				if (!current) return;
				const idx = current.indexOf(listener);
				if (idx >= 0) current.splice(idx, 1);
				delegated.refCount--;
				if (delegated.refCount <= 0) {
					delegateRoot.removeEventListener(eventName, delegated.listener, false);
					delegateRoot.__minixDelegatedEvents?.delete(eventName);
				}
			};
			// For once, wrap so the handler self-removes from the WeakMap after firing.
			const wrappedListener = mods.has('once') ? (event) => { removeFromDelegated(); listener(event); } : listener;
			list.push(wrappedListener);
			return () => {
				const current = delegated.handlers.get(el);
				if (!current) return;
				const idx = current.indexOf(wrappedListener);
				if (idx >= 0) {
					current.splice(idx, 1);
					delegated.refCount--;
					if (delegated.refCount <= 0) {
						delegateRoot.removeEventListener(eventName, delegated.listener, false);
						delegateRoot.__minixDelegatedEvents?.delete(eventName);
					}
				}
			};
		}
		const listenerOptions = mods.has('capture') || mods.has('once')
			? { capture: mods.has('capture'), once: mods.has('once') }
			: false;
		el.addEventListener(eventName, listener, listenerOptions);
		return () => el.removeEventListener(eventName, listener, mods.has('capture') ? { capture: true } : false);
	}

	_getDelegatedEventRoot(component) {
		return component?.root || null;
	}

	_shouldDelegateEvent(eventName, modifiers = []) {
		if (!eventName) return false;
		const mods = modifiers instanceof Set ? modifiers : new Set(modifiers || []);
		if (mods.has('capture')) return false;
		return eventName === 'click' || eventName === 'input' || eventName === 'change' || eventName === 'submit' || eventName === 'keydown' || eventName === 'keyup';
	}

	_ensureDelegatedEventRoot(root, eventName) {
		if (!root) return null;
		let store = root.__minixDelegatedEvents;
		if (!store) store = root.__minixDelegatedEvents = new Map();
		let entry = store.get(eventName);
		if (entry) return entry;
		entry = { handlers: new WeakMap(), listener: null, refCount: 0 };
		entry.listener = (event) => {
			let cursor = event.target;
			while (cursor) {
				const handlers = entry.handlers.get(cursor);
				if (handlers && handlers.length) {
					for (let i = 0; i < handlers.length; i++) {
						const handler = handlers[i];
						handler(event);
						if (event.cancelBubble) return;
					}
				}
				if (cursor === root) break;
				cursor = cursor.parentNode || null;
			}
		};
		root.addEventListener(eventName, entry.listener, false);
		store.set(eventName, entry);
		return entry;
	}

	_stateHasPath(state, path) {
		if (!state || !path || typeof path !== 'string') return false;
		if (typeof state.has === 'function') return state.has(path);
		const keys = [];
		let start = 0;
		for (let i = 0; i <= path.length; i++) {
			if (i === path.length || path.charCodeAt(i) === 46) {
				if (i > start) keys.push(path.slice(start, i));
				start = i + 1;
			}
		}
		let current = state.raw ? (state.raw().__raw || state.raw()) : state;
		if (!keys.length) return current !== undefined;
		for (const key of keys) {
			if (current == null) return false;
			if (current instanceof Map) {
				if (!current.has(key)) return false;
				current = current.get(key);
				continue;
			}
			if (!(key in Object(current))) return false;
			current = current[key];
		}
		return true;
	}

	_setModelValue(expression, component, nextValue, el = null) {
		const normalizedExpr = String(expression || '').trim();
		const scope = this.createScope(component, null, el || component.root);
		const loopMeta = component.__minix_loop_state__?.meta;

		if (loopMeta?.itemVar) {
			if (!loopMeta._itemVarPattern) {
				const escaped = loopMeta.itemVar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
				loopMeta._itemVarPattern = new RegExp(`^${escaped}(?=$|[.\\[])`);
			}
			if (loopMeta._itemVarPattern.test(normalizedExpr)) {
				const suffix = normalizedExpr.slice(loopMeta.itemVar.length);
				if (loopMeta.sourcePath) {
					if (loopMeta.iterationKind === 'array') {
						const sourcePath = `${loopMeta.sourcePath}.${loopMeta.index}${suffix}`;
						return component.state.set(sourcePath, nextValue);
					}
					if (loopMeta.iterationKind === 'object' && loopMeta.entryKey != null) {
						const sourcePath = `${loopMeta.sourcePath}.${loopMeta.entryKey}${suffix}`;
						return component.state.set(sourcePath, nextValue);
					}
				}
				this._warn(`x-model inside x-for requires a writable array/object source path. Received: "${loopMeta.sourceExpr}"`);
			}
		}

		if (loopMeta?.indexVar && normalizedExpr === loopMeta.indexVar) {
			this._warn(`x-model cannot assign to loop index variable "${loopMeta.indexVar}"`);
			return nextValue;
		}

		if (this._isSimplePath(normalizedExpr)) {
			return component.state.set(normalizedExpr, nextValue);
		}

		try {
			
			
			const fn = new Function('__scope__', '__minix_value__',
				`with(__scope__) { ${normalizedExpr} = __minix_value__; return ${normalizedExpr}; }`);
			return fn(scope, nextValue);
		} catch (error) {
			this._warn(`Failed to assign x-model expression: ${expression}`, error);
			return nextValue;
		}
	}

	_compileModelDirective(el, expression, component, explicitModifiers = null) {

		const rawModifiers = explicitModifiers || (() => {
			const attrs = el.attributes || [];
			for (let i = 0; i < attrs.length; i++) {
				const name = attrs[i].name;
				if (name === 'x-model' || name.startsWith('x-model.')) return this._parseAttributeModifiers(name);
			}
			return [];
		})();
		const modifiers = new Set(rawModifiers);
		const valueModifiers = rawModifiers.length ? rawModifiers.filter((mod) => mod !== 'lazy') : [];

		const readStateValue = () => {
			if (this._isSimplePath(expression) && this._stateHasPath(component.state, expression)) {
				return component.state.get(expression);
			}
			return this._evaluate(expression, this.createScope(component, null, el), '');
		};

		let lastSyncedValue = Symbol('unset');
		let lastSyncedJSON = undefined;
		const sync = () => {
			const value = readStateValue();
			if (el.tagName === 'SELECT' && el.multiple) {
				const selected = Array.isArray(value) ? new Array(value.length) : [];
				for (let i = 0; i < selected.length; i++) selected[i] = String(value[i]);
				const json = selected.join('\u0001');
				if (json !== lastSyncedJSON) {
					lastSyncedJSON = json;
					const selectedSet = new Set(selected);
					for (let i = 0; i < el.options.length; i++) {
						el.options[i].selected = selectedSet.has(el.options[i].value);
					}
				}
			} else {
				if (Object.is(value, lastSyncedValue)) return;
				lastSyncedValue = value;
				if (el.type === 'checkbox') el.checked = Boolean(value);
				else if (el.type === 'radio') el.checked = el.value === value;
				else el.value = value ?? '';
			}
		};

		const stopEffect = this._effect(component, sync);

		
		
		if (el.tagName === 'SELECT' && el.multiple) {
			Promise.resolve().then(() => {
				if (el.isConnected) sync();
			});
		}
		const eventName = modifiers.has('lazy')
			? 'change'
			: (['checkbox', 'radio'].includes(el.type) || el.tagName === 'SELECT' ? 'change' : 'input');

		const _modelCtx = { el, expression, component, directive: 'x-model' };
		const stopListen = component.listener.$listen(el, eventName, (event) => {
			let nextValue;
			if (el.type === 'checkbox') nextValue = el.checked;
			else if (el.type === 'radio') { if (!el.checked) return; nextValue = el.value; }
			else if (el.tagName === 'SELECT' && el.multiple) {
				nextValue = new Array(el.selectedOptions.length);
				for (let i = 0; i < el.selectedOptions.length; i++) nextValue[i] = el.selectedOptions[i].value;
			}
			else nextValue = event.target.value;

			nextValue = this._applyModifiers(nextValue, valueModifiers, _modelCtx);
			this._setModelValue(expression, component, nextValue, el);
		});

		return () => { stopEffect(); stopListen(); };
	}

	_compileConditionalGroup(el, component) {
		const isConditional = (node) => node?.nodeType === Node.ELEMENT_NODE && (
			node.hasAttribute('x-if') || node.hasAttribute('x-else-if') || node.hasAttribute('x-else')
		);

		const branches = [];
		let cursor = el;
		while (isConditional(cursor)) {
			if (cursor.hasAttribute('x-if')) branches.push({ el: cursor, type: 'if', expression: cursor.getAttribute('x-if') });
			else if (cursor.hasAttribute('x-else-if')) branches.push({ el: cursor, type: 'else-if', expression: cursor.getAttribute('x-else-if') });
			else branches.push({ el: cursor, type: 'else', expression: null });
			cursor = this._nextMeaningfulSibling(cursor);
		}

		if (!branches.length || branches[0].el !== el || !branches[0].el.hasAttribute('x-if')) return () => { };

		const parent = el.parentNode;
		if (!parent) return () => { };

		const startAnchor = document.createComment('x-if-group-start');
		const scopeAnchor = parent;
		parent.insertBefore(startAnchor, el);

		// Determine the end anchor insertion reference BEFORE branches are removed
		// from the DOM. cursor is the first non-conditional sibling after the group;
		// if it sits in the same parent we insert before it, otherwise we append.
		const endAnchorRef = (cursor && cursor.parentNode === parent) ? cursor : null;
		const endAnchor = document.createComment('x-if-group-end');
		parent.insertBefore(endAnchor, endAnchorRef);

		const templates = branches.map((branch) => {
			const template = branch.el.cloneNode(true);
			template.removeAttribute('x-if');
			template.removeAttribute('x-else-if');
			template.removeAttribute('x-else');
			branch.el.remove();
			// Pre-compile the branch condition getter so the reactive effect
			// only calls getter(scope) instead of _evaluate(expr, scope) on every update.
			const getter = branch.expression ? this._compileGetter(branch.expression) : null;
			return { ...branch, template, getter };
		});

		let mounted = { index: -1, nodes: [], cleanup: null };

		const clearMounted = () => {
			if (mounted.cleanup) mounted.cleanup();
			for (const node of mounted.nodes) {
				this._destroyMountedChildrenInSubtree(component, node);
				if (node.parentNode) node.parentNode.removeChild(node);
			}
			mounted = { index: -1, nodes: [], cleanup: null };
		};

		const compileBranchNode = (node) => {
			if (node.nodeType !== Node.ELEMENT_NODE) return null;
			const directives = this._collectDirectives(node);
			const structural = directives.find((entry) => entry.structural);
			if (!structural) return this.compile(node, component);

			const cleanups = [];
			if (structural.name !== 'x-for') {
				for (const directive of directives) {
					if (!directive.structural) cleanups.push(directive.run(component, node));
				}
			}
			cleanups.push(structural.run(component, node));
			return () => { for (const cleanup of cleanups) cleanup?.(); };
		};

		const stopEffect = this._effect(component, () => {
			let nextIndex = -1;
			for (let i = 0; i < templates.length; i++) {
				const branch = templates[i];
				if (branch.type === 'else') {
					nextIndex = i;
					break;
				}
				const passed = Boolean(branch.getter
					? branch.getter(this.createScope(component, null, scopeAnchor), false)
					: false);
				if (passed) {
					nextIndex = i;
					break;
				}
			}

			if (mounted.index === nextIndex) return;

			clearMounted();

			if (nextIndex === -1) return;

			const nextBranch = templates[nextIndex];
			const template = nextBranch.template;
			const isTemplate = template.tagName === 'TEMPLATE';
			const clone = isTemplate ? template.content.cloneNode(true) : template.cloneNode(true);
			const nodes = isTemplate ? [...clone.childNodes] : [clone];
			// Insert immediately before the anchor so new nodes sit in the correct
			// DOM position. Inserting after anchor.nextSibling would push content
			// past any existing sibling that follows the anchor.
			endAnchor.parentNode.insertBefore(clone, endAnchor);
			const cleanups = [];
			for (const node of nodes) {
				const cleanup = compileBranchNode(node);
				if (cleanup) cleanups.push(cleanup);
			}
			mounted = {
				index: nextIndex,
				nodes,
				cleanup: () => { for (const cleanup of cleanups) cleanup?.(); }
			};
		});

		return () => {
			stopEffect?.();
			clearMounted();
			endAnchor.remove();
			startAnchor.remove();
		};
	}

	_compileIfDirective(el, expression, component) {
		return this._compileConditionalGroup(el, component);
	}

	_compileClassDirective(el, expression, component) {
		const getter = this._compileGetter(expression);
		let lastClassJson = undefined;
		return this._effect(component, () => {
			const scope = this.createScope(component, null, el);
			const value = getter(scope, {});
			let json; try { json = JSON.stringify(value); } catch (_) { json = String(value); }
			if (json === lastClassJson) return;
			lastClassJson = json;
			MiniX_Compiler._patchClassValue(el, value);
		});
	}

	_compileAttrDirective(el, expression, component) {
		const getter = this._compileGetter(expression);
		let lastAttrJson = undefined;
		return this._effect(component, () => {
			const attrs = getter(this.createScope(component, null, el), {});
			let json; try { json = JSON.stringify(attrs); } catch (_) { json = String(attrs); }
			if (json === lastAttrJson) return;
			lastAttrJson = json;
			MiniX_Compiler._patchAttrMap(el, attrs);
		});
	}

	_compileRefDirective(el, expression, component) {
		const name = String(expression || '').trim();
		if (!name) {
			this._warn('x-ref requires a non-empty name');
			return () => { };
		}
		if (!component.instance.$refs) component.instance.$refs = {};

		const isInFor = Boolean(component.__minix_loop_state__?.meta) || !!el.closest('[x-for]');
		if (isInFor) {
			if (!Array.isArray(component.instance.$refs[name])) component.instance.$refs[name] = [];
			component.instance.$refs[name].push(el);
			return () => {
				const arr = component.instance.$refs?.[name];
				if (!Array.isArray(arr)) return;
				component.instance.$refs[name] = arr.filter((entry) => entry !== el);
				if (!component.instance.$refs[name].length) delete component.instance.$refs[name];
			};
		}

		component.instance.$refs[name] = el;
		return () => {
			if (component.instance.$refs?.[name] === el) delete component.instance.$refs[name];
		};
	}

	_compileInitDirective(el, expression, component) {
		if (el.hasAttribute('x-ignore') || el.closest?.('[x-ignore]')) return () => { };
		try {
			const scope = this.createScope(component, { $el: el, el }, el);
			const fn = new Function('__scope__', `with(__scope__) { ${expression} }`);
			fn(scope);
		} catch (error) {
			this._warn(`x-init failed: ${expression}`, error);
		}
		return () => { };
	}

	_compileFocusDirective(el, expression, component) {
		const getter = this._compileGetter(expression);
		let wasFocused = false;
		return this._effect(component, () => {
			const shouldFocus = Boolean(getter(this.createScope(component, null, el), false));
			if (shouldFocus && !wasFocused) {
				Promise.resolve().then(() => el.focus?.());
				wasFocused = true;
			} else if (!shouldFocus) {
				wasFocused = false;
			}
		});
	}

	_compileDisabledDirective(el, expression, component) {
		const getter = this._compileGetter(expression);
		let lastDisabled = undefined;
		return this._effect(component, () => {
			const disabled = Boolean(getter(this.createScope(component, null, el), false));
			if (disabled === lastDisabled) return;
			lastDisabled = disabled;
			if (disabled) {
				el.setAttribute('disabled', '');
				if ('disabled' in el) el.disabled = true;
			} else {
				el.removeAttribute('disabled');
				if ('disabled' in el) el.disabled = false;
			}
		});
	}

	_compileStyleDirective(el, expression, component) {
		const getter = this._compileGetter(expression);
		let lastStyleJson = undefined;
		return this._effect(component, () => {
			const styles = getter(this.createScope(component, null, el), {});
			let json; try { json = JSON.stringify(styles); } catch (_) { json = String(styles); }
			if (json === lastStyleJson) return;
			lastStyleJson = json;
			MiniX_Compiler._patchStyleValue(el, styles);
		});
	}

	_compileValueDirective(el, expression, component) {
		const getter = this._compileGetter(expression);
		let lastValue = Symbol('unset');
		return this._effect(component, () => {
			const value = getter(this.createScope(component, null, el), '');
			const next = value == null ? '' : String(value);
			if (next === lastValue) return;
			lastValue = next;
			el.value = next;
		});
	}

	_compileCloakDirective(el) {
		el.removeAttribute('x-cloak');
		return () => { };
	}

	_compileIgnoreDirective(el) {
		el.__minix_ignore__ = true;
		return () => { };
	}

	_compileTransitionDirective(el, expression, component) {
		const opts = expression ? this._evaluate(expression, this.createScope(component, null, el), {}) : {};
		const enterClass = opts.enter || 'x-enter';
		const leaveClass = opts.leave || 'x-leave';
		const duration = typeof opts.duration === 'number' ? opts.duration : 300;
		let cancelTimer = null;

		const clearTimer = () => {
			if (cancelTimer) { cancelTimer(); cancelTimer = null; }
		};

		el.__minix_transition__ = {
			toggle: (visible, originalDisplay = '') => {
				clearTimer();
				if (visible) {
					el.style.display = originalDisplay;
					el.classList.remove(leaveClass);
					el.classList.add(enterClass);
					cancelTimer = component.listener.$timeout(() => {
						el.classList.remove(enterClass);
						cancelTimer = null;
					}, duration);
				} else {
					el.classList.remove(enterClass);
					el.classList.add(leaveClass);
					cancelTimer = component.listener.$timeout(() => {
						el.classList.remove(leaveClass);
						el.style.display = 'none';
						cancelTimer = null;
					}, duration);
				}
			}
		};

		return () => {
			clearTimer();
			delete el.__minix_transition__;
		};
	}

	_compileOnceDirective(el, expression, component) {
		
		
		
		const scope = this.createScope(component, null, el);
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		while (walker.nextNode()) {
			const node = walker.currentNode;
			if (node.textContent.includes('{{')) {
				node.textContent = component.renderer.interpolate(node.textContent, scope);
			}
		}
		el.setAttribute('data-x-once', '');
		el.__minix_once__ = true;
		return () => {
			el.removeAttribute('data-x-once');
			delete el.__minix_once__;
		};
	}

	_resolvePortalTarget(expression, component, el = null) {
		const targetExpr = this._evaluate(expression, this.createScope(component, null, el || component.root), null);
		if (!targetExpr) return null;
		return typeof targetExpr === 'string'
			? document.querySelector(targetExpr)
			: (targetExpr instanceof Element ? targetExpr : null);
	}

	_compileTeleportDirective(el, expression, component) {
		const originalParent = el.parentNode;
		const placeholder = document.createComment('x-teleport');
		originalParent?.replaceChild(placeholder, el);

		let currentTarget = null;
		const stopEffect = this._effect(component, () => {
			const target = this._resolvePortalTarget(expression, component, el);
			if (!target) {
				this._warn(`x-teleport: target not found for "${expression}"`);
				return;
			}
			if (currentTarget === target && target.contains(el)) return;
			if (el.parentNode && el.parentNode !== target) el.parentNode.removeChild(el);
			target.appendChild(el);
			currentTarget = target;
		});

		return () => {
			stopEffect?.();
			if (placeholder.parentNode) {
				if (el.parentNode && el.parentNode !== placeholder.parentNode) el.parentNode.removeChild(el);
				if (!el.parentNode) placeholder.parentNode.replaceChild(el, placeholder);
				else if (placeholder.parentNode) placeholder.parentNode.removeChild(placeholder);
			} else if (currentTarget?.contains(el)) {
				currentTarget.removeChild(el);
			}
		};
	}

	_compilePortalDirective(el, expression, component) {
		const stopTeleport = this._compileTeleportDirective(el, expression, component);

		const portalAttr = el.getAttribute('x-portal');
		const teleportAttr = el.getAttribute('x-teleport');
		el.removeAttribute('x-portal');
		el.removeAttribute('x-teleport');

		const stopSubtree = this.compile(el, component);

		if (portalAttr != null) el.setAttribute('x-portal', portalAttr);
		if (teleportAttr != null) el.setAttribute('x-teleport', teleportAttr);

		return () => {
			stopSubtree?.();
			stopTeleport?.();
		};
	}

	_compileScopedDataDirective(el, expression, component) {
		let scopedState;
		try {
			const raw = this._evaluate(expression, this.createScope(component, null, el), {});
			scopedState = new MiniX_State(raw || {});
		} catch (e) {
			this._warn(`x-data failed: ${expression}`, e);
			return () => { };
		}

		el.__minix_scoped_state__ = scopedState;

		// Walk from el itself (not el.parentElement) so we pick up a scope
		// provider stamped directly on the loop-row root node by x-for.
		const parentProvider = (() => {
			let cursor = el;
			while (cursor) {
				// Skip our own el on the second+ iteration — we only want el on the
				// first pass because x-for stamps the provider *on* the row root.
				if (cursor !== el || typeof cursor.__minix_scope_provider__ === 'function') {
					if (typeof cursor.__minix_scope_provider__ === 'function') return cursor.__minix_scope_provider__;
				}
				cursor = cursor.parentElement;
			}
			return null;
		})();

		let cachedScope = null;
		const scopeProvider = () => {
			if (cachedScope) return cachedScope;
			const parentScope = parentProvider ? parentProvider() : component._createRenderScope();
			const scopedRaw = scopedState.raw();
			const scope = Object.create(parentScope);
			for (const key of Object.keys(scopedRaw.__raw || scopedRaw)) {
				Object.defineProperty(scope, key, {
					get: () => scopedState.get(key),
					set: (v) => scopedState.set(key, v),
					enumerable: true,
					configurable: true
				});
			}
			scope.$state = scopedState.raw();
			cachedScope = scope;
			return scope;
		};
		// Invalidate the cached scope whenever scoped state keys change shape.
		const unscopedWatch = scopedState.watch('', () => { cachedScope = null; });

		el.__minix_scope_provider__ = scopeProvider;

		// Stamp the provider on all children so they can access the scoped state
		const children = el.childNodes || [];
		for (let i = 0; i < children.length; i++) {
			this._stampScopeProviderSubtree(children[i], scopeProvider);
		}

		const scopedDataAttr = el.getAttribute('x-data');
		el.removeAttribute('x-data');
		el.__minix_skip_root_directives__ = true;
		const subtreeCleanup = this.compile(el, component);
		delete el.__minix_skip_root_directives__;
		if (scopedDataAttr != null) el.setAttribute('x-data', scopedDataAttr);

		return () => {
			subtreeCleanup?.();
			unscopedWatch?.();
			if (el.__minix_scope_provider__ === scopeProvider) delete el.__minix_scope_provider__;
			delete el.__minix_scoped_state__;
		};
	}

	_compileSlotDirective(el, expression, component) {
		const slotName = (expression || 'default').trim();
		let cursor = el.parentElement;
		while (cursor) {
			if (cursor.hasAttribute('x-component')) {
				el.setAttribute('data-slot', slotName);
				return () => { };
			}
			cursor = cursor.parentElement;
		}
		this._warn(`x-slot="${slotName}" used outside x-component host`);
		return () => { };
	}

	_projectSlots(hostEl, childRoot) {
		const slots = hostEl?.__minix_slots__ || {};
		const copyScopeProviders = (source, clone) => {
			if (!source || !clone) return clone;
			if (source.__minix_scope_provider__ && clone.nodeType === Node.ELEMENT_NODE) {
				clone.__minix_scope_provider__ = source.__minix_scope_provider__;
			}
			const srcChildren = source.childNodes ? [...source.childNodes] : [];
			const cloneChildren = clone.childNodes ? [...clone.childNodes] : [];
			for (let i = 0; i < Math.min(srcChildren.length, cloneChildren.length); i++) {
				copyScopeProviders(srcChildren[i], cloneChildren[i]);
			}
			return clone;
		};

		const slotTargets = [
			...(childRoot?.matches?.('slot, [x-slot-target]') ? [childRoot] : []),
			...childRoot.querySelectorAll('slot, [x-slot-target]')
		];
		for (const target of slotTargets) {
			const name = target.getAttribute('name') || target.getAttribute('x-slot-target') || 'default';
			const content = slots[name];
			if (content && content.length) {
				target.replaceWith(...content.map((node) => copyScopeProviders(node, node.cloneNode(true))));
			} else if (target.tagName === 'SLOT') {
				target.replaceWith(...[...target.childNodes]);
			}
		}
	}

	_stampScopeProviderSubtree(node, scopeProvider) {
		if (!node || node.nodeType !== Node.ELEMENT_NODE || typeof scopeProvider !== 'function') return;
		node.__minix_scope_provider__ = scopeProvider;
		const children = node.childNodes || [];
		for (let i = 0; i < children.length; i++) {
			this._stampScopeProviderSubtree(children[i], scopeProvider);
		}
	}

	_createLoopBlockHost(component) {
		let proto = MiniX_Compiler._loopComponentProtoCache.get(component);
		if (proto) return proto;

		proto = Object.create(null);
		proto.renderer = component.renderer;
		proto.compiler = component.compiler;
		proto.listener = component.listener;
		proto.state = component.state;
		proto.props = component.props;
		proto.parent = component;
		
		
		
		Object.defineProperty(proto, 'root', { get: () => component.root, enumerable: true, configurable: true });
		Object.defineProperty(proto, 'children', { get: () => component.children, enumerable: true, configurable: true });
		Object.defineProperty(proto, 'instance', { get: () => component.instance, enumerable: true, configurable: true });
		proto.localComponents = component.localComponents;
		proto.eventBus = component.eventBus;
		proto.sanitizer = component.sanitizer;
		
		
		
		
		
		
		proto._callHook = () => { };
		proto._resolveComponentName = (...args) => component._resolveComponentName(...args);
		proto._syncChildrenArray = () => { };
		proto.mountChild = (...args) => component.mountChild(...args);

		MiniX_Compiler._loopComponentProtoCache.set(component, proto);
		return proto;
	}


	_isSimpleLoopTemplate(template) {
		
		const childNodes = template.content.childNodes;
		const roots = [];
		for (let i = 0; i < childNodes.length; i++) {
			const n = childNodes[i];
			if (n.nodeType === Node.ELEMENT_NODE || (n.nodeType === Node.TEXT_NODE && n.textContent.trim())) roots.push(n);
		}
		if (roots.length !== 1) return false;
		const root = roots[0];
		if (root.nodeType !== Node.ELEMENT_NODE) return false;
		const stack = [root];
		while (stack.length) {
			const node = stack.pop();
			if (node.nodeType !== Node.ELEMENT_NODE) continue;
			if (this._collectDirectives(node).length) return false;
			for (const attr of node.attributes) {
				if (attr.name.startsWith('@') || attr.name.startsWith(':') || attr.name.startsWith('x-')) return false;
			}
			for (const child of node.childNodes) {
				if (child.nodeType === Node.COMMENT_NODE) return false;
				if (child.nodeType === Node.ELEMENT_NODE) stack.push(child);
			}
		}
		return true;
	}


	_getFastLoopSingleExprRegex() {
		if (!this._fastLoopSingleExprRegex) {
			const openTag = this.options?.openTag || '{{';
			const closeTag = this.options?.closeTag || '}}';
			const escapedOpen = openTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			const escapedClose = closeTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			this._fastLoopSingleExprRegex = new RegExp(`^\\s*${escapedOpen}\\s*(.+?)\\s*${escapedClose}\\s*$`);
		}
		return this._fastLoopSingleExprRegex;
	}

	_getDedicatedFastLoopMeta(template, templateMeta = null) {
		templateMeta = templateMeta || this._getLoopTemplateMeta(template);
		if (templateMeta.fastDedicated !== undefined) return templateMeta.fastDedicated;
		const roots = [...template.content.childNodes].filter((node) =>
			node.nodeType === Node.ELEMENT_NODE || (node.nodeType === Node.TEXT_NODE && node.textContent.trim())
		);
		let meta = null;
		if (roots.length === 1 && roots[0].nodeType === Node.ELEMENT_NODE) {
			const root = roots[0];
			const onlyTextChildren = [...root.childNodes].every((child) => child.nodeType === Node.TEXT_NODE);
			const hasNestedElements = [...root.childNodes].some((child) => child.nodeType === Node.ELEMENT_NODE);
			const hasDynamicAttrs = [...root.attributes].some((attr) => attr.name.startsWith('@') || attr.name.startsWith(':') || attr.name.startsWith('x-'));
			const bindings = templateMeta.simpleBindings || [];
			if (onlyTextChildren && !hasNestedElements && !hasDynamicAttrs && bindings.length === 1) {
				const templateText = String(bindings[0].template || '').trim();
				const singleExprMatch = templateText.match(this._getFastLoopSingleExprRegex());
				if (singleExprMatch) {
					const expr = singleExprMatch[1].trim();
					meta = {
						tagName: root.tagName,
						namespaceURI: root.namespaceURI || null,
						attrs: [...root.attributes].map((attr) => [attr.name, attr.value]),
						getter: this._compileGetter(expr),
						expression: expr,
						emptyText: '',
						className: root.className || '',
						path: bindings[0].path,
						hasSingleTextNode: root.childNodes.length === 1 && root.firstChild?.nodeType === Node.TEXT_NODE
					};
				}
			}
		}
		templateMeta.fastDedicated = meta;
		return meta;
	}

	
	
	
	
	

	_vdomMount(fastMeta, text) {
		
		const el = fastMeta.namespaceURI && fastMeta.namespaceURI !== 'http://www.w3.org/1999/xhtml'
			? document.createElementNS(fastMeta.namespaceURI, fastMeta.tagName)
			: document.createElement(fastMeta.tagName.toLowerCase());
		for (const [name, value] of fastMeta.attrs) el.setAttribute(name, value);
		el.textContent = text;
		return el;
	}

	_compileDedicatedFastForDirective(marker, template, expression, vars, sourceExpr, keyAttr, component, connectedScopeAnchor, el) {
		const templateMeta = this._getLoopTemplateMeta(template);
		const fastMeta = this._getDedicatedFastLoopMeta(template, templateMeta);
		if (!fastMeta) return null;
		const endMarker = document.createComment('x-for-end');
		marker.parentNode?.insertBefore(endMarker, marker.nextSibling);

		const resolveScopeAnchor = () => marker.parentNode || connectedScopeAnchor || el;
		const sourceGetter = this._compileGetter(sourceExpr);
		const keyGetter = keyAttr ? this._compileGetter(keyAttr) : null;
		const sourceIsSimplePath = this._isSimplePath(sourceExpr);
		const sourcePath = sourceIsSimplePath ? this._parseSimplePathSegments(sourceExpr) : null;

		const renderScope = Object.create(null);
		const keyScope = Object.create(null);
		const exprText = String(fastMeta.expression || fastMeta.getter?.__minix_expr__ || '');
		const directTextExpr = (() => {
			const parts = this._isSimplePath(exprText) ? this._parseSimplePathSegments(exprText) : null;
			if (parts && parts.length >= 2 && parts[0] === vars[0]) return parts.slice(1);
			return null;
		})();
		const directKeyExpr = (() => {
			if (!keyAttr) return null;
			const expr = String(keyAttr).trim();
			const parts = this._isSimplePath(expr) ? this._parseSimplePathSegments(expr) : null;
			if (parts && parts.length >= 2 && parts[0] === vars[0]) return parts.slice(1);
			return null;
		})();
		const exactStaticRowFastPath = Boolean(sourcePath && directTextExpr && (!keyAttr || directKeyExpr) && !vars[1] && !vars[2]);
		const staticNodeFactory = (() => {
			const proto = fastMeta.namespaceURI && fastMeta.namespaceURI !== 'http://www.w3.org/1999/xhtml'
				? document.createElementNS(fastMeta.namespaceURI, fastMeta.tagName)
				: document.createElement(fastMeta.tagName.toLowerCase());
			for (const [name, value] of fastMeta.attrs) proto.setAttribute(name, value);
			if (fastMeta.hasSingleTextNode) proto.appendChild(document.createTextNode(''));
			return () => proto.cloneNode(true);
		})();

		let oldVnodes = [];
		const keyMap = new Map();

		const loopMeta = {
			sourceExpr,
			sourcePath: sourceIsSimplePath ? sourceExpr : null,
			index: 0,
			itemVar: vars[0],
			indexVar: vars[1] || '$index',
			keyVar: vars[1] || null,
			iterationKind: 'array',
			entryKey: undefined
		};

		const readByPath = (obj, segments) => {
			let cur = obj;
			for (let i = 0; i < segments.length; i++) {
				if (cur == null) return '';
				cur = cur[segments[i]];
			}
			return cur;
		};
		const readSourceList = (scope) => sourcePath ? readByPath(scope, sourcePath) : sourceGetter(scope, []);
		const buildEntries = (list) => {
			if (typeof list === 'number' && Number.isFinite(list) && list > 0) {
				const len = Math.floor(list);
				const entries = new Array(len);
				for (let i = 0; i < len; i++) entries[i] = { value: i + 1, key: i, index: i, kind: 'array' };
				return entries;
			}
			if (Array.isArray(list)) {
				const entries = new Array(list.length);
				for (let index = 0; index < list.length; index++) {
					entries[index] = { value: list[index], key: index, index, kind: 'array' };
				}
				return entries;
			}
			if (list instanceof Map) {
				const entries = [];
				let index = 0;
				for (const [entryKey, value] of list) {
					entries.push({ value, key: entryKey, index: index++, kind: 'map' });
				}
				return entries;
			}
			if (list instanceof Set) {
				const entries = [];
				let index = 0;
				for (const value of list) {
					entries.push({ value, key: index, index, kind: 'set' });
					index++;
				}
				return entries;
			}
			if (list && typeof list[Symbol.iterator] === 'function' && typeof list !== 'string') {
				const entries = [];
				let index = 0;
				for (const value of list) {
					entries.push({ value, key: index, index, kind: 'iterable' });
					index++;
				}
				return entries;
			}
			if (list && typeof list === 'object') {
				const entries = [];
				let index = 0;
				for (const entryKey in list) {
					if (!Object.hasOwn(list, entryKey)) continue;
					entries.push({ value: list[entryKey], key: entryKey, index: index++, kind: 'object' });
				}
				return entries;
			}
			return [];
		};
		const writeNodeText = (elNode, text) => {
			if (fastMeta.hasSingleTextNode && elNode.firstChild) elNode.firstChild.data = text;
			else elNode.textContent = text;
		};
		const stampLoopScope = (entry) => {
			const loopKeyOrIndex = (entry.kind === 'object' || entry.kind === 'map') ? entry.key : entry.index;
			loopMeta.index = entry.index;
			loopMeta.iterationKind = entry.kind;
			loopMeta.entryKey = entry.key;
			renderScope[vars[0]] = entry.value;
			renderScope.$index = entry.index;
			renderScope.__minix_loop_meta = loopMeta;
			if (vars[1]) renderScope[vars[1]] = loopKeyOrIndex;
			if (vars[2]) renderScope[vars[2]] = entry.index;
		};
		const readItemText = exactStaticRowFastPath
			? (entry) => readByPath(entry.value, directTextExpr)
			: (entry) => {
				stampLoopScope(entry);
				return directTextExpr ? readByPath(entry.value, directTextExpr) : fastMeta.getter(renderScope, '');
			};
		const readItemKey = !keyAttr
			? ((entry) => entry.key)
			: exactStaticRowFastPath
				? ((entry) => {
					const key = readByPath(entry.value, directKeyExpr);
					return key == null ? entry.index : key;
				})
				: ((entry) => {
					if (directKeyExpr) {
						const key = readByPath(entry.value, directKeyExpr);
						return key == null ? entry.index : key;
					}
					stampLoopScope(entry);
					Object.setPrototypeOf(keyScope, renderScope);
					return keyGetter ? keyGetter(keyScope, entry.index) : entry.index;
				});

		// Two alternating vnode buffers — avoids new Array(len) on every render cycle.
		let bufA = [];
		let bufB = [];
		let newVnodesBuffer = bufB;

		const stopEffect = this._effect(component, () => {
			const runBaseScope = this.createScope(component, null, marker.parentNode || resolveScopeAnchor());
			Object.setPrototypeOf(renderScope, runBaseScope);

			const list = readSourceList(runBaseScope) || [];
			const entries = buildEntries(list);
			const len = entries.length;
			const parentNode = marker.parentNode;
			const seenKeys = new Set();

			if (!oldVnodes.length && len > 0 && parentNode) {
				const frag = document.createDocumentFragment();
				const coldVnodes = [];
				for (let index = 0; index < len; index++) {
					const entry = entries[index];
					const key = readItemKey(entry);
					if (seenKeys.has(key)) {
						this._warn(`Duplicate x-for key "${String(key)}" at index ${index}. Keys must be unique and stable.`);
						continue;
					}
					seenKeys.add(key);
					const rawText = readItemText(entry);
					const text = rawText == null ? '' : String(rawText);
					const elNode = staticNodeFactory();
					writeNodeText(elNode, text);
					const vnode = { key, text, _nextText: text, el: elNode, _seen: false };
					coldVnodes.push(vnode);
					keyMap.set(key, vnode);
					frag.appendChild(elNode);
				}
				oldVnodes = coldVnodes;
				parentNode.insertBefore(frag, this._resolveInsertionReference(parentNode, endMarker));
				return;
			}

			const newVnodes = newVnodesBuffer;
			newVnodes.length = 0;
			for (let index = 0; index < len; index++) {
				const entry = entries[index];
				const key = readItemKey(entry);
				if (seenKeys.has(key)) {
					this._warn(`Duplicate x-for key "${String(key)}" at index ${index}. Keys must be unique and stable.`);
					continue;
				}
				seenKeys.add(key);
				const rawText = readItemText(entry);
				const text = rawText == null ? '' : String(rawText);
				const existing = keyMap.get(key);
				if (existing) {
					existing._seen = true;
					existing._nextText = text;
					newVnodes.push(existing);
				} else {
					newVnodes.push({ key, text, _nextText: text, el: null, _seen: true });
				}
			}

			if (oldVnodes.length) {
				for (let i = 0; i < oldVnodes.length; i++) {
					const ov = oldVnodes[i];
					if (!ov._seen) {
						ov.el?.remove();
						keyMap.delete(ov.key);
					}
				}
			}

			const nextLen = newVnodes.length;
			for (let i = 0; i < nextLen; i++) {
				const vn = newVnodes[i];
				if (vn.el === null) {
					const elNode = staticNodeFactory();
					writeNodeText(elNode, vn._nextText);
					vn.el = elNode;
					vn.text = vn._nextText;
					keyMap.set(vn.key, vn);
				} else if (vn._nextText !== vn.text) {
					writeNodeText(vn.el, vn._nextText);
					vn.text = vn._nextText;
				}
			}

			if (parentNode) {
				// Reuse a module-level move-batch buffer to avoid [] allocation per render.
				const batch = MiniX_Compiler._domMoveBatch;
				batch.length = 0;
				let batchRef = null;
				const flushBatch = () => {
					if (!batch.length) return;
					const frag = document.createDocumentFragment();
					for (let bi = 0; bi < batch.length; bi++) frag.appendChild(batch[bi]);
					parentNode.insertBefore(frag, this._resolveInsertionReference(parentNode, batchRef));
					batch.length = 0;
					batchRef = null;
				};
				for (let i = nextLen - 1; i >= 0; i--) {
					const vn = newVnodes[i];
					const ref = i + 1 < nextLen ? newVnodes[i + 1].el : endMarker;
					const liveRef = ref && ref.parentNode === parentNode ? ref : endMarker;
					if (vn.el.nextSibling === liveRef) {
						flushBatch();
						continue;
					}
					if (batchRef === null) batchRef = liveRef;
					if (liveRef !== batchRef) flushBatch(), batchRef = liveRef;
					batch.unshift(vn.el);
				}
				flushBatch();
			}

			for (let i = 0; i < oldVnodes.length; i++) oldVnodes[i]._seen = false;
			for (let i = 0; i < newVnodes.length; i++) newVnodes[i]._seen = false;
			// Swap buffers: newVnodes becomes oldVnodes, and the old oldVnodes buffer
			// becomes the scratch buffer for the next render.
			oldVnodes = newVnodes;
			newVnodesBuffer = (newVnodesBuffer === bufB) ? bufA : bufB;
		});

		return () => {
			stopEffect?.();
			for (const vn of oldVnodes) vn.el?.remove();
			keyMap.clear();
			oldVnodes = [];
			endMarker.remove();
			marker.remove();
		};
	}

	_getLoopTemplateMeta(template) {
		
		
		let meta = MiniX_Compiler._loopTemplateMetaWeakCache.get(template);
		if (meta) return meta;

		const isSimple = this._isSimpleLoopTemplate(template);
		meta = {
			isSimple,
			simpleBindings: isSimple ? this._collectLoopTextBindings([...template.content.childNodes]) : null,
			plan: null
		};

		MiniX_Compiler._loopTemplateMetaWeakCache.set(template, meta);
		return meta;
	}

	_collectLoopTextBindings(contentNodes) {
		const bindings = [];
		const visit = (node, path) => {
			if (node.nodeType === Node.TEXT_NODE) {
				const template = node.textContent;
				if (template && template.includes('{{')) bindings.push({ path: path.slice(), template, compiled: this.renderer ? this.renderer._compileInterpolationTemplate(template) : null });
				return;
			}
			if (node.nodeType !== Node.ELEMENT_NODE) return;
			let childIndex = 0;
			for (const child of node.childNodes) {
				path.push(childIndex++);
				visit(child, path);
				path.pop();
			}
		};
		for (let _ci = 0; _ci < contentNodes.length; _ci++) visit(contentNodes[_ci], [_ci]);
		return bindings;
	}

	_resolveLoopPathNode(contentNodes, path = []) {
		let node = contentNodes[path[0]];
		for (let i = 1; i < path.length && node; i++) node = node.childNodes[path[i]];
		return node || null;
	}

	_extractBindingDepMask(expression, bitByKey, fullMask) {
		const expr = String(expression || '').trim();
		if (!expr) return 0;
		if (this._isSimplePath(expr)) {
			
			const dotIdx = expr.indexOf('.');
			const brackIdx = expr.indexOf('[');
			const end = dotIdx === -1 ? (brackIdx === -1 ? expr.length : brackIdx) : (brackIdx === -1 ? dotIdx : Math.min(dotIdx, brackIdx));
			const root = end === expr.length ? expr : expr.slice(0, end);
			return bitByKey.get(root) || fullMask;
		}
		return fullMask;
	}

	_extractCompiledDepMask(compiled, bitByKey, fullMask) {
		if (!compiled?.parts?.length) return fullMask;
		let mask = 0;
		for (const part of compiled.parts) {
			if (part.type !== 'expr') continue;
			mask |= this._extractBindingDepMask(part.expr || part.raw || '', bitByKey, fullMask);
			if (mask === fullMask) return fullMask;
		}
		return mask || fullMask;
	}

	_buildGenericLoopBlueprint(template) {
		const blueprint = {
			textBindings: [],
			updates: [],
			setups: [],
			unsupported: false
		};
		blueprint.singleTextFastPath = false;
		const visit = (node, path = []) => {
			if (node.nodeType === Node.TEXT_NODE) {
				const raw = node.textContent || '';
				if (raw.includes('{{')) blueprint.textBindings.push({ path: path.slice(), compiled: this.renderer._compileInterpolationTemplate(raw) });
				return;
			}
			if (node.nodeType !== Node.ELEMENT_NODE) return;
			const directives = this._collectDirectives(node);
			for (const directive of directives) {
				const normalized = this._normalizeDirectiveName(directive.name);
				if (directive.structural || normalized === 'x-component' || normalized === 'x-portal' || normalized === 'x-teleport' || normalized === 'x-if' || normalized === 'x-else' || normalized === 'x-else-if' || normalized === 'x-for' || normalized === 'x-data' || normalized === 'x-slot') {
					blueprint.unsupported = true;
					return;
				}
				if (normalized === 'x-ignore' || normalized === 'x-ref' || normalized === 'x-init' || normalized === 'x-cloak' || normalized === 'x-transition' || normalized === 'x-once' || normalized === 'x-model' || directive.kind === 'event') {
					blueprint.setups.push({ path: path.slice(), directive });
					continue;
				}
				if (normalized === 'x-bind') {
					const rawName = String(directive.name || '');
					const targetAttr = rawName.startsWith(':') ? rawName.slice(1).split('.')[0] : rawName.slice(7).split('.')[0];
					blueprint.updates.push({ path: path.slice(), type: 'bind', targetAttr, expression: directive.expression, getter: this._compileGetter(directive.expression), modifiers: directive.modifiers || [] });
					continue;
				}
				if (normalized === 'x-text' || normalized === 'x-html' || normalized === 'x-show' || normalized === 'x-class' || normalized === 'x-style' || normalized === 'x-attr' || normalized === 'x-focus' || normalized === 'x-disabled' || normalized === 'x-value') {
					blueprint.updates.push({ path: path.slice(), type: normalized.slice(2), expression: directive.expression, getter: this._compileGetter(directive.expression), modifiers: directive.modifiers || [] });
					continue;
				}
				blueprint.unsupported = true;
				return;
			}
			if (blueprint.unsupported) return;
			let childIndex = 0;
			for (const child of node.childNodes) {
				path.push(childIndex++);
				visit(child, path);
				path.pop();
				if (blueprint.unsupported) return;
			}
		};
		const _tplNodes = template.content.childNodes;
		for (let _ti = 0; _ti < _tplNodes.length; _ti++) visit(_tplNodes[_ti], [_ti]);
		blueprint.singleTextFastPath = !blueprint.unsupported && blueprint.setups.length === 0 && blueprint.textBindings.length === 1 && blueprint.updates.length === 0;
		return blueprint;
	}

	_getGenericLoopBlueprint(template, templateMeta = null) {
		if (templateMeta?.blueprint) return templateMeta.blueprint;
		const blueprint = this._buildGenericLoopBlueprint(template);
		if (templateMeta) templateMeta.blueprint = blueprint;
		return blueprint;
	}

	_createBlueprintLoopBlock(template, component, extra, key, hostEl = null, blueprint = null) {
		const childFragment = template.content.cloneNode(true);
		const contentNodes = [];
		let _bn = childFragment.firstChild;
		while (_bn) { contentNodes.push(_bn); _bn = _bn.nextSibling; }
		const start = document.createComment(`x-for-start:${String(key)}`);
		const end = document.createComment(`x-for-end:${String(key)}`);
		const nodes = [start];
		for (let _ci = 0; _ci < contentNodes.length; _ci++) nodes.push(contentNodes[_ci]);
		nodes.push(end);
		const loopScope = Object.assign(Object.create(null), extra);
		const parentScope = typeof component._createRenderScope === 'function'
			? component._createRenderScope()
			: this.createScope(component, null, hostEl || component.root);
		const loopBaseScope = Object.create(parentScope);
		const renderScope = Object.create(loopBaseScope);
		// Compute once — reused for both renderKeys and scopeKeys below.
		const initialKeys = Object.keys(loopScope);
		let renderKeys = initialKeys;
		for (const k of initialKeys) renderScope[k] = loopScope[k];

		const runtimeComponent = {
			renderer: component.renderer,
			compiler: component.compiler,
			listener: component.listener,
			state: component.state,
			props: component.props,
			parent: component,
			root: component.root,
			instance: component.instance,
			localComponents: component.localComponents,
			eventBus: component.eventBus,
			sanitizer: component.sanitizer,
			children: component.children,
			_effects: new Set(),
			_childRecords: new Map(),
			_createRenderScope: () => renderScope,
			__minix_loop_state__: {
				raw: () => loopScope,
				has: (entryKey) => Object.hasOwn(loopScope, entryKey),
				meta: extra.__minix_loop_meta || null,
				signal: null
			}
		};
		const scopeProvider = () => renderScope;
		for (const node of contentNodes) this._stampScopeProviderSubtree(node, scopeProvider);

		const scopeKeys = initialKeys;
		
		const bitmapCacheKey = scopeKeys.join('\x00');
		let bitByKey = blueprint?._bitByKeyCache?.get(bitmapCacheKey);
		if (!bitByKey) {
			bitByKey = new Map();
			let nextBit = 1;
			for (const name of scopeKeys) {
				if (nextBit > 0x40000000) break;
				bitByKey.set(name, nextBit);
				nextBit <<= 1;
			}
			if (blueprint) {
				if (!blueprint._bitByKeyCache) blueprint._bitByKeyCache = new Map();
				blueprint._bitByKeyCache.set(bitmapCacheKey, bitByKey);
			}
		}
		const fullMask = 0x7fffffff;
		const resolveNode = (path) => this._resolveLoopPathNode(contentNodes, path);
		const _tbSrc = blueprint?.textBindings || [];
		const _tbArr = [];
		for (let _tbi = 0; _tbi < _tbSrc.length; _tbi++) {
			const entry = _tbSrc[_tbi];
			_tbArr.push({
				node: resolveNode(entry.path),
				compiled: entry.compiled,
				depMask: this._extractCompiledDepMask(entry.compiled, bitByKey, fullMask)
			});
		}
		const runtime = {
			textBindings: _tbArr,
			updates: [],
			cleanups: []
		};
		const directTextBinding = blueprint?.singleTextFastPath ? runtime.textBindings[0] : null;
		const directPatch = directTextBinding ? (() => {
			const node = directTextBinding.node;
			const compiled = directTextBinding.compiled;
			const part = compiled?.parts?.[0];
			const getter = part?.getter || (part?.expr ? this._compileGetter(part.expr) : null);
			return (scope) => {
				if (!node) return;
				const next = getter ? getter(scope, '') : component.renderer.interpolateCompiled(compiled, scope);
				node.textContent = next == null ? '' : String(next);
			};
		})() : null;

		const normalizeClass = MiniX_Compiler._normalizeClassValue;

		for (const entry of (blueprint?.updates || [])) {
			const el = resolveNode(entry.path);
			if (!el) continue;
			const needsPrevious = entry.type === 'class' || (entry.type === 'bind' && entry.targetAttr === 'class') || entry.type === 'style' || (entry.type === 'bind' && entry.targetAttr === 'style') || entry.type === 'attr';
			runtime.updates.push({
				path: entry.path,
				type: entry.type,
				expression: entry.expression,
				getter: entry.getter,
				targetAttr: entry.targetAttr,
				modifiers: entry.modifiers,
				el,
				depMask: this._extractBindingDepMask(entry.expression, bitByKey, fullMask),
				previous: needsPrevious ? new Set() : undefined,
				wasFocused: false,
				originalDisplay: entry.type === 'show' ? (el.style.display || '') : '',
				lastModelValue: Symbol('unset'),
				lastModelJSON: undefined
			});
		}

		for (const setup of (blueprint?.setups || [])) {
			const el = resolveNode(setup.path);
			if (!el) continue;
			const directive = setup.directive;
			const normalized = this._normalizeDirectiveName(directive.name);
			try {
				let cleanup = null;
				if (directive.kind === 'event') cleanup = this._compileEventDirective(el, directive.name, directive.expression, runtimeComponent, directive.modifiers || []);
				else if (normalized === 'x-ref') cleanup = this._compileRefDirective(el, directive.expression, runtimeComponent);
				else if (normalized === 'x-init') cleanup = this._compileInitDirective(el, directive.expression, runtimeComponent);
				else if (normalized === 'x-cloak') cleanup = this._compileCloakDirective(el);
				else if (normalized === 'x-transition') cleanup = this._compileTransitionDirective(el, directive.expression, runtimeComponent);
				else if (normalized === 'x-once') cleanup = this._compileOnceDirective(el, directive.expression, runtimeComponent);
				else if (normalized === 'x-ignore') cleanup = this._compileIgnoreDirective(el);
				else if (normalized === 'x-model') {
					const getter = this._compileGetter(directive.expression);
					const rawModifiers = directive.modifiers || [];
					const modifiers = new Set(rawModifiers);
					const valueModifiers = rawModifiers.length ? rawModifiers.filter((mod) => mod !== 'lazy') : [];
					const eventName = modifiers.has('lazy') ? 'change' : ((['checkbox', 'radio'].includes(el.type) || el.tagName === 'SELECT') ? 'change' : 'input');
					const modifierContext = { el, expression: directive.expression, component: runtimeComponent, directive: 'x-model' };
					const listenCleanup = runtimeComponent.listener.$listen(el, eventName, (event) => {
						let nextValue;
						if (el.type === 'checkbox') nextValue = el.checked;
						else if (el.type === 'radio') { if (!el.checked) return; nextValue = el.value; }
						else if (el.tagName === 'SELECT' && el.multiple) {
							nextValue = new Array(el.selectedOptions.length);
							for (let i = 0; i < el.selectedOptions.length; i++) nextValue[i] = el.selectedOptions[i].value;
						}
						else nextValue = event.target.value;
						nextValue = this._applyModifiers(nextValue, valueModifiers, modifierContext);
						this._setModelValue(directive.expression, runtimeComponent, nextValue, el);
					});
					runtime.updates.push({ type: 'model', el, getter, expression: directive.expression, modifiers: directive.modifiers || [], depMask: this._extractBindingDepMask(directive.expression, bitByKey, fullMask), lastModelValue: Symbol('unset'), lastModelJSON: undefined });
					cleanup = () => { listenCleanup?.(); };
				}
				if (typeof cleanup === 'function') runtime.cleanups.push(cleanup);
			} catch (_) { }
		}

		const updateAll = (dirtyMask = fullMask) => {
			const scope = renderScope;
			if (directPatch) {
				if (directTextBinding?.depMask & dirtyMask) directPatch(scope);
			} else {
				for (const binding of runtime.textBindings) {
					if (!binding.node || !(binding.depMask & dirtyMask)) continue;
					const next = component.renderer.interpolateCompiled(binding.compiled, scope);
					if (next !== binding._lastText) { binding._lastText = next; binding.node.textContent = next; }
				}
			}
			for (const binding of runtime.updates) {
				if (!(binding.depMask & dirtyMask)) continue;
				const el = binding.el;
				if (!el) continue;
				const value = binding.getter ? binding.getter(scope, binding.type === 'text' || binding.type === 'html' || binding.type === 'value' ? '' : undefined) : undefined;
				switch (binding.type) {
					case 'text': el.textContent = value == null ? '' : String(value); break;
					case 'html': {
					const nextHtml = component.sanitizer.sanitize(value == null ? '' : String(value));
					if (binding._htmlCleanup && binding._lastHtml !== nextHtml) {
						binding._htmlCleanup();
						binding._htmlCleanup = null;
					}
					if (binding._lastHtml !== nextHtml || el.innerHTML !== nextHtml) {
						el.innerHTML = nextHtml;
						binding._lastHtml = nextHtml;
						binding._htmlCleanup = component.compiler.compile(el, component);
					}
					break;
				}
					case 'show': { const visible = Boolean(value); if (el.__minix_transition__) el.__minix_transition__.toggle(visible, binding.originalDisplay); else el.style.display = visible ? binding.originalDisplay : 'none'; break; }
					case 'disabled': if (value) { el.setAttribute('disabled', ''); if ('disabled' in el) el.disabled = true; } else { el.removeAttribute('disabled'); if ('disabled' in el) el.disabled = false; } break;
					case 'value': el.value = value == null ? '' : String(value); break;
					case 'focus': { const shouldFocus = Boolean(value); if (shouldFocus && !binding.wasFocused) { Promise.resolve().then(() => el.focus?.()); binding.wasFocused = true; } else if (!shouldFocus) binding.wasFocused = false; break; }
					case 'class':
					case 'bind': {
						if (binding.type === 'bind' && binding.targetAttr !== 'class' && binding.targetAttr !== 'style') {
							if (value == null || value === false) el.removeAttribute(binding.targetAttr);
							else if (value === true) el.setAttribute(binding.targetAttr, '');
							else el.setAttribute(binding.targetAttr, String(value));
							break;
						}
						if (binding.type === 'class' || binding.targetAttr === 'class') {
							let classJson; try { classJson = JSON.stringify(value); } catch(_) { classJson = String(value); }
							if (classJson !== binding._lastClassJson) {
								binding._lastClassJson = classJson;
								const next = normalizeClass(value);
								for (const cls of binding.previous) { if (!next.has(cls)) el.classList.remove(cls); }
								for (const cls of next) { if (!binding.previous.has(cls)) el.classList.add(cls); }
								binding.previous = next;
							}
							break;
						}
						if (binding.targetAttr === 'style') {
							let sJson; try { sJson = JSON.stringify(value); } catch(_) { sJson = String(value); }
							if (sJson !== binding._lastStyleJson) {
								binding._lastStyleJson = sJson;
								const next = new Set();
								if (value && typeof value === 'object' && !Array.isArray(value)) {
									for (const prop in value) {
										if (!Object.hasOwn(value, prop)) continue;
										const cssProp = _minix_camelToKebab(prop);
										next.add(cssProp);
										const styleValue = value[prop];
										if (styleValue == null || styleValue === false || styleValue === '') el.style.removeProperty(cssProp);
										else el.style.setProperty(cssProp, String(styleValue));
									}
								}
								for (const prop of binding.previous) { if (!next.has(prop)) el.style.removeProperty(prop); }
								binding.previous = next;
							}
						}
						break;
					}
					case 'style': {
						const next = new Set();
						if (value && typeof value === 'object' && !Array.isArray(value)) {
							for (const prop in value) {
								if (!Object.hasOwn(value, prop)) continue;
								const cssProp = _minix_camelToKebab(prop);
								next.add(cssProp);
								const styleValue = value[prop];
								if (styleValue == null || styleValue === false || styleValue === '') el.style.removeProperty(cssProp);
								else el.style.setProperty(cssProp, String(styleValue));
							}
						}
						for (const prop of binding.previous) { if (!next.has(prop)) el.style.removeProperty(prop); }
						binding.previous = next;
						break;
					}
					case 'attr': {
						const attrs = value;
						if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) break;
						for (const attr in attrs) {
							if (!Object.hasOwn(attrs, attr)) continue;
							const attrValue = attrs[attr];
							if (attrValue == null || attrValue === false) el.removeAttribute(attr);
							else if (attrValue === true) el.setAttribute(attr, '');
							else el.setAttribute(attr, String(attrValue));
						}
						for (const attr of binding.previous) { if (!(attr in attrs)) el.removeAttribute(attr); }
						// Rebuild previous set in-place via for...in — avoids Object.keys() temp array.
						binding.previous.clear();
						for (const attr in attrs) { if (Object.hasOwn(attrs, attr)) binding.previous.add(attr); }
						break;
					}
					case 'model': {
						if (el.tagName === 'SELECT' && el.multiple) {
							const selected = Array.isArray(value) ? new Array(value.length) : [];
							for (let i = 0; i < selected.length; i++) selected[i] = String(value[i]);
							const json = selected.join('\u0001');
							if (json !== binding.lastModelJSON) {
								binding.lastModelJSON = json;
								const selectedSet = new Set(selected);
								for (let i = 0; i < el.options.length; i++) {
									const option = el.options[i];
									option.selected = selectedSet.has(option.value);
								}
							}
						} else {
							if (Object.is(value, binding.lastModelValue)) break;
							binding.lastModelValue = value;
							if (el.type === 'checkbox') el.checked = Boolean(value);
							else if (el.type === 'radio') el.checked = el.value === value;
							else el.value = value ?? '';
						}
						break;
					}
				}
			}
		};

		let lastParentScope = parentScope;
		const effect = new MiniX_Effect(() => {
			const nextParentScope = typeof component._createRenderScope === 'function'
				? component._createRenderScope()
				: this.createScope(component, null, hostEl || component.root);
			if (nextParentScope !== lastParentScope) {
				Object.setPrototypeOf(loopBaseScope, nextParentScope);
				lastParentScope = nextParentScope;
				updateAll(fullMask);
				return;
			}
			updateAll(fullMask);
		}, { flush: 'post' });
		runtimeComponent._effects.add(effect);

		const cleanup = () => {
			effect.stop();
			for (const c of runtime.cleanups) c?.();
		};

		updateAll(fullMask);
		return {
			key,
			start,
			end,
			nodes,
			cleanup,
			localComponent: runtimeComponent,
			loopState: runtimeComponent.__minix_loop_state__,
			update: (mask = fullMask) => updateAll(mask),
			setScope(nextExtra = {}) {
				if (nextExtra.__minix_loop_meta) runtimeComponent.__minix_loop_state__.meta = nextExtra.__minix_loop_meta;
				let dirtyMask = 0;
				const nextKeys = [];
				for (const k in nextExtra) { if (Object.hasOwn(nextExtra, k)) nextKeys.push(k); }
				for (const staleKey of renderKeys) {
					if (!(staleKey in nextExtra)) {
						delete loopScope[staleKey];
						delete renderScope[staleKey];
						dirtyMask |= bitByKey.get(staleKey) || fullMask;
					}
				}
				for (const k of nextKeys) {
					if (Object.is(loopScope[k], nextExtra[k])) continue;
					loopScope[k] = nextExtra[k];
					renderScope[k] = nextExtra[k];
					dirtyMask |= bitByKey.get(k) || fullMask;
				}
				renderKeys = nextKeys;
				if (dirtyMask) updateAll(dirtyMask);
			}
		};
	}

	_createSimpleLoopBlock(template, component, extra, key, hostEl = null, templateMeta = null) {
		const childFragment = template.content.cloneNode(true);
		const contentNodes = [];
		let _smn = childFragment.firstChild;
		while (_smn) { contentNodes.push(_smn); _smn = _smn.nextSibling; }
		const start = document.createComment(`x-for-start:${String(key)}`);
		const end = document.createComment(`x-for-end:${String(key)}`);
		const nodes = [start];
		for (let _ci2 = 0; _ci2 < contentNodes.length; _ci2++) nodes.push(contentNodes[_ci2]);
		nodes.push(end);
		const loopScope = { ...extra };
		const parentScope = typeof component._createRenderScope === 'function'
			? component._createRenderScope()
			: this.createScope(component, null, hostEl || component.root);
		const localComponent = Object.create(this._createLoopBlockHost(component));
		
		localComponent._effects = new Set();
		localComponent._childRecords = new Map();
		const renderScope = Object.create(parentScope);
		localComponent._createRenderScope = () => {
			if (renderScope.__loopKeys) {
				for (const staleKey of renderScope.__loopKeys) {
					if (!(staleKey in loopScope)) delete renderScope[staleKey];
				}
			}
			const nextKeys = [];
			for (const k in loopScope) {
				renderScope[k] = loopScope[k];
				nextKeys.push(k);
			}
			renderScope.__loopKeys = nextKeys;
			return renderScope;
		};
		localComponent.__minix_loop_state__ = {
			raw: () => loopScope,
			has: (entryKey) => Object.hasOwn(loopScope, entryKey),
			meta: extra.__minix_loop_meta || null,
			signal: null
		};
		const scopeProvider = () => localComponent._createRenderScope();
		for (const node of contentNodes) this._stampScopeProviderSubtree(node, scopeProvider);
		const bindings = templateMeta?.simpleBindings || this._collectLoopTextBindings(contentNodes);
		const resolveNode = (path) => {
			let node = contentNodes[path[0]];
			for (let i = 1; i < path.length && node; i++) node = node.childNodes[path[i]];
			return node;
		};
		const boundNodes = bindings.map((entry) => {
			const compiled = entry.compiled || component.renderer._compileInterpolationTemplate(entry.template);
			const directGetter = (compiled.parts && compiled.parts.length === 1 && compiled.parts[0].type === 'expr') ? (compiled.parts[0].getter || null) : null;
			return { node: resolveNode(entry.path), compiled, directGetter };
		});
		const updateBoundText = () => {
			const scope = localComponent._createRenderScope();
			for (const binding of boundNodes) {
				if (!binding.node) continue;
				if (binding.directGetter) {
					const value = binding.directGetter(scope, '');
					binding.node.textContent = value == null ? '' : String(value);
					continue;
				}
				binding.node.textContent = component.renderer.interpolateCompiled(binding.compiled, scope);
			}
		};
		updateBoundText();
		return {
			key,
			start,
			end,
			nodes,
			cleanup: () => { },
			localComponent,
			loopState: localComponent.__minix_loop_state__,
			update: updateBoundText,
			setScope(nextExtra = {}) {
				if (nextExtra.__minix_loop_meta) localComponent.__minix_loop_state__.meta = nextExtra.__minix_loop_meta;
				let changed = false;
				for (const k in loopScope) {
					if (!(k in nextExtra)) {
						delete loopScope[k];
						changed = true;
					}
				}
				for (const k in nextExtra) {
					if (Object.is(loopScope[k], nextExtra[k])) continue;
					loopScope[k] = nextExtra[k];
					changed = true;
				}
				if (changed) updateBoundText();
			}
		};
	}

	_createLoopBlock(template, component, extra, key, hostEl = null) {
		
		let isTemplateComponentLoop =
			template &&
			template.tagName === 'TEMPLATE' &&
			template.hasAttribute('x-component');

		
		
		
		
		if (!isTemplateComponentLoop && template && template.tagName === 'TEMPLATE') {
			const contentChildren = template.content ? [...template.content.children] : [];
			const onlyChild = contentChildren.length === 1 ? contentChildren[0] : null;
			if (onlyChild && onlyChild.hasAttribute('x-component')) {
				
				
				if (onlyChild.tagName === 'TEMPLATE') {
					
					isTemplateComponentLoop = true;
					template = onlyChild;
				} else {
					
					const wrappedTpl = document.createElement('template');
					
					const _ocAttrs = onlyChild.attributes;
					for (let _ai = 0; _ai < _ocAttrs.length; _ai++) {
						const attr = _ocAttrs[_ai];
						if (
							attr.name === 'x-component' ||
							attr.name === 'x-props' ||
							attr.name === 'x-bind' ||
							attr.name.startsWith('x-bind:') ||
							attr.name.startsWith(':') ||
							attr.name.startsWith('x-on:') ||
							attr.name.startsWith('@')
						) {
							wrappedTpl.setAttribute(attr.name, attr.value);
						}
					}
					isTemplateComponentLoop = true;
					template = wrappedTpl;
				}
			}
		}

		if (isTemplateComponentLoop) {
			return this._createTemplateComponentLoopBlock(template, component, extra, key, hostEl);
		}

		const templateMeta = this._getLoopTemplateMeta(template);
		if (templateMeta.isSimple) return this._createSimpleLoopBlock(template, component, extra, key, hostEl, templateMeta);
		const blueprint = this._getGenericLoopBlueprint(template, templateMeta);
		if (blueprint && !blueprint.unsupported) return this._createBlueprintLoopBlock(template, component, extra, key, hostEl, blueprint);
		return this._createLegacyLoopBlock(template, component, extra, key, hostEl, templateMeta);
	}

	_createTemplateComponentLoopBlock(template, component, extra, key, hostEl = null) {
		const start = document.createComment(`x-for-start:${String(key)}`);
		const end = document.createComment(`x-for-end:${String(key)}`);
		const loopScope = { ...extra };
		const loopSignal = new MiniX_Signal({ version: 0 });
		const parentScope = typeof component._createRenderScope === 'function'
			? component._createRenderScope()
			: this.createScope(component, null, hostEl || component.root);
		const localComponent = Object.create(this._createLoopBlockHost(component));
		localComponent.children = [];
		localComponent._childRecords = new Map();
		localComponent._effects = new Set();

		const renderScope = Object.create(parentScope);

		localComponent._createRenderScope = () => {
			void loopSignal.get('version');

			if (renderScope.__loopKeys) {
				for (const staleKey of renderScope.__loopKeys) {
					if (!(staleKey in loopScope)) delete renderScope[staleKey];
				}
			}

			const nextKeys = [];
			for (const k in loopScope) {
				renderScope[k] = loopScope[k];
				nextKeys.push(k);
			}
			renderScope.__loopKeys = nextKeys;
			return renderScope;
		};

		localComponent.__minix_loop_state__ = {
			raw: () => loopScope,
			has: (entryKey) => Object.hasOwn(loopScope, entryKey),
			meta: extra.__minix_loop_meta || null,
			signal: loopSignal
		};

		const componentExpr = template.getAttribute('x-component');
		let eventCleanup = null;

		const mountChildComponent = () => {
			const scope = localComponent._createRenderScope();
			const componentName = component._resolveComponentName(componentExpr);
			const props = this._evaluateComponentHostProps(template, scope);

			const Child = MiniX_Component.resolve(componentName, component.localComponents);
			if (!Child) {
				this._warn(`[MiniX] Unknown loop child component: ${componentName}`);
				return null;
			}

			const childComponent = new MiniX_Component(Child, {
				root: null,
				props,
				parent: component,
				provider: component.provider,
				eventBus: component.eventBus,
				renderer: component.renderer,
				sanitizer: component.sanitizer,
				compiler: component.compiler,
				dev: component.options?.dev
			});

			childComponent.mountInline(start, end);
			localComponent._childRecords.set(start, { name: componentName, component: childComponent });
			localComponent._syncChildrenArray?.();
			eventCleanup?.();
			eventCleanup = this._bindComponentHostEvents(template, component, childComponent);
			return childComponent;
		};

		let childComponent = mountChildComponent();

		const cleanup = () => {
			eventCleanup?.();
			eventCleanup = null;
			childComponent?.destroy?.();
			childComponent = null;
		};

		return {
			key,
			start,
			end,
			get nodes() {
				return childComponent?.getLiveNodes?.() || [start, end];
			},
			getLiveNodes() {
				return childComponent?.getLiveNodes?.() || [start, end];
			},
			ensureMounted() {
				childComponent?.ensureInlineMounted?.();
			},
			cleanup,
			localComponent,
			childComponent,
			loopState: localComponent.__minix_loop_state__,
			setScope: (nextExtra = {}) => {
				if (nextExtra.__minix_loop_meta) {
					localComponent.__minix_loop_state__.meta = nextExtra.__minix_loop_meta;
				}

				let changed = false;
				for (const k in loopScope) {
					if (!(k in nextExtra)) {
						delete loopScope[k];
						changed = true;
					}
				}
				for (const k in nextExtra) {
					if (Object.is(loopScope[k], nextExtra[k])) continue;
					loopScope[k] = nextExtra[k];
					changed = true;
				}
				if (!changed) return;

				loopSignal.increment('version');

				const scope = localComponent._createRenderScope();
				const nextName = component._resolveComponentName(componentExpr);
				const nextProps = this._evaluateComponentHostProps(template, scope);

				if (!childComponent || childComponent.isDestroyed) {
					childComponent = mountChildComponent();
					return;
				}

				const expectedChild = MiniX_Component.resolve(nextName, component.localComponents);
				if (!expectedChild || childComponent.ComponentClass !== expectedChild) {
					childComponent.destroy();
					localComponent._childRecords.delete(start);
					childComponent = mountChildComponent();
					return;
				}

				childComponent.updateProps(nextProps, { reason: 'x-for-props', forceRerender: false });
			}
		};
	}

	_createLegacyLoopBlock(template, component, extra, key, hostEl = null, templateMeta = null) {
		templateMeta = templateMeta || this._getLoopTemplateMeta(template);
		const childFragment = template.content.cloneNode(true);
		const contentNodes = [];
		let _ln = childFragment.firstChild;
		while (_ln) { contentNodes.push(_ln); _ln = _ln.nextSibling; }
		const start = document.createComment(`x-for-start:${String(key)}`);
		const end = document.createComment(`x-for-end:${String(key)}`);
		const nodes = [start];
		for (let _ci3 = 0; _ci3 < contentNodes.length; _ci3++) nodes.push(contentNodes[_ci3]);
		nodes.push(end);
		const loopScope = { ...extra };
		const loopSignal = new MiniX_Signal({ version: 0 });
		const parentScope = typeof component._createRenderScope === 'function'
			? component._createRenderScope()
			: this.createScope(component, null, hostEl || component.root);
		const localComponent = Object.create(this._createLoopBlockHost(component));
		
		localComponent._effects = new Set();
		localComponent._childRecords = new Map();
		const renderScope = Object.create(parentScope);

		localComponent.mountChild = (...args) => {
			const child = component.mountChild(...args);
			const element = args[1];
			if (child && element) localComponent._childRecords.set(element, { component: child });
			return child;
		};

		localComponent._createRenderScope = () => {
			void loopSignal.get('version');
			if (renderScope.__loopKeys) {
				for (const staleKey of renderScope.__loopKeys) {
					if (!(staleKey in loopScope)) delete renderScope[staleKey];
				}
			}
			const nextKeys = [];
			for (const k in loopScope) {
				renderScope[k] = loopScope[k];
				nextKeys.push(k);
			}
			renderScope.__loopKeys = nextKeys;
			return renderScope;
		};

		localComponent.__minix_loop_state__ = {
			raw: () => loopScope,
			has: (entryKey) => Object.hasOwn(loopScope, entryKey),
			meta: extra.__minix_loop_meta || null,
			signal: loopSignal
		};

		const scopeProvider = () => localComponent._createRenderScope();
		for (const node of contentNodes) this._stampScopeProviderSubtree(node, scopeProvider);

		let cleanup = () => { };
		// Cache the interpolation entry paths+compiled templates on templateMeta so they
		// are only computed once for the template, not re-walked on every clone.
		if (!templateMeta.legacyInterpolationEntries) {
			const entries = [];
			const collectInterpolationEntries = (node, path) => {
				if (node.nodeType === Node.TEXT_NODE) {
					const raw = node.textContent || '';
					if (raw.includes('{{')) {
						entries.push({
							path: path.slice(),
							compiled: component.renderer._compileInterpolationTemplate(raw)
						});
					}
					return;
				}
				if (node.nodeType !== Node.ELEMENT_NODE) return;
				let childIndex = 0;
				for (const child of node.childNodes) {
					path.push(childIndex++);
					collectInterpolationEntries(child, path);
					path.pop();
				}
			};
			// Walk the template content (not the clone) so the result is reusable.
			const _lcNodes = template.content.childNodes;
		for (let _li = 0; _li < _lcNodes.length; _li++) collectInterpolationEntries(_lcNodes[_li], [_li]);
			templateMeta.legacyInterpolationEntries = entries;
		}
		const interpolationEntries = templateMeta.legacyInterpolationEntries;
		const resolveInterpolationNode = (path) => {
			let node = contentNodes[path[0]];
			for (let i = 1; i < path.length && node; i++) node = node.childNodes[path[i]];
			return node || null;
		};
		const interpolationCleanup = this._effect(localComponent, () => {
			const scope = localComponent._createRenderScope();
			for (const entry of interpolationEntries) {
				const node = resolveInterpolationNode(entry.path);
				if (!node) continue;
				node.textContent = component.renderer.interpolateCompiled(entry.compiled, scope);
			}
		});
		cleanup = () => { interpolationCleanup?.(); };

		let plan = templateMeta.plan;
		if (!plan) {
			// Build the replay plan from the pristine template tree before compile()
			// mutates structural directives like nested x-for into marker comments.
			plan = this._buildLoopBlockPlan([...template.content.childNodes], template);
			templateMeta.plan = plan;
		}

		if (!templateMeta.planCompiledOnce) {
			for (const node of contentNodes) {
				if (node.nodeType !== Node.ELEMENT_NODE) continue;
				const currentCleanup = this.compile(node, localComponent);
				const previousCleanup = cleanup;
				cleanup = () => { currentCleanup?.(); previousCleanup?.(); };
			}
			templateMeta.planCompiledOnce = true;
		} else if (!plan?.unsupported) {
			MiniX_Compiler._scopeGen++;
			for (const node of contentNodes) {
				if (node.nodeType !== Node.ELEMENT_NODE) continue;
				const currentCleanup = this._replayLoopBlockPlan(plan, node, localComponent);
				const previousCleanup = cleanup;
				cleanup = () => { currentCleanup?.(); previousCleanup?.(); };
			}
		} else {
			for (const node of contentNodes) {
				if (node.nodeType !== Node.ELEMENT_NODE) continue;
				const currentCleanup = this.compile(node, localComponent);
				const previousCleanup = cleanup;
				cleanup = () => { currentCleanup?.(); previousCleanup?.(); };
			}
		}

		return {
			key,
			start,
			end,
			nodes,
			cleanup,
			localComponent,
			loopState: localComponent.__minix_loop_state__,
			setScope(nextExtra = {}) {
				if (nextExtra.__minix_loop_meta) localComponent.__minix_loop_state__.meta = nextExtra.__minix_loop_meta;
				let changed = false;
				for (const k in loopScope) {
					if (!(k in nextExtra)) {
						delete loopScope[k];
						changed = true;
					}
				}
				for (const k in nextExtra) {
					if (Object.is(loopScope[k], nextExtra[k])) continue;
					loopScope[k] = nextExtra[k];
					changed = true;
				}
				if (changed) loopSignal.increment('version');
			}
		};
	}

	
	
	_buildLoopBlockPlan(contentNodes, _template) {
		const plan = [];
		plan.unsupported = false;
		const visit = (node, path) => {
			if (node.nodeType !== Node.ELEMENT_NODE) return;
			const directives = this._collectDirectives(node);
			const isScopedRoot = node.hasAttribute('x-data');
			if (directives.length) {
				let hasStructural = false;
				for (let _di = 0; _di < directives.length; _di++) {
					if (directives[_di].structural) { hasStructural = true; break; }
				}
				if (hasStructural) {
					plan.unsupported = true;
				}
				// Store directive references directly — avoids a closure + array
				// allocation per directive. The replay path only reads .name/.expression/.run,
				// which are all present on the original directive object.
				plan.push({ path: path.slice(), directives });
			}
			if (isScopedRoot) return;
			let childIndex = 0;
			for (const child of node.children) {
				path.push(childIndex++);
				visit(child, path);
				path.pop();
			}
		};
		for (let _ci = 0; _ci < contentNodes.length; _ci++) visit(contentNodes[_ci], [_ci]);
		return plan;
	}

	
	_computeLIS(sequence = []) {
		const length = sequence.length;
		if (!length) return [];
		const predecessors = new Array(length).fill(-1);
		const tails = [];
		for (let i = 0; i < length; i++) {
			const value = sequence[i];
			let low = 0;
			let high = tails.length;
			while (low < high) {
				const mid = (low + high) >> 1;
				if (sequence[tails[mid]] < value) low = mid + 1;
				else high = mid;
			}
			if (low > 0) predecessors[i] = tails[low - 1];
			if (low === tails.length) tails.push(i);
			else tails[low] = i;
		}
		let cursor = tails.length ? tails[tails.length - 1] : -1;
		const lis = [];
		while (cursor !== -1) {
			lis.push(cursor);
			cursor = predecessors[cursor];
		}
		return lis.reverse();
	}

	_replayLoopBlockPlan(plan, rootNode, localComponent) {
		const cleanups = [];
		// Store stringified path prefixes for O(1) descendant checks.
		// A path is a skip-descendant if any stored prefix string is a strict
		// prefix of the entry's comma-joined path string (with trailing comma
		// so "1,2," doesn't accidentally match "1,20,").
		const skipPrefixStrs = new Set();
		const getEl = (path) => {
			let el = rootNode;
			for (let i = 1; i < path.length; i++) {
				el = el.children[path[i]];
				if (!el) return null;
			}
			return el;
		};
		rootNode.__minix_scope_provider__ = () => localComponent._createRenderScope();
		for (const entry of plan) {
			const pathStr = entry.path.join(',') + ',';
			let skip = false;
			for (const prefix of skipPrefixStrs) {
				if (pathStr.startsWith(prefix) && pathStr.length > prefix.length) { skip = true; break; }
			}
			if (skip) continue;
			const el = getEl(entry.path);
			if (!el) continue;
			let enteredScopedData = false;
			for (const directive of entry.directives) {
				try {
					const result = directive.run(localComponent, el);
					if (typeof result === 'function') cleanups.push(result);
					if (directive.name === 'x-data') enteredScopedData = true;
				} catch (_) { }
			}
			if (enteredScopedData) skipPrefixStrs.add(pathStr);
		}
		return () => { for (const c of cleanups) c?.(); };
	}

	_resolveInsertionReference(parent, referenceNode = null) {
		if (!parent) return null;
		if (!referenceNode) return null;
		if (referenceNode.parentNode === parent) return referenceNode;
		let cursor = referenceNode.nextSibling;
		while (cursor) {
			if (cursor.parentNode === parent) return cursor;
			cursor = cursor.nextSibling;
		}
		return null;
	}

	_moveBlock(anchor, block, referenceNode = null) {
		const parent = anchor.parentNode;
		if (!parent) return;
		const fragment = document.createDocumentFragment();
		const nodes = typeof block.getLiveNodes === 'function'
			? block.getLiveNodes()
			: (block.nodes || []);
		for (const node of nodes) fragment.appendChild(node);
		parent.insertBefore(fragment, this._resolveInsertionReference(parent, referenceNode));
		block.ensureMounted?.();
	}

	_moveBlocksBatch(anchor, batch, referenceNode = null) {
		const parent = anchor.parentNode;
		if (!parent || !batch || batch.length === 0) return;
		const fragment = document.createDocumentFragment();
		for (const block of batch) {
			const nodes = typeof block.getLiveNodes === 'function'
				? block.getLiveNodes()
				: (block.nodes || []);
			for (const node of nodes) fragment.appendChild(node);
		}
		parent.insertBefore(fragment, this._resolveInsertionReference(parent, referenceNode));
	}

	_removeBlock(block) {
		block.localComponent?._callHook?.('beforeUnmount', { reason: 'x-for', key: block.key });
		const owner = block.localComponent;
		const nodes = typeof block.getLiveNodes === 'function'
			? block.getLiveNodes()
			: (block.nodes || []);
		for (const node of nodes) {
			if (node?.nodeType === Node.ELEMENT_NODE) {
				this._destroyMountedChildrenInSubtree(owner, node);
			}
		}
		block.childComponent?.destroy?.();
		block.cleanup?.();
		const liveNodes = typeof block.getLiveNodes === 'function'
			? block.getLiveNodes()
			: (block.nodes || []);
		for (const node of liveNodes) node.remove();
		block.localComponent?._childRecords?.clear?.();
		block.localComponent?._callHook?.('unmounted', { reason: 'x-for', key: block.key });
	}

	_compileForDirective(el, expression, component) {
		const match = expression.match(/^\s*(?:\(([^)]+)\)|([^\s]+))\s+in\s+(.+)$/);
		if (!match) {
			this._warn(`Invalid x-for expression: ${expression}`);
			return () => { };
		}

		const vars = (match[1] || match[2]).split(',').map((item) => item.trim()).filter(Boolean);
		const sourceExpr = match[3].trim();
		const keyAttr = el.getAttribute(':key') || el.getAttribute('x-bind:key') || el.getAttribute('key');
		const connectedScopeAnchor = el.parentNode || el.parentElement || el;
		const template = el.tagName === 'TEMPLATE' ? el.cloneNode(true) : (() => {
			const tpl = document.createElement('template');
			tpl.innerHTML = el.outerHTML;
			return tpl;
		})();

		const stripLoopAttrs = (node) => {
			if (!node || node.nodeType !== Node.ELEMENT_NODE) return;
			node.removeAttribute('x-for');
			node.removeAttribute(':key');
			node.removeAttribute('x-bind:key');
			node.removeAttribute('key');
		};
		if (template.tagName === 'TEMPLATE') {
			
			
			
			const _tplChildren = template.content.children;
			for (let _ti = 0; _ti < _tplChildren.length; _ti++) stripLoopAttrs(_tplChildren[_ti]);
		} else {
			stripLoopAttrs(template);
		}
		const marker = document.createComment('x-for');
		el.parentNode.replaceChild(marker, el);
		const endMarker = document.createComment('x-for-end');
		marker.parentNode?.insertBefore(endMarker, marker.nextSibling);
		const resolveScopeAnchor = () => marker.parentNode || connectedScopeAnchor || el;
		const dedicatedFastCleanup = this._compileDedicatedFastForDirective(marker, template, expression, vars, sourceExpr, keyAttr, component, connectedScopeAnchor, el);
		if (dedicatedFastCleanup) return dedicatedFastCleanup;

		
		
		const sourceIsSimplePath = this._isSimplePath(sourceExpr);
		const sourceGetter = this._compileGetter(sourceExpr);
		const keyGetter = keyAttr ? this._compileGetter(keyAttr) : null;
		
		const seenKeys = new Set();
		let nextBlocks = [];
		let renderCycle = 0;
		
		
		const loopMeta = {
			sourceExpr,
			sourcePath: sourceIsSimplePath ? sourceExpr : null,
			index: 0,
			itemVar: vars[0],
			indexVar: vars[1] || '$index',
			keyVar: vars[1] || null,
			iterationKind: 'array',
			entryKey: undefined
		};
		

		let blocks = [];
		const keyed = new Map();

		
		
		const scopeAnchor = resolveScopeAnchor();
		const keyScope = Object.create(null);

		const stopEffect = this._effect(component, () => {
			const runBaseScope = this.createScope(component, null, marker.parentNode || scopeAnchor);
			const list = sourceGetter(runBaseScope, []);
			seenKeys.clear();
			let iterate = null;
			if (typeof list === 'number' && Number.isFinite(list) && list > 0) {
				
				const len = Math.floor(list);
				iterate = (visit) => {
					for (let i = 0; i < len; i++) visit({ value: i + 1, key: i, index: i, kind: 'array' }, i);
				};
			} else if (Array.isArray(list)) {
				
				const arrayEntry = { value: undefined, key: 0, index: 0, kind: 'array' };
				iterate = (visit) => {
					for (let index = 0; index < list.length; index++) {
						arrayEntry.value = list[index];
						arrayEntry.key = index;
						arrayEntry.index = index;
						visit(arrayEntry, index);
					}
				};
			} else if (list instanceof Map) {
				const mapEntry = { value: undefined, key: undefined, index: 0, kind: 'map' };
				iterate = (visit) => {
					let _mi = 0;
					for (const [entryKey, value] of list) {
						mapEntry.value = value; mapEntry.key = entryKey; mapEntry.index = _mi;
						visit(mapEntry, _mi++);
					}
				};
			} else if (list instanceof Set) {
				const setEntry = { value: undefined, key: 0, index: 0, kind: 'set' };
				iterate = (visit) => {
					let _si = 0;
					for (const value of list) {
						setEntry.value = value; setEntry.key = _si; setEntry.index = _si;
						visit(setEntry, _si++);
					}
				};
			} else if (list && typeof list[Symbol.iterator] === 'function' && typeof list !== 'string') {
				const iterEntry = { value: undefined, key: 0, index: 0, kind: 'iterable' };
				iterate = (visit) => {
					let _ii = 0;
					for (const value of list) {
						iterEntry.value = value; iterEntry.key = _ii; iterEntry.index = _ii;
						visit(iterEntry, _ii++);
					}
				};
			} else if (list && typeof list === 'object') {
				const objEntry = { value: undefined, key: undefined, index: 0, kind: 'object' };
				iterate = (visit) => {
					let _oi = 0;
					for (const entryKey in list) {
						if (!Object.hasOwn(list, entryKey)) continue;
						objEntry.value = list[entryKey]; objEntry.key = entryKey; objEntry.index = _oi;
						visit(objEntry, _oi++);
					}
				};
			} else iterate = () => {};

			// Warn on object/map sources without a key — detect before iterating.
			if (!keyAttr && iterate && list && typeof list === 'object') {
				const isMapOrObj = list instanceof Map || (!Array.isArray(list) && !(list instanceof Set) && typeof list[Symbol.iterator] !== 'function');
				if (isMapOrObj) {
					this._warn(`x-for on object-like sources should use a stable key. Expression: "${expression}"`);
				}
			}

			seenKeys.clear();
			nextBlocks.length = 0;
			renderCycle++;
			for (let i = 0; i < blocks.length; i++) blocks[i]._oldIndex = i;

			const entryScope = Object.create(null);

			const visitEntry = (entry, index) => {
				const loopKeyOrIndex = (entry.kind === 'object' || entry.kind === 'map') ? entry.key : entry.index;
				loopMeta.index = entry.index;
				loopMeta.iterationKind = entry.kind;
				loopMeta.entryKey = entry.key;

				entryScope[vars[0]] = entry.value;
				entryScope.$index = entry.index;
				entryScope.__minix_loop_meta = loopMeta;
				if (vars[1]) entryScope[vars[1]] = loopKeyOrIndex;
				if (vars[2]) entryScope[vars[2]] = entry.index;

				let key;
				if (keyAttr) {
					Object.setPrototypeOf(keyScope, runBaseScope);
					for (const prop in entryScope) keyScope[prop] = entryScope[prop];
					key = keyGetter ? keyGetter(keyScope, entry.index) : entry.index;
				} else {
					key = entry.key;
				}

				if (seenKeys.has(key)) {
					this._warn(`Duplicate x-for key "${String(key)}" at index ${index}. Keys must be unique and stable.`);
					return; // skip duplicate to avoid orphaned blocks
				}
				seenKeys.add(key);

				let block = keyed.get(key);
				if (block) {
					block.setScope(entryScope);
					block._nextOldIndex = block._oldIndex;
					block._isNew = false;
				} else {
					block = this._createLoopBlock(template, component, entryScope, key, resolveScopeAnchor());
					block._nextOldIndex = -1;
					block._isNew = true;
					keyed.set(key, block);
				}

				block._cycle = renderCycle;
				nextBlocks.push(block);
			};

			if (iterate) iterate(visitEntry);

			for (const block of blocks) {
				if (block._cycle !== renderCycle) {
					keyed.delete(block.key);
					this._removeBlock(block);
				}
			}

			let allNew = nextBlocks.length > 0;
			for (let _ni = 0; _ni < nextBlocks.length; _ni++) {
				if (!nextBlocks[_ni]._isNew) { allNew = false; break; }
			}
			if (allNew) {
				const parentNode = marker.parentNode;
				if (parentNode) {
					const fragment = document.createDocumentFragment();
					for (const block of nextBlocks) {
						for (const node of block.nodes) fragment.appendChild(node);
					}
					parentNode.insertBefore(fragment, this._resolveInsertionReference(parentNode, endMarker));
					for (const block of nextBlocks) block.ensureMounted?.();
				}
			} else {
				const existingSequence = [];
				const existingPositions = [];
				for (let i = 0; i < nextBlocks.length; i++) {
					const block = nextBlocks[i];
					if (block._isNew || block._nextOldIndex == null || block._nextOldIndex < 0) continue;
					existingSequence.push(block._nextOldIndex);
					existingPositions.push(i);
				}
				const _lisIndices = this._computeLIS(existingSequence);
				const stablePositions = new Set();
				for (let _li = 0; _li < _lisIndices.length; _li++) stablePositions.add(existingPositions[_lisIndices[_li]]);
				// Reuse a single batch array (push in reverse, reverse once before flush)
				// to avoid O(n²) unshift cost and repeated [] reallocations.
				const batch = [];
				let batchReferenceNode = null;
				const flushBatch = () => {
					if (!batch.length) return;
					batch.reverse();
					this._moveBlocksBatch(marker, batch, batchReferenceNode);
					batch.length = 0;
					batchReferenceNode = null;
				};
				for (let i = nextBlocks.length - 1; i >= 0; i--) {
					const block = nextBlocks[i];
					const referenceNode = i + 1 < nextBlocks.length ? nextBlocks[i + 1].start : null;
					const liveReferenceNode =
						referenceNode && referenceNode.parentNode === marker.parentNode
							? referenceNode
							: null;
					if (!block._isNew && stablePositions.has(i)) {
						flushBatch();
						continue;
					}
					if (batchReferenceNode === null) batchReferenceNode = liveReferenceNode;
					if (liveReferenceNode && liveReferenceNode !== batchReferenceNode) {
						flushBatch();
						batchReferenceNode = liveReferenceNode;
					}
					batch.push(block);
				}
				flushBatch();
			}

			for (const block of nextBlocks) {
				block._isNew = false;
				block._nextOldIndex = -1;
			}
			
			
			const tmp = blocks;
			blocks = nextBlocks;
			nextBlocks = tmp;
		});

		return () => {
			stopEffect?.();
			for (const block of blocks) this._removeBlock(block);
			keyed.clear();
			endMarker.remove();
			marker.remove();
		};
	}

	_compileComponentDirective(el, expression, component) {
		if (el.tagName === 'TEMPLATE') {
			return this._compileTemplateComponentDirective(el, expression, component);
		}

		let mountedChild = null;
		let lastProps = null;
		let lastComponentName = null;
		let lastSlotSignature = null;
		let eventCleanup = null;
		const initialSlotChildren = Array.from(el.childNodes, (child) => child.cloneNode(true));

		const slotScopeProvider = () => this.createScope(component, null, el);

		const stampParentScope = (node) => {
			if (!node) return node;
			if (node.nodeType === Node.ELEMENT_NODE) {
				node.__minix_scope_provider__ = slotScopeProvider;
				let _c = node.firstChild;
				while (_c) { stampParentScope(_c); _c = _c.nextSibling; }
			}
			return node;
		};

		const slotSignature = () => initialSlotChildren
			.map((child) => {
				if (child.nodeType === Node.TEXT_NODE) return `#text:${child.textContent}`;
				if (child.nodeType !== Node.ELEMENT_NODE) return `#node:${child.nodeType}`;
				return `${child.getAttribute?.('x-slot') || child.getAttribute?.('data-slot') || 'default'}::${child.outerHTML}`;
			})
			.join('|');

		// Slots are captured once from initialSlotChildren which never mutates,
		// so the signature string is constant — compute it once at compile time.
		const cachedSlotSignature = slotSignature();

		const hostSlots = () => {
			const slots = {};
			for (const child of initialSlotChildren) {
				if (child.nodeType === Node.TEXT_NODE && !child.textContent.trim()) continue;
				const slotName = child.nodeType === Node.ELEMENT_NODE
					? (child.getAttribute?.('x-slot') || child.getAttribute?.('data-slot') || 'default')
					: 'default';
				if (!Array.isArray(slots[slotName])) slots[slotName] = [];
				const cloned = child.cloneNode(true);
				stampParentScope(cloned);
				slots[slotName].push(cloned);
			}
			el.__minix_slots__ = slots;
			return slots;
		};

		const stopEffect = this._effect(component, () => {
			
			
			
			
			const scope = this.createScope(component, null, el.parentNode || el);
			// If the directive's expression is already a literal, registered
			// component name (the common case for both explicit x-component="name"
			// and auto-component tag-name elements), skip _evaluate entirely.
			// Evaluating a hyphenated tag name like "clock-widget" as a JS
			// expression throws (parsed as subtraction) and silently falls back
			// to the literal string anyway — this just avoids the wasted
			// compile+throw+catch cycle and the risk of a same-named scope
			// variable accidentally shadowing the literal component name.
			const componentName = component._resolveComponentName(expression);
			const props = this._evaluateComponentHostProps(el, scope);
			const nextSlotSignature = cachedSlotSignature;

			if (componentName === lastComponentName && this._shallowEqual(props, lastProps) && nextSlotSignature === lastSlotSignature && mountedChild && !mountedChild.isDestroyed) {
				mountedChild.updateProps(props, { forceRerender: false });
				return;
			}

			eventCleanup?.();
			eventCleanup = null;
			lastComponentName = componentName;
			lastProps = { ...props };
			lastSlotSignature = nextSlotSignature;
			mountedChild = component.mountChild(componentName, el, props, { slots: hostSlots() });
			eventCleanup = this._bindComponentHostEvents(el, component, mountedChild);
		});

		return () => {
			stopEffect?.();
			eventCleanup?.();
			mountedChild?.destroy?.();
			mountedChild = null;
		};
	}

	_evaluateComponentHostProps(el, scope) {
		// Getters are cached on the element the first time they're compiled so
		// subsequent reactive re-renders (which call this on every prop update)
		// don't re-enter _evaluate / _compileGetter for each attribute.
		if (!el.__minix_prop_getters__) {
			const cache = { xProps: null, binds: [], propMap: [] };
			const propsExpr = el.getAttribute('x-props');
			if (propsExpr) cache.xProps = this._compileGetter(propsExpr);
			const attrs = el.attributes || [];
			for (let i = 0; i < attrs.length; i++) {
				const attr = attrs[i];
				const name = attr.name;
				if (name === 'x-bind') {
					cache.binds.push(this._compileGetter(attr.value));
					continue;
				}
				if (name.startsWith('x-bind:') || name.startsWith(':')) {
					const raw = name.startsWith(':') ? name.slice(1) : name.slice(7);
					const dot = raw.indexOf('.');
					const propName = this._normalizeComponentPropName(dot === -1 ? raw : raw.slice(0, dot));
					if (!propName || propName === 'key') continue;
					cache.propMap.push({ propName, getter: this._compileGetter(attr.value) });
				}
			}
			el.__minix_prop_getters__ = cache;
		}
		const cache = el.__minix_prop_getters__;
		const props = cache.xProps ? { ...(cache.xProps(scope, {}) || {}) } : {};
		for (let i = 0; i < cache.binds.length; i++) {
			const value = cache.binds[i](scope, {});
			if (value && typeof value === 'object') Object.assign(props, value);
		}
		for (let i = 0; i < cache.propMap.length; i++) {
			const { propName, getter } = cache.propMap[i];
			props[propName] = getter(scope);
		}
		return props;
	}

	_normalizeComponentPropName(name) {
		return String(name || '').replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
	}

	_getComponentHostEventAttrs(el) {
		const attrs = el.attributes || [];
		const out = [];
		for (let i = 0; i < attrs.length; i++) {
			const attr = attrs[i];
			if (attr.name.startsWith('@') || attr.name.startsWith('x-on:')) out.push(attr);
		}
		return out;
	}

	_bindComponentHostEvents(el, parentComponent, childComponent) {
		if (!childComponent || childComponent.isDestroyed) return null;
		const eventAttrs = this._getComponentHostEventAttrs(el);
		if (!eventAttrs.length) return null;
		const cleanups = [];
		for (let i = 0; i < eventAttrs.length; i++) {
			const attr = eventAttrs[i];
			const raw = attr.name.startsWith('@') ? attr.name.slice(1) : attr.name.slice(5);
			const dot = raw.indexOf('.');
			const eventName = dot === -1 ? raw : raw.slice(0, dot);
			const modifiers = this._parseAttributeModifiers(attr.name);
			const expression = attr.value;
			if (!eventName) continue;
			let cleanup = null;
			let _hFireScope = null;
			let _hFireScopeBase = null;
			const _hGetter = this._compileGetter(expression);
			const handler = (event) => {
				if (event.meta?.componentInstance && event.meta.componentInstance !== childComponent.instance) return;
				const liveScope = this.createScope(parentComponent, null, el.parentNode || el);
				if (_hFireScope === null || _hFireScopeBase !== liveScope) {
					_hFireScope = Object.create(liveScope);
					_hFireScope.$el = el;
					_hFireScope.el  = el;
					_hFireScopeBase = liveScope;
				}
				_hFireScope.$event    = event.payload;
				_hFireScope.event     = event;
				_hFireScope.$emitEvent = event;
				const result = _hGetter(_hFireScope, undefined);
				if (typeof result === 'function') result.call(_hFireScope, event.payload);
				if (modifiers.includes('once')) cleanup?.();
			};
			cleanup = childComponent.eventBus.on(eventName, handler);
			if (cleanup) cleanups.push(cleanup);
		}
		return () => {
			for (let i = 0; i < cleanups.length; i++) cleanups[i]?.();
		};
	}

	_createInlineChildComponent(parentComponent, componentName, props, start, end) {
		const Child = MiniX_Component.resolve(componentName, parentComponent.localComponents);
		if (!Child) {
			this._warn(`[MiniX] Unknown child component: ${componentName}`);
			return null;
		}

		const childComponent = new MiniX_Component(Child, {
			root: null,
			props,
			parent: parentComponent,
			provider: parentComponent.provider,
			eventBus: parentComponent.eventBus,
			renderer: parentComponent.renderer,
			sanitizer: parentComponent.sanitizer,
			compiler: parentComponent.compiler,
			scopeFactories: [
				...(Array.isArray(parentComponent._scopeFactories) ? parentComponent._scopeFactories : []),
				...(Array.isArray(parentComponent._localScopeFactories) ? parentComponent._localScopeFactories : [])
			],
			instanceAPIs: [
				...(Array.isArray(parentComponent._instanceAPIFactories) ? parentComponent._instanceAPIFactories : [])
			],
			dev: parentComponent.options?.dev
		});

		childComponent.mountInline(start, end);
		return childComponent;
	}

	_compileTemplateComponentDirective(template, expression, component) {
		const start = document.createComment('x-component-start');
		const end = document.createComment('x-component-end');
		template.parentNode.insertBefore(start, template);
		template.parentNode.insertBefore(end, template.nextSibling);
		template.remove();

		let mountedChild = null;
		let lastComponentName = null;
		let lastProps = null;
		let eventCleanup = null;

		const mountOrUpdate = () => {
			const scope = this.createScope(component, null, start.parentNode || component.root);
			const componentName = component._resolveComponentName(expression);
			const props = this._evaluateComponentHostProps(template, scope);

			if (mountedChild && !mountedChild.isDestroyed && componentName === lastComponentName && this._shallowEqual(props, lastProps)) {
				mountedChild.updateProps(props, { forceRerender: false });
				return;
			}

			eventCleanup?.();
			eventCleanup = null;
			if (mountedChild) mountedChild.destroy();
			mountedChild = this._createInlineChildComponent(component, componentName, props, start, end);
			lastComponentName = componentName;
			lastProps = { ...props };
			eventCleanup = this._bindComponentHostEvents(template, component, mountedChild);
		};

		const stopEffect = this._effect(component, mountOrUpdate);

		return () => {
			stopEffect?.();
			eventCleanup?.();
			mountedChild?.destroy?.();
			start.remove();
			end.remove();
		};
	}

	_buildInterpolationOpcodes(root, component) {
		const resolveNodePath = (base, path) => {
			let node = base;
			for (const idx of path) {
				if (!node) return null;
				node = node.childNodes[idx];
			}
			return node;
		};
		const computeNodePath = (node, base) => {
			const path = [];
			let cursor = node;
			while (cursor && cursor !== base) {
				const parent = cursor.parentNode;
				if (!parent) return null;
				
				
				let index = 0;
				let sibling = cursor.previousSibling;
				while (sibling) { index++; sibling = sibling.previousSibling; }
				path.push(index);
				cursor = parent;
			}
			return cursor === base ? path.reverse() : null;
		};
		let hoisted = root.__minix_interp_hoist__;
		if (!hoisted) {
			const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
			const entries = [];
			while (walker.nextNode()) {
				const current = walker.currentNode;
				const parent = current.parentElement;
				if (!parent) continue;
				if (parent.closest?.('[x-ignore]')) continue;
				const nestedComponentHost = parent.closest?.('[x-component]');
				if (nestedComponentHost && nestedComponentHost !== root) continue;
				const nestedPortalHost = parent.closest?.('[x-portal], [x-teleport]');
				if (nestedPortalHost && nestedPortalHost !== root) continue;
				const nestedForHost = parent.closest?.('[x-for]');
				if (nestedForHost && nestedForHost !== root) continue;
				if (!current.textContent.includes('{{')) continue;
				const path = computeNodePath(current, root);
				if (!path) continue;
				entries.push({ path, template: component.renderer._compileInterpolationTemplate(current.textContent) });
			}
			hoisted = root.__minix_interp_hoist__ = entries;
		}
		return [{
			type: 'interp',
			execute: () => {
				const scopeCache = new Map();
				return this._effect(component, () => {
					scopeCache.clear();
					for (const entry of hoisted) {
						const node = resolveNodePath(root, entry.path);
						if (!node) continue;
						const parent = node.parentElement;
						if (parent?.closest?.('[data-x-once]')) continue;
						let scope = scopeCache.get(parent);
						if (!scope) { scope = this.createScope(component, null, parent); scopeCache.set(parent, scope); }
						node.textContent = component.renderer.interpolateCompiled(entry.template, scope);
					}
				});
			}
		}];
	}

	_buildCompileOpcodes(target, component) {
		const graph = this._prepareCompileGraph(target, component);
		const opcodes = this._buildInterpolationOpcodes(target, component);
		for (const { el, directives, skip } of graph) {
			if (skip) continue;
			opcodes.push({
				type: 'element',
				el,
				directives,
				execute: () => {
					const cleanups = [];
					const previousMeaningfulSibling = this._previousMeaningfulSibling(el);
					if ((el.hasAttribute('x-else-if') || el.hasAttribute('x-else')) && !previousMeaningfulSibling?.hasAttribute?.('x-if') && !previousMeaningfulSibling?.hasAttribute?.('x-else-if')) {
						this._warn(`${el.hasAttribute('x-else') ? 'x-else' : 'x-else-if'} used without a preceding x-if/x-else-if`);
					}
					if (el.hasAttribute('x-props') && !el.hasAttribute('x-component')) this._warn('x-props has no effect without x-component', el);
					if (!directives.length) return cleanups;
					const structural = directives.find((entry) => entry.structural);
					if (structural) {
						if (structural.name !== 'x-for') for (const directive of directives) {
							if (directive.structural) continue;
							if (structural.name === 'x-component' && (directive.kind === 'event' || directive.name === 'x-bind' || directive.name.startsWith(':') || directive.name.startsWith('x-bind:'))) continue;
							cleanups.push(directive.run(component, el));
						}
						cleanups.push(structural.run(component, el));
						return cleanups;
					}
					for (const directive of directives) { cleanups.push(directive.run(component, el)); }
					return cleanups;
				}
			});
		}
		return opcodes;
	}

	compile(root, component) {
		const target = typeof root === 'string' ? document.querySelector(root) : root;
		if (!target) throw new Error('MiniX_Compiler.compile() target not found');

		MiniX_Compiler._scopeGen++;
		const cleanups = [];

		const existingProvider = target.__minix_scope_provider__;
		const hasScopedState = !!target.__minix_scoped_state__;
		const isComponentHost = target.hasAttribute && target.hasAttribute('x-component');
		if (existingProvider && typeof component._createRenderScope === 'function') {
			if (!isComponentHost && !hasScopedState) {
				const childScope = component._createRenderScope();
				target.__minix_scope_provider__ = () => {
					const parentScope = existingProvider();
					return Object.assign(Object.create(parentScope), childScope);
				};
			}
		} else if (!existingProvider) {
			target.__minix_scope_provider__ = () => component._createRenderScope();
		}

		const opcodes = this._buildCompileOpcodes(target, component);
		target.__minix_opcodes__ = opcodes;
		for (const opcode of opcodes) {
			const result = opcode.execute();
			if (Array.isArray(result)) cleanups.push(...result);
			else if (typeof result === 'function') cleanups.push(result);
		}

		return () => {
			for (let i = 0; i < cleanups.length; i++) {
				if (typeof cleanups[i] === 'function') cleanups[i]();
			}
		};
	}
}




MiniX_Compiler._normalizeClassValue = (value) => {
	// Fast path: plain object with string keys (most common case: { 'cls': bool, ... })
	// Build a stable cache key and reuse the Set if nothing changed.
	if (value && typeof value === 'object' && !Array.isArray(value)) {
		// Compute a lightweight string key: "cls1:1|cls2:0|..."
		let cacheKey = '';
		for (const cls in value) {
			if (Object.hasOwn(value, cls)) {
				cacheKey += cls + (value[cls] ? '\x01' : '\x00');
			}
		}
		const cached = MiniX_Compiler._classNormCache.get(cacheKey);
		if (cached) return cached;
		const next = new Set();
		for (const cls in value) {
			if (Object.hasOwn(value, cls) && value[cls]) next.add(cls);
		}
		if (MiniX_Compiler._classNormCache.size >= 256) MiniX_Compiler._classNormCache.clear();
		MiniX_Compiler._classNormCache.set(cacheKey, next);
		return next;
	}
	const next = new Set();
	if (typeof value === 'string') {
		
		
		let start = -1;
		for (let i = 0; i <= value.length; i++) {
			const ch = i < value.length ? value.charCodeAt(i) : 32;
			const ws = ch === 32 || ch === 9 || ch === 10 || ch === 13;
			if (!ws && start === -1) { start = i; }
			else if (ws && start !== -1) { next.add(value.slice(start, i)); start = -1; }
		}
	} else if (Array.isArray(value)) {
		for (let i = 0; i < value.length; i++) {
			const entry = value[i];
			if (Array.isArray(entry)) {
				for (let j = 0; j < entry.length; j++) {
					const inner = entry[j];
					if (typeof inner === 'string') {
						let start = -1;
						for (let k = 0; k <= inner.length; k++) {
							const ch = k < inner.length ? inner.charCodeAt(k) : 32;
							const ws = ch === 32 || ch === 9 || ch === 10 || ch === 13;
							if (!ws && start === -1) { start = k; }
							else if (ws && start !== -1) { next.add(inner.slice(start, k)); start = -1; }
						}
					} else if (inner && typeof inner === 'object') {
						for (const cls in inner) { if (Object.hasOwn(inner, cls) && inner[cls]) next.add(cls); }
					}
				}
			} else if (typeof entry === 'string') {
				let start = -1;
				for (let k = 0; k <= entry.length; k++) {
					const ch = k < entry.length ? entry.charCodeAt(k) : 32;
					const ws = ch === 32 || ch === 9 || ch === 10 || ch === 13;
					if (!ws && start === -1) { start = k; }
					else if (ws && start !== -1) { next.add(entry.slice(start, k)); start = -1; }
				}
			} else if (entry && typeof entry === 'object') {
				for (const cls in entry) { if (Object.hasOwn(entry, cls) && entry[cls]) next.add(cls); }
			}
		}
	}
	return next;
};
MiniX_Compiler._classNormCache = new Map();
MiniX_Compiler._domMoveBatch = [];
MiniX_Compiler._patchAttrValue = (el, attr, value) => {
	const cache = el.__minix_attr_cache__ || (el.__minix_attr_cache__ = Object.create(null));
	const normalized = value === true ? '' : (value == null || value === false ? null : String(value));
	if (cache[attr] === normalized) return;
	cache[attr] = normalized;
	if (normalized === null) el.removeAttribute(attr);
	else el.setAttribute(attr, normalized);
};
MiniX_Compiler._patchAttrMap = (el, attrs) => {
	const cache = el.__minix_attr_cache__ || (el.__minix_attr_cache__ = Object.create(null));
	
	
	const seen = Object.create(null);
	if (attrs && typeof attrs === 'object' && !Array.isArray(attrs)) {
		for (const attr in attrs) {
			if (!Object.hasOwn(attrs, attr)) continue;
			seen[attr] = true;
			MiniX_Compiler._patchAttrValue(el, attr, attrs[attr]);
		}
	}
	for (const attr in cache) {
		if (attr in seen) continue;
		delete cache[attr];
		el.removeAttribute(attr);
	}
};
MiniX_Compiler._patchClassValue = (el, value) => {
	const next = MiniX_Compiler._normalizeClassValue(value);
	let previous = el.__minix_class_cache__;
	if (!previous) previous = el.__minix_class_cache__ = new Set();
	if (previous.size === next.size) {
		let identical = true;
		for (const cls of next) {
			if (!previous.has(cls)) { identical = false; break; }
		}
		if (identical) return;
	}
	for (const cls of previous) { if (!next.has(cls)) el.classList.remove(cls); }
	for (const cls of next) { if (!previous.has(cls)) el.classList.add(cls); }
	el.__minix_class_cache__ = next;
};
MiniX_Compiler._patchStyleValue = (el, styles) => {
	let cache = el.__minix_style_cache__;
	if (!cache) cache = el.__minix_style_cache__ = Object.create(null);
	
	
	const seen = Object.create(null);
	if (styles && typeof styles === 'object' && !Array.isArray(styles)) {
		for (const prop in styles) {
			if (!Object.hasOwn(styles, prop)) continue;
			const cssProp = _minix_camelToKebab(prop);
			seen[cssProp] = true;
			const value = styles[prop];
			const normalized = (value == null || value === false || value === '') ? null : String(value);
			if (cache[cssProp] === normalized) continue;
			cache[cssProp] = normalized;
			if (normalized === null) el.style.removeProperty(cssProp);
			else el.style.setProperty(cssProp, normalized);
		}
	}
	for (const prop in cache) {
		if (prop in seen) continue;
		delete cache[prop];
		el.style.removeProperty(prop);
	}
};

MiniX_Compiler._getterCache = new Map();
MiniX_Compiler._STRUCTURAL_ATTRS = new Set(['x-ignore', 'x-component', 'x-for', 'x-portal', 'x-teleport']);






MiniX_Compiler._globalMiniX = null;
MiniX_Compiler._globalMiniXResolved = false;

MiniX_Compiler._loopComponentProtoCache = new WeakMap();
MiniX_Compiler._loopTemplateMetaWeakCache = new WeakMap();

