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

