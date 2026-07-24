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
	emit(name, payload = null, meta = _MINIX_EMPTY_META) {
		let _ts = 0;
		const event = {
			name, payload, meta,
			get timestamp() { return _ts || (_ts = Date.now()); }
		};
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

