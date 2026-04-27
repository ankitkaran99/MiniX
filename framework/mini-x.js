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
			const jobs = [...q.values()]; q.clear();
			
			
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
			try { Object.defineProperty(value, MiniX_State.RAW_FLAG, { value: true, configurable: true }); } catch (_) { value[MiniX_State.RAW_FLAG] = true; }
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

	

	_devCapture(operation, path, oldVal, newVal, meta = {}) {
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
		if (Object.keys(meta).length) {
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
				value.forEach((v, k) => { out[k] = this._cloneForLog(v); });
				return out;
			}
			if (value instanceof Set) {
				const out = [];
				value.forEach((v) => out.push(this._cloneForLog(v)));
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
			value.forEach((mapValue, mapKey) => {
				out.set(this._clone(mapKey, seen), this._clone(mapValue, seen));
			});
			return out;
		}

		if (value instanceof Set) {
			const out = new Set();
			seen.set(value, out);
			value.forEach((entry) => {
				out.add(this._clone(entry, seen));
			});
			return out;
		}

		const proto = Object.getPrototypeOf(value);
		
		
		
		
		if (proto === null || proto === Object.prototype) {
			const keys = Object.keys(value);
			const ownKeys = Reflect.ownKeys(value);
			let canFastClone = keys.length === ownKeys.length;
			if (canFastClone) {
				for (let i = 0; i < keys.length; i++) {
					const desc = Object.getOwnPropertyDescriptor(value, keys[i]);
					if (!desc || !desc.enumerable || !('value' in desc)) {
						canFastClone = false;
						break;
					}
				}
			}
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
		if (typeof prop === 'number') return Number.isInteger(prop) && prop >= 0 && prop < 4294967295;
		if (typeof prop !== 'string' || prop === '') return false;
		const n = prop.charCodeAt(0);
		// Fast-reject: first char must be a digit 0-9
		if (n < 48 || n > 57) return false;
		const index = Number(prop);
		return Number.isInteger(index) && index >= 0 && index < 4294967295 && String(index) === prop;
	}

	_unwrapProxy(value) {
		if (!value || typeof value !== 'object') return value;
		if ((this._proxySet.has(value) || MiniX_State._proxySet.has(value)) && value.__raw !== undefined) {
			return value.__raw;
		}
		return value;
	}

	_isWrappable(value) {
		
		if (value === null || typeof value !== 'object') return false;
		
		
		
		if (this._proxySet.has(value)) return false;
		if (MiniX_State._proxySet.has(value)) return false;
		if (value[MiniX_State.RAW_FLAG]) return false;
		if (MiniX_State._NodeClass && value instanceof MiniX_State._NodeClass) return false;
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
			String(path).replace(/[^.[\]]+|\[(\d+|(["'])(.*?)\2)\]/g, (match, bracketedNumber, quote, quotedKey) => {
				if (quote) normalized.push(quotedKey);
				else if (bracketedNumber !== undefined) normalized.push(String(bracketedNumber).replace(/^["']|["']$/g, ''));
				else normalized.push(match);
			});
		}
		if (cache.size >= 5000) cache.delete(cache.keys().next().value);
		cache.set(path, normalized);
		return normalized;
	}

	_joinPath(basePath, prop) {
		const key = typeof prop === 'symbol' ? `Symbol(${String(prop)})` : prop;
		if (!basePath) return key;
		if (typeof basePath === 'string') return basePath + '.' + key;
		if (Array.isArray(basePath)) {
			if (!basePath.length) return key;
			// Join once via _pathString which caches the result for this exact array reference.
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
		if (MiniX_State._compiledPathCache.size >= 10000) {
			MiniX_State._compiledPathCache.delete(MiniX_State._compiledPathCache.keys().next().value);
		}
		MiniX_State._compiledPathCache.set(raw, compiled);
		return compiled;
	}

	_getCachedProxy(target, basePath = []) {
		
		const pathKey = typeof basePath === 'string' ? basePath : this._pathString(basePath);
		
		
		
		
		
		const direct = target.__minix_proxy__;
		if (direct !== undefined) {
			const directPath = MiniX_State._proxyDirectPaths?.get(direct);
			const directOwner = MiniX_State._proxyDirectOwners?.get(direct);
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
					next = /^\d+$/.test(String(nextKey)) ? [] : {};
					current.set(key, next);
				}
				current = next;
				continue;
			}
			if (!this._isObject(current[key])) current[key] = /^\d+$/.test(String(nextKey)) ? [] : {};
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
		const rawState = this._state?.__raw || this._state;
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
			links = [];
			this._parentLinks.set(target, links);
		}
		for (let i = 0; i < links.length; i++) {
			const link = links[i];
			if (link.parentTarget === parentTarget && link.parentKey === parentKey) return;
		}
		links.push({ parentTarget, parentKey });
	}

	_unlinkTargetFromParent(target, parentTarget, parentKey) {
		target = this._unwrapProxy(target);
		parentTarget = this._unwrapProxy(parentTarget);
		if (!target || (typeof target !== 'object' && typeof target !== 'function')) return;
		if (!parentTarget || (typeof parentTarget !== 'object' && typeof parentTarget !== 'function')) return;
		const links = this._parentLinks.get(target);
		if (!links || !links.length) return;
		let write = 0;
		for (let read = 0; read < links.length; read++) {
			const link = links[read];
			if (link.parentTarget === parentTarget && Object.is(link.parentKey, parentKey)) continue;
			links[write++] = link;
		}
		links.length = write;
		if (!links.length) this._parentLinks.delete(target);
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
			
			existing.__dep._trackedVersion = tv;
			return;
		}
		this._trackedEffects.add(effect);
		const watchers = this._getTargetWatcherSet(target, prop, true);
		const runner = () => effect.schedule();
		runner.__minix_effect__ = effect;
		propMap.set(prop, runner);
		watchers.add(runner);
		const dep = { state: this, depType: 'target', target, prop, runner, _trackedVersion: tv };
		runner.__dep = dep;
		if (!effect.deps) effect.deps = new Set();
		effect.deps.add(dep);
		effect._depsDirty = true; 
	}

	_queuePlainCallback(cb, newVal, oldVal, propStr, meta) {
		
		
		
		
		if (cb.__minix_cbid__ === undefined) cb.__minix_cbid__ = ++MiniX_State._cbIdCounter;
		const key = `${cb.__minix_cbid__}:${propStr}`;
		MiniX_State._pendingCallbackQueue.set(key, [cb, newVal, oldVal, propStr, meta]);
		MiniX_State._scheduleCallbackFlush();
	}

	_notifyGlobalWatchers(newVal, oldVal, prop, meta = {}) {
		if (!this._globalWatchers.size) return;
		let propStr = null;
		for (const cb of this._globalWatchers) {
			const effect = cb.__minix_effect__;
			if (effect) {
				if (!effect._scheduled) effect.schedule();
			} else {
				if (propStr === null) propStr = typeof prop === 'symbol' ? String(prop) : String(prop ?? '');
				this._queuePlainCallback(cb, newVal, oldVal, propStr, meta);
			}
		}
	}


	_notifyTarget(target, prop, newVal, oldVal, meta = {}) {
		if (!target || (typeof target !== 'object' && typeof target !== 'function')) return;
		const propMap = this._targetWatchers.get(target);
		if (!propMap || propMap.size === 0) return;

		const direct = propMap.get(prop);
		const metaType = meta.type || '';
		let structural = false;
		if (metaType !== 'set' && metaType !== 'set:path') {
			structural = (meta.structural === true)
				|| MiniX_State._STRUCTURAL_TYPES.has(metaType)
				|| (metaType.length > 5
					&& (metaType.charCodeAt(0) === 97  || metaType.charCodeAt(0) === 109 )
					&& (metaType.startsWith('array:') || metaType.startsWith('map:')))
				|| (metaType.length > 4 && metaType.charCodeAt(0) === 115
					&& (metaType === 'set:add' || metaType === 'set:delete' || metaType === 'set:clear'));
		}
		const iterate = (structural || prop === MiniX_State.ITERATE_KEY) ? propMap.get(MiniX_State.ITERATE_KEY) : null;
		const lengthWatchers = Array.isArray(target) && (prop === 'length' || (meta.affectsLength === true))
			? propMap.get('length')
			: null;
		if (!direct && !iterate && !lengthWatchers) return;

		
		
		if (direct && !iterate && !lengthWatchers) {
			let propStr = null;
			for (const cb of direct) {
				const eff = cb.__minix_effect__;
				if (eff) { if (!eff._scheduled) eff.schedule(); }
				else {
					if (propStr === null) propStr = typeof prop === 'symbol' ? String(prop) : (prop == null ? '' : String(prop));
					this._queuePlainCallback(cb, newVal, oldVal, propStr, meta);
				}
			}
			return;
		}

		
		let propStr = null;
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
			}
		}
		queue.clear();
	}

	_hasWatchersForTarget(target) {
		if (!target) return false;
		const targetWatchers = this._targetWatchers.get(target);
		return Boolean(targetWatchers && targetWatchers.size);
	}

	// Shared parent-link traversal used by both branches of _bubbleTargetNotify.
	_walkParentLinks(startTarget, newVal, oldVal, meta) {
		const parentLinks = this._parentLinks.get(startTarget);
		if (!parentLinks || !parentLinks.length) return;
		let structuralMeta = null;
		const stack = [];
		for (let i = 0; i < parentLinks.length; i++) {
			const link = parentLinks[i];
			stack.push(link.parentTarget, link.parentKey, 0);
		}
		while (stack.length) {
			const depth = stack.pop();
			const currentProp = stack.pop();
			const currentParent = stack.pop();
			if (!currentParent || depth >= 64) continue;
			if (this._hasWatchersForTarget(currentParent)) {
				if (!structuralMeta) structuralMeta = { ...meta, structural: true };
				this._notifyTarget(currentParent, currentProp, newVal, oldVal, structuralMeta);
			}
			const links = this._parentLinks.get(currentParent);
			if (links && links.length) {
				for (let i = 0; i < links.length; i++) {
					const link = links[i];
					stack.push(link.parentTarget, link.parentKey, depth + 1);
				}
			}
		}
	}

	_bubbleTargetNotify(target, prop, newVal, oldVal, meta = {}) {
		if (!target || (typeof target !== 'object' && typeof target !== 'function')) return;

		const metaType = meta.type;
		if (metaType === 'set' || metaType === 'set:path') {
			const propMap = this._targetWatchers.get(target);
			if (propMap && propMap.size > 0) {
				const direct = propMap.get(prop);
				if (direct) {
					let propStr = null;
					for (const cb of direct) {
						const eff = cb.__minix_effect__;
						if (eff) { if (!eff._scheduled) eff.schedule(); }
						else {
							if (propStr === null) propStr = typeof prop === 'symbol' ? String(prop) : String(prop ?? '');
							this._queuePlainCallback(cb, newVal, oldVal, propStr, meta);
						}
					}
				}
			}
			const hasGlobal = this._globalWatchers.size > 0;
			const parentLinks = this._parentLinks.get(target);
			if (!parentLinks || !parentLinks.length) {
				if (hasGlobal) this._notifyGlobalWatchers(newVal, oldVal, prop, meta);
				return;
			}
			if (!hasGlobal && this._targetWatcherTargetCount <= 1) return;
			this._walkParentLinks(target, newVal, oldVal, meta);
			if (hasGlobal) this._notifyGlobalWatchers(newVal, oldVal, prop, meta);
			return;
		}

		this._notifyTarget(target, prop, newVal, oldVal, meta);
		const hasGlobal = this._globalWatchers.size > 0;
		const parentLinks = this._parentLinks.get(target);
		if (!parentLinks || !parentLinks.length) {
			if (hasGlobal) this._notifyGlobalWatchers(newVal, oldVal, prop, meta);
			return;
		}
		if (!hasGlobal && this._targetWatcherTargetCount <= 1) return;
		this._walkParentLinks(target, newVal, oldVal, meta);
		if (hasGlobal) this._notifyGlobalWatchers(newVal, oldVal, prop, meta);
	}

	_notify(path, newVal, oldVal, meta = {}) {
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
							if (hadKey) self._unlinkTargetFromParent(oldVal, obj, String(key));
							obj.set(key, wrapped);
							self._devCapture('map:set', childPath, oldVal, wrapped, { type: 'map:set' });
							self._bubbleTargetNotify(obj, key, wrapped, oldVal, { type: 'map:set' });
							
							if (obj.size !== oldSize) {
								self._bubbleTargetNotify(obj, MiniX_State.SIZE_KEY, obj.size, oldSize, { type: 'map:set' });
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
								self._unlinkTargetFromParent(oldVal, obj, String(key));
								self._devCapture('map:delete', childPath, oldVal, undefined, { type: 'map:delete' });
								self._bubbleTargetNotify(obj, key, undefined, oldVal, { type: 'map:delete' });
								self._bubbleTargetNotify(obj, MiniX_State.SIZE_KEY, obj.size, oldSize, { type: 'map:delete' });
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
						oldVal.forEach((value, key) => self._unlinkTargetFromParent(value, obj, String(key)));
						obj.clear();
						self._devCapture('map:clear', basePath, oldVal, obj, { type: 'map:clear' });
						self._bubbleTargetNotify(obj, MiniX_State.ITERATE_KEY, obj, oldVal, { type: 'map:clear' });
						self._bubbleTargetNotify(obj, MiniX_State.SIZE_KEY, obj.size, oldVal.size, { type: 'map:clear' });
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
						obj.add(wrapped);
						if (!had) {
							self._devCapture('set:add', basePath, undefined, wrapped, { type: 'set:add', value: wrapped });
							self._bubbleTargetNotify(obj, MiniX_State.ITERATE_KEY, obj, obj, { type: 'set:add', value: wrapped });
							self._bubbleTargetNotify(obj, MiniX_State.SIZE_KEY, obj.size, obj.size - 1, { type: 'set:add' });
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
						const deleted = (hasValue || hasWrapped) && obj.delete(storedValue);
						if (deleted) {
							self._devCapture('set:delete', basePath, storedValue, undefined, { type: 'set:delete', value: storedValue });
							self._bubbleTargetNotify(obj, MiniX_State.ITERATE_KEY, obj, obj, { type: 'set:delete', value: storedValue });
							self._bubbleTargetNotify(obj, MiniX_State.SIZE_KEY, obj.size, obj.size + 1, { type: 'set:delete' });
						}
						return deleted;
					};
				}
				if (prop === 'clear') {
					return () => {
						if (!obj.size) return undefined;
						const oldSize = obj.size;
						self._devCapture('set:clear', basePath, [...obj], undefined, { type: 'set:clear' });
						obj.clear();
						self._bubbleTargetNotify(obj, MiniX_State.ITERATE_KEY, obj, obj, { type: 'set:clear' });
						self._bubbleTargetNotify(obj, MiniX_State.SIZE_KEY, obj.size, oldSize, { type: 'set:clear' });
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
						const nextArgs = args.length ? [this._unwrapProxy(args[0]), ...args.slice(1)] : args;
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
									this._linkTargetToParent(obj[i], obj, String(i));
								}
							} else if (prop === 'pop') {
								this._unlinkTargetFromParent(oldSnapshot[oldSnapshot.length - 1], obj, String(oldSnapshot.length - 1));
							} else if (prop === 'shift') {
								// Unlink removed head; re-key remaining items (indices shifted by -1).
								this._unlinkTargetFromParent(oldSnapshot[0], obj, '0');
								for (let i = 0; i < obj.length; i++) {
									this._linkTargetToParent(obj[i], obj, String(i));
								}
							} else if (prop === 'unshift') {
								// Link only the newly prepended items; re-key all (indices shifted by +n).
								for (let i = 0; i < obj.length; i++) {
									this._linkTargetToParent(obj[i], obj, String(i));
								}
							} else {
								// sort, reverse, splice: full relink.
								for (let i = 0; i < oldSnapshot.length; i++) {
									this._unlinkTargetFromParent(oldSnapshot[i], obj, String(i));
								}
								for (let i = 0; i < obj.length; i++) {
									this._linkTargetToParent(obj[i], obj, String(i));
								}
							}
							this._devCapture(`array:${prop}`, basePath, oldSnapshot, obj.slice(), { type: `array:${prop}` });
							this._bubbleTargetNotify(obj, MiniX_State.ITERATE_KEY, proxy, oldSnapshot, { type: `array:${prop}` });
							this._bubbleTargetNotify(obj, 'length', obj.length, oldSnapshot.length, { type: `array:${prop}` });
							return result;
						} finally {
							MiniX_Effect._endBatch();
						}
					};
				}

				const value = obj[prop];
				
				const hasEffect = MiniX_Effect.activeEffect !== null;
				if (hasEffect && typeof prop === 'string') this._trackTargetEffect(obj, prop);
				if (!this._isWrappable(value)) return value;
				
				return this._wrap(value, this._joinPath(basePath, prop), true);
			},
			set: (obj, prop, value) => {
				value = this._unwrapProxy(value);
				const hadKey = Object.prototype.hasOwnProperty.call(obj, prop);
				const oldVal = obj[prop];
				const isWrap = this._isWrappable(value);
				
				const wrapped = isWrap ? this._wrap(value, this._joinPath(basePath, prop), true) : value;
				if (hadKey && Object.is(oldVal, wrapped)) return true;
				if (hadKey) this._unlinkTargetFromParent(oldVal, obj, String(prop));
				obj[prop] = wrapped;
				if (this._dev) this._devCapture('set', this._joinPath(basePath, prop), oldVal, wrapped, { type: 'set' });
				
				this._bubbleTargetNotify(obj, prop, wrapped, oldVal, isArray && prop === 'length'
					? { type: 'set', affectsLength: true }
					: MiniX_State._META_SET);
				if (!hadKey && !isArray) {
					this._bubbleTargetNotify(obj, MiniX_State.ITERATE_KEY, obj, obj, { type: 'set', structural: true });
				}
				return true;
			},
			deleteProperty: (obj, prop) => {
				const oldVal = obj[prop];
				if (isArray && this._isArrayIndex(prop) && prop in obj) {
					const oldSnapshot = obj.slice();
					Array.prototype.splice.call(obj, Number(prop), 1);
					for (let i = 0; i < oldSnapshot.length; i++) {
						this._unlinkTargetFromParent(oldSnapshot[i], obj, String(i));
					}
					for (let i = 0; i < obj.length; i++) {
						this._linkTargetToParent(obj[i], obj, String(i));
					}
					if (this._dev) this._devCapture('array:delete', this._joinPath(basePath, prop), oldVal, undefined, { type: 'array:delete' });
					this._bubbleTargetNotify(obj, prop, undefined, oldVal, { type: 'array:delete' });
					this._bubbleTargetNotify(obj, MiniX_State.ITERATE_KEY, proxy, oldSnapshot, { type: 'array:delete' });
					this._bubbleTargetNotify(obj, 'length', obj.length, oldSnapshot.length, { type: 'array:delete' });
					return true;
				}
				const hadKey = Object.prototype.hasOwnProperty.call(obj, prop);
				if (!hadKey) return true;
				const ok = delete obj[prop];
				if (ok) {
					this._unlinkTargetFromParent(oldVal, obj, String(prop));
					if (this._dev) this._devCapture('delete', this._joinPath(basePath, prop), oldVal, undefined, { type: 'delete' });
					this._bubbleTargetNotify(obj, prop, undefined, oldVal, { type: 'delete' });
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
		let current = this._state?.__raw || this._state;
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
		const rawState = this._state?.__raw || this._state;
		const keys = segments || this._getPathSegments(path);
		let current = rawState;
		for (let i = 0; i < keys.length - 1; i++) {
			if (current == null) return;
			current = current instanceof Map ? current.get(keys[i]) : current[keys[i]];
		}
		if (current && typeof current === 'object') {
			this._proxyPathMap.delete(current);
			
			try { if (current.__minix_proxy__ !== undefined) current.__minix_proxy__ = undefined; } catch (_) {}
		}
	}
	set(path, value) {
		value = this._unwrapProxy(value);
		const rawState = this._state?.__raw || this._state;
		const compiled = this._compilePath(path);
		const { raw, segments, isSimple, last } = compiled;
		if (!segments.length) throw new Error('Path is required');

		if (isSimple) {
			const hadKey = Object.prototype.hasOwnProperty.call(rawState, last);
			const oldVal = rawState[last];
			if (hadKey && Object.is(oldVal, value)) return value;
			if (hadKey) this._unlinkTargetFromParent(oldVal, rawState, String(last));
			rawState[last] = value;
			if (this._dev) this._devCapture('set', raw, oldVal, value, { type: 'set:path', api: 'set()' });
			this._bubbleTargetNotify(rawState, last, value, oldVal, MiniX_State._META_SET_PATH);
			if (!hadKey && !Array.isArray(rawState)) {
				this._bubbleTargetNotify(rawState, MiniX_State.ITERATE_KEY, rawState, rawState, { type: 'set:path', structural: true });
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
						next = /^\d+$/.test(String(nextKey)) ? [] : {};
						parent.set(key, next);
					}
					parent = next;
					continue;
				}
				if (!this._isObject(parent[key])) parent[key] = /^\d+$/.test(String(nextKey)) ? [] : {};
				parent = parent[key];
			}
		}

		const hadKey = parent instanceof Map ? parent.has(last) : Object.prototype.hasOwnProperty.call(parent, last);
		const oldVal = parent instanceof Map ? parent.get(last) : parent[last];
		if (hadKey && Object.is(oldVal, value)) return value;

		if (hadKey) this._unlinkTargetFromParent(oldVal, parent, String(last));
		if (parent instanceof Map) parent.set(last, value);
		else parent[last] = value;

		this._invalidateProxyCache(raw, segments);
		if (this._dev) this._devCapture('set', raw, oldVal, value, { type: 'set:path', api: 'set()' });
		this._bubbleTargetNotify(parent, last, value, oldVal, MiniX_State._META_SET_PATH);
		if (!hadKey && !(parent instanceof Map) && !Array.isArray(parent)) {
			this._bubbleTargetNotify(parent, MiniX_State.ITERATE_KEY, parent, parent, { type: 'set:path', structural: true });
		}
		return value;
	}
	delete(path) {
		const compiled = this._compilePath(path);
		const { raw, segments, last } = compiled;
		const parentSegments = segments.length > 1 ? segments.slice(0, -1) : null;
		let parent = this._state;
		if (parentSegments) {
			for (const key of parentSegments) {
				if (parent == null) return false;
				parent = parent instanceof Map ? parent.get(key) : parent[key];
			}
		}
		if (parent instanceof Map) {
			if (!parent.has(last)) return false;
			const oldVal = parent.get(last);
			const ok = parent.delete(last);
			if (ok) {
				this._unlinkTargetFromParent(oldVal, parent, String(last));
				this._devCapture('delete', raw, oldVal, undefined, { type: 'delete:path', api: 'delete()' });
				this._bubbleTargetNotify(parent, last, undefined, oldVal, { type: 'delete:path' });
			}
			return ok;
		}
		
		
		
		
		
		const rawParent = (parent && typeof parent === 'object' && parent.__raw) ? parent.__raw : parent;
		if (!rawParent || !Object.prototype.hasOwnProperty.call(rawParent, last)) return false;
		if (Array.isArray(rawParent) && this._isArrayIndex(last)) {
			const oldSnapshot = rawParent.slice();
			const oldVal = rawParent[last];
			Array.prototype.splice.call(rawParent, Number(last), 1);
			for (let i = 0; i < oldSnapshot.length; i++) {
				this._unlinkTargetFromParent(oldSnapshot[i], rawParent, String(i));
			}
			for (let i = 0; i < rawParent.length; i++) {
				this._linkTargetToParent(rawParent[i], rawParent, String(i));
			}
			this._devCapture('array:delete', raw, oldVal, undefined, { type: 'array:delete', api: 'delete()' });
			this._bubbleTargetNotify(rawParent, last, undefined, oldVal, { type: 'array:delete' });
			this._bubbleTargetNotify(rawParent, MiniX_State.ITERATE_KEY, rawParent, oldSnapshot, { type: 'array:delete' });
			this._bubbleTargetNotify(rawParent, 'length', rawParent.length, oldSnapshot.length, { type: 'array:delete' });
			return true;
		}
		const oldVal = rawParent[last];
		const ok = delete rawParent[last];
		if (ok) {
			this._unlinkTargetFromParent(oldVal, rawParent, String(last));
			this._devCapture('delete', raw, oldVal, undefined, { type: 'delete:path', api: 'delete()' });
			this._bubbleTargetNotify(rawParent, last, undefined, oldVal, { type: 'delete:path' });
			if (!Array.isArray(rawParent)) {
				this._bubbleTargetNotify(rawParent, MiniX_State.ITERATE_KEY, rawParent, rawParent, { type: 'delete:path', structural: true });
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
		const toRemove = [];
		for (const effect of this._trackedEffects) {
			if (effect && effect.active) effect.schedule();
			else toRemove.push(effect);
		}
		for (const effect of toRemove) this._trackedEffects.delete(effect);
		this._notify('', this._state, oldState, { type: 'reset' });
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
		const getter = () => {
			let current = this._state;
			for (const seg of segments) {
				if (current == null) return undefined;
				current = current instanceof Map ? current.get(seg) : current[seg];
			}
			return current;
		};
		const snapshot = (value) => (value && typeof value === 'object') ? this._clone(value) : value;
		let initialized = false;
		let oldVal;
		const effect = new MiniX_Effect(() => {
			const newVal = getter();
			if (!initialized) { initialized = true; oldVal = snapshot(newVal); return; }
			if ((newVal === null || typeof newVal !== 'object') && Object.is(newVal, oldVal)) return;
			const prev = oldVal;
			oldVal = snapshot(newVal);
			callback(newVal, prev, key, { type: 'watch' });
		}, { flush: 'post' });
		return () => effect.stop();
	}
}



MiniX_State._notifyQueue = new Set();


MiniX_State._STRUCTURAL_TYPES = new Set(['delete']);
MiniX_State._proxySet = new WeakSet();
MiniX_State._ARRAY_MUTATORS = new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse']);
MiniX_State._normalizeCache = new Map();
MiniX_State._compiledPathCache = new Map();
MiniX_State._pathArrayCache = new WeakMap();

MiniX_State._NodeClass = (typeof Node !== 'undefined') ? Node : null;


MiniX_State._META_SET_PATH = Object.freeze({ type: 'set:path' });
MiniX_State._META_SET      = Object.freeze({ type: 'set' });

MiniX_State._proxyDirectPaths = new WeakMap();
MiniX_State._proxyDirectOwners = new WeakMap();

MiniX_State._cbIdCounter = 0;
MiniX_State._suppressDevCaptureDepth = 0;







function _minix_splitPipes(expr) {
	
	if (expr.indexOf('|') === -1) return [expr];
	const parts = [];
	let depth = 0;
	let inStr = null;
	let segStart = 0; 
	for (let i = 0; i < expr.length; i++) {
		const ch = expr[i];
		if (inStr) {
			// Count consecutive backslashes before this char; an even count means the quote is unescaped.
			if (ch === inStr) {
				let backslashes = 0;
				let j = i - 1;
				while (j >= 0 && expr[j] === '\\') { backslashes++; j--; }
				if (backslashes % 2 === 0) inStr = null;
			}
		} else if (ch === '"' || ch === "'" || ch === '`') {
			inStr = ch;
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

const _minix_scopeProxyCache = new WeakMap();
function _minix_createEvalScope(scope) {
	if (!scope || typeof scope !== 'object') scope = Object.create(null);
	let proxy = _minix_scopeProxyCache.get(scope);
	if (proxy) return proxy;
	proxy = new Proxy(scope, {
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
	_minix_scopeProxyCache.set(scope, proxy);
	return proxy;
}



const _minix_camelToKebab = (() => {
	const cache = new Map();
	return (prop) => {
		let kebab = cache.get(prop);
		if (kebab === undefined) {
			kebab = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
			if (cache.size >= 500) cache.delete(cache.keys().next().value);
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
	const keysA = Object.keys(a);
	const keysB = Object.keys(b);
	if (keysA.length !== keysB.length) return false;
	for (let i = 0; i < keysA.length; i++) {
		const key = keysA[i];
		if (!Object.is(a[key], b[key])) return false;
	}
	return true;
}



const _minix_SIMPLE_PATH_RE = /^[A-Za-z_$][\w$]*(?:\.(?:[A-Za-z_$][\w$]*|\d+)|\[(?:\d+|["'][^"']+["'])\])*$/u;

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
			if (MiniX_Renderer._simpleGetterCache.size >= 4000) MiniX_Renderer._simpleGetterCache.delete(MiniX_Renderer._simpleGetterCache.keys().next().value);
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
			if (cache.size >= 2000) cache.delete(cache.keys().next().value);
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
					if (MiniX_Renderer._evalFallbackCache.size >= 1000) MiniX_Renderer._evalFallbackCache.delete(MiniX_Renderer._evalFallbackCache.keys().next().value);
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
			parts.push({ expr, pipes, getter: !pipes && _minix_SIMPLE_PATH_RE.test(expr) ? this._compileSimpleGetter(expr) : null });
			lastIndex = match.index + match[0].length;
		}
		if (lastIndex < key.length) parts.push(key.slice(lastIndex));
		compiled = parts.length ? parts : [key];
		if (MiniX_Renderer._templateCache.size >= 4000) MiniX_Renderer._templateCache.delete(MiniX_Renderer._templateCache.keys().next().value);
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
		let out = '';
		for (const part of compiled) {
			if (typeof part === 'string') { out += part; continue; }
			let value = part.getter ? part.getter(scope, '') : this.evaluate(part.expr, scope, '');
			if (part.pipes && this.modifiers) {
				for (const pipeName of part.pipes) {
					const handler = this.modifiers.get(pipeName);
					if (handler) { try { value = handler({ value }); } catch (_) { } }
				}
			}
			out += value == null ? '' : String(value);
		}
		return out;
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

		if (typeof document !== 'undefined' && document.createElement) {
			const tpl = document.createElement('template');
			tpl.innerHTML = rawTemplate;







			const forAndIgnoreEls = [
				...tpl.content.querySelectorAll('[x-for], [x-ignore]')
			];

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
				elements.forEach((el) => {
					[...(el.attributes || [])].forEach((attr) => {
						if (attr.value && attr.value.includes('{{')) {
							el.setAttribute(attr.name, protectMustaches(attr.value));
						}
					});
				});
			};

			forAndIgnoreEls.forEach(protectSubtree);

			safeTemplate = tpl.innerHTML;
		} else {

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
		placeholderMap.forEach((original, token) => {
			html = html.split(token).join(original);
		});
		const sanitizer = options.sanitizer || this.options.sanitizer;
		if (sanitizer?.sanitize) html = sanitizer.sanitize(html, options.sanitizeConfig || {});
		return html;
	}
}


MiniX_Renderer._simpleGetterCache = new Map();
MiniX_Renderer._evalCache = new Map();
MiniX_Renderer._evalFallbackCache = new Map();
MiniX_Renderer._templateCache = new Map();

class MiniX_Event_Bus {
	constructor() {
		this._events = new Map();
		this._wildcards = new Set();
	}
	on(name, callback) {
		if (name === '*') {
			this._wildcards.add(callback);
			return () => this._wildcards.delete(callback);
		}
		if (!this._events.has(name)) this._events.set(name, new Set());
		this._events.get(name).add(callback);
		return () => this.off(name, callback);
	}
	once(name, callback) {
		const off = this.on(name, (event) => { off(); callback(event); });
		return off;
	}
	off(name, callback) {
		if (name === '*') return this._wildcards.delete(callback);
		const set = this._events.get(name);
		if (!set) return false;
		const ok = set.delete(callback);
		if (!set.size) this._events.delete(name);
		return ok;
	}
	emit(name, payload = null, meta = {}) {
		const event = { name, payload, meta, timestamp: Date.now() };
		const set = this._events.get(name);
		// ES2015+ Set iteration is safe when entries are deleted mid-iteration
		// (e.g. by `once` handlers), so no snapshot copy is needed.
		if (set) {
			for (const cb of set) {
				try { cb(event); }
				catch (err) { console.error('[MiniX_Event_Bus] Listener threw:', err); }
			}
		}
		if (this._wildcards.size) {
			for (const cb of this._wildcards) {
				try { cb(event); }
				catch (err) { console.error('[MiniX_Event_Bus] Wildcard listener threw:', err); }
			}
		}
		return event;
	}
}

class MiniX_Sanitizer {
	constructor(options = {}) {
		this.options = {



			allowedTags: [

				'main', 'section', 'article', 'aside', 'header', 'footer', 'nav', 'details', 'summary',

				'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
				'p', 'span', 'div', 'a', 'abbr', 'b', 'i', 'em', 'strong', 'small', 'mark', 'del', 'ins',
				'sub', 'sup', 'blockquote', 'q', 'cite', 'pre', 'code', 'kbd', 'samp', 'var', 'br', 'hr',
				'time', 'address',

				'ul', 'ol', 'li', 'dl', 'dt', 'dd',

				'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',

				'form', 'fieldset', 'legend', 'label', 'input', 'textarea', 'select', 'option',
				'optgroup', 'button', 'datalist', 'output', 'progress', 'meter',

				'img', 'figure', 'figcaption', 'picture', 'source', 'audio', 'video', 'track',

				'template', 'slot',
			],
			allowedAttributes: {

				'*': ['class', 'id', 'style', 'title', 'lang', 'dir', 'hidden', 'tabindex',
					'aria-label', 'aria-labelledby', 'aria-describedby', 'aria-hidden',
					'aria-expanded', 'aria-controls', 'aria-live', 'aria-atomic',
					'aria-checked', 'aria-disabled', 'aria-selected', 'aria-pressed',
					'role', 'data-*', 'x-*', '@*', ':*'],
				a: ['href', 'title', 'target', 'rel', 'download'],
				img: ['src', 'alt', 'width', 'height', 'loading', 'decoding', 'srcset', 'sizes'],
				input: ['type', 'name', 'value', 'placeholder', 'checked', 'disabled',
					'readonly', 'required', 'min', 'max', 'step', 'maxlength',
					'minlength', 'pattern', 'autocomplete', 'autofocus', 'multiple', 'accept'],
				textarea: ['name', 'placeholder', 'rows', 'cols', 'disabled', 'readonly',
					'required', 'maxlength', 'minlength', 'autocomplete', 'autofocus', 'wrap'],
				select: ['name', 'disabled', 'required', 'multiple', 'autofocus', 'size'],
				option: ['value', 'selected', 'disabled'],
				optgroup: ['label', 'disabled'],
				button: ['type', 'name', 'value', 'disabled', 'autofocus'],
				form: ['action', 'method', 'enctype', 'novalidate', 'autocomplete', 'target'],
				label: ['for'],
				fieldset: ['disabled', 'name'],
				table: ['summary', 'border', 'cellpadding', 'cellspacing'],
				th: ['scope', 'colspan', 'rowspan', 'abbr'],
				td: ['colspan', 'rowspan', 'headers'],
				col: ['span'],
				colgroup: ['span'],
				time: ['datetime'],
				track: ['kind', 'src', 'srclang', 'label', 'default'],
				source: ['src', 'srcset', 'sizes', 'type', 'media'],
				audio: ['src', 'controls', 'autoplay', 'loop', 'muted', 'preload'],
				video: ['src', 'controls', 'autoplay', 'loop', 'muted', 'preload',
					'width', 'height', 'poster', 'playsinline'],
				details: ['open'],
				meter: ['value', 'min', 'max', 'low', 'high', 'optimum'],
				progress: ['value', 'max'],
				template: ['x-for', ':key', 'x-bind:key'],
				slot: ['name'],
			},
			...options
		};
	}
	static _UNSAFE_URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'action', 'formaction', 'data']);
	hasDOMPurify() { return typeof window !== 'undefined' && typeof window.DOMPurify !== 'undefined'; }

	_buildAttrLookup(allowedAttributes) {
		
		if (this._attrLookupCache && this._attrLookupRef === allowedAttributes) {
			return this._attrLookupCache;
		}
		const lookup = {};
		for (const [tag, attrs] of Object.entries(allowedAttributes)) {
			const exact = new Set();
			const wildcards = [];
			for (const pattern of attrs) {
				if (pattern.endsWith('*')) wildcards.push(pattern.slice(0, -1));
				else exact.add(pattern);
			}
			lookup[tag] = { exact, wildcards };
		}
		this._attrLookupRef = allowedAttributes;
		this._attrLookupCache = lookup;
		return lookup;
	}

	sanitize(html, config = {}) {
		const input = String(html ?? '');
		if (this.hasDOMPurify()) {
			const allowedTags = config.allowedTags || this.options.allowedTags || [];
			const allowedAttributes = config.allowedAttributes || this.options.allowedAttributes || {};
			const addTags = Array.from(new Set(allowedTags.filter((tag) => typeof tag === 'string' && tag && !tag.includes('*'))));
			const addAttr = new Set();
			for (const attrs of Object.values(allowedAttributes)) {
				for (const attr of (Array.isArray(attrs) ? attrs : [])) {
					if (typeof attr !== 'string' || !attr || attr.includes('*')) continue;
					addAttr.add(attr);
				}
			}
			const merged = {
				...config,
				ADD_TAGS: [...new Set([...(Array.isArray(config.ADD_TAGS) ? config.ADD_TAGS : []), ...addTags])],
				ADD_ATTR: (attributeName, tagName) => {
					if (typeof config.ADD_ATTR === 'function' && config.ADD_ATTR(attributeName, tagName)) return true;
					if (Array.isArray(config.ADD_ATTR) && config.ADD_ATTR.includes(attributeName)) return true;
					if (addAttr.has(attributeName)) return true;
					if (/^(data-|aria-)/.test(attributeName)) return true;
					if (/^(x-|@|:)/.test(attributeName)) return true;
					return false;
				},
				CUSTOM_ELEMENT_HANDLING: {
					tagNameCheck: (tagName) => {
						const custom = config.CUSTOM_ELEMENT_HANDLING?.tagNameCheck;
						if (custom instanceof RegExp) return custom.test(tagName);
						if (typeof custom === 'function') return !!custom(tagName);
						return false;
					},
					attributeNameCheck: (attr, tagName) => {
						const custom = config.CUSTOM_ELEMENT_HANDLING?.attributeNameCheck;
						if (custom instanceof RegExp && custom.test(attr)) return true;
						if (typeof custom === 'function' && custom(attr, tagName)) return true;
						if (addAttr.has(attr)) return true;
						if (/^(data-|aria-)/.test(attr)) return true;
						if (/^(x-|@|:)/.test(attr)) return true;
						return false;
					},
					allowCustomizedBuiltInElements: config.CUSTOM_ELEMENT_HANDLING?.allowCustomizedBuiltInElements ?? false,
				},
			};
			return window.DOMPurify.sanitize(input, merged);
		}
		return this._fallback(input, config);
	}
	escapeHTML(value) {
		return String(value).replace(/[&<>"']/g, (ch) => {
			switch (ch) {
				case '&': return '&amp;';
				case '<': return '&lt;';
				case '>': return '&gt;';
				case '"': return '&quot;';
				default:  return '&#039;';
			}
		});
	}
	_fallback(html, config = {}) {
		if (typeof document === 'undefined' || !document.createElement) {
			return this.escapeHTML(html);
		}
		const allowedTags = config.allowedTags || this.options.allowedTags;
		const allowedAttributes = config.allowedAttributes || this.options.allowedAttributes;

		const tagSet = new Set(allowedTags);
		const attrLookup = this._buildAttrLookup(allowedAttributes);
		const globalLookup = attrLookup['*'] || { exact: new Set(), wildcards: [] };

		const isAttrAllowed = (tag, attrName) => {
			const tagLookup = attrLookup[tag] || { exact: new Set(), wildcards: [] };
			if (globalLookup.exact.has(attrName) || tagLookup.exact.has(attrName)) return true;
			for (const prefix of globalLookup.wildcards) { if (attrName.startsWith(prefix)) return true; }
			for (const prefix of tagLookup.wildcards) { if (attrName.startsWith(prefix)) return true; }
			return false;
		};

		const template = document.createElement('template');
		template.innerHTML = html;
		const clean = (node) => {
			if (node.nodeType === Node.TEXT_NODE) return;
			if (node.nodeType !== Node.ELEMENT_NODE) { node.remove(); return; }
			const tag = node.tagName.toLowerCase();
			if (!tagSet.has(tag)) {
				node.replaceWith(document.createTextNode(node.textContent || ''));
				return;
			}
			[...node.attributes].forEach((attr) => {
				const attrName = attr.name.toLowerCase();
				const attrValue = String(attr.value || '').trim();
				const unsafeUrlAttr = MiniX_Sanitizer._UNSAFE_URL_ATTRS.has(attrName) && /^(javascript:|data:text\/html)/i.test(attrValue);
				const unsafeStyle = attrName === 'style' && /url\s*\(\s*(['"]?)\s*javascript:|expression\s*\(/i.test(attrValue);
				if (!isAttrAllowed(tag, attrName) || unsafeUrlAttr || unsafeStyle) node.removeAttribute(attr.name);
			});
			[...node.childNodes].forEach(clean);
		};
		[...template.content.childNodes].forEach(clean);
		return template.innerHTML;
	}
}

class MiniX_Provider {
	constructor(parent = null) {
		this.parent = parent;
		this.registry = new Map();
	}
	provide(key, value) {
		this.registry.set(key, value);
		return () => this.registry.delete(key);
	}
	inject(key, fallback = undefined) {
		
		
		let node = this;
		while (node) {
			if (node.registry.has(key)) return node.registry.get(key);
			node = node.parent;
		}
		return fallback;
	}
	createChild() { return new MiniX_Provider(this); }
}

class MiniX_Plugin {
	constructor(options = {}) {
		this.name = options.name || 'anonymous-plugin';
		this.version = options.version || '1.0.0';
		this.meta = options.meta || {};
		this.installed = false;
	}
	install(app) { this.installed = true; return app; }
	uninstall(app) { this.installed = false; return app; }
	static addScope(app, scopeFactory) {
		if (app && typeof app.addScope === 'function') app.addScope(scopeFactory);
		return app;
	}
	static define(definition = {}) {
		return {
			name: definition.name || 'anonymous-plugin',
			version: definition.version || '1.0.0',
			meta: definition.meta || {},
			install: typeof definition.install === 'function'
				? function(app) {
					const api = {
						addScope: (scopeFactory) => {
							if (app && typeof app.addScope === 'function') app.addScope(scopeFactory);
							return app;
						}
					};
					return definition.install.call(api, app) || app;
				}
				: () => { },
			uninstall: typeof definition.uninstall === 'function' ? definition.uninstall : () => { }
		};
	}
}

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
			if (MiniX_Listener._exprFnCache.size >= 4000) MiniX_Listener._exprFnCache.delete(MiniX_Listener._exprFnCache.keys().next().value);
			MiniX_Listener._exprFnCache.set(cacheKey, fn);
		}
		if (!fn) throw new SyntaxError(`Failed to compile expression: ${expression}`);
		return (extraScope = {}) => {
			const runtimeScope = Object.create(scope && typeof scope === 'object' ? scope : null);
			Object.assign(runtimeScope, extraScope);
			return fn(_minix_createEvalScope(runtimeScope));
		};
	}

	_runStatement(expression, scope = {}) {
		const cacheKey = String(expression);
		let fn = MiniX_Listener._stmtFnCache.get(cacheKey);
		if (fn === undefined) {
			try {
				fn = new Function('__scope__', `with(__scope__) { ${expression} }`);
			} catch (_) {
				fn = null; 
			}
			if (MiniX_Listener._stmtFnCache.size >= 2000) MiniX_Listener._stmtFnCache.delete(MiniX_Listener._stmtFnCache.keys().next().value);
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

		const scheduleSubscribers = () => {
			for (const effect of descriptor.subscribers) {
				if (effect?.active) effect.schedule();
				else descriptor.subscribers.delete(effect);
			}
		};

		const api = {
			get: () => {
				const active = typeof MiniX_Effect !== 'undefined' ? MiniX_Effect.activeEffect : null;
				if (active) {
					descriptor.subscribers.add(active);
					// Clean up stopped effects lazily to avoid a leak
					if (!active.active) descriptor.subscribers.delete(active);
				}

				if (!descriptor.effect) {
					descriptor.effect = new MiniX_Effect(() => getter.call(context), {
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
		const id = setTimeout(() => { callback(); this._timers.delete(id); }, delay);
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
		
		for (const fn of this._cleanups) fn();
		this._cleanups.clear();
		for (const fn of this._watcherCleanups) fn();
		this._watcherCleanups.clear();
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

class MiniX_Signal {
	constructor(initial = { version: 0 }) {
		this._watchers = new Map();
		this._globalWatchers = new Set();
		this._effectRunnerMap = new WeakMap();
		this._state = { ...initial };
	}

	_trackEffect(path) {
		if (typeof MiniX_Effect === 'undefined') return;
		const effect = MiniX_Effect.activeEffect;
		if (!effect) return;
		const key = typeof path === 'string' ? path : String(path || '');
		let watchers = this._watchers.get(key);
		if (!watchers) {
			watchers = new Set();
			this._watchers.set(key, watchers);
		}
		let keyMap = this._effectRunnerMap.get(effect);
		if (!keyMap) {
			keyMap = new Map();
			this._effectRunnerMap.set(effect, keyMap);
		}
		const tv = effect._trackVersion;
		if (keyMap.has(key)) {
			
			const existingDep = keyMap.get(key).__dep;
			if (existingDep) existingDep._trackedVersion = tv;
			return;
		}
		const runner = () => effect.schedule();
		runner.__minix_effect__ = effect;
		watchers.add(runner);
		keyMap.set(key, runner);
		if (!effect.deps) effect.deps = new Set();
		const dep = { state: this, key, runner, _trackedVersion: tv };
		runner.__dep = dep;
		effect.deps.add(dep);
		effect._depsDirty = true;
	}

	get(path, fallback = undefined) {
		const key = typeof path === 'string' ? path : String(path || '');
		this._trackEffect(key);
		const value = this._state[key];
		return value === undefined ? fallback : value;
	}

	set(path, value) {
		const key = typeof path === 'string' ? path : String(path || '');
		const hadKey = Object.prototype.hasOwnProperty.call(this._state, key);
		const oldVal = this._state[key];
		if (hadKey && Object.is(oldVal, value)) return value;
		this._state[key] = value;
		this._notify(key, value, oldVal, MiniX_State._META_SET);
		return value;
	}

	increment(path = 'version') {
		const key = typeof path === 'string' ? path : String(path || 'version');
		const oldVal = Number(this._state[key] || 0);
		const nextVal = oldVal + 1;
		this._state[key] = nextVal;
		this._notify(key, nextVal, oldVal, { type: 'increment' });
		return nextVal;
	}

	_notify(pathKey, newVal, oldVal, meta = {}) {
		const globalWatchers = this._globalWatchers;
		const watchers = this._watchers.get(pathKey);
		
		
		if (!globalWatchers?.size) {
			if (!watchers) return;
			for (const cb of watchers) {
				const effect = cb.__minix_effect__;
				if (effect) { if (!effect._scheduled) effect.schedule(); }
				else {
					if (cb.__minix_cbid__ === undefined) cb.__minix_cbid__ = ++MiniX_State._cbIdCounter;
					MiniX_State._pendingCallbackQueue.set(`${cb.__minix_cbid__}:${pathKey}`, [cb, newVal, oldVal, pathKey, meta]);
				}
			}
			MiniX_State._scheduleCallbackFlush();
			return;
		}
		
		const queue = MiniX_State._notifyQueue;
		queue.clear();
		for (const cb of globalWatchers) queue.add(cb);
		if (watchers) for (const cb of watchers) queue.add(cb);
		for (const cb of queue) {
			const effect = cb.__minix_effect__;
			if (effect) { if (!effect._scheduled) effect.schedule(); }
			else {
				if (cb.__minix_cbid__ === undefined) cb.__minix_cbid__ = ++MiniX_State._cbIdCounter;
				MiniX_State._pendingCallbackQueue.set(`${cb.__minix_cbid__}:${pathKey}`, [cb, newVal, oldVal, pathKey, meta]);
			}
		}
		MiniX_State._scheduleCallbackFlush();
	}
}

class MiniX_Effect {
	static activeEffect = null;
	static _queues = { pre: new Set(), post: new Set(), frame: new Set() };
	static _flushing = false;
	static _framePending = false;
	static _flushPromise = null;
	static _batchDepth = 0;

	constructor(fn, options = {}) {
		if (typeof fn !== 'function') throw new Error('MiniX_Effect requires a function');
		this.fn = fn;
		this.lazy = options.lazy === true;
		this.scheduler = options.scheduler || null;
		this.flush = options.flush || 'pre';
		this.priority = Number.isFinite(options.priority) ? options.priority : 0;
		this.active = true;
		this.deps = null;  
		this._running = false;
		this._scheduled = false;
		this._seq = 0;
		this._depsDirty = false;
		
		this._phase = this.flush === 'post' ? 'post' : (this.flush === 'frame' ? 'frame' : 'pre');
		if (!this.lazy) this.run();
	}

	run() {
		if (!this.active || this._running) return;
		this._scheduled = false;
		
		this._trackVersion = ++MiniX_Effect._globalVersion;
		const prev = MiniX_Effect.activeEffect;
		MiniX_Effect.activeEffect = this;
		this._running = true;
		this._depsDirty = false;
		try {
			return this.fn();
		} finally {
			this._running = false;
			MiniX_Effect.activeEffect = prev;
			
			
			
			if (this.deps && this.deps.size > 0) this._pruneStale();
		}
	}

	_pruneStale() {
		if (!this.deps) return;
		const tv = this._trackVersion;
		const targetStates = new Set();
		for (const dep of this.deps) {
			if (dep._trackedVersion !== tv) {
				
				if (dep.depType === 'target') {
					targetStates.add(dep.state);
					dep.state._removeTargetWatcher?.(dep.target, dep.prop, dep.runner);
					
					const etm = dep.state._effectTargetRunnerMap;
					if (etm) {
						const effectTargets = etm.get(this);
						effectTargets?.get(dep.target)?.delete(dep.prop);
					}
				} else if (dep.state._watchers) {
					const set = dep.state._watchers.get(dep.key);
					if (set) set.delete(dep.runner);
					dep.state._effectRunnerMap?.get(this)?.delete(dep.key);
				}
				this.deps.delete(dep);
			}
		}
		for (const state of targetStates) state._untrackEffectIfDetached?.(this);
	}

	schedule() {
		if (!this.active) return;
		if (this.scheduler) return this.scheduler(this);
		if (this._scheduled) return;
		this._scheduled = true;
		this._seq = ++MiniX_Effect._seqCounter;
		MiniX_Effect._enqueue(this);
	}

	static _beginBatch() {
		MiniX_Effect._batchDepth++;
	}

	static _endBatch() {
		MiniX_Effect._batchDepth--;
		if (MiniX_Effect._batchDepth <= 0) {
			MiniX_Effect._batchDepth = 0;
			MiniX_Effect._scheduleFlush();
			MiniX_State._scheduleCallbackFlush();
		}
	}

	static _scheduleFlush() {
		if (MiniX_Effect._batchDepth > 0 || MiniX_Effect._flushPromise) return;
		MiniX_Effect._flushPromise = new Promise((resolve) =>
			MiniX_State._scheduleMicrotask(() => {
				MiniX_Effect._flushPromise = null;
				MiniX_Effect._flushAll();
				resolve();
			})
		);
	}

	static _enqueue(effect) {
		
		MiniX_Effect._queues[effect._phase].add(effect);
		if (effect._phase === 'frame') {
			if (!MiniX_Effect._framePending) {
				MiniX_Effect._framePending = true;
				MiniX_Effect._raf(() => {
					MiniX_Effect._framePending = false;
					MiniX_Effect._drainPhase('frame');
				});
			}
			return;
		}
		MiniX_Effect._scheduleFlush();
	}

	
	
	
	
	static _sortedBuffer = [];
	static _sortQueue(queue) {
		const buf = MiniX_Effect._sortedBuffer;
		buf.length = 0;
		for (const e of queue) buf.push(e);
		
		buf.sort((a, b) => {
			const pd = b.priority - a.priority;
			return pd !== 0 ? pd : a._seq - b._seq;
		});
		return buf;
	}

	static _drainPhase(name) {
		const queue = MiniX_Effect._queues[name];
		if (!queue.size) return;
		if (queue.size === 1) {
			const effect = queue.values().next().value;
			queue.clear();
			if (effect.active) {
				try { effect.run(); }
				catch (err) { console.error('[MiniX] Effect threw during flush:', err); }
			}
			return;
		}
		const items = MiniX_Effect._sortQueue(queue);
		queue.clear();
		try {
			for (let i = 0; i < items.length; i++) {
				const effect = items[i];
				if (effect.active) {
					try { effect.run(); }
					catch (err) { console.error('[MiniX] Effect threw during flush:', err); }
				}
			}
		} finally {
			items.length = 0;
		}
	}

	static _flushAll() {
		if (MiniX_Effect._flushing) return;
		MiniX_Effect._flushing = true;
		try {
			let guard = 0;
			while (MiniX_Effect._queues.pre.size || MiniX_Effect._queues.post.size) {
				if (++guard > 100) {
					console.warn('[MiniX_Effect] Flush loop exceeded 100 iterations — possible reactive cycle detected. Check for effects that mutate state they also read.');
					break;
				}
				const preSizeBefore = MiniX_Effect._queues.pre.size;
				const postSizeBefore = MiniX_Effect._queues.post.size;
				MiniX_Effect._drainPhase('pre');
				MiniX_Effect._drainPhase('post');
				// If no new effects were enqueued during this drain, we're done.
				if (MiniX_Effect._queues.pre.size === 0 && MiniX_Effect._queues.post.size === 0) break;
				// If queues are exactly the same size as before draining, we're in a hard cycle.
				if (MiniX_Effect._queues.pre.size >= preSizeBefore && MiniX_Effect._queues.post.size >= postSizeBefore
					&& (MiniX_Effect._queues.pre.size > 0 || MiniX_Effect._queues.post.size > 0)) {
					console.warn('[MiniX_Effect] Reactive cycle detected — queues are not shrinking. Aborting flush.');
					break;
				}
			}
		} finally {
			MiniX_Effect._flushing = false;
		}
	}

	_cleanupDeps() {
		if (!this.deps) return;
		const targetStates = new Set();
		for (const dep of this.deps) {
			if (dep.depType === 'target') {
				targetStates.add(dep.state);
				dep.state._removeTargetWatcher?.(dep.target, dep.prop, dep.runner);
				dep.state._effectTargetRunnerMap?.get(this)?.get(dep.target)?.delete(dep.prop);
			} else if (dep.state._watchers) {
				dep.state._watchers.get(dep.key)?.delete(dep.runner);
				dep.state._effectRunnerMap?.get(this)?.delete(dep.key);
			}
		}
		this.deps.clear();
		for (const state of targetStates) state._trackedEffects?.delete(this);
	}

	stop() {
		this._cleanupDeps();
		this.active = false;
		this._scheduled = false;
		for (const q of Object.values(MiniX_Effect._queues)) q.delete(this);
		return true;
	}
}

MiniX_Effect._seqCounter = 0;
MiniX_Effect._globalVersion = 0;

MiniX_Effect._raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb) => setTimeout(cb, 16);

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
		// Fast-path: all lowercase ASCII with no leading/trailing whitespace
		let clean = true;
		for (let i = 0; i < name.length; i++) {
			const c = name.charCodeAt(i);
			if (c >= 65 && c <= 90) { clean = false; break; }  // uppercase A-Z
			if (i === 0 || i === name.length - 1) {
				if (c === 32 || c === 9 || c === 10 || c === 13) { clean = false; break; }
			}
		}
		return clean ? name : name.trim().toLowerCase();
	}

	_warn(message, ...args) {
		if (!this.options.dev) return;
		console.warn(`[MiniX_Compiler] ${message}`, ...args);
	}

	_isSimplePath(expression) {
		return _minix_SIMPLE_PATH_RE.test(String(expression || '').trim());
	}

	_parseSimplePathSegments(expression) {
		return _minix_parseSimplePathSegments(expression);
	}

	_compileGetter(expression) {
		const expr = String(expression || '').trim();
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
				if (MiniX_Compiler._getterCache.size >= 5000) MiniX_Compiler._getterCache.delete(MiniX_Compiler._getterCache.keys().next().value);
				MiniX_Compiler._getterCache.set(expr, getter);
			}
			return getter;
		}
		let getter = MiniX_Compiler._getterCache.get(`expr:${expr}`);
		if (!getter) {
			getter = (scope, fallback = undefined) => this._evaluate(expr, scope, fallback);
			getter.__minix_expr__ = expr;
			if (MiniX_Compiler._getterCache.size >= 5000) MiniX_Compiler._getterCache.delete(MiniX_Compiler._getterCache.keys().next().value);
			MiniX_Compiler._getterCache.set(`expr:${expr}`, getter);
		}
		return getter;
	}

	_shallowEqual(a, b) { return _minix_shallowEqual(a, b); }

	_meaningfulSibling(node, direction) {
		let cursor = direction === 'next' ? node?.nextSibling : node?.previousSibling;
		
		while (cursor) {
			if (cursor.nodeType === Node.TEXT_NODE && !cursor.textContent.trim()) {
				cursor = direction === 'next' ? cursor.nextSibling : cursor.previousSibling;
				continue;
			}
			if (cursor.nodeType === Node.COMMENT_NODE) {
				cursor = direction === 'next' ? cursor.nextSibling : cursor.previousSibling;
				continue;
			}
			return cursor;
		}
		return null;
	}

	_nextMeaningfulSibling(node) { return this._meaningfulSibling(node, 'next'); }
	_previousMeaningfulSibling(node) { return this._meaningfulSibling(node, 'previous'); }

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
				
				for (const k in context) arg[k] = context[k];
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
			priority: Number.isFinite(options.priority) ? options.priority : 0,
			structural: Boolean(options.structural),
			aliases: Array.isArray(options.aliases) ? options.aliases.map((alias) => this._normalizeDirectiveName(alias)) : []
		};
		this.directives.set(normalized, record);
		record.aliases.forEach((alias) => this.directives.set(alias, record));
		return this;
	}

	useDirectives(definitions = {}) {
		Object.entries(definitions).forEach(([name, def]) => {
			if (typeof def === 'function') this.directive(name, def);
			else if (def && typeof def.handler === 'function') this.directive(name, def.handler, def);
		});
		return this;
	}

	createScope(component, extra = {}, el = null) {
		
		
		
		
		
		if (!MiniX_Compiler._globalMiniXResolved) {
			MiniX_Compiler._globalMiniXResolved = true;
			try {
				MiniX_Compiler._globalMiniX =
					(typeof window !== 'undefined' && window.MiniX) ||
					(typeof globalThis !== 'undefined' && globalThis.MiniX) ||
					null;
			} catch (_) { MiniX_Compiler._globalMiniX = null; }
		}
		const mx = MiniX_Compiler._globalMiniX;
		if (mx !== null) {
			try { mx.readGlobalScopeVersion?.(); } catch (_) {}
		}

		
		let hasExtra = false;
		if (extra !== null && extra !== undefined) {
			for (const _ in extra) { hasExtra = true; break; }
		}
		if (!hasExtra) {
			
			
			
			if (el) {
				const gen = MiniX_Compiler._scopeGen;
				const cached = el.__minix_scope_cache__;
				if (cached !== undefined && el.__minix_scope_cache_gen__ === gen) {
					return cached;
				}
				const resolved = this._resolveScope(component, false, gen, el);
				el.__minix_scope_cache__ = resolved;
				el.__minix_scope_cache_gen__ = gen;
				return resolved;
			}
			return this._resolveScope(component, false, MiniX_Compiler._scopeGen, el);
		}

		const baseScope = this._resolveScope(component, hasExtra, MiniX_Compiler._scopeGen, el);
		const scope = Object.create(baseScope);
		for (const k in extra) scope[k] = extra[k];
		return scope;
	}

	
	
	_resolveScope(component, _hasExtra, gen, el) {
		// If the component has no scope factories, no ancestor can have a
		// __minix_scope_provider__ stamped by this system, so skip the traversal.
		const hasScopeFactories = (component._scopeFactories && component._scopeFactories.length > 0) ||
			(component._localScopeFactories && component._localScopeFactories.length > 0);
		if (el && hasScopeFactories) {
			let cursor = el;
			while (cursor) {
				if (typeof cursor.__minix_scope_provider__ === 'function') {
					return cursor.__minix_scope_provider__();
				}
				cursor = cursor.parentNode || null;
			}
		}
		return component._createRenderScope({}, el);
	}

	_evaluate(expression, scope = {}, fallback = undefined) {

		
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
			pipeData = { base, pipes: pipes.length > 1 ? pipes.slice(1) : null, fn };
			if (MiniX_Compiler._pipeCache.size >= 2000) MiniX_Compiler._pipeCache.delete(MiniX_Compiler._pipeCache.keys().next().value);
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
			for (const pipeName of pipeNames) {
				const handler = this.modifiers.get(pipeName.trim().toLowerCase());
				if (handler) {
					try { value = handler({ value }); } catch (_) { }
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

	_walkElements(root) {
		const elements = [];

		const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);

		let node = walker.currentNode;
		while (node) {
			if (node.nodeType === Node.ELEMENT_NODE) {
				elements.push(node);

				if (
					node !== root && (
						node.hasAttribute('x-ignore') ||
						node.hasAttribute('x-component') ||
						node.hasAttribute('x-for') ||
						node.hasAttribute('x-portal') ||
						node.hasAttribute('x-teleport')
					)
				) {
					
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

	_collectDirectives(el) {
		const attrs = el.attributes || [];
		const attrNames = el.getAttributeNames ? el.getAttributeNames() : null;
		const count = attrNames ? attrNames.length : attrs.length;

		// Build signature from directive-relevant attributes only (x-*, @*, :*).
		// Including non-directive attrs (class, id, data-*) caused spurious cache misses.
		let signature = '';
		for (let i = 0; i < count; i++) {
			const name = attrNames ? attrNames[i] : attrs[i].name;
			const ch0 = name.charCodeAt(0);
			const isDirective = ch0 === 120 /* x */ || ch0 === 64 /* @ */ || ch0 === 58 /* : */;
			if (!isDirective) continue;
			if (signature) signature += '|';
			signature += name + '=' + (attrNames ? el.getAttribute(name) : attrs[i].value);
		}
		const cached = el.__minix_directives_cache__;
		if (cached && cached.signature === signature) return cached.value.slice();
		const resolved = [];
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

	_prepareCompileGraph(root) {
		const cached = root.__minix_graph_cache__;
		if (cached && cached.signature === root.innerHTML) return cached.value;
		const entries = [];
		const elements = this._walkElements(root);
		const conditionalSkip = new WeakSet();
		for (const el of elements) {
			const directives = this._collectDirectives(el);
			const entry = { el, directives, skip: false };
			if (conditionalSkip.has(el)) entry.skip = true;
			if (el !== root && el.closest('[data-x-once]')) entry.skip = true;
			if (el === root) {
				const isComponentHost = el.hasAttribute('x-component');
				if (isComponentHost || el.hasAttribute('x-for') || el.hasAttribute('x-portal') || el.hasAttribute('x-teleport')) entry.skip = true;
			}
			if (el !== root && el.closest('[x-component]') && el.closest('[x-component]') !== root && !el.hasAttribute('x-component')) entry.skip = true;
			if (el.hasAttribute('x-if')) {
				let cursor = this._nextMeaningfulSibling(el);
				while (cursor && cursor.nodeType === Node.ELEMENT_NODE && (cursor.hasAttribute('x-else-if') || cursor.hasAttribute('x-else'))) {
					conditionalSkip.add(cursor);
					cursor = this._nextMeaningfulSibling(cursor);
				}
			}
			entries.push(entry);
		}
		root.__minix_graph_cache__ = { signature: root.innerHTML, value: entries };
		return entries;
	}

	_compileTextDirective(el, expression, component) {
		const getter = this._compileGetter(expression);
		let lastText = undefined;
		return this._effect(component, () => {
			const scope = this.createScope(component, {}, el);
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
			const scope = this.createScope(component, {}, el);
			const raw = getter(scope, '');
			const nextRaw = raw == null ? '' : String(raw);
			if (nextRaw !== lastRaw) {
				lastRaw = nextRaw;
				lastSanitized = component.sanitizer.sanitize(nextRaw);
			}
			if (el.__minix_html_last__ !== lastSanitized) {
				if (typeof subtreeCleanup === 'function') {
					subtreeCleanup();
					subtreeCleanup = null;
				}
				if (el.innerHTML !== lastSanitized) el.innerHTML = lastSanitized;
				el.__minix_html_last__ = lastSanitized;
				subtreeCleanup = this.compile(el, component);
			}
		});
	}

	_compileShowDirective(el, expression, component) {
		
		
		
		const inlineDisplay = el.style.display;
		const originalDisplay = inlineDisplay === 'none' ? '' : (inlineDisplay || '');
		const getter = this._compileGetter(expression);
		let lastVisible = undefined;
		return this._effect(component, () => {
			const scope = this.createScope(component, {}, el);
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

		let lastBoundValue = Symbol('unset');
		return this._effect(component, () => {
			const value = this._evaluate(expression, this.createScope(component, {}, el));
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
		const mods = new Set(modifiers || []);

		
		const keyFilters = [];
		for (const mod of mods) {
			if (MiniX_Compiler._KEY_MAP[mod]) keyFilters.push(mod);
		}
		const hasKeyFilter = keyFilters.length > 0;


		const listener = (event) => {
			if (mods.has('self') && event.target !== el) return;
			
			
			if (hasKeyFilter) {
				const pressedKey = event.key;
				const matched = keyFilters.some((m) =>
					MiniX_Compiler._KEY_MAP[m]?.some((k) => k === pressedKey)
				);
				if (!matched) return;
			}
			if (mods.has('prevent')) event.preventDefault();
			if (mods.has('stop')) event.stopPropagation();
			
			
			const liveScope = this.createScope(component, {}, el);
			const fireScope = Object.create(liveScope);
			fireScope.$event = event;
			fireScope.event  = event;
			fireScope.$el    = el;
			fireScope.el     = el;
			const result = this._evaluate(expression, fireScope);
			
			
			if (typeof result === 'function') result.call(fireScope, event);
			// Note: 'once' for non-delegated path is handled below at addEventListener level
		};
		const delegateRoot = this._shouldDelegateEvent(eventName, mods) ? this._getDelegatedEventRoot(component) : null;
		if (delegateRoot) {
			const delegated = this._ensureDelegatedEventRoot(delegateRoot, eventName);
			let list = delegated.handlers.get(el);
			if (!list) { list = []; delegated.handlers.set(el, list); }
			const removeFromDelegated = () => {
				const current = delegated.handlers.get(el);
				if (!current) return;
				const idx = current.indexOf(listener);
				if (idx >= 0) current.splice(idx, 1);
			};
			// For once, wrap so the handler self-removes from the WeakMap after firing.
			const wrappedListener = mods.has('once') ? (event) => { removeFromDelegated(); listener(event); } : listener;
			list.push(wrappedListener);
			return () => {
				const current = delegated.handlers.get(el);
				if (!current) return;
				const idx = current.indexOf(wrappedListener);
				if (idx >= 0) current.splice(idx, 1);
			};
		}
		el.addEventListener(eventName, listener, mods.has('capture') ? { capture: true } : mods.has('once') ? { once: true } : false);
		return () => el.removeEventListener(eventName, listener, mods.has('capture'));
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
		entry = { handlers: new WeakMap(), listener: null };
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
		const scope = this.createScope(component, {}, el || component.root);
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
			return this._evaluate(expression, this.createScope(component, {}, el), '');
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
					for (let i = 0; i < el.options.length; i++) {
						const option = el.options[i];
						let selectedOption = false;
						for (let j = 0; j < selected.length; j++) {
							if (selected[j] === option.value) { selectedOption = true; break; }
						}
						option.selected = selectedOption;
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

		const stopListen = component.listener.$listen(el, eventName, (event) => {
			let nextValue;
			if (el.type === 'checkbox') nextValue = el.checked;
			else if (el.type === 'radio') { if (!el.checked) return; nextValue = el.value; }
			else if (el.tagName === 'SELECT' && el.multiple) {
				nextValue = new Array(el.selectedOptions.length);
				for (let i = 0; i < el.selectedOptions.length; i++) nextValue[i] = el.selectedOptions[i].value;
			}
			else nextValue = event.target.value;

			nextValue = this._applyModifiers(nextValue, valueModifiers, { el, expression, component, directive: 'x-model' });
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

		const anchor = document.createComment('x-if-group');
		const scopeAnchor = parent;
		parent.insertBefore(anchor, el);

		const templates = branches.map((branch) => {
			const template = branch.el.cloneNode(true);
			template.removeAttribute('x-if');
			template.removeAttribute('x-else-if');
			template.removeAttribute('x-else');
			branch.el.remove();
			return { ...branch, template };
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
				directives.forEach((directive) => {
					if (!directive.structural) cleanups.push(directive.run(component, node));
				});
			}
			cleanups.push(structural.run(component, node));
			return () => cleanups.forEach((cleanup) => cleanup?.());
		};

		const stopEffect = this._effect(component, () => {
			let nextIndex = -1;
			for (let i = 0; i < templates.length; i++) {
				const branch = templates[i];
				if (branch.type === 'else') {
					nextIndex = i;
					break;
				}
				const passed = Boolean(this._evaluate(branch.expression, this.createScope(component, {}, scopeAnchor), false));
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
			anchor.parentNode.insertBefore(clone, anchor);
			const cleanups = [];
			for (const node of nodes) {
				const cleanup = compileBranchNode(node);
				if (cleanup) cleanups.push(cleanup);
			}
			mounted = {
				index: nextIndex,
				nodes,
				cleanup: () => cleanups.forEach((cleanup) => cleanup?.())
			};
		});

		return () => {
			stopEffect?.();
			clearMounted();
			anchor.remove();
		};
	}

	_compileIfDirective(el, expression, component) {
		return this._compileConditionalGroup(el, component);
	}

	_compileClassDirective(el, expression, component) {
		return this._effect(component, () => {
			const value = this._evaluate(expression, this.createScope(component, {}, el), {});
			MiniX_Compiler._patchClassValue(el, value);
		});
	}

	_compileAttrDirective(el, expression, component) {
		return this._effect(component, () => {
			const attrs = this._evaluate(expression, this.createScope(component, {}, el), {});
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
			
			
			const scope = this.createScope(component, {}, el);
			scope.$el = el;
			scope.el = el;
			const fn = new Function('__scope__', `with(__scope__) { ${expression} }`);
			fn(scope);
		} catch (error) {
			this._warn(`x-init failed: ${expression}`, error);
		}
		return () => { };
	}

	_compileFocusDirective(el, expression, component) {
		let wasFocused = false;
		return this._effect(component, () => {
			const shouldFocus = Boolean(this._evaluate(expression, this.createScope(component, {}, el), false));
			if (shouldFocus && !wasFocused) {
				Promise.resolve().then(() => el.focus?.());
				wasFocused = true;
			} else if (!shouldFocus) {
				wasFocused = false;
			}
		});
	}

	_compileDisabledDirective(el, expression, component) {
		let lastDisabled = undefined;
		return this._effect(component, () => {
			const disabled = Boolean(this._evaluate(expression, this.createScope(component, {}, el), false));
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
		return this._effect(component, () => {
			const styles = this._evaluate(expression, this.createScope(component, {}, el), {});
			MiniX_Compiler._patchStyleValue(el, styles);
		});
	}

	_compileValueDirective(el, expression, component) {
		let lastValue = Symbol('unset');
		return this._effect(component, () => {
			const value = this._evaluate(expression, this.createScope(component, {}, el), '');
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
		const opts = expression ? this._evaluate(expression, this.createScope(component, {}, el), {}) : {};
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
		
		
		
		const scope = this.createScope(component, {}, el);
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
		const targetExpr = this._evaluate(expression, this.createScope(component, {}, el || component.root), null);
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
			const raw = this._evaluate(expression, this.createScope(component, {}, el), {});
			scopedState = new MiniX_State(raw || {});
		} catch (e) {
			this._warn(`x-data failed: ${expression}`, e);
			return () => { };
		}

		el.__minix_scoped_state__ = scopedState;
		
		
		
		
		const parentProvider = (() => {
			let cursor = el;
			while (cursor) {
				if (typeof cursor.__minix_scope_provider__ === 'function') return cursor.__minix_scope_provider__;
				cursor = cursor.parentElement;
			}
			return null;
		})();

		const scopeProvider = () => {
			const parentScope = parentProvider ? parentProvider() : component._createRenderScope();
			const scopedRaw = scopedState.raw();
			const scope = Object.create(parentScope);
			Object.keys(scopedRaw.__raw || scopedRaw).forEach((key) => {
				Object.defineProperty(scope, key, {
					get: () => scopedState.get(key),
					set: (v) => scopedState.set(key, v),
					enumerable: true,
					configurable: true
				});
			});
			scope.$state = scopedState.raw();
			return scope;
		};

		el.__minix_scope_provider__ = scopeProvider;

		const subtreeCleanup = this.compile(el, component);

		return () => {
			subtreeCleanup?.();
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
		slotTargets.forEach((target) => {
			const name = target.getAttribute('name') || target.getAttribute('x-slot-target') || 'default';
			const content = slots[name];
			if (content && content.length) {
				target.replaceWith(...content.map((node) => copyScopeProviders(node, node.cloneNode(true))));
			} else if (target.tagName === 'SLOT') {
				
				
				
				target.replaceWith(...[...target.childNodes]);
			}
		});
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
		proto.instance = component.instance;
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
				const openTag = this.options?.openTag || '{{';
				const closeTag = this.options?.closeTag || '}}';
				const escapedOpen = openTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
				const escapedClose = closeTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
				const singleExprMatch = templateText.match(new RegExp(`^\\s*${escapedOpen}\\s*(.+?)\\s*${escapedClose}\\s*$`));
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

		const resolveScopeAnchor = () => marker.parentNode || connectedScopeAnchor || el;
		const sourceGetter = this._compileGetter(sourceExpr);
		const keyGetter = keyAttr ? this._compileGetter(keyAttr) : null;
		const sourceIsSimplePath = this._isSimplePath(sourceExpr);
		const sourcePath = sourceIsSimplePath ? sourceExpr.split('.').filter(Boolean) : null;

		const renderScope = Object.create(null);
		const keyScope = Object.create(null);
		const exprText = String(fastMeta.expression || fastMeta.getter?.__minix_expr__ || '');
		const directTextExpr = (() => {
			const parts = exprText.split('.');
			if (parts.length >= 2 && parts[0] === vars[0]) return parts.slice(1);
			return null;
		})();
		const directKeyExpr = (() => {
			if (!keyAttr) return null;
			const expr = String(keyAttr).trim();
			const parts = expr.split('.');
			if (parts.length >= 2 && parts[0] === vars[0]) return parts.slice(1);
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
		const writeNodeText = (elNode, text) => {
			if (fastMeta.hasSingleTextNode && elNode.firstChild) elNode.firstChild.data = text;
			else elNode.textContent = text;
		};
		const stampLoopScope = (item, index) => {
			loopMeta.index = index;
			loopMeta.iterationKind = 'array';
			loopMeta.entryKey = index;
			renderScope[vars[0]] = item;
			renderScope.$index = index;
			renderScope.__minix_loop_meta = loopMeta;
			if (vars[1]) renderScope[vars[1]] = index;
			if (vars[2]) renderScope[vars[2]] = index;
		};
		const readItemText = exactStaticRowFastPath
			? (item) => readByPath(item, directTextExpr)
			: (item, index) => {
				stampLoopScope(item, index);
				return directTextExpr ? readByPath(item, directTextExpr) : fastMeta.getter(renderScope, '');
			};
		const readItemKey = !keyAttr
			? ((item, index) => index)
			: exactStaticRowFastPath
				? ((item, index) => {
					const key = readByPath(item, directKeyExpr);
					return key == null ? index : key;
				})
				: ((item, index) => {
					if (directKeyExpr) return readByPath(item, directKeyExpr);
					stampLoopScope(item, index);
					Object.setPrototypeOf(keyScope, renderScope);
					return keyGetter ? keyGetter(keyScope, index) : index;
				});

		const stopEffect = this._effect(component, () => {
			const runBaseScope = this.createScope(component, {}, marker.parentNode || resolveScopeAnchor());
			Object.setPrototypeOf(renderScope, runBaseScope);

			const list = readSourceList(runBaseScope) || [];
			const len = Array.isArray(list) ? list.length : 0;
			const parentNode = marker.parentNode;

			if (!oldVnodes.length && len > 0 && parentNode) {
				const frag = document.createDocumentFragment();
				const coldVnodes = new Array(len);
				for (let index = 0; index < len; index++) {
					const item = list[index];
					const key = readItemKey(item, index);
					const rawText = readItemText(item, index);
					const text = rawText == null ? '' : String(rawText);
					const elNode = staticNodeFactory();
					writeNodeText(elNode, text);
					const vnode = { key, text, _nextText: text, el: elNode, _seen: false };
					coldVnodes[index] = vnode;
					keyMap.set(key, vnode);
					frag.appendChild(elNode);
				}
				oldVnodes = coldVnodes;
				parentNode.insertBefore(frag, this._resolveInsertionReference(parentNode, marker.nextSibling));
				return;
			}

			const newVnodes = new Array(len);
			for (let index = 0; index < len; index++) {
				const item = list[index];
				const key = readItemKey(item, index);
				const rawText = readItemText(item, index);
				const text = rawText == null ? '' : String(rawText);
				const existing = keyMap.get(key);
				if (existing) {
					existing._seen = true;
					existing._nextText = text;
					newVnodes[index] = existing;
				} else {
					newVnodes[index] = { key, text, _nextText: text, el: null, _seen: true };
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

			for (let i = 0; i < len; i++) {
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
				let batch = [];
				let batchRef = null;
				const flushBatch = () => {
					if (!batch.length) return;
					const frag = document.createDocumentFragment();
					for (const node of batch) frag.appendChild(node);
					parentNode.insertBefore(frag, this._resolveInsertionReference(parentNode, batchRef));
					batch = [];
					batchRef = null;
				};
				for (let i = len - 1; i >= 0; i--) {
					const vn = newVnodes[i];
					const ref = i + 1 < len ? newVnodes[i + 1].el : marker.nextSibling;
					if (vn.el.nextSibling === ref) {
						flushBatch();
						continue;
					}
					if (batchRef === null) batchRef = ref;
					if (ref !== batchRef) flushBatch(), batchRef = ref;
					batch.unshift(vn.el);
				}
				flushBatch();
			}

			for (let i = 0; i < oldVnodes.length; i++) oldVnodes[i]._seen = false;
			for (let i = 0; i < newVnodes.length; i++) newVnodes[i]._seen = false;
			oldVnodes = newVnodes;
		});

		return () => {
			stopEffect?.();
			for (const vn of oldVnodes) vn.el?.remove();
			keyMap.clear();
			oldVnodes = [];
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
			for (const child of node.childNodes) visit(child, [...path, childIndex++]);
		};
		contentNodes.forEach((node, index) => visit(node, [index]));
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
				visit(child, [...path, childIndex++]);
				if (blueprint.unsupported) return;
			}
		};
		[...template.content.childNodes].forEach((node, index) => {
			visit(node, [index]);
		});
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
		const contentNodes = [...childFragment.childNodes];
		const start = document.createComment(`x-for-start:${String(key)}`);
		const end = document.createComment(`x-for-end:${String(key)}`);
		const nodes = [start].concat(contentNodes, [end]);
		const loopScope = Object.assign(Object.create(null), extra);
		const parentScope = typeof component._createRenderScope === 'function'
			? component._createRenderScope()
			: this.createScope(component, {}, hostEl || component.root);
		const loopBaseScope = Object.create(parentScope);
		const renderScope = Object.create(loopBaseScope);
		let renderKeys = Object.keys(loopScope);
		for (const k of renderKeys) renderScope[k] = loopScope[k];

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
				has: (entryKey) => Object.prototype.hasOwnProperty.call(loopScope, entryKey),
				meta: extra.__minix_loop_meta || null,
				signal: null
			}
		};
		const scopeProvider = () => renderScope;
		for (const node of contentNodes) {
			if (node && node.nodeType === Node.ELEMENT_NODE) node.__minix_scope_provider__ = scopeProvider;
		}

		const scopeKeys = Object.keys(loopScope);
		
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
		const runtime = {
			textBindings: (blueprint?.textBindings || []).map((entry) => ({
				node: resolveNode(entry.path),
				compiled: entry.compiled,
				depMask: this._extractCompiledDepMask(entry.compiled, bitByKey, fullMask)
			})),
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
			runtime.updates.push({
				...entry,
				el,
				depMask: this._extractBindingDepMask(entry.expression, bitByKey, fullMask),
				previous: entry.type === 'class' || (entry.type === 'bind' && entry.targetAttr === 'class') || entry.type === 'style' || (entry.type === 'bind' && entry.targetAttr === 'style') || entry.type === 'attr' ? new Set() : undefined,
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
					const listenCleanup = runtimeComponent.listener.$listen(el, eventName, (event) => {
						let nextValue;
						if (el.type === 'checkbox') nextValue = el.checked;
						else if (el.type === 'radio') { if (!el.checked) return; nextValue = el.value; }
						else if (el.tagName === 'SELECT' && el.multiple) {
							nextValue = new Array(el.selectedOptions.length);
							for (let i = 0; i < el.selectedOptions.length; i++) nextValue[i] = el.selectedOptions[i].value;
						}
						else nextValue = event.target.value;
						nextValue = this._applyModifiers(nextValue, valueModifiers, { el, expression: directive.expression, component: runtimeComponent, directive: 'x-model' });
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
								binding.previous.forEach((cls) => { if (!next.has(cls)) el.classList.remove(cls); });
								next.forEach((cls) => { if (!binding.previous.has(cls)) el.classList.add(cls); });
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
										if (!Object.prototype.hasOwnProperty.call(value, prop)) continue;
										const cssProp = _minix_camelToKebab(prop);
										next.add(cssProp);
										const styleValue = value[prop];
										if (styleValue == null || styleValue === false || styleValue === '') el.style.removeProperty(cssProp);
										else el.style.setProperty(cssProp, String(styleValue));
									}
								}
								binding.previous.forEach((prop) => { if (!next.has(prop)) el.style.removeProperty(prop); });
								binding.previous = next;
							}
						}
						break;
					}
					case 'style': {
						const next = new Set();
						if (value && typeof value === 'object' && !Array.isArray(value)) {
							for (const prop in value) {
								if (!Object.prototype.hasOwnProperty.call(value, prop)) continue;
								const cssProp = _minix_camelToKebab(prop);
								next.add(cssProp);
								const styleValue = value[prop];
								if (styleValue == null || styleValue === false || styleValue === '') el.style.removeProperty(cssProp);
								else el.style.setProperty(cssProp, String(styleValue));
							}
						}
						binding.previous.forEach((prop) => { if (!next.has(prop)) el.style.removeProperty(prop); });
						binding.previous = next;
						break;
					}
					case 'attr': {
						const attrs = value;
						if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) break;
						for (const attr in attrs) {
							if (!Object.prototype.hasOwnProperty.call(attrs, attr)) continue;
							const attrValue = attrs[attr];
							if (attrValue == null || attrValue === false) el.removeAttribute(attr);
							else if (attrValue === true) el.setAttribute(attr, '');
							else el.setAttribute(attr, String(attrValue));
						}
						binding.previous.forEach((attr) => { if (!(attr in attrs)) el.removeAttribute(attr); });
						binding.previous = new Set(Object.keys(attrs));
						break;
					}
					case 'model': {
						if (el.tagName === 'SELECT' && el.multiple) {
							const selected = Array.isArray(value) ? new Array(value.length) : [];
							for (let i = 0; i < selected.length; i++) selected[i] = String(value[i]);
							const json = selected.join('\u0001');
							if (json !== binding.lastModelJSON) {
								binding.lastModelJSON = json;
								for (let i = 0; i < el.options.length; i++) {
									const option = el.options[i];
									let selectedOption = false;
									for (let j = 0; j < selected.length; j++) {
										if (selected[j] === option.value) { selectedOption = true; break; }
									}
									option.selected = selectedOption;
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
				: this.createScope(component, {}, hostEl || component.root);
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
				const nextKeys = Object.keys(nextExtra);
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
		const contentNodes = [...childFragment.childNodes];
		const start = document.createComment(`x-for-start:${String(key)}`);
		const end = document.createComment(`x-for-end:${String(key)}`);
		const nodes = [start].concat(contentNodes, [end]);
		const loopScope = { ...extra };
		const parentScope = typeof component._createRenderScope === 'function'
			? component._createRenderScope()
			: this.createScope(component, {}, hostEl || component.root);
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
			has: (entryKey) => Object.prototype.hasOwnProperty.call(loopScope, entryKey),
			meta: extra.__minix_loop_meta || null,
			signal: null
		};
		const scopeProvider = () => localComponent._createRenderScope();
		for (const node of contentNodes) {
			if (node && node.nodeType === Node.ELEMENT_NODE) node.__minix_scope_provider__ = scopeProvider;
		}
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
					
					[...onlyChild.attributes].forEach((attr) => {
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
					});
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
			: this.createScope(component, {}, hostEl || component.root);
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
			has: (entryKey) => Object.prototype.hasOwnProperty.call(loopScope, entryKey),
			meta: extra.__minix_loop_meta || null,
			signal: loopSignal
		};

		const componentExpr = template.getAttribute('x-component');
		let eventCleanup = null;

		const mountChildComponent = () => {
			const scope = localComponent._createRenderScope();
			const rawName = this._evaluate(componentExpr, scope, componentExpr);
			const componentName = component._resolveComponentName(
				typeof rawName === 'string' ? rawName : componentExpr
			);
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
				const rawName = this._evaluate(componentExpr, scope, componentExpr);
				const nextName = component._resolveComponentName(
					typeof rawName === 'string' ? rawName : componentExpr
				);
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
		const contentNodes = [...childFragment.childNodes];
		const start = document.createComment(`x-for-start:${String(key)}`);
		const end = document.createComment(`x-for-end:${String(key)}`);
		const nodes = [start].concat(contentNodes, [end]);
		const loopScope = { ...extra };
		const loopSignal = new MiniX_Signal({ version: 0 });
		const parentScope = typeof component._createRenderScope === 'function'
			? component._createRenderScope()
			: this.createScope(component, {}, hostEl || component.root);
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
			has: (entryKey) => Object.prototype.hasOwnProperty.call(loopScope, entryKey),
			meta: extra.__minix_loop_meta || null,
			signal: loopSignal
		};

		const scopeProvider = () => localComponent._createRenderScope();
		for (const node of contentNodes) {
			if (node && node.nodeType === Node.ELEMENT_NODE) node.__minix_scope_provider__ = scopeProvider;
		}

		let cleanup = () => { };
		const interpolationEntries = [];
		const collectInterpolationEntries = (node, path = []) => {
			if (node.nodeType === Node.TEXT_NODE) {
				const raw = node.textContent || '';
				if (raw.includes('{{')) {
					interpolationEntries.push({
						path: path.slice(),
						compiled: component.renderer._compileInterpolationTemplate(raw)
					});
				}
				return;
			}
			if (node.nodeType !== Node.ELEMENT_NODE) return;
			let childIndex = 0;
			for (const child of node.childNodes) collectInterpolationEntries(child, path.concat(childIndex++));
		};
		contentNodes.forEach((node, index) => collectInterpolationEntries(node, [index]));
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
			for (const node of contentNodes) {
				if (node.nodeType !== Node.ELEMENT_NODE) continue;
				const currentCleanup = this.compile(node, localComponent);
				const previousCleanup = cleanup;
				cleanup = () => { currentCleanup?.(); previousCleanup?.(); };
			}
			plan = this._buildLoopBlockPlan(contentNodes, template);
			templateMeta.plan = plan;
		} else {
			MiniX_Compiler._scopeGen++;
			for (const node of contentNodes) {
				if (node.nodeType !== Node.ELEMENT_NODE) continue;
				const currentCleanup = this._replayLoopBlockPlan(plan, node, localComponent);
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
		const visit = (node, path) => {
			if (node.nodeType !== Node.ELEMENT_NODE) return;
			const directives = this._collectDirectives(node);
			if (directives.length) {
				plan.push({ path: path.slice(), directives: directives.map(d => ({ name: d.name, expression: d.expression, run: d.run })) });
			}
			let childIndex = 0;
			for (const child of node.children) {
				visit(child, [...path, childIndex++]);
			}
		};
		contentNodes.forEach((node, i) => visit(node, [i]));
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
			const el = getEl(entry.path);
			if (!el) continue;
			for (const directive of entry.directives) {
				try {
					const result = directive.run(localComponent, el);
					if (typeof result === 'function') cleanups.push(result);
				} catch (_) { }
			}
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
		nodes.forEach((node) => fragment.appendChild(node));
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
		liveNodes.forEach((node) => node.remove());
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
			
			
			
			[...template.content.children].forEach(stripLoopAttrs);
		} else {
			stripLoopAttrs(template);
		}
		const marker = document.createComment('x-for');
		el.parentNode.replaceChild(marker, el);
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
			const runBaseScope = this.createScope(component, {}, marker.parentNode || scopeAnchor);
			const list = sourceGetter(runBaseScope, []);
			let normalizedList = null;
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
				
				normalizedList = [];
				let _mi = 0;
				list.forEach((value, entryKey) => { normalizedList.push({ value, key: entryKey, index: _mi, kind: 'map' }); _mi++; });
			} else if (list instanceof Set) {
				
				normalizedList = [];
				let _si = 0;
				list.forEach((value) => { normalizedList.push({ value, key: _si, index: _si, kind: 'set' }); _si++; });
			} else if (list && typeof list[Symbol.iterator] === 'function' && typeof list !== 'string') {
				
				normalizedList = [];
				let _ii = 0;
				for (const value of list) { normalizedList.push({ value, key: _ii, index: _ii, kind: 'iterable' }); _ii++; }
			} else if (list && typeof list === 'object') {
				
				normalizedList = [];
				let _oi = 0;
				for (const entryKey in list) {
					if (Object.prototype.hasOwnProperty.call(list, entryKey)) {
						normalizedList.push({ value: list[entryKey], key: entryKey, index: _oi, kind: 'object' });
						_oi++;
					}
				}
			} else normalizedList = [];

			
			
			const normalizedLength = iterate
				? (typeof list === 'number' ? Math.floor(list) : list.length)
				: normalizedList.length;
			if (!keyAttr && normalizedLength && normalizedList && normalizedList.length > 0) {
				const firstKind = normalizedList[0]?.kind;
				if (firstKind === 'object' || firstKind === 'map') {
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
					
					
					const ks = Object.keys(keyScope);
					for (let ki = 0; ki < ks.length; ki++) delete keyScope[ks[ki]];
					for (const prop in entryScope) keyScope[prop] = entryScope[prop];
					key = keyGetter ? keyGetter(keyScope, entry.index) : this._evaluate(keyAttr, keyScope, entry.index);
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
			else normalizedList.forEach(visitEntry);

			blocks.forEach((block) => {
				if (block._cycle !== renderCycle) {
					keyed.delete(block.key);
					this._removeBlock(block);
				}
			});

			const allNew = nextBlocks.length > 0 && nextBlocks.every((block) => block._isNew);
			if (allNew) {
				const parentNode = marker.parentNode;
				if (parentNode && !marker.nextSibling) {
					const fragment = document.createDocumentFragment();
					for (const block of nextBlocks) {
						for (const node of block.nodes) fragment.appendChild(node);
					}
					parentNode.appendChild(fragment);
					for (const block of nextBlocks) block.ensureMounted?.();
				} else {
					let referenceNode = marker.nextSibling;
					let batchFragment = null;
					let batchReferenceNode = null;
					const batchBlocks = [];
					const flushBatch = () => {
						if (!batchFragment) return;
						marker.parentNode?.insertBefore(batchFragment, this._resolveInsertionReference(marker.parentNode, batchReferenceNode));
						for (const block of batchBlocks) block.ensureMounted?.();
						batchFragment = null;
						batchReferenceNode = null;
						batchBlocks.length = 0;
					};

					for (const block of nextBlocks) {
						if (block.start === referenceNode) {
							
							block.ensureMounted?.();
							flushBatch();
							referenceNode = block.end.nextSibling;
							continue;
						}
						if (!batchFragment) {
							batchFragment = document.createDocumentFragment();
							batchReferenceNode = referenceNode;
						}
						for (const node of block.nodes) batchFragment.appendChild(node);
						batchBlocks.push(block);
						referenceNode = block.end.nextSibling;
					}
					flushBatch();
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
				const stablePositions = new Set(this._computeLIS(existingSequence).map((idx) => existingPositions[idx]));
				let batch = [];
				let batchReferenceNode = null;
				const flushBatch = () => {
					if (!batch.length) return;
					this._moveBlocksBatch(marker, batch, batchReferenceNode);
					batch = [];
					batchReferenceNode = null;
				};
				for (let i = nextBlocks.length - 1; i >= 0; i--) {
					const block = nextBlocks[i];
					const referenceNode = i + 1 < nextBlocks.length ? nextBlocks[i + 1].start : null;
					if (!block._isNew && stablePositions.has(i)) {
						flushBatch();
						continue;
					}
					if (batchReferenceNode === null) batchReferenceNode = referenceNode;
					if (referenceNode !== batchReferenceNode) flushBatch(), batchReferenceNode = referenceNode;
					batch.unshift(block);
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
			blocks.forEach((block) => this._removeBlock(block));
			keyed.clear();
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
		const initialSlotChildren = [...el.childNodes].map((child) => child.cloneNode(true));

		const slotScopeProvider = () => this.createScope(component, {}, el);

		const stampParentScope = (node) => {
			if (!node) return node;
			if (node.nodeType === Node.ELEMENT_NODE) {
				node.__minix_scope_provider__ = slotScopeProvider;
				[...node.childNodes].forEach(stampParentScope);
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

		const hostSlots = () => {
			const slots = {};
			initialSlotChildren.forEach((child) => {
				if (child.nodeType === Node.TEXT_NODE && !child.textContent.trim()) return;
				const slotName = child.nodeType === Node.ELEMENT_NODE
					? (child.getAttribute?.('x-slot') || child.getAttribute?.('data-slot') || 'default')
					: 'default';
				if (!Array.isArray(slots[slotName])) slots[slotName] = [];
				const cloned = child.cloneNode(true);
				stampParentScope(cloned);
				slots[slotName].push(cloned);
			});
			el.__minix_slots__ = slots;
			return slots;
		};

		const stopEffect = this._effect(component, () => {
			
			
			
			
			const scope = this.createScope(component, {}, el.parentNode || el);
			const rawName = this._evaluate(expression, scope, expression);
			const componentName = component._resolveComponentName(typeof rawName === 'string' ? rawName : expression);
			const props = this._evaluateComponentHostProps(el, scope);
			const nextSlotSignature = slotSignature();

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
		const propsExpr = el.getAttribute('x-props');
		const props = propsExpr ? { ...(this._evaluate(propsExpr, scope, {}) || {}) } : {};

		const attrs = el.attributes || [];
		for (let i = 0; i < attrs.length; i++) {
			const attr = attrs[i];
			const name = attr.name;
			if (name === 'x-bind') {
				const value = this._evaluate(attr.value, scope, {});
				if (value && typeof value === 'object') Object.assign(props, value);
				continue;
			}
			if (name.startsWith('x-bind:') || name.startsWith(':')) {
				const raw = name.startsWith(':') ? name.slice(1) : name.slice(7);
				const dot = raw.indexOf('.');
				const propName = this._normalizeComponentPropName(dot === -1 ? raw : raw.slice(0, dot));
				if (!propName || propName === 'key') continue;
				props[propName] = this._evaluate(attr.value, scope);
			}
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
			const handler = (event) => {
				if (event.meta?.componentInstance && event.meta.componentInstance !== childComponent.instance) return;
				const liveScope = this.createScope(parentComponent, {}, el.parentNode || el);
				const fireScope = Object.create(liveScope);
				fireScope.$event = event.payload;
				fireScope.event = event;
				fireScope.$emitEvent = event;
				fireScope.$el = el;
				fireScope.el = el;
				const result = this._evaluate(expression, fireScope);
				if (typeof result === 'function') result.call(fireScope, event.payload);
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
			const scope = this.createScope(component, {}, start.parentNode || component.root);
			const rawName = this._evaluate(expression, scope, expression);
			const componentName = component._resolveComponentName(typeof rawName === 'string' ? rawName : expression);
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
			execute: () => this._effect(component, () => {
				const scopeCache = new Map();
				for (const entry of hoisted) {
					const node = resolveNodePath(root, entry.path);
					if (!node) continue;
					const parent = node.parentElement;
					if (parent?.closest?.('[data-x-once]')) continue;
					let scope = scopeCache.get(parent);
					if (!scope) { scope = this.createScope(component, {}, parent); scopeCache.set(parent, scope); }
					node.textContent = component.renderer.interpolateCompiled(entry.template, scope);
				}
			})
		}];
	}

	_buildCompileOpcodes(target, component) {
		const graph = this._prepareCompileGraph(target);
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
						if (structural.name !== 'x-for') directives.forEach((directive) => {
							if (directive.structural) return;
							if (structural.name === 'x-component' && (directive.kind === 'event' || directive.name === 'x-bind' || directive.name.startsWith(':') || directive.name.startsWith('x-bind:'))) return;
							cleanups.push(directive.run(component, el));
						});
						cleanups.push(structural.run(component, el));
						return cleanups;
					}
					directives.forEach((directive) => { cleanups.push(directive.run(component, el)); });
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
		const isComponentHost = target.hasAttribute && target.hasAttribute('x-component');
		if (existingProvider && typeof component._createRenderScope === 'function') {
			if (!isComponentHost) {
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
		value.flat().forEach((entry) => {
			if (typeof entry === 'string') {
				let start = -1;
				for (let i = 0; i <= entry.length; i++) {
					const ch = i < entry.length ? entry.charCodeAt(i) : 32;
					const ws = ch === 32 || ch === 9 || ch === 10 || ch === 13;
					if (!ws && start === -1) { start = i; }
					else if (ws && start !== -1) { next.add(entry.slice(start, i)); start = -1; }
				}
			} else if (entry && typeof entry === 'object') {
				for (const cls in entry) { if (Object.prototype.hasOwnProperty.call(entry, cls) && entry[cls]) next.add(cls); }
			}
		});
	} else if (value && typeof value === 'object') {
		for (const cls in value) { if (Object.prototype.hasOwnProperty.call(value, cls) && value[cls]) next.add(cls); }
	}
	return next;
};
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
			if (!Object.prototype.hasOwnProperty.call(attrs, attr)) continue;
			seen[attr] = true;
			MiniX_Compiler._patchAttrValue(el, attr, attrs[attr]);
		}
	}
	for (const attr of Object.keys(cache)) {
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
			if (!Object.prototype.hasOwnProperty.call(styles, prop)) continue;
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
	for (const prop of Object.keys(cache)) {
		if (prop in seen) continue;
		delete cache[prop];
		el.style.removeProperty(prop);
	}
};

MiniX_Compiler._getterCache = new Map();






MiniX_Compiler._globalMiniX = null;
MiniX_Compiler._globalMiniXResolved = false;

MiniX_Compiler._loopComponentProtoCache = new WeakMap();
MiniX_Compiler._loopTemplateMetaWeakCache = new WeakMap();

class MiniX_Component {
	static registry = new Map();

	static register(name, definition) {
		if (!name || typeof name !== 'string') throw new Error('MiniX_Component.register requires valid name');
		this.registry.set(name, definition);
		return definition;
	}

	static resolve(name, localRegistry = {}) {
		return localRegistry?.[name] || this.registry.get(name) || null;
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
	
		this._initialTemplate = null;
		this._initialTemplateCaptured = false;
		this._rerenderQueued = false;
		this._lastRerenderMeta = null;
		this._baseScopeCache = null;
	
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
			}
		} catch (err) {
			if (this.options.dev) console.warn('[MiniX] instanceAPI factory failed.', err);
		}
		return this.instance;
	}

	_getBaseScope() {
		
		
		
		
		if (this._baseScopeCache) return this._baseScopeCache;

		const scope = Object.create(null);
		const instance = this.instance;
		const stateProxy = this.state.raw();
		
		
		const stateRaw = stateProxy?.__raw || stateProxy;
		const propsProxy = this._propsSource;
	
		
		for (const key in stateRaw) {
			if (!Object.prototype.hasOwnProperty.call(stateRaw, key)) continue;
			Object.defineProperty(scope, key, {
				get: () => stateProxy[key],
				set: (v) => { stateProxy[key] = v; },
				enumerable: true
			});
		}
	
		
		if (instance.methods) {
			Object.keys(instance.methods).forEach((key) => {
				if (key in scope) return;
	
				const fn = instance.methods[key];
				if (typeof fn === 'function') {
					scope[key] = fn.bind(instance);
				}
			});
		}
	
		
		
		
		{
			let proto = Object.getPrototypeOf(instance);
			const objectProto = Object.prototype;
			while (proto && proto !== objectProto) {
				Object.getOwnPropertyNames(proto).forEach((key) => {
					if (key === 'constructor') return;
					if (key in scope) return;
					const val = instance[key];
					if (typeof val === 'function') {
						scope[key] = val.bind(instance);
					}
				});
				proto = Object.getPrototypeOf(proto);
			}
		}
	
		
		if (instance.computed) {
			Object.keys(instance.computed).forEach((key) => {
				if (key in scope) return;
	
				
				
				Object.defineProperty(scope, key, {
					get: () => instance[key],
					enumerable: true,
					configurable: true
				});
			});
		}
	
		
		Object.keys(propsProxy || {}).forEach((key) => {
			if (key in scope) return;
	
			Object.defineProperty(scope, key, {
				get: () => propsProxy[key],
				enumerable: true,
				configurable: true
			});
		});
	
		Object.defineProperty(scope, '$props', {
			get: () => this.props,
			enumerable: true,
			configurable: true
		});
		Object.defineProperty(scope, '__minix_state_proxy__', {
			value: stateProxy,
			enumerable: false,
			configurable: true
		});
		Object.defineProperty(scope, '__minix_track_state_shape__', {
			value: () => this.state._trackTargetEffect(stateRaw, MiniX_State.ITERATE_KEY),
			enumerable: false,
			configurable: true
		});
	
		scope.$state = this._createStateAPI();
		scope.$component = instance;
	
		scope.$set = (path, val) => scope.$state.set(path, val);
		scope.$batch = (fn) => this.state.batch(fn);
	
		scope.$patch = (path, fn) => {
			const current = this.state.get(path);
			const next = typeof fn === 'function' ? fn(current) : fn;
			return scope.$state.set(path, next);
		};
	
		scope.$merge = (path, obj) => {
			const current = this.state.get(path) || {};
			return scope.$state.set(path, { ...current, ...obj });
		};
	
		scope.$toggle = (path) => {
			const current = !!this.state.get(path);
			return scope.$state.set(path, !current);
		};
	
		scope.$emit = (name, payload = null, meta = {}) =>
			this.eventBus.emit(name, payload, {
				component: this.ComponentClass?.name || 'AnonymousComponent',
				componentInstance: this.instance,
				...meta
			});
	
		Object.defineProperty(scope, '$refs', {
			get: () => instance.$refs,
			enumerable: true,
			configurable: true
		});

		
		try {
			const instanceDescriptors = Object.getOwnPropertyDescriptors(instance || {});
			for (const key of Reflect.ownKeys(instanceDescriptors)) {
				if (typeof key !== 'string') continue;
				if (key in scope) continue;
				const desc = instanceDescriptors[key];
				if (typeof desc.get === 'function') {
					Object.defineProperty(scope, key, {
						get: () => instance[key],
						enumerable: true,
						configurable: true
					});
					continue;
				}
				if ('value' in desc && typeof desc.value !== 'function') {
					Object.defineProperty(scope, key, {
						get: () => instance[key],
						set: (v) => { instance[key] = v; },
						enumerable: true,
						configurable: true
					});
				}
			}
		} catch (_) {}
	
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
			if (key in scope) continue;
			const val = instance[key];
			if (val !== undefined) {
				scope[key] = typeof val === 'function' ? val.bind(instance) : val;
			}
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

			push: (path, val) => {
				const arr = this.state.get(path) || [];
				setAndRefreshShape(path, [...arr, val]);
			},

			pop: (path) => {
				const arr = this.state.get(path) || [];
				setAndRefreshShape(path, arr.slice(0, -1));
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

	_createRenderScope(extra = {}, el = null) {
		const base = this._getBaseScope();
		let scope = base;

		const hasScopeFactories = (this._scopeFactories && this._scopeFactories.length) || (this._localScopeFactories && this._localScopeFactories.length);
		if (hasScopeFactories) {
			scope = Object.create(base);
			this._applyScopeFactories(scope, el);
		}

		const extraKeys = extra ? Object.keys(extra) : null;
		if (extraKeys && extraKeys.length) {
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
				let initialized = false;
				let oldValue;
				let effect = null;
	
				const runGetter = () => source.call(target);
	
				effect = new MiniX_Effect(runGetter, {
					lazy: true,
					scheduler: () => {
						const newValue = effect.run();
	
						if (!initialized) {
							oldValue = newValue;
							initialized = true;
							return;
						}
	
						if (!Object.is(newValue, oldValue)) {
							const prev = oldValue;
							oldValue = newValue;
							callback.call(target, newValue, prev);
						}
					}
				});
	
				oldValue = effect.run();
				initialized = true;
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
	
		target.$emit = (name, payload = null, meta = {}) =>
			this.eventBus.emit(name, payload, {
				component: this.ComponentClass.name || 'AnonymousComponent',
				componentInstance: this.instance,
				...meta
			});
	
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
	
		target.$fetch = (url, options = {}) => {
			const request = this.provider.inject('__minix_request__', MiniX_Request.default());

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

		
		Object.keys(snapshot).forEach((key) => {
			Object.defineProperty(this.instance, key, {
				get: () => this.state.get(key),
				set: (value) => this.state.set(key, value),
				configurable: true,
				enumerable: true
			});
		});

		
		
		
		
		
		const stateRef = this.state;
		const rawInstance = this.instance;
		const componentRef = this;
		this.instance = new Proxy(rawInstance, {
			get(target, prop, receiver) {
				
				
				if (prop in target) return Reflect.get(target, prop, receiver);
				
				if (typeof prop === 'string' && !prop.startsWith('__') && stateRef.raw() && prop in stateRef.raw()) {
					return stateRef.get(prop);
				}
				return Reflect.get(target, prop, receiver);
			},
			set(target, prop, value, receiver) {
				
				
				const desc = Object.getOwnPropertyDescriptor(target, prop);
				if (desc) return Reflect.set(target, prop, value, receiver);
				
				
				if (typeof prop === 'string' && !prop.startsWith('$') && !prop.startsWith('__')) {
					stateRef.set(prop, value);
					
					
					Object.defineProperty(target, prop, {
						get: () => stateRef.get(prop),
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
		Object.keys(methods).forEach((key) => {
			if (typeof methods[key] === 'function') {
				const bound = methods[key].bind(this.instance);
				Object.defineProperty(this.instance, key, {
					value: bound,
					writable: true,
					configurable: true,
					enumerable: true
				});
				this._boundMethods[key] = bound;
			}
		});
	}

	_setupComputed() {
		const computed = this.instance.computed || {};
		Object.keys(computed).forEach((key) => {
			const getter = computed[key];
			if (typeof getter !== 'function') return;
			this.listener.$computed(key, () => getter.call(this.instance, this.state.raw(), this.props), this.instance);
		});
	}

	_setupWatchers() {
		const watch = this.instance.watch || {};
		Object.keys(watch).forEach((path) => {
			const handler = watch[path];
			if (typeof handler === 'function') {
				this.listener.$watch(this.state, path, (newVal, oldVal) => handler.call(this.instance, newVal, oldVal));
			}
		});
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
		this._childRecords.forEach((record) => record.component?.destroy?.());
		this._childRecords.clear();
		this.children = [];
		this.instance.$children = [];
	}

	_syncChildrenArray() {
		this.children = [...this._childRecords.values()].map((record) => record.component);
		this.instance.$children = this.children.map((item) => item.instance);
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
		Object.keys(definition).forEach((key) => {
			const raw = definition[key];
			if (raw == null) {
				normalized[key] = {};
				return;
			}
			if (typeof raw === 'function' || Array.isArray(raw) || typeof raw === 'string') {
				normalized[key] = { type: raw };
				return;
			}
			if (typeof raw === 'object') {
				normalized[key] = { ...raw };
			}
		});
		return normalized;
	}

	_hasPropDefault(def = {}) {
		return Object.prototype.hasOwnProperty.call(def, 'default') ||
			Object.prototype.hasOwnProperty.call(def, 'fallback');
	}

	_resolvePropDefault(key, def = {}, incoming = {}) {
		const hasDefault = Object.prototype.hasOwnProperty.call(def, 'default');
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

		Object.keys(definitions).forEach((key) => {
			const def = definitions[key] || {};
			const hasIncoming = Object.prototype.hasOwnProperty.call(incoming, key);
			if (!hasIncoming && this._hasPropDefault(def)) {
				resolved[key] = this._resolvePropDefault(key, def, incoming);
			}

			const value = resolved[key];
			const validation = this._validatePropValue(key, value, def);
			if (validation.valid) return;

			let fallbackUsed = false;
			if (this._hasPropDefault(def)) {
				resolved[key] = this._resolvePropDefault(key, def, incoming);
				fallbackUsed = true;
			} else if (Object.prototype.hasOwnProperty.call(previousProps || {}, key)) {
				resolved[key] = previousProps[key];
				fallbackUsed = true;
			}

			if (this.options.dev) {
				const componentName = this.ComponentClass?.name || 'AnonymousComponent';
				const suffix = fallbackUsed ? ' Using fallback value.' : '';
				console.warn(`[MiniX_Component] Invalid prop "${key}" on ${componentName}: ${validation.reason}.${suffix}`);
			}
		});

		return resolved;
	}

	_syncPropsToState(nextProps = {}) {
		if (!this.state || typeof this.state.raw !== 'function') return;
		const snapshot = this.state.raw();
		const raw = snapshot?.__raw || snapshot || {};

		Object.keys(nextProps || {}).forEach((key) => {
			if (Object.prototype.hasOwnProperty.call(raw, key)) {
				this.state.set(key, nextProps[key]);
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
			this._lastRerenderMeta = { ...(this._lastRerenderMeta || {}), ...(meta || {}) };
			return this;
		}

		this._rerenderQueued = true;
		this._lastRerenderMeta = meta || {};

		MiniX_Effect._raf(() => {
			const queuedMeta = this._lastRerenderMeta || {};
			this._rerenderQueued = false;
			this._lastRerenderMeta = null;
			if ((!this.root && !this._inlineMount) || this.isDestroyed) return;
			this.rerender(queuedMeta);
		});

		return this;
	}

	_resolveTemplateString() {
		if (typeof this.instance.view === 'function') {
			return this.instance.view(this.props);
		}

		if (typeof this.instance.view === 'string') {
			return this.instance.view;
		}

		return '';
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

		const template = this._resolveTemplateString();
		const html = this.renderer.render(
			template,
			this._createRenderScope(),
			{ sanitizer: this.sanitizer, preserveMustaches: true }
		);

		const tpl = document.createElement('template');
		tpl.innerHTML = html;

		const fragment = tpl.content.cloneNode(true);
		const nodes = Array.from(fragment.childNodes);
		const textNodes = nodes.filter((node) => node.nodeType === Node.TEXT_NODE && node.textContent.includes('{{'));
		let textEffectCleanup = null;

		if (textNodes.length) {
			textNodes.forEach((node) => {
				node.__minix_template__ = this.renderer._compileInterpolationTemplate(node.textContent);
			});

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
			return [this._inlineStart, ...(this._inlineNodes || []), this._inlineEnd];
		}
		return this.root ? [this.root] : [];
	}

	/**
	 * Resolve the component's content template string.
	 * Reads `instance.view`, then falls back to the captured root innerHTML for root components.
	 */
	_resolveView() {
		if (typeof this.instance.view === 'function') return this.instance.view(this.props);
		if (typeof this.instance.view === 'string') return this.instance.view;
		if (!this.parent) return this._initialTemplate || '';
		return '';
	}

	/**
	 * Resolve the layout wrapper string.
	 * `instance.layout` may be:
	 *   - a string  (raw HTML with <template x-yield> slot markers)
	 *   - a function that receives props and returns a string
	 *   - a component class with a static `view` or instance `view`
	 */
	_resolveLayoutTemplate() {
		const layout = this.instance.layout;
		if (!layout) return null;
		if (typeof layout === 'string') return layout;
		if (typeof layout === 'function') {
			// Could be a class or a plain function
			try {
				// Try instantiating to read view
				const inst = new layout();
				if (typeof inst.view === 'function') return inst.view(this.props);
				if (typeof inst.view === 'string') return inst.view;
				// Class instantiated successfully but had no usable view — do not
				// fall through to the plain-function call below, which would throw.
				return '';
			} catch (_) {}
			// Only reached if new layout() threw, meaning it is a plain function.
			return layout(this.props) || '';
		}
		return null;
	}

	/**
	 * Inject view sections into layout yield points.
	 *
	 * Default yield:   <template x-yield></template>        ← receives the default view
	 * Named yields:    <template x-yield="sidebar"></template>
	 * Named sections:  defined via instance.sections = { sidebar: '<p>…</p>' }
	 *                  or inline in the view via <template x-section="sidebar">…</template>
	 */
	_injectLayout(layoutHtml, viewHtml) {
		// Extract named sections out of the view HTML, leaving the remainder as the default content.
		const sections = {};
		const defaultHtml = viewHtml.replace(
			/<template[^>]+x-section=["']([^"']+)["'][^>]*>([\s\S]*?)<\/template>/gi,
			(_, name, content) => { sections[name] = content; return ''; }
		);

		// Also merge any sections defined directly on the instance.
		// Inline <template x-section="…"> in the view takes priority; instance.sections
		// only fills in names that were not defined inline.
		if (this.instance.sections && typeof this.instance.sections === 'object') {
			for (const name in this.instance.sections) {
				if (!Object.prototype.hasOwnProperty.call(sections, name)) {
					sections[name] = this.instance.sections[name];
				}
			}
		}

		// Replace <template x-yield="name"> with named section content
		let result = layoutHtml.replace(
			/<template([^>]*)x-yield=["']([^"']+)["']([^>]*)><\/template>/gi,
			(_, pre, name, post) => sections[name] !== undefined ? sections[name] : ''
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
		const layoutHtml = this._resolveLayoutTemplate();

		// Compose: if a layout exists, inject the view into its yield slots.
		// Otherwise render the view directly (legacy behaviour preserved).
		const finalHtml = layoutHtml ? this._injectLayout(layoutHtml, viewHtml) : viewHtml;

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
				if (!Object.prototype.hasOwnProperty.call(previous, key)) continue;
				if (!Object.prototype.hasOwnProperty.call(next, key)) {
					this.propsState.delete(key);
				}
			}

			for (const key in next) {
				if (!Object.prototype.hasOwnProperty.call(next, key)) continue;
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
			const hasSlots = !!(existing.slots && Object.keys(existing.slots).length);
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

		const childComponent = new MiniX_Component(Child, {
			root: element,
			props,
			parent: this,
			provider: this.provider,
			eventBus: this.eventBus,
			renderer: this.renderer,
			sanitizer: this.sanitizer,
			compiler: this.compiler,
			scopeFactories: [
				...(Array.isArray(this._scopeFactories) ? this._scopeFactories : []),
				...(Array.isArray(this._localScopeFactories) ? this._localScopeFactories : [])
			],
			instanceAPIs: [
				...(Array.isArray(this._instanceAPIFactories) ? this._instanceAPIFactories : [])
			],
			dev: this.options.dev
		});

		if (meta.slots) element.__minix_slots__ = meta.slots;
		childComponent.mount(element);

		if (meta.slots && Object.keys(meta.slots).length) {
			this.compiler._projectSlots(element, childComponent.root);
			if (typeof childComponent._compilerCleanup === 'function') childComponent._compilerCleanup();
			childComponent._compilerCleanup = childComponent.compiler.compile(childComponent.root, childComponent);
		}

		this._childRecords.set(element, { name: normalizedName, component: childComponent, slots: meta.slots || {} });
		this._syncChildrenArray();
		return childComponent;
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
		this._effects.forEach((effect) => effect.stop());
		this._effects = new Set();
		this._rerenderQueued = false;
		this._lastRerenderMeta = null;
		this._baseScopeCache = null;
		if (this._inlineMount) {
			const nodes = this._inlineNodes || [];
			for (const node of nodes) node.remove();
			this._inlineNodes = [];
			this.root = null;
		}
		this.isMounted = false;
		this.isDestroyed = true;
		this._callHook('unmounted', { reason: 'destroy' });
		return true;
	}
}

class MiniX {
	constructor(rootComponent, options = {}) {
		this.rootComponent = rootComponent;
		this.options = {
			props: {},
			renderer: new MiniX_Renderer(),
			sanitizer: new MiniX_Sanitizer(),
			compiler: new MiniX_Compiler(),
			eventBus: new MiniX_Event_Bus(),
			provider: new MiniX_Provider(),
			scopeFactories: [],
			request: null,
			dev: false,
			...options
		};
		this._plugins = [];
		this._instance = null;
	}

	static createApp(rootComponent, options = {}) {
		return new MiniX(rootComponent, options);
	}

	
	dev(enabled = true) {
		this.options.dev = Boolean(enabled);
		return this;
	}

	request(baseURLOrInstance, defaults = {}) {
		if (baseURLOrInstance instanceof MiniX_Request) {
			this.options.request = baseURLOrInstance;
		} else {
			this.options.request = new MiniX_Request(baseURLOrInstance || '', defaults);
		}
		return this;
	}

	component(name, definition) {
		MiniX_Component.register(name, definition);
		return this;
	}

	directive(name, handler, options = {}) {
		this.options.compiler.directive(name, handler, options);
		return this;
	}

	modifier(name, handler) {
		this.options.compiler.modifier(name, handler);
		return this;
	}

	addScope(factory) {
		if (!factory) return this;
		if (!Array.isArray(this.options.scopeFactories)) this.options.scopeFactories = [];
		this.options.scopeFactories.push(factory);
		if (this._instance && typeof this._instance.addScope === 'function') this._instance.addScope(factory);
		if (typeof MiniX_Compiler !== 'undefined') MiniX_Compiler._scopeGen = (MiniX_Compiler._scopeGen || 0) + 1;
		return this;
	}

	







	addInstanceAPI(factory) {
		if (!factory) return this;
		if (!Array.isArray(this.options.instanceAPIs)) this.options.instanceAPIs = [];
		this.options.instanceAPIs.push(factory);
		if (this._instance && typeof this._instance.addInstanceAPI === 'function') this._instance.addInstanceAPI(factory);
		return this;
	}

	use(plugin) {
		const definition = typeof plugin?.install === 'function' ? plugin : MiniX_Plugin.define(plugin || {});

		definition._installedOnApp = true;
		definition.install?.(this);
		this._plugins.push(definition);
		return this;
	}

	provide(key, value) {
		this.options.provider.provide(key, value);
		return this;
	}

	mount(target) {
		if (this.options.request) {
			this.options.provider.provide('__minix_request__', this.options.request);
		}

		this._instance = new MiniX_Component(this.rootComponent, {
			root: target,
			props: this.options.props,
			provider: this.options.provider,
			eventBus: this.options.eventBus,
			renderer: this.options.renderer,
			sanitizer: this.options.sanitizer,
			compiler: this.options.compiler,
			scopeFactories: this.options.scopeFactories,
			instanceAPIs: this.options.instanceAPIs,
			dev: this.options.dev
		});

		this._plugins.forEach((plugin) => {
			if (!plugin._installedOnApp) plugin.install?.(this._instance);
		});
		return this._instance.mount(target);
	}

	unmount() {
		if (this._instance) {
			this._instance.destroy();
			this._instance = null;
		}
		return true;
	}
}

MiniX._globalScopeState = new MiniX_State({ version: 0 });
MiniX.readGlobalScopeVersion = function() {
	return MiniX._globalScopeState.get('version') || 0;
};
MiniX.invalidateGlobalScopes = function() {
	return MiniX._globalScopeState.increment('version');
};

const MiniX_Global = typeof window !== 'undefined' ? window : globalThis;
MiniX_Global.MiniX = MiniX;

class MiniX_Request {

	constructor(baseURL = '', defaults = {}) {
		this._baseURL = String(baseURL).replace(/\/+$/, '');
		this._defaults = {
			headers: {},
			timeout: 0,
			credentials: 'same-origin',
			mode: 'cors',
			cache: 'default',
			redirect: 'follow',
			referrerPolicy: '',
			integrity: '',
			keepalive: false,
			responseType: 'json',
			...defaults,
			headers: { 'Content-Type': 'application/json', ...(defaults.headers || {}) }
		};
		this._interceptors = { request: new Set(), response: new Set(), error: new Set() };
		this._listeners = new Map();
		this._cache = new Map();
		this._abortControllers = new Map();
		this._idCounter = 0;
		this._lastFiredId = 0;
	}

	static _descriptorProto = {
		header(name, value) {
			if (typeof name === 'object') Object.assign(this._headers, name);
			else this._headers[name] = value;
			return this;
		},
		query(params) { Object.assign(this._params, params); return this; },
		body(value) { this._body = value; return this; },
		as(type) {
			if (this._promise && this._sentResponseType !== type) {
				throw new Error('[MiniX.Request] Response type cannot be changed after the request has started.');
			}
			this._responseType = type;
			return this;
		},
		timeout(ms) { this._timeout = ms; return this; },
		signal(sig) { this._signal = sig; return this; },
		retry(times, delay = 300, factor = 2) {
			this._retry = times; this._retryDelay = delay; this._retryFactor = factor;
			return this;
		},
		cache(ms) { this._cacheTime = ms; return this; },
		onUploadProgress(fn) { this._onUploadProgress = fn; return this; },
		onDownloadProgress(fn) { this._onDownloadProgress = fn; return this; },
		_send(type) {
			if (type && this._promise && this._sentResponseType !== type) {
				return Promise.reject(new Error('[MiniX.Request] Response type cannot be changed after the request has started.'));
			}
			if (!this._promise) {
				if (type) this._responseType = type;
				this._sentResponseType = this._responseType;
				this._promise = this._instance._fire(this);
			}
			return this._promise;
		},
		json() { return this._send('json'); },
		text() { return this._send('text'); },
		blob() { return this._send('blob'); },
		arrayBuffer() { return this._send('arrayBuffer'); },
		response() { return this._send('response'); },
		then(resolve, reject) { return this._send().then(resolve, reject); },
		catch(reject) { return this._send().catch(reject); },
		finally(fn) { return this._send().finally(fn); },
	};

	_builder(method, url, bodyOrOptions, options = {}) {

		let body = undefined;
		let opts = options;
		const normalizedMethod = String(method || '').toUpperCase();
		const canInferOptions = normalizedMethod === 'GET'
			|| normalizedMethod === 'HEAD'
			|| normalizedMethod === 'DELETE'
			|| normalizedMethod === 'OPTIONS';
		if (canInferOptions && bodyOrOptions !== undefined && typeof bodyOrOptions === 'object' && !this._isBodyValue(bodyOrOptions)) {
			let isOpts = false;
			for (const k in bodyOrOptions) { if (MiniX_Request._optionKeys.has(k)) { isOpts = true; break; } }
			if (isOpts) { opts = bodyOrOptions; }
			else { body = bodyOrOptions; }
		} else {
			body = bodyOrOptions;
		}

		const desc = Object.create(MiniX_Request._descriptorProto);
		desc._method = normalizedMethod;
		desc._url = url;
		desc._body = body;
		desc._headers = { ...this._defaults.headers, ...(opts.headers || {}) };
		desc._params = { ...(opts.params || {}) };
		desc._timeout = opts.timeout !== undefined ? opts.timeout : this._defaults.timeout;
		desc._signal = opts.signal || null;
		desc._credentials = opts.credentials || this._defaults.credentials;
		desc._mode = opts.mode || this._defaults.mode;
		desc._cache = opts.cache || this._defaults.cache;
		desc._redirect = opts.redirect || this._defaults.redirect;
		desc._referrerPolicy = opts.referrerPolicy || this._defaults.referrerPolicy;
		desc._integrity = opts.integrity || this._defaults.integrity;
		desc._keepalive = opts.keepalive !== undefined ? opts.keepalive : this._defaults.keepalive;
		desc._responseType = opts.responseType || this._defaults.responseType;
		desc._retry = opts.retry || 0;
		desc._retryDelay = opts.retryDelay !== undefined ? opts.retryDelay : 300;
		desc._retryFactor = opts.retryFactor !== undefined ? opts.retryFactor : 2;
		desc._cacheTime = opts.cacheTime || 0;
		desc._onUploadProgress = opts.onUploadProgress || null;
		desc._onDownloadProgress = opts.onDownloadProgress || null;
		desc._instance = this;
		return desc;
	}

	_isBodyValue(v) {
		return (typeof FormData !== 'undefined' && v instanceof FormData)
			|| (typeof URLSearchParams !== 'undefined' && v instanceof URLSearchParams)
			|| (typeof Blob !== 'undefined' && v instanceof Blob)
			|| (typeof ArrayBuffer !== 'undefined' && (v instanceof ArrayBuffer || ArrayBuffer.isView(v)))
			|| typeof v === 'string'
			|| typeof v === 'number'
			|| typeof v === 'boolean';
	}

	async _fire(desc, attempt = 0) {
		const id = ++this._idCounter;
		this._lastFiredId = id;

		const canUseCache = desc._cacheTime > 0 && desc._responseType !== 'response';
		let cacheKey = null;
		const url = this._resolveURL(desc._url, desc._params);

		let fetchBody = undefined;
		let headers = { ...desc._headers };

		if (desc._body !== undefined && desc._body !== null) {
			if (typeof FormData !== 'undefined' && desc._body instanceof FormData) {
				fetchBody = desc._body;
				delete headers['Content-Type'];
			} else if (typeof URLSearchParams !== 'undefined' && desc._body instanceof URLSearchParams) {
				fetchBody = desc._body;
				headers['Content-Type'] = 'application/x-www-form-urlencoded';
			} else if (
				(typeof Blob !== 'undefined' && desc._body instanceof Blob) ||
				(typeof ArrayBuffer !== 'undefined' && (desc._body instanceof ArrayBuffer || ArrayBuffer.isView(desc._body))) ||
				typeof desc._body === 'string'
			) {
				fetchBody = desc._body;
			} else {
				fetchBody = JSON.stringify(desc._body);
				headers['Content-Type'] = headers['Content-Type'] || 'application/json';
			}
		}

		let reqContext = { url, method: desc._method, headers, body: fetchBody, descriptor: desc };
		for (const interceptor of this._interceptors.request) {
			try { reqContext = (await interceptor(reqContext)) || reqContext; }
			catch (e) { console.warn('[MiniX_Request] Request interceptor threw:', e); }
		}
		const requestUrl = reqContext.url || url;
		const requestMethod = String(reqContext.method || '').toUpperCase();
		reqContext.method = requestMethod;
		cacheKey = canUseCache && (requestMethod === 'GET' || requestMethod === 'HEAD') ? this._cacheKey({
			_method: requestMethod,
			_resolvedURL: requestUrl,
			_params: null,
			_responseType: desc._responseType
		}) : null;
		if (cacheKey) {
			const hit = this._cache.get(cacheKey);
			if (hit) {
				if (Date.now() < hit.expires) return hit.data;
				this._cache.delete(cacheKey);
			}
			// Evict all other stale entries opportunistically (once per fired request with a cache key).
			const now = Date.now();
			for (const [k, v] of this._cache) {
				if (now >= v.expires) this._cache.delete(k);
			}
		}

		const controller = new AbortController();
		this._abortControllers.set(id, controller);
		const signals = [controller.signal];
		if (desc._signal) signals.push(desc._signal);

		let timeoutId = null;
		if (desc._timeout > 0) {
			timeoutId = setTimeout(() => {
				controller.abort('timeout');
				this._emit('timeout', { url: requestUrl, timeout: desc._timeout, descriptor: desc });
			}, desc._timeout);
		}

		let composedSignal, anySignalCleanup;
		if (signals.length > 1) {
			const composed = this._anySignal(signals);
			composedSignal = composed.signal;
			anySignalCleanup = composed.cleanup;
		} else {
			composedSignal = signals[0];
			anySignalCleanup = null;
		}

		this._emit('before', { id, url: requestUrl, method: reqContext.method, descriptor: desc });

		let response;
		try {

			if (desc._onUploadProgress && typeof XMLHttpRequest !== 'undefined') {
				response = await this._xhrFetch(requestUrl, {
					method: reqContext.method,
					headers: reqContext.headers,
					body: reqContext.body,
					credentials: desc._credentials,
					signal: composedSignal,
					onUploadProgress: desc._onUploadProgress,
					onDownloadProgress: desc._onDownloadProgress,
				});
			} else {
				response = await fetch(requestUrl, {
					method: reqContext.method,
					headers: reqContext.headers,
					body: reqContext.body,
					credentials: desc._credentials,
					mode: desc._mode,
					cache: desc._cache,
					redirect: desc._redirect,
					referrerPolicy: desc._referrerPolicy,
					integrity: desc._integrity,
					keepalive: desc._keepalive,
					signal: composedSignal,
				});
			}

			if (desc._onDownloadProgress && response.body) {
				response = await this._trackDownload(response, desc._onDownloadProgress);
			}

			if (!response.ok) {
				const errBody = await this._safeRead(response, desc._responseType);
				const err = this._makeError(
					`HTTP ${response.status} ${response.statusText}`,
					response.status, requestUrl, reqContext.method, errBody, response
				);
				throw err;
			}

			let resContext = { response, descriptor: desc };
			for (const interceptor of this._interceptors.response) {
				try { resContext = (await interceptor(resContext)) || resContext; }
				catch (e) { console.warn('[MiniX_Request] Response interceptor threw:', e); }
			}

			const data = await this._read(resContext.response, desc._responseType);

			if (cacheKey) {
				this._cache.set(cacheKey, { data, expires: Date.now() + desc._cacheTime });
			}

			this._emit('after', { id, url: requestUrl, method: reqContext.method, data, response: resContext.response, descriptor: desc });
			return data;

		} catch (err) {
			const isAbort = err?.name === 'AbortError' || err?.name === 'abort';
			if (isAbort) {
				this._emit('abort', { id, url: requestUrl, method: reqContext.method, descriptor: desc });
				throw err;
			}

			if (attempt < desc._retry) {
				const delay = desc._retryDelay * Math.pow(desc._retryFactor, attempt);
				this._emit('retry', { id, url: requestUrl, attempt: attempt + 1, delay, error: err, descriptor: desc });
				await this._sleep(delay, composedSignal);
				return this._fire(desc, attempt + 1);
			}

			let throwErr = err;
			for (const interceptor of this._interceptors.error) {
				try {
					const result = await interceptor(err, desc);
					if (result !== undefined) return result;
				} catch (e) { throwErr = e; }
			}

			this._emit('error', { id, url: requestUrl, method: reqContext.method, error: throwErr, descriptor: desc });
			throw throwErr;
		} finally {
			
			clearTimeout(timeoutId);
			this._abortControllers.delete(id);
			anySignalCleanup?.();
		}
	}

	get(url, options = {}) { return this._builder('GET', url, undefined, options); }

	post(url, body, options = {}) { return this._builder('POST', url, body, options); }

	put(url, body, options = {}) { return this._builder('PUT', url, body, options); }

	patch(url, body, options = {}) { return this._builder('PATCH', url, body, options); }

	delete(url, options = {}) { return this._builder('DELETE', url, undefined, options); }

	head(url, options = {}) { return this._builder('HEAD', url, undefined, options); }

	options(url, options = {}) { return this._builder('OPTIONS', url, undefined, options); }

	addRequestInterceptor(fn) {
		this._interceptors.request.add(fn);
		return () => this._interceptors.request.delete(fn);
	}

	addResponseInterceptor(fn) {
		this._interceptors.response.add(fn);
		return () => this._interceptors.response.delete(fn);
	}

	addErrorInterceptor(fn) {
		this._interceptors.error.add(fn);
		return () => this._interceptors.error.delete(fn);
	}

	clearInterceptors(type) {
		if (type) { this._interceptors[type].clear(); }
		else { this._interceptors.request.clear(); this._interceptors.response.clear(); this._interceptors.error.clear(); }
		return this;
	}

	on(event, fn) {
		if (!this._listeners.has(event)) this._listeners.set(event, new Set());
		this._listeners.get(event).add(fn);
		return () => this._listeners.get(event)?.delete(fn);
	}

	off(event, fn) {
		if (!fn) { this._listeners.delete(event); return this; }
		this._listeners.get(event)?.delete(fn);
		return this;
	}

	_emit(event, payload) {
		this._listeners.get(event)?.forEach((fn) => { try { fn(payload); } catch (_) { } });
	}

	invalidate(url, params = {}) {
		const resolvedURL = this._resolveURL(url, params);
		const prefix = `GET:${resolvedURL}:`;
		for (const key of this._cache.keys()) {
			if (key.startsWith(prefix)) this._cache.delete(key);
		}
		return this;
	}

	clearCache() {
		this._cache.clear();
		return this;
	}

	getCacheEntries() {
		return [...this._cache.entries()].map(([key, v]) => ({ key, expires: v.expires, data: v.data }));
	}

	_cacheKey(desc) {
		const type = desc._responseType == null ? '' : String(desc._responseType);
		const url = desc._resolvedURL || this._resolveURL(desc._url, desc._params || {});
		return `${desc._method}:${url}:${type}`;
	}

	abort() {
		const lastId = this._lastFiredId;
		const ctrl = this._abortControllers.get(lastId);
		if (ctrl) { ctrl.abort('manual'); this._abortControllers.delete(lastId); return true; }
		return false;
	}

	abortAll() {
		this._abortControllers.forEach((ctrl) => ctrl.abort('manual'));
		this._abortControllers.clear();
		return this;
	}

	get pending() { return this._abortControllers.size; }

	extend(baseURLOrDefaults, defaults = {}) {
		let base = this._baseURL;
		let opts = defaults;
		if (typeof baseURLOrDefaults === 'string') {
			const path = baseURLOrDefaults;
			base = /^https?:\/\//i.test(path)
				? path.replace(/\/+$/, '')
				: this._baseURL + '/' + path.replace(/^\/+/, '').replace(/\/+$/, '');
		} else {
			opts = baseURLOrDefaults || {};
		}

		const mergedHeaders = { ...this._defaults.headers, ...(opts.headers || {}) };
		return new MiniX_Request(base, { ...this._defaults, ...opts, headers: mergedHeaders });
	}

	setHeader(name, value) {
		if (typeof name === 'object') Object.assign(this._defaults.headers, name);
		else this._defaults.headers[name] = value;
		return this;
	}

	removeHeader(name) {
		delete this._defaults.headers[name];
		return this;
	}

	setBaseURL(url) {
		this._baseURL = String(url).replace(/\/+$/, '');
		return this;
	}

	setAuth(token) {
		if (!token) return this.removeHeader('Authorization');
		return this.setHeader('Authorization', `Bearer ${token}`);
	}

	static all(requests) {
		return Promise.all(requests.map((r) => typeof r.then === 'function' ? r : (typeof r.json === 'function' ? r.json() : Promise.resolve(r))));
	}

	static allSettled(requests) {
		return Promise.allSettled(requests.map((r) => typeof r.then === 'function' ? r : (typeof r.json === 'function' ? r.json() : Promise.resolve(r))));
	}

	static race(requests) {
		return Promise.race(requests.map((r) => typeof r.then === 'function' ? r : (typeof r.json === 'function' ? r.json() : Promise.resolve(r))));
	}

	static async waterfall(steps) {
		let result;
		for (const step of steps) {
			const builder = typeof step === 'function' ? step(result) : step;
			result = typeof builder?.then === 'function' ? await builder : await builder.json();
		}
		return result;
	}

	static async pool(requests, limit = 4) {
		const results = new Array(requests.length);
		let index = 0;
		const workerCount = Math.max(1, Math.min(Number.isFinite(limit) ? Math.floor(limit) : 4, requests.length));
		const run = async () => {
			while (index < requests.length) {
				const i = index++;
				const req = requests[i];
				try {
					results[i] = { ok: true, value: await (typeof req === 'function' ? req() : req) };
				} catch (e) {
					results[i] = { ok: false, error: e };
				}
			}
		};
		await Promise.all(Array.from({ length: workerCount }, run));
		return results;
	}

	static _default = null;
	static _optionKeys = new Set([
		'headers', 'timeout', 'signal', 'cache', 'credentials', 'mode',
		'responseType', 'retry', 'retryDelay', 'retryFactor', 'cacheTime',
		'onUploadProgress', 'onDownloadProgress', 'keepalive', 'redirect',
		'referrerPolicy', 'integrity', 'params'
	]);
	static _absUrlRe = /^https?:\/\//i;

	static default(baseURL, options) {
		if (baseURL || !MiniX_Request._default) {
			MiniX_Request._default = new MiniX_Request(baseURL || '', options);
		}
		return MiniX_Request._default;
	}

	static get(url, options) { return MiniX_Request.default().get(url, options); }
	static post(url, body, options) { return MiniX_Request.default().post(url, body, options); }
	static put(url, body, options) { return MiniX_Request.default().put(url, body, options); }
	static patch(url, body, options) { return MiniX_Request.default().patch(url, body, options); }
	static del(url, options) { return MiniX_Request.default().delete(url, options); }
	static head(url, options) { return MiniX_Request.default().head(url, options); }

	_resolveURL(url, params) {
		let resolved;
		const urlStr = String(url || '');
		if (MiniX_Request._absUrlRe.test(urlStr)) {
			resolved = urlStr;
		} else {
			// Defensively strip trailing slash from baseURL at resolution time,
			// in case it was set via a path that preserved one.
			const base = this._baseURL.replace(/\/+$/, '');
			resolved = base + (urlStr ? '/' + urlStr.replace(/^\/+/, '') : '');
		}
		if (params) {
			const qs = new URLSearchParams();
			let hasAny = false;
			for (const k in params) {
				const v = params[k];
				if (v === undefined || v === null) continue;
				
				if (Array.isArray(v)) {
					for (const item of v) {
						if (item !== undefined && item !== null) { qs.append(k, String(item)); hasAny = true; }
					}
				} else {
					qs.append(k, String(v)); hasAny = true;
				}
			}
			if (hasAny) resolved += (resolved.includes('?') ? '&' : '?') + qs.toString();
		}
		return resolved;
	}

	async _read(response, type) {
		if (type === 'response') return response;
		if (type === 'text') return response.text();
		if (type === 'blob') return response.blob();
		if (type === 'arrayBuffer') return response.arrayBuffer();

		const text = await response.text();
		if (!text) return null;
		try { return JSON.parse(text); }
		catch (_) { return text; }
	}

	async _safeRead(response, type) {
		try { return await this._read(response.clone ? response.clone() : response, type); }
		catch (_) { return null; }
	}

	_makeError(message, status, url, method, body, response) {
		const err = new Error(message);
		err.status = status;
		err.url = url;
		err.method = method;
		err.body = body;
		err.response = response;
		err.isHTTPError = true;
		return err;
	}

	async _trackDownload(response, onProgress) {
		const contentLength = response.headers.get('content-length');
		const total = contentLength ? parseInt(contentLength, 10) : 0;
		let loaded = 0;
		const reader = response.body.getReader();
		const chunks = [];
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(value);
			loaded += value.byteLength;
			try { onProgress({ loaded, total, percent: total ? Math.round(loaded / total * 100) : 0 }); }
			catch (_) { }
		}
		const merged = new Uint8Array(loaded);
		let offset = 0;
		for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
		return new Response(merged, { status: response.status, statusText: response.statusText, headers: response.headers });
	}

	_xhrFetch(url, { method, headers, body, credentials, signal, onUploadProgress, onDownloadProgress }) {
		return new Promise((resolve, reject) => {
			const xhr = new XMLHttpRequest();
			xhr.open(method, url, true);
			xhr.withCredentials = credentials === 'include';
			if (headers) {
				for (const k in headers) {
					try { xhr.setRequestHeader(k, headers[k]); } catch (_) { }
				}
			}

			if (onUploadProgress) {
				xhr.upload.addEventListener('progress', (e) => {
					try { onUploadProgress({ loaded: e.loaded, total: e.total, percent: e.total ? Math.round(e.loaded / e.total * 100) : 0 }); }
					catch (_) { }
				});
			}
			if (onDownloadProgress) {
				xhr.addEventListener('progress', (e) => {
					try { onDownloadProgress({ loaded: e.loaded, total: e.total, percent: e.total ? Math.round(e.loaded / e.total * 100) : 0 }); }
					catch (_) { }
				});
			}

			signal?.addEventListener('abort', () => xhr.abort());

			xhr.responseType = 'arraybuffer';
			xhr.onload = () => {
				const response = new Response(xhr.response, {
					status: xhr.status,
					statusText: xhr.statusText,
					headers: this._parseXHRHeaders(xhr.getAllResponseHeaders()),
				});
				resolve(response);
			};
			xhr.onerror = () => reject(new TypeError('Network request failed'));
			xhr.onabort = () => { const e = new DOMException('Aborted', 'AbortError'); reject(e); };
			xhr.ontimeout = () => reject(new TypeError('Request timed out'));
			xhr.send(body ?? null);
		});
	}

	_parseXHRHeaders(raw) {
		const headers = new Headers();
		const lines = (raw || '').trim().split(/[\r\n]+/);
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const idx = line.indexOf(':');
			if (idx < 1) continue;
			const name = line.slice(0, idx).trim();
			const value = line.slice(idx + 1).trim();
			if (name) try { headers.set(name, value); } catch (_) { }
		}
		return headers;
	}

	_anySignal(signals) {
		const ctrl = new AbortController();
		const sigs = [];
		const abort = () => {
			for (let i = 0; i < sigs.length; i++) sigs[i].removeEventListener('abort', abort);
			sigs.length = 0;
			ctrl.abort();
		};
		for (const s of signals) {
			if (s.aborted) { abort(); break; }
			sigs.push(s);
			s.addEventListener('abort', abort, { once: true });
		}
		const cleanup = () => {
			for (let i = 0; i < sigs.length; i++) sigs[i].removeEventListener('abort', abort);
			sigs.length = 0;
		};
		return { signal: ctrl.signal, cleanup };
	}

	_sleep(ms, signal) {
		return new Promise((resolve, reject) => {
			let id;
			let onAbort;
			const cleanup = () => {
				if (signal && onAbort) signal.removeEventListener('abort', onAbort);
			};
			id = setTimeout(() => { cleanup(); resolve(); }, ms);
			
			
			if (signal) {
				if (signal.aborted) { clearTimeout(id); return reject(new DOMException('Aborted', 'AbortError')); }
				onAbort = () => { clearTimeout(id); cleanup(); reject(new DOMException('Aborted', 'AbortError')); };
				signal.addEventListener('abort', onAbort, { once: true });
			}
		});
	}
}

Object.assign(MiniX, {
	State: MiniX_State,
	Effect: MiniX_Effect,
	Compiler: MiniX_Compiler,
	Component: MiniX_Component,
	Plugin: MiniX_Plugin,
	Request: MiniX_Request,
	Provider: MiniX_Provider,
	EventBus: MiniX_Event_Bus,
	Renderer: MiniX_Renderer,
	Sanitizer: MiniX_Sanitizer,
});

Object.assign(MiniX_Global, {
	MiniX,
	MiniX_State,
	MiniX_Effect,
	MiniX_Compiler,
	MiniX_Component,
	MiniX_Plugin,
	MiniX_Request,
	MiniX_Provider,
	MiniX_Event_Bus,
	MiniX_Renderer,
	MiniX_Sanitizer,
});

if (typeof module !== 'undefined' && module.exports) {
	module.exports = MiniX;
}
