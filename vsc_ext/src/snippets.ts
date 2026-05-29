export function componentTemplate(name: string): string {
  return `export default class ${name} {
\tstatic props = {
\t\t// title: String
\t};

\tdata() {
\t\treturn {
\t\t\tmessage: 'Hello from ${name}'
\t\t};
\t}

\tview() {
\t\treturn \`
\t\t\t<section>
\t\t\t\t<h1 x-text="message"></h1>
\t\t\t</section>
\t\t\`;
\t}
}
`;
}

export function storeTemplate(name: string): string {
  return `export const ${toIdentifier(name)}Store = MiniXStore.define('${toKebab(name)}', {
\tstate: () => ({
\t\titems: [],
\t\tloading: false
\t}),

\tgetters: {
\t\tcount() {
\t\t\treturn this.items.length;
\t\t}
\t},

\tactions: {
\t\tsetItems(items) {
\t\t\tthis.items = items;
\t\t}
\t}
});
`;
}

export function routerTemplate(useHashHistory: boolean): string {
  const historyFactory = useHashHistory ? 'createWebHashHistory' : 'createWebHistory';
  return `import HomePage from './components/HomePage.js';

export const router = createRouter({
\thistory: ${historyFactory}(),
\troutes: [
\t\t{
\t\t\tpath: '/',
\t\t\tname: 'home',
\t\t\tcomponent: HomePage,
\t\t\tmeta: {}
\t\t}
\t]
});
`;
}

export function toIdentifier(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_$]+(.)?/g, (_match, next: string) => next ? next.toUpperCase() : '');
  const identifier = cleaned.replace(/^[^A-Za-z_$]+/, '');
  return identifier ? identifier.charAt(0).toLowerCase() + identifier.slice(1) : 'app';
}

export function toPascal(value: string): string {
  const identifier = toIdentifier(value);
  return identifier.charAt(0).toUpperCase() + identifier.slice(1);
}

export function toKebab(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'app';
}

