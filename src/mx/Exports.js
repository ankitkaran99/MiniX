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
