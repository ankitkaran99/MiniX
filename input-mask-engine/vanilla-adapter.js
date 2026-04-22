(function (global) {
  'use strict';

  function isTextInput(el) {
    return el && el.tagName === 'INPUT';
  }

  function setCaret(el, start, end) {
    requestAnimationFrame(() => {
      try { el.setSelectionRange(start, end); } catch (_) {}
    });
  }

  function applyResult(el, result) {
    if (!result || typeof result.value !== 'string') return;
    el.value = result.value;
    if (typeof result.selectionStart === 'number' && typeof result.selectionEnd === 'number') {
      setCaret(el, result.selectionStart, result.selectionEnd);
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function parseFreeDefinition(attr) {
    if (!attr) return null;
    try {
      const parsed = (new Function('return (' + attr + ');'))();
      if (!parsed || typeof parsed !== 'object') return null;
      return { type: 'free', ...parsed };
    } catch (err) {
      console.error('Invalid data-mask-free:', attr, err);
      return null;
    }
  }

  function normalizeInitArgs(scopeOrOptions, maybeOptions) {
    if (scopeOrOptions && typeof scopeOrOptions.querySelectorAll === 'function') {
      return { scope: scopeOrOptions, options: maybeOptions || {} };
    }
    return { scope: document, options: scopeOrOptions || {} };
  }

  function bindMask(el, options) {
    if (!isTextInput(el) || el.__maskBound) return;

    const maskAttr = el.getAttribute('data-mask');
    const freeAttr = el.getAttribute('data-mask-free');
    if (!maskAttr && !freeAttr) return;

    const engine = new InputMaskEngine({ tokens: options.tokens || {} });

    let compiled = null;
    if (maskAttr) {
      compiled = engine.compile(maskAttr);
    } else if (freeAttr) {
      const freeDef = parseFreeDefinition(freeAttr);
      if (!freeDef) return;
      compiled = engine.compile(freeDef);
    }

    function payload(input) {
      return {
        mask: compiled,
        value: el.value || '',
        selectionStart: el.selectionStart ?? (el.value || '').length,
        selectionEnd: el.selectionEnd ?? (el.value || '').length,
        input: input || ''
      };
    }

    function remaskInitialValue() {
      if (!el.value) return;

      let result = {
        ok: true,
        value: '',
        selectionStart: 0,
        selectionEnd: 0
      };

      for (const ch of String(el.value)) {
        result = engine.apply({
          mask: compiled,
          value: result.value,
          selectionStart: result.selectionStart,
          selectionEnd: result.selectionEnd,
          input: ch
        });
        if (!result || result.ok === false) break;
      }

      if (result && typeof result.value === 'string') {
        el.value = result.value;
      }
    }

    function onBeforeInput(e) {
      if (e.isComposing) return;

      let result = null;

      if (e.inputType === 'insertText') {
        result = engine.apply(payload(e.data || ''));
      } else if (e.inputType === 'insertFromPaste') {
        result = engine.paste(payload(e.data || ''));
      } else if (e.inputType === 'deleteContentBackward') {
        result = engine.backspace(payload(''));
      } else if (e.inputType === 'deleteContentForward' || e.inputType === 'deleteByCut') {
        result = engine.deleteForward(payload(''));
      } else {
        return;
      }

      if (!result) return;
      e.preventDefault();
      applyResult(el, result);
    }

    function onPaste(e) {
      const text = (e.clipboardData || global.clipboardData)?.getData('text') || '';
      e.preventDefault();
      const result = engine.paste(payload(text));
      applyResult(el, result);
    }

    el.addEventListener('beforeinput', onBeforeInput);
    el.addEventListener('paste', onPaste);
    el.__maskBound = true;
    el.__maskCleanup = function () {
      el.removeEventListener('beforeinput', onBeforeInput);
      el.removeEventListener('paste', onPaste);
      delete el.__maskBound;
      delete el.__maskCleanup;
    };

    remaskInitialValue();
  }

  function init(scopeOrOptions, maybeOptions) {
    const normalized = normalizeInitArgs(scopeOrOptions, maybeOptions);
    normalized.scope.querySelectorAll('input[data-mask], input[data-mask-free]').forEach(function (el) {
      bindMask(el, normalized.options);
    });
  }

  global.MaskEngineDOM = {
    init: init,
    bind: bindMask
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      init();
    });
  } else {
    init();
  }
})(window);
