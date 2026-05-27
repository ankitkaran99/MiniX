---
product: Mini-X Mask
summary: Reactive input masking for Mini-X with literal masks, free-form token masks, custom tokens, and caret-aware editing.
badges: ["Input masks","Literal patterns","Free masks","Custom tokens"]
highlights: ["x-mask for fixed formatted inputs","x-mask-free for token-constrained input","Engine-backed caret and paste behavior"]
metrics: ["Masks::Literal and free","Tokens::Customizable","Caret::Preserved edits","Input::Reactive formatting"]
sidebar: This guide explains the two masking directives, dynamic mask definitions, custom token registration, and engine integration details.
---

# MiniX Mask Plugin · Complete documentation

> **Product:** Mini-X Mask
> **Summary:** Reactive input masking for Mini-X with literal masks, free-form token masks, custom tokens, and caret-aware editing.
> **Focus:** `Input masks` | `Literal patterns` | `Free masks` | `Custom tokens`
>
> **Key Highlights:**
> - x-mask for fixed formatted inputs
> - x-mask-free for token-constrained input
> - Engine-backed caret and paste behavior
> **Metrics & Scope:**
> - **Masks:** Literal and free
> - **Tokens:** Customizable
> - **Caret:** Preserved edits
> - **Input:** Reactive formatting

---

# 🎭 MiniX Mask Plugin

Effortless, reactive input masking for MiniX apps — literal patterns & free-form token masks with smart caret handling.

v1.2.0

📌 Overview

**MiniX Mask Plugin** brings declarative input masking to the `MiniX` reactive framework. It provides two powerful directives: `x-mask` for literal placeholder masks _(e.g., phone, date)_ and `x-mask-free` for token‑based constraints (digits only, alphanumeric, custom sets). Built on top of the robust **InputMaskEngine**, the plugin handles real‑time formatting, deletions, paste, composition events, and reactive mask updates.

> [!NOTE]
> ⚡ **Reactive by nature** — Mask definitions can depend on component data (dynamic token, max length) and will recompile & reformat automatically.

✨ Key features

**🎯 Literal masks**  
Pattern like `"(999) 999-9999"` — digits replace `9`, letters replace `A`, and more.

**🔓 Free masks**  
Define allowed character set via token (`'9'`, `'A'`, `'X'`, custom) + max length.

**🔄 Reactive definitions**  
Bind mask parameters directly to component state → dynamic validation rules.

**🧹 Smart editing**  
Backspace, delete, paste, and composition events are fully controlled & caret position preserved.

**🧩 Custom tokens**  
Extend engine with your own token logic (`test` + `transform`).

**⚡ Minimal overhead**  
Compiled masks are cached, directives use efficient event listeners.

📦 Installation

Include the required scripts in your HTML (order matters):

```
<script src="../../src/MiniX.js"></script>
<script src="../../src/InputMaskEngine.js"></script>
<script src="../../src/mini-x-plugins/plugin-mask.js"></script>
```

Then register the plugin with your MiniX app:

```
MiniX.createApp(App)
  .use(MiniX_Mask_Plugin())       // basic usage
  .mount('#app');
```

The plugin automatically registers `x-mask` and `x-mask-free` directives on all text-like inputs.

🎛️ Directives API

🔹 `x-mask` – Literal mask

Accepts a static string pattern where placeholder characters define allowed input. Uses the engine’s default token set **(9, A, a, X)** plus any custom tokens registered via plugin options.

```
<input x-model="phone" x-mask="(999) 999-9999" placeholder="(123) 456-7890" />
```

**Example output:** typed `1234567890` → `(123) 456-7890`

🔹 `x-mask-free` – Free / token‑based mask

Configurable with an object or shorthand string. Perfect for length‑restricted fields like OTP, coupon codes, or custom character classes.

```
<!-- only digits, max 6 characters -->
<input x-model="otp" x-mask-free="{ token: '9', max: 6 }" />

<!-- shorthand: unlimited alphanumeric (token 'X') -->
<input x-mask-free="'X'" />

<!-- dynamic reactive mask -->
<input x-mask-free="{ token: dynamicToken, max: dynamicMax }" />
```

> [!NOTE]
> 💡 **Shorthand forms:** `x-mask-free="'9'"` → unlimited digits. `x-mask-free="{ max: 4 }"` (default token `'9'`) → up to 4 digits.

⚙️ Free mask definition (deep dive)

The free mask accepts a definition object with the following properties:

| Property | Type | Description | Default |
| --- | --- | --- | --- |
| `token` | string | Character class identifier (built‑in or custom). | `'9'` |
| `max` | number | Maximum allowed characters. Use `Infinity` or large number for unlimited. | `Infinity` |

**Built‑in token behaviours (InputMaskEngine default):**

| Token | Accepted characters | Transform |
| --- | --- | --- |
| `9` | digits `0-9` | none |
| `A` | uppercase A-Z | toUpperCase |
| `a` | lowercase a-z | toLowerCase |
| `X` | alphanumeric `A-Za-z0-9` | none |
| `*` (custom) | user‑defined | custom transform |

**Example:** uppercase letters only, max 4 chars: `{ token: 'A', max: 4 }` → "HELL" becomes "HELL".

🔄 Reactive & dynamic masks

Both directives re-evaluate the mask expression whenever the component data changes. This enables powerful conditional formatting.

```
data() {
  return {
    inputCode: '',
    maskType: '9',    // '9' or 'X' or 'A'
    maxLen: 8
  };
},
view: `
  <input x-model="inputCode" 
         x-mask-free="{ token: maskType, max: maxLen }" />
  <select x-model="maskType">
    <option>9</option><option>X</option><option>A</option>
  </select>
`
```

Whenever `maskType` or `maxLen` updates, the plugin recompiles the mask and reapplies formatting automatically without losing caret context.

🧬 Custom tokens & plugin configuration

Pass a token map to `MiniX_Mask_Plugin(options)` to extend or override token behaviour. This works for both literal masks (`x-mask`) and free masks.

```
MiniX_Mask_Plugin({
  // define token 'Z' for hex characters (0-9, A-F) + uppercase transform
  Z: {
    test: ch => /[A-Fa-f0-9]/.test(ch),
    transform: ch => ch.toUpperCase(),
  },
  // override token '9' to allow only even digits (example)
  '9': {
    test: ch => /[02468]/.test(ch),
    transform: ch => ch,
  }
});
```

You can also pass **full engine options**:

```
MiniX_Mask_Plugin({
  tokens: { HEX: { test: /[0-9A-F]/i, transform: v => v.toUpperCase() } },
  engineOptions: { /* custom InputMaskEngine settings */ }
});
```

**Usage with literal mask:** after registering token `Z`, pattern `"ZZZ-ZZ"` will only accept hexadecimal characters.

⚙️ How it works (integration details)

The plugin installs two directives that attach to `<input>` or `<textarea>` elements. It intercepts `beforeinput`, `keydown`, `paste`, and composition events to apply formatting via **InputMaskEngine** methods: `apply()`, `paste()`, `backspace()`, `deleteForward()`. Changes are synced back to the MiniX model via `x-model` automatically.

*   ✅ Works seamlessly with `x-model` two‑way binding.
*   ✅ IME composition support (Chinese, Japanese, etc.) — masks are applied after composition end.
*   ✅ Maintains caret position after each edit.
*   ✅ Performance: compiled masks are cached using stable serialization.

> [!NOTE]
> 🧪 **Developer tip:** Both directives respect `priority: 675`, ensuring they run before typical event handlers. You can safely combine with other MiniX directives.

📝 Live examples (snippets)

**📞 US Phone**

```
<input x-mask="(999) 999-9999">
```

Literal digits mask with static separators.

**🔢 OTP (6 digits)**

```
x-mask-free="{ token:'9', max:6 }"
```

Allows exactly 6 numeric characters.

**🎫 Promo code (hex, 8)**

```
x-mask-free="{ token:'Z', max:8 }"
```

Uses custom token Z (hex + uppercase).

**🆔 Alphanumeric serial**

```
x-mask-free="{ token:'X', max:12 }"
```

Letters & digits, max 12 chars.

🧩 Complete component integration

```
const { createApp } = MiniX;

const App = {
  data() {
    return {
      phone: '',
      coupon: '',
      dynamicToken: '9',
      maxLen: 6
    };
  },
  view: `
    <div>
      <input x-model="phone" x-mask="(999) 999-9999" placeholder="Phone" />
      <input x-model="coupon" x-mask-free="{ token: dynamicToken, max: maxLen }" placeholder="Dynamic" />
      <select x-model="dynamicToken">
        <option>9</option><option>A</option><option>X</option>
      </select>
    </div>
  `
};

createApp(App)
  .use(MiniX_Mask_Plugin({ 
    Z: { test: ch => /[A-F0-9]/i.test(ch), transform: v => v.toUpperCase() } 
  }))
  .mount('#app');
```

📚 Plugin API reference

| Parameter | Type | Description |
| --- | --- | --- |
| `engine` | Constructor | Optional custom InputMaskEngine class (by default uses global `InputMaskEngine`). |
| `tokens` | Object | Custom token definitions merged into engine. Each key is a token character, value is `{ test: RegExp|function, transform?: function }`. |
| `engineOptions` | Object | Options passed when instantiating the engine (e.g., `placeholderChar`). |

**Shortcut:** if you pass an object without `tokens`/`engine` keys, it is treated as a token map: `MiniX_Mask_Plugin({ Z: {...}, H: {...} })`.

```
// Both forms are valid
.use(MiniX_Mask_Plugin({ tokens: { HEX: {...} } }))
.use(MiniX_Mask_Plugin({ HEX: {...} }))   // auto-detected
```

⚠️ Important notes

*   **Dependency:** `input-mask-engine.js` MUST be loaded before `plugin-mask.js`. The plugin looks for `window.InputMaskEngine`.
*   **Text inputs only:** Directives are ignored on `type="checkbox"`, `radio`, `file`, etc.
*   **Model update:** The formatted value is automatically written back to the component’s data (via `x-model` binding). No extra glue code needed.
*   **Mask compilation:** Expressions are re-evaluated reactively, but intensive mask changes (e.g., every keystroke) are cached to avoid overhead.
*   **Custom token naming:** Use single characters (except built‑in tokens) for literal mask patterns. Free masks work with any token string (single char recommended).

> [!NOTE]
> 🧹 **Caret stability:** The plugin uses `setSelectionRange` after each mask operation to preserve expected cursor position. Edge cases like rapid IME composition are fully handled.

🎬 Interactive demo

Check the included `demo-mask.html` for a fully interactive playground. It showcases phone formatting, OTP field, reactive dynamic masks, and custom `Z` token for hexadecimal input.

You can also open browser devtools to inspect reactive updates — mask expressions log their recompilation only when necessary.

* * *

MiniX Mask Plugin · Built on InputMaskEngine · Perfectly paired with MiniX reactive core  
© MIT license — free for production and open source.