/**
 * mini-x-debug.js  —  Developer-mode debug plugin for MiniX
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Features ──────────────────────────────────────────────────────────────
 *   • Human-readable component names in every log message
 *   • Lifecycle event tracing  (mount, update, unmount, created)
 *   • Watcher trigger tracing  (path, old value → new value)
 *   • Directive debug logs     (x-if, x-for, x-model, x-bind, …)
 *   • Prop diff logs           (previous vs next props on update)
 *   • x-for loop warnings:
 *       – missing :key
 *       – duplicate key
 *       – unstable primitive key (index-as-key on filtered/sorted lists)
 *   • Effect flush tracing     (how many effects ran, which component)
 *   • Runtime debug bridge:
 *       – In-page floating panel (collapsible, draggable)
 *       – window.MxDB  console bridge
 *       – Component tree inspector via window.MxDB.inspect()
 *       – MiniXStore snapshots via window.MxDB.stores()
 *       – MiniXRouter route snapshots via window.MxDB.router()
 *
 * ── Usage ─────────────────────────────────────────────────────────────────
 *
 *   MiniX.createApp(App)
 *     .use(MiniX_Debug.plugin({ /* options *\/ }))
 *     .mount('#app');
 *
 *   // or install on an existing app instance:
 *   app.use(MiniX_Debug.plugin());
 *
 * ── Options ───────────────────────────────────────────────────────────────
 *
 *   {
 *     lifecycle:   true,   // log component lifecycle events
 *     watchers:    true,   // log watcher triggers
 *     directives:  true,   // log directive bindings
 *     props:       true,   // log prop diffs on update
 *     loops:       true,   // warn on missing/duplicate/unstable x-for keys
 *     effects:     false,  // log effect flush counts (verbose)
 *     panel:       true,   // show in-page debug panel
 *     verbose:     false,  // include full value dumps in every message
 *   }
 *
 * ── Console bridge ────────────────────────────────────────────────────────
 *
 *   window.MxDB.components()   // list all live components
 *   window.MxDB.inspect(name)  // dump component state snapshot
 *   window.MxDB.stores()       // list MiniXStore snapshots
 *   window.MxDB.router()       // inspect current MiniXRouter route
 *   window.MxDB.events()       // tail the last N events
 *   window.MxDB.clearEvents()  // clear event log
 *   window.MxDB.enable(flags)  // toggle feature flags at runtime
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const MiniX_Debug = (() => {

  // ─── Constants ─────────────────────────────────────────────────────────────

  const PLUGIN_NAME    = 'mini-x-debug';
  const PLUGIN_VERSION = '1.0.0';
  const MAX_EVENTS     = 500;   // ring-buffer size for event log
  const MAX_VALUE_LEN  = 120;   // truncate serialised values in logs

  // Colour palette for grouped console output
  const CLR = {
    plugin:    'color:#7c3aed;font-weight:bold',        // purple
    lifecycle: 'color:#0ea5e9;font-weight:bold',        // blue
    watcher:   'color:#f59e0b;font-weight:bold',        // amber
    directive: 'color:#10b981;font-weight:bold',        // emerald
    props:     'color:#8b5cf6;font-weight:bold',        // violet
    loop:      'color:#ef4444;font-weight:bold',        // red
    effect:    'color:#64748b;font-weight:normal',      // slate
    label:     'color:#1e293b;font-weight:bold',        // dark
    muted:     'color:#94a3b8;font-weight:normal',      // muted
    value:     'color:#059669;font-weight:normal',      // green
    oldValue:  'color:#dc2626;font-weight:normal',      // red
    newValue:  'color:#16a34a;font-weight:normal',      // green
  };

  // ─── Shared event ring-buffer ───────────────────────────────────────────────

  /** @type {Array<{ts:number, type:string, component:string, detail:object}>} */
  const _events = [];
  let   _eventSeq = 0;
  let   _dispatchDepth = 0;

  function _record(type, componentName, detail = {}) {
    const entry = { seq: ++_eventSeq, ts: Date.now(), type, component: componentName, detail };
    if (_events.length >= MAX_EVENTS) _events.shift();
    _events.push(entry);
    if (!_dispatchDepth && typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      // Pass only the new entry — callers that need the full log can call getEvents()
      const EventCtor = window.CustomEvent || (typeof CustomEvent !== 'undefined' ? CustomEvent : null);
      if (EventCtor) {
        _dispatchDepth++;
        if (typeof MiniX_State !== 'undefined') MiniX_State._suppressDevCaptureDepth++;
        try {
          window.dispatchEvent(new EventCtor('minix-debug:event', { detail: { event: entry } }));
        } finally {
          if (typeof MiniX_State !== 'undefined') {
            MiniX_State._suppressDevCaptureDepth = Math.max(0, MiniX_State._suppressDevCaptureDepth - 1);
          }
          _dispatchDepth--;
        }
      }
    }
    if (_panel && _activeTab === 'events') {
      _renderPanelEvents();
    } else if (_panel) {
      _refreshComponentsTabSoon();
    }
    return entry;
  }

  // ─── Utility helpers ────────────────────────────────────────────────────────

  function _componentLabel(componentOrName) {
    if (typeof componentOrName === 'string') return componentOrName;
    const cls = componentOrName?.ComponentClass;
    return cls?.name || componentOrName?.instance?.constructor?.name || 'AnonymousComponent';
  }

  // Shared JSON replacer — avoids allocating an identical closure in both _safeSerialise and _safeClone
  function _jsonReplacer(_k, v) {
    if (typeof v === 'function') return '[Function]';
    if (v instanceof Map) return { __Map: [...v.entries()] };
    if (v instanceof Set) return { __Set: [...v.values()] };
    return v;
  }

  function _safeSerialise(value, maxLen = MAX_VALUE_LEN) {
    if (value === null)      return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'function') return `[Function: ${value.name || 'anonymous'}]`;
    let s;
    try {
      s = JSON.stringify(value, _jsonReplacer);
    } catch (_) {
      s = String(value);
    }
    if (s && s.length > maxLen) s = s.slice(0, maxLen) + '…';
    return s;
  }

  function _safeClone(value) {
    try {
      return JSON.parse(JSON.stringify(value, _jsonReplacer));
    } catch (_) {
      return _safeSerialise(value, 300);
    }
  }

  function _componentStateSnapshot(comp) {
    try {
      const raw = comp.state?.raw?.();
      return raw ? _safeClone(raw.__raw || raw) : {};
    } catch (_) {
      return {};
    }
  }

  function _componentPropsSnapshot(comp) {
    try {
      return _safeClone(comp.props || {});
    } catch (_) {
      return {};
    }
  }

  const _HTML_ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function _escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (c) => _HTML_ESCAPE_MAP[c]);
  }

  function _componentSummary(id, comp) {
    const name = _componentLabel(comp);
    // Count keys from raw state without cloning — clone only for display
    let stateKeys = 0;
    let propKeys = 0;
    try {
      const raw = comp.state?.raw?.();
      const rawState = raw?.__raw || raw;
      if (rawState) stateKeys = Object.keys(rawState).length;
    } catch (_) {}
    try { propKeys = Object.keys(comp.props || {}).length; } catch (_) {}
    const state = _componentStateSnapshot(comp);
    const props = _componentPropsSnapshot(comp);
    return { id, name, mounted: !!comp.isMounted, state, props, stateKeys, propKeys };
  }

  function _storeSnapshot(store) {
    try {
      if (store && typeof store.snapshot === 'function') return _safeClone(store.snapshot());
      if (store?.$state) return _safeClone(store.$state.__raw || store.$state);
    } catch (_) {}
    return {};
  }

  function _hookStore(name, store) {
    if (!name || !store || typeof store.watch !== 'function') return;
    if (_storeRefs.get(name) === store && _storeCleanups.has(name)) return;
    if (_storeCleanups.has(name)) {
      try { _storeCleanups.get(name)?.(); } catch (_) {}
      _storeCleanups.delete(name);
      _storeRefs.delete(name);
    }
    try {
      const cleanup = store.watch('', (newVal, oldVal, path, meta) => {
        const detail = {
          kind: 'state',
          name,
          path,
          old: oldVal,
          new: newVal,
          meta,
        };
        _storeEvents.push({ ts: Date.now(), detail });
        if (_storeEvents.length > MAX_PANEL_ENTRIES) _storeEvents.shift();
        _record('store', `store:${name}`, detail);
        _renderPanelEvents();
        _refreshComponentsTabSoon();
      });
      _storeCleanups.set(name, cleanup);
      _storeRefs.set(name, store);
    } catch (err) {
      console.warn(`[MiniX Debug] Could not watch store "${name}".`, err);
    }
  }

  function _installStoreDebugListener() {
    if (_storeDebugListenerInstalled || typeof window === 'undefined') return;
    _storeDebugListenerInstalled = true;
    _storeDebugListener = (event) => {
      const payload = event.detail || {};
      const detail = {
        kind: 'action',
        event: payload.type,
        ...(payload.detail || {})
      };
      _storeEvents.push({ ts: payload.timestamp || Date.now(), detail });
      if (_storeEvents.length > MAX_PANEL_ENTRIES) _storeEvents.shift();
      _record('store', `store:${detail.store || 'unknown'}`, detail);
      _renderPanelEvents();
      _refreshComponentsTabSoon();
    };
    window.addEventListener('minix-store:debug', _storeDebugListener);
  }

  function _hookMiniXStore() {
    if (typeof window === 'undefined' || !window.MiniXStore) return;
    _installStoreDebugListener();
    const api = window.MiniXStore;

    if (!_storeBridgePatched && typeof api.define === 'function') {
      _storeBridgePatched = true;
      _storeOriginalDefine = api.define;
      const originalDefine = api.define.bind(api);
      const patched = (name, def) => {
        const store = originalDefine(name, def);
        _hookStore(name, store);
        return store;
      };
      _patches.push({ obj: api, key: 'define', original: api.define });
      api.define = patched;
    }

    if (typeof api.list === 'function' && typeof api.use === 'function') {
      for (const name of api.list()) {
        try { _hookStore(name, api.use(name)); } catch (_) {}
      }
    }
  }

  function _routerSnapshot(router) {
    try {
      const route = router.currentRoute || {};
      return _safeClone({
        fullPath: route.fullPath,
        path: route.path,
        name: route.name || null,
        params: route.params || {},
        query: route.query || {},
        hash: route.hash || '',
        matched: Array.isArray(route.matched)
          ? route.matched.map((record) => record.name || record.fullPath || record.path)
          : []
      });
    } catch (_) {
      return {};
    }
  }

  function _routeLabel(route) {
    if (!route) return '(none)';
    if (typeof route === 'string') return route;
    return route.fullPath || route.path || route.name || _safeSerialise(route, 80);
  }

  function _routerEventSummary(payload) {
    const type = payload?.type || 'router';
    const detail = payload?.detail || {};
    if (type.startsWith('navigation:')) {
      return `${type} ${_routeLabel(detail.from)} -> ${_routeLabel(detail.to)}`;
    }
    if (type.startsWith('guard:') || type.startsWith('hook:')) {
      return `${type} ${detail.source || ''} ${detail.name || ''} ${_routeLabel(detail.from)} -> ${_routeLabel(detail.to)}`;
    }
    if (type === 'link:click') {
      return `${type} ${detail.type || 'link'} -> ${_safeSerialise(detail.to, 80)}`;
    }
    if (type.startsWith('view:') || type.startsWith('keepalive:')) {
      return `${type} ${detail.componentName || detail.record || detail.viewName || ''} ${_routeLabel(detail.route)}`;
    }
    return `${type} ${_safeSerialise(detail, 100)}`;
  }

  function _storeEventSummary(detail) {
    if (!detail) return '';
    if (detail.kind === 'action') {
      return `${detail.event || 'action'} ${detail.store}.${detail.action || '(unknown)'}`;
    }
    return `state ${detail.name}.${detail.path || '(root)'} ${_safeSerialise(detail.old, 40)} -> ${_safeSerialise(detail.new, 40)}`;
  }

  function _hookRouter(router) {
    if (!router || _routerCleanups.has(router) || typeof router.onDebug !== 'function') return;
    try {
      const cleanup = router.onDebug((payload) => {
        _routerEvents.push({ ts: payload.timestamp || Date.now(), detail: payload });
        if (_routerEvents.length > MAX_PANEL_ENTRIES) _routerEvents.shift();
        _record('router', 'router', payload);
        _renderPanelEvents();
        _refreshComponentsTabSoon();
      });
      _routerCleanups.set(router, cleanup);
      _routers.add(router);
      if (typeof router.enableDebug === 'function') router.enableDebug();
    } catch (err) {
      console.warn('[MiniX Debug] Could not attach router debug listener.', err);
    }
  }

  function _diffObjects(prev = {}, next = {}) {
    const changes = [];
    // Check all keys in prev (covers removed + changed)
    for (const k in prev) {
      if (Object.prototype.hasOwnProperty.call(prev, k) && !Object.is(prev[k], next[k])) {
        changes.push({ key: k, from: prev[k], to: next[k] });
      }
    }
    // Check keys in next that were not in prev (covers added)
    for (const k in next) {
      if (Object.prototype.hasOwnProperty.call(next, k) && !Object.prototype.hasOwnProperty.call(prev, k)) {
        changes.push({ key: k, from: undefined, to: next[k] });
      }
    }
    return changes;
  }

  // ─── Feature flag defaults ──────────────────────────────────────────────────

  const _defaultFlags = {
    lifecycle:  true,
    watchers:   true,
    directives: true,
    props:      true,
    loops:      true,
    effects:    false,
    panel:      true,
    verbose:    false,
  };

  // ─── Live component registry ────────────────────────────────────────────────
  // Populated by the addInstanceAPI hook; allows window.MxDB.inspect()

  const _liveComponents = new Map(); // id → component reference
  const _storeCleanups = new Map(); // store name -> cleanup
  const _storeRefs = new Map(); // store name -> store proxy
  const _routerCleanups = new WeakMap(); // router -> cleanup
  const _routers = new Set();
  const _storeEvents = [];
  const _routerEvents = [];
  let _storeBridgePatched = false;
  let _storeOriginalDefine = null;
  let _storeDebugListenerInstalled = false;
  let _storeDebugListener = null;

  // ─── Patch helpers ─────────────────────────────────────────────────────────
  // All patches are reversible: originals stored and restored on uninstall.

  const _patches = []; // { obj, key, original }

  function _definePlugin(definition) {
    const PluginCtor = (typeof MiniX_Plugin !== 'undefined' ? MiniX_Plugin : null);
    return PluginCtor && typeof PluginCtor.define === 'function'
      ? PluginCtor.define(definition)
      : definition;
  }

  function _restorePatches() {
    for (const { obj, key, original } of _patches) obj[key] = original;
    _patches.length = 0;
  }

  // Module-level constant — avoids re-allocating this object on every _log call
  const _LOG_CLR = {
    lifecycle: CLR.lifecycle, watcher: CLR.watcher, directive: CLR.directive,
    props: CLR.props, loop: CLR.loop, effect: CLR.effect,
  };

  // ─── Core logger ────────────────────────────────────────────────────────────

  function _log(flags, category, componentName, message, detail = null) {
    const colourKey = _LOG_CLR[category] || CLR.plugin;

    const prefix = `%c[MiniX Debug]%c %c${category}%c ${componentName}`;
    const styles = [CLR.plugin, '', colourKey, CLR.label];

    if (detail && (flags.verbose || category === 'loop' || category === 'props')) {
      console.groupCollapsed(prefix + (message ? ` — ${message}` : ''), ...styles);
      if (detail) console.log(detail);
      console.groupEnd();
    } else {
      const msg = message ? ` — ${message}` : '';
      console.log(prefix + msg, ...styles);
    }
  }

  function _warn(componentName, message, detail = null) {
    const prefix = `%c[MiniX Debug]%c %c⚠ warning%c ${componentName}`;
    const styles = [CLR.plugin, '', CLR.loop, CLR.label];
    if (detail) {
      console.groupCollapsed(prefix + ` — ${message}`, ...styles);
      console.warn(detail);
      console.groupEnd();
    } else {
      console.warn(prefix + ` — ${message}`, ...styles);
    }
  }

  // ─── Lifecycle tracing ──────────────────────────────────────────────────────

  function _traceLifecycle(flags, componentName, phaseName, meta = {}) {
    if (!flags.lifecycle) return;
    _record('lifecycle', componentName, { phase: phaseName, ...meta });
    _log(flags, 'lifecycle', componentName, phaseName);
  }

  // ─── Watcher tracing ────────────────────────────────────────────────────────

  function _wrapStateWatchers(flags, state, componentName) {
    if (!flags.watchers || !state?.watch) return;
    if (state.__minixDebugWatchersWrapped) return;

    const originalWatch = state.watch.bind(state);
    // Shadow watch on the component's state proxy — wrap every registered
    // callback so we can log before delegating to the real handler.
    state.watch = (path, callback) => {
      const wrapped = (newVal, oldVal, key, meta) => {
        _record('watcher', componentName, { path, old: oldVal, new: newVal });
        _log(
          flags, 'watcher', componentName,
          `"${path}" changed`,
          flags.verbose
            ? { path, old: _safeSerialise(oldVal), new: _safeSerialise(newVal) }
            : null
        );
        if (flags.verbose) {
          console.log(
            `  %cold%c ${_safeSerialise(oldVal)}  %c→  %cnew%c ${_safeSerialise(newVal)}`,
            CLR.oldValue, '', CLR.muted, CLR.newValue, ''
          );
        }
        _refreshComponentsTabSoon();
        return callback(newVal, oldVal, key, meta);
      };
      return originalWatch(path, wrapped);
    };
    // Mark as wrapped only after successful replacement
    state.__minixDebugWatchersWrapped = true;
  }

  function _hookStateRefresh(flags, component) {
    const state = component?.state;
    if (!state || state.__minixDebugRefreshHooked) return;
    state.__minixDebugRefreshHooked = true;
    const componentName = _componentLabel(component);

    _wrapStateWatchers(flags, state, componentName);

    if (flags.watchers && !state.__minixDebugDevCaptureHooked) {
      const previousDevCaptureHook = typeof state._onDevCapture === 'function' ? state._onDevCapture.bind(state) : null;
      state._onDevCapture = (entry, raw = {}) => {
        if (previousDevCaptureHook) previousDevCaptureHook(entry, raw);
        if (_dispatchDepth) return;
        _record('state', componentName, {
          operation: entry.operation || raw.operation,
          path: entry.path || '',
          old: entry.oldValue,
          new: entry.newValue,
          meta: entry.meta || raw.meta || {},
          caller: entry.caller,
          trace: entry.trace
        });
        _refreshComponentsTabSoon();
      };
      state.__minixDebugDevCaptureHooked = true;
    }

    if (typeof state._bubbleTargetNotify === 'function') {
      const originalBubbleNotify = state._bubbleTargetNotify.bind(state);
      state._bubbleTargetNotify = (...args) => {
        const result = originalBubbleNotify(...args);
        _refreshComponentsTabSoon();
        return result;
      };
    }

    if (typeof state._notify === 'function') {
      const originalNotify = state._notify.bind(state);
      state._notify = (...args) => {
        const result = originalNotify(...args);
        _refreshComponentsTabSoon();
        return result;
      };
    }
  }

  // ─── Prop diff tracing ──────────────────────────────────────────────────────

  function _tracePropDiff(flags, componentName, previousProps, nextProps) {
    if (!flags.props) return;
    const changes = _diffObjects(previousProps, nextProps);
    if (!changes.length) return;
    _record('props', componentName, { changes });
    _log(flags, 'props', componentName, `${changes.length} prop(s) changed`, { changes });
    if (flags.verbose) {
      for (const { key, from, to } of changes) {
        console.log(
          `  %c${key}%c  ${_safeSerialise(from)} %c→%c ${_safeSerialise(to)}`,
          CLR.label, '', CLR.muted, CLR.value
        );
      }
    }
    _refreshComponentsTabSoon();
  }

  // ─── Global Compiler patches ────────────────────────────────────────────────
  // Applied once on plugin install; removed on uninstall.

  let _globalPatchesApplied = false;

  function _installGlobalPatches(flags) {
    if (_globalPatchesApplied) return;
    _globalPatchesApplied = true;

    // ── x-for: wrap _compileForDirective ──────────────────────────────────────
    if (flags.loops && typeof MiniX_Compiler !== 'undefined') {
      const proto = MiniX_Compiler.prototype;
      const original = proto._compileForDirective;

      proto._compileForDirective = function _debugForDirective(el, expression, component) {
        const compName = _componentLabel(component);

        // Parse the expression to extract source and key attr
        const match = expression.match(/^\s*(?:\(([^)]+)\)|([^\s]+))\s+in\s+(.+)$/);
        const keyAttr = el.getAttribute(':key') || el.getAttribute('x-bind:key') || el.getAttribute('key');

        if (match && !keyAttr) {
          _record('loop', compName, { kind: 'missing-key', expression });
          _warn(compName,
            `x-for="${expression}" has no :key — use a stable unique key to avoid unnecessary DOM recreation.`,
            { expression, tip: 'Add :key="item.id" or :key="index" (only if list never reorders/filters).' }
          );
        }

        // Wrap the returned cleanup so we can intercept the effect's first run
        const cleanup = original.call(this, el, expression, component);

        // After the first render, scan for duplicate / primitive-index keys
        // by hooking into the seenKeys Set that _compileForDirective maintains.
        // We do this by watching for _warn output from the built-in code
        // and adding our own enriched messages.
        // (The actual key-set checks run inside the existing effect; we emit
        //  enhanced warnings from our patched _warn below.)
        return cleanup;
      };

      _patches.push({ obj: proto, key: '_compileForDirective', original });

      // ── Patch compiler _warn to enrich loop warnings ───────────────────────
      const origWarn = proto._warn;
      proto._warn = function _debugWarn(message, ...args) {
        // Re-emit built-in loop warnings through our styled output
        if (message && message.includes('Duplicate x-for key')) {
          _record('loop', 'Compiler', { kind: 'duplicate-key', message });
          console.warn(
            `%c[MiniX Debug]%c %c⚠ duplicate key%c  ${message}`,
            CLR.plugin, '', CLR.loop, CLR.label
          );
          return; // suppress the plain console.warn duplicate
        }
        if (message && message.includes('stable key')) {
          _record('loop', 'Compiler', { kind: 'unstable-key', message });
          console.warn(
            `%c[MiniX Debug]%c %c⚠ unstable key%c  ${message}`,
            CLR.plugin, '', CLR.loop, CLR.label,
            '\n  Tip: primitive keys derived from index are unstable when the list is filtered, sorted, or spliced.'
          );
          return;
        }
        // Delegate all other warnings
        return origWarn ? origWarn.call(this, message, ...args) : undefined;
      };
      _patches.push({ obj: proto, key: '_warn', original: origWarn });
    }

    // ── Directive debug logs ───────────────────────────────────────────────────
    if (flags.directives && typeof MiniX_Compiler !== 'undefined') {
      const proto = MiniX_Compiler.prototype;

      const _wrapDirective = (methodName, label) => {
        const orig = proto[methodName];
        if (!orig) return;
        proto[methodName] = function _debugDirective(el, expression, component, ...rest) {
          const compName = _componentLabel(component);
          _record('directive', compName, { directive: label, expression });
          _log(flags, 'directive', compName, `${label}="${expression || ''}"`, null);
          return orig.call(this, el, expression, component, ...rest);
        };
        _patches.push({ obj: proto, key: methodName, original: orig });
      };

      _wrapDirective('_compileIfDirective',       'x-if');
      _wrapDirective('_compileShowDirective',      'x-show');
      _wrapDirective('_compileModelDirective',     'x-model');
      _wrapDirective('_compileHtmlDirective',      'x-html');
      _wrapDirective('_compileScopedDataDirective','x-data');
      _wrapDirective('_compileTransitionDirective','x-transition');
    }
  }

  // ─── In-page debug panel ────────────────────────────────────────────────────

  // Scheduler: prefer rAF, fall back to setTimeout — evaluated once at load time
  const _schedule = typeof requestAnimationFrame === 'function'
    ? (fn) => requestAnimationFrame(fn)
    : (fn) => setTimeout(fn, 0);

  let _panel = null;
  let _activeTab = 'events';   // tracks which tab is currently visible
  const MAX_PANEL_ENTRIES = 100;
  let _componentsRefreshPending = false;

  function _refreshComponentsTabSoon() {
    if (!_panel || _componentsRefreshPending) return;
    if (_activeTab === 'events') return;  // no state tab is visible
    _componentsRefreshPending = true;
    _schedule(() => {
      _componentsRefreshPending = false;
      if (!_panel) return;
      _renderActiveStateTab();
    });
  }

  // Cached references to panel child elements (set in _createPanel, nulled on close/uninstall)
  let _panelEls = null;

  function _renderActiveStateTab() {
    if (!_panel || !_panelEls) return;
    if (_activeTab === 'components') _renderComponentsTab(_panelEls.components);
    else if (_activeTab === 'stores')     _renderStoresTab(_panelEls.stores);
    else if (_activeTab === 'router')     _renderRouterTab(_panelEls.router);
  }

  function _createPanel() {
    if (typeof document === 'undefined' || _panel) return;

    const style = document.createElement('style');
    style.textContent = `
      #minix-debug-panel {
        position:fixed; bottom:16px; right:16px; z-index:99999;
        width:360px; max-height:480px;
        background:#1e1e2e; color:#cdd6f4;
        border:1px solid #7c3aed; border-radius:8px;
        font:12px/1.5 "Fira Code",monospace; box-shadow:0 8px 32px rgba(0,0,0,.6);
        display:flex; flex-direction:column; overflow:hidden;
        user-select:none;
      }
      #minix-debug-panel.collapsed { max-height:36px; }
      #minix-debug-header {
        display:flex; align-items:center; justify-content:space-between;
        padding:6px 10px; background:#313244; cursor:move; flex-shrink:0;
        border-radius:7px 7px 0 0;
      }
      #minix-debug-header span { color:#cba6f7; font-weight:bold; font-size:11px; letter-spacing:.05em; }
      #minix-debug-header button {
        background:none; border:none; color:#89b4fa; cursor:pointer;
        font-size:14px; padding:0 4px; line-height:1;
      }
      #minix-debug-header button:hover { color:#cba6f7; }
      #minix-debug-tabs {
        display:flex; background:#181825; flex-shrink:0; border-bottom:1px solid #313244;
      }
      #minix-debug-tabs button {
        flex:1; background:none; border:none; color:#6c7086; cursor:pointer;
        padding:5px; font:11px/1 "Fira Code",monospace; transition:color .15s;
      }
      #minix-debug-tabs button.active { color:#cba6f7; border-bottom:2px solid #7c3aed; }
      #minix-debug-body {
        flex:1; overflow-y:auto; padding:6px; font-size:11px;
        min-height:0;
      }
      .minix-event {
        padding:3px 6px; border-radius:4px; margin-bottom:2px;
        border-left:3px solid transparent; cursor:default;
      }
      .minix-event:hover { background:#313244; }
      .minix-event.lifecycle { border-color:#0ea5e9; }
      .minix-event.watcher   { border-color:#f59e0b; }
      .minix-event.state     { border-color:#fb923c; background:#2b2118; }
      .minix-event.directive { border-color:#10b981; }
      .minix-event.props     { border-color:#8b5cf6; }
      .minix-event.loop      { border-color:#ef4444; background:#2d1a1a; }
      .minix-event.store     { border-color:#22c55e; background:#132417; }
      .minix-event.router    { border-color:#38bdf8; background:#101f2b; }
      .minix-event .comp  { color:#cba6f7; }
      .minix-event .phase { color:#89b4fa; }
      .minix-event .muted { color:#585b70; font-size:10px; }
      #minix-debug-footer {
        display:flex; justify-content:space-between; align-items:center;
        padding:4px 8px; background:#181825; font-size:10px; color:#585b70;
        flex-shrink:0; border-top:1px solid #313244;
      }
      #minix-debug-footer button {
        background:none; border:1px solid #313244; color:#6c7086;
        border-radius:3px; cursor:pointer; padding:1px 6px; font-size:10px;
      }
      #minix-debug-footer button:hover { color:#cba6f7; border-color:#7c3aed; }
      #minix-debug-components,
      #minix-debug-stores,
      #minix-debug-router { padding:4px; }
      .minix-comp-row {
        padding:6px; border-radius:4px; margin-bottom:5px; cursor:pointer;
        display:block;
      }
      .minix-comp-row:hover { background:#313244; }
      .minix-comp-row-head {
        display:flex; justify-content:space-between; align-items:center; gap:8px;
      }
      .minix-comp-row .name { color:#cba6f7; font-weight:600; }
      .minix-comp-row .state-badge {
        font-size:9px; padding:1px 5px; border-radius:10px;
        background:#313244; color:#a6e3a1;
      }
      .minix-comp-state {
        margin:5px 0 0; padding:6px; max-height:120px; overflow:auto;
        background:#11111b; border:1px solid #313244; border-radius:4px;
        color:#cdd6f4; font:10px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        white-space:pre-wrap; word-break:break-word;
      }
    `;
    document.head.appendChild(style);

    _panel = document.createElement('div');
    _panel.id = 'minix-debug-panel';
    _panel.innerHTML = `
      <div id="minix-debug-header">
        <span>⚡ MiniX Debug</span>
        <div>
          <button id="minix-debug-clear" title="Clear events">⌫</button>
          <button id="minix-debug-toggle" title="Collapse/Expand">▾</button>
          <button id="minix-debug-close" title="Close">✕</button>
        </div>
      </div>
      <div id="minix-debug-tabs">
        <button class="active" data-tab="events">Events</button>
        <button data-tab="components">Components</button>
        <button data-tab="stores">Stores</button>
        <button data-tab="router">Router</button>
      </div>
      <div id="minix-debug-body">
        <div id="minix-debug-events"></div>
        <div id="minix-debug-components" style="display:none"></div>
        <div id="minix-debug-stores" style="display:none"></div>
        <div id="minix-debug-router" style="display:none"></div>
      </div>
      <div id="minix-debug-footer">
        <span id="minix-debug-count">0 events</span>
        <button id="minix-debug-export" title="Copy events to clipboard">copy log</button>
      </div>
    `;
    document.body.appendChild(_panel);

    // Cache element references so we avoid repeated querySelector calls
    _panelEls = {
      events:     _panel.querySelector('#minix-debug-events'),
      components: _panel.querySelector('#minix-debug-components'),
      stores:     _panel.querySelector('#minix-debug-stores'),
      router:     _panel.querySelector('#minix-debug-router'),
      count:      _panel.querySelector('#minix-debug-count'),
      toggle:     _panel.querySelector('#minix-debug-toggle'),
    };

    // ── Tab switching ──────────────────────────────────────────────────────────
    const tabs = _panel.querySelectorAll('#minix-debug-tabs button');
    const { events: eventsEl, components: componentsEl, stores: storesEl, router: routerEl } = _panelEls;

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const active = tab.dataset.tab;
        _activeTab = active;
        eventsEl.style.display    = active === 'events'     ? '' : 'none';
        componentsEl.style.display = active === 'components' ? '' : 'none';
        storesEl.style.display     = active === 'stores'     ? '' : 'none';
        routerEl.style.display     = active === 'router'     ? '' : 'none';
        if (active === 'components') _renderComponentsTab(componentsEl);
        if (active === 'stores') _renderStoresTab(storesEl);
        if (active === 'router') _renderRouterTab(routerEl);
      });
    });

    // ── Controls ──────────────────────────────────────────────────────────────
    _panel.querySelector('#minix-debug-toggle').addEventListener('click', () => {
      _panel.classList.toggle('collapsed');
      _panelEls.toggle.textContent = _panel.classList.contains('collapsed') ? '▸' : '▾';
    });
    _panel.querySelector('#minix-debug-close').addEventListener('click', () => {
      _panel.remove(); _panel = null; _panelEls = null; _activeTab = 'events';
    });
    _panel.querySelector('#minix-debug-clear').addEventListener('click', () => {
      _events.length = 0;
      _renderPanelEvents();
    });
    _panel.querySelector('#minix-debug-export').addEventListener('click', () => {
      const text = JSON.stringify(_events, null, 2);
      navigator.clipboard?.writeText(text).then(() => {
        console.log('[MiniX Debug] Event log copied to clipboard.');
      });
    });

    // ── Dragging ──────────────────────────────────────────────────────────────
    const header = _panel.querySelector('#minix-debug-header');
    let dragState = null;
    header.addEventListener('mousedown', e => {
      if (e.target.tagName === 'BUTTON') return;
      const rect = _panel.getBoundingClientRect();
      dragState = { startX: e.clientX - rect.left, startY: e.clientY - rect.top };
      e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
      if (!dragState || !_panel) return;
      const panelW = _panel.offsetWidth;
      const panelH = _panel.offsetHeight;
      const maxX = window.innerWidth  - panelW;
      const maxY = window.innerHeight - panelH;
      const x = Math.min(Math.max(0, e.clientX - dragState.startX), maxX);
      const y = Math.min(Math.max(0, e.clientY - dragState.startY), maxY);
      _panel.style.left   = `${x}px`;
      _panel.style.top    = `${y}px`;
      _panel.style.right  = 'auto';
      _panel.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', () => { dragState = null; });

    _renderPanelEvents();
  }

  function _renderPanelEvents() {
    if (!_panel || _activeTab !== 'events') return;
    const el = _panelEls?.events;
    if (!el) return;

    const typeLabel = { lifecycle:'L', watcher:'W', state:'M', directive:'D', props:'P', loop:'!', effect:'E', store:'S', router:'R' };
    el.innerHTML = _events.slice(-MAX_PANEL_ENTRIES).reverse().map(ev => {
      const icon = typeLabel[ev.type] || '⚪';
      const time = new Date(ev.ts).toLocaleTimeString('en', { hour12:false, hour:'2-digit', minute:'2-digit', second:'2-digit' });
      const detail = ev.type === 'watcher'
        ? `<span class="phase">${_escapeHtml(ev.detail.path)}</span>`
        : ev.type === 'state'
        ? `<span class="phase">${_escapeHtml(`${ev.detail.operation || 'set'} ${ev.detail.path || '(root)'}`)}</span>`
        : ev.type === 'loop'
        ? `<span class="phase">${_escapeHtml(ev.detail.kind)}</span>`
        : ev.type === 'lifecycle'
        ? `<span class="phase">${_escapeHtml(ev.detail.phase)}</span>`
        : ev.type === 'directive'
        ? `<span class="phase">${_escapeHtml(ev.detail.directive)}</span>`
        : ev.type === 'store'
        ? `<span class="phase">${_escapeHtml(_storeEventSummary(ev.detail))}</span>`
        : ev.type === 'router'
        ? `<span class="phase">${_escapeHtml(_routerEventSummary(ev.detail))}</span>`
        : '';
      return `<div class="minix-event ${ev.type}">
        ${_escapeHtml(icon)} <span class="comp">${_escapeHtml(ev.component)}</span> ${detail}
        <span class="muted">${time}</span>
      </div>`;
    }).join('');

    if (_panelEls?.count) _panelEls.count.textContent = `${_events.length} events`;
  }

  function _renderComponentsTab(el) {
    if (!el) return;
    const rows = [..._liveComponents.entries()].map(([id, comp]) => {
      const summary = _componentSummary(id, comp);
      const stateJson = JSON.stringify(summary.state, null, 2);
      return `<div class="minix-comp-row" data-id="${id}" title="Click to inspect in console">
        <div class="minix-comp-row-head">
          <span class="name">${_escapeHtml(summary.name)}</span>
          <span class="state-badge">${summary.stateKeys} state / ${summary.propKeys} props</span>
        </div>
        <pre class="minix-comp-state">${_escapeHtml(stateJson)}</pre>
      </div>`;
    });
    el.innerHTML = rows.length
      ? rows.join('')
      : '<div style="color:#585b70;padding:8px">No live components tracked</div>';

    el.querySelectorAll('.minix-comp-row').forEach(row => {
      row.addEventListener('click', () => {
        const comp = _liveComponents.get(row.dataset.id);
        if (comp) _consoleInspect(_componentLabel(comp), comp);
      });
    });
  }

  function _renderStoresTab(el) {
    if (!el) return;
    _hookMiniXStore();
    const rows = [];
    if (typeof window !== 'undefined' && window.MiniXStore?.list && window.MiniXStore?.use) {
      for (const name of window.MiniXStore.list()) {
        let store;
        try { store = window.MiniXStore.use(name); } catch (_) { store = null; }
        if (!store) continue;
        const snapshot = _storeSnapshot(store);
        const recent = _storeEvents
          .filter((entry) => entry.detail?.store === name || entry.detail?.name === name)
          .slice(-6)
          .reverse();
        rows.push(`<div class="minix-comp-row" data-store="${_escapeHtml(name)}" title="Click to inspect store in console">
          <div class="minix-comp-row-head">
            <span class="name">${_escapeHtml(name)}</span>
            <span class="state-badge">${Object.keys(snapshot || {}).length} keys</span>
          </div>
          <div class="minix-comp-state">${recent.length
            ? recent.map((entry) => _escapeHtml(_storeEventSummary(entry.detail))).join('\n')
            : 'No store actions or state changes yet'}</div>
          <pre class="minix-comp-state">${_escapeHtml(JSON.stringify(snapshot, null, 2))}</pre>
        </div>`);
      }
    }
    el.innerHTML = rows.length
      ? rows.join('')
      : '<div style="color:#585b70;padding:8px">No MiniXStore stores tracked</div>';
    el.querySelectorAll('.minix-comp-row').forEach(row => {
      row.addEventListener('click', () => {
        if (row.dataset.store && window.MxDB) window.MxDB.store(row.dataset.store);
      });
    });
  }

  function _renderRouterTab(el) {
    if (!el) return;
    const recentEvents = _routerEvents.slice(-12).reverse();
    const rows = [..._routers].map((router, index) => {
      const snapshot = _routerSnapshot(router);
      return `<div class="minix-comp-row" data-router-index="${index}" title="Click to inspect router in console">
        <div class="minix-comp-row-head">
          <span class="name">router ${index + 1}</span>
          <span class="state-badge">${_escapeHtml(snapshot.fullPath || '/')}</span>
        </div>
        <div class="minix-comp-state">${recentEvents.length
          ? recentEvents.map((entry) => _escapeHtml(_routerEventSummary(entry.detail))).join('\n')
          : 'No router navigation or middleware events yet'}</div>
        <pre class="minix-comp-state">${_escapeHtml(JSON.stringify(snapshot, null, 2))}</pre>
      </div>`;
    });
    el.innerHTML = rows.length
      ? rows.join('')
      : '<div style="color:#585b70;padding:8px">No MiniXRouter instance tracked yet</div>';
    el.querySelectorAll('.minix-comp-row').forEach(row => {
      row.addEventListener('click', () => {
        if (window.MxDB) window.MxDB.router(Number(row.dataset.routerIndex || 0));
      });
    });
  }

  // ─── Console bridge ─────────────────────────────────────────────────────────

  function _consoleInspect(name, comp) {
    const state = _componentStateSnapshot(comp);
    const props = _componentPropsSnapshot(comp);
    console.groupCollapsed(
      `%c[MiniX Debug]%c inspect%c  ${name}`,
      CLR.plugin, '', CLR.label
    );
    console.log('%cComponent', 'font-weight:bold', comp);
    console.log('%cState snapshot', 'font-weight:bold', state);
    console.log('%cProps', 'font-weight:bold', props);
    console.log('%cIs mounted', 'font-weight:bold', comp.isMounted);
    console.groupEnd();
  }

  function _installConsoleBridge() {
    window.MxDB = {
      /** List all live component names */
      components() {
        const list = [..._liveComponents.entries()].map(([id, comp], index) => ({
          index,
          id,
          component: _componentLabel(comp),
          mounted: !!comp.isMounted,
          state: _componentStateSnapshot(comp),
          props: _componentPropsSnapshot(comp),
        }));
        console.table(list.map((entry) => ({
          index: entry.index,
          component: entry.component,
          mounted: entry.mounted,
          state: _safeSerialise(entry.state, 140),
          props: _safeSerialise(entry.props, 100),
        })));
        return list;
      },

      /** Dump state snapshot for a component by name */
      inspect(nameOrIndex) {
        const entries = [..._liveComponents.entries()];
        let comp;
        if (typeof nameOrIndex === 'number') {
          comp = entries[nameOrIndex]?.[1];
        } else {
          comp = entries.find(([, c]) => _componentLabel(c) === nameOrIndex)?.[1];
        }
        if (!comp) {
          console.warn(`[MiniX Debug] Component "${nameOrIndex}" not found. Call MxDB.components() to list available components.`);
          return null;
        }
        const name = _componentLabel(comp);
        _consoleInspect(name, comp);
        return comp;
      },

      /** Return the last N recorded events */
      events(n = 50) {
        const slice = _events.slice(-n);
        console.table(slice.map(e => ({
          seq:       e.seq,
          type:      e.type,
          component: e.component,
          detail:    _safeSerialise(e.detail, 80),
        })));
        return slice;
      },

      /** Clear the event log */
      clearEvents() {
        _events.length = 0;
        _renderPanelEvents();
        console.log('%c[MiniX Debug]%c Event log cleared.', CLR.plugin, '');
      },

      /** List MiniXStore stores and snapshots */
      stores() {
        _hookMiniXStore();
        const api = typeof window !== 'undefined' ? window.MiniXStore : null;
        const list = [];
        if (api?.list && api?.use) {
          for (const name of api.list()) {
            let store;
            try { store = api.use(name); } catch (_) { store = null; }
            if (!store) continue;
            list.push({ name, snapshot: _storeSnapshot(store), store });
          }
        }
        console.table(list.map((entry) => ({
          store: entry.name,
          state: _safeSerialise(entry.snapshot, 160)
        })));
        return list;
      },

      /** Inspect one MiniXStore store */
      store(name) {
        const api = typeof window !== 'undefined' ? window.MiniXStore : null;
        if (!api?.use) return null;
        let store;
        try { store = api.use(name); } catch (err) {
          console.warn(`[MiniX Debug] Store "${name}" not found.`, err);
          return null;
        }
        const snapshot = _storeSnapshot(store);
        console.groupCollapsed(`%c[MiniX Debug]%c store%c  ${name}`, CLR.plugin, '', CLR.label);
        console.log('%cState snapshot', 'font-weight:bold', snapshot);
        console.log('%cStore proxy', 'font-weight:bold', store);
        console.groupEnd();
        return { name, snapshot, store };
      },

      /** Inspect a tracked router */
      router(index = 0) {
        const router = [..._routers][Number(index) || 0];
        if (!router) {
          console.warn('[MiniX Debug] No MiniXRouter instance has been observed yet.');
          return null;
        }
        const snapshot = _routerSnapshot(router);
        console.groupCollapsed('%c[MiniX Debug]%c router', CLR.plugin, '');
        console.log('%cCurrent route', 'font-weight:bold', snapshot);
        console.log('%cRouter', 'font-weight:bold', router);
        console.groupEnd();
        return { snapshot, router };
      },

      /** Toggle flags at runtime */
      enable(flagsOrKey, value) {
        if (typeof flagsOrKey === 'string') {
          if (value !== undefined) {
            _defaultFlags[flagsOrKey] = value;
            console.log(`[MiniX Debug] flag "${flagsOrKey}" = ${value}. Takes effect on next component mount.`);
          } else {
            _defaultFlags[flagsOrKey] = !_defaultFlags[flagsOrKey];
            console.log(`[MiniX Debug] flag "${flagsOrKey}" toggled to ${_defaultFlags[flagsOrKey]}. Takes effect on next component mount.`);
          }
        } else if (typeof flagsOrKey === 'object') {
          Object.assign(_defaultFlags, flagsOrKey);
          console.log('[MiniX Debug] Flags updated:', { ..._defaultFlags });
        }
      },

      /** Show the panel if it was closed */
      showPanel() {
        if (!_panel) _createPanel();
      },

      /** Raw event log array */
      get log() { return _events; },

      /** Raw live component map */
      get registry() { return _liveComponents; },

      /** Raw tracked router set */
      get routers() { return _routers; },
    };

    console.log(
      `%c[MiniX Debug]%c Plugin v${PLUGIN_VERSION} installed.\n` +
      `  • window.MxDB.components()  — list live components\n` +
      `  • window.MxDB.inspect(name) — dump component state\n` +
      `  • window.MxDB.stores()      — list MiniXStore snapshots\n` +
      `  • window.MxDB.router()      — inspect MiniXRouter route\n` +
      `  • window.MxDB.events()      — tail event log\n` +
      `  • window.MxDB.showPanel()   — re-open debug panel`,
      CLR.plugin, CLR.muted
    );
  }

  // ─── Plugin factory ─────────────────────────────────────────────────────────

  let _installCount = 0;
  let _compIdSeq    = 0;   // dedicated counter for unique component IDs
  const _installedApps = new Set();

  function plugin(userOptions = {}) {
    const flags = { ..._defaultFlags, ...userOptions };

    return _definePlugin({
      name:    PLUGIN_NAME,
      version: PLUGIN_VERSION,

      install(app) {
        // Guard against double-install on the same app
        if (app.__minixDebugInstalled) return;
        app.__minixDebugInstalled = true;
        _installedApps.add(app);
        _installCount++;

        // ── Apply global Compiler patches (once per page) ──────────────────
        _installGlobalPatches(flags);
        _hookMiniXStore();

        // ── Console bridge (once per page) ─────────────────────────────────
        if (typeof window !== 'undefined' && !window.MxDB) {
          _installConsoleBridge();
        }

        // ── In-page panel ──────────────────────────────────────────────────
        if (flags.panel && typeof document !== 'undefined') {
          if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', _createPanel, { once: true });
          } else {
            _createPanel();
          }
        }

        // ── Per-component instrumentation ──────────────────────────────────
        //
        // addInstanceAPI runs inside _bindCoreAPIs() before created(), giving
        // us the earliest possible hook into the component's lifecycle.
        //
        app.addInstanceAPI((component) => {
          const compId = `${_componentLabel(component)}-${++_compIdSeq}`;
          _liveComponents.set(compId, component);
          _hookRouter(component.instance?.$router || component.instance?.router);

          // Patch updateProps to emit prop diffs
          if (flags.props && component.updateProps) {
            const origUpdateProps = component.updateProps.bind(component);
            component.updateProps = (nextProps, opts) => {
              const prevProps = { ...(component._propsSource || {}) };
              const result = origUpdateProps(nextProps, opts);
              _tracePropDiff(flags, _componentLabel(component), prevProps, nextProps);
              return result;
            };
          }

          // Return nothing — we only need side-effects, no new instance properties.
          return {};
        });

        // ── Lifecycle tracing via addScope (runs after every render) ────────
        //
        // We intercept _callHook instead of using addScope so lifecycle events
        // are captured at the component level, not the render scope level.
        //
        app.addScope((component) => {
          const name = _componentLabel(component);
          _hookStateRefresh(flags, component);

          // One-time hook wrapping per component instance
          if (!component.__minixDebugHooked && component._callHook) {
            component.__minixDebugHooked = true;
            const origCallHook = component._callHook.bind(component);

            component._callHook = (hookName, meta = {}) => {
              if (flags.lifecycle) {
                _traceLifecycle(flags, name, hookName, meta);
                _renderPanelEvents();
              }
              if (hookName === 'updated' || hookName === 'mounted' || hookName === 'created') {
                _refreshComponentsTabSoon();
              }

              // When the component is destroyed, remove it from the live registry
              if (hookName === 'unmounted') {
                for (const [id, comp] of _liveComponents) {
                  if (comp === component) { _liveComponents.delete(id); break; }
                }
                _refreshComponentsTabSoon();
              }

              return origCallHook(hookName, meta);
            };
          }

          return {}; // no scope additions needed
        });
      },
    });
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Uninstall: restores all patched methods.
   * Useful for test teardown or when switching to production mode at runtime.
   */
  function uninstall() {
    _restorePatches();
    _globalPatchesApplied = false;
    _installCount = 0;
    _compIdSeq = 0;
    for (const app of _installedApps) {
      try { delete app.__minixDebugInstalled; } catch (_) { app.__minixDebugInstalled = false; }
    }
    _installedApps.clear();
    _liveComponents.clear();
    _storeEvents.length = 0;
    _routerEvents.length = 0;
    _activeTab = 'events';
    for (const cleanup of _storeCleanups.values()) {
      try { cleanup?.(); } catch (_) {}
    }
    _storeCleanups.clear();
    _storeRefs.clear();
    for (const router of _routers) {
      const cleanup = _routerCleanups.get(router);
      try { cleanup?.(); } catch (_) {}
    }
    _routers.clear();
    if (typeof window !== 'undefined' && _storeDebugListener) {
      window.removeEventListener('minix-store:debug', _storeDebugListener);
    }
    _storeDebugListener = null;
    _storeDebugListenerInstalled = false;
    _storeOriginalDefine = null;
    _storeBridgePatched = false;
    if (_panel) { _panel.remove(); _panel = null; _panelEls = null; }
    if (typeof window !== 'undefined') delete window.MxDB;
    console.log('%c[MiniX Debug]%c Uninstalled.', CLR.plugin, CLR.muted);
  }

  /** Access the raw event log from outside the plugin */
  function getEvents(n) {
    return n ? _events.slice(-n) : _events.slice();
  }

  return { plugin, uninstall, getEvents };

})();

// ─── UMD export ──────────────────────────────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MiniX_Debug;
} else if (typeof window !== 'undefined') {
  window.MiniX_Debug = MiniX_Debug;
}
