/**
 * MiniX i18next plugin
 *
 * Usage:
 *
 *   MiniX.createApp(App)
 *     .use(MiniX_i18n({
 *       base: './locales',
 *       fallbackLng: 'en',
 *       ns: ['file1', 'file2'],
 *       defaultNS: 'file1',
 *       debug: true,
 *       init: (i18next) => i18next
 *         .use(LanguageDetector)
 *         .use(postProcessor)
 *     }))
 *     .mount('#app');
 *
 * Translation files are loaded by i18next-fetch-backend from:
 *
 *   /locales/{locale}/{namespace}.json
 *
 * For example:
 *
 *   /locales/en/translation.json
 *   /locales/es/translation.json
 */

(function (global) {
  'use strict';

  const PLUGIN_NAME = 'mini-x-i18n';
  const PLUGIN_VERSION = '1.0.0';
  const DEFAULT_NS = 'translation';

  function definePlugin(definition) {
    const PluginCtor = global?.MiniX_Plugin || (typeof MiniX_Plugin !== 'undefined' ? MiniX_Plugin : null);
    return PluginCtor && typeof PluginCtor.define === 'function'
      ? PluginCtor.define(definition)
      : definition;
  }

  function getMiniXState() {
    return global?.MiniX_State || (typeof MiniX_State !== 'undefined' ? MiniX_State : null);
  }

  function normalizeBase(base) {
    const raw = base == null || base === '' ? '/locales' : String(base);
    return raw.replace(/\/+$/, '');
  }

  function normalizeNamespaces(ns) {
    if (Array.isArray(ns)) return ns.length ? ns.map(String) : [DEFAULT_NS];
    if (ns == null || ns === '') return [DEFAULT_NS];
    return [String(ns)];
  }

  function getFallbackLanguage(options) {
    const fallback = options.fallbackLng;
    if (Array.isArray(fallback)) return fallback[0] || 'en';
    if (fallback && typeof fallback === 'object') {
      const keys = Object.keys(fallback);
      const first = fallback.default || fallback[keys[0]];
      return Array.isArray(first) ? first[0] || 'en' : String(first || 'en');
    }
    return String(fallback || 'en');
  }

  function detectInitialLanguage(options) {
    if (options.lng || options.language) return options.lng || options.language;
    if (typeof document !== 'undefined') {
      const htmlLang = document.documentElement?.getAttribute('lang');
      if (htmlLang) return htmlLang;
    }
    if (global?.navigator) {
      return global.navigator.languages?.[0] || global.navigator.language || null;
    }
    return null;
  }

  function resolveI18next(options) {
    if (options.i18next) return options.i18next;
    if (global?.i18next) return global.i18next;
    if (typeof require === 'function') {
      try { return require('i18next'); } catch (_) {}
    }
    throw new Error('[MiniX_i18n] i18next was not found. Load i18next first or pass { i18next }.');
  }

  function resolveFetchBackend(options) {
    if (options.fetchBackend || options.backendPlugin || options.Backend) {
      const backend = options.fetchBackend || options.backendPlugin || options.Backend;
      return backend.default || backend;
    }

    const globalBackend =
      global?.i18nextFetchBackend ||
      global?.I18NextFetchBackend ||
      global?.FetchBackend ||
      global?.i18nextFetchBackend?.default;

    if (globalBackend) return globalBackend.default || globalBackend;

    if (typeof require === 'function') {
      try {
        const mod = require('i18next-fetch-backend');
        return mod.default || mod;
      } catch (_) {}
    }

    throw new Error(
      '[MiniX_i18n] i18next-fetch-backend was not found. ' +
      'Load it before MiniX_i18n or pass { fetchBackend }.'
    );
  }

  function cloneInitOptions(options, base, ns, defaultNS) {
    const reserved = new Set(['base', 'init', 'i18next', 'fetchBackend', 'backendPlugin', 'Backend']);
    const out = {};
    for (const key of Object.keys(options || {})) {
      if (!reserved.has(key)) out[key] = options[key];
    }

    out.fallbackLng = out.fallbackLng == null ? 'en' : out.fallbackLng;
    out.ns = ns;
    out.defaultNS = defaultNS;
    out.debug = Boolean(out.debug);
    out.interpolation = {
      escapeValue: false,
      ...(out.interpolation || {})
    };

    const userBackend = out.backend;
    if (userBackend === false) {
      delete out.backend;
    } else if (userBackend || !out.resources) {
      out.backend = {
        loadPath: base + '/{{lng}}/{{ns}}.json',
        ...(userBackend || {})
      };
    }

    const detected = detectInitialLanguage(out);
    if (detected && out.lng == null) out.lng = detected;

    return out;
  }

  function hasBackend(i18n) {
    return !!(i18n && i18n.modules && i18n.modules.backend);
  }

  function shouldUseFetchBackend(options, initOptions, i18n) {
    if (hasBackend(i18n)) return false;
    if (initOptions.backend === false || options.backend === false) return false;
    if (initOptions.resources || options.resources) return false;
    return true;
  }

  function makeReactiveVersion() {
    const StateCtor = getMiniXState();
    if (!StateCtor) {
      return {
        raw: { version: 0, language: null, ready: false },
        bump(language, ready) {
          this.raw.version += 1;
          this.raw.language = language || null;
          if (ready !== undefined) this.raw.ready = !!ready;
        }
      };
    }

    const state = new StateCtor({ version: 0, language: null, ready: false });
    const raw = state.raw();
    return {
      raw,
      bump(language, ready) {
        state.batch(() => {
          state.set('version', raw.version + 1);
          state.set('language', language || null);
          if (ready !== undefined) state.set('ready', !!ready);
        });
      }
    };
  }

  function safeEvaluate(compiler, expression, component, el, fallback) {
    try {
      const scope = compiler.createScope(component, {}, el);
      return compiler._evaluate(expression, scope, fallback);
    } catch (_) {
      return fallback;
    }
  }

  function parseStaticTarget(raw) {
    const match = String(raw || '').trim().match(/^\[([a-zA-Z0-9_:-]+)\]\s*(.+)$/);
    return match ? { attr: match[1], key: match[2].trim() } : null;
  }

  function isSafeAttributeName(value) {
    const name = String(value || '');
    return /^[A-Za-z_:][A-Za-z0-9_:.-]*$/.test(name) && !/^on/i.test(name);
  }

  function readDirectiveBinding(el, expression, component, compiler) {
    const raw = String(expression || '').trim();
    const staticTarget = parseStaticTarget(raw);
    if (staticTarget) {
      return {
        key: staticTarget.key,
        attr: staticTarget.attr,
        options: readOptions(el, component, compiler)
      };
    }

    let value;
    const shouldEvaluate =
      raw.startsWith('{') ||
      raw.startsWith('[') ||
      raw.startsWith('"') ||
      raw.startsWith("'") ||
      raw.includes('(') ||
      raw.includes('?') ||
      raw.includes('+') ||
      raw.includes('`');

    if (raw && shouldEvaluate) value = safeEvaluate(compiler, raw, component, el, raw);
    else value = raw || el.getAttribute('data-i18n') || (el.textContent || '').trim();

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return {
        key: value.key || value.i18n || value.path || '',
        options: value.options || value.params || {},
        attr: value.attr || value.attribute || el.getAttribute('x-i18n-attr') || null,
        html: value.html === true || el.hasAttribute('x-i18n-html')
      };
    }

    return {
      key: value == null ? '' : String(value),
      options: readOptions(el, component, compiler),
      attr: el.getAttribute('x-i18n-attr') || null,
      html: el.hasAttribute('x-i18n-html')
    };
  }

  function readOptions(el, component, compiler) {
    const raw = el.getAttribute('x-i18n-options');
    if (!raw) return {};
    const value = safeEvaluate(compiler, raw, component, el, {});
    return value && typeof value === 'object' ? value : {};
  }

  function writeTranslation(el, binding, text, component) {
    const value = text == null ? '' : String(text);
    if (binding.attr) {
      if (!isSafeAttributeName(binding.attr)) return;
      el.setAttribute(binding.attr, value);
      return;
    }
    if (binding.html) {
      el.innerHTML = component?.sanitizer?.sanitize
        ? component.sanitizer.sanitize(value)
        : value;
      return;
    }
    el.textContent = value;
  }

  function getDefaultValue(args) {
    const options = args[1];
    if (options && typeof options === 'object' && options.defaultValue != null) return options.defaultValue;
    if (typeof args[1] === 'string') return args[1];
    return args[0] == null ? '' : String(args[0]);
  }

  function isI18nReady(i18n, versionState, namespace) {
    void versionState.raw.version;
    if (!versionState.raw.ready || !i18n.isInitialized) return false;
    if (typeof i18n.hasLoadedNamespace !== 'function') return true;
    return i18n.hasLoadedNamespace(namespace || i18n.options?.defaultNS || DEFAULT_NS);
  }

  function createI18nApi(i18n, versionState, readyPromise, defaultNS) {
    const api = {
      i18next: i18n,
      ready: readyPromise,
      t(...args) {
        const options = args[1];
        const namespace = options && typeof options === 'object' ? options.ns : defaultNS;
        if (!isI18nReady(i18n, versionState, namespace)) return getDefaultValue(args);
        return i18n.t(...args);
      },
      exists(...args) {
        const options = args[1];
        const namespace = options && typeof options === 'object' ? options.ns : defaultNS;
        if (!isI18nReady(i18n, versionState, namespace)) return false;
        return i18n.exists(...args);
      },
      changeLanguage(language, callback) {
        return i18n.changeLanguage(language, callback);
      },
      loadNamespaces(namespaces, callback) {
        return i18n.loadNamespaces(namespaces, callback);
      },
      loadLanguages(languages, callback) {
        return i18n.loadLanguages(languages, callback);
      },
      get language() {
        void versionState.raw.version;
        return i18n.language;
      },
      get languages() {
        void versionState.raw.version;
        return i18n.languages;
      },
      get isInitialized() {
        void versionState.raw.version;
        return !!i18n.isInitialized;
      },
      hasLoadedNamespace(namespace = defaultNS) {
        return isI18nReady(i18n, versionState, namespace);
      }
    };
    return api;
  }

  function MiniX_i18n(userOptions = {}) {
    const options = userOptions || {};
    const base = normalizeBase(options.base);
    const ns = normalizeNamespaces(options.ns);
    const defaultNS = options.defaultNS ? String(options.defaultNS) : ns[0];
    const i18n = resolveI18next(options);
    const versionState = makeReactiveVersion();
    const directiveControllers = new Set();
    const initOptions = cloneInitOptions(options, base, ns, defaultNS);
    let configured = null;
    let readyPromise = null;
    let api = null;

    function refreshTranslations() {
      for (const controller of directiveControllers) controller.update();
    }

    function ensureReady() {
      if (readyPromise) return readyPromise;

      configured = i18n;
      if (typeof options.init === 'function') {
        const result = options.init(i18n);
        if (result) configured = result;
      }

      if (shouldUseFetchBackend(options, initOptions, configured)) {
        configured.use(resolveFetchBackend(options));
      }

      configured.on?.('languageChanged', (language) => {
        versionState.bump(language, true);
        refreshTranslations();
      });

      configured.on?.('loaded', () => {
        versionState.bump(configured.language, true);
        refreshTranslations();
      });

      readyPromise = Promise.resolve(configured.init(initOptions)).then(() => {
        versionState.bump(configured.language || getFallbackLanguage(initOptions), true);
        return configured;
      });

      return readyPromise;
    }

    return definePlugin({
      name: PLUGIN_NAME,
      version: PLUGIN_VERSION,

      install(app) {
        if (app.__minixI18nInstalled) return;
        app.__minixI18nInstalled = true;

        const ready = ensureReady();
        if (!api) api = createI18nApi(configured, versionState, ready, defaultNS);

        if (typeof app.provide === 'function') app.provide('i18n', api);

        if (typeof app.mount === 'function' && !app.__minixI18nMountWrapped) {
          const mount = app.mount.bind(app);
          app.__minixI18nMountWrapped = true;
          app.mount = (target) => ready.then(
            () => mount(target),
            (error) => {
              if (initOptions.debug) console.warn('[MiniX_i18n] initialization failed:', error);
              throw error;
            }
          );
        }

        app.addInstanceAPI((component, instance) => ({
          $i18n: api,
          $t: api.t.bind(api)
        }));

        app.addScope(() => ({
          $i18n: api,
          $t: api.t.bind(api)
        }));

        app.directive('x-i18n', ({ el, expression, component, compiler }) => {
          const controller = {
            lastValue: undefined,
            update() {
              void versionState.raw.version;
              const binding = readDirectiveBinding(el, expression, component, compiler);
              if (!binding.key) return;
              const namespace = binding.options?.ns || defaultNS;
              if (!isI18nReady(configured, versionState, namespace)) return;
              const translated = configured.t(binding.key, binding.options || {});
              if (translated === controller.lastValue) return;
              controller.lastValue = translated;
              writeTranslation(el, binding, translated, component);
            }
          };

          directiveControllers.add(controller);
          const cleanupEffect = compiler._effect(component, () => controller.update());

          return () => {
            directiveControllers.delete(controller);
            if (typeof cleanupEffect === 'function') cleanupEffect();
          };
        }, { priority: 705 });
      }
    });
  }

  MiniX_i18n.version = PLUGIN_VERSION;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = MiniX_i18n;
  }

  if (global) {
    global.MiniX_i18n = MiniX_i18n;
    global.MiniXI18n = MiniX_i18n;
  }
})(typeof window !== 'undefined' ? window : globalThis);
