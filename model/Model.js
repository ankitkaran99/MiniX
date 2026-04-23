class Model {
    constructor(data = {}) {
        this.$data = {};
        this.$relations = this._normalizeRelations(
            typeof this.relations === 'function' ? this.relations() : {}
        );

        const defaults = typeof this.defaults === 'function' ? this.defaults() : {};
        this.fill({ ...defaults, ...data });

        return new Proxy(this, {
            get(target, prop, receiver) {
                if (prop in target) {
                    return Reflect.get(target, prop, receiver);
                }

                return target.$data[prop];
            },

            set(target, prop, value, receiver) {
                if (prop in target) {
                    return Reflect.set(target, prop, value, receiver);
                }

                const relation = target.$relations[prop];
                target.$data[prop] = relation
                ? target._hydrateRelation(value, relation)
                : value;

                return true;
            },

            has(target, prop) {
                return prop in target || prop in target.$data;
            },

            ownKeys(target) {
                const targetKeys = Reflect.ownKeys(target).filter(
                    key => !String(key).startsWith('$')
                );
                const dataKeys = Reflect.ownKeys(target.$data);
                return [...new Set([...targetKeys, ...dataKeys])];
            },

            getOwnPropertyDescriptor(target, prop) {
                if (prop in target) {
                    return Object.getOwnPropertyDescriptor(target, prop);
                }

                if (prop in target.$data) {
                    return {
                        enumerable: true,
                        configurable: true,
                        writable: true,
                        value: target.$data[prop]
                    };
                }

                return undefined;
            },

            deleteProperty(target, prop) {
                if (prop in target.$data) {
                    delete target.$data[prop];
                    return true;
                }

                return false;
            }
        });
    }

    defaults() {
        return {};
    }

    relations() {
        return {};
    }

    hasOne(ModelClass) {
        return {
            type: 'one',
            model: ModelClass
        };
    }

    hasMany(ModelClass) {
        return {
            type: 'many',
            model: ModelClass
        };
    }

    fill(data = {}) {
        if (!this._isObject(data)) {
            throw new Error(`${this.constructor.name} expects object data.`);
        }

        for (const key of Object.keys(data)) {
            const relation = this.$relations[key];
            this.$data[key] = relation
            ? this._hydrateRelation(data[key], relation)
            : data[key];
        }

        return this;
    }

    get(attr, fallback = null) {
        return typeof this.$data[attr] === 'undefined' ? fallback : this.$data[attr];
    }

    set(attr, value) {
        const relation = this.$relations[attr];
        this.$data[attr] = relation
        ? this._hydrateRelation(value, relation)
        : value;

        return this;
    }

    toJSON() {
        const out = {};

        for (const key of Object.keys(this.$data)) {
            const value = this.$data[key];

            if (value instanceof Model) {
                out[key] = value.toJSON();
            } else if (Array.isArray(value)) {
                out[key] = value.map(item =>
                item instanceof Model ? item.toJSON() : item
                );
            } else {
                out[key] = value;
            }
        }

        return out;
    }

    _normalizeRelations(relations = {}) {
        const normalized = {};

        for (const key of Object.keys(relations)) {
            const rel = relations[key];

            if (!rel || typeof rel !== 'object' || !rel.model) {
                throw new Error(`Invalid relation "${key}" in ${this.constructor.name}`);
            }

            normalized[key] = {
                model: rel.model,
                multiple: rel.type === 'many'
            };
        }

        return normalized;
    }

    _hydrateRelation(value, relation) {
        const ModelClass = relation.model;

        if (typeof ModelClass !== 'function') {
            throw new Error(`Invalid relation model in ${this.constructor.name}`);
        }

        if (relation.multiple) {
            if (!Array.isArray(value)) {
                return [];
            }

            return value.map(item =>
            item instanceof ModelClass ? item : new ModelClass(item)
            );
        }

        if (value == null) {
            return null;
        }

        return value instanceof ModelClass ? value : new ModelClass(value);
    }

    _isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    static make(data = {}) {
        return new this(data);
    }

    static collection(items = []) {
        if (!Array.isArray(items)) {
            throw new Error(`${this.name}.collection() expects an array.`);
        }

        return items.map(item => new this(item));
    }
}
