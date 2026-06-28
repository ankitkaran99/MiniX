---
product: Mini-X Core
summary: Deep documentation for the Mini-X reactive framework, its component model, directives, reactivity, plugins, renderer, and request stack.
badges: ["Reactive core","Directives","Plugins","HTTP helper"]
highlights: ["Reactive state and effects","Component and directive lifecycle","Layouts, slots, and portals"]
metrics: ["Core::Framework guide","Components::Class-based UI","Directives::Template compiler","Plugins::Extension points"]
sidebar: Everything needed to wire Mini-X itself, from app boot to directives, state, layouts, plugins, and practical patterns.
---
{% raw %}

# MiniX JS Framework - Deep Documentation

> **Product:** Mini-X Core
> **Summary:** Deep documentation for the Mini-X reactive framework, its component model, directives, reactivity, plugins, renderer, and request stack.
> **Focus:** `Reactive core` | `Directives` | `Plugins` | `HTTP helper`
>
> **Key Highlights:**
> - Reactive state and effects
> - Component and directive lifecycle
> - Layouts, slots, and portals
> **Metrics & Scope:**
> - **Core:** Framework guide
> - **Components:** Class-based UI
> - **Directives:** Template compiler
> - **Plugins:** Extension points

---

## MiniX JavaScript Framework  
Deep Documentation

This standalone manual documents the uploaded MiniX framework implementation in detail: reactive state, effects, compiler directives, components, local/global component registration, plugins, dependency injection, rendering, sanitization, event bus, and HTTP requests.

Source size: 299,655 bytesBrowser globals + CommonJSClass-based componentsAlpine/Vue-like directivesNo build step required

## 1\. Overview

**MiniX** is a compact UI framework designed for pages that need modern reactivity without a full SPA setup. It is especially useful for server-rendered apps, admin panels, Laravel Blade screens, dashboards, forms, reusable widgets, modals, filters, and small apps.

#### Main idea

A component class returns data and HTML. MiniX wraps the data with reactive proxies, compiles directives in the HTML, and updates the DOM when state changes.

#### Best fit

Use MiniX where you want lightweight behavior on ordinary HTML pages: CRUD screens, table filters, dynamic modals, form wizards, small dashboards, and embedded widgets.

### Exports

| Name | Purpose |
| --- | --- |
| `MiniX` | Main app factory and namespace. |
| `MiniX_State` | Reactive state manager with path get/set/watch/batch helpers. |
| `MiniX_Effect` | Effect runner and scheduler for dependency-tracked updates. |
| `MiniX_Compiler` | DOM compiler for directives and interpolation. |
| `MiniX_Component` | Mounts, rerenders, manages props/state/children, and destroys components. |
| `MiniX_Plugin` | Plugin helper. |
| `MiniX_Request` | Fetch/XHR wrapper with retries, timeout, cache, interceptors, abort, and progress support. |
| `MiniX_Renderer` | Template interpolation and pipe/modifier support. |
| `MiniX_Sanitizer` | HTML sanitizer with DOMPurify support and fallback behavior. |
| `MiniX_Event_Bus` | Simple event bus. |
| `MiniX_Provider` | Dependency injection container. |

## 2\. Quick start

Include the script, define a class, and mount it.

```
<div id="app"></div>
<script src="../src/MiniX.js"></script>
<script>
class CounterApp {
  data() {
    return { count: 0, title: 'MiniX Counter' };
  }

  get doubleCount() {
    return this.count * 2;
  }

  increment() {
    this.count++;
  }

  view() {
    return `
      <section>
        <h3 x-text="title"></h3>
        <p>Count: <span x-text="count"></span></p>
        <p>Double: <span x-text="doubleCount"></span></p>
        <button x-on:click="increment()">+1</button>
      </section>
    `;
  }
}

MiniX.createApp(CounterApp).mount('#app');
</script>
```

> [!TIP]
> **Mental model:** write normal class code and normal HTML. MiniX does the reactive wiring behind the curtain—the tiny electrician inside the wall.

## 3\. Architecture

#### State layer

`MiniX_State` wraps objects, arrays, maps, and sets with proxies. Reads are tracked; writes notify watchers and effects.

#### Compiler layer

`MiniX_Compiler` walks DOM nodes, sorts directives by priority, compiles bindings, and stores cleanup callbacks.

#### Component layer

`MiniX_Component` creates the user class, injects `$` APIs, resolves props, renders templates, and manages child components.

### Lifecycle flow

1.  `MiniX.createApp(Component)` creates an app wrapper.
2.  `.mount(target)` creates a `MiniX_Component`.
3.  The user component class is instantiated.
4.  Props are normalized and resolved.
5.  `data()` is wrapped using `MiniX_State`.
6.  Methods, computed values, watchers, refs, provider, event bus, and helpers are bound.
7.  `created()` runs.
8.  The view/template/layout is resolved and inserted.
9.  The compiler binds directives and interpolation.
10.  `mounted()` runs.
11.  State writes trigger effects and DOM updates.
12.  `destroy()` cleans effects, listeners, children, and compiler cleanup.

## 4\. Component shape

A component is normally a JavaScript class. It can define `data()`, class methods, `methods`, `computed`, `watch`, props, lifecycle hooks, local components, layout, and view/template.

```
class UserCard {
  static props = {
    user: { type: Object, required: true },
    compact: { type: Boolean, default: false }
  };

  data() {
    return { loading: false, expanded: false };
  }

  methods = {
    toggle() { this.expanded = !this.expanded; }
  };

  computed = {
    displayName() { return this.props.user?.name || 'Guest'; }
  };

  watch = {
    expanded(newVal, oldVal) { console.log('expanded changed', newVal); }
  };

  created(payload) {}
  mounted(payload) {}
  updated(payload) {}
  destroyed(payload) {}

  view() {
    return `
      <article x-class="{ compact: compact }">
        <h4 x-text="displayName"></h4>
        <button @click="toggle()">Toggle</button>
      </article>
    `;
  }
}
```

| Member | Description |
| --- | --- |
| `data()` | Returns initial reactive state. Top-level keys become available as `this.key`. |
| `methods` | Object of methods bound to the component instance and wrapped in a state batch. |
| Class methods | Prototype methods are also exposed to template scope. |
| `computed` | Getter functions registered with reactive effects. |
| `watch` | Path watchers: `{ name(newVal, oldVal) {} }`. |
| `static props` | Defines incoming props and validation/defaults. |
| `view`/`template` | HTML string or function used for rendering. |
| `layout` | Optional wrapper around the component view. |
| `registerComponents()` | Defines local child components. |

## 5\. MiniX app API

```
const mounted = MiniX.createApp(AppComponent, options)
  .dev(true)
  .request('/api')
  .component('user-card', UserCard)
  .directive('x-tooltip', handler)
  .modifier('currency', handler)
  .provide('auth', authService)
  .mount('#app');
```

| Method | Use |
| --- | --- |
| `MiniX.createApp(rootComponent, options)` | Create an app wrapper. |
| `.dev(enabled = true)` | Enable dev behavior and state history. |
| `.request(baseURLOrInstance, defaults)` | Attach a request client. Components can call `this.$fetch()`. |
| `.component(name, definition)` | Register global component. |
| `.directive(name, handler, options)` | Register custom directive. |
| `.modifier(name, handler)` | Register interpolation pipe/modifier. |
| `.addScope(factory)` | Add global template-scope helpers. |
| `.addInstanceAPI(factory)` | Add reusable methods/properties to component instances. |
| `.use(plugin)` | Install plugin. |
| `.provide(key, value)` | Register root dependency. |
| `.mount(target)` | Mount root component. |
| `.unmount()` | Destroy mounted root component. |

## 6\. Component instance API

MiniX injects useful `$` APIs into every component.

| API | Description |
| --- | --- |
| `$component` | Internal component wrapper. |
| `$refs` | Refs collected by `x-ref`. |
| `$parent`, `$root`, `$children` | Component hierarchy helpers. |
| `props`, `$props` | Readonly props proxy. |
| `$el` | Root element. |
| `$bus` | Shared event bus. |
| `$provider`, `$provide`, `$inject` | Dependency injection helpers. |
| `$nextTick(callback)` | Run callback in a microtask. |
| `$listen`, `$timeout`, `$interval` | Auto-cleaned listeners and timers. |
| `$computed(name, getter)` | Create computed value dynamically. |
| `$watch(pathOrGetter, callback)` | Watch path or getter function. |
| `$effect(fn, options)` | Create reactive effect. Returns disposer. |
| `$emit(name, payload, meta)` | Emit bus event with component metadata. |
| `$mountChild(name, element, props)` | Manually mount child. |
| `$destroy()` | Destroy component. |
| `$refresh(meta)` | Force rerender. |
| `$setProps(props, options)` | Update props. |
| `$layout(newLayout)` | Swap layout at runtime. |
| `$view(newView)` | Swap view at runtime. |
| `$fetch(url, options)` | Request helper. |
| `$state` | Compact state API: `get`, `set`, `batch`, `increment`, `push`, `pop`, `map`, `filter`. |
| `$get`, `$set`, `$patch`, `$merge`, `$toggle` | Convenience state helpers. |
| `$batch(fn)` | Batch state writes. |
| `$snapshot()` | Clone current state. |
| `$history()`, `$clearHistory()` | Dev-mode state log helpers. |

## 7\. Reactive state API

Inside a MiniX component, return plain data from `data()` and use the injected state helpers. Top-level state keys are exposed as normal instance properties, while `$state`, `$get`, `$set`, `$patch`, `$merge`, `$toggle`, `$batch`, and `$watch` give components the usual MiniX state workflow without manually creating `MiniX_State`.

```
class ProfileEditor {
  data() {
    return {
      user: { name: 'Ankit', email: '' },
      saving: false,
      changes: 0
    };
  }

  mounted() {
    this.$watch('user.name', (newVal, oldVal) => {
      console.log(oldVal, '=>', newVal);
    });
  }

  updateName(name) {
    this.$set('user.name', name);
    this.$state.increment('changes');
  }

  saveDraft() {
    this.$batch(() => {
      this.$merge('user', { updatedAt: new Date().toISOString() });
      this.saving = false;
    });
  }

  view() {
    return `
      <section>
        <input x-model="user.name">
        <p>Changes: <span x-text="changes"></span></p>
        <button @click="saveDraft()" x-disabled="saving">Save draft</button>
      </section>
    `;
  }
}
```

### Path syntax

*   `user.name` for object keys.
*   `items[0].title` for arrays.
*   `settings["theme.mode"]` for quoted keys containing dots.

| Component API | Use |
| --- | --- |
| `this.key` | Read or assign top-level state returned by `data()`. |
| `this.$get(path, fallback)` | Read a nested state path. |
| `this.$set(path, value)` | Set a path and refresh template scope when a new root key appears. |
| `this.$patch(path, updater)` | Replace a path with a value or updater result. |
| `this.$merge(path, payload)` | Shallow merge an object path. |
| `this.$toggle(path)` | Toggle a boolean state path. |
| `this.$batch(fn)` | Group several state writes into one reactive flush. |
| `this.$snapshot()` | Clone the component state. |
| `this.$watch(pathOrGetter, callback)` | Watch a path or computed getter. |
| `this.$state.get(path)` | Compact path reader used by advanced helpers. |
| `this.$state.set(path, value)` | Compact path writer used by advanced helpers. |
| `this.$state.batch(fn)` | Compact batching helper. |
| `this.$state.increment(path, amount)` | Increase a numeric path by `amount`, defaulting to `1`. |
| `this.$state.push(path, item)` | Push into an array path or create an array. |
| `this.$state.pop(path)` | Pop from an array path. |
| `this.$state.map(path, cb)` | Replace an array path with its mapped result. |
| `this.$state.filter(path, cb)` | Replace an array path with its filtered result. |
| `this.$history()` | Read dev history when the app was created with `.dev(true)`. |
| `this.$clearHistory()` | Clear dev history when dev mode is enabled. |

> [!WARNING]
> **Tip:** keep state as plain serializable data. Store DOM nodes, editor instances, chart objects, services, or third-party class instances on normal component fields instead of returning them from `data()`.

## 8\. Built-in directives

The compiler registers directives with priorities. Structural directives run first because they can create, remove, or move nodes.

| Directive | Priority | Use | Example |
| --- | --- | --- | --- |
| `x-if` | 1000 | Conditional render. | `<div x-if="loggedIn">` |
| `x-else-if` | 999 | Else-if branch. | `<div x-else-if="loading">` |
| `x-else` | 998 | Fallback branch. | `<div x-else>` |
| `x-for` | 950 | Render list. | `<template x-for="item in items">` |
| `x-component` | 900 | Mount child component. | `<div x-component="UserCard">` |
| `x-portal`/`x-teleport` | 850 | Render elsewhere. | `<div x-portal="'#modal-root'">` |
| `x-ignore` | 800 | Skip subtree. | `<div x-ignore>` |
| `x-data` | 790 | Scoped data. | `<div x-data="{ open:false }">` |
| `x-slot` | 780 | Slot projection. | `<template x-slot="header">` |
| `x-text` | 700 | Set textContent. | `<span x-text="name">` |
| `x-html` | 690 | Set sanitized HTML. | `<div x-html="content">` |
| `x-show` | 680 | Toggle display. | `<div x-show="open">` |
| `x-model` | 670 | Two-way input binding. | `<input x-model="user.name">` |
| `x-on:event`/`@event` | 665 | DOM event. | `<button @click="save()">` |
| `x-bind:name`/`:name` | 660 | Bind attribute/property. | `<img :src="avatar">` |
| `x-class` | 650 | Bind classes. | `<div x-class="{ active: ok }">` |
| `x-style` | 640 | Bind styles. | `<div x-style="styleObj">` |
| `x-attr` | 630 | Bind many attrs. | `<input x-attr="attrs">` |
| `x-ref` | 620 | Collect ref. | `<input x-ref="email">` |
| `x-init` | 610 | Run on compile. | `<div x-init="load()">` |
| `x-focus` | 600 | Focus on truthy. | `<input x-focus="editing">` |
| `x-disabled` | 590 | Toggle disabled. | `<button x-disabled="saving">` |
| `x-value` | 580 | Set element value. | `<input x-value="name">` |
| `x-cloak` | 570 | Remove cloak after compile. | `<div x-cloak>` |
| `x-transition` | 560 | Transition classes. | `<div x-transition="fade">` |
| `x-once` | 550 | Render once. | `<span x-once="createdAt">` |

### Interpolation pipes

Built-in modifiers include `trim`, `number`, `lower`, `upper`, `capitalize`, `json`, and `boolean`.

```
<p>{{ user.name | trim | capitalize }}</p>
<pre>{{ stats | json }}</pre>
```

## 9\. Event bus

`MiniX_Event_Bus` supports `on`, `once`, `off`, and `emit`. Component `$emit()` automatically includes component metadata.

```
// Component A
this.$emit('attendance:saved', { employeeId: 12, attendance });

// Component B
const off = this.$bus.on('attendance:saved', (payload, meta) => {
  console.log(payload.employeeId, meta.component);
});

off();
```

> [!NOTE]
> **Outside components:** use `MiniX.$bus` (alias `MiniX.bus`) for shared events. Component `$emit()` uses this singleton by default unless the app was created with a custom `eventBus`.

## 10\. Props

Props can be arrays or descriptor objects. They are exposed as readonly `this.props`/`this.$props`.

```
class ProductCard {
  static props = {
    product: { type: Object, required: true },
    currency: { type: String, default: '₹' },
    showStock: { type: Boolean, default: true },
    onSelect: Function
  };

  view() {
    return `<button @click="props.onSelect?.(props.product)">Select</button>`;
  }
}
```

*   Child components should not mutate props directly.
*   Default/fallback can be static or a function.
*   Array/object defaults are shallow-cloned.
*   `$setProps()` updates props and rerenders when needed.

```
<div x-component="ProductCard" x-props="{ product: item, currency: '₹' }"></div>
```

## 11\. Lists and loops

`x-for` supports arrays, objects, maps, sets, and iterables. Stable keys improve DOM reuse.

```
<template x-for="user in users" :key="user.id">
  <div class="user-row">
    <strong x-text="user.name"></strong>
    <button @click="edit(user)">Edit</button>
  </div>
</template>
```

*   Use `:key` when list order can change.
*   Keep repeated templates small.
*   For tables, use `<template x-for>` inside `<tbody>`.
*   Update arrays through reactive mutation or state helpers.

## 12\. Layouts, slots, and portals

### Layout

```
class AdminLayout {
  view() {
    return `
      <div class="shell">
        <aside>
          Menu
          <template x-yield="sidebar"></template>
        </aside>
        <main><template x-yield></template></main>
      </div>
    `;
  }
}

class Dashboard {
  layout = AdminLayout;

  view() {
    return `
      <h2>Dashboard</h2>
      <template x-section="sidebar">Quick links</template>
    `;
  }
}
```

> [!NOTE]
> Layouts do not consume `{{ content }}`. The layout renders insertion points with `x-yield`. Unnamed `x-yield` receives the main body, and named targets like `x-yield="sidebar"` receive matching `x-section="sidebar"` fragments.

When a route or component refers to a layout by string name, register it explicitly as a layout with `app.layout('AdminLayout', AdminLayout)` during app setup or `MiniX_Component.registerLayout('AdminLayout', AdminLayout)` in a lazy-loaded layout file.

#### Layout lifecycle hooks

```
class AuthLayout {
  activated(payload) {
    document.documentElement.className = 'layout-wide customizer-hide';
  }

  deactivated(payload) {
    // Optional cleanup when this layout stops being active.
  }

  view() {
    return `<main><template x-yield></template></main>`;
  }
}
```

| Hook | When it runs | Use |
| --- | --- | --- |
| `activated(payload)` | When the layout instance becomes the active layout for a component render. | Refresh `<html>`/`<body>` classes, attach layout-level listeners, or sync global UI chrome. |
| `deactivated(payload)` | When the component switches to another layout or is destroyed. | Undo layout-level side effects such as document classes, listeners, or globals. |

These hooks run on the cached layout instance, not on every render. They are the right place for layout-wide side effects. Avoid putting those side effects in the layout constructor, because router boot can instantiate a layout more than once before the final route settles.

### Slot

```
<div x-component="Panel">
  <template x-slot="header">User Details</template>
  <p>Body content here</p>
</div>
```

### Portal/teleport

```
<div x-portal="'#modal-root'" x-show="open">
  <div class="modal">Modal content</div>
</div>
```

## 13\. Plugins and extension points

Plugins can add directives, modifiers, instance APIs, components, scope helpers, providers, and request defaults.

```
const ToastPlugin = MiniX.Plugin.define({
  install(app) {
    app.addInstanceAPI(() => ({
      $toast(message, type = 'info') {
        console.log(`[${type}] ${message}`);
      }
    }));

    app.modifier('money', ({ value }) => '₹' + Number(value || 0).toFixed(2));
  }
});

MiniX.createApp(App).use(ToastPlugin).mount('#app');
```

### Custom directive skeleton

```
MiniX.createApp(App).directive('x-tooltip', ({ el, expression, component }) => {
  const update = () => {
    const scope = component._createRenderScope?.() || component.instance;
    el.title = component.compiler._evaluate(expression, scope, '');
  };
  update();
  const stop = component.instance.$effect(update);
  return () => stop();
});
```

> [!WARNING]
> Custom directives can touch internals, but stable plugins should depend on the smallest possible public surface.

## 14\. HTTP request helper: MiniX\_Request

Attach the request client during app setup with `.request()`. Components then call `this.$fetch()`, which returns the same chainable request builder with query/body/header helpers, timeout, retry, response parsing, cache, interceptors, progress, abort, and extension support.

```
class UsersPage {
  data() {
    return { users: [], search: 'ankit', page: 1, loading: false };
  }

  async mounted() {
    await this.loadUsers();
  }

  async loadUsers() {
    this.loading = true;
    try {
      this.users = await this.$fetch('/users')
        .query({ page: this.page, search: this.search })
        .timeout(10000)
        .retry(2, 300)
        .cache(30000)
        .json();
    } finally {
      this.loading = false;
    }
  }

  view() {
    return `
      <section>
        <input x-model="search" @input.debounce="loadUsers()">
        <button @click="loadUsers()" x-disabled="loading">Refresh</button>
        <template x-for="user in users" :key="user.id">
          <div x-text="user.name"></div>
        </template>
      </section>
    `;
  }
}

MiniX.createApp(UsersPage)
  .request('/api', {
    headers: { Accept: 'application/json' },
    credentials: 'same-origin'
  })
  .mount('#app');
```

| Group | Methods |
| --- | --- |
| HTTP verbs | `get`, `post`, `put`, `patch`, `delete`, `head`, `options` |
| Builder | `header`, `query`, `body`, `as`, `timeout`, `signal`, `retry`, `cache` |
| Parsers | `json`, `text`, `blob`, `arrayBuffer`, `response` |
| Progress | `onUploadProgress`, `onDownloadProgress` |
| Interceptors | `addRequestInterceptor`, `addResponseInterceptor`, `addErrorInterceptor`, `clearInterceptors` |
| Events/cache/abort | `on`, `off`, `invalidate`, `clearCache`, `getCacheEntries`, `abort`, `abortAll` |
| Defaults | `extend`, `setHeader`, `removeHeader`, `setBaseURL`, `setAuth` |
| Static helpers | `all`, `allSettled`, `race`, `default`, static verb helpers |

```
class RequestTools {
  mounted() {
    const api = this.$provider.inject('__minix_request__');

    api.addRequestInterceptor((desc) => {
      desc.headers.set('X-Requested-With', 'MiniX');
      return desc;
    });

    api.addResponseInterceptor(async (response, desc) => response);
    api.addErrorInterceptor(async (error, desc) => { throw error; });
  }

  clearUserRequests() {
    const api = this.$provider.inject('__minix_request__');
    api.invalidate('/users', { page: 1 });
    api.clearCache();
    api.abortAll();
  }
}

MiniX.createApp(RequestTools)
  .request('/api')
  .mount('#app');
```

## 15\. Renderer and sanitizer

Components normally use the renderer through interpolation, directives, and app modifiers. Sanitization is applied when a component renders HTML with `x-html`, using `window.DOMPurify` when available and a fallback sanitizer otherwise.

```
class ArticlePreview {
  data() {
    return {
      title: 'hello',
      trustedHtml: '<strong>Ready</strong>'
    };
  }

  view() {
    return `
      <article>
        <h1>{{ title | upper }}</h1>
        <div x-html="trustedHtml"></div>
      </article>
    `;
  }
}

MiniX.createApp(ArticlePreview)
  .modifier('upper', ({ value }) => String(value || '').toUpperCase())
  .mount('#app');
```

*   Prefer `x-text` for user content.
*   Use `x-html` only for trusted/sanitized HTML.
*   Add DOMPurify in production when rendering rich HTML.

## 16\. Complete practical examples

### CRUD/list page

```
class UsersPage {
  data() { return { users: [], search: '', loading: false, error: '' }; }

  computed = {
    filtered() {
      const q = this.search.toLowerCase();
      return this.users.filter(u => String(u.name || '').toLowerCase().includes(q));
    }
  };

  async mounted() { await this.loadUsers(); }

  async loadUsers() {
    this.loading = true;
    this.error = '';
    try { this.users = await this.$fetch('/users').json(); }
    catch (e) { this.error = e.message || 'Failed to load users'; }
    finally { this.loading = false; }
  }

  view() {
    return `
      <div class="card"><div class="card-body">
        <input class="form-control mb-2" x-model="search" placeholder="Search users">
        <div class="alert alert-danger" x-show="error" x-text="error"></div>
        <div x-show="loading">Loading...</div>
        <table class="table" x-show="!loading"><tbody>
          <template x-for="user in filtered" :key="user.id">
            <tr><td x-text="user.name"></td><td x-text="user.email"></td></tr>
          </template>
        </tbody></table>
      </div></div>`;
  }
}
MiniX.createApp(UsersPage).request('/api').mount('#app');
```

### Modal with refs and events

```
class EmailModal {
  static props = { saleId: Number };
  data() { return { email: '', sending: false }; }

  async send() {
    this.sending = true;
    try {
      await this.$fetch('/sales/invoice-mail', {
        method: 'POST',
        body: { sale_id: this.props.saleId, email: this.email }
      }).json();
      this.$emit('invoice:sent', { saleId: this.props.saleId, email: this.email });
    } finally { this.sending = false; }
  }

  mounted() { this.$refs.email?.focus(); }

  view() {
    return `<div class="modal-body">
      <input x-ref="email" x-model="email" class="form-control">
      <button @click="send()" x-disabled="sending">Send</button>
    </div>`;
  }
}
```

## 17\. Recommended patterns

#### Keep state serializable

Use state for plain app data. Store external instances as raw values or normal instance fields.

#### Use `$batch`

Batch multiple writes after API responses or complex actions.

#### Use child components

Large repeated templates are harder to maintain; child components keep things clean.

#### Prefer `x-show` for toggles

Use `x-if` only when creation/destruction matters.

#### Expose helpers via plugins

Helpers like `$toast`, `$confirm`, and `$auth` fit `addInstanceAPI`.

#### Use providers for services

Shared API clients, auth services, and config fit `provide/inject`.

## 18\. Debugging

```
const root = MiniX.createApp(App).dev(true).mount('#app');
```

In dev mode, state captures history. Component instances receive `$history()` and `$clearHistory()`.

```
console.table(component.$history());
component.$clearHistory();
```

### Component state debug

```
class CounterDebug {
  data() { return { count: 0 }; }

  mounted() {
    this.$state.increment('count');
    console.log(this.$history());
  }

  increment() {
    this.$state.increment('count');
  }

  view() {
    return `<button @click="increment()">{{ count }}</button>`;
  }
}

MiniX.createApp(CounterDebug).dev(true).mount('#app');
```

*   If an expression is not updating, confirm the referenced key exists or use `$set`.
*   If a child component is not found, check `app.component()` or local `registerComponents()`.
*   If HTML is stripped, check sanitizer behavior.
*   If external code needs events, use `MiniX.$bus` or pass a custom `eventBus` into `MiniX.createApp()`.
*   If events do not run, inspect modifiers and ensure the element is not inside `x-ignore`.

## 19\. Gotchas

> [!WARNING]
> **Direct prop mutation is blocked.** Emit events or call parent callbacks instead.

  

> [!WARNING]
> **Use `$set` for new root state keys.** It refreshes template scope shape reliably.

  

> [!WARNING]
> **`x-html` sanitizes.** This protects you but can strip expected tags/attrs.

  

> [!WARNING]
> **Outside component code has no magic instance.** Use `MiniX.$bus` for cross-library events, or keep the mounted root/provider reference when you need app-specific access.

  

> [!WARNING]
> **Rerenders can replace DOM.** Third-party widgets should initialize/cleanup in lifecycle hooks.

## 20\. Cheat sheet

#### Create app

```
MiniX.createApp(App)
  .dev(true)
  .request('/api')
  .mount('#app');
```

#### State

```
this.$set('user.name', 'Ankit');
this.$merge('filters', { q: 'abc' });
this.$toggle('open');
this.$batch(() => { ... });
```

#### Text + model

```
<input x-model="name">
<span x-text="name"></span>
```

#### Events

```
<button @click="save()">Save</button>
<form @submit.prevent="submit()">
```

#### Loop

```
<template x-for="row in rows" :key="row.id">
  <div x-text="row.name"></div>
</template>
```

#### Child component

```
app.component('UserCard', UserCard);
<div x-component="UserCard" x-props="{ user }"></div>
```

## 21\. Appendix: namespace

The script assigns classes to the global object and to CommonJS exports. It also attaches class references to `MiniX`.

```
MiniX
MiniX_State
MiniX_Effect
MiniX_Compiler
MiniX_Component
MiniX_Plugin
MiniX_Request
MiniX_Provider
MiniX_Event_Bus
MiniX_Renderer
MiniX_Sanitizer

MiniX.State
MiniX.Effect
MiniX.Compiler
MiniX.Component
MiniX.Plugin
MiniX.Request
MiniX.Provider
MiniX.EventBus
MiniX.$bus
MiniX.bus
MiniX.Renderer
MiniX.Sanitizer
```

Generated for `mini-x.js`. Keep coding; may your bugs be reproducible and your cache invalidation slightly less cursed.
{% endraw %}