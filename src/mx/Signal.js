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
			const entry = keyMap.get(key);
			const existingDep = entry?.dep || entry?.__dep;
			if (existingDep) existingDep._trackedVersion = tv;
			return;
		}
		const runner = effect._scheduleRunner;
		watchers.add(runner);
		const dep = { state: this, key, runner, _trackedVersion: tv };
		keyMap.set(key, { runner, dep });
		if (!effect.deps) effect.deps = new Set();
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
		const hadKey = Object.hasOwn(this._state, key);
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
		this._notify(key, nextVal, oldVal, MiniX_State._META_INCREMENT);
		return nextVal;
	}

	_notify(pathKey, newVal, oldVal, meta = MiniX_State._EMPTY_META) {
		const globalWatchers = this._globalWatchers;
		const watchers = this._watchers.get(pathKey);
		let queued = false;
		// Pre-build the dedup key suffix once per notify call rather than
		// allocating a new template-literal string for every watcher enqueued.
		const pathSuffix = ':' + pathKey;

		if (!globalWatchers?.size) {
			if (!watchers) return;
			for (const cb of watchers) {
				const effect = cb.__minix_effect__;
				if (effect) { if (!effect._scheduled) effect.schedule(); }
				else {
					if (cb.__minix_cbid__ === undefined) cb.__minix_cbid__ = ++MiniX_State._cbIdCounter;
					MiniX_State._pendingCallbackQueue.set(cb.__minix_cbid__ + pathSuffix, [cb, newVal, oldVal, pathKey, meta]);
					queued = true;
				}
			}
			if (queued) MiniX_State._scheduleCallbackFlush();
			return;
		}

		const dispatch = (cb) => {
			const effect = cb.__minix_effect__;
			if (effect) { if (!effect._scheduled) effect.schedule(); }
			else {
				if (cb.__minix_cbid__ === undefined) cb.__minix_cbid__ = ++MiniX_State._cbIdCounter;
				MiniX_State._pendingCallbackQueue.set(cb.__minix_cbid__ + pathSuffix, [cb, newVal, oldVal, pathKey, meta]);
				queued = true;
			}
		};
		for (const cb of globalWatchers) dispatch(cb);
		if (watchers) for (const cb of watchers) dispatch(cb);
		if (queued) MiniX_State._scheduleCallbackFlush();
	}
}

// Hoisted comparator — avoids a closure allocation on every _sortQueue call.
const _effectComparator = (a, b) => {
	const pd = b.priority - a.priority;
	return pd !== 0 ? pd : a._seq - b._seq;
};

