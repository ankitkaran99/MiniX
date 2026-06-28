---
product: Mini-X i18n
summary: i18next integration for Mini-X with x-i18n, $t(), namespace loading, and language switching patterns.
badges: ["i18next","x-i18n","Locale loading","Language switch"]
highlights: ["Directive and template translation APIs","Ready-aware component integration","JSON locale loading through fetch backend"]
metrics: ["Locales::JSON resources","Directive::x-i18n","Templates::$t() helper","Switching::changeLanguage"]
sidebar: Use this page to load locales, install the plugin, translate DOM or template expressions, and handle language switching cleanly.
---
{% raw %}

# MiniX i18n Plugin · i18next integration

> **Product:** Mini-X i18n
> **Summary:** i18next integration for Mini-X with x-i18n, $t(), namespace loading, and language switching patterns.
> **Focus:** `i18next` | `x-i18n` | `Locale loading` | `Language switch`
>
> **Key Highlights:**
> - Directive and template translation APIs
> - Ready-aware component integration
> - JSON locale loading through fetch backend
> **Metrics & Scope:**
> - **Locales:** JSON resources
> - **Directive:** x-i18n
> - **Templates:** $t() helper
> - **Switching:** changeLanguage

---

## MiniX i18n

MiniX\_i18n i18next i18next-fetch-backend x-i18n directive

# MiniX i18n Plugin

A small MiniX plugin that wires i18next into components and templates. It adds the `x-i18n` directive, exposes `this.$t` and `this.$i18n`, and loads JSON translation resources through `i18next-fetch-backend`.

## Overview

**Directive Translation**Use `x-i18n` for text, HTML, and translated attributes.

**Component APIs**Use `this.$t()` and `this.$i18n` inside lifecycle hooks and methods.

**Template Scope**Use `$t()` and `$i18n` in normal MiniX template expressions.

**Fetch Backend**Resources load from `{{lng}}/{{ns}}.json` paths.

> [!NOTE]
> The plugin waits for i18next before the first render, so `x-i18n` and plain `{{ $t(...) }}` start with loaded namespaces.

## Install

Load MiniX first, then the i18n plugin. In browser demos, import i18next and i18next-fetch-backend from a module CDN or your own bundle.

```html
<script src="../../src/MiniX.js"></script>
<script src="../../src/mini-x-plugins/plugin-i18n.js"></script>

<script type="module">
  import i18next from "https://cdn.skypack.dev/i18next";
  import FetchBackend from "https://cdn.skypack.dev/i18next-fetch-backend";
</script>
```

If you bundle dependencies locally, pass the imports into the plugin with `i18next` and `fetchBackend`.

## Locale Files

The recommended backend path is:

```javascript
backend: {
  loadPath: "../locales/{{lng}}/{{ns}}.json"
}
```

For a demo-locales layout:

```
website/
  demos/
    mini-x-plugins/
      demo-i18n.html
    locales/
      en/
        translation.json
      es/
        translation.json
      hi/
        translation.json
```

Example `translation.json`:

```json
{
  "app": {
    "title": "A localized MiniX booking desk"
  },
  "hero": {
    "heading": "Welcome, {{name}}.",
    "copy_one": "Your itinerary is prepared for {{count}} guest.",
    "copy_other": "Your itinerary is prepared for {{count}} guests."
  }
}
```

## App Setup

Install the plugin before `mount()`. The plugin initializes i18next, registers the directive/scope APIs, and delays the first render until i18next is ready.

```javascript
MiniX.createApp(App)
  .use(MiniX_i18n({
    i18next,
    fetchBackend: FetchBackend,
    lng: "en",
    fallbackLng: "en",
    ns: ["translation"],
    defaultNS: "translation",
    backend: {
      loadPath: "/demos/locales/{{lng}}/{{ns}}.json"
    },
    debug: true
  }))
  .mount("#app");
```

> [!NOTE]
> `mount()` returns a Promise that resolves with the mounted component after i18next is ready. You can `await` it when code after mount needs the component instance.

### Using i18next plugins

Use `init` to install detectors, post processors, or custom i18next middleware before initialization.

```javascript
MiniX_i18n({
  i18next,
  fetchBackend: FetchBackend,
  fallbackLng: "en",
  ns: ["translation"],
  defaultNS: "translation",
  init: (i18next) => {
    return i18next
      .use(LanguageDetector)
      .use(postProcessor);
  }
});
```

## x-i18n Directive

`x-i18n` writes translated content after i18next is ready. It also updates on `languageChanged` and namespace load events.

### Basic text

```html
<h1 x-i18n="app.title"></h1>
<p x-i18n="app.subtitle"></p>
```

### Translated attributes

```html
<input x-i18n="[placeholder]booking.namePlaceholder">

<input
  x-i18n="{ key: 'booking.namePlaceholder', attr: 'placeholder' }">
```

### Options and interpolation

```html
<span x-i18n="{ key: 'hero.heading', options: { name: guestName } }"></span>
```

### Inside x-for

```html
<template x-for="item in itinerary" :key="item.id">
  <div class="list-item">
    <span>{{ $t(item.key) }}</span>
    <span>{{ $t(item.status) }}</span>
  </div>
</template>
```

> [!NOTE]
> Plain `{{ $t(item.key) }}` is supported in loops. Use `x-i18n` when you want the directive to write directly to text, HTML, or attributes.

## Component APIs

The plugin adds two APIs to every component instance and template scope:

| API | Where | Description |
| --- | --- | --- |
| `this.$t(...)` | Component instance | Bound translation function backed by the ready i18next instance. |
| `this.$i18n` | Component instance | Wrapper around the i18next instance with `ready`, `language`, and language-loading helpers. |
| `$t(...)` | Template scope | Translate strings in normal interpolation or directive expressions. |
| `$i18n` | Template scope | Read current language or call language APIs from templates. |

```javascript
class App {
  created() {
    this.$i18n.ready.then(() => {
      console.log(this.$t("app.title"));
    });
  }

  view = `<h1>{{ $t('hero.heading', { name: guestName }) }}</h1>`;
}
```

> [!WARNING]
> The plugin intentionally exposes `$t` and `$i18n`. It does not add `this.t` or `this.i18n`.

## Language Switching

Use `this.$i18n.changeLanguage(lng)`. The plugin listens for i18next language events and updates `x-i18n` bindings.

```javascript
class App {
  data() {
    return { language: "en" };
  }

  methods = {
    setLanguage(language) {
      this.language = language;
      document.documentElement.lang = language;
      this.$i18n.changeLanguage(language);
    }
  };
}
```

```html
<button x-class="{ active: language === 'en' }" @click="setLanguage('en')">EN</button>
<button x-class="{ active: language === 'es' }" @click="setLanguage('es')">ES</button>
<button x-class="{ active: language === 'hi' }" @click="setLanguage('hi')">HI</button>
```

## Recommended Patterns

### Use x-i18n for stable DOM text

```html
<h2 x-i18n="booking.title"></h2>
<button x-i18n="hero.primaryAction"></button>
```

### Use $t for computed text in template expressions

```html
<p>{{ $t('booking.summary', { name: guestName, count: seats }) }}</p>
```

### Use ready before reading translations in JavaScript

```javascript
async mounted() {
  await this.$i18n.ready;
  document.title = this.$t("app.title");
}
```

## Plugin Options

| Option | Description |
| --- | --- |
| `i18next` | Explicit i18next instance/module. If omitted, the plugin looks for `window.i18next` or CommonJS `require('i18next')`. |
| `fetchBackend` | Explicit `i18next-fetch-backend` module/class. Aliases: `backendPlugin`, `Backend`. |
| `base` | Base path used for the default backend path. Default: `/locales`. |
| `backend` | Backend options passed to i18next. Use `loadPath` here for custom resource paths. |
| `lng` | Initial language. If omitted, the plugin checks `document.documentElement.lang` and browser language. |
| `fallbackLng` | Fallback language. Default: `en`. |
| `ns` | Namespace list. Default: `translation`. |
| `defaultNS` | Default namespace. Defaults to first entry in `ns`. |
| `init` | Hook called before `i18next.init()`. Return the configured i18next instance. |

## Troubleshooting

### Translations show keys like itinerary.arrival

*   Confirm the JSON file is reachable at your configured `loadPath`.
*   For demo-locales, open `/demos/locales/en/translation.json` in the browser and verify it returns JSON.
*   Use `x-i18n="{ key: item.key }"` for translated keys inside `x-for`.

### Browser blocks locale loading

`i18next-fetch-backend` uses `fetch()`. Browsers block fetches from `file://`. Serve the project over HTTP.

```
cd website
python -m http.server 8000

# open:
http://localhost:8000/demos/mini-x-plugins/demo-i18n.html
```

### Favicon 404

A missing `/favicon.ico` request is harmless. Add a favicon file if you want to silence the browser request.

### i18next warning: namespace was not yet loaded

The plugin guards `$t()` until i18next is initialized. If you call the raw i18next instance directly, wait for `this.$i18n.ready` or the i18next init promise.

MiniX i18n Plugin · i18next integration · See `demos/mini-x-plugins/demo-i18n.html` for a working example.

document.querySelectorAll('pre code').forEach((block) => { if (window.Prism) Prism.highlightElement(block); });
{% endraw %}