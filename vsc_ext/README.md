# Mini-X Developer Tools

VS Code extension for Mini-X projects. It provides workspace scanning, IntelliSense, snippets, hover documentation, diagnostics, quick fixes, navigation-ready project indexing, and file generators for class-based Mini-X apps.

## Features

- Scans `.js`, `.mjs`, `.ts`, `.html`, `.blade.php`, and `.php` files.
- Indexes Mini-X components, stores, routes, plugins, lifecycle hooks, props, event bus usage, directives, and template usage.
- Completes Mini-X globals, class component members, directives, store APIs, router APIs, indexed components, and indexed stores.
- Shows hover documentation for directives, lifecycle hooks, store helpers, router helpers, and event bus APIs.
- Warns about common mistakes such as `MiniX.defineComponent`, `MiniX.component`, missing `.mount('#app')`, invalid `x-for`, empty `x-component`, unsupported `x-model`, duplicate component names, and empty templates.
- Provides quick fixes for safe edits: add `.mount('#app')`, convert `x-on:click` to `@click`, add `x-key`, and replace `MiniX.defineComponent(...)` with a class skeleton.
- Generates class components, stores, and routers without global component registration.

## Commands

- `Mini-X: Scan Workspace`
- `Mini-X: Show Project Index`
- `Mini-X: Create Component`
- `Mini-X: Create Store`
- `Mini-X: Create Router`
- `Mini-X: Validate Current File`

## Development

Install dependencies:

```bash
npm install
```

Compile:

```bash
npm run compile
```

Run in development mode:

1. Open the `vsc_ext` folder in VS Code.
2. Press `F5`.
3. In the Extension Development Host, open a Mini-X project.

Package:

```bash
npm run package
```

## Testing The Extension

- Autocomplete: open a JS/TS class component and type `MiniX.`, `data`, `view`, `MiniXStore.`, or router helper names. In HTML/template strings, type `x-` or `@`.
- Hover: hover over `x-for`, `x-model`, `mounted`, `MiniX.$bus.emit`, `$store`, or `createRouter`.
- Diagnostics: try `MiniX.defineComponent(...)`, `MiniX.createApp(App)` without `.mount('#app')`, `<div x-model="name">`, `<template x-for="item items">`, or `<div x-component="">`.
- Code actions: use the lightbulb on diagnostics for mount insertion, `x-on` shorthand conversion, and `x-key` insertion.
- Commands: run Mini-X commands from the Command Palette.

