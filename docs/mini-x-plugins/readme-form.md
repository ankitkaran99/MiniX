---
product: Mini-X Validate + Ajax
summary: Validation and ajax form handling for Mini-X, including reactive errors, form rules, and submit lifecycle helpers.
badges: ["Validation","Ajax submit","Reactive errors","Forms"]
highlights: ["x-validate rule-driven form checks","Reactive $errors object in templates","MiniXValidatePlugin and MiniXAjaxPlugin working together"]
metrics: ["Rules::Field validation","Errors::Reactive scope","Ajax::Submit flow","Helpers::$validate APIs"]
sidebar: Use this guide to wire validation rules, show field errors, and connect validated forms to ajax submission callbacks.
---

# MiniX Validate + Ajax - README

> **Product:** Mini-X Validate + Ajax
> **Summary:** Validation and ajax form handling for Mini-X, including reactive errors, form rules, and submit lifecycle helpers.
> **Focus:** `Validation` | `Ajax submit` | `Reactive errors` | `Forms`
>
> **Key Highlights:**
> - x-validate rule-driven form checks
> - Reactive $errors object in templates
> - MiniXValidatePlugin and MiniXAjaxPlugin working together
> **Metrics & Scope:**
> - **Rules:** Field validation
> - **Errors:** Reactive scope
> - **Ajax:** Submit flow
> - **Helpers:** $validate APIs

---

# MiniX Validate + Ajax Plugin - Usage Guide

## 1\. Include Scripts

```
<script src="../../src/MiniX.js"></script>
<script src="../../src/Inspect.js"></script>
<script src="../../src/mini-x-plugins/plugin-form.js"></script>
```

## 2\. Basic Form Setup

```
<form
  x-validate
  x-validate-on="blur|input"
  x-ajax="{ onSuccess: 'onSuccess', onFailure: 'onFailure', onLoader: 'setLoading' }">

  <input name="email">
  <div class="err" x-show="$errors.email" x-text="$errors.email || ''"></div>

  <button type="submit">Submit</button>
</form>
```

## 3\. Define Rules in Component

```
class MyApp {
  data() {
    return { loading: false };
  }

  rules() {
    return [
      { field: 'email', rules: { required: true, email: true }, pretty: 'Email' }
    ];
  }
}
```

## 4\. Available Helpers

```
this.$errors          // reactive object — read per field: this.$errors.email
this.$validate()      // run validation, returns Promise<boolean>
this.$validateForm()  // alias for $validate()
this.$clearErrors()   // reset all field errors
```

## 5\. Error Display

Errors are exposed via the reactive **$errors** scope object. Bind directly in the template using **x-show** and **x-text** — no `data-error-for` nodes or manual DOM writes needed:

```
<!-- one div per field -->
<div class="err" x-show="$errors.email"   x-text="$errors.email   || ''"></div>
<div class="err" x-show="$errors.name"    x-text="$errors.name    || ''"></div>
<div class="err" x-show="$errors.message" x-text="$errors.message || ''"></div>
```

`x-show` handles visibility automatically. The `|| ''` keeps the expression safe when the value is null.

## 6\. Ajax Callbacks

```
onSuccess(data, form, response) {}
onFailure(data, form, response) {}
setLoading(active) {}
```

## 7\. Mount App

```
MiniX.createApp(MyApp)
  .use(MiniXValidatePlugin)
  .use(MiniXAjaxPlugin)
  .mount('#app');
```

## Notes

*   Validation blocks submit automatically
*   Inspect.js is required
*   Do **not** use `data-error-for` — it is no longer supported. Use `x-show="$errors.field"` and `x-text="$errors.field || ''"` instead
*   A corresponding `data()` entry is **not** required for every field in `rules()` — errors live in plugin-managed state, not component data
*   `x-validate-on="blur|input"` enables live validation as the user types or leaves a field