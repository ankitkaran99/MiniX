class MiniX_Renderer {
	constructor(options = {}) {
		this.options = { openTag: '{{', closeTag: '}}', sanitizer: null, ...options };
	}

	_escapeRegExp(value) {
		return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}

	_parseSimplePathSegments(expression) {
		return _minix_parseSimplePathSegments(expression);
	}

	_compileSimpleGetter(expression) {
		const expr = String(expression || '').trim();
		let getter = MiniX_Renderer._simpleGetterCache.get(expr);
		if (!getter) {
			const segments = this._parseSimplePathSegments(expr);
			getter = (scope, fallback = undefined) => {
				let current = scope;
				for (let i = 0; i < segments.length; i++) {
					if (current == null) return fallback;
					current = current instanceof Map ? current.get(segments[i]) : current[segments[i]];
				}
				return current === undefined ? fallback : current;
			};
			if (MiniX_Renderer._simpleGetterCache.size >= 4000) _lruEvict(MiniX_Renderer._simpleGetterCache);
			MiniX_Renderer._simpleGetterCache.set(expr, getter);
		}
		return getter;
	}

	evaluate(expression, scope = {}, fallback = '') {
		
		
		const cache = MiniX_Renderer._evalCache;
		let fn = cache.get(expression);
		if (fn === undefined) {
			
			try {
				fn = new Function('__scope__', `with(__scope__) { return (${expression}); }`);
			} catch (_) {
				fn = null;
			}
			if (cache.size >= 2000) _lruEvict(cache);
			cache.set(expression, fn);
		}
		try {
			if (fn) return fn(_minix_createEvalScope(scope));
			throw new Error('compile failed');
		} catch (error) {
			try {
				let fn2 = MiniX_Renderer._evalFallbackCache.get(expression);
				if (fn2 === undefined) {
					try {
						fn2 = new Function('__scope__', expression);
					} catch (_) {
						fn2 = null;
					}
					if (MiniX_Renderer._evalFallbackCache.size >= 1000) _lruEvict(MiniX_Renderer._evalFallbackCache);
					MiniX_Renderer._evalFallbackCache.set(expression, fn2);
				}
				if (fn2) return fn2(_minix_createEvalScope(scope));
				throw new Error('fallback compile failed');
			} catch (innerError) {
				console.warn(`[MiniX_Renderer] Failed to evaluate: ${expression}`, innerError || error);
				return fallback;
			}
		}
	}

	_getInterpolationRegex() {
		if (!this._interpolationRegex) {
			const open = this._escapeRegExp(this.options.openTag);
			const close = this._escapeRegExp(this.options.closeTag);
			this._interpolationRegex = new RegExp(`${open}\\s*(.+?)\\s*${close}`, 'g');
		}
		return this._interpolationRegex;
	}

	_compileInterpolationTemplate(template) {
		const key = String(template ?? '');
		let compiled = MiniX_Renderer._templateCache.get(key);
		if (compiled) return compiled;

		const regex = this._getInterpolationRegex();
		const parts = [];
		let lastIndex = 0;
		regex.lastIndex = 0;
		let match;
		while ((match = regex.exec(key))) {
			if (match.index > lastIndex) parts.push(key.slice(lastIndex, match.index));
			const rawExpr = match[1].trim();
			const pipeParts = this._splitPipes(rawExpr);
			const expr = pipeParts[0].trim();
			let pipes = null;
			if (pipeParts.length > 1) {
				pipes = new Array(pipeParts.length - 1);
				for (let i = 1; i < pipeParts.length; i++) pipes[i - 1] = pipeParts[i].trim().toLowerCase();
			}
			parts.push({ expr, pipes, getter: pipes ? null : (_minix_SIMPLE_PATH_RE.test(expr) ? this._compileSimpleGetter(expr) : null) });
			lastIndex = match.index + match[0].length;
		}
		if (lastIndex < key.length) parts.push(key.slice(lastIndex));
		compiled = parts.length ? parts : [key];
		if (MiniX_Renderer._templateCache.size >= 4000) _lruEvict(MiniX_Renderer._templateCache);
		MiniX_Renderer._templateCache.set(key, compiled);
		return compiled;
	}

	interpolateCompiled(compiled, scope = {}) {
		if (!Array.isArray(compiled) || (compiled.length === 1 && typeof compiled[0] === 'string')) return String(compiled?.[0] ?? '');

		if (compiled.length === 1) {
			const p = compiled[0];
			if (typeof p === 'object' && p.getter && (!p.pipes || !p.pipes.length)) {
				const v = p.getter(scope, '');
				return v == null ? '' : String(v);
			}
		}
		// Fast-path for the most common 2-part shape: ['static prefix', { getter }]
		if (compiled.length === 2) {
			const a = compiled[0], b = compiled[1];
			if (typeof a === 'string' && typeof b === 'object' && b.getter && (!b.pipes || !b.pipes.length)) {
				const v = b.getter(scope, '');
				return a + (v == null ? '' : String(v));
			}
		}
		const out = [];
		for (const part of compiled) {
			if (typeof part === 'string') { out.push(part); continue; }
			let value = part.getter ? part.getter(scope, '') : this.evaluate(part.expr, scope, '');
			if (part.pipes && this.modifiers) {
				const pipeCtx = { value };
				for (const pipeName of part.pipes) {
					const handler = this.modifiers.get(pipeName);
					if (handler) { try { pipeCtx.value = value; value = handler(pipeCtx); } catch (_) { } }
				}
			}
			out.push(value == null ? '' : String(value));
		}
		return out.join('');
	}

	interpolate(template, scope = {}) {
		return this.interpolateCompiled(this._compileInterpolationTemplate(template), scope);
	}


	_splitPipes(expr) { return _minix_splitPipes(expr); }

	render(template, scope = {}, options = {}) {
		const rawTemplate = String(template ?? '');
		let safeTemplate = rawTemplate;
		const placeholderMap = new Map();
		let placeholderId = 0;
		const protectMustaches = (value) => String(value).replace(/\{\{[\s\S]*?\}\}/g, (match) => {
			const token = `__MINIX_LITERAL_MUSTACHE_${placeholderId++}__`;
			placeholderMap.set(token, match);
			return token;
		});

		// Only do the expensive DOM parse + mustache protection when the template
		// actually contains x-for or x-ignore subtrees that need protection.
		const needsProtection = rawTemplate.includes('x-for') || rawTemplate.includes('x-ignore');

		if (needsProtection && typeof document !== 'undefined' && document.createElement) {
			const tpl = document.createElement('template');
			tpl.innerHTML = rawTemplate;







			const forAndIgnoreEls = tpl.content.querySelectorAll('[x-for], [x-ignore]');

			const visited = new Set();

			const protectSubtree = (subtreeRoot) => {
				if (visited.has(subtreeRoot)) return;
				visited.add(subtreeRoot);

				const searchRoot = subtreeRoot.tagName === 'TEMPLATE' ? subtreeRoot.content : subtreeRoot;
				const walker = document.createTreeWalker(searchRoot, NodeFilter.SHOW_TEXT);
				while (walker.nextNode()) {
					const node = walker.currentNode;
					if (node.textContent && node.textContent.includes('{{')) {
						node.textContent = protectMustaches(node.textContent);
					}
				}
				const elements = [
					...(subtreeRoot.tagName === 'TEMPLATE' ? [] : [subtreeRoot]),
					...searchRoot.querySelectorAll('*')
				];
				for (const el of elements) {
					const elAttrs = el.attributes || [];
					for (let ai = elAttrs.length - 1; ai >= 0; ai--) {
						const attr = elAttrs[ai];
						if (attr.value && attr.value.includes('{{')) {
							el.setAttribute(attr.name, protectMustaches(attr.value));
						}
					}
				};
			};

			for (const el of forAndIgnoreEls) protectSubtree(el);

			safeTemplate = tpl.innerHTML;
		} else if (needsProtection) {
			const MUSTACHE_RE = /\{\{[\s\S]*?\}\}/g;
			safeTemplate = rawTemplate
				.replace(
					/(<[^>]+\bx-for\b[^>]*>)([\s\S]*?)(<\/[^>]+>)/gi,
					(_, open, inner, close) => open + inner.replace(MUSTACHE_RE, (m) => protectMustaches(m)) + close
				)
				.replace(
					/(<[^>]+\bx-ignore\b[^>]*>)([\s\S]*?)(<\/[^>]+>)/gi,
					(_, open, inner, close) => open + inner.replace(MUSTACHE_RE, (m) => protectMustaches(m)) + close
				);
		}

		let html = options && options.preserveMustaches
			? safeTemplate
			: this.interpolate(safeTemplate, scope);
		for (const [token, original] of placeholderMap) {
			html = html.replaceAll(token, original);
		}
		const sanitizer = options.sanitizer || this.options.sanitizer;
		if (sanitizer?.sanitize) html = sanitizer.sanitize(html, options.sanitizeConfig || {});
		return html;
	}
}


MiniX_Renderer._simpleGetterCache = new Map();
MiniX_Renderer._evalCache = new Map();
MiniX_Renderer._evalFallbackCache = new Map();
MiniX_Renderer._templateCache = new Map();

const _MINIX_EMPTY_META = Object.freeze({});

