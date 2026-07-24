// Evict the oldest ~10% of entries from a Map-based LRU cache.
// Batch eviction amortises cost and prevents immediate re-eviction thrashing.
// Pre-interned string representations of small non-negative integers.
// Covers the vast majority of array-index link/unlink calls without any allocation.
const _minix_intStrings = (() => {
	const a = new Array(256);
	for (let i = 0; i < 256; i++) a[i] = String(i);
	return a;
})();
const _minix_intStr = (n) => (n >= 0 && n < 256) ? _minix_intStrings[n] : String(n);

function _lruEvict(map) {
	const evict = Math.ceil(map.size * 0.1) || 1;
	const iter = map.keys();
	for (let i = 0; i < evict; i++) {
		const { value, done } = iter.next();
		if (done) break;
		map.delete(value);
	}
}

class MiniX_State {
	static RAW_FLAG = typeof Symbol !== "undefined" ? Symbol.for("MiniX.raw") : "__minix_raw__";
	static ITERATE_KEY = typeof Symbol !== "undefined" ? Symbol.for("MiniX.iterate") : "__minix_iterate__";
	static SIZE_KEY = typeof Symbol !== "undefined" ? Symbol.for("MiniX.size") : "__minix_size__";
	static _pendingCallbackQueue = new Map();
	static _callbackFlushPending = false;
	static _scheduleCallbackFlush() {
		if (MiniX_State._callbackFlushPending || MiniX_Effect._batchDepth > 0 || MiniX_State._pendingCallbackQueue.size === 0) return;
		MiniX_State._callbackFlushPending = true;
		MiniX_State._scheduleMicrotask(() => {
			MiniX_State._callbackFlushPending = false;
			if (MiniX_Effect._batchDepth > 0) {
				MiniX_State._scheduleCallbackFlush();
				return;
			}
			
			const q = MiniX_State._pendingCallbackQueue;
			const jobs = [];
			for (const job of q.values()) jobs.push(job);
			q.clear();
			
			
			for (const job of jobs) {
				try { job[0](job[1], job[2], job[3], job[4]); }
				catch (err) { console.error('[MiniX] Watcher callback threw:', err); }
			}
		});
	}
	static _scheduleMicrotask(callback) {
		if (typeof queueMicrotask === "function") {
			queueMicrotask(callback);
			return;
		}
		Promise.resolve().then(callback);
	}
	static markRaw(value) {
		if (value && typeof value === "object") {
			try {
				Object.defineProperty(value, MiniX_State.RAW_FLAG, { value: true, configurable: true });
			} catch (_) {
				// Frozen/sealed objects reject both defineProperty and direct
				// assignment identically under strict mode — degrade gracefully
				// rather than letting the fallback throw uncaught.
				try { value[MiniX_State.RAW_FLAG] = true; } catch (_) { }
			}
		}
		return value;
	}
	constructor(initialState = {}, options = {}) {
		this._watchers = new Map();
		this._globalWatchers = new Set();
		this._targetWatchers = new WeakMap();
		this._targetWatcherTargetCount = 0;
		this._effectTargetRunnerMap = new WeakMap();
		this._trackedEffects = new Set();
		this._proxyPathMap = new WeakMap();
		this._proxyPathMapDirty = false;
		this._parentLinks = new WeakMap();
		this._notifyDepth = 0;
		
		
		
		
		this._proxySet = new WeakSet();
		this._dev = Boolean(options.dev);
		this._captureTraces = Boolean(options.captureTraces);
		this._devLabel = options.label || null;
		this._devHistory = this._dev ? [] : null;
		this._state = this._wrap(this._clone(initialState), []);
	}

	

	_devCapture(operation, path, oldVal, newVal, meta = MiniX_State._EMPTY_META) {
		if (!this._dev) return;
		if (MiniX_State._suppressDevCaptureDepth > 0) return;

		// Stack trace capture is expensive; only collect when explicitly opted in.
		let trace = '';
		let topFrame = '(unknown)';
		if (this._captureTraces) {
			const raw = new Error().stack || '';
			const lines = raw.split('\n');
			const callerLines = lines.filter((line) => {
				if (!line.includes('at ')) return false;
				if (line.includes('MiniX_State.') || line.includes('MiniX_State._')) return false;
				if (line.includes('_minix_splitPipes')) return false;
				return true;
			});
			trace = callerLines.map((l) => l.trim()).join('\n');
			topFrame = callerLines[0]?.trim() || '(unknown)';
		}

		const entry = {
			timestamp: Date.now(),
			operation,
			path: this._pathString(path),
			oldValue: this._cloneForLog(oldVal),
			newValue: this._cloneForLog(newVal),
			meta,
			caller: topFrame,
			trace,
		};

		this._devHistory.push(entry);

		const label = this._devLabel ? `[MiniX_State "${this._devLabel}"]` : '[MiniX_State]';
		const pathStr = entry.path || '(root)';

		
		console.groupCollapsed(
			`%c${label} %c${operation}%c  ${pathStr}  %c@ ${topFrame}`,
			'color:#888;font-weight:normal',
			'color:#e07b00;font-weight:bold',
			'color:#333',
			'color:#999;font-size:0.9em;font-weight:normal'
		);
		if (entry.path) {
			console.log('%cpath    ', 'color:#888', pathStr);
		}
		if (oldVal !== undefined) {
			console.log('%coldValue', 'color:#c00', entry.oldValue);
		}
		if (newVal !== undefined) {
			console.log('%cnewValue', 'color:#080', entry.newValue);
		}
		let hasMetaKeys = false;
		for (const _ in meta) { hasMetaKeys = true; break; }
		if (hasMetaKeys) {
			console.log('%cmeta    ', 'color:#888', meta);
		}
		console.log('%ctrace\n', 'color:#888', trace);
		console.groupEnd();

		if (typeof this._onDevCapture === 'function') {
			try { this._onDevCapture(entry, { operation, path, oldVal, newVal, meta }); }
			catch (err) { console.error('[MiniX_State] dev capture hook threw:', err); }
		}
	}

	
	_cloneForLog(value) {
		if (value === null || typeof value !== 'object') return value;
		try {
			if (Array.isArray(value)) return value.map((v) => this._cloneForLog(v));
			if (value instanceof Map) {
				const out = {};
				for (const [k, v] of value) out[k] = this._cloneForLog(v);
				return out;
			}
			if (value instanceof Set) {
				const out = [];
				for (const v of value) out.push(this._cloneForLog(v));
				return out;
			}
			const raw = this._unwrapProxy(value);
			return { ...raw };
		} catch (_) {
			return String(value);
		}
	}

	
	getHistory() {
		if (!this._dev) {
			console.warn('[MiniX_State] getHistory() called but devMode is not enabled.');
			return [];
		}
		return this._devHistory.slice();
	}

	clearHistory() {
		if (this._devHistory) this._devHistory = [];
		return this;
	}

	enableDev(label = null, { captureTraces = false } = {}) {
		this._dev = true;
		this._captureTraces = Boolean(captureTraces);
		if (this._devHistory === null) this._devHistory = [];
		if (label !== null) this._devLabel = label;
		return this;
	}

	disableDev() {
		this._dev = false;
		this._captureTraces = false;
		this._devHistory = null;
		return this;
	}

	_clone(value, seen = new WeakMap()) {
		if (value === null || typeof value !== 'object') return value;
		if (value[MiniX_State.RAW_FLAG]) return value;
		if (value.nodeType && typeof value.cloneNode === 'function') return value.cloneNode(true);
		if (seen.has(value)) return seen.get(value);

		if (value instanceof Date) return new Date(value.getTime());
		if (value instanceof RegExp) return new RegExp(value.source, value.flags);

		if (Array.isArray(value)) {
			const out = [];
			seen.set(value, out);
			for (let i = 0; i < value.length; i++) {
				out[i] = this._clone(value[i], seen);
			}
			return out;
		}

		if (value instanceof Map) {
			const out = new Map();
			seen.set(value, out);
			for (const [mapKey, mapValue] of value) {
				out.set(this._clone(mapKey, seen), this._clone(mapValue, seen));
			}
			return out;
		}

		if (value instanceof Set) {
			const out = new Set();
			seen.set(value, out);
			for (const entry of value) out.add(this._clone(entry, seen));
			return out;
		}

		const proto = Object.getPrototypeOf(value);
		
		
		
		
		if (proto === null || proto === Object.prototype) {
			const ownKeys = Reflect.ownKeys(value);
			const keys = Object.keys(value);
			// If lengths match, there are no symbol keys and no non-enumerable keys —
			// safe to skip the per-descriptor check and fast-clone directly.
			const canFastClone = ownKeys.length === keys.length;
			if (canFastClone) {
				const out = proto === null ? Object.create(null) : {};
				seen.set(value, out);
				for (let i = 0; i < keys.length; i++) {
					const key = keys[i];
					out[key] = this._clone(value[key], seen);
				}
				return out;
			}
		}
		
		const out = proto === null ? Object.create(null) : {};
		seen.set(value, out);
		for (const key of Reflect.ownKeys(value)) {
			if (key === '__minix_proxy__') continue;
			const desc = Object.getOwnPropertyDescriptor(value, key);
			if (!desc) continue;
			if ('value' in desc) desc.value = this._clone(desc.value, seen);
			try {
				Object.defineProperty(out, key, desc);
			} catch (_) {
				out[key] = desc.value;
			}
		}
		return out;
	}

	_isObject(value) {
		return value !== null && typeof value === 'object';
	}

	_isArrayIndex(prop) {
		if (typeof prop === 'number') return (prop >>> 0) === prop && prop < 4294967295;
		if (typeof prop !== 'string' || prop === '') return false;
		const n = prop.charCodeAt(0);
		if (n < 48 || n > 57) return false;
		const index = Number(prop);
		return (index >>> 0) === index && index < 4294967295 && String(index) === prop;
	}

	_unwrapProxy(value) {
		if (!value || typeof value !== 'object') return value;
		if (MiniX_State._proxySet.has(value) && '__raw' in value) {
			return value.__raw;
		}
		return value;
	}

	_isWrappable(value) {
		if (value === null || typeof value !== 'object') return false;
		// Both instance and static proxySet are kept in sync — one check suffices.
		if (MiniX_State._proxySet.has(value)) return false;
		if (value[MiniX_State.RAW_FLAG]) return false;
		// Duck-type DOM node check: cheaper than instanceof and works without
		// _NodeClass being set. nodeType is 1–12 for all standard DOM nodes.
		if (value.nodeType !== undefined && (value.nodeType > 0)) return false;
		if (value instanceof Date || value instanceof RegExp || value instanceof Promise) return false;
		if (Object.isFrozen(value)) return false;
		return true;
	}

	_normalize(path) {
		if (Array.isArray(path)) return path;
		if (!path || typeof path !== 'string') return [];
		const cache = MiniX_State._normalizeCache;
		const cached = cache.get(path);
		if (cached !== undefined) return cached;
		let normalized;
		
		
		
		if (path.indexOf('[') === -1) {
			normalized = path.indexOf('.') === -1 ? [path] : path.split('.');
		} else {
			normalized = [];
			path.replace(/[^.[\]]+|\[(\d+|(["'])(.*?)\2)\]/g, (match, bracketedNumber, quote, quotedKey) => {
				if (quote) normalized.push(quotedKey);
				else if (bracketedNumber !== undefined) normalized.push(bracketedNumber);
				else normalized.push(match);
			});
		}
		if (cache.size >= 5000) _lruEvict(cache);
		cache.set(path, normalized);
		return normalized;
	}

	_joinPath(basePath, prop) {
		let key;
		if (typeof prop === 'symbol') {
			key = MiniX_State._symbolKeyCache.get(prop);
			if (key === undefined) {
				key = 'Symbol(' + String(prop) + ')';
				MiniX_State._symbolKeyCache.set(prop, key);
			}
		} else {
			key = prop;
		}
		if (!basePath) return key;
		if (typeof basePath === 'string') return basePath + '.' + key;
		if (Array.isArray(basePath)) {
			if (!basePath.length) return key;
			return this._pathString(basePath) + '.' + key;
		}
		return String(basePath) + '.' + key;
	}

	_pathString(path) {
		if (Array.isArray(path)) {
			
			
			if (!path.length) return '';
			const cached = MiniX_State._pathArrayCache.get(path);
			if (cached !== undefined) return cached;
			const joined = path.join('.');
			MiniX_State._pathArrayCache.set(path, joined);
			return joined;
		}
		return typeof path === 'string' ? path : String(path || '');
	}

	_getPathSegments(path) {
		if (Array.isArray(path)) return path;
		return this._normalize(path);
	}

	_compilePath(path) {
		if (Array.isArray(path)) {
			return {
				raw: this._pathString(path),
				segments: path,
				isSimple: path.length === 1,
				last: path[path.length - 1] ?? ''
			};
		}
		const raw = typeof path === 'string' ? path : String(path || '');
		let compiled = MiniX_State._compiledPathCache.get(raw);
		if (compiled) return compiled;
		const segments = this._normalize(raw);
		compiled = {
			raw,
			segments,
			isSimple: segments.length === 1,
			last: segments[segments.length - 1] ?? ''
		};
		if (MiniX_State._compiledPathCache.size >= 10000) _lruEvict(MiniX_State._compiledPathCache);
		MiniX_State._compiledPathCache.set(raw, compiled);
		return compiled;
	}

	_getCachedProxy(target, basePath = []) {
		
		const pathKey = typeof basePath === 'string' ? basePath : this._pathString(basePath);
		
		
		
		
		
		const direct = target.__minix_proxy__;
		if (direct !== undefined) {
			const directPath = MiniX_State._proxyDirectPaths.get(direct);
			const directOwner = MiniX_State._proxyDirectOwners.get(direct);
			if (directPath === pathKey && directOwner === this) return direct;
		}
		const variants = this._proxyPathMap.get(target);
		return variants ? variants.get(pathKey) : undefined;
	}

	_setCachedProxy(target, basePath, proxy) {
		const pathKey = typeof basePath === 'string' ? basePath : this._pathString(basePath);
		
		
		
		try {
			if (target.__minix_proxy__ === undefined) {
				Object.defineProperty(target, '__minix_proxy__', {
					value: proxy, writable: true, enumerable: false, configurable: true
				});
				MiniX_State._proxyDirectPaths.set(proxy, pathKey);
				MiniX_State._proxyDirectOwners.set(proxy, this);
			}
		} catch (_) {  }
		let variants = this._proxyPathMap.get(target);
		if (!variants) {
			variants = new Map();
			this._proxyPathMap.set(target, variants);
		}
		variants.set(pathKey, proxy);
		
		
		this._proxySet.add(proxy);
		MiniX_State._proxySet.add(proxy);
		this._proxyPathMapDirty = true;
		return proxy;
	}

	_untrackEffectIfDetached(effect) {
		if (!effect || !effect.deps) {
			this._trackedEffects.delete(effect);
			return;
		}
		for (const dep of effect.deps) {
			if (dep.depType === 'target' && dep.state === this) return;
		}
		this._trackedEffects.delete(effect);
	}

	_get(obj, path) {
		const keys = this._normalize(path);
		let current = obj;
		for (const key of keys) {
			if (current == null) return undefined;
			if (current instanceof Map) {
				current = current.get(key);
				continue;
			}
			current = current[key];
		}
		return current;
	}

	_set(obj, path, value) {
		const keys = this._normalize(path);
		if (!keys.length) throw new Error('Path is required');
		let current = obj;
		for (let i = 0; i < keys.length - 1; i++) {
			const key = keys[i];
			const nextKey = keys[i + 1];
			if (current instanceof Map) {
				let next = current.get(key);
				if (!this._isObject(next)) {
					next = this._isArrayIndex(nextKey) ? [] : {};
					current.set(key, next);
				}
				current = next;
				continue;
			}
			if (!this._isObject(current[key])) current[key] = this._isArrayIndex(nextKey) ? [] : {};
			current = current[key];
		}
		const lastKey = keys[keys.length - 1];
		if (current instanceof Map) {
			current.set(lastKey, value);
		} else {
			current[lastKey] = value;
		}
		return value;
	}

	_linkTarget(target, basePath = '') {
		const pathKey = typeof basePath === 'string' ? basePath : this._pathString(basePath);
		if (!target || !pathKey) return;
		if (typeof target !== 'object' && typeof target !== 'function') return;
		const splitAt = pathKey.lastIndexOf('.');
		const parentPath = splitAt === -1 ? '' : pathKey.slice(0, splitAt);
		const parentKey = splitAt === -1 ? pathKey : pathKey.slice(splitAt + 1);
		const rawState = this._state.__raw ?? this._state;
		const parentTarget = parentPath ? this._get(rawState, parentPath) : rawState;
		this._linkTargetToParent(target, parentTarget, parentKey);
	}

	_linkTargetToParent(target, parentTarget, parentKey) {
		target = this._unwrapProxy(target);
		parentTarget = this._unwrapProxy(parentTarget);
		if (!target || (typeof target !== 'object' && typeof target !== 'function')) return;
		if (!parentTarget || (typeof parentTarget !== 'object' && typeof parentTarget !== 'function')) return;
		let links = this._parentLinks.get(target);
		if (!links) {
			// links is now a Map<parentTarget, Set<parentKey>> for O(1) duplicate checks
			links = new Map();
			this._parentLinks.set(target, links);
		}
		let keySet = links.get(parentTarget);
		if (!keySet) {
			keySet = new Set();
			links.set(parentTarget, keySet);
		}
		keySet.add(parentKey);
	}

	_unlinkTargetFromParent(target, parentTarget, parentKey) {
		target = this._unwrapProxy(target);
		parentTarget = this._unwrapProxy(parentTarget);
		if (!target || (typeof target !== 'object' && typeof target !== 'function')) return;
		if (!parentTarget || (typeof parentTarget !== 'object' && typeof parentTarget !== 'function')) return;
		const links = this._parentLinks.get(target);
		if (!links) return;
		const keySet = links.get(parentTarget);
		if (!keySet) return;
		keySet.delete(parentKey);
		if (!keySet.size) {
			links.delete(parentTarget);
			if (!links.size) this._parentLinks.delete(target);
		}
	}

	_getTargetWatcherSet(target, prop, create = false) {
		if (!target || (typeof target !== "object" && typeof target !== "function")) return null;
		let propMap = this._targetWatchers.get(target);
		if (!propMap) {
			if (!create) return null;
			propMap = new Map();
			this._targetWatchers.set(target, propMap);
			this._targetWatcherTargetCount++;
		}
		let watchers = propMap.get(prop);
		if (!watchers && create) {
			watchers = new Set();
			propMap.set(prop, watchers);
		}
		return watchers || null;
	}

	_removeTargetWatcher(target, prop, runner) {
		const propMap = this._targetWatchers.get(target);
		const watchers = propMap?.get(prop);
		if (!watchers) return;
		watchers.delete(runner);
		if (watchers.size === 0) propMap.delete(prop);
		if (propMap && propMap.size === 0) {
			this._targetWatchers.delete(target);
			if (this._targetWatcherTargetCount > 0) this._targetWatcherTargetCount--;
		}
	}

	_trackTargetEffect(target, prop) {
		const effect = MiniX_Effect.activeEffect;
		if (!effect || !target || (typeof target !== 'object' && typeof target !== 'function')) return;
		let effectTargets = this._effectTargetRunnerMap.get(effect);
		if (!effectTargets) {
			effectTargets = new WeakMap();
			this._effectTargetRunnerMap.set(effect, effectTargets);
		}
		let propMap = effectTargets.get(target);
		if (!propMap) {
			propMap = new Map();
			effectTargets.set(target, propMap);
		}
		const tv = effect._trackVersion;
		
		const existing = propMap.get(prop);
		if (existing !== undefined) {
			existing._trackedVersion = tv;
			return;
		}
		this._trackedEffects.add(effect);
		const watchers = this._getTargetWatcherSet(target, prop, true);
		const runner = effect._scheduleRunner;
		const dep = { state: this, depType: MiniX_State._DEP_TYPE_TARGET, target, prop, runner, _trackedVersion: tv };
		propMap.set(prop, dep);
		watchers.add(runner);
		if (!effect.deps) effect.deps = new Set();
		effect.deps.add(dep);
		effect._depsDirty = true; 
	}

	_queuePlainCallback(cb, newVal, oldVal, propStr, meta) {
		if (cb.__minix_cbid__ === undefined) cb.__minix_cbid__ = ++MiniX_State._cbIdCounter;
		const key = cb.__minix_cbid__ + ':' + propStr;
		const existing = MiniX_State._pendingCallbackQueue.get(key);
		if (existing) {
			// Update in-place — same callback+prop; only newVal and meta change.
			existing[1] = newVal;
			existing[4] = meta;
		} else {
			MiniX_State._pendingCallbackQueue.set(key, [cb, newVal, oldVal, propStr, meta]);
		}
	}

	_notifyGlobalWatchers(newVal, oldVal, prop, meta = MiniX_State._EMPTY_META) {
		if (!this._globalWatchers.size) return;
		const propStr = typeof prop === 'symbol' ? String(prop) : (prop == null ? '' : String(prop));
		let queued = false;
		for (const cb of this._globalWatchers) {
			const effect = cb.__minix_effect__;
			if (effect) {
				if (!effect._scheduled) effect.schedule();
			} else {
				this._queuePlainCallback(cb, newVal, oldVal, propStr, meta);
				queued = true;
			}
		}
		if (queued) MiniX_State._scheduleCallbackFlush();
	}


	_notifyTarget(target, prop, newVal, oldVal, meta = MiniX_State._EMPTY_META) {
		if (!target || (typeof target !== 'object' && typeof target !== 'function')) return;
		const propMap = this._targetWatchers.get(target);
		if (!propMap || propMap.size === 0) return;

		const direct = propMap.get(prop);
		const metaType = meta.type || '';
		let structural = false;
		if (metaType !== 'set' && metaType !== 'set:path') {
			structural = (meta.structural === true) || MiniX_State._STRUCTURAL_TYPES.has(metaType);
		}
		const iterate = (structural || prop === MiniX_State.ITERATE_KEY) ? propMap.get(MiniX_State.ITERATE_KEY) : null;
		const lengthWatchers = Array.isArray(target) && (prop === 'length' || (meta.affectsLength === true))
			? propMap.get('length')
			: null;
		if (!direct && !iterate && !lengthWatchers) return;

		
		
		if (direct && !iterate && !lengthWatchers) {
			let propStr = null;
			let queued = false;
			for (const cb of direct) {
				const eff = cb.__minix_effect__;
				if (eff) { if (!eff._scheduled) eff.schedule(); }
				else {
					if (propStr === null) propStr = typeof prop === 'symbol' ? String(prop) : (prop == null ? '' : String(prop));
					this._queuePlainCallback(cb, newVal, oldVal, propStr, meta);
					queued = true;
				}
			}
			if (queued) MiniX_State._scheduleCallbackFlush();
			return;
		}

		let propStr = null;
		let queued = false;
		const queue = MiniX_State._notifyQueue;
		queue.clear();
		if (direct) for (const cb of direct) queue.add(cb);
		if (iterate) for (const cb of iterate) queue.add(cb);
		if (lengthWatchers) for (const cb of lengthWatchers) queue.add(cb);
		for (const cb of queue) {
			const eff = cb.__minix_effect__;
			if (eff) { if (!eff._scheduled) eff.schedule(); }
			else {
				if (propStr === null) propStr = typeof prop === 'symbol' ? String(prop) : (prop == null ? '' : String(prop));
				this._queuePlainCallback(cb, newVal, oldVal, propStr, meta);
				queued = true;
			}
		}
		if (queued) MiniX_State._scheduleCallbackFlush();
	}

	_hasWatchersForTarget(target) {
		if (!target) return false;
		const targetWatchers = this._targetWatchers.get(target);
		return Boolean(targetWatchers && targetWatchers.size);
	}

	// Shared stack buffer for _walkParentLinks — avoids a `new Array` allocation per notification.
	// The stack holds triples: [parentTarget, parentKey, depth] packed flat.
	static _parentLinkStack = new Array(256);
	static _walkParentLinksActive = false;

	static _EMPTY_META = Object.freeze({});
	// Interned string constants — avoids allocating new string literals in hot
	// dep-registration paths like _trackTargetEffect (called on every reactive read).
	static _DEP_TYPE_TARGET = 'target';

	_queueBatchedTargetNotify(target, prop, newVal, oldVal, meta = MiniX_State._EMPTY_META) {
		if (MiniX_State._flushingBatchedNotifications) return false;
		if (MiniX_Effect._batchDepth <= 0) return false;
		if (!meta) meta = MiniX_State._EMPTY_META;

		let stateQueue = MiniX_State._batchedNotifyQueue.get(this);
		if (!stateQueue) {
			stateQueue = new Map();
			MiniX_State._batchedNotifyQueue.set(this, stateQueue);
		}

		let targetQueue = stateQueue.get(target);
		if (!targetQueue) {
			targetQueue = new Map();
			stateQueue.set(target, targetQueue);
		}

		let record = targetQueue.get(prop);
		if (!record) {
			targetQueue.set(prop, {
				target,
				prop,
				newVal,
				oldVal,
				// Store the meta reference directly — for the common case this is
				// a frozen constant that never needs to be mutated. If a subsequent
				// coalesced write needs to merge new fields in, we copy-on-write below.
				meta,
				_metaOwned: false
			});
		} else {
			record.newVal = newVal;
			if (meta && meta !== MiniX_State._EMPTY_META) {
				// Copy-on-write: first mutation of a shared frozen meta reference.
				if (!record._metaOwned) {
					record.meta = { ...record.meta };
					record._metaOwned = true;
				}
				for (const k in meta) {
					if (Object.hasOwn(meta, k)) record.meta[k] = meta[k];
				}
				if (meta.structural || MiniX_State._STRUCTURAL_TYPES.has(meta.type)) {
					record.meta.structural = true;
				}
			}
		}

		MiniX_State._batchedNotifyPending = true;
		return true;
	}

	static _flushBatchedTargetNotifications() {
		if (!MiniX_State._batchedNotifyPending) return;

		const queue = MiniX_State._batchedNotifyQueue;
		if (!queue.size) {
			MiniX_State._batchedNotifyPending = false;
			return;
		}

		// Replace the queue before iterating so re-entrant mutations during the
		// flush are queued into a fresh map. Reset _batchedNotifyPending only
		// after the loop so a second call to this function during the flush
		// (from _endBatch) sees the new pending entries and re-enters.
		MiniX_State._batchedNotifyQueue = new Map();
		MiniX_State._flushingBatchedNotifications = true;

		try {
			for (const [state, stateQueue] of queue) {
				for (const [, targetQueue] of stateQueue) {
					for (const [, record] of targetQueue) {
						state._bubbleTargetNotify(
							record.target,
							record.prop,
							record.newVal,
							record.oldVal,
							record.meta
						);
					}
				}
			}
		} finally {
			MiniX_State._flushingBatchedNotifications = false;
			// Only clear pending flag after the loop — a re-entrant mutation
			// during the loop sets _batchedNotifyPending = true again, and
			// _endBatch will call us again to drain those entries.
			MiniX_State._batchedNotifyPending = false;
		}
	}

	// Shared parent-link traversal used by both branches of _bubbleTargetNotify.
	_walkParentLinks(startTarget, newVal, oldVal, meta) {
		const links = this._parentLinks.get(startTarget);
		if (!links || !links.size) return;
		let structuralMeta = null;

		// Guard against re-entrant calls (e.g. a watcher triggering a mutation
		// during notification) which would corrupt the shared static stack.
		// Fall back to a local stack in that case.
		const useShared = !MiniX_State._walkParentLinksActive;
		MiniX_State._walkParentLinksActive = true;
		const stack = useShared ? MiniX_State._parentLinkStack : [];
		let sp = 0;

		for (const [parentTarget, keySet] of links) {
			for (const parentKey of keySet) {
				if (sp + 3 > stack.length) stack.length = stack.length * 2;
				stack[sp++] = parentTarget;
				stack[sp++] = parentKey;
				stack[sp++] = 0;
			}
		}
		try {
			while (sp > 0) {
				const depth = stack[--sp];
				const currentProp = stack[--sp];
				const currentParent = stack[--sp];
				if (!currentParent || depth >= 64) continue;
				if (this._hasWatchersForTarget(currentParent)) {
					if (!structuralMeta) {
						structuralMeta = meta.structural ? meta : { ...meta, structural: true };
					}
					this._notifyTarget(currentParent, currentProp, newVal, oldVal, structuralMeta);
				}
				const parentLinks = this._parentLinks.get(currentParent);
				if (parentLinks && parentLinks.size) {
					for (const [parentTarget, keySet] of parentLinks) {
						for (const parentKey of keySet) {
							if (sp + 3 > stack.length) stack.length = stack.length * 2;
							stack[sp++] = parentTarget;
							stack[sp++] = parentKey;
							stack[sp++] = depth + 1;
						}
					}
				}
			}
		} finally {
			if (useShared) MiniX_State._walkParentLinksActive = false;
		}
	}

	_bubbleTargetNotify(target, prop, newVal, oldVal, meta = MiniX_State._EMPTY_META) {
		if (!target || (typeof target !== 'object' && typeof target !== 'function')) return;
		if (this._queueBatchedTargetNotify(target, prop, newVal, oldVal, meta)) return;

		const metaType = meta.type;
		if (metaType === 'set' || metaType === 'set:path') {
			const propMap = this._targetWatchers.get(target);
			if (propMap && propMap.size > 0) {
				const direct = propMap.get(prop);
				if (direct) {
					const propStr = typeof prop === 'symbol' ? String(prop) : (prop == null ? '' : String(prop));
					let queued = false;
					for (const cb of direct) {
						const eff = cb.__minix_effect__;
						if (eff) { if (!eff._scheduled) eff.schedule(); }
						else {
							this._queuePlainCallback(cb, newVal, oldVal, propStr, meta);
							queued = true;
						}
					}
					if (queued) MiniX_State._scheduleCallbackFlush();
				}
			}
			const hasGlobal = this._globalWatchers.size > 0;
			const parentLinks = this._parentLinks.get(target);
			if (!parentLinks || !parentLinks.size) {
				if (hasGlobal) this._notifyGlobalWatchers(newVal, oldVal, prop, meta);
				return;
			}
			// Fast-exit: if no global watchers and no target watcher on any target at all,
			// skip the potentially expensive parent-link walk entirely.
			if (!hasGlobal && this._targetWatcherTargetCount === 0) return;
			if (!hasGlobal && this._targetWatcherTargetCount <= 1) return;
			this._walkParentLinks(target, newVal, oldVal, meta);
			if (hasGlobal) this._notifyGlobalWatchers(newVal, oldVal, prop, meta);
			return;
		}

		this._notifyTarget(target, prop, newVal, oldVal, meta);
		const hasGlobal = this._globalWatchers.size > 0;
		const parentLinks = this._parentLinks.get(target);
		if (!parentLinks || !parentLinks.size) {
			if (hasGlobal) this._notifyGlobalWatchers(newVal, oldVal, prop, meta);
			return;
		}
		if (!hasGlobal && this._targetWatcherTargetCount <= 1) return;
		this._walkParentLinks(target, newVal, oldVal, meta);
		if (hasGlobal) this._notifyGlobalWatchers(newVal, oldVal, prop, meta);
	}

	_notify(path, newVal, oldVal, meta = MiniX_State._EMPTY_META) {
		this._notifyGlobalWatchers(newVal, oldVal, this._pathString(path), meta);
	}

	_trackEffect(path, target = null, prop = null) {
		
		if (!MiniX_Effect.activeEffect) return;
		if (target) this._trackTargetEffect(target, prop);
		
		
		
	}

	_createMapProxy(target, basePath = []) {
		const self = this;
		return new Proxy(target, {
			get(obj, prop, receiver) {
				if (prop === '__raw') return obj;
				if (prop === 'size') {
					self._trackEffect(basePath, obj, MiniX_State.SIZE_KEY);
					return Reflect.get(obj, prop, obj);
				}
				if (prop === 'get') {
					return (key) => {
						self._trackEffect('', obj, key);
						const value = obj.get(key);
						return self._isWrappable(value) ? self._wrap(value, self._joinPath(basePath, key)) : value;
					};
				}
				if (prop === 'has') {
					return (key) => {
						self._trackEffect('', obj, key);
						return obj.has(key);
					};
				}
				if (prop === 'keys') {
					self._trackEffect(basePath, obj, MiniX_State.ITERATE_KEY);
					return obj.keys.bind(obj);
				}
				if (prop === Symbol.iterator || prop === 'entries') {
					return function* () {
						self._trackEffect(basePath, obj, MiniX_State.ITERATE_KEY);
						for (const [key, value] of obj.entries()) {
							const childPath = self._joinPath(basePath, key);
							yield [key, self._isWrappable(value) ? self._wrap(value, childPath) : value];
						}
					};
				}
				if (prop === 'values') {
					return function* () {
						self._trackEffect(basePath, obj, MiniX_State.ITERATE_KEY);
						for (const [key, value] of obj.entries()) {
							const childPath = self._joinPath(basePath, key);
							yield self._isWrappable(value) ? self._wrap(value, childPath) : value;
						}
					};
				}
				if (prop === 'forEach') {
					return (callback, thisArg) => {
						self._trackEffect(basePath, obj, MiniX_State.ITERATE_KEY);
						obj.forEach((value, key) => {
							const childPath = self._joinPath(basePath, key);
							const wrapped = self._isWrappable(value) ? self._wrap(value, childPath) : value;
							callback.call(thisArg, wrapped, key, receiver);
						});
					};
				}
				if (prop === 'set') {
					return (key, value) => {
						value = self._unwrapProxy(value);
						MiniX_Effect._beginBatch();
						try {
							const childPath = self._joinPath(basePath, key);
							const hadKey = obj.has(key);
							const oldVal = obj.get(key);
							const oldSize = obj.size;
							const wrapped = self._isWrappable(value) ? self._wrap(value, childPath) : value;
							if (hadKey && (Object.is(oldVal, wrapped) || Object.is(self._unwrapProxy(oldVal), value))) return receiver;
							if (hadKey) self._unlinkTargetFromParent(oldVal, obj, key);
							obj.set(key, wrapped);
							if (self._isWrappable(value)) self._linkTargetToParent(value, obj, key);
							self._devCapture('map:set', childPath, oldVal, wrapped, MiniX_State._META_MAP_SET);
							self._bubbleTargetNotify(obj, key, wrapped, oldVal, MiniX_State._META_MAP_SET);
							
							if (obj.size !== oldSize) {
								self._bubbleTargetNotify(obj, MiniX_State.SIZE_KEY, obj.size, oldSize, MiniX_State._META_MAP_SET);
							}
							return receiver;
						} finally {
							MiniX_Effect._endBatch();
						}
					};
				}
				if (prop === 'delete') {
					return (key) => {
						const childPath = self._joinPath(basePath, key);
						const oldVal = obj.get(key);
						const oldSize = obj.size;
						const deleted = obj.delete(key);
						if (deleted) {
							MiniX_Effect._beginBatch();
							try {
								self._unlinkTargetFromParent(oldVal, obj, key);
								self._devCapture('map:delete', childPath, oldVal, undefined, MiniX_State._META_MAP_DEL);
								self._bubbleTargetNotify(obj, key, undefined, oldVal, MiniX_State._META_MAP_DEL);
								self._bubbleTargetNotify(obj, MiniX_State.SIZE_KEY, obj.size, oldSize, MiniX_State._META_MAP_DEL);
							} finally {
								MiniX_Effect._endBatch();
							}
						}
						return deleted;
					};
				}
				if (prop === 'clear') {
					return () => {
						if (!obj.size) return undefined;
						const oldVal = new Map(obj);
						const oldSize = oldVal.size;
						for (const [key, value] of oldVal) self._unlinkTargetFromParent(value, obj, key);
						obj.clear();
						MiniX_Effect._beginBatch();
						try {
							self._devCapture('map:clear', basePath, oldVal, obj, MiniX_State._META_MAP_CLR);
							self._bubbleTargetNotify(obj, MiniX_State.ITERATE_KEY, obj, oldVal, MiniX_State._META_MAP_CLR);
							self._bubbleTargetNotify(obj, MiniX_State.SIZE_KEY, obj.size, oldSize, MiniX_State._META_MAP_CLR);
						} finally {
							MiniX_Effect._endBatch();
						}
						return undefined;
					};
				}
				const value = Reflect.get(obj, prop, obj);
				return typeof value === 'function' ? value.bind(obj) : value;
			}
		});
	}

	_createSetProxy(target, basePath = []) {
		const self = this;
		return new Proxy(target, {
			get(obj, prop, receiver) {
				if (prop === '__raw') return obj;
				if (prop === 'size') {
					self._trackEffect(basePath, obj, MiniX_State.SIZE_KEY);
					return Reflect.get(obj, prop, obj);
				}
				if (prop === 'has') {
					return (value) => {
						self._trackEffect(basePath, obj, MiniX_State.ITERATE_KEY);
						value = self._unwrapProxy(value);
						if (obj.has(value)) return true;
						const wrapped = self._isWrappable(value) ? self._getCachedProxy(value, basePath) : null;
						return wrapped ? obj.has(wrapped) : false;
					};
				}
				if (prop === Symbol.iterator || prop === 'values' || prop === 'keys') {
					return function* () {
						self._trackEffect(basePath, obj, MiniX_State.ITERATE_KEY);
						for (const value of obj.values()) {
							yield self._isWrappable(value) ? self._wrap(value, basePath) : value;
						}
					};
				}
				if (prop === 'entries') {
					return function* () {
						self._trackEffect(basePath, obj, MiniX_State.ITERATE_KEY);
						for (const value of obj.values()) {
							const wrapped = self._isWrappable(value) ? self._wrap(value, basePath) : value;
							yield [wrapped, wrapped];
						}
					};
				}
				if (prop === 'forEach') {
					return (callback, thisArg) => {
						self._trackEffect(basePath, obj, MiniX_State.ITERATE_KEY);
						obj.forEach((value) => {
							const wrapped = self._isWrappable(value) ? self._wrap(value, basePath) : value;
							callback.call(thisArg, wrapped, wrapped, receiver);
						});
					};
				}
				if (prop === 'add') {
					return (value) => {
						value = self._unwrapProxy(value);
						const canWrap = self._isWrappable(value);
						const wrapped = canWrap ? self._wrap(value, basePath) : value;
						const had = canWrap ? (obj.has(value) || obj.has(wrapped)) : obj.has(value);
						const oldSize = obj.size;
						obj.add(wrapped);
						if (!had) {
							MiniX_Effect._beginBatch();
							try {
								self._devCapture('set:add', basePath, undefined, wrapped, { type: 'set:add', value: wrapped });
								self._bubbleTargetNotify(obj, MiniX_State.ITERATE_KEY, obj, obj, { type: 'set:add', value: wrapped });
								self._bubbleTargetNotify(obj, MiniX_State.SIZE_KEY, obj.size, oldSize, MiniX_State._META_COL_ADD);
							} finally {
								MiniX_Effect._endBatch();
							}
						}
						return receiver;
					};
				}
				if (prop === 'delete') {
					return (value) => {
						value = self._unwrapProxy(value);
						const hasValue = obj.has(value);
						const wrapped = (!hasValue && self._isWrappable(value)) ? self._getCachedProxy(value, basePath) : null;
						const hasWrapped = wrapped ? obj.has(wrapped) : false;
						const storedValue = hasValue ? value : wrapped;
						const oldSize = obj.size;
						const deleted = (hasValue || hasWrapped) && obj.delete(storedValue);
						if (deleted) {
							MiniX_Effect._beginBatch();
							try {
								self._devCapture('set:delete', basePath, storedValue, undefined, { type: 'set:delete', value: storedValue });
								self._bubbleTargetNotify(obj, MiniX_State.ITERATE_KEY, obj, obj, { type: 'set:delete', value: storedValue });
								self._bubbleTargetNotify(obj, MiniX_State.SIZE_KEY, obj.size, oldSize, MiniX_State._META_COL_DEL);
							} finally {
								MiniX_Effect._endBatch();
							}
						}
						return deleted;
					};
				}
				if (prop === 'clear') {
					return () => {
						if (!obj.size) return undefined;
						const oldSize = obj.size;
						const snapshot = [...obj];
						obj.clear();
						MiniX_Effect._beginBatch();
						try {
							self._devCapture('set:clear', basePath, snapshot, undefined, MiniX_State._META_COL_CLR);
							self._bubbleTargetNotify(obj, MiniX_State.ITERATE_KEY, obj, obj, MiniX_State._META_COL_CLR);
							self._bubbleTargetNotify(obj, MiniX_State.SIZE_KEY, obj.size, oldSize, MiniX_State._META_COL_CLR);
						} finally {
							MiniX_Effect._endBatch();
						}
						return undefined;
					};
				}
				const value = Reflect.get(obj, prop, obj);
				return typeof value === 'function' ? value.bind(obj) : value;
			}
		});
	}

	_wrap(target, basePath = '', skipWrappableCheck = false) {
		if (!skipWrappableCheck && !this._isWrappable(target)) return target;
		
		if (this._proxySet.has(target)) return target;

		const cached = this._getCachedProxy(target, basePath);
		if (cached) return cached;

		this._linkTarget(target, basePath);
		if (target instanceof Map) {
			const proxiedMap = this._createMapProxy(target, basePath);
			return this._setCachedProxy(target, basePath, proxiedMap);
		}

		if (target instanceof Set) {
			const proxiedSet = this._createSetProxy(target, basePath);
			return this._setCachedProxy(target, basePath, proxiedSet);
		}

		const isArray = Array.isArray(target);
		const proxy = new Proxy(target, {
			get: (obj, prop) => {
				if (prop === '__raw') return obj;

				if (isArray && (prop === 'includes' || prop === 'indexOf' || prop === 'lastIndexOf')) {
					return (...args) => {
						this._trackTargetEffect(obj, MiniX_State.ITERATE_KEY);
						const result = Array.prototype[prop].apply(proxy, args);
						if (result === true || (typeof result === 'number' && result !== -1)) return result;
						// These methods take (searchElement, fromIndex?) — no need for a generic spread.
						const nextArgs = args.length > 1
							? [this._unwrapProxy(args[0]), args[1]]
							: [this._unwrapProxy(args[0])];
						return Array.prototype[prop].apply(obj, nextArgs);
					};
				}

				if (isArray && typeof prop === 'string' && MiniX_State._ARRAY_MUTATORS.has(prop)) {
					return (...args) => {
						MiniX_Effect._beginBatch();
						try {
							const oldSnapshot = obj.slice();
							// Unwrap into a NEW array — never mutate the caller's args array.
							let nextArgs = args;
							if (prop === 'push' || prop === 'unshift') {
								nextArgs = new Array(args.length);
								for (let i = 0; i < args.length; i++) nextArgs[i] = this._unwrapProxy(args[i]);
							} else if (prop === 'splice' && args.length > 2) {
								nextArgs = args.slice();
								for (let i = 2; i < nextArgs.length; i++) nextArgs[i] = this._unwrapProxy(nextArgs[i]);
							}
							const result = Array.prototype[prop].apply(obj, nextArgs);
							if (prop === 'push') {
								// Only link the newly appended items.
								for (let i = oldSnapshot.length; i < obj.length; i++) {
									this._linkTargetToParent(obj[i], obj, _minix_intStr(i));
								}
							} else if (prop === 'pop') {
								this._unlinkTargetFromParent(oldSnapshot[oldSnapshot.length - 1], obj, _minix_intStr(oldSnapshot.length - 1));
							} else if (prop === 'shift') {
								// Unlink removed head; re-key remaining items (indices shifted by -1).
								this._unlinkTargetFromParent(oldSnapshot[0], obj, '0');
								for (let i = 0; i < obj.length; i++) {
									this._linkTargetToParent(obj[i], obj, _minix_intStr(i));
								}
							} else if (prop === 'unshift') {
								// Link only the newly prepended items; re-key all (indices shifted by +n).
								for (let i = 0; i < obj.length; i++) {
									this._linkTargetToParent(obj[i], obj, _minix_intStr(i));
								}
							} else {
								// sort, reverse, splice: full relink.
								for (let i = 0; i < oldSnapshot.length; i++) {
									this._unlinkTargetFromParent(oldSnapshot[i], obj, _minix_intStr(i));
								}
								for (let i = 0; i < obj.length; i++) {
									this._linkTargetToParent(obj[i], obj, _minix_intStr(i));
								}
							}
							const mutType = 'array:' + prop;
							const mutMeta = MiniX_State._META_ARR_MUTATORS.get(prop);
							this._devCapture(mutType, basePath, oldSnapshot, obj.slice(), mutMeta || MiniX_State._META_SET);
							this._bubbleTargetNotify(obj, MiniX_State.ITERATE_KEY, proxy, oldSnapshot, mutMeta || MiniX_State._META_SET);
							this._bubbleTargetNotify(obj, 'length', obj.length, oldSnapshot.length, mutMeta || MiniX_State._META_SET);
							return result;
						} finally {
							MiniX_Effect._endBatch();
						}
					};
				}

				const value = obj[prop];
				
				const hasEffect = MiniX_Effect.activeEffect !== null;
				if (hasEffect && typeof prop === 'string') this._trackTargetEffect(obj, prop);
				// Fast-path: primitives are never wrappable — skip the _isWrappable call.
				const vtype = typeof value;
				if (vtype !== 'object' && vtype !== 'function') return value;
				if (value === null) return value;
				if (!this._isWrappable(value)) return value;
				
				return this._wrap(value, this._joinPath(basePath, prop), true);
			},
			set: (obj, prop, value) => {
				value = this._unwrapProxy(value);
				const hadKey = Object.hasOwn(obj, prop);
				const oldVal = obj[prop];
				if (hadKey && Object.is(oldVal, value)) return true;
				if (hadKey) this._unlinkTargetFromParent(oldVal, obj, prop);
				obj[prop] = value;
				if (this._dev) this._devCapture('set', this._joinPath(basePath, prop), oldVal, value, MiniX_State._META_SET);
				
				this._bubbleTargetNotify(obj, prop, value, oldVal, isArray && prop === 'length'
					? MiniX_State._META_SET_LEN
					: MiniX_State._META_SET);
				if (!hadKey && !isArray) {
					this._bubbleTargetNotify(obj, MiniX_State.ITERATE_KEY, obj, obj, MiniX_State._META_SET_STRUCTURAL);
				}
				return true;
			},
			deleteProperty: (obj, prop) => {
				const oldVal = obj[prop];
				if (isArray && this._isArrayIndex(prop) && prop in obj) {
					const oldSnapshot = obj.slice();
					Array.prototype.splice.call(obj, Number(prop), 1);
					for (let i = 0; i < oldSnapshot.length; i++) {
						this._unlinkTargetFromParent(oldSnapshot[i], obj, _minix_intStr(i));
					}
					for (let i = 0; i < obj.length; i++) {
						this._linkTargetToParent(obj[i], obj, _minix_intStr(i));
					}
					if (this._dev) this._devCapture('array:delete', this._joinPath(basePath, prop), oldVal, undefined, MiniX_State._META_ARR_DEL);
					this._bubbleTargetNotify(obj, prop, undefined, oldVal, MiniX_State._META_ARR_DEL);
					this._bubbleTargetNotify(obj, MiniX_State.ITERATE_KEY, proxy, oldSnapshot, MiniX_State._META_ARR_DEL);
					this._bubbleTargetNotify(obj, 'length', obj.length, oldSnapshot.length, MiniX_State._META_ARR_DEL);
					return true;
				}
				const hadKey = Object.hasOwn(obj, prop);
				if (!hadKey) return true;
				const ok = delete obj[prop];
				if (ok) {
					this._unlinkTargetFromParent(oldVal, obj, prop);
					if (this._dev) this._devCapture('delete', this._joinPath(basePath, prop), oldVal, undefined, MiniX_State._META_DELETE);
					this._bubbleTargetNotify(obj, prop, undefined, oldVal, MiniX_State._META_DELETE);
				}
				return ok;
			}
		});

		this._setCachedProxy(target, basePath, proxy);

		return proxy;
	}

	raw() { return this._state; }
	snapshot() { return this._clone(this._state); }
	get(path, fallback = undefined) {
		if (!path) return this._state;
		const value = this._get(this._state, path);
		return value === undefined ? fallback : value;
	}
	has(path) {
		const keys = this._normalize(path);
		let current = this._state.__raw ?? this._state;
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
	_invalidateProxyCache(path, segments = null) {
		
		
		if (!this._proxyPathMapDirty) return;
		const prefix = this._pathString(path);
		if (!prefix) {
			this._proxyPathMap = new WeakMap();
			this._proxyPathMapDirty = false;
			return;
		}
		const rawState = this._state.__raw ?? this._state;
		const keys = segments || this._getPathSegments(path);
		let current = rawState;
		for (let i = 0; i < keys.length - 1; i++) {
			if (current == null) return;
			current = current instanceof Map ? current.get(keys[i]) : current[keys[i]];
		}
		if (current && typeof current === 'object') {
			this._proxyPathMap.delete(current);
			try {
				if (current.__minix_proxy__ !== undefined) delete current.__minix_proxy__;
			} catch (_) {}
		}
	}
	set(path, value) {
		value = this._unwrapProxy(value);
		const rawState = this._state.__raw ?? this._state;
		const compiled = this._compilePath(path);
		const { raw, segments, isSimple, last } = compiled;
		if (!segments.length) throw new Error('Path is required');

		if (isSimple) {
			const hadKey = Object.hasOwn(rawState, last);
			const oldVal = rawState[last];
			if (hadKey && Object.is(oldVal, value)) return value;
			if (hadKey) this._unlinkTargetFromParent(oldVal, rawState, last);
			rawState[last] = value;
			if (this._dev) this._devCapture('set', raw, oldVal, value, MiniX_State._META_SET_PATH_API);
			this._bubbleTargetNotify(rawState, last, value, oldVal, MiniX_State._META_SET_PATH);
			if (!hadKey && !Array.isArray(rawState)) {
				this._bubbleTargetNotify(rawState, MiniX_State.ITERATE_KEY, rawState, rawState, MiniX_State._META_SET_PATH_STRUCT);
			}
			return value;
		}

		let parent = rawState;
		let usedFastPath = true;
		for (let i = 0; i < segments.length - 1; i++) {
			const next = parent[segments[i]];
			if (next === null || next === undefined || next instanceof Map) { usedFastPath = false; break; }
			parent = next;
		}

		if (!usedFastPath) {
			parent = rawState;
			for (let i = 0; i < segments.length - 1; i++) {
				const key = segments[i];
				const nextKey = segments[i + 1];
				if (parent instanceof Map) {
					let next = parent.get(key);
					if (!this._isObject(next)) {
						next = this._isArrayIndex(nextKey) ? [] : {};
						parent.set(key, next);
					}
					parent = next;
					continue;
				}
				if (!this._isObject(parent[key])) parent[key] = this._isArrayIndex(nextKey) ? [] : {};
				parent = parent[key];
			}
		}

		const hadKey = parent instanceof Map ? parent.has(last) : Object.hasOwn(parent, last);
		const oldVal = parent instanceof Map ? parent.get(last) : parent[last];
		if (hadKey && Object.is(oldVal, value)) return value;

		if (hadKey) this._unlinkTargetFromParent(oldVal, parent, last);
		if (parent instanceof Map) parent.set(last, value);
		else parent[last] = value;

		this._invalidateProxyCache(raw, segments);
		if (this._dev) this._devCapture('set', raw, oldVal, value, MiniX_State._META_SET_PATH_API);
		this._bubbleTargetNotify(parent, last, value, oldVal, MiniX_State._META_SET_PATH);
		if (!hadKey && !(parent instanceof Map) && !Array.isArray(parent)) {
			this._bubbleTargetNotify(parent, MiniX_State.ITERATE_KEY, parent, parent, MiniX_State._META_SET_PATH_STRUCT);
		}
		return value;
	}
	delete(path) {
		const compiled = this._compilePath(path);
		const { raw, segments, last } = compiled;
		let parent = this._state;
		if (segments.length > 1) {
			for (let i = 0; i < segments.length - 1; i++) {
				if (parent == null) return false;
				parent = parent instanceof Map ? parent.get(segments[i]) : parent[segments[i]];
			}
		}
		if (parent instanceof Map) {
			if (!parent.has(last)) return false;
			const oldVal = parent.get(last);
			const ok = parent.delete(last);
			if (ok) {
				this._unlinkTargetFromParent(oldVal, parent, last);
				if (this._dev) this._devCapture('delete', raw, oldVal, undefined, { type: 'delete:path', api: 'delete()' });
				this._bubbleTargetNotify(parent, last, undefined, oldVal, MiniX_State._META_DEL_PATH);
			}
			return ok;
		}
		
		
		
		
		
		const rawParent = (parent && typeof parent === 'object' && parent.__raw) ? parent.__raw : parent;
		if (!rawParent || !Object.hasOwn(rawParent, last)) return false;
		if (Array.isArray(rawParent) && this._isArrayIndex(last)) {
			const oldSnapshot = rawParent.slice();
			const oldVal = rawParent[last];
			Array.prototype.splice.call(rawParent, Number(last), 1);
			for (let i = 0; i < oldSnapshot.length; i++) {
				this._unlinkTargetFromParent(oldSnapshot[i], rawParent, _minix_intStr(i));
			}
			for (let i = 0; i < rawParent.length; i++) {
				this._linkTargetToParent(rawParent[i], rawParent, _minix_intStr(i));
			}
			this._devCapture('array:delete', raw, oldVal, undefined, { type: 'array:delete', api: 'delete()' });
			this._bubbleTargetNotify(rawParent, last, undefined, oldVal, MiniX_State._META_ARR_DEL);
			this._bubbleTargetNotify(rawParent, MiniX_State.ITERATE_KEY, rawParent, oldSnapshot, MiniX_State._META_ARR_DEL);
			this._bubbleTargetNotify(rawParent, 'length', rawParent.length, oldSnapshot.length, MiniX_State._META_ARR_DEL);
			return true;
		}
		const oldVal = rawParent[last];
		const ok = delete rawParent[last];
		if (ok) {
			this._unlinkTargetFromParent(oldVal, rawParent, last);
			this._devCapture('delete', raw, oldVal, undefined, { type: 'delete:path', api: 'delete()' });
			this._bubbleTargetNotify(rawParent, last, undefined, oldVal, MiniX_State._META_DEL_PATH);
			if (!Array.isArray(rawParent)) {
				this._bubbleTargetNotify(rawParent, MiniX_State.ITERATE_KEY, rawParent, rawParent, MiniX_State._META_DEL_PATH_STRUCT);
			}
		}
		return ok;
	}
	batch(fn) {
		if (typeof fn !== 'function') return undefined;
		MiniX_Effect._beginBatch();
		try {
			return fn();
		} finally {
			MiniX_Effect._endBatch();
		}
	}

	toggle(path) { return this.set(path, !Boolean(this.get(path))); }
	increment(path, amount = 1) { return this.set(path, Number(this.get(path, 0)) + amount); }
	decrement(path, amount = 1) { return this.increment(path, -amount); }
	push(path, ...items) {
		const arr = this.get(path, []);
		if (!Array.isArray(arr)) throw new Error(`Value at ${path} is not an array`);
		if (!items.length) return arr;
		// Wrap into a new array — never mutate the caller's rest-args.
		const wrapped = new Array(items.length);
		for (let i = 0; i < items.length; i++) {
			wrapped[i] = this._isWrappable(items[i]) ? this._wrap(items[i], path) : items[i];
		}
		arr.push(...wrapped);
		return arr;
	}
	pop(path) {
		const arr = this.get(path, []);
		if (!Array.isArray(arr)) throw new Error(`Value at ${path} is not an array`);
		return arr.pop();
	}
	map(path, cb) {
		const arr = this.get(path, []);
		if (!Array.isArray(arr)) throw new Error(`Value at ${path} is not an array`);
		return this.set(path, arr.map(cb));
	}
	filter(path, cb) {
		const arr = this.get(path, []);
		if (!Array.isArray(arr)) throw new Error(`Value at ${path} is not an array`);
		return this.set(path, arr.filter(cb));
	}
	merge(path, payload) {
		const current = this.get(path, {});
		if (!current || typeof current !== 'object' || Array.isArray(current)) throw new Error(`Value at ${path} is not an object`);
		return this.set(path, { ...current, ...payload });
	}
	patch(path, updater) {
		return this.set(path, typeof updater === 'function' ? updater(this.get(path)) : updater);
	}
	reset(nextState = {}) {
		const oldState = this.snapshot();
		this._proxyPathMap = new WeakMap();
		this._proxyPathMapDirty = false;
		this._targetWatchers = new WeakMap();
		this._targetWatcherTargetCount = 0;
		this._effectTargetRunnerMap = new WeakMap();
		this._parentLinks = new WeakMap();
		
		
		
		this._proxySet = new WeakSet();
		this._state = this._wrap(this._clone(nextState), []);
		this._devCapture('reset', '', oldState, nextState, { type: 'reset', api: 'reset()' });
		MiniX_Effect._beginBatch();
		try {
			const toRemove = [];
			for (const effect of this._trackedEffects) {
				if (effect && effect.active) effect.schedule();
				else toRemove.push(effect);
			}
			for (const effect of toRemove) this._trackedEffects.delete(effect);
			this._notify('', this._state, oldState, MiniX_State._META_RESET);
		} finally {
			MiniX_Effect._endBatch();
		}
		return this._state;
	}
	watch(path, callback) {
		if (typeof callback !== 'function') throw new Error('watch callback must be function');
		const key = this._pathString(path || '');
		if (!key) {
			this._globalWatchers.add(callback);
			return () => this._globalWatchers.delete(callback);
		}
		const segments = this._normalize(key);
		const len = segments.length;
		let getter;
		if (len === 1) {
			const s0 = segments[0];
			getter = () => {
				const v = this._state;
				return v == null ? undefined : (v instanceof Map ? v.get(s0) : v[s0]);
			};
		} else if (len === 2) {
			const s0 = segments[0], s1 = segments[1];
			getter = () => {
				const a = this._state;
				if (a == null) return undefined;
				const b = a instanceof Map ? a.get(s0) : a[s0];
				return b == null ? undefined : (b instanceof Map ? b.get(s1) : b[s1]);
			};
		} else {
			getter = () => {
				let current = this._state;
				for (let i = 0; i < segments.length; i++) {
					if (current == null) return undefined;
					current = current instanceof Map ? current.get(segments[i]) : current[segments[i]];
				}
				return current;
			};
		}
		const snapshot = (value) => (value && typeof value === 'object') ? this._clone(value) : value;
		let initialized = false;
		let oldVal;
		const effect = new MiniX_Effect(() => {
			const newVal = getter();
			if (!initialized) { initialized = true; oldVal = snapshot(newVal); return; }
			if (Object.is(newVal, oldVal)) return;
			const prev = oldVal;
			oldVal = snapshot(newVal);
			callback(newVal, prev, key, MiniX_State._META_WATCH);
		}, { flush: 'post' });
		return () => effect.stop();
	}
}



MiniX_State._notifyQueue = new Set();
MiniX_State._batchedNotifyQueue = new Map();
MiniX_State._batchedNotifyPending = false;
MiniX_State._flushingBatchedNotifications = false;


MiniX_State._STRUCTURAL_TYPES = new Set([
	'delete', 'delete:path',
	'array:delete', 'array:push', 'array:pop', 'array:shift', 'array:unshift',
	'array:splice', 'array:sort', 'array:reverse', 'array:fill', 'array:copyWithin',
	'map:set', 'map:delete', 'map:clear',
	'set:add', 'set:delete', 'set:clear'
]);
MiniX_State._proxySet = new WeakSet();
MiniX_State._ARRAY_MUTATORS = new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin']);
MiniX_State._normalizeCache = new Map();
MiniX_State._compiledPathCache = new Map();
MiniX_State._pathArrayCache = new WeakMap();

MiniX_State._NodeClass = (typeof Node !== 'undefined') ? Node : null;


MiniX_State._META_SET_PATH         = Object.freeze({ type: 'set:path' });
MiniX_State._META_SET_PATH_STRUCT  = Object.freeze({ type: 'set:path', structural: true });
MiniX_State._META_SET_PATH_API     = Object.freeze({ type: 'set:path', api: 'set()' });
MiniX_State._META_DEL_PATH         = Object.freeze({ type: 'delete:path' });
MiniX_State._META_DEL_PATH_STRUCT  = Object.freeze({ type: 'delete:path', structural: true });
MiniX_State._META_RESET            = Object.freeze({ type: 'reset' });
MiniX_State._META_WATCH            = Object.freeze({ type: 'watch' });
MiniX_State._META_INCREMENT        = Object.freeze({ type: 'increment' });
MiniX_State._META_SET      = Object.freeze({ type: 'set' });
MiniX_State._META_SET_LEN  = Object.freeze({ type: 'set', affectsLength: true });
MiniX_State._META_SET_STRUCTURAL = Object.freeze({ type: 'set', structural: true });
MiniX_State._META_DELETE   = Object.freeze({ type: 'delete' });
MiniX_State._META_ARR_DEL  = Object.freeze({ type: 'array:delete' });
// Pre-built frozen meta objects for every array mutator type — keyed by
// the mutator name so the hot mutator handler can do O(1) lookup instead
// of allocating two { type: 'array:X' } objects per call.
MiniX_State._META_ARR_MUTATORS = new Map([
	['push',       Object.freeze({ type: 'array:push' })],
	['pop',        Object.freeze({ type: 'array:pop' })],
	['shift',      Object.freeze({ type: 'array:shift' })],
	['unshift',    Object.freeze({ type: 'array:unshift' })],
	['splice',     Object.freeze({ type: 'array:splice' })],
	['sort',       Object.freeze({ type: 'array:sort' })],
	['reverse',    Object.freeze({ type: 'array:reverse' })],
	['fill',       Object.freeze({ type: 'array:fill' })],
	['copyWithin', Object.freeze({ type: 'array:copyWithin' })],
]);
MiniX_State._META_MAP_SET  = Object.freeze({ type: 'map:set' });
MiniX_State._META_MAP_DEL  = Object.freeze({ type: 'map:delete' });
MiniX_State._META_MAP_CLR  = Object.freeze({ type: 'map:clear' });
MiniX_State._META_COL_ADD  = Object.freeze({ type: 'set:add' });
MiniX_State._META_COL_DEL  = Object.freeze({ type: 'set:delete' });
MiniX_State._META_COL_CLR  = Object.freeze({ type: 'set:clear' });

MiniX_State._proxyDirectPaths = new WeakMap();
MiniX_State._proxyDirectOwners = new WeakMap();
MiniX_State._symbolKeyCache = new Map();

MiniX_State._cbIdCounter = 0;
MiniX_State._suppressDevCaptureDepth = 0;







