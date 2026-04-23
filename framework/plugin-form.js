/**
 * MiniX Validate + Ajax Plugins
 *
 * v13.2.0
 *
 * Bug fixes & optimisations over v12.0.0
 * ───────────────────────────────────────
 * [FIX-1]  …[FIX-92] / [OPT-1]…[OPT-17] — see prior versions.
 *
 * New in v13.2.0
 * ──────────────
 * [FIX-105] normalizeErrors: when inferRawErrors returns _EMPTY_RAW (no errors
 *           found), the guard passed because _EMPTY_RAW is a truthy non-array
 *           object. normalizeErrors then allocated a new object and ran N
 *           hasOwnProperty calls that all returned false. Added _EMPTY_RAW
 *           identity check to the guard so empty-raw short-circuits immediately.
 * [FIX-106] x-validate: failedErrors was built inside an IIFE, allocating and
 *           immediately discarding a function object at every directive mount.
 *           Replaced with a plain loop that builds the object directly.
 * [FIX-112] parseTriggerList: null input (from getAttribute returning null)
 *           took the string-coercion path before reaching the early-return.
 *           Added an upfront null/undefined check that returns _EMPTY_TRIGGERS
 *           immediately, avoiding all string work.
 * [OPT-18]  firstMessage object branch: Object.keys(value) was called even when
 *           value only contained the already-checked keys (message/error/text),
 *           allocating an array whose entries were all immediately skipped. Added
 *           a fast-exit: if Object.keys reports no keys beyond the three already
 *           checked, the loop is skipped and null returned without the array scan.
 */

(function (global) {
    'use strict';

    let FORM_UID = 0;

    // [OPT-1] Shared no-op — avoids allocating a new async fn per handler slot.
    const NOOP_ASYNC = async function () {};

    // [FIX-83] Shared no-op teardown — avoids allocating () => {} per failed mount.
    const _NOOP_CLEANUP = () => {};

    // [OPT-2] Reused tag set — avoids rebuilding ['INPUT','SELECT','TEXTAREA'] on every event.
    const FIELD_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA']);

    // [FIX-76/77] Shared empty-errors stub for teardown fallback and scope callback.
    const _ERRORS_STUB = Object.freeze({});

    // [FIX-81] Frozen headers object — avoids allocating a new object per submission.
    const _XHR_HEADERS = Object.freeze({ 'X-Requested-With': 'XMLHttpRequest' });

    // ─── Utilities ────────────────────────────────────────────────────────────

    function getCompiler(app) {
        return app?.options?.compiler ?? app?.compiler ?? null;
    }

    function definePlugin(definition) {
        const MiniXPlugin = global?.MiniX_Plugin || (typeof MiniX_Plugin !== 'undefined' ? MiniX_Plugin : null);
        return MiniXPlugin && typeof MiniXPlugin.define === 'function'
            ? MiniXPlugin.define(definition)
            : definition;
    }

    function isFormElement(el) {
        return !!el && el.tagName === 'FORM';
    }

    function defineGetter(target, key, getter) {
        if (!target) return;
        try {
            Object.defineProperty(target, key, {
                get: getter,
                enumerable: true,
                configurable: true,
            });
        } catch (_) {}
    }

    // [FIX-64] Reused empty-triggers sentinel — avoids allocating [] per absent attribute.
    const _EMPTY_TRIGGERS = Object.freeze([]);

    // [FIX-52/91/112] Early-returns for absent/null/empty; fast-path for strings.
    function parseTriggerList(raw) {
        if (raw == null) return _EMPTY_TRIGGERS;
        const s = (typeof raw === 'string' ? raw : String(raw)).trim();
        if (!s) return _EMPTY_TRIGGERS;
        const seen = new Set(['submit']); // pre-seed to filter 'submit' in one pass
        const out = [];
        const parts = s.split('|');
        for (let i = 0; i < parts.length; i++) {
            const t = parts[i].trim().toLowerCase();
            if (t && !seen.has(t)) { seen.add(t); out.push(t); }
        }
        return out;
    }

    // [FIX-59] Frozen so callers mutating the returned eventMap can't corrupt it.
    const _EMPTY_CONFIG = Object.freeze(Object.create(null));

    // [FIX-61] Module-level frozen sentinel for network errors avoids per-throw allocation.
    const _NETWORK_ERROR_RESPONSE = Object.freeze({
        ok: false, status: 0, statusText: 'NetworkError',
        headers: Object.freeze({ get: () => null }),
    });

    function safeParseAjaxConfig(expression) {
        let raw;
        if (expression && typeof expression === 'object' && !Array.isArray(expression)) {
            raw = expression;
        } else {
            // [FIX-58/92] Cache the trimmed string. Fast-path when already a string.
            const trimmed = expression
                ? (typeof expression === 'string' ? expression.trim() : String(expression).trim())
                : '';
            if (!trimmed) return _EMPTY_CONFIG;
            try {
                const parsed = new Function(`return (${trimmed});`)();
                raw = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
            } catch (error) {
                console.warn('[x-ajax] Invalid config expression:', expression, error);
                return _EMPTY_CONFIG;
            }
            if (!raw) return _EMPTY_CONFIG;
        }
        // [FIX-24] Contain __proto__ pollution. [FIX-29/35] Always copy compiler
        // objects; skip copy only for fresh null-prototype objects from string eval.
        if (Object.getPrototypeOf(raw) === null && typeof expression !== 'object') return raw;
        const safe = Object.create(null);
        const keys = Object.keys(raw);
        for (let i = 0; i < keys.length; i++) safe[keys[i]] = raw[keys[i]];
        return safe;
    }

    const _bindCache = new WeakMap();

    // [FIX-72] Cache stores { bound, original } objects instead of stamping an
    //          expando property on the bound function — avoids V8 IC deoptimisation.
    function resolveMethod(instance, name) {
        if (!instance || name == null) return null;
        if (typeof name !== 'string') {
            console.warn('[x-ajax] Handler config value must be a method name string, got:', typeof name, name);
            return null;
        }
        const fn = instance[name];
        if (typeof fn !== 'function') return null;
        let instanceCache = _bindCache.get(instance);
        if (!instanceCache) { instanceCache = Object.create(null); _bindCache.set(instance, instanceCache); }
        const entry = instanceCache[name];
        if (!entry || entry.original !== fn) {
            instanceCache[name] = { bound: fn.bind(instance), original: fn };
        }
        return instanceCache[name].bound;
    }

    // [FIX-47] Module-level helpers — capture nothing from directive scope.
    function _defineMethod(target, key, fn) {
        if (!target) return;
        try {
            Object.defineProperty(target, key, {
                value: fn, writable: true, enumerable: false, configurable: true,
            });
        } catch (_) {}
    }

    const _INSTANCE_PROPS = ['$errors', '$validate', '$validateForm', '$clearErrors'];
    function _removeInstanceProps(target) {
        if (!target) return;
        for (let i = 0; i < _INSTANCE_PROPS.length; i++) {
            const p = _INSTANCE_PROPS[i];
            try {
                if (!delete target[p]) {
                    // delete returned false: property is non-configurable.
                    // [FIX-55/76] writable:true; _ERRORS_STUB reused instead of fresh {}.
                    Object.defineProperty(target, p, {
                        value: p === '$errors' ? _ERRORS_STUB : undefined,
                        writable: true, configurable: true,
                    });
                }
            } catch (_) {}
        }
    }

    /**
     * Returns the first human-readable error message found inside `value`,
     * or null if `value` represents a passing / empty state.
     *
     * [FIX-1] `true`  → null  (pass signal, not an error)
     * [FIX-2] Circular-reference guard via WeakSet (_seen)
     * [FIX-3] Fallback 'Invalid value.' only fires for genuine error sentinels
     */
    function firstMessage(value, _seen) {
        if (value == null) return null;

        if (typeof value === 'string') return value.trim() || null;

        // [FIX-1] true is a valid/pass signal — must not produce an error message.
        if (value === true)  return null;
        if (value === false) return 'Invalid value.';

        if (typeof value === 'object') {
            // [FIX-2] Guard against circular references.
            if (!_seen) _seen = new WeakSet();
            if (_seen.has(value)) return null;
            _seen.add(value);

            if (Array.isArray(value)) {
                // [FIX-13] Single pass: collect messages AND detect primitive sentinels
                //          simultaneously, halving iterations vs the original two-pass.
                let hasSentinel = false;
                for (let i = 0; i < value.length; i++) {
                    const v = value[i];
                    const msg = firstMessage(v, _seen);
                    if (msg) return msg;
                    if (!hasSentinel && v !== null && v !== undefined && v !== true && typeof v !== 'object') {
                        hasSentinel = true;
                    }
                }
                return hasSentinel ? 'Invalid value.' : null;
            }

            // Check common message keys first.
            const msg =
                firstMessage(value.message, _seen) ||
                firstMessage(value.error,   _seen) ||
                firstMessage(value.text,    _seen);
            if (msg) return msg;

            // Scan remaining keys; only fire fallback for genuine primitive sentinels.
            const keys = Object.keys(value);
            // [OPT-18] Fast-exit: if all own keys are the three already checked,
            //          the loop below would skip every entry and return null anyway.
            const knownCount = (value.message !== undefined ? 1 : 0)
                             + (value.error   !== undefined ? 1 : 0)
                             + (value.text    !== undefined ? 1 : 0);
            if (keys.length <= knownCount) return null;
            let hasValue = false;
            for (let i = 0; i < keys.length; i++) {
                const k = keys[i];
                if (k === 'message' || k === 'error' || k === 'text') continue;
                const v = value[k];
                const m = firstMessage(v, _seen);
                if (m) return m;
                if (v !== null && v !== undefined && v !== true && typeof v !== 'object') {
                    hasValue = true;
                }
            }
            return hasValue ? 'Invalid value.' : null;
        }

        return String(value);
    }

    // [OPT-11/17] Accept the caller's dedup Set (reused as fieldSet) or null.
    //             When null, a local Set is used for dedup and discarded after.
    function createFieldList(fieldRules, fieldSet) {
        const seen = fieldSet || new Set();
        const out = [];
        for (let i = 0; i < fieldRules.length; i++) {
            const rule = fieldRules[i];
            if (!rule || !rule.field || seen.has(rule.field)) continue;
            seen.add(rule.field);
            out.push(rule.field);
        }
        return out;
    }

    function createEmptyErrors(fields) {
        const out = Object.create(null);
        for (let i = 0; i < fields.length; i++) out[fields[i]] = null;
        return out;
    }

    // [FIX-63] Module-level constant avoids allocating {} on every no-error path.
    const _EMPTY_RAW = Object.freeze(Object.create(null));

    // [FIX-44/53/105] Iterate fields directly.
    // [FIX-67]  Guard before createEmptyErrors() allocation.
    // [FIX-105] Identity check for _EMPTY_RAW avoids N wasted hasOwnProperty calls.
    function normalizeErrors(rawErrors, fields) {
        if (!rawErrors || rawErrors === _EMPTY_RAW ||
                typeof rawErrors !== 'object' || Array.isArray(rawErrors)) {
            return createEmptyErrors(fields);
        }
        const normalized = createEmptyErrors(fields);
        for (let i = 0; i < fields.length; i++) {
            const field = fields[i];
            if (Object.prototype.hasOwnProperty.call(rawErrors, field)) {
                normalized[field] = firstMessage(rawErrors[field]);
            }
        }
        return normalized;
    }

    // [FIX-68] Optional 4th param `fields` lets callers avoid the Object.keys() call.
    function inferValidationResult(result, inspect, normalizedErrors, fields) {
        if (typeof result === 'boolean') return result;

        if (result && typeof result === 'object') {
            if (typeof result.valid   === 'boolean') return result.valid;
            if (typeof result.passes  === 'boolean') return result.passes;
            if (typeof result.ok      === 'boolean') return result.ok;
            if (typeof result.success === 'boolean') return result.success;
            if (typeof result.isValid === 'boolean') return result.isValid;
        }

        if (inspect && typeof inspect.isValid === 'function') {
            try { return !!inspect.isValid(); } catch (_) {}
        }

        // [FIX-68] Use pre-known fields array when available — no Object.keys() alloc.
        if (fields) {
            for (let i = 0; i < fields.length; i++) {
                if (normalizedErrors[fields[i]] != null) return false;
            }
        } else {
            const ks = Object.keys(normalizedErrors);
            for (let i = 0; i < ks.length; i++) {
                if (normalizedErrors[ks[i]] != null) return false;
            }
        }
        return true;
    }

    // [FIX-5] Arrays explicitly excluded — typeof [] === 'object' is true.
    // [FIX-63] Returns _EMPTY_RAW constant instead of allocating {} each call.
    function inferRawErrors(result, inspect) {
        if (
            result && typeof result === 'object' && !Array.isArray(result) &&
            result.errors && typeof result.errors === 'object' && !Array.isArray(result.errors)
        ) {
            return result.errors;
        }
        if (inspect) {
            if (inspect.errors && typeof inspect.errors === 'object' && !Array.isArray(inspect.errors)) {
                return inspect.errors;
            }
            if (typeof inspect.getErrors === 'function') {
                try {
                    const got = inspect.getErrors();
                    if (got && typeof got === 'object' && !Array.isArray(got)) return got;
                } catch (_) {}
            }
        }
        return _EMPTY_RAW;
    }

    /**
     * Returns a Proxy that reads field errors live from component.state.
     *
     * [OPT-5] The defineProperty loop on the raw target is removed — the Proxy
     *         get-trap intercepts all field reads before descriptors fire.
     * [FIX-6] set-trap returns true (not false) to avoid TypeError in strict mode.
     * [FIX-7] getOwnPropertyDescriptor now provides a `value` field.
     * [OPT-6] ownKeys returns the frozen array reference directly.
     */
    // [FIX-54] fieldSet param removed — it was never read inside this function
    //          after FIX-45 replaced all Proxy trap uses with fieldIndex.
    function createReactiveErrors(component, errorStateKey, fields, fieldKeys) {
        if (!fieldKeys) {
            fieldKeys = new Array(fields.length);
            for (let i = 0; i < fields.length; i++) fieldKeys[i] = `${errorStateKey}.${fields[i]}`;
        }
        const fieldIndex = new Map();
        for (let i = 0; i < fields.length; i++) fieldIndex.set(fields[i], i);

        const target = Object.create(null);

        Object.defineProperty(target, 'toJSON', {
            value() {
                const out = Object.create(null);
                for (let i = 0; i < fields.length; i++) {
                    out[fields[i]] = component.state.get(fieldKeys[i], null);
                }
                return out;
            },
            enumerable: false, configurable: false,
        });

        const iteratorFn = function* () {
            for (let i = 0; i < fields.length; i++) {
                yield [fields[i], component.state.get(fieldKeys[i], null)];
            }
        };

        return new Proxy(target, {
            get(obj, prop, receiver) {
                if (prop === Symbol.toStringTag) return 'MiniXErrors';
                if (prop === Symbol.iterator)    return iteratorFn;
                if (typeof prop === 'string') {
                    const idx = fieldIndex.get(prop);
                    if (idx !== undefined) return component.state.get(fieldKeys[idx], null);
                }
                return Reflect.get(obj, prop, receiver);
            },
            set()            { return true; },
            deleteProperty() { return true; },
            has(_obj, prop) {
                return typeof prop === 'string' && fieldIndex.has(prop);
            },
            ownKeys() { return fields; },
            getOwnPropertyDescriptor(_obj, prop) {
                if (typeof prop === 'string') {
                    const idx = fieldIndex.get(prop);
                    if (idx !== undefined) {
                        return { enumerable: true, configurable: true,
                                 value: component.state.get(fieldKeys[idx], null) };
                    }
                }
                return undefined;
            },
        });
    }

    // [FIX-17] The installed-sentinel is cleared via app.onUnmount() when available,
    //          so a destroy-and-remount cycle correctly re-installs the scope.
    // [FIX-34] The scope callback is now unregistered on unmount via app.removeScope()
    //          if available, so it doesn't accumulate across remounts.
    function exposeScope(app) {
        if (!app || typeof app.addScope !== 'function' || app.__minix_form_scope_installed__) return;
        // [FIX-60] Verify the sentinel write succeeded before registering the scope.
        // On proxied/sealed app objects the write may silently fail, causing the
        // guard to never read true and the scope to be re-registered on every call.
        try { app.__minix_form_scope_installed__ = true; } catch (_) { return; }
        if (!app.__minix_form_scope_installed__) return;

        const scopeHandle = app.addScope((component) => {
            const instance = component?.instance;
            if (!instance) return null;
            return {
                get $errors()       { return instance.$errors || _ERRORS_STUB; },
                get $validate()     { return instance.$validate; },
                get $validateForm() { return instance.$validateForm; },
                get $clearErrors()  { return instance.$clearErrors; },
            };
        });

        if (typeof app.onUnmount === 'function') {
            app.onUnmount(() => {
                delete app.__minix_form_scope_installed__;
                // [FIX-34] Remove the scope registration if the API supports it.
                if (scopeHandle && typeof app.removeScope === 'function') {
                    try { app.removeScope(scopeHandle); } catch (_) {}
                }
            });
        }
    }

    // ─── Validate Plugin ──────────────────────────────────────────────────────

    const MiniXValidatePlugin = definePlugin({
        name:    'minix-validate',
        version: '13.2.0',

        install(app) {
            exposeScope(app);

            const compiler = getCompiler(app);
            if (!compiler) return;

            compiler.directive('x-validate', ({ el, component }) => {
                if (!isFormElement(el)) {
                    console.warn('[x-validate] Must be used on a <form>.');
                    return _NOOP_CLEANUP;
                }

                const instance    = component.instance;
                const rawInstance = instance?.__raw ?? instance;

                if (typeof global.Inspect !== 'function') {
                    console.warn('[x-validate] Inspect.js not found on window.');
                    return _NOOP_CLEANUP;
                }

                if (typeof instance?.rules !== 'function') {
                    console.warn('[x-validate] Component must provide rules().');
                    return _NOOP_CLEANUP;
                }

                const fieldRules = instance.rules() || [];

                // [OPT-17] Parse triggers BEFORE building fieldSet. fieldSet is only
                //          needed by triggerHandler; when no triggers exist (the common
                //          case) we skip its allocation entirely.
                const triggers = parseTriggerList(el.getAttribute('x-validate-on'));

                // [OPT-11] If triggers exist, pass a Set into createFieldList so it
                //          doubles as the dedup guard — no second Set allocation needed.
                //          If not, pass null and createFieldList uses its own local dedup.
                const fieldSet = triggers.length ? new Set() : null;
                const fields   = Object.freeze(createFieldList(fieldRules, fieldSet));
                const formId        = ++FORM_UID;
                const errorStateKey = `__minixFormErrors_${formId}`;

                // [OPT-12] Pre-compute the per-field dotted state keys once so
                //          commitErrors() never allocates template-literal strings
                //          at validation time (N fields × M validation runs saved).
                const fieldKeys = new Array(fields.length);
                for (let i = 0; i < fields.length; i++) {
                    fieldKeys[i] = `${errorStateKey}.${fields[i]}`;
                }

                let validationRunId        = 0;
                let lastAppliedValidationId = 0;
                let isSubmitting            = false;

                // [FIX-8] Hoisted here to avoid TDZ ReferenceError — both are used
                //         inside closures defined further below.
                const cleanups = [];
                let _validating = false;

                // [OPT-4] Single batch for setup; [OPT-10] frozen template object.
                const emptyErrors = Object.freeze(createEmptyErrors(fields));
                // [OPT-15/FIX-106] Pre-build the "all fields failed" object once.
                // Plain loop replaces the IIFE, which allocated a function object.
                const _failedErrorsObj = Object.create(null);
                for (let i = 0; i < fields.length; i++) _failedErrorsObj[fields[i]] = 'Validation failed.';
                const failedErrors = Object.freeze(_failedErrorsObj);
                component.state.batch(() => {
                    component.state.set(errorStateKey, emptyErrors);
                    for (let i = 0; i < fields.length; i++) {
                        component.state.set(fieldKeys[i], null);
                    }
                });

                const reactiveErrors = createReactiveErrors(component, errorStateKey, fields, fieldKeys);
                const getErrors      = () => reactiveErrors;

                const commitErrors = (nextErrors) => {
                    component.state.batch(() => {
                        component.state.set(errorStateKey, nextErrors);
                        for (let i = 0; i < fields.length; i++) {
                            // [OPT-12/16] Pre-computed key; ?? null removed — values are
                            // always string | null, never undefined.
                            component.state.set(fieldKeys[i], nextErrors[fields[i]]);
                        }
                    });
                    return reactiveErrors;
                };

                const clearErrors = () => {
                    // [OPT-14] createEmptyErrors is a single loop — faster than
                    // Object.assign(Object.create(null), emptyErrors) and equally safe.
                    commitErrors(createEmptyErrors(fields));
                    return reactiveErrors;
                };

                const inspect = new global.Inspect({ errorHandler: () => {} });
                inspect.init(el, fieldRules);

                const runValidation = async () => {
                    const runId = ++validationRunId;
                    let result;

                    try {
                        result = await inspect.validate();
                    } catch (error) {
                        console.warn('[x-validate] validate() failed:', error);
                        if (runId < lastAppliedValidationId) return false;
                        lastAppliedValidationId = runId;
                        // [OPT-15] Reuse pre-built frozen object — no per-throw allocation.
                        // commitErrors needs a mutable copy because state may mutate it.
                        commitErrors(Object.assign(Object.create(null), failedErrors));
                        return false;
                    }

                    if (runId < lastAppliedValidationId) {
                        // [FIX-56] Direct indexed loop over fields — avoids triggering
                        // Proxy ownKeys + prototype-chain traversal via for...in.
                        for (let i = 0; i < fields.length; i++) {
                            if (reactiveErrors[fields[i]] != null) return false;
                        }
                        return true;
                    }

                    lastAppliedValidationId = runId;

                    const rawErrors       = inferRawErrors(result, inspect);
                    const normalizedErrors = normalizeErrors(rawErrors, fields);
                    commitErrors(normalizedErrors);

                    return inferValidationResult(result, inspect, normalizedErrors, fields);
                };

                defineGetter(instance, '$errors', getErrors);
                if (rawInstance && rawInstance !== instance) {
                    defineGetter(rawInstance, '$errors', getErrors);
                }

                // [FIX-27/47] Use module-level _defineMethod (configurable descriptor).
                _defineMethod(instance, '$validate',    runValidation);
                _defineMethod(instance, '$validateForm', runValidation);
                _defineMethod(instance, '$clearErrors',  clearErrors);

                if (rawInstance && rawInstance !== instance) {
                    _defineMethod(rawInstance, '$validate',    runValidation);
                    _defineMethod(rawInstance, '$validateForm', runValidation);
                    _defineMethod(rawInstance, '$clearErrors',  clearErrors);
                }

                if (triggers.length) {
                    // [FIX-14] Guard against concurrent trigger-initiated runs (e.g.
                    //          rapid keystrokes each firing a new runValidation before
                    //          the previous one resolves). Only one trigger run at a time.
                    let _triggering = false;
                    const triggerHandler = async (event) => {
                        const field = event.target;
                        if (!field?.name || !FIELD_TAGS.has(field.tagName)) return;
                        if (!fieldSet.has(field.name)) return;
                        if (_triggering) return;
                        _triggering = true;
                        try {
                            await runValidation();
                        } finally {
                            _triggering = false;
                        }
                    };

                    for (let i = 0; i < triggers.length; i++) {
                        // [FIX-73] Capture the event name now — closures that capture `i`
                        // by reference would all remove the last trigger on teardown.
                        const evtName = triggers[i];
                        el.addEventListener(evtName, triggerHandler, true);
                        cleanups.push(() => el.removeEventListener(evtName, triggerHandler, true));
                    }
                }

                /**
                 * [FIX-9] submitGuard used to set isSubmitting=true to block
                 * double-submissions during the async validation window.  Because
                 * the browser dispatches all submit listeners synchronously (async
                 * handlers yield to the microtask queue but do NOT pause dispatch),
                 * x-ajax's guard check ran while submitGuard was suspended at
                 * `await runValidation()` — it saw isSubmitting=true and bailed,
                 * so the form NEVER submitted when both plugins were present.
                 *
                 * Fix: use a local _validating flag here; isSubmitting is exclusively
                 * owned by x-ajax.
                 */
                const submitGuard = async (event) => {
                    if (isSubmitting || _validating) {
                        event.preventDefault();
                        event.stopImmediatePropagation();
                        return;
                    }
                    _validating = true;
                    try {
                        const valid = await runValidation();
                        if (!valid) {
                            event.preventDefault();
                            event.stopImmediatePropagation();
                        }
                    } finally {
                        _validating = false;
                    }
                };

                el.addEventListener('submit', submitGuard, true);
                cleanups.push(() => el.removeEventListener('submit', submitGuard, true));

                el.__minix_form_validate_api__ = {
                    validate: runValidation,
                    get isSubmitting()  { return isSubmitting; },
                    setSubmitting(next) { isSubmitting = !!next; },
                    get isValidating()  { return _validating; },
                    clear:     clearErrors,
                    getErrors,
                };

                // [FIX-43] Teardown order matters:
                //   1. Remove DOM event listeners (no new events in flight)
                //   2. Delete API handle on element (no new callers via formApi)
                //   3. Remove instance props (no stale $errors/$validate refs)
                //   4. Delete state keys (reactive system last — prevents stale
                //      getter firing after state is already gone)
                cleanups.push(() => {
                    if (el.__minix_form_validate_api__) delete el.__minix_form_validate_api__;
                });

                cleanups.push(() => {
                    _removeInstanceProps(instance);
                    if (rawInstance && rawInstance !== instance) _removeInstanceProps(rawInstance);
                });

                // [FIX-10] / [OPT-9] / [OPT-12] Delete per-field children (using
                //          pre-computed fieldKeys) BEFORE the parent key.
                cleanups.push(() => {
                    try {
                        component.state.batch(() => {
                            for (let i = 0; i < fieldKeys.length; i++) {
                                component.state.delete(fieldKeys[i]);
                            }
                            component.state.delete(errorStateKey);
                        });
                    } catch (_) {}
                });

                // [FIX-11/70] Inspect cleanup runs LAST — after all DOM event listeners
                //             are removed — so inspect.destroy() cannot trigger handlers
                //             on a form that is already mid-teardown.
                cleanups.push(() => {
                    try {
                        if      (typeof inspect.destroy === 'function') inspect.destroy();
                        else if (typeof inspect.cleanup === 'function') inspect.cleanup();
                    } catch (_) {}
                });

                return () => {
                    for (let i = 0; i < cleanups.length; i++) {
                        try { cleanups[i](); } catch (_) {}
                    }
                };
            }, { priority: 1000 });
        }
    });

    // ─── Ajax Plugin ──────────────────────────────────────────────────────────

    const MiniXAjaxPlugin = definePlugin({
        name:    'minix-ajax',
        version: '13.2.0',

        install(app) {
            const compiler = getCompiler(app);
            if (!compiler) return;

            compiler.directive('x-ajax', ({ el, expression, component }) => {
                if (!isFormElement(el)) {
                    console.warn('[x-ajax] Must be used on a <form>.');
                    return _NOOP_CLEANUP;
                }

                const instance = component.instance;
                const eventMap = safeParseAjaxConfig(expression);

                const handlers = {
                    onSuccess:    resolveMethod(instance, eventMap.onSuccess)    || NOOP_ASYNC,
                    onFailure:    resolveMethod(instance, eventMap.onFailure)    || NOOP_ASYNC,
                    onBeforeSend: resolveMethod(instance, eventMap.onBeforeSend) || NOOP_ASYNC,
                    onComplete:   resolveMethod(instance, eventMap.onComplete)   || NOOP_ASYNC,
                    onLoader:     resolveMethod(instance, eventMap.onLoader)     || NOOP_ASYNC,
                };
                let ajaxSubmitting = false;

                const onSubmit = async (event) => {
                    if (event.defaultPrevented) return;
                    event.preventDefault();

                    const formApi = el.__minix_form_validate_api__ || null;

                    // [FIX-19] Atomic check-and-set: read and set isSubmitting in the
                    // same synchronous turn so two submit events firing in the same
                    // microtask tick cannot both pass the guard before either sets the flag.
                    if (ajaxSubmitting || formApi?.isSubmitting) return;
                    ajaxSubmitting = true;
                    if (formApi) formApi.setSubmitting(true);
                    // NOTE: from this point on, setSubmitting(false) MUST be called in the
                    // finally block below regardless of what happens — see FIX-12/FIX-15.

                    let responseObj        = null;
                    let parsedData         = null;
                    let loaderRequested    = false; // [FIX-30] set BEFORE await so finally always cleans up
                    let effectiveResponse  = null;  // [FIX-25] hoisted so finally/onComplete can see it
                    // [FIX-12] Use a flag so finally always runs and resets submitting.
                    let validationFailed   = false;

                    try {
                        // Always validate here too; capture-phase async validation
                        // cannot stop the bubble-phase ajax handler before it awaits.
                        const validator =
                            (formApi && typeof formApi.validate === 'function' ? formApi.validate : null) ||
                            (typeof instance.$validate     === 'function' ? instance.$validate     : null) ||
                            (typeof instance.$validateForm === 'function' ? instance.$validateForm : null);

                        if (validator) {
                            // [FIX-41] Wrap in try/catch so a throwing validator is
                            // treated as validation failure, not a network/fetch error.
                            let valid;
                            try {
                                valid = await validator();
                            } catch (validatorError) {
                                console.warn('[x-ajax] validator() threw:', validatorError);
                                validationFailed = true;
                                return;
                            }
                            if (!valid) { validationFailed = true; return; }
                        }

                        // [FIX-30] Mark loader as requested BEFORE the await so that if
                        // onLoader(true) itself throws, the finally block still calls
                        // onLoader(false) to restore UI state.
                        loaderRequested = true;
                        await handlers.onLoader(true, el, eventMap);

                        const method   = (el.method || 'GET').toUpperCase();
                        const action   = el.action || global.location?.href || '';
                        const formData = new FormData(el);

                        // [FIX-20] onBeforeSend may append entries to formData. Await it
                        // BEFORE building the GET/HEAD URL so those entries are included.
                        await handlers.onBeforeSend(formData, el, eventMap);

                        const fetchOptions = {
                            method,
                            headers: _XHR_HEADERS, // [FIX-81] frozen module-level constant
                        };

                        if (method === 'GET' || method === 'HEAD') {
                            // [FIX-20] URL is now constructed after onBeforeSend resolves.
                            const url = new URL(action, global.location?.href || undefined);
                            for (const [key, value] of formData.entries()) {
                                url.searchParams.append(key, value);
                            }
                            responseObj = await fetch(url.toString(), fetchOptions);
                        } else {
                            fetchOptions.body = formData;
                            responseObj = await fetch(action, fetchOptions);
                        }

                        // [FIX-25] Keep effectiveResponse in sync for the finally block.
                        effectiveResponse = responseObj;

                        const contentType = responseObj.headers.get('content-type') || '';
                        parsedData = contentType.includes('application/json')
                            ? await responseObj.json()
                            : await responseObj.text();

                        if (responseObj.ok) {
                            await handlers.onSuccess(parsedData, el, responseObj, eventMap);
                        } else {
                            await handlers.onFailure(parsedData, el, responseObj, eventMap);
                        }
                    } catch (error) {
                        // [FIX-21/61] Use module-level frozen sentinel for network errors.
                        effectiveResponse = responseObj ?? _NETWORK_ERROR_RESPONSE;
                        parsedData = {
                            ok:         false,
                            status:     effectiveResponse.status ?? null,
                            statusText: effectiveResponse.statusText ?? '',
                            data:       error,
                        };
                        await handlers.onFailure(parsedData, el, effectiveResponse, eventMap);
                    } finally {
                        // [FIX-15] onLoader(false) is in its own inner finally so it fires
                        //          even when onComplete() throws.
                        // [FIX-25] onComplete now receives effectiveResponse (never null).
                        // [FIX-30] onLoader(false) fires whenever loaderRequested is true,
                        //          even if onLoader(true) itself threw mid-execution.
                        try {
                            if (!validationFailed) {
                                await handlers.onComplete(parsedData, el, effectiveResponse, eventMap);
                            }
                        } finally {
                            if (loaderRequested) await handlers.onLoader(false, el, eventMap);
                            ajaxSubmitting = false;
                            if (formApi) formApi.setSubmitting(false);
                        }
                    }
                };

                el.addEventListener('submit', onSubmit);
                return () => el.removeEventListener('submit', onSubmit);
            }, { priority: 900 });
        }
    });

    // ─── Exports ──────────────────────────────────────────────────────────────

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { MiniXValidatePlugin, MiniXAjaxPlugin };
    }

    global.MiniXValidatePlugin = MiniXValidatePlugin;
    global.MiniXAjaxPlugin     = MiniXAjaxPlugin;

})(typeof window !== 'undefined' ? window : globalThis);
