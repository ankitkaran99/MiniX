class MiniX {
	constructor(rootComponent, options = {}) {
		this.rootComponent = rootComponent;
		this.options = {
			props: {},
			renderer: new MiniX_Renderer(),
			sanitizer: new MiniX_Sanitizer(),
			compiler: new MiniX_Compiler(),
			eventBus: MiniX.$bus,
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

	get instance() {
		return this._instance;
	}

	get bus() {
		return this.options.eventBus;
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

	layout(name, definition) {
		MiniX_Component.registerLayout(name, definition);
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

	inject(key, fallback = undefined) {
		return this.options.provider.inject(key, fallback);
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

		for (const plugin of this._plugins) {
			if (!plugin._installedOnApp) plugin.install?.(this._instance);
		}
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
MiniX.$bus = new MiniX_Event_Bus();
MiniX.bus = MiniX.$bus;
MiniX.readGlobalScopeVersion = function() {
	return MiniX._globalScopeState.get('version') || 0;
};
MiniX.invalidateGlobalScopes = function() {
	return MiniX._globalScopeState.increment('version');
};
const MiniX_Global = typeof window !== 'undefined' ? window : globalThis;
MiniX_Global.MiniX = MiniX;

