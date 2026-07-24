function _minix_splitPipes(expr) {
	if (expr.indexOf('|') === -1) return [expr];
	const parts = [];
	let depth = 0;
	let inStr = null;
	let escaped = false;
	let templateDepth = 0;
	let segStart = 0;
	for (let i = 0; i < expr.length; i++) {
		const ch = expr[i];
		if (inStr) {
			if (inStr === '`') {
				if (escaped) { escaped = false; continue; }
				if (ch === '\\') { escaped = true; continue; }
				if (ch === '$' && expr[i + 1] === '{') { templateDepth++; i++; continue; }
				if (ch === '}' && templateDepth > 0) { templateDepth--; continue; }
				if (ch === '`' && templateDepth === 0) inStr = null;
			} else {
				if (escaped) { escaped = false; continue; }
				if (ch === '\\') { escaped = true; continue; }
				if (ch === inStr) inStr = null;
			}
		} else if (ch === '"' || ch === "'") {
			inStr = ch; escaped = false;
		} else if (ch === '`') {
			inStr = ch; escaped = false; templateDepth = 0;
		} else if (ch === '(' || ch === '[' || ch === '{') {
			depth++;
		} else if (ch === ')' || ch === ']' || ch === '}') {
			depth--;
		} else if (ch === '|' && depth === 0 && expr[i + 1] !== '|' && expr[i - 1] !== '|') {
			const segment = expr.slice(segStart, i).trim();
			if (segment) parts.push(segment);
			segStart = i + 1;
		}
	}
	const last = expr.slice(segStart).trim();
	if (last) parts.push(last);
	return parts.length ? parts : [expr];
}

// Cache eval-scope proxies by the scope object itself to avoid allocating
// a fresh Proxy on every _evaluate() / _compileClassDirective run.
const _minix_evalScopeCache = new WeakMap();
function _minix_createEvalScope(scope) {
	if (!scope || typeof scope !== 'object') scope = Object.create(null);
	const cached = _minix_evalScopeCache.get(scope);
	if (cached !== undefined) return cached;
	const proxy = new Proxy(scope, {
		has(target, prop) {
			if (prop in target) return true;
			if (typeof globalThis !== 'undefined' && prop in globalThis) return false;
			return true;
		},
		get(target, prop, receiver) {
			if (prop === Symbol.unscopables) return undefined;
			if (prop in target) return Reflect.get(target, prop, receiver);
			if (typeof prop === 'string') {
				const stateProxy = target.__minix_state_proxy__;
				if (stateProxy && typeof target.__minix_track_state_shape__ === 'function') {
					target.__minix_track_state_shape__();
					const value = stateProxy[prop];
					if (value !== undefined) return value;
				}
			}
			return undefined;
		},
		set(target, prop, value, receiver) {
			if (prop in target) return Reflect.set(target, prop, value, receiver);
			target[prop] = value;
			return true;
		}
	});
	_minix_evalScopeCache.set(scope, proxy);
	return proxy;
}



const _minix_camelToKebab = (() => {
	const cache = new Map();
	return (prop) => {
		let kebab = cache.get(prop);
		if (kebab === undefined) {
			kebab = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
			if (cache.size >= 500) _lruEvict(cache);
			cache.set(prop, kebab);
		}
		return kebab;
	};
})();

function _minix_parseSimplePathSegments(expression) {
	const expr = String(expression || '').trim();
	const out = [];
	const re = /([A-Za-z_$][\w$]*)|\.([A-Za-z_$][\w$]*|\d+)|\[(\d+|["'][^"']+["'])\]/g;
	let match;
	while ((match = re.exec(expr))) {
		let seg = match[1] ?? match[2] ?? match[3];
		if (seg && ((seg[0] === '"' && seg[seg.length - 1] === '"') || (seg[0] === "'" && seg[seg.length - 1] === "'"))) seg = seg.slice(1, -1);
		out.push(seg);
	}
	return out;
}

function _minix_shallowEqual(a, b) {
	if (a === b) return true;
	if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
	let countA = 0;
	for (const key in a) {
		if (!Object.hasOwn(a, key)) continue;
		countA++;
		if (!Object.hasOwn(b, key) || !Object.is(a[key], b[key])) return false;
	}
	let countB = 0;
	for (const key in b) { if (Object.hasOwn(b, key)) countB++; }
	return countA === countB;
}



const _minix_SIMPLE_PATH_RE = /^[A-Za-z_$][\w$]*(?:\.(?:[A-Za-z_$][\w$]*|\d+)|\[(?:\d+|["'][^"']+["'])\])*$/u;

