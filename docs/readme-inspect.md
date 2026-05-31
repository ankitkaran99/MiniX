---
product: Inspect Validator
summary: Reference documentation for the Inspect validation class, including form parsing, rule schemas, validators, file checks, and custom error rendering.
badges: ["Validation class","Rule engine","Form parsing","Custom validators"]
highlights: ["Validate DOM forms and plain state objects","Bootstrap-friendly default error handling","Large built-in validator surface with extension points"]
metrics: ["Rules::Config driven","Forms::DOM parsing","Files::Client-side checks","State::Plain object validation"]
sidebar: Use this guide to configure Inspect rules, understand parsing behavior, customize messages and rendering, and extend the validator set.
---

# Inspect Class Deep Documentation

> **Product:** Inspect Validator
> **Summary:** Reference documentation for the Inspect validation class, including form parsing, rule schemas, validators, file checks, and custom error rendering.
> **Focus:** `Validation class` | `Rule engine` | `Form parsing` | `Custom validators`
>
> **Key Highlights:**
> - Validate DOM forms and plain state objects
> - Bootstrap-friendly default error handling
> - Large built-in validator surface with extension points
> **Metrics & Scope:**
> - **Rules:** Config driven
> - **Forms:** DOM parsing
> - **Files:** Client-side checks
> - **State:** Plain object validation

---

Deep Documentation

# Inspect JavaScript Validation Class

A complete guide for the `Inspect` class: form validation, state/data validation, Bootstrap-style error rendering, rule configuration, file checks, custom messages, and validator internals.

## 1\. Overview

`Inspect` is a lightweight JavaScript validation utility that can validate both actual HTML forms and plain JavaScript state objects. It is designed around simple rule objects and includes a large built-in validator set.

It works well with Bootstrap because the default error handler adds `is-invalid` classes and creates `.invalid-feedback` elements automatically.

> [!NOTE]
> **Form mode:** reads fields from a container using `[name]`, validates them, and shows inline errors.

> [!NOTE]
> **State mode:** validates plain objects using the same rules without touching the DOM.

## 2\. Quick Start

### HTML

```
<form id="userForm">
  <div class="mb-3">
    <label class="form-label">Name</label>
    <input type="text" name="name" class="form-control">
  </div>

  <div class="mb-3">
    <label class="form-label">Email</label>
    <input type="email" name="email" class="form-control">
  </div>

  <button class="btn btn-primary">Submit</button>
</form>
```

### JavaScript

```
const inspect = new Inspect();

const validator = inspect.init(document.querySelector('#userForm'), [
  {
    field: 'name',
    pretty: 'Name',
    rules: {
      required: true,
      minlen: 3,
      maxlen: 50
    }
  },
  {
    field: 'email',
    pretty: 'Email address',
    rules: {
      required: true,
      email: true
    }
  }
]);

document.querySelector('#userForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const result = await validator.validate();

  if (!result.valid) {
    console.log(result.errors);
    return;
  }

  console.log('Clean data:', result.data);
});
```

The result object always has this structure:

```
{
  valid: true | false,
  errors: {
    fieldName: 'Error message'
  },
  data: {
    fieldName: 'parsed value'
  }
}
```

## 3\. Rule Format

Each field rule is an object with `field`, optional `pretty`, `rules`, and optional custom `messages`.

```
{
  field: 'password',
  pretty: 'Password',
  rules: {
    required: true,
    minlen: 8,
    regex: '^(?=.*[A-Z])(?=.*[0-9]).+$'
  },
  messages: {
    regex: 'Password must contain at least one uppercase letter and one number.'
  }
}
```

| Property | Required | Purpose |
| --- | --- | --- |
| `field` | Yes | Field name. Must match the HTML `name` attribute or object key. |
| `pretty` | No | Human-friendly label used in messages through `{1}`. |
| `rules` | Yes | Object where keys are validator names and values are validator parameters. |
| `messages` | No | Field-specific message overrides. |

## 4\. Constructor

### `new Inspect(options = {})`

Creates a new validator instance. The passed options are merged over the built-in defaults.

```
const inspect = new Inspect({
  warnOnMissingValidator: true,
  singleCheckboxMode: 'boolean',
  messages: {
    required: '{1} cannot be blank.',
    email: 'Enter a correct email address.'
  },
  errorHandler(field, message, config, show) {
    // Custom UI rendering here
  }
});
```

> [!NOTE]
> **Message merge:** `options.messages` is merged with the built-in defaults, so you can override only the keys you need.

> [!NOTE]
> **Missing validator warnings:** when `warnOnMissingValidator` is enabled, unknown rule names are logged once per field/rule pair. The default is enabled outside production and disabled in production.

> [!NOTE]
> **Single checkbox mode:** the default parser returns the checkbox value when checked and an empty string when unchecked. Set `singleCheckboxMode: 'boolean'` if you want `true`/`false` instead.

## 5\. Public API

### `init(container, rules)`

Registers the form/container and converts the rules array into an internal object keyed by field name.

```
const api = inspect.init(formElement, rules);
```

Returns a small API object:

```
{
  validate,
  validateData,
  parseFormData,
  clearErrors
}
```

### `validate(source = null, isState = false)`

Validates either a form/container or a plain object depending on `isState`.

```
await validator.validate();              // validates initialized form
await validator.validate(otherForm);     // validates another container
await validator.validate(data, true);    // validates plain object
```

### `validateData(data)`

Shortcut for `validate(data, true)`. It validates a JavaScript object and does not show DOM errors.

```
const result = await validator.validateData({
  email: 'demo@example.com',
  age: 25
});
```

### `parseFormData(container = this.formElement)`

Reads every element with a `name` attribute and returns parsed data plus grouped field references.

```
const { data, fieldsByName } = validator.parseFormData();
```

### `validateField(field, value, rule, allData)`

Validates a single field value against one rule object. This is async because custom validators may also be async.

### `clearErrors()`

Removes all displayed validation errors from the initialized form.

## 6\. Form Parsing Behavior

`parseFormData()` groups all fields by `name`. This is important for checkbox groups, radio groups, and repeated fields.

| Field type | Returned value |
| --- | --- |
| Normal input/select/textarea | Trimmed string value when possible. |
| Single checkbox | Checkbox value if checked, otherwise empty string. Use `singleCheckboxMode: 'boolean'` for `true`/`false`. |
| Multiple checkboxes with same name | Array of checked values. |
| Radio group | Selected value, otherwise empty string. |
| Single file input | First `File` object or `null`. |
| Multiple file input | Array of `File` objects. |

**Practical tip:** use the same `name` for checkbox groups and radio groups. Inspect automatically understands these groups.

## 7\. Validation Flow

1.  `validate()` clears previous errors unless validating state data.
2.  It builds a payload using `parseFormData()` or the passed plain object.
3.  Each configured field rule is checked in order.
4.  `required` is checked first.
5.  `accepted` is checked next.
6.  `required_if` is checked next.
7.  If the field value is empty (and not required / the conditional `required_if` condition is not met), other validators are skipped.
8.  Validators run one by one. The first failed validator returns its message.
9.  Form mode shows errors using `errorHandler`.
10. State mode only returns errors and does not touch the DOM.

```
const result = await validator.validate();

if (result.valid) {
  // result.data contains parsed values
} else {
  // result.errors contains first error per field
}
```

## 8\. Message System

Messages are resolved in this order:

1.  Field-specific message: `rule.messages[ruleName]`
2.  Global configured message: `this.config.messages[ruleName]`
3.  Fallback: `Invalid`

### Placeholders

| Placeholder | Replacement |
| --- | --- |
| `{0}` | Rule parameter. Arrays are joined by comma. |
| `{1}` | `pretty` label, or `field` if no pretty label exists. |

```
{
  field: 'age',
  pretty: 'Age',
  rules: { min: 18 },
  messages: {
    min: '{1} must be at least {0} years.'
  }
}
```

## 9\. Default Error Handler

The default handler is Bootstrap-friendly.

### Normal fields

*   Adds `is-invalid` to the field.
*   Creates a sibling `<div class="invalid-feedback">` if missing.
*   Removes the class and feedback element when the error is cleared.

### Checkbox/radio groups

*   Looks for the nearest `.form-group`, `[data-inspect-group]`, `fieldset`, `.form-check`, or parent element.
*   Adds `is-invalid` to all inputs of the same type inside that group.
*   Creates `.invalid-feedback.d-block` inside the group.

> [!NOTE]
> **Wrapper note:** `.form-group` still works, but it is no longer the only supported grouped wrapper. For custom markup, `data-inspect-group` is the clearest explicit hook.

### Custom error handler example

```
const inspect = new Inspect({
  errorHandler(field, message, config, show = true) {
    const wrapper = field.closest('.field-wrap') || field.parentNode;

    if (show) {
      field.classList.add('is-invalid');
      let error = wrapper.querySelector('.field-error');
      if (!error) {
        error = document.createElement('small');
        error.className = 'field-error text-danger d-block mt-1';
        wrapper.appendChild(error);
      }
      error.textContent = message;
    } else {
      field.classList.remove('is-invalid');
      wrapper.querySelector('.field-error')?.remove();
    }
  }
});
```

## 10\. Built-in Validators

Validators are stored in `Inspect.validators`. Each validator returns `true` for success and `false` for failure. Async validators are also supported because `validateField()` awaits every validator.

### Required and conditional validators

Because these rules govern whether other validation checks should run or whether a field must have a value, they are evaluated at the beginning of the validation flow (prior to checking if the field value is empty):

<table class="table table-bordered table-sm api-table"><tbody><tr><td>required</td><td>Field must not be empty (null, undefined, empty string, or empty array). Checked first.</td></tr><tr><td>accepted</td><td>Field value must be accepted (must be one of <code>'yes'</code>, <code>'on'</code>, <code>'1'</code>, <code>1</code>, <code>true</code>, or <code>'true'</code>). Checked second.</td></tr><tr><td>required_if</td><td>Field is required conditionally based on another field's value. Checked third.</td></tr></tbody></table>

### Numeric validators

<table class="table table-bordered table-sm api-table"><tbody><tr><td>min</td><td>Value must be greater than or equal to parameter.</td></tr><tr><td>max</td><td>Value must be less than or equal to parameter.</td></tr><tr><td>min_eq</td><td>Alias-like behavior for greater than or equal.</td></tr><tr><td>max_eq</td><td>Alias-like behavior for less than or equal.</td></tr><tr><td>lower</td><td>Value must be strictly lower than parameter.</td></tr><tr><td>higher</td><td>Value must be strictly higher than parameter.</td></tr><tr><td>multiple_of</td><td>Value must be divisible by parameter.</td></tr><tr><td>numeric</td><td>Allows integers and decimals, positive or negative.</td></tr><tr><td>integer</td><td>Allows only whole numbers.</td></tr><tr><td>digits</td><td>Must contain exactly N digits.</td></tr></tbody></table>

### String length validators

<table class="table table-bordered table-sm api-table"><tbody><tr><td>minlen</td><td>String length must be at least parameter.</td></tr><tr><td>maxlen</td><td>String length must not exceed parameter.</td></tr><tr><td>exact_len</td><td>String length must be exactly parameter.</td></tr></tbody></table>

### Array / checkbox group validators

<table class="table table-bordered table-sm api-table"><tbody><tr><td>min_elem</td><td>Array length must be greater than parameter.</td></tr><tr><td>max_elem</td><td>Array length must be less than parameter.</td></tr><tr><td>exact_elem</td><td>Array length must equal parameter.</td></tr><tr><td>min_eq_elem</td><td>Array length must be at least parameter.</td></tr><tr><td>max_eq_elem</td><td>Array length must be at most parameter.</td></tr></tbody></table>

### Format validators

<table class="table table-bordered table-sm api-table"><tbody><tr><td>email</td><td>Basic email format check.</td></tr><tr><td>url</td><td>Uses the browser <code>URL</code> constructor.</td></tr><tr><td>domain</td><td>Validates domain names.</td></tr><tr><td>phone</td><td>E.164-like phone validation after removing spaces, dashes, and brackets.</td></tr><tr><td>uuid</td><td>UUID v1-v5 compatible format.</td></tr><tr><td>mac_address</td><td>MAC address using colon or dash separators.</td></tr><tr><td>json</td><td>Checks whether value can be parsed by <code>JSON.parse()</code>.</td></tr><tr><td>credit_card</td><td>Uses Luhn algorithm.</td></tr><tr><td>base64</td><td>Checks using <code>atob</code>/<code>btoa</code>.</td></tr><tr><td>hex_color</td><td>Allows 3 or 6 digit hex color, with optional <code>#</code>.</td></tr><tr><td>slug</td><td>Lowercase letters, numbers, and dashes.</td></tr><tr><td>pincode</td><td>Indian 6-digit PIN code, cannot start with 0.</td></tr><tr><td>pan_card</td><td>Indian PAN format.</td></tr><tr><td>aadhaar</td><td>12-digit Aadhaar-like format, first digit 2-9.</td></tr></tbody></table>

### Text character validators

<table class="table table-bordered table-sm api-table"><tbody><tr><td>alpha</td><td>Letters only.</td></tr><tr><td>alpha_num</td><td>Letters and numbers.</td></tr><tr><td>alpha_dash</td><td>Letters, numbers, dash, underscore.</td></tr><tr><td>alpha_spaces</td><td>Letters and spaces.</td></tr><tr><td>alpha_num_space</td><td>Letters, numbers, and spaces.</td></tr><tr><td>user_name</td><td>Unicode letters and spaces.</td></tr><tr><td>lowercase</td><td>Must equal its lowercase version.</td></tr><tr><td>uppercase</td><td>Must equal its uppercase version.</td></tr><tr><td>char</td><td>Only characters listed in the parameter are allowed.</td></tr><tr><td>regex</td><td>Must match regex pattern.</td></tr><tr><td>not_regex</td><td>Must not match regex pattern.</td></tr><tr><td>starts_with</td><td>Must start with parameter.</td></tr><tr><td>ends_with</td><td>Must end with parameter.</td></tr></tbody></table>

### Comparison validators

<table class="table table-bordered table-sm api-table"><tbody><tr><td>equal</td><td>Value must loosely equal parameter.</td></tr><tr><td>n_equal</td><td>Value must not loosely equal parameter.</td></tr><tr><td>equal_to</td><td>Value must match another field or object path.</td></tr><tr><td>different</td><td>Value must differ from another field or object path.</td></tr><tr><td>in_arr</td><td>Value must exist in allowed array.</td></tr><tr><td>not_in</td><td>Value must not exist in blacklist array.</td></tr></tbody></table>

### Date and time validators

Date validators use strict `YYYY-MM-DD` parsing for predictable comparisons.

<table class="table table-bordered table-sm api-table"><tbody><tr><td>date</td><td>Valid <code>YYYY-MM-DD</code> date.</td></tr><tr><td>date_min</td><td>Date must be greater than or equal.</td></tr><tr><td>date_max</td><td>Date must be less than or equal.</td></tr><tr><td>date_exact</td><td>Date timestamp must exactly match.</td></tr><tr><td>date_lower</td><td>Date must be strictly before.</td></tr><tr><td>date_higher</td><td>Date must be strictly after.</td></tr><tr><td>date_equal</td><td>Date timestamp must exactly match.</td></tr><tr><td>time</td><td>Valid 24-hour <code>HH:mm</code> or <code>HH:mm:ss</code>.</td></tr><tr><td>time_min</td><td>Time must be greater than or equal.</td></tr><tr><td>time_max</td><td>Time must be less than or equal.</td></tr><tr><td>time_exact</td><td>Time must exactly match.</td></tr><tr><td>time_lower</td><td>Time must be strictly earlier.</td></tr><tr><td>time_higher</td><td>Time must be strictly later.</td></tr><tr><td>time_equal</td><td>Time must exactly match.</td></tr></tbody></table>

## 11\. File Validation

File validators are automatically passed the file collection instead of the normal value.

```
{
  field: 'avatar',
  pretty: 'Profile photo',
  rules: {
    required: true,
    file_format_in: ['jpg', 'jpeg', 'png', 'image/webp'],
    file_size_max: 2048
  }
}
```

<table class="table table-bordered table-sm api-table"><tbody><tr><td>file_format_in</td><td>Every selected file must match an allowed extension or MIME token.</td></tr><tr><td>file_format_nin</td><td>No selected file may match a disallowed extension or MIME token.</td></tr><tr><td>file_size_min</td><td>Every selected file must be at least N KB.</td></tr><tr><td>file_size_max</td><td>Every selected file must be at most N KB.</td></tr></tbody></table>

> [!NOTE]
> Client checks support file extensions like `png` or `.png` and MIME tokens like `image/png` or `image/*`. This is still client-side only, so validate uploads again on the server.

## 12\. Validating Plain State / JSON Data

`validateData()` allows the same rules to work without an HTML form. This is useful with Mini-X state, Alpine, Vue-like local objects, API payloads, or custom model classes.

```
const result = await validator.validateData({
  user: {
    email: 'ankit@example.com'
  },
  password: 'secret123',
  confirm_password: 'secret123'
});
```

### Object path support

`equal_to`, `different`, and `required_if` can read nested paths using dot syntax or bracket syntax.

```
{
  field: 'confirm_password',
  pretty: 'Confirm password',
  rules: {
    required: true,
    equal_to: 'password'
  }
}

{
  field: 'billing.city',
  pretty: 'Billing city',
  rules: {
    required_if: 'shipping.same_as_billing,false'
  }
}

{
  field: 'notes',
  rules: {
    required_if: ['status', 'needs,review']
  }
}

{
  field: 'notes',
  rules: {
    required_if: { field: 'status', value: 'needs,review' }
  }
}

{
  field: 'tracking_number',
  rules: {
    required_if: { field: 'shipping_method', equal: 'courier' }
  }
}

{
  field: 'manager_comment',
  rules: {
    required_if: { field: 'status', in: ['rejected', 'needs_changes'] }
  }
}

{
  field: 'alternate_contact',
  rules: {
    required_if: { field: 'contact_method', not_in: ['email', 'sms'] }
  }
}

{
  field: 'cancellation_reason',
  rules: {
    required_if: { field: 'status', not_equal: 'active' }
  }
}
```

**Current limitation:** `validateData()` reads values directly by `payload.data[fieldName]`. So nested field names like `billing.city` are not automatically resolved for the main field value. Nested paths are supported inside some comparison validators, but not as the primary field key unless your data object also has a literal key named `billing.city`.

## 13\. Custom Validators

Add new validators by attaching functions to `Inspect.validators`.

```
Inspect.validators.strong_password = function (value, param, field, allData) {
  if (value === '') return true;
  return /[A-Z]/.test(value) && /[0-9]/.test(value) && String(value).length >= 8;
};
```

Use it like any built-in validator:

```
{
  field: 'password',
  pretty: 'Password',
  rules: {
    required: true,
    strong_password: true
  },
  messages: {
    strong_password: 'Password must contain uppercase, number, and minimum 8 characters.'
  }
}
```

### Async validator example

```
Inspect.validators.unique_email = async function (value) {
  if (value === '') return true;

  const res = await fetch('/api/check-email?email=' + encodeURIComponent(value));
  const json = await res.json();

  return json.available === true;
};
```

## 14\. Complete Examples

### Registration form

```
const inspect = new Inspect();

const validator = inspect.init(document.querySelector('#registerForm'), [
  {
    field: 'name',
    pretty: 'Name',
    rules: { required: true, minlen: 3, maxlen: 80 }
  },
  {
    field: 'email',
    pretty: 'Email',
    rules: { required: true, email: true }
  },
  {
    field: 'password',
    pretty: 'Password',
    rules: { required: true, minlen: 8 }
  },
  {
    field: 'confirm_password',
    pretty: 'Confirm password',
    rules: { required: true, equal_to: 'password' }
  },
  {
    field: 'terms',
    pretty: 'Terms',
    rules: { accepted: true },
    messages: { accepted: 'Please accept the terms.' }
  }
]);
```

### Checkbox group

```
<div class="form-group mb-3">
  <label class="form-label">Skills</label>
  <label><input type="checkbox" name="skills" value="php"> PHP</label>
  <label><input type="checkbox" name="skills" value="node"> Node</label>
  <label><input type="checkbox" name="skills" value="flutter"> Flutter</label>
</div>
```

```
{
  field: 'skills',
  pretty: 'Skills',
  rules: {
    required: true,
    min_eq_elem: 2
  },
  messages: {
    min_eq_elem: 'Select at least {0} skills.'
  }
}
```

### Laravel-like submit flow

```
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const result = await validator.validate();

  if (!result.valid) return;

  const formData = new FormData(form);

  const response = await fetch(form.action, {
    method: 'POST',
    headers: {
      'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]').content
    },
    body: formData
  });

  const json = await response.json();
  console.log(json);
});
```

## 15\. Gotchas, Edge Cases, and Improvement Notes

> [!NOTE]
> **1\. Message overrides:** `messages` now deep-merge with defaults, so partial overrides are safe.

> [!NOTE]
> **2\. Unknown validators:** missing validator names can log a warning in development through `warnOnMissingValidator`.

> [!NOTE]
> **3\. Date parsing:** date rules are intentionally strict and expect `YYYY-MM-DD`.

> [!NOTE]
> **4\. File validation:** client checks can inspect extension and MIME-style tokens, but upload validation must still happen on the server.

> [!NOTE]
> **5\. Single checkbox:** default output is still `value` or empty string for compatibility; switch to `singleCheckboxMode: 'boolean'` if your state wants booleans.

> [!NOTE]
> **6\. Checkbox/radio UI:** grouped error rendering supports several wrapper patterns, with `data-inspect-group` as an explicit fallback hook.

> [!NOTE]
> **7\. `required_if` params:** strings still use the first comma as the separator, arrays keep the remaining values as one comma-preserving comparison value, and objects support `value`/`equal`, `in`, `not_in`, and `not_equal`.

## 16\. Compact Rule Reference

| Category | Rules |
| --- | --- |
| Required | `required`, `required_if`, `accepted` |
| Number | `numeric`, `integer`, `digits`, `min`, `max`, `min_eq`, `max_eq`, `lower`, `higher`, `multiple_of` |
| Length | `minlen`, `maxlen`, `exact_len` |
| Array | `min_elem`, `max_elem`, `exact_elem`, `min_eq_elem`, `max_eq_elem` |
| Choice | `in_arr`, `not_in` |
| Compare | `equal`, `n_equal`, `equal_to`, `different` |
| Text | `alpha`, `alpha_num`, `alpha_dash`, `alpha_spaces`, `alpha_num_space`, `user_name`, `lowercase`, `uppercase`, `char`, `regex`, `not_regex`, `starts_with`, `ends_with` |
| Format | `email`, `url`, `domain`, `phone`, `uuid`, `mac_address`, `json`, `credit_card`, `base64`, `hex_color`, `slug`, `pincode`, `pan_card`, `aadhaar` |
| Date/time | `date`, `date_min`, `date_max`, `date_exact`, `date_lower`, `date_higher`, `date_equal`, `time`, `time_min`, `time_max`, `time_exact`, `time_lower`, `time_higher`, `time_equal` |
| File | `file_format_in`, `file_format_nin`, `file_size_min`, `file_size_max` |

Generated documentation for `Inspect` class based on the uploaded source file.