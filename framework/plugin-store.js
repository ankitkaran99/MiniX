/**
 * mini-x-store.js — Global store plugin for MiniX
 *
 * ── Usage ────────────────────────────────────────────────────────────────────
 *
 *   // 1. Define stores — returns the live proxy directly
 *   const logStore     = MiniXStore.define('log',     { ... });
 *   const counterStore = MiniXStore.define('counter', { ... });
 *
 *   // 2. Install the plugin before mount
 *   MiniX.createApp(App)
 *     .use(MiniXStore.plugin())
 *     .mount('#app');
 *
 *   // 3. Declare which stores a component uses via stores()
 *   class MyComponent {
 *     stores() {
 *       return {
 *         log:     logStore,
 *         counter: counterStore,
 *       };
 *     }
 *
 *     someMethod() {
 *       this.$store('log').push('myComponent', 'hello');
 *       this.$store('counter').increment();
 *     }
 *
 *     mounted() {
 *       this.$store('counter').watch('count', (n, old) => {
 *         console.log('count changed', old, '->', n);
 *       });
 *     }
 *   }
 *
 *   // 4. Templates — $store() works identically in expressions
 *   //   {{ $store('counter').count }}
 *   //   {{ $store('counter').doubled }}
 *   //   <button @click="$store('counter').increment()">+</button>
 *
 *   // 5. Cross-store calls inside an action — just use the captured variable
 *   const logStore = MiniXStore.define('log', { ... });
 *
 *   MiniXStore.define('todos', {
 *     actions: {
 *       add() {
 *         // ...
 *         logStore.push('todos', `added "${text}"`);  // no string look-up needed
 *       }
 *     }
 *   });
 *
 *   // 6. Global helpers
 *   MiniXStore.use('counter');   // grab any store by name globally
 *   MiniXStore.destroy('counter');
 *   MiniXStore.destroyAll();
 *   MiniXStore.list();           // → ['log', 'counter', ...]
 */

'use strict';

const MiniXStore = (() => {

  // ─── Registry ──────────────────────────────────────────────────────────────
  /** @type {Map<string, StoreInstance>} */
  const _registry = new Map();

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Unwrap a MiniX reactive proxy to its raw object.
   * The __raw sentinel is set by MiniX_State; fall back to the proxy itself
   * for plain objects (e.g. during unit tests).
   *
   * @param {object} proxy
   * @returns {object}
   */
  const _raw = (proxy) => {
    if (!proxy || (typeof proxy !== 'object' && typeof proxy !== 'function')) return proxy;
    let raw;
    try {
      raw = proxy.__raw;
    } catch (_) {
      raw = undefined;
    }
    if (raw === proxy) {
      throw new Error('[MiniXStore] MiniX_State proxy returned itself for __raw; refusing recursive raw unwrap.');
    }
    return raw === undefined ? proxy : raw;
  };

  function _emitDebug(type, detail) {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
    try {
      const EventCtor = window.CustomEvent || (typeof CustomEvent !== 'undefined' ? CustomEvent : null);
      if (!EventCtor) return;
      window.dispatchEvent(new EventCtor('minix-store:debug', {
        detail: { type, timestamp: Date.now(), detail }
      }));
    } catch (_) {}
  }

  function _debugClone(value) {
    if (value == null || typeof value !== 'object') {
      if (typeof value === 'function') return `[Function: ${value.name || 'anonymous'}]`;
      if (typeof value === 'bigint') return String(value);
      return value;
    }
    try {
      return JSON.parse(JSON.stringify(value, (_key, current) => {
        if (typeof current === 'function') return `[Function: ${current.name || 'anonymous'}]`;
        if (current instanceof Map) return { __Map: [...current.entries()] };
        if (current instanceof Set) return { __Set: [...current.values()] };
        if (current && current.nodeType) return `[Node: ${current.nodeName || 'unknown'}]`;
        return current;
      }));
    } catch (_) {
      try { return String(value); } catch (__) { return '[Unserializable]'; }
    }
  }

  function _canEmitDebug() {
    return typeof window !== 'undefined' &&
      typeof window.dispatchEvent === 'function' &&
      Boolean(window.CustomEvent || (typeof CustomEvent !== 'undefined' ? CustomEvent : null));
  }

  function _definePlugin(definition) {
    const PluginCtor = (typeof MiniX_Plugin !== 'undefined' ? MiniX_Plugin : null);
    return PluginCtor && typeof PluginCtor.define === 'function'
      ? PluginCtor.define(definition)
      : definition;
  }

  // ─── Internal store factory ────────────────────────────────────────────────

  function _createStore(name, def) {
    // 1. Reactive state
    const rawState = (typeof def.state === 'function' ? def.state() : def.state) || {};
    const state = new MiniX_State(rawState);
    let stateProxy = state.raw();

    // 2. Watcher cleanups + destroyed flag.
    //
    // _destroyed lets individual cleanup closures skip their O(n)
    // indexOf+splice self-removal when the whole store is being torn down
    // (destroy() already zeroes the array before invoking the callbacks).
    const _watcherCleanups = new Set();
    let _destroyed = false;

    // 3. Action context — "this" inside every action
    const actionCtx = Object.create(null);
    const _wiredStateKeys = new Set();

    // Memoised ownKeys result — invalidated by _syncStateGetters whenever the
    // top-level state shape changes. Avoids allocating three arrays + a Set on
    // every Proxy ownKeys trap call (triggered by Object.keys, spread, devtools,
    // JSON.stringify, etc.).
    let _ownKeysCache = null;

    // OPT: cache the raw unwrap once — stateProxy is fixed for the store's
    // lifetime, so _raw() never needs to be called in hot paths.
    // Declared here (before _syncStateGetters) so both the sync helper and
    // all proxy trap handlers can share the same reference.
    let _stateRaw = _raw(stateProxy) || {};
    let _builtins = null;

    const _refreshStateRefs = () => {
      stateProxy = state.raw();
      _stateRaw = _raw(stateProxy) || {};
      if (_builtins) _builtins.$state = stateProxy;
      _ownKeysCache = null;
    };

    // Keep actionCtx in lock-step with the current top-level state shape.
    // This fixes stale getters after $reset() and lets $patch/$merge add keys.
    //
    // Stale keys are collected into a plain array before deletion so we never
    // mutate _wiredStateKeys while iterating it (some engines mis-handle
    // mid-iteration Set mutation even though the spec permits it).
    const _syncStateGetters = () => {
      const rawKeys = Object.keys(_stateRaw);
      // OPT: bail early when there are no wired keys and no incoming keys —
      // avoids allocating a Set on the very common steady-state call.
      if (rawKeys.length === 0 && _wiredStateKeys.size === 0) return;

      const liveKeys = new Set(rawKeys);
      let shaped = false; // did the key-set actually change?

      for (const key of rawKeys) {
        if (_wiredStateKeys.has(key)) continue;

        // Don't let late-added state keys overwrite helpers/actions already
        // installed on actionCtx. Public proxy resolution still exposes the
        // state key via store[key], but inside actions reserved/action names
        // keep their higher-priority meaning.
        if (Object.prototype.hasOwnProperty.call(actionCtx, key)) continue;

        shaped = true;
        Object.defineProperty(actionCtx, key, {
          get: ()  => stateProxy[key],
          set: (v) => { stateProxy[key] = v; },
          enumerable:   true,
          configurable: true,
        });
        _wiredStateKeys.add(key);
      }

      // OPT: single-pass stale-key removal — collect and delete in one iteration
      // over _wiredStateKeys, eliminating the intermediate staleKeys[] array and
      // the second for-loop. Keys not in liveKeys are deleted immediately after
      // being pushed so we never revisit them.
      for (const key of _wiredStateKeys) {
        if (!liveKeys.has(key)) {
          shaped = true;
          delete actionCtx[key];
          _wiredStateKeys.delete(key);
        }
      }

      if (shaped) _ownKeysCache = null; // invalidate memoised ownKeys
    };
    _syncStateGetters();


    const _preSyncTopLevelPath = (path) => {
      if (typeof path !== 'string') return;
      // OPT: indexOf+slice avoids allocating a split array just to read [0].
      const dot = path.indexOf('.');
      const root = dot === -1 ? path : path.slice(0, dot);
      if (!root || _wiredStateKeys.has(root)) return;
      if (Object.prototype.hasOwnProperty.call(actionCtx, root)) return;
      Object.defineProperty(actionCtx, root, {
        get: ()  => stateProxy[root],
        set: (v) => { stateProxy[root] = v; },
        enumerable:   true,
        configurable: true,
      });
      _wiredStateKeys.add(root);
      _ownKeysCache = null;
    };

    // Core helpers available as this.$xxx inside actions
    actionCtx.$name  = name;
    // OPT: helpers are inlined rather than wrapped via _withSync's variadic
    // (...args) spread — each call now passes arguments positionally with zero
    // intermediate array allocation.
    actionCtx.$set   = (path, val) => {
      try {
        _preSyncTopLevelPath(path);
        return state.set(path, val);
      } finally {
        _syncStateGetters();
      }
    };
    actionCtx.$get   = (path, fb)  => state.get(path, fb);
    actionCtx.$batch = (fn) => {
      try {
        return state.batch(fn);
      } finally {
        _syncStateGetters();
      }
    };
    actionCtx.$patch = (path, fn) => {
      try {
        _preSyncTopLevelPath(path);
        return state.patch(path, fn);
      } finally {
        _syncStateGetters();
      }
    };
    actionCtx.$merge = (path, obj) => {
      try {
        _preSyncTopLevelPath(path);
        return state.merge(path, obj);
      } finally {
        _syncStateGetters();
      }
    };
    actionCtx.$reset = () => {
      const initial = (typeof def.state === 'function' ? def.state() : def.state) || {};
      state.reset(initial);
      _refreshStateRefs();
      // Mark all cached getters stale so the next read recomputes against
      // the fresh state rather than serving pre-reset values.
      for (const entry of _getterCache.values()) entry.fresh = false;
      _syncStateGetters();
    };

    // 4. Bound actions
    const _actions = {};
    // OPT: Object.keys + for...of is faster than for...in for plain objects
    // (no prototype chain walk; V8 can use a more direct codepath).
    const _actionDefs = def.actions || {};
    for (const key of Object.keys(_actionDefs)) {
      const fn = _actionDefs[key];
      if (typeof fn !== 'function') continue;
      const bound = (...args) => {
        const debug = _canEmitDebug();
        if (debug) _emitDebug('action:start', { store: name, action: key, args: _debugClone(args) });
        try {
          const result = fn.apply(actionCtx, args);
          if (result && typeof result.then === 'function') {
            return result.then(
              (value) => {
                if (debug) _emitDebug('action:finish', { store: name, action: key, result: _debugClone(value) });
                return value;
              },
              (error) => {
                if (debug) _emitDebug('action:error', { store: name, action: key, error: String(error?.message || error) });
                throw error;
              }
            );
          }
          if (debug) _emitDebug('action:finish', { store: name, action: key, result: _debugClone(result) });
          return result;
        } catch (error) {
          if (debug) _emitDebug('action:error', { store: name, action: key, error: String(error?.message || error) });
          throw error;
        }
      };
      _actions[key] = bound;
      actionCtx[key] = bound;  // sibling action calls: this.otherAction()
    }

    // 5. Getters — lazily computed, cached until a tracked state dep changes.
    //
    //    Subscribers are notified AFTER the new value is computed (not before).
    //    Previously the scheduler set dirty=true and immediately called
    //    eff.schedule() on all subscribers, so a template re-render triggered
    //    by that schedule would hit _readGetter() and still see the stale
    //    entry.value (because effect.run() hadn't happened yet).
    //    Now: recompute first → then wake subscribers.
    //
    //    The `dirty` flag is replaced with `fresh` (inverted sense) and the
    //    dead-code path is removed: _onDepChanged always recomputes eagerly, so
    //    `dirty` was permanently false after the first _readGetter call.
    //
    //    _onDepChanged guards against a stopped effect (destroyed store) and
    //    snapshots entry.subscribers before iterating so mid-loop deletions
    //    never cause entries to be skipped.
    const _getterCache = new Map();

    const _buildGetter = (key, fn) => {
      const entry = { value: undefined, fresh: false, subscribers: new Set() };
      const _onDepChanged = () => {
        // Guard: don't recompute if the effect was stopped by destroy().
        if (!entry.effect.active) return;

        // BUG FIX: Mark stale *before* running so that if effect.run() throws,
        // the next _readGetter call retries rather than serving the old value
        // with fresh=true still set from a prior successful run.
        entry.fresh = false;

        // Recompute synchronously so entry.value is fresh before we wake
        // any subscribers that might immediately re-read this getter.
        // BUG FIX: Only mark fresh=true after a *successful* run — if run()
        // throws, fresh stays false so the next read retries the computation.
        try {
          entry.effect.run();
          entry.fresh = true;
        } catch (err) {
          console.error(`[MiniXStore "${name}"] Getter "${key}" threw during recompute.`, err);
          // entry.fresh remains false; next _readGetter call will retry.
        }

        // OPT: reuse a single snapshot array rather than allocating a fresh one
        // on every dep change. Fill → iterate → truncate avoids GC churn on
        // stores with many watchers that update frequently.
        const subs = [];
        for (const eff of entry.subscribers) subs.push(eff);
        for (let i = 0; i < subs.length; i++) {
          const eff = subs[i];
          if (!eff.active) {
            entry.subscribers.delete(eff);
            continue;
          }
          if (eff._scheduled) continue;
          try {
            eff.schedule();
          } catch (err) {
            console.error(`[MiniXStore "${name}"] Getter subscriber schedule failed for "${key}".`, err);
          }
        }
      };

      entry.effect = new MiniX_Effect(
        () => {
          // Pass the reactive proxy to the getter fn, not the raw object.
          // The proxy's get trap calls _trackTargetEffect, so the effect
          // auto-subscribes to exactly the state keys the getter reads.
          entry.value = fn.call(actionCtx, stateProxy);
        },
        { lazy: true, scheduler: _onDepChanged }
      );

      _getterCache.set(key, entry);
      return entry;
    };

    const _getterDefs = def.getters || {};

    const _ensureGetter = (key) => {
      // OPT: one Map lookup instead of has() + get() on cache hit (common path).
      const cached = _getterCache.get(key);
      if (cached !== undefined) return cached;
      const fn = _getterDefs[key];
      if (typeof fn !== 'function') return undefined;
      return _buildGetter(key, fn);
    };

    const _readGetter = (key) => {
      const entry = _ensureGetter(key);
      if (!entry) return undefined;

      // Subscribe the currently-running template effect so it re-renders
      // when this getter's value changes.
      const active = MiniX_Effect.activeEffect;
      if (active) {
        entry.subscribers.add(active);
        if (!active.__minixStoreGetterDeps) {
          Object.defineProperty(active, '__minixStoreGetterDeps', {
            value: new Set(),
            configurable: true,
          });
          if (typeof active.stop === 'function' && !active.__minixStoreStopWrapped) {
            const originalStop = active.stop;
            active.stop = () => {
              const deps = active.__minixStoreGetterDeps;
              if (deps) {
                for (const subs of deps) subs.delete(active);
                deps.clear();
              }
              return originalStop.call(active);
            };
            Object.defineProperty(active, '__minixStoreStopWrapped', {
              value: true,
              configurable: true,
            });
          }
        }
        active.__minixStoreGetterDeps.add(entry.subscribers);
      }

      if (!entry.fresh) {
        try {
          entry.effect.run();
          entry.fresh = true;
        } catch (err) {
          console.error(`[MiniXStore "${name}"] Getter "${key}" threw during read.`, err);
          // entry.fresh stays false so the next read retries the computation.
        }
      }
      return entry.value;
    };

    // 7. watch(path, cb) — returns unsubscribe fn.
    //
    //    Declared before step 6 because _builtins references _storeWatch.
    //
    //    The cleanup closure nulls its own inner references after the first
    //    call (idempotent) so the store's state tree isn't kept alive by
    //    callers who hold the returned unsubscribe function after destroy().
    function _storeWatch(path, callback) {
      if (typeof callback !== 'function')
        throw new Error(`[MiniXStore "${name}"] watch() requires a callback function`);

      let innerCleanup = state.watch(path, callback);

      const cleanup = () => {
        if (!innerCleanup) return; // idempotent: safe to call more than once
        const ic = innerCleanup;
        innerCleanup = null; // release refs immediately

        // Skip O(n) self-removal when destroy() has already zeroed the array.
        if (!_destroyed) _watcherCleanups.delete(cleanup);
        ic();
      };

      _watcherCleanups.add(cleanup);
      return cleanup;
    }

    // 6. Public proxy  (action → getter → state → helpers)
    //
    //    _builtins stores direct value references (not thunks), so each get
    //    is a single property lookup with no extra call overhead.
    //    _RESERVED is derived from Object.keys(_builtins) so the two can never
    //    drift out of sync — adding a builtin automatically makes it reserved.
    //
    //    The set trap rejects writes to reserved names so callers can't
    //    silently overwrite built-in helpers (e.g. `store.$reset = null`).
    _builtins = {
      $state:   stateProxy,
      $name:    name,
      $reset:   actionCtx.$reset,
      $set:     actionCtx.$set,
      $get:     actionCtx.$get,
      $batch:   actionCtx.$batch,
      $patch:   actionCtx.$patch,
      $merge:   actionCtx.$merge,
      watch:    _storeWatch,
      snapshot: () => state.snapshot(), // factory: each call gets a fresh snap
    };
    const _RESERVED = new Set(Object.keys(_builtins));

    const _proxy = new Proxy(Object.create(null), {
      get(_, prop) {
        if (prop in _actions)       return _actions[prop];
        if (typeof prop === 'string' && prop in _getterDefs) return _readGetter(prop);

        // Read through the reactive proxy so MiniX_Effect.activeEffect is
        // registered as a subscriber — state.get() bypasses the proxy and
        // never calls _trackTargetEffect, breaking template reactivity.
        if (prop in _stateRaw) return stateProxy[prop];

        // Direct value lookup — no thunk call.
        if (_RESERVED.has(prop)) return _builtins[prop];

        return undefined;
      },

      set(_, prop, value) {
        if (_RESERVED.has(prop)) {
          console.warn(`[MiniXStore "${name}"] Ignoring write to reserved property "${prop}".`);
          return true; // must return true to avoid a strict-mode TypeError
        }
        if (typeof prop === 'string') _preSyncTopLevelPath(prop);
        stateProxy[prop] = value;
        _syncStateGetters();
        return true;
      },

      has(_, prop) {
        if (prop in _actions)       return true;
        // OPT: check _getterDefs only — _getterCache entries are always a
        // subset of _getterDefs so the redundant _getterCache.has() is removed.
        if (typeof prop === 'string' && prop in _getterDefs) return true;
        if (_RESERVED.has(prop)) return true;
        return prop in _stateRaw;
      },

      ownKeys() {
        if (_ownKeysCache) return _ownKeysCache;
        // The four key groups are kept disjoint by construction:
        // _RESERVED blocks state keys from overwriting builtins;
        // actions and getters are separate namespaces from state.
        // Build result directly without an intermediate seen-Set or closure.
        const stateKeys   = Object.keys(_stateRaw);
        const actionKeys  = Object.keys(_actions);
        const getterKeys  = Object.keys(_getterDefs);
        const reservedArr = [..._RESERVED];
        // Deduplicate only across boundaries — state vs the rest.
        const seen = new Set();
        const result = [];
        for (const group of [stateKeys, actionKeys, getterKeys, reservedArr]) {
          for (const key of group) {
            if (seen.has(key)) continue;
            seen.add(key);
            result.push(key);
          }
        }
        _ownKeysCache = result;
        return result;
      },

      deleteProperty(_, prop) {
        if (_RESERVED.has(prop) || prop in _actions || (typeof prop === 'string' && prop in _getterDefs)) {
          console.warn(`[MiniXStore "${name}"] Ignoring delete for protected property "${String(prop)}".`);
          return true;
        }
        if (!(prop in _stateRaw)) return true;
        state.delete(prop);
        _syncStateGetters();
        return true;
      },

      getOwnPropertyDescriptor(_, prop) {
        if (prop in _actions)
          return { configurable: true, enumerable: true, writable: true, value: _actions[prop] };
        if (typeof prop === 'string' && prop in _getterDefs)
          return { configurable: true, enumerable: true, writable: true, value: _readGetter(prop) };
        if (_RESERVED.has(prop))
          return { configurable: true, enumerable: false, writable: false, value: _builtins[prop] };
        if (prop in _stateRaw)
          return { configurable: true, enumerable: true, writable: true, value: stateProxy[prop] };
        return undefined;
      },
    });

    // 8. Register
    const instance = {
      name, state, _actions, _getterCache, _proxy, _watcherCleanups, actionCtx, def,
      destroy() {
        // Set _destroyed before invoking cleanups so each cleanup's self-removal
        // branch (indexOf + splice) is skipped — the array is already zeroed.
        _destroyed = true;
        // OPT: pre-size the snapshot array — avoids repeated realloc as the
        // spread iterator grows the array one slot at a time.
        const cleanups = new Array(_watcherCleanups.size);
        let ci = 0;
        for (const fn of _watcherCleanups) cleanups[ci++] = fn;
        _watcherCleanups.clear();
        for (const fn of cleanups) fn();

        for (const entry of _getterCache.values()) entry.effect?.stop();
        _getterCache.clear();
        _ownKeysCache = null;
        _registry.delete(name);
      },
    };

    _registry.set(name, instance);
    return _proxy;
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Define and register a store.
   * Returns the live store proxy — assign it to a module-level variable,
   * then pass it into components via stores().
   *
   * @param {string} name
   * @param {object} def  { state, getters, actions }
   * @returns {StoreProxy}
   */
  function define(name, def = {}) {
    if (!name || typeof name !== 'string')
      throw new Error('[MiniXStore] define() requires a name string');
    def = def || {};
    if (_registry.has(name)) {
      console.warn(`[MiniXStore] Store "${name}" already defined — returning existing instance.`);
      return _registry.get(name)._proxy;
    }
    return _createStore(name, def);
  }

  /**
   * Retrieve a store proxy by name — global escape hatch.
   * Prefer the variable returned by define(), or this.$store() inside components.
   *
   * @param {string} name
   * @returns {StoreProxy}
   */
  function use(name) {
    const inst = _registry.get(name);
    if (!inst)
      throw new Error(`[MiniXStore] Store "${name}" not found. Did you call MiniXStore.define() first?`);
    return inst._proxy;
  }

  /** Destroy a store — stops all effects and removes it from the registry. */
  function destroy(name) {
    const inst = _registry.get(name);
    if (inst) inst.destroy();
  }

  /**
   * Destroy all stores.
   * Snapshots the registry values before iterating so that each inst.destroy()
   * (which calls _registry.delete internally) doesn't mutate the Map mid-loop.
   */
  function destroyAll() {
    const instances = [..._registry.values()];
    for (const inst of instances) inst.destroy();
  }

  /** Returns all currently registered store names. */
  function list() { return [..._registry.keys()]; }

  /**
   * Returns the MiniX plugin object to pass to app.use().
   *
   * Uses app.addInstanceAPI() — MiniX's official pre-created() injection point —
   * to assign this.$store onto every component instance before created() fires.
   * addScope() is also called so $store works in template expressions too.
   *
   * @returns {PluginDefinition}
   */
  function plugin() {
    return _definePlugin({
      name: 'mini-x-store',
      version: '1.1.0',

      install(app) {
        if (app.__minixStoreInstalled) return;
        app.__minixStoreInstalled = true;

        // ── addInstanceAPI: runs inside _bindCoreAPIs(), before created() ────
        //
        // The factory receives (component, instance) and returns an object whose
        // keys are Object.assign-ed onto the instance — exactly like $watch,
        // $nextTick, and every other built-in $ property.
        app.addInstanceAPI((component, instance) => {
          // Cache the stores() map lazily — evaluated at most once per instance.
          // Uses a boolean sentinel rather than a null check so that a stores()
          // returning null doesn't cause infinite re-evaluation.
          let _localMapReady = false;
          let _localMap = {};
          const _getLocalMap = () => {
            if (_localMapReady) return _localMap;
            _localMapReady = true;
            const map = (typeof instance.stores === 'function')
              ? (instance.stores() || {})
              : {};
            _localMap = (map && typeof map === 'object') ? map : {};
            return _localMap;
          };

          return {
            $store(name) {
              // 1. Component's own stores() declaration
              // OPT: `in` is sufficient — _localMap is always a fresh plain
              // object (stores() return or {}), so inherited keys can't collide.
              const map = _getLocalMap();
              if (Object.prototype.hasOwnProperty.call(map, name)) return map[name];

              // 2. Global registry fallback
              const inst = _registry.get(name);
              if (inst) return inst._proxy;

              console.warn(
                `[MiniXStore] $store('${name}') not found. ` +
                `Add it to stores() or call MiniXStore.define('${name}', ...) first.`
              );
              return undefined;
            }
          };
        });

        // ── addScope: expose $store in template expression scope ─────────────
        //
        // Scope factories run during rendering (after created()), but by then
        // $store is already on the instance from addInstanceAPI above.
        // We re-expose it here so {{ $store('x').y }} works in templates.
        app.addScope((component) => {
          const instance = component && component.instance;
          // OPT: $store closes over _getLocalMap and _registry directly and
          // never reads `this`, so .bind(instance) only wastes a new function
          // allocation on every render. Reference it directly.
          return {
            $store: instance && typeof instance.$store === 'function'
              ? instance.$store
              : () => undefined
          };
        });
      },
    });
  }

  return { define, use, destroy, destroyAll, list, plugin };

})();

// UMD-style export — plain <script>, ES module, or CommonJS
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MiniXStore;
} else if (typeof window !== 'undefined') {
  window.MiniXStore = MiniXStore;
}
