class MiniX_Effect {
	static activeEffect = null;
	static _queues = { pre: new Set(), post: new Set(), frame: new Set() };
	static _flushing = false;
	static _framePending = false;
	static _flushPending = false;
	static _batchDepth = 0;

	constructor(fn, options = {}) {
		if (typeof fn !== 'function') throw new Error('MiniX_Effect requires a function');
		this.fn = fn;
		this.lazy = options.lazy === true;
		this.scheduler = options.scheduler || null;
		this.flush = options.flush || 'pre';
		const p = options.priority;
		this.priority = (typeof p === 'number' && isFinite(p)) ? p : 0;
		this.active = true;
		this.deps = null;
		this._running = false;
		this._scheduled = false;
		this._seq = 0;
		this._depsDirty = false;
		this._phase = this.flush === 'post' ? 'post' : (this.flush === 'frame' ? 'frame' : 'pre');
		// Pre-build a single schedule runner reused across all target deps for
		// this effect — avoids one closure allocation per tracked target+prop.
		this._scheduleRunner = () => this.schedule();
		this._scheduleRunner.__minix_effect__ = this;
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
		let targetStates = null;
		for (const dep of this.deps) {
			if (dep._trackedVersion !== tv) {
				if (dep.depType === 'target') {
					if (!targetStates) targetStates = new Set();
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
		if (targetStates) {
			for (const state of targetStates) state._untrackEffectIfDetached?.(this);
		}
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
			MiniX_State._flushBatchedTargetNotifications?.();
			MiniX_Effect._scheduleFlush();
			MiniX_State._scheduleCallbackFlush();
		}
	}

	static _scheduleFlush() {
		if (MiniX_Effect._batchDepth > 0 || MiniX_Effect._flushPending) return;
		MiniX_Effect._flushPending = true;
		MiniX_State._scheduleMicrotask(() => {
			MiniX_Effect._flushPending = false;
			MiniX_Effect._flushAll();
		});
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

	
	
	
	
	static _sortBuf = [];
	static _sortQueue(queue) {
		const buf = MiniX_Effect._sortBuf;
		buf.length = 0;
		for (const e of queue) buf.push(e);
		buf.sort(_effectComparator);
		return buf;
	}

	static _drainPhase(name) {
		const queue = MiniX_Effect._queues[name];
		if (!queue.size) return;
		if (queue.size === 1) {
			let effect;
			for (effect of queue) break;
			queue.clear();
			if (effect.active) {
				try { effect.run(); }
				catch (err) { console.error('[MiniX] Effect threw during flush:', err); }
			}
			return;
		}
		const items = MiniX_Effect._sortQueue(queue);
		queue.clear();
		for (let i = 0; i < items.length; i++) {
			const effect = items[i];
			if (effect.active) {
				try { effect.run(); }
				catch (err) { console.error('[MiniX] Effect threw during flush:', err); }
			}
		}
		// Release references held in the shared sort buffer so GC can collect
		// completed effect objects between flush cycles.
		MiniX_Effect._sortBuf.length = 0;
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
				// If either queue is not shrinking, we are in a hard cycle.
				if ((MiniX_Effect._queues.pre.size >= preSizeBefore && MiniX_Effect._queues.pre.size > 0)
					|| (MiniX_Effect._queues.post.size >= postSizeBefore && MiniX_Effect._queues.post.size > 0)) {
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
		let targetStates = null;
		for (const dep of this.deps) {
			if (dep.depType === 'target') {
				if (!targetStates) targetStates = new Set();
				targetStates.add(dep.state);
				dep.state._removeTargetWatcher?.(dep.target, dep.prop, dep.runner);
				dep.state._effectTargetRunnerMap?.get(this)?.get(dep.target)?.delete(dep.prop);
			} else if (dep.state._watchers) {
				dep.state._watchers.get(dep.key)?.delete(dep.runner);
				dep.state._effectRunnerMap?.get(this)?.delete(dep.key);
			}
		}
		this.deps.clear();
		if (targetStates) {
			for (const state of targetStates) state._trackedEffects?.delete(this);
		}
	}

	stop() {
		this._cleanupDeps();
		this.active = false;
		this._scheduled = false;
		const q = MiniX_Effect._queues;
		q.pre.delete(this);
		q.post.delete(this);
		q.frame.delete(this);
		return true;
	}
}

MiniX_Effect._seqCounter = 0;
MiniX_Effect._globalVersion = 0;

MiniX_Effect._raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb) => setTimeout(cb, 16);

