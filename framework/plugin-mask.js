(function (global) {
  'use strict';

  function MiniX_Mask_Plugin(extraOptions) {
    const pluginOptions = normalizePluginOptions(extraOptions);

    return {
      name: 'MiniX_Mask_Plugin',
      version: '1.2.0',
      install(app) {
        const InputMaskEngineCtor = resolveEngineCtor(global, pluginOptions);
        if (!InputMaskEngineCtor) {
          throw new Error('[MiniX_Mask_Plugin] InputMaskEngine was not found. Load input-mask-engine.js first or pass { engine: InputMaskEngine }.');
        }

        const sharedEngine = new InputMaskEngineCtor({
          ...(pluginOptions.engineOptions || {}),
          tokens: {
            ...((pluginOptions.engineOptions && pluginOptions.engineOptions.tokens) || {}),
            ...(pluginOptions.tokens || {}),
          },
        });

        function registerDirective(name, mode) {
          app.directive(name, ({ el, expression, component, compiler, modifiers }) => {
            if (!isTextInput(el)) return function () {};

            let composing = false;
            let internalWrite = false;
            let lastMaskSignature = null;
            let compiledMask = null;

            const getScope = () => compiler.createScope(component, {}, el);

            const evaluateMask = () => {
              if (mode === 'literal') {
                const raw = String(expression == null ? '' : expression);
                const sig = 'literal::' + raw;
                if (sig !== lastMaskSignature) {
                  compiledMask = sharedEngine.compile(raw);
                  lastMaskSignature = sig;
                }
                return compiledMask;
              }

              const value = compiler._evaluate(expression, getScope(), null);
              const normalized = normalizeFreeDefinition(value);
              const sig = stableStringify(normalized);
              if (sig !== lastMaskSignature) {
                compiledMask = sharedEngine.compile(normalized);
                lastMaskSignature = sig;
              }
              return compiledMask;
            };

            const setCaret = (start, end) => {
              if (typeof el.setSelectionRange !== 'function') return;
              try {
                el.setSelectionRange(start, end);
              } catch (_) {}
            };

            const emitInput = () => {
              internalWrite = true;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              queueMicrotask(() => { internalWrite = false; });
            };

            const applyResult = (result, shouldEmit) => {
              if (!result || result.ok === false) return false;

              const nextValue = String(result.value == null ? '' : result.value);
              const nextStart = Number(result.selectionStart ?? nextValue.length);
              const nextEnd = Number(result.selectionEnd ?? nextStart);
              const valueChanged = el.value !== nextValue;
              const caretChanged = (el.selectionStart !== nextStart) || (el.selectionEnd !== nextEnd);

              if (!valueChanged && !caretChanged) return false;

              el.value = nextValue;
              setCaret(nextStart, nextEnd);
              if (shouldEmit && valueChanged) emitInput();
              return true;
            };

            const remaskWholeValue = (shouldEmit) => {
              const mask = evaluateMask();
              if (!mask) return false;

              const result = sharedEngine.paste({
                mask,
                value: '',
                selectionStart: 0,
                selectionEnd: 0,
                input: el.value,
              });

              return applyResult(result, shouldEmit);
            };

            const runInsert = (text, strict, shouldEmit) => {
              const mask = evaluateMask();
              if (!mask) return false;
              const payload = {
                mask,
                value: el.value,
                selectionStart: el.selectionStart,
                selectionEnd: el.selectionEnd,
                input: text,
              };
              const result = strict ? sharedEngine.apply(payload) : sharedEngine.paste(payload);
              return applyResult(result, shouldEmit);
            };

            const runDelete = (kind, shouldEmit) => {
              const mask = evaluateMask();
              if (!mask) return false;
              const payload = {
                mask,
                value: el.value,
                selectionStart: el.selectionStart,
                selectionEnd: el.selectionEnd,
              };
              const result = kind === 'backspace'
                ? sharedEngine.backspace(payload)
                : sharedEngine.deleteForward(payload);
              return applyResult(result, shouldEmit);
            };

            const onBeforeInput = (event) => {
              if (composing || event.defaultPrevented) return;

              const type = event.inputType || '';

              if (type === 'insertText') {
                event.preventDefault();
                runInsert(event.data || '', true, true);
                return;
              }

              if (type === 'insertFromPaste') {
                event.preventDefault();
                const pasted = event.data || '';
                runInsert(pasted, false, true);
                return;
              }

              if (type === 'deleteContentBackward') {
                event.preventDefault();
                runDelete('backspace', true);
                return;
              }

              if (type === 'deleteContentForward') {
                event.preventDefault();
                runDelete('delete', true);
                return;
              }

              if (type === 'insertReplacementText') {
                event.preventDefault();
                runInsert(event.data || '', false, true);
              }
            };

            const onPaste = (event) => {
              if (event.defaultPrevented) return;
              event.preventDefault();
              const text = event.clipboardData && typeof event.clipboardData.getData === 'function'
                ? event.clipboardData.getData('text')
                : '';
              runInsert(text, false, true);
            };

            const onKeyDown = (event) => {
              if (composing || event.defaultPrevented) return;

              if (event.key === 'Backspace') {
                event.preventDefault();
                runDelete('backspace', true);
                return;
              }

              if (event.key === 'Delete') {
                event.preventDefault();
                runDelete('delete', true);
              }
            };

            const onInput = () => {
              if (internalWrite || composing) return;
              remaskWholeValue(true);
            };

            const onCompositionStart = () => {
              composing = true;
            };

            const onCompositionEnd = () => {
              composing = false;
              remaskWholeValue(true);
            };

            const onCommit = () => {
              if (composing) return;
              remaskWholeValue(true);
            };

            el.addEventListener('beforeinput', onBeforeInput);
            el.addEventListener('paste', onPaste);
            el.addEventListener('keydown', onKeyDown);
            el.addEventListener('input', onInput);
            el.addEventListener('blur', onCommit);
            el.addEventListener('change', onCommit);
            el.addEventListener('compositionstart', onCompositionStart);
            el.addEventListener('compositionend', onCompositionEnd);

            const stopEffect = compiler._effect(component, () => {
              evaluateMask();
              remaskWholeValue(false);
            });

            remaskWholeValue(false);

            return function cleanup() {
              stopEffect && stopEffect();
              el.removeEventListener('beforeinput', onBeforeInput);
              el.removeEventListener('paste', onPaste);
              el.removeEventListener('keydown', onKeyDown);
              el.removeEventListener('input', onInput);
              el.removeEventListener('blur', onCommit);
              el.removeEventListener('change', onCommit);
              el.removeEventListener('compositionstart', onCompositionStart);
              el.removeEventListener('compositionend', onCompositionEnd);
            };
          }, { priority: 675 });
        }

        registerDirective('x-mask', 'literal');
        registerDirective('x-mask-free', 'free');
        return app;
      },
    };
  }

  function resolveEngineCtor(globalObj, pluginOptions) {
    if (typeof pluginOptions.engine === 'function') return pluginOptions.engine;
    if (typeof globalObj.InputMaskEngine === 'function') return globalObj.InputMaskEngine;
    if (typeof module !== 'undefined' && module.exports) {
      try {
        return require('./input-mask-engine');
      } catch (_) {}
    }
    return null;
  }

  function isTextInput(el) {
    if (!el || !el.tagName) return false;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.tagName !== 'INPUT') return false;

    const type = String(el.type || 'text').toLowerCase();
    return !['checkbox', 'radio', 'range', 'file', 'submit', 'reset', 'button', 'image', 'color', 'date', 'datetime-local', 'month', 'time', 'week'].includes(type);
  }

  function normalizePluginOptions(value) {
    if (!value) return { tokens: {} };
    if (typeof value !== 'object' || Array.isArray(value)) return { tokens: {} };

    const looksLikeFullOptions = (
      Object.prototype.hasOwnProperty.call(value, 'tokens') ||
      Object.prototype.hasOwnProperty.call(value, 'engine') ||
      Object.prototype.hasOwnProperty.call(value, 'engineOptions')
    );

    if (looksLikeFullOptions) {
      return {
        tokens: { ...(value.tokens || {}) },
        engine: value.engine,
        engineOptions: value.engineOptions || {},
      };
    }

    return { tokens: { ...value } };
  }

  function normalizeFreeDefinition(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const token = String(value.token || value.symbol || '9');
      const max = value.max == null ? Infinity : Number(value.max);
      return {
        type: 'free',
        token,
        max: Number.isFinite(max) ? max : Infinity,
      };
    }

    return {
      type: 'free',
      token: String(value || '9'),
      max: Infinity,
    };
  }

  function stableStringify(value) {
    return JSON.stringify(sortObject(value));
  }

  function sortObject(value) {
    if (Array.isArray(value)) return value.map(sortObject);
    if (!value || typeof value !== 'object') return value;
    const out = {};
    Object.keys(value).sort().forEach((key) => {
      out[key] = sortObject(value[key]);
    });
    return out;
  }

  global.MiniX_Mask_Plugin = MiniX_Mask_Plugin;
})(typeof window !== 'undefined' ? window : globalThis);
