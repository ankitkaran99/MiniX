# MiniX

MiniX is a small reactive frontend platform built around one runtime instead of a pile of disconnected utilities. The repository contains:

- `src/mx/`: the modular core framework source files (`App.js`, `Compiler.js`, `Component.js`, `State.js`, `Request.js`, etc.), compiled into `dist/MiniX.js`.
- `dist/MiniX.js` & `dist/MiniX.min.js`: the built bundle containing deep reactivity, effects, compiler, component system, layouts, plugin hooks, and request client.
- `src/mini-x-plugins/plugin-*.js`: official plugins for global stores, routing, forms, masking, i18n, scrolling, DataTables integration, and debug tooling.
- `src/Inspect.js`: a standalone validation engine used by the form plugin but usable independently.
- `src/Model.js` and `src/Collection.js`: helpers for reactive domain objects and list handling.
- `src/InputMaskEngine.js` and `src/InputMaskEngineAdapter.js`: the pure masking engine used by the MiniX mask plugin and the vanilla adapter.

## What MiniX actually is

MiniX is not just a templating helper. The runtime combines:

- `MiniX_State`: deep proxy-based reactive state with watchers, batching, raw escapes, and optional dev history.
- `MiniX_Effect` and `MiniX_Signal`: dependency tracking and batched invalidation.
- `MiniX_Compiler`: directive parsing, expression evaluation, structural DOM orchestration, and cleanup management.
- `MiniX_Component`: class-based components, props, lifecycle hooks, nested components, layouts, slots, sections, and partials.
- `MiniX_Request`: a built-in request helper for lightweight network workflows.

The plugins in `src/mini-x-plugins/` are intentionally built on top of this same runtime surface. They do not create parallel state or rendering systems.

## Documentation map

- Core framework: [docs/readme.md](docs/readme.md)
- Store plugin: [docs/mini-x-plugins/readme-store.md](docs/mini-x-plugins/readme-store.md)
- Router plugin: [docs/mini-x-plugins/readme-router.md](docs/mini-x-plugins/readme-router.md)
- Form plugins: [docs/mini-x-plugins/readme-form.md](docs/mini-x-plugins/readme-form.md)
- Mask plugin: [docs/mini-x-plugins/readme-mask.md](docs/mini-x-plugins/readme-mask.md)
- i18n plugin: [docs/mini-x-plugins/readme-i18n.md](docs/mini-x-plugins/readme-i18n.md)
- Scroll plugin: [docs/mini-x-plugins/readme-scroll.md](docs/mini-x-plugins/readme-scroll.md)
- DataTable plugin: [docs/mini-x-plugins/readme-datatable.md](docs/mini-x-plugins/readme-datatable.md)
- Debug plugin: [docs/mini-x-plugins/readme-debug.md](docs/mini-x-plugins/readme-debug.md)
- Inspect.js: [docs/readme-inspect.md](docs/readme-inspect.md)
- Model and Collection: [docs/readme-model.md](docs/readme-model.md)
- InputMaskEngine: [docs/readme-ime.md](docs/readme-ime.md)

## Plugin summary

| Plugin | Responsibility | Key integration surface |
| --- | --- | --- |
| Store | Global reactive stores with actions and getters | `MiniXStore.define()`, `MiniXStore.plugin()`, `$store()` |
| Router | URL-driven component rendering and navigation | `createRouter()`, `x-link`, `x-route`, `x-router-view` |
| Form | Validation and AJAX submission | `x-validate`, `x-ajax`, Inspect.js |
| Mask | Reactive input masking | `x-mask`, `x-mask-free`, InputMaskEngine |
| i18n | i18next integration and translation directives | `MiniX_i18n()`, `x-i18n` |
| Scroll | Boundary-triggered async loading | `x-scroll` |
| DataTable | DataTables cell-to-component bridge | `app.$dtCell()`, `app.$dataTable.attach()` |
| Debug | Runtime introspection and event logging | `MiniX_Debug.plugin()`, `window.MxDB` |

## Repository usage model

The framework is browser-first and demo-friendly. Most modules expose globals in browser environments and CommonJS exports where useful. That means the repository works well for direct script-tag demos, local HTML prototypes, and small app shells without forcing a bundler.

The tradeoff is that documentation has to be explicit about ownership boundaries:

- MiniX owns reactive component rendering.
- Plugins extend MiniX by registering directives or app APIs.
- Third-party libraries should be isolated through integration plugins or `x-ignore`.
- Standalone utilities like Inspect and InputMaskEngine stay usable outside MiniX.

## Minifying source files

The repository includes standalone minify scripts for PowerShell and Bash. Both scripts recursively minify JavaScript files from `src/` into `dist/`, preserving the same directory structure and using Terser compression plus mangling.

PowerShell:

```powershell
.\minify.ps1
```

Bash:

```bash
bash minify.sh
```

For example, `src/a/b/app.js` is written to `dist/a/b/app.js`.

## Reading order

If you are new to the repository, the useful order is:

1. Read the core framework docs to understand the runtime model.
2. Read the store and router docs if you need app-level state or multi-page navigation.
3. Read the form, mask, and i18n docs for user-input flows.
4. Read Inspect, Model/Collection, and InputMaskEngine if you need the underlying standalone modules directly.

## Quick usage snapshot

```html
<div id="app"></div>
<script src="./dist/MiniX.js"></script>
<script src="./src/mini-x-plugins/plugin-store.js"></script>
<script>
  const counterStore = MiniXStore.define('counter', {
    state: () => ({ count: 0 }),
    actions: {
      increment() { this.count += 1; }
    }
  });

  class App {
    stores() {
      return { counter: counterStore };
    }

    view() {
      return `
        <section>
          <h1>{{ $store('counter').count }}</h1>
          <button @click="$store('counter').increment()">Increment</button>
        </section>
      `;
    }
  }

  MiniX.createApp(App)
    .use(MiniXStore.plugin())
    .mount('#app');
</script>
```

That example is intentionally small. The deeper HTML docs now cover the richer flows: nested components, routing, validation, AJAX forms, masking, i18n, DataTables integration, and debug tooling.
