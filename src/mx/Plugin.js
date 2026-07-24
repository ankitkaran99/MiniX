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
					const result = definition.install.call(api, app);
					// If install() returned a meaningful (non-falsy, non-undefined) value, honour it;
					// otherwise fall back to the original app object.
					return (result !== undefined && result !== null && result !== false) ? result : app;
				}
				: () => { },
			uninstall: typeof definition.uninstall === 'function' ? definition.uninstall : () => { }
		};
	}
}

