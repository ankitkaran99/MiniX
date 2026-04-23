class Model {
    constructor(data = {}, options = {}) {
        this.$relationCache = new Map();
        this.$adapterCache = new Map();

        // BUG (prev. round): If a subclass defines relations as a class-field
        // arrow function (`relations = () => ({...})`), the field initialiser
        // runs *after* super() returns, so the Model constructor would see the
        // base-class no-op instead of the override.  We defer the call to after
        // the constructor body so the subclass initialiser has already fired.
        // The proxy return below means callers only ever hold the proxy, so
        // deferring here is safe.
        this.$relations = null;   // lazily filled after subclass fields exist

        this.$source = options.source || this._createOwnSource({
            ...this._getDefaults(),
            ...data
        });

        // Normalise relations now — subclass field initialisers have run by the
        // time we reach this line because this is still inside the constructor
        // body of the *base* class.  Class fields are set by the derived-class
        // constructor shim that wraps super(), so by the time our constructor
        // body finishes executing (before `return`) all instance fields
        // belonging to the subclass are in place.
        return new Proxy(this, {
            get(target, prop, receiver) {
                if (prop in target) return Reflect.get(target, prop, receiver);
                if (typeof prop === 'symbol') return Reflect.get(target, prop, receiver);
                return target._getValue(prop);
            },

            set(target, prop, value, receiver) {
                if (prop in target) return Reflect.set(target, prop, value, receiver);
                if (typeof prop === 'symbol') return Reflect.set(target, prop, value, receiver);
                target._setValue(prop, value);
                return true;
            },

            has(target, prop) {
                if (prop in target) return true;
                if (typeof prop === 'symbol') return false;
                return target._hasValue(prop);
            },

            ownKeys(target) {
                const relations = target._ensureRelations();
                // Filter own props of the raw target — strip internal $ fields.
                const targetKeys = Reflect.ownKeys(target).filter(
                    k => typeof k !== 'string' || !k.startsWith('$')
                );

                const raw = target._safeRawData(false);
                const dataKeys = raw && typeof raw === 'object'
                    ? Reflect.ownKeys(raw)
                    : [];

                // BUG (prev. round): Reflect.ownKeys($relations) would leak any
                // symbol keys, violating the proxy invariant because the
                // descriptor trap returns undefined for symbols → TypeError.
                // Object.keys() returns only string-keyed enumerable own props.
                const relationKeys = Object.keys(relations);

                return [...new Set([...targetKeys, ...dataKeys, ...relationKeys])];
            },

            getOwnPropertyDescriptor(target, prop) {
                if (prop in target) return Object.getOwnPropertyDescriptor(target, prop);
                if (typeof prop === 'symbol') return undefined;

                if (target._hasValue(prop) || prop in target._ensureRelations()) {
                    return { enumerable: true, configurable: true };
                }

                return undefined;
            },

            deleteProperty(target, prop) {
                if (prop in target || typeof prop === 'symbol') return false;
                return target._deleteValue(prop);
            }
        });
    }

    // ─── Overrideable hooks ────────────────────────────────────────────────

    defaults() { return {}; }
    relations() { return {}; }

    hasOne(ModelClass) { return { type: 'one',  model: ModelClass }; }
    hasMany(ModelClass) { return { type: 'many', model: ModelClass }; }

    // ─── Internal helpers ──────────────────────────────────────────────────

    _getDefaults() {
        const d = typeof this.defaults === 'function' ? this.defaults() : {};
        return this._isPlainObject(d) ? d : {};
    }

    _createOwnSource(initialData = {}) {
        // BUG (prev. round): bare `MiniX_State` throws ReferenceError in
        // strict bundler output.  typeof is always safe, even for undeclared
        // names, so we resolve through that gate first.
        const MiniX = typeof MiniX_State !== 'undefined' ? MiniX_State : undefined; // eslint-disable-line no-undef
        if (typeof MiniX !== 'function') {
            throw new Error(
                `${this.constructor.name} requires MiniX_State to create standalone reactive models.`
            );
        }

        const state  = new MiniX({});
        const source = this._createStateAdapter(state, '');

        const runner = () => {
            for (const key of Object.keys(initialData)) {
                source.set(key, this._serializeIncomingValue(key, initialData[key]));
            }
        };

        if (typeof state.batch === 'function') state.batch(runner);
        else runner();

        return source;
    }

    _createStateAdapter(state, basePath = '') {
        if (
            !state ||
            typeof state.get    !== 'function' ||
            typeof state.set    !== 'function' ||
            typeof state.has    !== 'function' ||
            typeof state.delete !== 'function'
        ) {
            throw new Error('State adapter expects a MiniX_State-like object.');
        }

        // Canonical path-join used by every method in this adapter.
        const join = (path, key) => {
            if (!path) return key  || '';
            if (!key)  return path || '';
            return `${path}.${key}`;
        };

        return {
            state,
            path:   basePath,
            get:    key          => state.get(join(basePath, key)),
            set:    (key, value) => state.set(join(basePath, key), value),
            has:    key          => state.has(join(basePath, key)),
            delete: key          => state.delete(join(basePath, key)),
            watch(key, callback) {
                if (typeof state.watch !== 'function') {
                    throw new Error('Underlying state does not support watch().');
                }
                return state.watch(join(basePath, key), callback);
            },
            raw: () => state.get(basePath || '')
        };
    }

    _getAdapter(path) {
        // Cache adapters keyed by full path.  Relation paths are always
        // non-empty strings (e.g. "comments", "author"), so the '' key is only
        // ever the root adapter, preventing accidental collisions.
        const key = path || '';
        if (!this.$adapterCache.has(key)) {
            this.$adapterCache.set(key, this._createStateAdapter(this.$source.state, key));
        }
        return this.$adapterCache.get(key);
    }

    _joinPath(base, key) {
        if (!base) return key  || '';
        if (!key)  return base || '';
        return `${base}.${key}`;
    }

    _getRelationPath(key) {
        return this._joinPath(this.$source.path, key);
    }

    _ensureRelations() {
        if (this.$relations === null) {
            const relationFactory = typeof this.relations === 'function' ? this.relations : null;
            this.$relations = this._normalizeRelations(
                relationFactory ? relationFactory.call(this) : {}
            );
            const desc = Object.getOwnPropertyDescriptor(this, 'relations');
            if (desc && desc.enumerable && typeof desc.value === 'function') {
                try { Object.defineProperty(this, 'relations', { ...desc, enumerable: false }); } catch (_) {}
            }
        }
        return this.$relations;
    }

    _getCollectionClass() {
        if (typeof Collection !== 'undefined') return Collection; // eslint-disable-line no-undef
        if (typeof globalThis !== 'undefined' && typeof globalThis.Collection === 'function') {
            return globalThis.Collection;
        }
        if (typeof require === 'function') {
            try { return require('./Collection.js'); } catch (_) {}
        }
        throw new Error(`${this.constructor.name} hasMany() requires Collection to be loaded.`);
    }

    _safeRawData(strict = true) {
        const raw = this.$source.raw();
        if (raw == null) return {};
        if (!this._isPlainObject(raw)) {
            if (strict) {
                throw new Error(
                    `${this.constructor.name} expects object-shaped state at ` +
                    `"${this.$source.path || '(root)'}".`
                );
            }
            return {};
        }
        return raw;
    }

    _getValue(attr) {
        const relation = this._ensureRelations()[attr];

        // PERF: hasMany collections read entirely through the adapter — the
        // scalar value at that key in state is irrelevant, so skip the get().
        if (relation) {
            return this._wrapRelationValue(attr, relation.multiple ? undefined : this.$source.get(attr), relation);
        }

        return this.$source.get(attr);
    }

    _setValue(attr, value) {
        const serialized = this._serializeIncomingValue(attr, value);
        this.$source.set(attr, serialized);
        this.$relationCache.delete(attr);   // always evict; Map.delete is no-op if absent
        return this;
    }

    _hasValue(attr) {
        return this.$source.has(attr);
    }

    _deleteValue(attr) {
        const ok = this.$source.delete(attr);
        this.$relationCache.delete(attr);
        return ok;
    }

    _rawData() {
        return this._safeRawData(true);
    }

    _wrapRelationValue(key, value, relation) {
        const ModelClass = relation.model;

        if (relation.multiple) {
            // BUG (prev. round): created a new Collection instance on every
            // property access, breaking reference equality (model.tags === model.tags
            // was always false) and causing spurious re-renders in reactive UIs.
            // Cache collections just like singular relations.
            if (!this.$relationCache.has(key)) {
                const CollectionClass = this._getCollectionClass();
                this.$relationCache.set(
                    key,
                    new CollectionClass(ModelClass, {
                        source: this._getAdapter(this._getRelationPath(key))
                    })
                );
            }
            return this.$relationCache.get(key);
        }

        // BUG (prev. round): the null guard ran before the cache check, so a
        // relation that transitioned null → value externally was forever stuck
        // returning null.  Now: null evicts and returns null; non-null builds
        // or returns the cached instance.
        if (value == null) {
            this.$relationCache.delete(key);
            return null;
        }

        if (!this.$relationCache.has(key)) {
            const childPath = this._getRelationPath(key);
            this.$relationCache.set(
                key,
                new ModelClass({}, { source: this._getAdapter(childPath) })
            );
        }

        return this.$relationCache.get(key);
    }

    _serializeIncomingValue(key, value) {
        const relation = this._ensureRelations()[key];

        if (!relation) return this._serializePlain(value);

        if (relation.multiple) {
            if (value == null) return [];
            if (value && typeof value.toJSON === 'function') return value.toJSON();
            if (!Array.isArray(value)) {
                throw new Error(
                    `${this.constructor.name}.${key} expects an array or collection-like value.`
                );
            }
            return value.map(item => this._serializePlain(item));
        }

        if (value == null) return null;
        return this._serializePlain(value);
    }

    // PERF: cycle detection via WeakSet prevents stack-overflow on circular
    // plain-object references.  The visited set is created once per public call
    // site and threaded through recursion.
    _serializePlain(value, _visited = new WeakSet()) {
        if (value && typeof value.toJSON === 'function') return value.toJSON();

        if (Array.isArray(value)) {
            if (_visited.has(value)) {
                throw new Error(
                    `${this.constructor.name}: circular reference detected during serialization.`
                );
            }
            _visited.add(value);
            try {
                return value.map(item => this._serializePlain(item, _visited));
            } finally {
                _visited.delete(value);
            }
        }

        if (this._isPlainObject(value)) {
            if (_visited.has(value)) {
                throw new Error(
                    `${this.constructor.name}: circular reference detected during serialization.`
                );
            }
            _visited.add(value);
            const out = {};
            try {
                for (const k of Object.keys(value)) {
                    out[k] = this._serializePlain(value[k], _visited);
                }
            } finally {
                _visited.delete(value);
            }
            return out;
        }

        return value;
    }

    _normalizeRelations(relations = {}) {
        const normalized = {};

        for (const key of Object.keys(relations)) {
            const rel = relations[key];

            // BUG (prev. round): only checked `!rel.model` (falsy), so a non-
            // function value like `model: 42` slipped through and crashed later
            // with an opaque "X is not a constructor" error.
            if (!rel || typeof rel !== 'object' || typeof rel.model !== 'function') {
                throw new Error(
                    `Invalid relation "${key}" in ${this.constructor.name}: ` +
                    `model must be a constructor function.`
                );
            }

            normalized[key] = {
                model:    rel.model,
                multiple: rel.type === 'many'
            };
        }

        return normalized;
    }

    _isPlainObject(value) {
        if (value === null || typeof value !== 'object') return false;
        const proto = Object.getPrototypeOf(value);
        return proto === Object.prototype || proto === null;
    }

    // ─── Public API ────────────────────────────────────────────────────────

    get(attr, fallback = null) {
        const value = this._getValue(attr);
        return value === undefined ? fallback : value;
    }

    peek(attr, fallback = null) {
        const value = this.$source.get(attr);
        return value === undefined ? fallback : value;
    }

    set(attr, value) {
        return this._setValue(attr, value);
    }

    fill(data = {}) {
        if (!this._isPlainObject(data)) {
            throw new Error(`${this.constructor.name}.fill() expects a plain object.`);
        }

        const runner = () => {
            for (const key of Object.keys(data)) {
                this._setValue(key, data[key]);
            }
        };

        if (typeof this.$source.state?.batch === 'function') {
            this.$source.state.batch(runner);
        } else {
            runner();
        }

        return this;
    }

    assign(data = {}) { return this.fill(data); }

    watch(attr, callback) {
        if (typeof this.$source.watch !== 'function') {
            throw new Error(`${this.constructor.name} source does not support watch().`);
        }
        return this.$source.watch(attr, callback);
    }

    raw()    { return this._rawData(); }
    clone()  { return new this.constructor(this.toJSON()); }

    cloneWith(data = {}) {
        return new this.constructor({
            ...this.toJSON(),
            ...this._serializePlain(data)
        });
    }

    toJSON() {
        return this._serializePlain(this._rawData());
    }

    // ─── Static API ────────────────────────────────────────────────────────

    static make(data = {}, options = {}) {
        return new this(data, options);
    }

    static _isStateLike(value) {
        return !!(
            value &&
            typeof value.get    === 'function' &&
            typeof value.set    === 'function' &&
            typeof value.has    === 'function' &&
            typeof value.delete === 'function'
        );
    }

    static fromState(state, path = '') {
        if (!this._isStateLike(state)) {
            throw new Error(`${this.name}.fromState() expects a MiniX_State-like instance.`);
        }

        // BUG (prev. round): the inline source object used its own path-joining
        // logic (`path ? \`${path}.${key}\` : key`) which produced a trailing dot
        // when key was '' (e.g. raw() would call state.get('foo.') instead of
        // state.get('foo')).  Now we delegate to _createStateAdapter which owns
        // the canonical join() implementation.
        //
        // We need a temporary instance to call the instance method.  We pass an
        // empty options.source placeholder to skip _createOwnSource, then
        // overwrite $source immediately.
        const instance = new this({}, {
            source: { state, path, get: () => {}, set: () => {}, has: () => false, delete: () => false, watch: () => {}, raw: () => ({}) }
        });
        // Replace the placeholder with a properly-constructed adapter.
        instance.$source = instance._createStateAdapter(state, path);
        return instance;
    }

    static fromStore(store, path = '') {
        // Priority: most-specific internal state object wins.
        const candidates = [
            store?.$stateManager,
            store?.$store,
            store?.state,
            store
        ];

        const state = candidates.find(item => this._isStateLike(item));
        if (!state) {
            throw new Error(
                `${this.name}.fromStore() expects a store exposing MiniX_State-like methods.`
            );
        }

        return this.fromState(state, path);
    }

    static bind(source, path = '') {
        return this._isStateLike(source)
            ? this.fromState(source, path)
            : this.fromStore(source, path);
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Model;
} else if (typeof window !== 'undefined') {
    window.Model = Model;
}
