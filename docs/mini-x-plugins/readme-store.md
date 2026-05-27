---
product: Mini-X Store
summary: Global reactive stores for Mini-X with getters, actions, watchers, helper APIs, and clean component integration.
badges: ["Global state","Reactive stores","Actions","Getters"]
highlights: ["Centralized state with direct mutation ergonomics","Component and template access through $store()","Watchers, batching, patch helpers, and reset flows"]
metrics: ["Stores::Global registry","Getters::Computed state","Actions::Mutate safely","Watchers::Reactive side effects"]
sidebar: How to define stores, read them in components and templates, compose actions across stores, and work with the full store API.
---

# MiniX Store Plugin · Global state for MiniX apps

> **Product:** Mini-X Store
> **Summary:** Global reactive stores for Mini-X with getters, actions, watchers, helper APIs, and clean component integration.
> **Focus:** `Global state` | `Reactive stores` | `Actions` | `Getters`
>
> **Key Highlights:**
> - Centralized state with direct mutation ergonomics
> - Component and template access through $store()
> - Watchers, batching, patch helpers, and reset flows
> **Metrics & Scope:**
> - **Stores:** Global registry
> - **Getters:** Computed state
> - **Actions:** Mutate safely
> - **Watchers:** Reactive side effects

---

v1.1.0 ⚡ reactive stores 🔌 MiniX plugin 📦 global state

# MiniX Store Plugin

Declarative, reactive global stores for MiniX — with getters, actions, cross-store communication, and seamless template integration.

📖 Overview

**MiniX Store** is a powerful state management plugin built on MiniX's reactive core. It provides a centralized store registry, reactive state, computed getters, actions, and full integration with MiniX components. Use `$store('name')` anywhere — in templates, lifecycle hooks, or methods — to access reactive stores that automatically trigger UI updates.

> [!NOTE]
> ✨ **Key features:** reactive state & getters, action batching, undo/redo ready, cross-store calls, watchers, dev-friendly API, and zero boilerplate.

⚙️ Installation

Include the plugin script after `mini-x.js` (core). The plugin registers itself globally as `window.MiniXStore`.

```html
<script src="../../src/MiniX.js"></script>
<script src="../../src/mini-x-plugins/plugin-store.js"></script>   <!-- MiniXStore available -->
```

Then install the plugin when bootstrapping your MiniX app:

```javascript
const app = MiniX.createApp(App);
app.use(MiniXStore.plugin());
app.mount('#app');
```

🏪 Defining a Store

Use `MiniXStore.define(name, definition)` to create a reactive store. Returns a store proxy that can be imported anywhere.

```javascript
const counterStore = MiniXStore.define('counter', {
  state: () => ({
    count: 0,
    step: 1
  }),
  init(store) {
    const saved = Number(localStorage.getItem('counter:count'));
    if (Number.isFinite(saved)) this.count = saved;
  },
  getters: {
    doubled: (state) => state.count * 2,
    sign: (state) => state.count > 0 ? 'positive' : state.count < 0 ? 'negative' : 'zero'
  },
  actions: {
    increment() {
      this.count += this.step;      // direct mutation (reactive)
      // or this.$set('count', this.count + this.step)
    },
    decrement() { this.count -= this.step; },
    setStep(step) { this.step = step; }
  }
});
```

**Inside actions and init()** you can access `this.stateKey` directly (reactive proxy), or use helper methods: `this.$set(path, value)`, `this.$batch(fn)`, `this.$patch(path, updater)`. The optional `init(store)` hook runs once after state initialization and registration, so it can hydrate from `localStorage` or start an async backend bootstrap.

🧩 Integration with Components

Inside any component (class or object), define a `stores()` method returning a mapping of store names to store proxies. The plugin then injects `this.$store(name)` automatically.

```javascript
class TodoApp {
  stores() {
    return {
      counter: counterStore,   // from define()
      todos: todosStore,
      theme: themeStore
    };
  }
  
  mounted() {
    console.log(this.$store('counter').count);
    this.$store('counter').increment();
    // watchers
    this.$store('counter').watch('count', (newVal, oldVal) => {
      console.log(`count changed: ${oldVal} → ${newVal}`);
    });
  }
}
```

> [!NOTE]
> 💡 The `$store(name)` method first looks in your component's `stores()` mapping, then falls back to the global registry (stores defined via `MiniXStore.define`). Perfect for both local and shared stores.

🎨 Template Expressions

Use `$store('storeName')` directly in your templates — fully reactive with MiniX directives.

```html
<div>
  <h2>Counter: {{ $store('counter').count }}</h2>
  <p>Doubled: {{ $store('counter').doubled }}</p>
  <button @click="$store('counter').increment()">+</button>
  <button @click="$store('counter').decrement()">-</button>
  <input type="range" x-model.number="$store('counter').step" />
</div>
```

Getters automatically recompute when their dependencies change, and all actions are bound to the store instance.

🔄 Cross‑Store Actions & Logging

Because `MiniXStore.define` returns the actual store proxy, you can import and call other stores inside any action — perfect for audit logs, analytics, or orchestration.

```javascript
// logStore defined first
const logStore = MiniXStore.define('log', {
  state: () => ({ entries: [] }),
  actions: {
    push(storeName, msg) { /* ... */ }
  }
});

const todosStore = MiniXStore.define('todos', {
  actions: {
    add(text) {
      // ... add todo logic
      logStore.push('todos', `Added "${text}"`);  // cross-store call
    }
  }
});
```

No string-based lookups, full type safety and direct access. The demo (`demo-store.html`) shows a live event log that listens to every store change.

⚡ Store Instance API (inside actions)

### $set(path, value)

Update nested state reactively. `this.$set('user.name', 'Alex')`

### $get(path, fallback?)

Safely read nested values. `this.$get('items.0.title')`

### $batch(fn)

Batch multiple mutations into a single reactivity update. `this.$batch(() => { this.count = 10; this.step = 5; })`

### $patch(path, updaterFn)

Functional update on arrays/objects. `this.$patch('items', arr => arr.filter(i => i.active))`

### $merge(path, partialObj)

Deep merge object into state slice. `this.$merge('settings', { theme: 'dark' })`

### $reset()

Reset store to initial state defined in `state()`.

### watch(path, callback)

Watch a specific state path. Returns unsubscribe function. `this.watch('count', (val, old) => ...)`

### snapshot()

Returns a frozen copy of entire state (debugging).

### init(store)

Optional one-time hook after state creation. Use it for hydration, persisted preferences, or async bootstrap work.

**Getter caching:** getters are lazily computed and cached until their tracked dependencies change — automatic and efficient.

🌐 Global API (MiniXStore)

| Method | Description |
| --- | --- |
| `define(name, definition)` | Creates or retrieves a store. Returns store proxy. |
| `use(name)` | Retrieve a store by name from global registry. |
| `destroy(name)` | Stop watchers & remove store from registry. |
| `destroyAll()` | Destroy all registered stores. |
| `list()` | Returns array of registered store names. |
| `plugin()` | Returns plugin object for `app.use()`. |

🔍 Reactivity & Watchers

Every store is built on **MiniX\_State** and **MiniX\_Effect**. Changes to state automatically trigger template updates and watchers.

```javascript
// inside component
const unsubscribe = this.$store('counter').watch('count', (newCount, oldCount) => {
  console.log(`Counter moved from ${oldCount} to ${newCount}`);
  if (newCount >= 10) alert('Milestone!');
});

// later: unsubscribe() to stop watching
```

You can also watch deeply nested paths like `'user.profile.email'`. Watchers run after mutations and respect batching.

📦 Complete Demo Pattern

The `demo-store.html` showcases four integrated stores: counter (with undo), todos, theme picker, and event log. Below is a minimal but complete counter + log example.

```javascript
// 1. Define stores
const logStore = MiniXStore.define('log', {
  state: () => ({ events: [] }),
  actions: { record(msg) { this.events = [msg, ...this.events].slice(0, 20); } }
});

const counter = MiniXStore.define('counter', {
  state: () => ({ value: 0 }),
  actions: {
    inc() { this.value++; logStore.record(`inc → ${this.value}`); },
    dec() { this.value--; logStore.record(`dec → ${this.value}`); }
  }
});

// 2. App & plugin
class MyApp {
  stores() { return { counter, log: logStore }; }
  mounted() { console.log('ready', this.$store('counter').value); }
}

MiniX.createApp(MyApp)
  .use(MiniXStore.plugin())
  .mount('#app');
```

Then in your template: `{{ $store('counter').value }}` and `@click="$store('counter').inc()"` — everything just works.

✅ Best Practices

*   Define stores in dedicated modules and export the store proxy for reuse.
*   Use `$batch()` for multiple state changes to reduce renders.
*   Prefer getters over derived state in templates for better caching and readability.
*   Use `watch` for side effects, not for mutating other state directly — prefer actions for orchestration.
*   Destroy stores that are no longer needed (e.g., in large SPAs) via `MiniXStore.destroy(name)`.
*   Leverage cross-store calls for logging or analytics without tight coupling.

> [!NOTE]
> 💡 The plugin automatically injects `$store` into component instances before `created()` and adds it to the template scope. No extra setup needed.

📋 Complete Store Definition Schema

| Property | Type | Description |
| --- | --- | --- |
| `state` | `() => Object | Object` | Initial state. Function is recommended for fresh state on reset. |
| `init` | `(store) => void | Promise<any>` | Optional hook called once after initial state exists and the store is registered. `this` has the normal store action context. |
| `getters` | `{ [key]: (state) => any }` | Computed properties, cached, reactive. |
| `actions` | `{ [key]: function }` | Methods that can mutate state and call other actions. `this` provides state + helpers. |

**Action context helpers recap:** `this.$set`, `this.$get`, `this.$batch`, `this.$patch`, `this.$merge`, `this.$reset`, `this.watch`, `this.snapshot`, and direct property access (`this.count`).

🧰 Common Pitfalls & Solutions

*   **Store not reactive in template?** Ensure you installed plugin via `app.use(MiniXStore.plugin())` before mounting.
*   **Missing $store?** Your component must either have a `stores()` method returning a mapping or the store must be globally registered. `$store(name)` checks both.
*   **Getter not updating?** Getters only recompute when accessed and dependencies (state accessed inside them) change. Avoid side effects inside getters.
*   **Cross-store circular dependency?** Use separate files and import store proxies after definition; order matters but works because stores are lazy.
*   **Destroying a store stops all watchers and effects, including those used by components.** Only destroy when the store is no longer needed (e.g., on app teardown).

🔗 Additional Resources

📁 The plugin source is fully documented inside `plugin-store.js`. The demo file `demo-store.html` provides a working kitchen-sink example with a counter (undo/redo), todo list, theme switcher, and live event log. Use it as a blueprint for real-world apps.

⚡ MiniX core reactivity powers the store — every store action automatically triggers UI patches and keeps getters in sync.

> [!NOTE]
> 🚀 Ready to supercharge your MiniX apps? Install the plugin, define your stores, and enjoy reactive global state with zero friction.

MiniX Store Plugin v1.1.0 — Built with ❤️ on MiniX reactive core. MIT Licensed.

🔌 Seamless global stores · Reactive by nature · Full MiniX integration

// ensure code blocks highlight after load document.querySelectorAll('pre code').forEach((block) => { if (window.Prism) Prism.highlightElement(block); });