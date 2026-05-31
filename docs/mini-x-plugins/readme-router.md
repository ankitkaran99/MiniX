---
product: Mini-X Router
summary: Lightweight, feature-rich routing for Mini-X reactive apps with nested layouts, named views, lazy loading, keep-alive, and navigation guards.
badges: ["SPA navigation","Nested layouts","Lazy loading","Reactive route state"]
highlights: ["Deep route trees with named views and keep-alive","Bundler-free lazy loading with retries and cache control","Global and route-level guards for redirects and protected flows"]
metrics: ["~8kb::gzipped footprint","HTML5 + Hash::history support","Named views::multi-outlet layouts","Reactive route::state in templates"]
sidebar: Everything here covers wiring the router, navigating by path or name, and scaling into lazy layouts, reactive route state, and guarded transitions.
---
{% raw %}

# Mini-X Router - documentation

> **Product:** Mini-X Router
> **Summary:** Lightweight, feature-rich routing for Mini-X reactive apps with nested layouts, named views, lazy loading, keep-alive, and navigation guards.
> **Focus:** `SPA navigation` | `Nested layouts` | `Lazy loading` | `Reactive route state`
>
> **Key Highlights:**
> - Deep route trees with named views and keep-alive
> - Bundler-free lazy loading with retries and cache control
> - Global and route-level guards for redirects and protected flows
> **Metrics & Scope:**
> - **~8kb:** gzipped footprint
> - **HTML5 + Hash:** history support
> - **Named views:** multi-outlet layouts
> - **Reactive route:** state in templates

---

Overview

## Introduction

Mini-X Router is the official routing solution for **Mini-X**, a tiny reactive UI library. It offers a Vue Router-like API but stays tightly integrated with Mini-X reactivity, directives, and component lifecycle. It is aimed at SPAs, dashboards, admin shells, and demos that need more than a single outlet and a couple of links.

> [!NOTE]
> Works with `mini-x.js` core. Provides `x-router-view`, `x-link`, `x-route` directives, programmatic navigation, and route meta fields.

**Nested routes**Deep linking without manual outlet plumbing.

**Named views**Sidebar, main, footer, or any other coordinated outlet setup.

**KeepAlive**Preserve component state when users revisit heavy screens.

**Lazy loading**Load components and layouts on demand with no bundler requirement.

**Guards**Global and route-level control over transitions and redirects.

**Reactive route state**`$route`, `$params`, and `$query` update with navigation.

Bootstrap

## Installation

Include `mini-x.js` and `plugin-router.js` in your page, then create and install a router instance into your app.

```
<script src="../../src/MiniX.js"></script>
<script src="../../src/mini-x-plugins/plugin-router.js"></script>
```

The router integrates at app startup. There is no extra adapter layer between core Mini-X and the plugin.

Quickstart

## Basic Setup

```
const routes = [
  { path: '/', component: 'HomePage', name: 'home' },
  { path: '/about', component: 'AboutPage', name: 'about' }
];

const router = MiniXRouter.createRouter({
  history: MiniXRouter.createWebHistory('/'),
  routes,
  debug: true
});

MiniX.createApp(AppShell)
  .component('HomePage', HomePage)
  .component('AboutPage', AboutPage)
  .use(router)
  .mount('#app');
```

Inside your template, use `<div x-router-view></div>` as the outlet where matched components render.

Structure

## Route Definition

Routes support paths, names, nested children, named views, redirects, meta, and props. Child paths are resolved relative to their parent, so both `projects` and `/projects` under `/workspace` resolve to `/workspace/projects`.

```
{
  path: '/workspace',
  components: { default: 'WorkspaceLayout', sidebar: 'SidebarComp' },
  meta: { requiresAuth: true, keepAlive: true },
  beforeEnter: (to, from) => { /* custom guard */ },
  children: [
    { path: '', component: 'WorkspaceOverview', name: 'workspace' },
    { path: 'projects', component: 'WorkspaceProjects', name: 'workspaceProjects' },
    { path: 'activity', component: 'WorkspaceActivity', name: 'workspaceActivity' }
  ]
},
{
  path: '/users/:id',
  component: 'UserLayout',
  children: [
    {
      path: '',
      component: 'UserProfile',
      props: true,
      name: 'userDetails'
    }
  ]
}
```

### Nested named routes

Route names are registered per record, including child records. When a child sits under a named parent, it resolves by its hierarchical name only. For example, a child named `login` under a parent named `auth` resolves as `auth.login`, not plain `login`. In route snapshots, `route.name` also reports the hierarchical name so it stays usable for round-tripping navigation.

```
const router = MiniXRouter.createRouter({
  routes: [
    {
      path: '/settings',
      name: 'settings',
      component: 'SettingsLayout',
      children: [
        { path: 'profile', name: 'settingsProfile', component: 'SettingsProfile' },
        { path: 'billing', name: 'settingsBilling', component: 'SettingsBilling' }
      ]
    },
    {
      path: '/auth',
      name: 'auth',
      component: 'AuthLayout',
      children: [
        { path: '/login', name: 'login', component: 'Login' }
      ]
    },
    {
      path: '/users/:id',
      component: 'UserLayout',
      children: [
        { path: '', name: 'userDetails', component: 'UserDetails', props: true }
      ]
    }
  ]
});

router.push({ name: 'settings.settingsBilling' });
router.push({ name: 'userDetails', params: { id: 42 } });

router.push({ name: 'auth.login' });
```

A leading slash on a child path does not make it absolute. Inside `children`, `path: '/login'` and `path: 'login'` both resolve to `/auth/login`.

### Route meta fields

`meta.title` can be a string or function to update document title automatically. `meta.keepAlive` enables component caching. Custom meta such as `requiresAuth` can be consumed by guards and analytics hooks.

Movement

## Navigation & Directives

### Programmatic navigation

```
// inside component context (this.$router)
this.$router.push('/analytics')
this.$router.push({ name: 'userDetails', params: { id: 5 }, query: { tab: 'billing' } })
this.$router.push({ name: 'workspaceProjects' })
this.$router.push({ name: 'settings.settingsBilling' })
this.$router.push({ name: 'auth.login' })
this.$router.replace('/home')
this.$router.back()
```

### Directives: x-link & x-route

**x-link** accepts a path string, while **x-route** accepts a route name or object literal. Both handle SPA navigation and can apply active-state styling without extra event wiring.

```
<a x-link="/dashboard" x-active="active" x-active-mode="startsWith">Dashboard</a>
<a x-route="settings.settingsBilling">Billing</a>
<a x-route="{ name: 'userDetails', params: { id: user.id } }" x-replace>Profile</a>
```

For nested named routes under a named parent, pass the hierarchical name. If the parent path contains params, include them in `params` when navigating by name.

*   `x-active` applies a CSS class when the route matches. Default is `active`.
*   `x-active-mode` can be `exact` or `startsWith`.
*   `x-replace` uses history replace instead of push.

Rendering

## Router View & KeepAlive

`<div x-router-view></div>` renders the matched component. Named views are supported via an attribute value such as `x-router-view="sidebar"`. Depth is detected automatically for nested routes.

**Keep-alive** means that when a route record declares `meta: { keepAlive: true }`, the component instance is cached and reused on revisit. Use `router.clearKeepAlive()` to clear cache entries when the screen should be re-created.

```
<div x-router-view></div>
<div x-router-view="sidebar"></div>
```

Control

## Guards & Hooks

Global guards, per-route guards, and view transition hooks are available. Guards can return `true`, `false`, a string path, or a location object to cancel or redirect navigation.

```
// Global beforeEach
router.beforeEach((to, from) => {
  if (to.meta.requiresAuth && !store.isLoggedIn) return { name: 'login' };
  return true;
});

// Per-route
beforeEnter: (to, from) => { if (to.params.id === 'admin') return '/forbidden'; }

// View transition hooks
router.beforeRouteLeave(async ({ el }) => {
  el.classList.add('fade-out');
  await delay(150);
});
router.afterRouteEnter(({ el }) => el.classList.add('fade-in'));
```

Scaling

## Lazy Loading

Mini-X Router includes a built-in lazy-loading system that works without bundlers. Components can live in separate `.js` files and be fetched only when a route needs them.

### Built-in Loader (`MiniXRouter.Loader`)

The router ships with a **MiniX\_Loader** class that injects `<script>` tags for lazy components, supports retries, timeouts, and caching, and can manage preapproved stylesheets and scripts through constructor registries. You can pass a loader instance or a configuration object to `createRouter`.

```
// Option 1: Pass loader config
const router = MiniXRouter.createRouter({
  history: createWebHistory(),
  loader: {
    baseDir: '/components',
    ext: '.js',
    retries: 1,
    timeout: 5000,
    styleRegistry: {
      customerTheme: '/assets/customer/theme.css'
    },
    scriptRegistry: {
      chartsLib: {
        url: '/assets/vendor/charts.js',
        cleanup: 'CustomerCharts.destroy'
      }
    }
  },
  routes: [
    {
      path: '/customer',
      component: 'Customer'
    }
  ]
});

// Option 2: Use a custom loader instance
const myLoader = new MiniXRouter.Loader('/lazy', {
  retries: 2,
  styleRegistry: {
    pageTheme: '/assets/lazy/page.css'
  },
  scriptRegistry: {
    chartsLib: {
      url: '/assets/vendor/charts.js',
      cleanup: 'CustomerCharts.destroy'
    }
  }
});
const router = MiniXRouter.createRouter({
  loader: myLoader,
  routes: [ /* ... */ ]
});

await myLoader.loadStyle('pageTheme');
await myLoader.loadScript('chartsLib');
myLoader.unloadStyle('pageTheme');
myLoader.unloadScript('chartsLib');
```

### How It Works

1.  When a route with `component: 'Customer'` activates for the first time, the router checks whether that component is already registered.
2.  If missing, the configured loader fetches `/components/Customer.js` or whatever matches the chosen base directory and extension.
3.  The loader injects a `<script>` tag, waits for it to load, and resolves the promise.
4.  The component file must register itself with `MiniX_Component.register('Customer', CustomerClass)`.
5.  The router resolves the registered component and renders it.

The loader caches successful component loads, so later visits reuse the component without a second network request. For auxiliary assets, `loadStyle(id)` and `loadScript(id)` only accept identifiers declared in the loader constructor. Script entries may be a plain URL string or an object like `{ url, cleanup }`.

### Lazy Layouts

Layouts can be resolved lazily too. Configure `layoutLoader` once on the router, then let a route or the loaded component declare the layout it needs. When passing a loader instance, use `new MiniXRouter.Loader(baseDir, options, true)` so the router can distinguish it from a component loader.

```
const pageLoader = new MiniXRouter.Loader('./components', { ext: '.js' });
const layoutLoader = new MiniXRouter.Loader('./layouts', { ext: '.js' }, true);

const router = MiniXRouter.createRouter({
  loader: pageLoader,
  layoutLoader: layoutLoader,
  routes: [
    {
      path: '/reports',
      component: 'ReportsPage'
    }
  ]
});

class ReportsPage {
  static layout() {
    return 'AdminLayout';
  }
}

class CustomerPage {
  layout = 'DashboardLayout';
}

MiniX_Component.register('ReportsPage', ReportsPage);
```

The component only returns the layout name. The router first checks registered layouts and inline HTML layouts, then uses the configured layout loader only when the named layout still needs to be fetched. Lazy layout files should register a resolvable layout such as `AdminLayout` with `MiniX_Component.registerLayout(...)`. For eager bootstrapping, use `app.layout('AdminLayout', AdminLayout)`. Layout templates should use `<template x-yield></template>` as the content insertion point. If a route needs to override the component layout, set `layout` directly on the route record.

### Example: Lazy Component File (`Customer.js`)

```
class Customer {
  data() { return { name: '' }; }
  view = `<input x-model="name">`; }
}
if (typeof MiniX_Component !== 'undefined') {
  MiniX_Component.register('Customer', Customer);
}
```

### Preloading & Cache Management

You can preload components during idle time to reduce latency, and use the same loader instance for registered support assets.

```
const loader = router.getLoader();
loader.preload('Customer');
await loader.loadStyle('customerTheme');
await loader.loadScript('chartsLib');
```

Clear cached components with `loader.clearCache('Customer')` or `loader.clearCache()` to force a re-fetch.

Reference

## API Reference

Support assets can also be removed with `loader.unloadStyle('customerTheme')` and `loader.unloadScript('chartsLib')`. For scripts, unload runs the registered cleanup handler first, then removes the `<script>` tag.

| Method / Property | Description |
| --- | --- |
| `createRouter(options)` | Creates a router instance. Options include `routes`, `history`, `debug`, `loader`, and `layoutLoader`. |
| `createWebHistory(base)` | HTML5 history mode based on `pushState`. |
| `createWebHashHistory(base)` | Hash mode fallback, especially useful under `file://`. |
| `router.push(to)` / `replace(to)` | Navigate programmatically. |
| `router.resolve(target)` | Resolve a location into a normalized route object. |
| `router.href(target)` | Generate a full URL for a route target. |
| `router.beforeEach(fn)` | Register a global navigation guard. |
| `router.beforeRouteLeave(fn)` | Called before a view is unmounted, useful for exit animations. |
| `router.afterRouteEnter(fn)` | Called after a view is mounted or restored. |
| `router.clearKeepAlive(key?)` | Clear all or a specific keep-alive cache entry. |
| `router.getLoader()` | Returns the internal `MiniX_Loader` instance when configured. |
| `router.onDebug(listener)` | Subscribe to internal debug events. |
| `router.currentRoute` | Reactive route object with `path`, `params`, `query`, `meta`, and `fullPath`. |

### Component instance APIs

Every component mounted by the router receives the following properties on its instance `this`:
- `this.$router`: The router instance.
- `this.$route`: The current reactive route object.
- `this.$params`: The current route parameters.
- `this.$query`: The current route query parameters.
- `this.$data`: The current route data (custom history state).

> [!NOTE]
> **Collision Prevention:** To avoid name collisions with a component's own properties or methods (such as a component's own `data` function or property), the non-prefixed properties (`this.route`, `this.params`, `this.query`, and `this.data`) are **not** defined directly on the component instance. You should always access them via their `$`-prefixed versions.
> 
> **Custom Override Protection:** If a component instance already defines one of these properties (such as defining its own `this.$data`), the router will respect that custom definition and skip injecting its own.

In templates, reactive getters are exposed directly as scoped variables without the `$` prefix:

```html
<template>
  <div>Current user ID: {{ params.id }} </div>
  <div>Full path: {{ route.fullPath }} </div>
  <div>Custom route data: {{ data.someKey }} </div>
  <button @click="$router.push('/')">Home</button>
</template>
```

Visibility

## Debugging & Events

Enable debug mode with `router.enableDebug()` or by passing `debug: true` in the options. Debug events are logged to the console and can also be captured with `router.onDebug(fn)`.

Typical events include `navigation:start`, `navigation:finish`, `lazy:load:start`, `keepalive:hit`, and `route:resolved`.

> [!NOTE]
> **File protocol support:** the router auto-detects `file://` and falls back to hash history, which keeps local demos usable without a dev server.

* * *

### Complete Example (with lazy loader)

```
// router setup
const router = MiniXRouter.createRouter({
  history: MiniXRouter.createWebHashHistory(),
  loader: { baseDir: './components', ext: '.js', retries: 1 },
  routes: [
    { path: '/', component: 'HomePage' },
    { path: '/customer', component: 'Customer' }
  ]
});

// Customer.js (in ./components/Customer.js)
class Customer { /* ... */ }
MiniX_Component.register('Customer', Customer);
```

### Nested router-view behavior

The router automatically resolves depth based on parent `x-router-view` containers. Nested routes render inside the nearest matching router-view without extra configuration.

### Advanced: named views + multiple outlets

```
components: {
  default: 'MainContent',
  sidebar: 'SidebarPanel',
  footer: 'FooterNote'
}
```

In your layout: `<div x-router-view></div>`, `<div x-router-view="sidebar"></div>`, and other named outlets as needed.

> [!NOTE]
> **Performance tip:** use `meta.keepAlive` for heavy dashboards and clear targeted cache entries with `router.clearKeepAlive()` when the backing data invalidates.

Built for Mini-X. Full control over SPA routing. Inspired by modern routers, but trimmed for a smaller reactive core.
{% endraw %}