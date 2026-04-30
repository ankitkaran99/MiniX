class Inspect {
    constructor(options = {}) {
        this.defaults = {
            errorHandler: (field, message, config, show = true) => {
                if (!field || typeof field.closest !== 'function') return;

                if (field.type === 'checkbox' || field.type === 'radio') {
                    const formGroup = field.closest('.form-group');
                    if (!formGroup) return;

                    if (show) {
                        const inputs = formGroup.querySelectorAll(`input[type="${field.type}"]`);
                        inputs.forEach(input => input.classList.add('is-invalid'));

                        let errorElement = formGroup.querySelector('.invalid-feedback');
                        if (!errorElement) {
                            errorElement = document.createElement('div');
                            errorElement.className = 'invalid-feedback d-block';
                            formGroup.appendChild(errorElement);
                        }
                        errorElement.textContent = message;
                    } else {
                        const inputs = formGroup.querySelectorAll(`input[type="${field.type}"]`);
                        inputs.forEach(input => input.classList.remove('is-invalid'));

                        const errorElement = formGroup.querySelector('.invalid-feedback');
                        if (errorElement) errorElement.remove();
                    }
                } else {
                    if (show) {
                        field.classList.add('is-invalid');

                        let errorElement = field.nextElementSibling;
                        if (!errorElement || !errorElement.classList.contains('invalid-feedback')) {
                            errorElement = document.createElement('div');
                            errorElement.className = 'invalid-feedback';
                            field.parentNode.insertBefore(errorElement, field.nextSibling);
                        }
                        errorElement.textContent = message;
                    } else {
                        field.classList.remove('is-invalid');

                        const errorElement = field.nextElementSibling;
                        if (errorElement && errorElement.classList.contains('invalid-feedback')) {
                            errorElement.remove();
                        }
                    }
                }
            },

            messages: {
                required: '{1} is required.',
                min: 'Value must be at least {0}.',
                max: 'Value must be less than or equal to {0}.',
                min_eq: 'Value must be greater than or equal to {0}.',
                max_eq: 'Value must be less than or equal to {0}.',
                multiple_of: 'Value must be a multiple of {0}.',
                minlen: 'Must be at least {0} characters long.',
                maxlen: 'Must not exceed {0} characters.',
                exact_len: 'Must be exactly {0} characters long.',
                min_elem: 'Must have more than {0} elements.',
                max_elem: 'Must have less than {0} elements.',
                exact_elem: 'Must have exactly {0} elements.',
                min_eq_elem: 'Must have at least {0} elements.',
                max_eq_elem: 'Must have at most {0} elements.',
                in_arr: 'Selected value is not valid.',
                n_in_arr: 'Selected value is not allowed.',
                equal: 'Value must be equal to {0}.',
                n_equal: 'Value must not be equal to {0}.',
                equal_to: 'Values do not match.',
                lower: 'Value must be less than {0}.',
                higher: 'Value must be greater than {0}.',
                regex: 'Invalid format.',
                email: 'Please enter a valid email address.',
                domain: 'Please enter a valid domain name.',
                url: 'Please enter a valid URL.',
                numeric: '{1} must be a number.',
                integer: '{1} must be an integer.',
                digits: '{1} must be exactly {0} digits.',
                alpha: '{1} may only contain letters.',
                alpha_num: '{1} may only contain letters and numbers.',
                alpha_dash: '{1} may only contain letters, numbers, dashes, and underscores.',
                alpha_spaces: '{1} may only contain letters and spaces.',
                user_name: '{1} may only contain user names.',
                starts_with: '{1} must start with "{0}".',
                ends_with: '{1} must end with "{0}".',
                not_regex: '{1} format is invalid.',
                different: '{1} and {0} must be different.',
                accepted: '{1} must be accepted.',
                lowercase: '{1} must be lowercase.',
                uppercase: '{1} must be uppercase.',
                phone: 'Please enter a valid phone number.',
                uuid: '{1} must be a valid UUID.',
                mac_address: '{1} must be a valid MAC address.',
                boolean: '{1} must be true or false.',
                json: '{1} must be a valid JSON string.',
                char: 'Invalid characters. Must be {0}.',
                date: 'Please enter a valid date.',
                date_min: 'Date must be after {0}.',
                date_max: 'Date must be before {0}.',
                date_exact: 'Date must be {0}.',
                date_lower: 'Date must be before {0}.',
                date_higher: 'Date must be after {0}.',
                date_equal: 'Date must be {0}.',
                time: 'Please enter a valid time.',
                time_min: 'Time must be after {0}.',
                time_max: 'Time must be before {0}.',
                time_exact: 'Time must be {0}.',
                time_lower: 'Time must be before {0}.',
                time_higher: 'Time must be after {0}.',
                time_equal: 'Time must be {0}.',
                file_format_in: 'Invalid file type. Allowed types: {0}.',
                file_format_nin: 'File type not allowed: {0}.',
                file_size_min: 'File must be at least {0}KB.',
                file_size_max: 'File must not exceed {0}KB.',
                credit_card: 'Please enter a valid credit card number.',
                alpha_num_space: '{1} may only contain letters, numbers, and spaces.',
                base64: '{1} must be a valid Base64 string.',
                hex_color: '{1} must be a valid hexadecimal color.',
                slug: '{1} may only contain lowercase letters, numbers, and dashes.',
                required_if: '{1} is required when {0} is present.',
                not_in: 'The selected {1} is invalid.',
                pincode: 'Please enter a valid 6-digit PIN code.',
                pan_card: 'Please enter a valid PAN card number.',
                aadhaar: 'Please enter a valid 12-digit Aadhaar number.'
            }
        };

        this.config = {
            ...this.defaults,
            ...options
        };

        this.rules = {};
        this.formElement = null;
    }

    init(container, rules) {
        if (!container) throw new Error('Container required');

        this.formElement = container;

        this.rules = rules.reduce((acc, rule) => {
            acc[rule.field] = rule;
            return acc;
        }, {});

        return {
            validate: this.validate.bind(this),
            validateData: this.validateData.bind(this),
            parseFormData: this.parseFormData.bind(this),
            clearErrors: this.clearErrors.bind(this)
        };
    }

    // -------------------------
    // PARSE (NEW CORE METHOD)
    // -------------------------
    parseFormData(container = this.formElement) {
        const data = {};
        const fieldsByName = {};

        container.querySelectorAll('[name]').forEach(field => {
            const name = field.name;
            if (!fieldsByName[name]) fieldsByName[name] = [];
            fieldsByName[name].push(field);
        });

        Object.entries(fieldsByName).forEach(([name, fields]) => {
            data[name] = this._extractFieldValue(fields);
        });

        return { data, fieldsByName };
    }

    // -------------------------
    // MAIN VALIDATE
    // -------------------------
    async validate(source = null, isState = false) {
        if (!isState) this.clearErrors();

        const payload = isState
            ? { data: source || {}, fieldsByName: {} }
            : this.parseFormData(source || this.formElement);

        let valid = true;
        const errors = {};

        for (const [fieldName, rule] of Object.entries(this.rules)) {
            const fields = payload.fieldsByName[fieldName] || [];
            const field = fields[0] || null;
            const value = payload.data[fieldName];

            const result = await this.validateField(field, value, rule, payload.data);

            if (result !== true) {
                valid = false;
                errors[fieldName] = result;

                if (!isState && field) {
                    this.showError(field, result);
                }
            } else {
                if (!isState && field) {
                    this.clearError(field);
                }
            }
        }

        return { valid, errors, data: payload.data };
    }

    async validateData(data) {
        return this.validate(data, true);
    }

    async validateField(field, value, rule, allData) {
        const isFileField = field?.type === 'file';
        const fileValue = isFileField ? field.files : value;

        if (rule.rules.required && !this.checkRequired(fileValue)) {
            return this.getMessage(rule, 'required');
        }

        if (Inspect._isEmptyValue(fileValue)) return true;

        for (const [ruleName, ruleValue] of Object.entries(rule.rules)) {
            if (ruleName === 'required') continue;

            const validator = Inspect.validators[ruleName];
            if (!validator) continue;

            const validatorValue = (
                isFileField &&
                (ruleName === 'file_format_in' || ruleName === 'file_format_nin' || ruleName === 'file_size_min' || ruleName === 'file_size_max')
            )
                ? fileValue
                : value;

            const result = await validator.call(this, validatorValue, ruleValue, field, allData);

            if (result !== true) {
                return this.getMessage(rule, ruleName);
            }
        }

        return true;
    }

    getMessage(rule, ruleName) {
        const msg =
            (rule.messages && rule.messages[ruleName]) ||
            this.config.messages[ruleName] ||
            'Invalid';

        const ruleParam = rule?.rules?.[ruleName];
        return String(msg)
            .replace(/\{0\}/g, Array.isArray(ruleParam) ? ruleParam.join(', ') : (ruleParam ?? ''))
            .replace(/\{1\}/g, rule.pretty || rule.field);
    }

    // -------------------------
    // HELPERS
    // -------------------------
    _extractFieldValue(fields) {
        if (fields.length > 1) {
            if (fields[0].type === 'checkbox') {
                return fields.filter(f => f.checked).map(f => f.value);
            }

            if (fields[0].type === 'radio') {
                const selected = fields.find(f => f.checked);
                return selected ? selected.value : '';
            }
        }

        const field = fields[0];

        if (field.type === 'file') {
            return field.multiple ? Array.from(field.files || []) : (field.files?.[0] || null);
        }

        if (field.type === 'checkbox') {
            return field.checked ? field.value : '';
        }

        return field.value?.trim?.() ?? field.value;
    }

    checkRequired(value) {
        if (typeof FileList !== 'undefined' && value instanceof FileList) return value.length > 0;
        if (Array.isArray(value)) return value.length > 0;
        if (value && typeof value === 'object' && 'name' in value && 'size' in value) return true;
        return value !== '' && value !== null && value !== undefined;
    }

    static _isEmptyValue(value) {
        if (typeof FileList !== 'undefined' && value instanceof FileList) return value.length === 0;
        if (Array.isArray(value)) return value.length === 0;
        return value === '' || value === undefined || value === null;
    }

    static _getByPath(obj, path) {
        if (!obj || !path) return undefined;
        return String(path)
            .replace(/\[(\w+)\]/g, '.$1')
            .split('.')
            .filter(Boolean)
            .reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
    }

    static _timeToMinutes(value) {
        const match = String(value ?? '').trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
        if (!match) return NaN;
        const hours = Number(match[1]);
        const minutes = Number(match[2]);
        const seconds = Number(match[3] || 0);
        if (hours > 23 || minutes > 59 || seconds > 59) return NaN;
        return hours * 60 + minutes + (seconds / 60);
    }

    showError(field, message) {
        this.config.errorHandler(field, message, this.config, true);
    }

    clearError(field) {
        this.config.errorHandler(field, '', this.config, false);
    }

    clearErrors() {
        if (!this.formElement) return;

        this.formElement
            .querySelectorAll('input, select, textarea')
            .forEach(f => this.clearError(f));
    }

    // -------------------------
    // VALIDATORS
    // -------------------------
    static validators = {
        required: (v) => v !== '' && v !== null && v !== undefined,
        min: (v, m) => v === '' || parseFloat(v) >= m,
        max: (v, m) => v === '' || parseFloat(v) <= m,
        min_eq: (v, m) => v === '' || parseFloat(v) >= m,
        max_eq: (v, m) => v === '' || parseFloat(v) <= m,
        multiple_of: (v, m) => v === '' || (m != 0 && parseFloat(v) % m === 0),
        minlen: (v, m) => v === '' || String(v).length >= m,
        maxlen: (v, m) => v === '' || String(v).length <= m,
        exact_len: (v, l) => v === '' || String(v).length === l,
        min_elem: (v, m) => v.length > m,
        max_elem: (v, m) => v.length < m,
        exact_elem: (v, l) => v.length == l,
        min_eq_elem: (v, m) => Array.isArray(v) ? v.length >= m : true,
        max_eq_elem: (v, m) => Array.isArray(v) ? v.length <= m : true,
        in_arr: (v, a) => v === '' || (Array.isArray(a) && a.includes(v)),
        n_in_arr: (v, a) => v === '' || (Array.isArray(a) && !a.includes(v)),
        equal: (v, e) => v === '' || v == e,
        n_equal: (v, e) => v === '' || v != e,
        equal_to: function(v, o, f, allData) {
            const otherValue = Inspect._getByPath(allData, o);
            if (otherValue !== undefined) return v === '' || v === otherValue;
            const other = this.formElement?.querySelector?.(`[name="${o}"]`);
            return v === '' || (other && v === other.value);
        },
        different: function(v, o, f, allData) {
            const otherValue = Inspect._getByPath(allData, o);
            if (otherValue !== undefined) return v === '' || v !== otherValue;
            const other = this.formElement?.querySelector?.(`[name="${o}"]`);
            return v === '' || (other && v !== other.value);
        },
        regex: (v, p) => v === '' || new RegExp(p).test(String(v)),
        email: (v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v)),
        url: (v) => {
            if (v === '') return true;
            try {
                new URL(v);
                return true;
            } catch {
                return false;
            }
        },
        numeric: (v) => v === '' || /^-?\d*\.?\d+$/.test(String(v)),
        integer: (v) => v === '' || /^-?\d+$/.test(String(v)),
        digits: (v, l) => v === '' || (/^\d+$/.test(String(v)) && String(v).length == l),
        alpha: (v) => v === '' || /^[a-zA-Z]+$/.test(String(v)),
        alpha_num: (v) => v === '' || /^[a-zA-Z0-9]+$/.test(String(v)),
        alpha_dash: (v) => v === '' || /^[a-zA-Z0-9_\-]+$/.test(String(v)),
        alpha_spaces: (v) => v === '' || /^[a-zA-Z\s]+$/.test(String(v)),
        user_name: (v) => v === '' || /^[\p{L}\s]+$/u.test(String(v)),
        lowercase: (v) => v === '' || String(v) === String(v).toLowerCase(),
        uppercase: (v) => v === '' || String(v) === String(v).toUpperCase(),
        accepted: (v) => ['yes', 'on', '1', 1, true, 'true'].includes(v),
        lower: (v, limit) => v === '' || parseFloat(v) < limit,
        higher: (v, limit) => v === '' || parseFloat(v) > limit,
        phone: (v) => v === '' || /^\+?[1-9]\d{1,14}$/.test(String(v).replace(/[\s\-\(\)]/g, '')),
        uuid: (v) => v === '' || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v)),
        domain: (v) => v === '' || /^(?=.{1,253}$)(?!-)(?:[a-zA-Z0-9-]{1,63}\.)+[a-zA-Z]{2,63}$/.test(String(v)),
        json: (v) => {
            if (v === '') return true;
            try {
                JSON.parse(v);
                return true;
            } catch {
                return false;
            }
        },
        starts_with: (v, prefix) => v === '' || String(v).startsWith(String(prefix)),
        ends_with: (v, suffix) => v === '' || String(v).endsWith(String(suffix)),
        not_regex: (v, pattern) => v === '' || !new RegExp(pattern).test(String(v)),
        mac_address: (v) => v === '' || /^(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/.test(String(v)),
        boolean: (v) => v === '' || ['true', 'false', '1', '0', 'yes', 'no', 'on', 'off'].includes(String(v).toLowerCase()),
        char: (v, allowed) => {
            if (v === '') return true;
            const allowedChars = Array.isArray(allowed) ? allowed.join('') : String(allowed ?? '');
            const escaped = allowedChars.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return new RegExp(`^[${escaped}]+$`).test(String(v));
        },
        date: (v) => v === '' || !isNaN(Date.parse(v)),
        date_min: (v, minDate) => v === '' || new Date(v) >= new Date(minDate),
        date_max: (v, maxDate) => v === '' || new Date(v) <= new Date(maxDate),
        date_exact: (v, exactDate) => v === '' || new Date(v).getTime() === new Date(exactDate).getTime(),
        date_lower: (v, limitDate) => v === '' || new Date(v) < new Date(limitDate),
        date_higher: (v, limitDate) => v === '' || new Date(v) > new Date(limitDate),
        date_equal: (v, equalDate) => v === '' || new Date(v).getTime() === new Date(equalDate).getTime(),
        time: (v) => v === '' || /^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/.test(v),
        time_min: function(v, t) {
            return v === '' || Inspect._timeToMinutes(v) >= Inspect._timeToMinutes(t);
        },
        time_max: function(v, t) {
            return v === '' || Inspect._timeToMinutes(v) <= Inspect._timeToMinutes(t);
        },
        time_exact: (v, t) => v === '' || Inspect._timeToMinutes(v) === Inspect._timeToMinutes(t),
        time_lower: (v, t) => v === '' || Inspect._timeToMinutes(v) < Inspect._timeToMinutes(t),
        time_higher: (v, t) => v === '' || Inspect._timeToMinutes(v) > Inspect._timeToMinutes(t),
        time_equal: (v, t) => v === '' || Inspect._timeToMinutes(v) === Inspect._timeToMinutes(t),
        file_format_in: (files, a) => {
            if (!files || files.length === 0) return true;
            const allowed = Array.isArray(a) ? a : String(a).split(',').map(part => part.trim().toLowerCase()).filter(Boolean);
            return Array.from(files).every(f => allowed.includes(f.name.split('.').pop().toLowerCase()));
        },
        file_format_nin: (files, a) => {
            if (!files || files.length === 0) return true;
            const disallowed = Array.isArray(a) ? a : String(a).split(',').map(part => part.trim().toLowerCase()).filter(Boolean);
            return Array.from(files).every(f => !disallowed.includes(f.name.split('.').pop().toLowerCase()));
        },
        file_size_min: (files, m) => {
            if (!files || files.length === 0) return true;
            return Array.from(files).every(f => f.size >= m * 1024);
        },
        file_size_max: (files, m) => {
            if (!files || files.length === 0) return true;
            return Array.from(files).every(f => f.size <= m * 1024);
        },
        alpha_num_space: (v) => v === '' || /^[a-zA-Z0-9\s]+$/.test(String(v)),
        credit_card: (v) => {
            if (v === '') return true;
            const digits = String(v).replace(/\D/g, '');
            if (!digits) return false;
            let sum = 0;
            let shouldDouble = false;
            for (let i = digits.length - 1; i >= 0; i--) {
                let digit = Number(digits[i]);
                if (shouldDouble) {
                    digit *= 2;
                    if (digit > 9) digit -= 9;
                }
                sum += digit;
                shouldDouble = !shouldDouble;
            }
            return sum % 10 === 0;
        },
        base64: (v) => {
            if (v === '') return true;
            try {
                return btoa(atob(v)) === v;
            } catch (err) {
                return false;
            }
        },
        hex_color: (v) => v === '' || /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(v)),
        slug: (v) => v === '' || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(v)),
        required_if: function(v, params, field, allData) {
            const [otherName, otherVal] = String(params).split(',');
            const stateValue = Inspect._getByPath(allData, otherName);
            if (stateValue !== undefined) {
                return String(stateValue) === String(otherVal)
                    ? v !== '' && v !== null && v !== undefined
                    : true;
            }
            const otherField = this.formElement?.querySelector?.(`[name="${otherName}"]`);

            // If the condition matches, the current field must not be empty
            if (otherField && String(otherField.value) === String(otherVal)) {
                return v !== '' && v !== null && v !== undefined;
            }
            return true;
        },
        not_in: (v, blacklist) => v === '' || (Array.isArray(blacklist) && !blacklist.includes(v)),
        pincode: (v) => v === '' || /^[1-9][0-9]{5}$/.test(String(v)),
        pan_card: (v) => v === '' || /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(String(v).toUpperCase()),
        aadhaar: (v) => v === '' || /^[2-9]{1}[0-9]{11}$/.test(String(v))
    };
}

if (typeof module !== 'undefined') {
    module.exports = { Inspect };
} else {
    window.Inspect = Inspect;
}
