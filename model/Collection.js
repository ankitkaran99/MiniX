class Collection {
    constructor(ModelClass, options = {}) {
        if (typeof ModelClass !== 'function') {
            throw new Error('Collection expects a model class.');
        }

        this.$model = ModelClass;
        this.$modelCache = new Map();

        // BUG (prev. round): `options.source || null` would discard a source
        // object that is somehow falsy (edge case, but ?? is the correct guard
        // for "absent vs. present" rather than "falsy vs. truthy").
        this.$source = options.source ?? null;
        this.$items  = Array.isArray(options.items) ? options.items.slice() : null;

        if (!this.$source && this.$items === null) {
            throw new Error(
                'Collection requires either a reactive source adapter or an items array.'
            );
        }

        return new Proxy(this, {
            get(target, prop, receiver) {
                if (prop in target)          return Reflect.get(target, prop, receiver);
                if (typeof prop === 'symbol') return Reflect.get(target, prop, receiver);

                const str = String(prop);

                // Non-negative integer indices — e.g. collection[0]
                if (/^\d+$/.test(str)) return target.at(Number(str));

                // BUG (prev. round): negative indices returned undefined instead
                // of forwarding to at().  at() already returns null for
                // out-of-range, so the proxy just needs to forward.
                if (/^-\d+$/.test(str)) return target.at(Number(str));

                return undefined;
            }
        });
    }

    static from(ModelClass, items = []) {
        return new this(ModelClass, { items });
    }

    // ─── Internal helpers ──────────────────────────────────────────────────

    _isReactive() { return this.$source !== null; }

    _isPlainObject(value) {
        if (value === null || typeof value !== 'object') return false;
        const proto = Object.getPrototypeOf(value);
        return proto === Object.prototype || proto === null;
    }

    _normalizeItem(item) {
        if (item instanceof this.$model) return item;

        if (!this._isPlainObject(item)) {
            throw new Error(
                `${this.$model.name || 'Model'} collection expects model instances or plain objects, got ${typeof item}.`
            );
        }

        return new this.$model(item);
    }

    _serializeValue(value, _visited = new WeakSet()) {
        if (value && typeof value.toJSON === 'function') return value.toJSON();

        if (Array.isArray(value)) {
            if (_visited.has(value)) {
                throw new Error('Collection: circular reference detected during serialization.');
            }
            _visited.add(value);
            try {
                return value.map(v => this._serializeValue(v, _visited));
            } finally {
                _visited.delete(value);
            }
        }

        if (this._isPlainObject(value)) {
            // PERF: cycle detection — mirrors the fix applied to Model._serializePlain.
            if (_visited.has(value)) {
                throw new Error('Collection: circular reference detected during serialization.');
            }
            _visited.add(value);
            const out = {};
            try {
                for (const key of Object.keys(value)) {
                    out[key] = this._serializeValue(value[key], _visited);
                }
            } finally {
                _visited.delete(value);
            }
            return out;
        }

        return value;
    }

    _serializeItem(item) {
        return this._serializeValue(item);
    }

    _getArray() {
        if (this._isReactive()) {
            const value = this.$source.raw();
            return Array.isArray(value) ? value : [];
        }
        return Array.isArray(this.$items) ? this.$items : [];
    }

    _setArray(next) {
        const serialized = next.map(item => this._serializeItem(item));
        this.$modelCache.clear();
        if (this._isReactive()) {
            this.$source.set('', serialized);
        } else {
            this.$items = serialized;
        }
        return this;
    }

    // PERF: Internal variant of at() that accepts a pre-fetched raw array,
    // avoiding a redundant _getArray() call in hot paths (toArray, pop, shift,
    // removeAt, removeWhere).
    _atWithArray(arr, index) {
        if (index < 0 || index >= arr.length) return null;

        if (!this._isReactive()) {
            return this._normalizeItem(arr[index]);
        }

        // BUG (prev. round): _createChildSource() accessed this.$source.state
        // without guarding for its absence.  We now validate eagerly.
        if (!this.$source.state) {
            throw new Error(
                'Collection reactive source must expose a `state` property for child model binding.'
            );
        }

        const childPath = this.$source.path
            ? `${this.$source.path}.${index}`
            : String(index);

        const state = this.$source.state;
        const cached = this.$modelCache.get(index);
        if (cached && cached.state === state && cached.path === childPath) {
            return cached.model;
        }

        const model = new this.$model({}, {
            source: {
                state,
                path:   childPath,
                get:    key          => state.get(key ? `${childPath}.${key}` : childPath),
                set:    (key, value) => state.set(key ? `${childPath}.${key}` : childPath, value),
                has:    key          => state.has(key ? `${childPath}.${key}` : childPath),
                delete: key          => state.delete(key ? `${childPath}.${key}` : childPath),
                watch(key, callback) {
                    if (typeof state.watch !== 'function') {
                        throw new Error('Underlying state does not support watch().');
                    }
                    return state.watch(key ? `${childPath}.${key}` : childPath, callback);
                },
                raw: () => state.get(childPath)
            }
        });
        this.$modelCache.set(index, { state, path: childPath, model });
        return model;
    }

    // ─── Public read API ───────────────────────────────────────────────────

    all()     { return this.toArray(); }

    // PERF: previous implementation called at(index) inside the map callback,
    // which called _getArray() again for every element — O(n) state reads
    // for a single toArray() call.  Now _getArray() is called exactly once.
    toArray() {
        const arr = this._getArray();
        return arr.map((_, i) => this._atWithArray(arr, i));
    }

    toJSON() {
        return this._getArray().map(item => this._serializeItem(item));
    }

    get length() {
        // Reads _getArray() once per access.  Callers in tight loops should
        // cache: `const len = col.length;`
        return this._getArray().length;
    }

    isEmpty() { return this.length === 0; }

    at(index) {
        return this._atWithArray(this._getArray(), index);
    }

    first() { return this.at(0); }
    last()  { return this.at(this.length - 1); }

    // ─── Mutation API ──────────────────────────────────────────────────────

    // BUG (prev. round): push() did not normalize, allowing primitives through.
    // Now normalizes eagerly.  pushModel() is kept for symmetry but delegates
    // directly to push() without double-normalizing.
    push(item) {
        const arr = this._getArray().slice();
        arr.push(this._normalizeItem(item));
        return this._setArray(arr);
    }

    // BUG (prev. round): pushModel() called push(this._normalizeItem(data)) which
    // caused _normalizeItem to run twice (once here, once inside push()).
    // Now pushModel just forwards to push() which normalizes once.
    pushModel(data = {}) {
        return this.push(data);
    }

    unshift(item) {
        const arr = this._getArray().slice();
        arr.unshift(this._normalizeItem(item));
        return this._setArray(arr);
    }

    // BUG (prev. round): same double-normalize as pushModel.
    unshiftModel(data = {}) {
        return this.unshift(data);
    }

    pop() {
        const arr = this._getArray();
        if (!arr.length) return null;

        // BUG (prev. round): called at() which re-fetched _getArray().
        // Now reuses the already-fetched arr.
        // BUG (prev. round, both rounds): returned a live reactive model whose
        // state path was about to be deleted.  Return a detached clone instead.
        const snapshot = this._atWithArray(arr, arr.length - 1)?.clone() ?? null;
        this._setArray(arr.slice(0, -1));
        return snapshot;
    }

    shift() {
        const arr = this._getArray();
        if (!arr.length) return null;

        // BUG: same double-read + dangling-reference fix as pop().
        const snapshot = this._atWithArray(arr, 0)?.clone() ?? null;
        this._setArray(arr.slice(1));
        return snapshot;
    }

    removeAt(index) {
        const arr = this._getArray();
        if (index < 0 || index >= arr.length) return null;

        // BUG: same double-read + dangling-reference fix.
        const snapshot = this._atWithArray(arr, index)?.clone() ?? null;
        const next = arr.slice();
        next.splice(index, 1);
        this._setArray(next);
        return snapshot;
    }

    removeWhere(callback) {
        const arr  = this._getArray();
        const next = [];
        const removed = [];

        for (let i = 0; i < arr.length; i++) {
            const wrapped = this._atWithArray(arr, i);

            if (callback(wrapped, i)) {
                // BUG (prev. round): returned live reactive models pointing at
                // paths about to be deleted.  Clone first.
                removed.push(wrapped?.clone() ?? null);
            } else {
                next.push(arr[i]);
            }
        }

        this._setArray(next);
        return removed;
    }

    removeBy(field, value) {
        return this.removeWhere(item => item?.[field] === value);
    }

    removeById(id, key = 'id') {
        return this.removeBy(key, id);
    }

    // BUG (prev. round): accepted any raw item without normalization, so a
    // primitive would silently persist and blow up on the next at() call.
    replaceAt(index, item) {
        const arr = this._getArray();
        if (index < 0 || index >= arr.length) return this;

        const next   = arr.slice();
        next[index]  = this._normalizeItem(item);
        return this._setArray(next);
    }

    // Returns null (not `this`) when index is out of range, consistent with
    // the "null = not found" contract of all other update/remove methods.
    updateAt(index, patch = {}) {
        if (!this._isPlainObject(patch)) {
            throw new Error('Collection.updateAt() expects a plain object patch.');
        }
        const model = this.at(index);
        if (!model) return null;
        model.fill(patch);
        return model;
    }

    updateBy(field, value, patch = {}) {
        if (!this._isPlainObject(patch)) {
            throw new Error('Collection.updateBy() expects a plain object patch.');
        }
        const model = this.findBy(field, value);
        if (!model) return null;
        model.fill(patch);
        return model;
    }

    updateById(id, patch = {}, key = 'id') {
        return this.updateBy(key, id, patch);
    }

    // reset() is intentionally a raw-data operation: it bypasses _normalizeItem
    // so callers can bulk-load pre-serialized plain objects without constructing
    // model instances.  Use resetModels() if item validation is desired.
    reset(items = []) {
        if (!Array.isArray(items)) {
            throw new Error('Collection.reset() expects an array.');
        }
        return this._setArray(items);
    }

    resetModels(items = []) {
        if (!Array.isArray(items)) {
            throw new Error('Collection.resetModels() expects an array.');
        }
        return this._setArray(items.map(item => this._normalizeItem(item)));
    }

    replace(items = [])       { return this.reset(items); }
    replaceModels(items = []) { return this.resetModels(items); }
    clear()                   { return this._setArray([]); }

    // ─── Iteration & querying ──────────────────────────────────────────────

    map(callback)     { return this.toArray().map(callback); }
    filter(callback)  { return this.toArray().filter(callback); }
    some(callback)    { return this.toArray().some(callback); }
    every(callback)   { return this.toArray().every(callback); }

    forEach(callback) {
        this.toArray().forEach(callback);
        return this;
    }

    // BUG (prev. round): used `|| null` which is semantically wrong (though
    // harmless for objects).  Using `?? null` converts only undefined → null,
    // not any falsy value.
    find(callback) {
        return this.toArray().find(callback) ?? null;
    }

    // BUG (prev. round): compared against raw data, missing computed/relation
    // fields.  Now uses toArray() → wrapped model instances.
    findBy(field, value) {
        return this.toArray().find(item => item?.[field] === value) ?? null;
    }

    findById(id, key = 'id') { return this.findBy(key, id); }

    // BUG (prev. round): operated on raw _getArray() data, missing computed
    // and relation fields.
    pluck(field) {
        return this.toArray().map(item => item?.[field]);
    }

    ids(key = 'id') { return this.pluck(key); }

    // BUG (prev. round): raw data comparison, same fix as findBy/pluck.
    has(field, value) {
        return this.toArray().some(item => item?.[field] === value);
    }

    hasId(id, key = 'id') { return this.has(key, id); }

    sortBy(field, direction = 'asc') {
        const factor = direction === 'desc' ? -1 : 1;

        // BUG (prev. round): used toJSON() which then got re-serialized by
        // _setArray, double-processing nested objects.  _getArray() returns
        // the already-serialized raw data; _setArray's _serializeItem is then
        // a cheap pass-through for plain objects.
        const arr = this._getArray().slice();

        arr.sort((a, b) => {
            const av = a?.[field];
            const bv = b?.[field];
            if (av === bv)   return 0;
            if (av == null)  return 1;
            if (bv == null)  return -1;
            return av > bv ? factor : -factor;
        });

        return this._setArray(arr);
    }

    orderBy(field, direction = 'asc') { return this.sortBy(field, direction); }

    reverse() {
        // BUG (prev. round): same double-serialization fix as sortBy.
        return this._setArray(this._getArray().slice().reverse());
    }

    watch(callback) {
        if (!this._isReactive()) {
            throw new Error('watch() is only available on reactive collections.');
        }
        if (typeof this.$source.watch !== 'function') {
            throw new Error('Underlying source does not support watch().');
        }
        return this.$source.watch('', callback);
    }

    // PERF: previous implementation called toArray() which allocates a full
    // wrapped-model array before yielding the first element.  For large
    // collections where the caller breaks early (for...of with a break, or
    // Array.from stopping after N items) this is wasteful.  The generator
    // wraps models on demand, one per iteration step.
    *[Symbol.iterator]() {
        const arr = this._getArray();
        for (let i = 0; i < arr.length; i++) {
            yield this._atWithArray(arr, i);
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Collection;
} else if (typeof window !== 'undefined') {
    window.Collection = Collection;
}
