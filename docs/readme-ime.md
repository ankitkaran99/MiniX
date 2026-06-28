---
product: Input Mask Engine
summary: Deep documentation for the InputMaskEngine core and its vanilla DOM adapter, including tokens, caret handling, paste rules, and integration patterns.
badges: ["Engine core","Vanilla adapter","Caret aware","Custom tokens"]
highlights: ["DOM-free masking engine with compile/apply APIs","Browser adapter for data-mask and data-mask-free","Fixed masks, free masks, and custom token flows"]
metrics: ["Engine::Pure logic","Adapter::DOM binding","Tokens::Custom rules","Caret::Precise edits"]
sidebar: This document covers the masking engine itself, the DOM adapter behavior, token semantics, edge cases, and testing guidance.
---

# InputMaskEngine + MaskEngineDOM Deep Documentation

> **Product:** Input Mask Engine
> **Summary:** Deep documentation for the InputMaskEngine core and its vanilla DOM adapter, including tokens, caret handling, paste rules, and integration patterns.
> **Focus:** `Engine core` | `Vanilla adapter` | `Caret aware` | `Custom tokens`
>
> **Key Highlights:**
> - DOM-free masking engine with compile/apply APIs
> - Browser adapter for data-mask and data-mask-free
> - Fixed masks, free masks, and custom token flows
> **Metrics & Scope:**
> - **Engine:** Pure logic
> - **Adapter:** DOM binding
> - **Tokens:** Custom rules
> - **Caret:** Precise edits

---

# InputMaskEngine + Vanilla Adapter Documentation

Deep documentation for the uploaded masking system: `InputMaskEngine`, `MaskEngineDOM`, and the vanilla demo. It explains fixed masks, free masks, caret handling, paste behavior, deletion, custom tokens, and DOM binding.

Vanilla JSUMD/CommonJS friendlyFixed masksFree masksCustom tokensCaret aware

## 1\. Files in this package

| File | Purpose | Main global/export |
| --- | --- | --- |
| `input-mask-engine.js` | Pure masking engine. It compiles masks, validates input, inserts characters, handles paste, backspace, delete, and caret positions. | `InputMaskEngine` |
| `vanilla-adapter.js` | DOM adapter. It scans `input[data-mask]` and `input[data-mask-free]`, binds browser events, and applies engine results to real fields. | `MaskEngineDOM` |
| `vanilla-mask-demo.html` | Runnable demo showing fixed phone/code masks, free OTP mask, and a custom hexadecimal token. | Demo page |

> [!NOTE]
> Best design choice here: the engine is DOM-free. You can reuse it in React, Vue, Alpine, Mini-X, Node tests, or any browser adapter without rewriting the masking rules.

## 2\. Quick start

### Browser usage

```
<script src="../src/InputMaskEngine.js"></script>
<script src="../src/InputMaskEngineAdapter.js"></script>

<input data-mask="(999) 999 - 9999" placeholder="Phone">
<input data-mask="AA-9999" placeholder="Code">
<input data-mask-free="{ token: '9', max: 6 }" placeholder="OTP">
```

The adapter auto-initializes on `DOMContentLoaded`. You can also call `MaskEngineDOM.init()` manually after adding dynamic inputs.

### Custom token usage

```
MaskEngineDOM.init({
  tokens: {
    Z: {
      test: ch => /[A-Fa-f0-9]/.test(ch),
      transform: ch => ch.toUpperCase()
    }
  }
});
```

### Direct engine usage

```
const engine = new InputMaskEngine();
const mask = engine.compile('(999) 999 - 9999');

let state = { value: '', selectionStart: 0, selectionEnd: 0 };
state = engine.apply({ ...state, mask, input: '9' });
state = engine.apply({ ...state, mask, input: '8' });

console.log(state.value); // "(98"
```

## 3\. Mental model

The system works in three layers:

### 1\. Compile

`compile(mask)` turns a mask string or free-mask object into an internal description.

### 2\. Apply operation

`apply`, `paste`, `backspace`, or `deleteForward` receives current value, selection, and input.

### 3\. Return new state

The engine returns `{ ok, value, selectionStart, selectionEnd, reason? }`. The adapter writes it back.

```
{
  mask: compiledMask,
  value: '(987) 65',
  selectionStart: 8,
  selectionEnd: 8,
  input: '4'
}
```

## 4\. Token system

Tokens define which characters are accepted and how they are transformed.

| Token | Accepts | Transform | Example |
| --- | --- | --- | --- |
| `A` | Letters only | Uppercase | `a` → `A` |
| `a` | Letters only | Lowercase | `B` → `b` |
| `9` | Digits only | No change | `7` |
| `X` | Letters or digits | No change | `A`, `8` |
| `*` | Any single character | No change | `@`, `a`, `5` |

```
const engine = new InputMaskEngine({
  tokens: {
    H: {
      test: ch => /[0-9A-Fa-f]/.test(ch),
      transform: ch => ch.toUpperCase()
    }
  }
});
```

## 5\. Fixed mask mode

A fixed mask is a string such as `(999) 999 - 9999` or `AA-9999`. Token symbols become input slots. Everything else becomes a literal.

```
const compiled = engine.compile('(999) 999 - 9999');
```

Literals are not blindly shown from the start. The renderer shows literals only up to the last meaningful filled token area, avoiding empty skeletons like `(___) ___ - ____`.

```
// Typing 9876543210 into (999) 999 - 9999
(987) 654 - 3210
```

Use backslash when a token-like character should be treated as a literal.

```
const mask = engine.compile('ORDER-\A-999');
```

## 6\. Free mask mode

A free mask accepts repeated characters of one token up to a maximum length. It does not render literals.

```
const otpMask = engine.compile({ type: 'free', token: '9', max: 6 });

<input data-mask-free="{ token: '9', max: 6 }" placeholder="6 digit OTP">
```

| Use case | Example |
| --- | --- |
| OTP / PIN | `{ token: '9', max: 6 }` |
| Hex code | `{ token: 'Z', max: 8 }` |
| Username-like constrained input | Custom token for letters, digits, underscore |

`apply()` is strict. `paste()` is forgiving and filters invalid characters.

## 7\. `InputMaskEngine` API

### Constructor

```
const engine = new InputMaskEngine({ tokens: {} });
```

### `compile(mask)`

```
engine.compile('AA-9999');
engine.compile({ type: 'free', token: '9', max: 6 });
```

### `apply(payload)`

Strict typed input insertion.

```
engine.apply({ mask: 'AA-9999', value: 'AB-12', selectionStart: 5, selectionEnd: 5, input: '3' });
```

### `paste(payload)`

Forgiving paste insertion.

```
engine.paste({ mask: '(999) 999 - 9999', value: '', selectionStart: 0, selectionEnd: 0, input: 'Phone: 9876543210' });
```

### `accepts(payload)`

Checks whether an input would be accepted and returns `{ ok, reason }`.

### `backspace(payload)` and `deleteForward(payload)`

Delete selected ranges or the nearest filled token in the expected direction.

| Payload property | Description |
| --- | --- |
| `mask` | Raw or compiled mask. |
| `value` | Current value. |
| `selectionStart` | Caret/selection start. |
| `selectionEnd` | Caret/selection end. |
| `input` | Text to insert for apply/paste. |

| Result property | Meaning |
| --- | --- |
| `ok` | Accepted or rejected. |
| `value` | New masked value. |
| `selectionStart` | New caret start. |
| `selectionEnd` | New caret end. |
| `reason` | Optional rejection reason. |

## 8\. `MaskEngineDOM` API

### `MaskEngineDOM.init(scopeOrOptions?, maybeOptions?)`

```
MaskEngineDOM.init();
MaskEngineDOM.init(document.querySelector('#modalBody'));
MaskEngineDOM.init({ tokens: { Z: { test: ch => /[A-Fa-f0-9]/.test(ch) } } });
MaskEngineDOM.init(document.querySelector('#modalBody'), { tokens: {} });
```

### `MaskEngineDOM.bind(el, options)`

```
const input = document.querySelector('#phone');
MaskEngineDOM.bind(input, { tokens: {} });
```

### Cleanup

```
if (el.__maskCleanup) el.__maskCleanup();
```

## 9\. Browser event behavior

| Event/Input type | Engine method | Behavior |
| --- | --- | --- |
| `beforeinput` + `insertText` | `apply()` | Strict typed insertion. |
| `beforeinput` + `insertFromPaste` | `paste()` | Paste using `e.data`. |
| `paste` | `paste()` | Reads clipboard text. |
| `deleteContentBackward` | `backspace()` | Backward delete. |
| `deleteContentForward` / `deleteByCut` | `deleteForward()` | Forward delete/cut. |

After applying a result, the adapter dispatches a bubbling `input` event, so normal validation/listeners still run.

## 10\. Practical examples

```
<input data-mask="99999 99999" placeholder="98765 43210">
<input data-mask="AA-99-AA-9999" placeholder="RJ-14-AB-1234">
<input data-mask="AAAA0999999" placeholder="SBIN0123456">
<input data-mask-free="{ token: 'H', max: 6 }" placeholder="FF9900">
```

```
MaskEngineDOM.init({
  tokens: {
    H: { test: ch => /[0-9a-fA-F]/.test(ch), transform: ch => ch.toUpperCase() }
  }
});
```

## 11\. Integration notes

### Dynamically inserted HTML

```
const row = document.createElement('div');
row.innerHTML = '<input data-mask="AA-9999">';
document.querySelector('#rows').appendChild(row);
MaskEngineDOM.init(row);
```

### Bootstrap modal

```
const modal = document.querySelector('#customerModal');
modal.addEventListener('shown.bs.modal', () => MaskEngineDOM.init(modal));
```

### CommonJS / Node tests

```
const InputMaskEngine = require('./input-mask-engine');
const engine = new InputMaskEngine();
```

## 12\. Edge cases and gotchas

*   `data-mask-free` is parsed with `new Function`, so only use it with trusted HTML.
*   Only `<input>` elements are supported by the adapter; textareas are ignored.
*   Already-bound inputs are skipped using `__maskBound`.
*   Initial values are remasked by replaying characters through the engine.
*   Modern `beforeinput` support is expected.
*   Client masks are UX helpers, not security. Always validate on the server too. DevTools is the villain with a keyboard.

## 13\. Security and production hardening

For untrusted HTML, replace `new Function` parsing with JSON parsing:

```
function parseFreeDefinition(attr) {
  if (!attr) return null;
  try {
    const parsed = JSON.parse(attr);
    if (!parsed || typeof parsed !== 'object') return null;
    return { type: 'free', ...parsed };
  } catch (err) {
    console.error('Invalid data-mask-free:', attr, err);
    return null;
  }
}
```

```
<input data-mask-free='{"token":"9","max":6}'>
```

## 14\. Testing checklist

| Scenario | Expected result |
| --- | --- |
| Type valid characters | Accepted and literals appear correctly. |
| Type invalid character | Value unchanged, `ok:false`. |
| Paste mixed text | Valid chars extracted, invalid skipped. |
| Backspace before literal | Previous filled token is deleted. |
| Select range and type | Range clears and replacement starts at range start. |
| Free mask max length | Typed extras reject; pasted extras truncate. |
| Dynamic DOM init | New fields bind after `init(container)`. |

```
const assert = require('assert');
const InputMaskEngine = require('./input-mask-engine');
const engine = new InputMaskEngine();

const r = engine.paste({
  mask: '(999) 999 - 9999', value: '', selectionStart: 0, selectionEnd: 0,
  input: 'abc9876543210xyz'
});
assert.equal(r.value, '(987) 654 - 3210');
```

## 15\. Reference tables

| Class/Object | Method | Purpose |
| --- | --- | --- |
| `InputMaskEngine` | `compile(mask)` | Converts mask definition to compiled structure. |
| `InputMaskEngine` | `apply(payload)` | Strict text insertion. |
| `InputMaskEngine` | `paste(payload)` | Forgiving paste insertion. |
| `InputMaskEngine` | `accepts(payload)` | Checks whether insertion is valid. |
| `InputMaskEngine` | `backspace(payload)` | Deletes backward / selected range. |
| `InputMaskEngine` | `deleteForward(payload)` | Deletes forward / selected range. |
| `MaskEngineDOM` | `init()` | Scans and binds matching inputs. |
| `MaskEngineDOM` | `bind()` | Binds one input. |

### Suggested future improvements

*   Add `textarea` support.
*   Add JSON-only parser mode for `data-mask-free`.
*   Add public `destroy(el)` method.
*   Add optional placeholder rendering like `(___) ___-____`.
*   Add `unmask(value, mask)` and `format(value, mask)` helpers.
*   Add ESM export for modern bundlers.

## 16\. Final implementation notes

This package is already split cleanly: the engine owns logic, while the adapter owns browser behavior. Keep that separation. Any future framework adapter should call the same engine methods instead of copying rules into UI code.

Generated documentation for the uploaded `InputMaskEngine`, `MaskEngineDOM`, and vanilla demo files.