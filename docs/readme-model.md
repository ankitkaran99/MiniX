---
product: Model & Collection
summary: Reactive data-layer documentation for Model and Collection, including relations, binding to state/store data, serialization, and collection helpers.
badges: ["Model layer","Collections","Relations","Reactive binding"]
highlights: ["Object-shaped models and array-shaped collections","hasOne and hasMany relation wrappers","Binding models directly onto reactive state and stores"]
metrics: ["Models::Object wrappers","Collections::Array helpers","Relations::hasOne / hasMany","Binding::Store and state"]
sidebar: This page explains the data-layer primitives, relation behavior, serialization, state binding, and the collection query and mutation API.
---

# Model & Collection Deep Documentation

> **Product:** Model & Collection
> **Summary:** Reactive data-layer documentation for Model and Collection, including relations, binding to state/store data, serialization, and collection helpers.
> **Focus:** `Model layer` | `Collections` | `Relations` | `Reactive binding`
>
> **Key Highlights:**
> - Object-shaped models and array-shaped collections
> - hasOne and hasMany relation wrappers
> - Binding models directly onto reactive state and stores
> **Metrics & Scope:**
> - **Models:** Object wrappers
> - **Collections:** Array helpers
> - **Relations:** hasOne / hasMany
> - **Binding:** Store and state

---

## Overview

A lightweight reactive data-layer built around two classes: **Model** for object-shaped state and **Collection** for array-shaped groups of models.

These classes are designed for Mini-X style state/store systems, but they can also be used as standalone model wrappers when `MiniX_State` is globally available.

**Model**Represents one object with attributes, defaults, methods, relations, reactive getters/setters, serialization and store binding.

**Collection**Represents a list of models with array-like access, mutation helpers, searching, sorting, iteration and reactive array binding.

**Relations**Supports `hasOne()` and `hasMany()` relationships that automatically wrap nested objects and arrays.

## 1\. Requirements

The classes expect a MiniX-style reactive state object when used in reactive mode. A valid state object must expose:

```
state.get(path)
state.set(path, value)
state.has(path)
state.delete(path)
state.watch(path, callback) // optional, required only for watch()
state.batch(callback)       // optional, used for efficient bulk writes
```

> [!NOTE]
> **Standalone models need `MiniX_State`.** When you call `new User(data)` without passing a source, `Model` internally tries to create `new MiniX_State({})`. If `MiniX_State` is not loaded, it throws an error.

### File loading order

For browser usage, load `Collection.js` before models that use `hasMany()`, or expose it as `window.Collection`.

```
<script src="../src/MiniX.js"></script>
<script src="../src/Collection.js"></script>
<script src="../src/Model.js"></script>
```

For CommonJS/Node-style usage:

```
const Model = require('./Model.js');
const Collection = require('./Collection.js');
```

## 2\. Loading & Exports

Both files support browser globals and CommonJS exports.

| File | Browser global | CommonJS export |
| --- | --- | --- |
| `Model.js` | `window.Model` | `module.exports = Model` |
| `Collection.js` | `window.Collection` | `module.exports = Collection` |

`Model.hasMany()` resolves the collection class in this order:

1.  global `Collection`
2.  `globalThis.Collection`
3.  `require('./Collection.js')`

> [!NOTE]
> **Class-field relations are supported.** A subclass can define `relations = () => ({ ... })` as an instance field. The model normalizes relations lazily so that pattern still works.

## 3\. Quick Start

```
class Profile extends Model {
  defaults() {
    return { avatar: null, bio: '' };
  }
}

class Role extends Model {}
class Permission extends Model {}

class User extends Model {
  defaults() {
    return {
      id: null,
      name: '',
      email: '',
      profile: null,
      roles: [],
      permissions: []
    };
  }

  relations() {
    return {
      profile: this.hasOne(Profile),
      roles: this.hasMany(Role),
      permissions: this.hasMany(Permission)
    };
  }

  getId() {
    return this.id;
  }

  hasRole(name) {
    return this.roles.has('name', name);
  }
}

const user = new User({
  id: 1,
  name: 'Ankit',
  profile: { bio: 'Full-stack developer' },
  roles: [{ id: 1, name: 'admin' }]
});

console.log(user.name);              // Ankit
console.log(user.profile.bio);       // Full-stack developer
console.log(user.roles.first().name); // admin

user.name = 'Ankit Karan';
user.roles.push({ id: 2, name: 'editor' });

console.log(user.toJSON());
```

## 4\. Model Concept

`Model` wraps object data behind a `Proxy`. This allows you to use natural property syntax while storing the actual data safely inside a state source.

### Normal property access

```
const user = new User({ name: 'Ankit' });

user.name;              // same as user.get('name')
user.name = 'Kavita';   // same as user.set('name', 'Kavita')
'name' in user;         // checks state value or real class property
delete user.name;       // deletes from state
```

### Internal properties are protected

Internal properties such as `$source`, `$relationCache`, and `$adapterCache` are stored on the real class instance. They are hidden from normal enumeration.

```
Object.keys(user); // returns data keys + relation keys, not $internal fields
```

### Methods and attributes can live together

If a method exists on the class, the proxy returns the method first. If not, it reads from model data.

```
class User extends Model {
  getId() { return this.id; }
}

const user = new User({ id: 10 });
user.getId(); // 10
```

**Name collision rule:** class methods/properties win over data attributes. Avoid using data keys like `set`, `get`, `fill`, `toJSON`, `clone`, etc. because those names already exist on the class.

## 5\. Proxy Behavior

`Model` instances are proxies, so property reads, writes, existence checks, deletion, and enumeration all go through model logic.

### Read/write routing

```
user.name = 'Ankit';     // routed to state
user.getId();           // method call on the real instance
user[Symbol.iterator];  // symbol access is forwarded normally
```

### Enumeration rules

`Object.keys(model)`, `for...in`, and similar reflection APIs expose:

*   real public instance properties
*   current raw data keys
*   declared relation keys

Internal `$...` properties are hidden from enumeration.

### Delete semantics

```
delete user.name; // deletes the value from the backing source
delete user.get;  // false, class members are protected
```

> [!NOTE]
> Relation keys participate in enumeration even before a value is read. This means a key declared in `relations()` can appear in `Object.keys(model)` even when the raw value is `null` or missing.

## 6\. Model API

### Constructor

```
new Model(data = {}, options = {})
```

| Parameter | Description |
| --- | --- |
| data | Initial plain object data. Merged with `defaults()`. |
| options.source | Optional reactive source adapter. If absent, the model creates its own source using `MiniX_State`. |

A source adapter should expose:

```
{
  state,           // original state object when available
  path,            // base path string
  get(key),
  set(key, value),
  has(key),
  delete(key),
  watch(key, callback), // optional unless watch() is used
  raw()
}
```

### Overrideable hooks

| Method | Purpose |
| --- | --- |
| defaults() | Return default object data for a model. |
| relations() | Return relation definitions using `hasOne()` and `hasMany()`. |
| hasOne(ModelClass) | Declare a single nested model relation. |
| hasMany(ModelClass) | Declare an array relation wrapped by `Collection`. |

```
class User extends Model {
  defaults() {
    return { id: null, name: '', profile: null, roles: [] };
  }

  relations() {
    return {
      profile: this.hasOne(Profile),
      roles: this.hasMany(Role)
    };
  }
}
```

### Reading values

| Method | Returns | Description |
| --- | --- | --- |
| get(attr, fallback = null) | Any | Reads an attribute and applies relation wrapping if the key is a relation. |
| peek(attr, fallback = null) | Any | Reads raw state value without relation wrapping. |
| raw() | Object | Returns raw object-shaped state. |
| toJSON() | Object | Returns serialized plain data, converting nested models/collections to JSON. |

```
user.get('profile'); // Profile instance or null
user.peek('profile'); // raw object or null
user.raw();           // raw state object
user.toJSON();        // safe plain object for API/storage
```

### Writing values

| Method | Returns | Description |
| --- | --- | --- |
| set(attr, value) | this | Sets one value after serialization and relation validation. |
| fill(data) | this | Sets multiple values from a plain object. Uses `state.batch()` if available. |
| assign(data) | this | Alias of `fill()`. |

```
user.set('name', 'Ankit');
user.fill({ email: 'ankit@example.com', active: true });
user.assign({ name: 'Updated Name' });
```

### Cloning

| Method | Description |
| --- | --- |
| clone() | Creates a new detached model instance using current `toJSON()`. |
| cloneWith(data) | Creates a detached clone with extra/overridden data. |

```
const copy = user.clone();
const changed = user.cloneWith({ name: 'New Name' });
```

### Watching

```
const unwatch = user.watch('name', (value, oldValue) => {
  console.log('Name changed:', value);
});

// later
if (typeof unwatch === 'function') unwatch();
```

`watch()` depends on the underlying source/state supporting `watch()`.

### Static helpers

| Method | Description |
| --- | --- |
| Model.make(data, options) | Shortcut for `new this(data, options)`. |
| Model.fromState(state, path = '') | Binds model to a MiniX\_State-like instance at a path. |
| Model.fromStore(store, path = '') | Binds model to a store exposing `$stateManager`, `$store`, `state`, or state-like methods. |
| Model.bind(source, path = '') | Auto-detects state or store and binds accordingly. |

> [!NOTE]
> `fromState()` and `fromStore()` create live wrappers over existing state. They do not clone the data first.

## 7\. Relations

Relations let nested objects become real model instances and nested arrays become `Collection` instances.

### hasOne

```
class Profile extends Model {}

class User extends Model {
  relations() {
    return {
      profile: this.hasOne(Profile)
    };
  }
}

const user = new User({ profile: { bio: 'Coder' } });

user.profile instanceof Profile; // true
user.profile.bio;               // Coder
user.profile.bio = 'Builder';   // updates nested state
```

### hasMany

```
class Role extends Model {}

class User extends Model {
  relations() {
    return {
      roles: this.hasMany(Role)
    };
  }
}

const user = new User({ roles: [{ id: 1, name: 'admin' }] });

user.roles instanceof Collection; // true
user.roles.first() instanceof Role; // true
user.roles.push({ id: 2, name: 'editor' });
```

### Relation cache behavior

Relations are cached so repeated access returns the same wrapper instance.

```
user.roles === user.roles;     // true
user.profile === user.profile; // true when profile is not null
```

> [!NOTE]
> When you assign a new value to a relation key, the relation cache for that key is cleared. The next read creates a fresh wrapper bound to the new data.

### Null hasOne relation

```
const user = new User({ profile: null });
console.log(user.profile); // null

user.profile = { bio: 'Now exists' };
console.log(user.profile.bio); // Now exists
```

### Relation validation

Invalid relation definitions throw clear errors.

```
class BadUser extends Model {
  relations() {
    return {
      profile: { type: 'one', model: 42 } // invalid
    };
  }
}
```

## 8\. Reactive Binding

A model can be bound to existing state or store data. In this mode, the model is only a wrapper around live state.

### Bind to state

```
const state = new MiniX_State({
  auth: {
    user: {
      id: 1,
      name: 'Ankit',
      roles: [{ id: 1, name: 'admin' }]
    }
  }
});

const user = User.fromState(state, 'auth.user');

user.name = 'Updated';
console.log(state.get('auth.user.name')); // Updated
```

### Bind to store

```
const user = User.fromStore(store, 'auth.user');
// or
const user = User.bind(store, 'auth.user');
```

`fromStore()` checks these candidates in order:

1.  `store.$stateManager`
2.  `store.$store`
3.  `store.state`
4.  `store` itself

A valid state candidate must expose `get()`, `set()`, `has()`, and `delete()`. If none of the candidates match, `fromStore()` throws.

### Reactive child paths

Nested relation models are bound to nested paths. Example:

```
user.profile.bio = 'Hello';
// writes to: auth.user.profile.bio

user.roles.at(0).name = 'admin';
// writes to: auth.user.roles.0.name
```

### Detached vs live wrappers

| Creation style | Behavior |
| --- | --- |
| `new User(data)` | Creates its own reactive source backed by a fresh `MiniX_State`. |
| `User.fromState(...)` / `User.fromStore(...)` | Wraps existing live state in place. |
| `clone()` / `cloneWith()` | Creates detached copies with their own source. |

## 9\. Collection Concept

`Collection` wraps an array and guarantees that each readable item becomes an instance of the configured model class.

### Create detached collection

```
const roles = Collection.from(Role, [
  { id: 1, name: 'admin' },
  { id: 2, name: 'editor' }
]);
```

### Create with constructor

```
const roles = new Collection(Role, {
  items: [{ id: 1, name: 'admin' }]
});
```

### Array-like access

```
roles[0].name;   // admin
roles.at(0);     // same result
roles[-1];       // null because negative index is forwarded to at(-1)
```

`Collection.at(index)` does not implement JavaScript Array-style negative indexing. It returns `null` for negative indexes because the current implementation treats all negative indexes as out-of-range.

### Detached vs reactive collections

A detached collection stores a local array in memory. A reactive collection stores only a source adapter and reads/writes directly against live state.

```
const detached = Collection.from(Role, [{ id: 1 }]);
const reactive = user.roles; // relation-backed collection
```

Reactive collections cache child model wrappers by array index and state path, so repeated reads of the same live item return the same model instance until the array shape changes.

## 10\. Collection API

### Static helper

```
Collection.from(ModelClass, items = [])
```

Creates a detached collection from a model class and plain array data.

### Constructor

```
new Collection(ModelClass, options = {})
```

| Option | Description |
| --- | --- |
| items | Detached raw array data. |
| source | Reactive source adapter for live array data. |

> [!NOTE]
> Reactive collection child binding requires `source.state`. Without it, methods such as `at()` throw because child models cannot be bound to indexed paths.

### Read methods

| Method | Returns | Description |
| --- | --- | --- |
| all() | Model\[\] | Alias of `toArray()`. |
| toArray() | Model\[\] | Returns wrapped model instances. |
| toJSON() | Object\[\] | Returns serialized plain objects. |
| length | number | Current array length. |
| isEmpty() | boolean | True when length is zero. |
| at(index) | Model|null | Returns wrapped model or null when out-of-range. |
| first() | Model|null | First item. |
| last() | Model|null | Last item. |

### Mutation methods

| Method | Returns | Description |
| --- | --- | --- |
| push(item) | this | Adds an item at the end. Accepts model instance or plain object. |
| pushModel(data) | this | Alias-style helper for `push()`. |
| unshift(item) | this | Adds an item at the start. |
| unshiftModel(data) | this | Alias-style helper for `unshift()`. |
| pop() | Model|null | Removes last item and returns a detached clone. |
| shift() | Model|null | Removes first item and returns a detached clone. |
| removeAt(index) | Model|null | Removes item at index and returns detached clone. |
| removeWhere(callback) | Model\[\] | Removes matching items and returns detached clones. |
| removeBy(field, value) | Model\[\] | Removes items where field equals value. |
| removeById(id, key = 'id') | Model\[\] | Shortcut for `removeBy(key, id)`. |
| replaceAt(index, item) | this | Replaces item at index. Invalid index returns `this`. |
| updateAt(index, patch) | Model|null | Fills model at index with patch. |
| updateBy(field, value, patch) | Model|null | Finds by field and fills with patch. |
| updateById(id, patch, key = 'id') | Model|null | Shortcut for update by ID. |
| reset(items) | this | Replaces raw array. Does not validate each item before serialization. |
| resetModels(items) | this | Replaces array after normalizing each item. |
| replace(items) | this | Alias of `reset()`. |
| replaceModels(items) | this | Alias of `resetModels()`. |
| clear() | this | Empties the collection. |

### Query and iteration methods

| Method | Description |
| --- | --- |
| map(callback) | Maps over wrapped model instances. |
| filter(callback) | Filters wrapped model instances. |
| some(callback) | Checks if any wrapped model matches. |
| every(callback) | Checks if all wrapped models match. |
| forEach(callback) | Runs callback for each model and returns `this`. |
| find(callback) | Returns first matched model or `null`. |
| findBy(field, value) | Finds first model where field equals value. |
| findById(id, key = 'id') | Shortcut for `findBy(key, id)`. |
| pluck(field) | Returns values for one field. |
| ids(key = 'id') | Shortcut for `pluck(key)`. |
| has(field, value) | Checks if any model field equals value. |
| hasId(id, key = 'id') | Shortcut for `has(key, id)`. |
| sortBy(field, direction = 'asc') | Sorts collection by raw field value. |
| orderBy(field, direction = 'asc') | Alias of `sortBy()`. |
| reverse() | Reverses collection order. |
| watch(callback) | Watches reactive collection root. Reactive collections only. |
| \[Symbol.iterator\] | Allows `for...of` iteration with lazy model wrapping. |

### Return value contracts

*   `push()`, `unshift()`, `replaceAt()`, `reset()`, `clear()`, and similar bulk mutators return `this`.
*   `pop()`, `shift()`, and `removeAt()` return detached model clones or `null`.
*   `removeWhere()`, `removeBy()`, and `removeById()` return arrays of detached model clones.
*   `updateAt()`, `updateBy()`, and `updateById()` return the updated live model or `null`.

## 11\. Serialization

Both classes convert models and collections into plain JSON-safe data using `toJSON()`.

### Model serialization

```
const payload = user.toJSON();
// { id: 1, name: 'Ankit', profile: {...}, roles: [...] }
```

### Collection serialization

```
const rolesPayload = user.roles.toJSON();
// [{ id: 1, name: 'admin' }, { id: 2, name: 'editor' }]
```

### Circular reference protection

The serializer detects circular arrays/objects and throws an error instead of causing a stack overflow.

```
const a = {};
a.self = a;

user.set('bad', a); // throws circular reference error during serialization
```

### Supported values

*   Primitive values are stored as-is.
*   Arrays are recursively serialized.
*   Plain objects are recursively serialized.
*   Objects with `toJSON()` use their own `toJSON()`.
*   Non-plain objects without `toJSON()` are stored as-is.

## 12\. Complete Examples

### Example: Auth model

```
class Role extends Model {}
class Permission extends Model {}

class AuthModel extends Model {
  static fetcher = null;

  defaults() {
    return {
      user: null,
      roles: [],
      permissions: [],
      token: null
    };
  }

  relations() {
    return {
      roles: this.hasMany(Role),
      permissions: this.hasMany(Permission)
    };
  }

  static setFetcher(callback) {
    this.fetcher = callback;
  }

  async fetch() {
    if (typeof this.constructor.fetcher !== 'function') {
      throw new Error('AuthModel fetcher is not configured.');
    }

    const data = await this.constructor.fetcher();
    this.fill(data || {});
    return this;
  }

  login(data) {
    return this.fill(data);
  }

  logout() {
    return this.fill({ user: null, roles: [], permissions: [], token: null });
  }

  isLoggedIn() {
    return !!this.user;
  }

  hasRole(name) {
    return this.roles.has('name', name);
  }

  hasAnyRole(names = []) {
    return names.some(name => this.hasRole(name));
  }

  hasAllRoles(names = []) {
    return names.every(name => this.hasRole(name));
  }

  hasPerm(name) {
    return this.permissions.has('name', name);
  }

  hasAllPerms(names = []) {
    return names.every(name => this.hasPerm(name));
  }

  getRoles() {
    return this.roles.pluck('name');
  }

  getPerms() {
    return this.permissions.pluck('name');
  }
}
```

### Example: bind AuthModel to Mini-X store

```
const auth = AuthModel.bind(store, 'auth');

AuthModel.setFetcher(async () => {
  const response = await fetch('/api/me');
  return response.json();
});

await auth.fetch();

if (auth.hasRole('admin')) {
  console.log('Show admin menu');
}
```

### Example: CRUD style collection workflow

```
const roles = Collection.from(Role, []);

roles.push({ id: 1, name: 'admin' });
roles.push({ id: 2, name: 'editor' });
roles.updateById(2, { name: 'content-editor' });

const admin = roles.findBy('name', 'admin');
const ids = roles.ids();
const removed = roles.removeById(1);

console.log(admin?.toJSON());
console.log(ids);
console.log(removed.map(item => item.toJSON()));
```

### Example: relation CRUD

```
const user = new User({ roles: [] });

user.roles.push({ id: 1, name: 'admin' });
user.roles.push({ id: 2, name: 'editor' });

user.roles.updateById(2, { name: 'manager' });
user.roles.removeWhere(role => role.name === 'admin');

console.log(user.toJSON());
```

## 13\. Errors & Edge Cases

| Case | Error / Behavior |
| --- | --- |
| `new Collection(null)` | Throws: collection expects a model class. |
| Collection without `items` or `source` | Throws: collection requires source or items array. |
| Adding primitive to collection | Throws because collection items must be model instances or plain objects. |
| Standalone model without `MiniX_State` | Throws when the model tries to create its own source. |
| `fill()` with non-object | Throws because fill expects a plain object. |
| `updateAt()` patch not plain object | Throws. |
| `fromState()` with invalid state object | Throws because state-like methods are required. |
| `fromStore()` with unsupported store shape | Throws because no state candidate could be resolved. |
| `watch()` without watch support | Throws. |
| `hasMany()` without Collection loaded | Throws when relation is accessed. |
| Reactive collection source missing `state` | Throws when reading child model. |
| Model raw state is not object-shaped | `raw()` throws in strict mode. |
| Out-of-range collection access | Returns `null`. |

### Detached clone behavior on removal

`pop()`, `shift()`, `removeAt()`, and `removeWhere()` return detached clones, not live reactive models. This prevents returned models from pointing at deleted/reindexed state paths.

```
const removed = user.roles.pop();
removed.name = 'changed locally';
// Does not write back to removed collection path.
```

### Reset vs resetModels

`reset()` is a raw-data bulk operation. Use `resetModels()` when you want validation/normalization before replacing the list.

```
roles.reset([{ id: 1, name: 'admin' }]);       // raw replace
roles.resetModels([{ id: 2, name: 'editor' }]); // validates as model/plain object
```

## 14\. Best Practices

##### 1\. Always define defaults for relation keys

Use `null` for `hasOne` and `[]` for `hasMany`. This keeps state shape predictable.

```
defaults() {
  return {
    profile: null,
    roles: []
  };
}
```

##### 2\. Use `get()` when you need fallback values

Direct property access returns exactly what state returns. `get('key', fallback)` is better when missing values need defaults.

```
const name = user.get('name', 'Guest');
```

##### 3\. Use `peek()` for raw relation data

Use `peek()` when you want raw nested data instead of wrapped models/collections.

```
const rawRoles = user.peek('roles', []);
```

##### 4\. Use `toJSON()` before API calls

Never send the proxy/model instance directly to an API. Serialize it first.

```
await fetch('/api/user', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(user.toJSON())
});
```

##### 5\. Cache length in hot loops

`length` reads the current array each time. For tight loops, cache it.

```
for (let i = 0, len = roles.length; i < len; i++) {
  console.log(roles.at(i).name);
}
```

##### 6\. Prefer collection helpers over raw array mutation

Use `push()`, `updateById()`, `removeWhere()`, etc. so cache invalidation and serialization happen correctly.

## 15\. Full Reference Cheat Sheet

### Model

```
// Create
new User(data)
User.make(data)
User.fromState(state, path)
User.fromStore(store, path)
User.bind(sourceOrStore, path)

// Hooks
defaults()
relations()
hasOne(ModelClass)
hasMany(ModelClass)

// Read
user.name
user.get('name', fallback)
user.peek('profile', null)
user.raw()
user.toJSON()

// Write
user.name = 'Ankit'
user.set('name', 'Ankit')
user.fill({ name: 'Ankit' })
user.assign({ name: 'Ankit' })
delete user.name

// Reactivity
user.watch('name', callback)

// Copy
user.clone()
user.cloneWith({ active: false })
```

### Collection

```
// Create
new Collection(User, { items: [] })
Collection.from(User, [])

// Read
users.length
users.isEmpty()
users[0]
users.at(0)
users.first()
users.last()
users.all()
users.toArray()
users.toJSON()

// Add
users.push({ id: 1 })
users.pushModel({ id: 1 })
users.unshift({ id: 1 })
users.unshiftModel({ id: 1 })

// Remove
users.pop()
users.shift()
users.removeAt(0)
users.removeWhere(user => !user.active)
users.removeBy('email', 'x@example.com')
users.removeById(1)

// Update
users.replaceAt(0, { id: 1, name: 'New' })
users.updateAt(0, { name: 'New' })
users.updateBy('email', 'x@example.com', { active: false })
users.updateById(1, { active: true })

// Replace all
users.reset(rawItems)
users.resetModels(items)
users.replace(rawItems)
users.replaceModels(items)
users.clear()

// Query
users.map(callback)
users.filter(callback)
users.some(callback)
users.every(callback)
users.forEach(callback)
users.find(callback)
users.findBy('name', 'Ankit')
users.findById(1)
users.pluck('name')
users.ids()
users.has('role', 'admin')
users.hasId(1)

// Ordering
users.sortBy('name', 'asc')
users.orderBy('created_at', 'desc')
users.reverse()

// Reactivity / iteration
users.watch(callback)
for (const user of users) {}
```

## 16\. Recommended Improvements for Future Version

The current implementation is solid, but these additions would make it even more developer-friendly:

*   `Collection.at(-1)` could behave like `Array.prototype.at(-1)` and return the last item.
*   Add `Collection.findIndex()`, `where()`, `countBy()`, and `groupBy()`.
*   Add `Model.has(attr)` and `Model.delete(attr)` public methods for users who prefer method calls over operators.
*   Add TypeScript declarations for better IDE auto-completion.
*   Add ESM exports: `export default Model` / `export default Collection`.
*   Add relation metadata helpers like `isRelation(key)` and `relationKeys()`.

Generated from the provided `Model.js` and `Collection.js` source files.