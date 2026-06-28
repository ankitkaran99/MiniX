---
product: Mini-X Debug
summary: Developer tracing for Mini-X apps, components, directives, stores, and router activity, with an in-page panel and console bridge.
badges: ["Debugging","Lifecycle tracing","Store snapshots","Router hooks"]
highlights: ["Trace component lifecycle and watchers","Inspect store and router snapshots","Use the MxDB bridge from browser DevTools"]
metrics: ["Events::500 ring buffer","Bridge::window.MxDB","Panel::In-page inspector","Flags::Runtime toggles"]
sidebar: "This guide covers the debug plugin surface area: installation, event stream types, runtime flags, console bridge, and store/router instrumentation."
---

# MiniX Debug Plugin — README

> **Product:** Mini-X Debug
> **Summary:** Developer tracing for Mini-X apps, components, directives, stores, and router activity, with an in-page panel and console bridge.
> **Focus:** `Debugging` | `Lifecycle tracing` | `Store snapshots` | `Router hooks`
>
> **Key Highlights:**
> - Trace component lifecycle and watchers
> - Inspect store and router snapshots
> - Use the MxDB bridge from browser DevTools
> **Metrics & Scope:**
> - **Events:** 500 ring buffer
> - **Bridge:** window.MxDB
> - **Panel:** In-page inspector
> - **Flags:** Runtime toggles

---

README / Documentation

# MiniX Debug Plugin

A developer-mode debugging plugin for **MiniX** that traces component lifecycle, watcher activity, directive compilation, prop changes, x-for loop issues, store updates, and router navigation — while also exposing a live in-page debug panel and a console bridge through `window.MxDB`.

Lifecycle tracing

Watcher logging

Directive logging

Prop diffs

x-for key warnings

Store snapshots

Router snapshots

Floating debug panel

**v1.0.0**Plugin version in source

**500**Max event ring-buffer size

**8**Runtime flags available

**MxDB**Browser console bridge

## What it does

*   Logs human-readable component activity with component names.
*   Records lifecycle hooks like `created`, `mounted`, `updated`, and `unmounted`.
*   Wraps state watchers so path changes can be inspected as old value → new value.
*   Logs directive usage such as `x-if`, `x-for`, `x-model`, and bindings handled by the compiler.
*   Diffs incoming props on child updates.
*   Warns about risky `x-for` keys like missing keys, duplicate keys, or unstable index-style keys.
*   Hooks MiniXStore and MiniXRouter when present, then exposes snapshots in both the panel and console bridge.
*   Shows a draggable, collapsible debug panel inside the page.

## Best fit

Use this plugin during local development, integration testing, and framework debugging. It is especially handy when a component updates “for no reason”, a child prop is drifting, or your list rendering is doing tiny acts of DOM violence.

This is a development tool. It patches MiniX internals and compiler methods globally for the current page, so it should not be treated like a lightweight production analytics plugin.

## Installation

Load MiniX first, then the debug plugin. If you also use the store or router plugins, load them before your app mounts.

```
<script src="../../src/MiniX.js"></script>
<script src="../../src/mini-x-plugins/plugin-store.js"></script>
<script src="../../src/mini-x-plugins/plugin-router.js"></script>
<script src="../../src/mini-x-plugins/plugin-debug.js"></script>
```

### Basic app usage

```
MiniX.createApp(App)
  .use(MiniX_Debug.plugin())
  .mount('#app');
```

### With explicit flags

```
MiniX.createApp(App)
  .use(MiniX_Debug.plugin({
    lifecycle: true,
    watchers: true,
    directives: true,
    props: true,
    loops: true,
    effects: false,
    panel: true,
    verbose: false
  }))
  .mount('#app');
```

## Real integration pattern

This matches the uploaded demo structure: MiniX app + store plugin + router plugin + debug plugin, all wired end to end.

```
const debugStore = MiniXStore.define('debug', {
  state: () => ({ count: 10, user: 'Store Ada', notes: [] }),
  actions: {
    increment() { this.count += 1; },
    rename() { this.user = 'Store Grace'; }
  }
});

const router = MiniXRouter.createRouter({
  history: MiniXRouter.createWebHashHistory(),
  debug: true,
  routes: [
    { path: '/', name: 'home', component: HomeRoute },
    { path: '/details', name: 'details', component: DetailsRoute }
  ]
});

MiniX.createApp(DebugDemoApp)
  .dev(true)
  .use(MiniXStore.plugin())
  .use(router)
  .use(MiniX_Debug.plugin({
    lifecycle: true,
    watchers: true,
    directives: true,
    props: true,
    loops: true,
    effects: false,
    panel: true,
    verbose: false
  }))
  .mount('#debug-demo');
```

## Plugin options

| Option | Default | What it controls |
| --- | --- | --- |
| `lifecycle` | `true` | Logs component lifecycle hooks such as `created`, `mounted`, `updated`, and `unmounted`. |
| `watchers` | `true` | Wraps state watchers and logs watcher path changes. |
| `directives` | `true` | Logs compiler directive bindings and expressions. |
| `props` | `true` | Diffs previous and next props when `updateProps` runs on a component. |
| `loops` | `true` | Warns about missing, duplicate, or unstable `x-for` keys. |
| `effects` | `false` | Reserved for verbose effect flush tracing. Keep this off unless you want more noise. |
| `panel` | `true` | Creates the floating in-page debug panel. |
| `verbose` | `false` | Includes richer value dumps and grouped console output. |

## Console bridge: `window.MxDB`

Once installed in a browser, the plugin exposes a helper object on `window`.

```
MxDB.components()     // list live components
MxDB.inspect(name)    // inspect one component by name or index
MxDB.events(50)       // get last N events
MxDB.clearEvents()    // clear log
MxDB.stores()         // list MiniXStore snapshots
MxDB.store('debug')   // inspect one store
MxDB.router()         // inspect current router snapshot
MxDB.showPanel()      // reopen the floating panel
MxDB.log              // raw event array getter
MxDB.registry         // raw component registry getter
MxDB.routers          // raw tracked routers getter
```

## Runtime flag changes

You can call `MxDB.enable(...)` at runtime.

```
MxDB.enable({ verbose: true, panel: true });
```

> [!NOTE]
> Passing an object updates the internal default flags for future behavior. Passing a single string key only prints a console note; it does not immediately flip that flag by itself.

## Event types you will see

| Type | Example payload idea | Why it matters |
| --- | --- | --- |
| `lifecycle` | `{ phase: 'mounted' }` | Shows component hook flow. |
| `watcher` | `{ path: 'user.name', old: 'Ada', new: 'Grace' }` | Helps explain reactive updates. |
| `directive` | `{ directive: 'x-model', expression: 'user.name' }` | Confirms compiler directive binding. |
| `props` | `{ changes: [...] }` | Shows what changed in child inputs. |
| `loop` | `{ kind: 'missing-key' }` | Points out brittle list rendering. |
| `store` | `{ name: 'debug', path: 'count', old: 1, new: 2 }` | Tracks store state and debug events. |
| `router` | `{ type: 'afterEach', ... }` | Shows route navigation snapshots. |

> [!NOTE]
> The plugin stores events in a ring buffer capped at **500** entries. When the cap is reached, older entries are discarded first.

## Floating debug panel

The panel is browser-only and includes tabs for:

*   **Events** — recent event stream
*   **Components** — live component registry snapshots
*   **Stores** — MiniXStore snapshots
*   **Router** — tracked router snapshots

You can drag it, collapse it, close it, clear logs, and copy the event log to the clipboard.

## Store and router support

*   If `window.MiniXStore` is present, the plugin hooks store creation and store watch events.
*   If `window.MiniXRouter` is present, the plugin tracks router snapshots and route changes.
*   The console bridge exposes both through `MxDB.stores()`, `MxDB.store(name)`, and `MxDB.router()`.

## Example component patterns the plugin can observe

```
class DebugChild {
  static props = {
    label: { type: String, default: 'Anonymous' },
    version: { type: Number, fallback: 1 },
    count: { type: Number, fallback: 0 }
  };

  data() {
    return { localClicks: 0 };
  }

  view = `
      <div>
        <h3 x-text="'DebugChild v' + $props.version"></h3>
        <p><span x-text="$props.label"></span></p>
        <button @click="localClicks++">Click</button>
      </div>
    `;

  mounted() {}
  updated() {}
  beforeUnmount() {}
  unmounted() {}
}
```

In this style of component, the plugin can observe lifecycle hooks, prop diffs, local state updates, directive bindings in the template, and child mount/unmount behavior.

## How to use it in DevTools

1.  Load the page with the plugin installed.
2.  Trigger real interactions: update state, toggle `x-if`, reorder `x-for`, change child props, navigate routes, or mutate stores.
3.  Open the browser console.
4.  Run `MxDB.components()` to list live components.
5.  Run `MxDB.inspect('DebugDemoApp')` or inspect by numeric index.
6.  Run `MiniX_Debug.getEvents()` or `MxDB.events()` to inspect recent activity.

## Important behavior notes

> [!NOTE]
> **Double-install protection:** the plugin guards against installing itself twice on the same app instance using an internal flag.

> [!NOTE]
> **Global patching:** compiler patches are applied once per page and restored by `MiniX_Debug.uninstall()`.

> [!NOTE]
> **Browser-only bridge:** `window.MxDB` and the panel exist only when `window`/`document` are available.

**Uninstall is global-ish:** uninstalling restores patched methods, removes the panel, clears tracked registries, detaches listeners, and deletes `window.MxDB`. That is great for teardown, but not something to fling around casually in a shared dev page unless you mean it.

## Public API

```
MiniX_Debug.plugin(options)  // returns a MiniX plugin instance
MiniX_Debug.uninstall()      // restores patches and removes bridge/panel
MiniX_Debug.getEvents(n)     // returns a copy of the recorded events
```

Generated from the uploaded MiniX debug plugin source and demo integration.