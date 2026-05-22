import * as vscode from 'vscode';

export interface MiniXDocItem {
  name: string;
  detail: string;
  documentation: string;
  insertText?: string;
}

export const supportedLanguages = [
  'javascript',
  'javascriptreact',
  'typescript',
  'typescriptreact',
  'html',
  'php'
];

export const supportedFileGlob = '**/*.{js,mjs,ts,html,blade.php,php}';

export const ignoredGlob = '**/{node_modules,vendor,.git,dist,build,storage,.cache,cache,tmp,temp}/**';

export const globalApis: MiniXDocItem[] = [
  {
    name: 'MiniX.createApp',
    detail: 'MiniX.createApp(Component).mount(selector)',
    documentation: 'Creates a Mini-X app from a class component. Chain .use(plugin) before .mount(selector) when plugins are needed.'
  },
  {
    name: 'MiniX.nextTick',
    detail: 'MiniX.nextTick(callback?)',
    documentation: 'Runs work after Mini-X has flushed pending reactive DOM updates.'
  },
  {
    name: 'MiniX.$bus.emit',
    detail: 'MiniX.$bus.emit(eventName, payload?)',
    documentation: 'Publishes an application-level event through the Mini-X event bus.'
  },
  {
    name: 'MiniX.$bus.on',
    detail: 'MiniX.$bus.on(eventName, handler)',
    documentation: 'Subscribes to an application-level event. Store the disposer or call off during teardown.'
  },
  {
    name: 'MiniX.$bus.off',
    detail: 'MiniX.$bus.off(eventName, handler)',
    documentation: 'Removes an event bus listener.'
  }
];

export const componentMembers: MiniXDocItem[] = [
  { name: 'data', detail: 'data() { return { ... } }', documentation: 'Returns component-local reactive state.', insertText: 'data() {\n\treturn {\n\t\t$1\n\t};\n}' },
  { name: 'view', detail: 'view() { return `...`; }', documentation: 'Returns the component HTML template string.', insertText: 'view() {\n\treturn `\n\t\t$1\n\t`;\n}' },
  { name: 'template', detail: 'template() { return `...`; }', documentation: 'Alternative template-returning method for component HTML.', insertText: 'template() {\n\treturn `\n\t\t$1\n\t`;\n}' },
  { name: 'registerComponents', detail: 'registerComponents() { return { Child }; }', documentation: 'Registers child components locally for x-component usage.', insertText: 'registerComponents() {\n\treturn {\n\t\t$1\n\t};\n}' },
  { name: 'mounted', detail: 'mounted() {}', documentation: 'Lifecycle hook called after the component mounts.' },
  { name: 'beforeMount', detail: 'beforeMount() {}', documentation: 'Lifecycle hook called before the component mounts.' },
  { name: 'updated', detail: 'updated() {}', documentation: 'Lifecycle hook called after reactive updates render.' },
  { name: 'beforeUnmount', detail: 'beforeUnmount() {}', documentation: 'Lifecycle hook called before the component is removed.' },
  { name: 'unmounted', detail: 'unmounted() {}', documentation: 'Lifecycle hook called after the component is removed.' },
  { name: 'watch', detail: 'watch = { key(value, oldValue) {} }', documentation: 'Declares watchers for component state.' },
  { name: 'methods', detail: 'methods = { action() {} }', documentation: 'Declares methods exposed to template expressions.' },
  { name: 'static props', detail: 'static props = { name: String }', documentation: 'Declares component props accepted from x-props.' }
];

export const directives: MiniXDocItem[] = [
  { name: 'x-data', detail: 'x-data="{ local: true }"', documentation: 'Creates scoped inline state for an element subtree.' },
  { name: 'x-text', detail: 'x-text="expression"', documentation: 'Sets textContent from a reactive expression.' },
  { name: 'x-html', detail: 'x-html="expression"', documentation: 'Sets innerHTML from a reactive expression. Use trusted HTML only.' },
  { name: 'x-model', detail: 'x-model="field"', documentation: 'Binds input, textarea, or select value to state.' },
  { name: 'x-for', detail: 'x-for="item in items"', documentation: 'Repeats an element or template for each item. Prefer a stable x-key or :key.' },
  { name: 'x-if', detail: 'x-if="condition"', documentation: 'Conditionally renders an element.' },
  { name: 'x-show', detail: 'x-show="condition"', documentation: 'Toggles element visibility without destroying it.' },
  { name: 'x-class', detail: 'x-class="{ active: isActive }"', documentation: 'Applies classes from object, string, or array expressions.' },
  { name: 'x-style', detail: 'x-style="{ color }"', documentation: 'Applies inline styles from an expression.' },
  { name: 'x-attr', detail: 'x-attr="{ title: label }"', documentation: 'Applies attributes from an object expression.' },
  { name: 'x-on', detail: 'x-on:click="handler"', documentation: 'Attaches an event listener. The @event shorthand is also supported.' },
  { name: '@click', detail: '@click="handler"', documentation: 'Click event listener shorthand.' },
  { name: '@input', detail: '@input="handler"', documentation: 'Input event listener shorthand.' },
  { name: '@change', detail: '@change="handler"', documentation: 'Change event listener shorthand.' },
  { name: '@submit', detail: '@submit.prevent="handler"', documentation: 'Submit event listener shorthand, commonly used on forms.' },
  { name: 'x-component', detail: 'x-component="ComponentName"', documentation: 'Mounts a locally registered class component.' },
  { name: 'x-render', detail: 'x-render="ComponentName"', documentation: 'Renders a component or render target dynamically.' },
  { name: 'x-slot', detail: 'x-slot="name"', documentation: 'Marks slot content passed to a child component.' },
  { name: 'x-teleport', detail: 'x-teleport="selector"', documentation: 'Moves rendered content into another DOM target.' },
  { name: 'x-key', detail: 'x-key="item.id"', documentation: 'Provides a stable key for repeated content.' },
  { name: 'x-ref', detail: 'x-ref="name"', documentation: 'Registers an element in this.$refs.' },
  { name: 'x-router-view', detail: 'x-router-view', documentation: 'Router outlet where the matched route component renders.' },
  { name: 'x-route', detail: 'x-route="routeName"', documentation: 'Navigates to a named Mini-X route.' },
  { name: 'x-link', detail: 'x-link="/path"', documentation: 'Router-aware link binding.' }
];

export const storeApis: MiniXDocItem[] = [
  { name: 'MiniXStore.define', detail: 'MiniXStore.define(name, { state, getters, actions })', documentation: 'Defines a global reactive Mini-X store.' },
  { name: 'this.$store', detail: 'this.$store(name)', documentation: 'Accesses a registered store from a component instance.' },
  { name: '$store', detail: "$store('name')", documentation: 'Accesses a store from template expressions.' },
  { name: 'state', detail: 'state: () => ({ ... })', documentation: 'Store state factory.' },
  { name: 'getters', detail: 'getters: { value() { ... } }', documentation: 'Derived store values.' },
  { name: 'actions', detail: 'actions: { save() { ... } }', documentation: 'Store methods that mutate state or perform work.' }
];

export const routerApis: MiniXDocItem[] = [
  { name: 'createRouter', detail: 'createRouter({ history, routes })', documentation: 'Creates a Mini-X router instance.' },
  { name: 'createWebHistory', detail: 'createWebHistory(base?)', documentation: 'Creates history-mode routing.' },
  { name: 'createWebHashHistory', detail: 'createWebHashHistory(base?)', documentation: 'Creates hash-mode routing.' },
  { name: 'guards', detail: 'guards: { beforeEach(to, from) {} }', documentation: 'Route guard hooks.' },
  { name: 'meta', detail: 'meta: { requiresAuth: true }', documentation: 'Arbitrary metadata attached to a route.' },
  { name: 'params', detail: 'route.params', documentation: 'Dynamic route parameters.' },
  { name: 'query', detail: 'route.query', documentation: 'Parsed route query parameters.' }
];

export const lifecycleHooks = componentMembers.filter((item) =>
  ['mounted', 'beforeMount', 'updated', 'beforeUnmount', 'unmounted'].includes(item.name)
);

export const allDocItems = [
  ...globalApis,
  ...componentMembers,
  ...directives,
  ...storeApis,
  ...routerApis
];

export function markdownFor(item: MiniXDocItem): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.isTrusted = false;
  md.appendCodeblock(item.detail, item.detail.includes('<') ? 'html' : 'javascript');
  md.appendMarkdown(item.documentation);
  return md;
}

