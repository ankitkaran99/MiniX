(function (global) {
  'use strict';

  class InputMaskEngine {
    constructor(options = {}) {
      this.tokens = {
        A: {
          test: ch => /^[A-Za-z]$/.test(ch),
          transform: ch => ch.toUpperCase(),
        },
        a: {
          test: ch => /^[A-Za-z]$/.test(ch),
          transform: ch => ch.toLowerCase(),
        },
        9: {
          test: ch => /^[0-9]$/.test(ch),
          transform: ch => ch,
        },
        X: {
          test: ch => /^[A-Za-z0-9]$/.test(ch),
          transform: ch => ch,
        },
        '*': {
          test: ch => typeof ch === 'string' && ch.length === 1,
          transform: ch => ch,
        },
        ...(options.tokens || {}),
      };
    }

    compile(mask) {
      if (mask && typeof mask === 'object' && mask.type === 'free') {
        const token = this.tokens[mask.token];
        if (!token) throw new Error(`Unknown free token: ${mask.token}`);
        return {
          type: 'free',
          token: mask.token,
          max: Number.isFinite(mask.max) ? mask.max : Infinity,
          test: token.test,
          transform: token.transform || (ch => ch),
          source: mask,
        };
      }

      const source = String(mask ?? '');
      const nodes = [];
      let escaped = false;

      for (let i = 0; i < source.length; i++) {
        const ch = source[i];

        if (escaped) {
          nodes.push({ type: 'literal', value: ch });
          escaped = false;
          continue;
        }

        if (ch === '\\') {
          escaped = true;
          continue;
        }

        if (this.tokens[ch]) {
          nodes.push({
            type: 'token',
            symbol: ch,
            test: this.tokens[ch].test,
            transform: this.tokens[ch].transform || (c => c),
          });
        } else {
          nodes.push({ type: 'literal', value: ch });
        }
      }

      return {
        type: 'mask',
        source,
        nodes,
        slotCount: nodes.filter(n => n.type === 'token').length,
      };
    }

    apply(payload) {
      const compiled = this._ensureCompiled(payload.mask);
      return compiled.type === 'free'
        ? this._applyFree({ ...payload, mask: compiled }, true)
        : this._insertMask({ ...payload, mask: compiled }, true);
    }

    paste(payload) {
      const compiled = this._ensureCompiled(payload.mask);
      return compiled.type === 'free'
        ? this._applyFree({ ...payload, mask: compiled }, false)
        : this._insertMask({ ...payload, mask: compiled }, false);
    }

    accepts(payload) {
      const result = this.apply(payload);
      return {
        ok: result.ok,
        reason: result.reason || null,
      };
    }

    backspace(payload) {
      const compiled = this._ensureCompiled(payload.mask);
      return compiled.type === 'free'
        ? this._backspaceFree({ ...payload, mask: compiled })
        : this._backspaceMask({ ...payload, mask: compiled });
    }

    deleteForward(payload) {
      const compiled = this._ensureCompiled(payload.mask);
      return compiled.type === 'free'
        ? this._deleteForwardFree({ ...payload, mask: compiled })
        : this._deleteForwardMask({ ...payload, mask: compiled });
    }

    _ensureCompiled(mask) {
      if (mask && typeof mask === 'object' && (mask.type === 'mask' || mask.type === 'free')) {
        return mask;
      }
      return this.compile(mask);
    }

    _applyFree({ value, selectionStart, selectionEnd, input, mask }, strict) {
      const current = String(value ?? '');
      const start = Number(selectionStart ?? current.length);
      const end = Number(selectionEnd ?? start);
      const rawNext = current.slice(0, start) + String(input ?? '') + current.slice(end);

      let filtered = '';
      let insertedAccepted = 0;
      const prefix = current.slice(0, start);
      const inserted = String(input ?? '');
      const beforeInsertedLen = prefix.length;
      const insertedEndPos = beforeInsertedLen + inserted.length;

      for (let i = 0; i < rawNext.length; i++) {
        const ch = rawNext[i];
        if (!mask.test(ch)) {
          if (strict && i >= beforeInsertedLen && i < insertedEndPos) {
            return { ok: false, value: current, selectionStart: start, selectionEnd: end, reason: `Character \"${ch}\" is not allowed here` };
          }
          continue;
        }
        if (filtered.length >= mask.max) {
          if (strict && i >= beforeInsertedLen && i < insertedEndPos) {
            return { ok: false, value: current, selectionStart: start, selectionEnd: end, reason: `Maximum length is ${mask.max}` };
          }
          break;
        }
        filtered += mask.transform(ch);
        if (i >= beforeInsertedLen && i < insertedEndPos) insertedAccepted++;
      }

      const caret = Math.min(filtered.length, start + insertedAccepted);
      return {
        ok: true,
        value: filtered,
        selectionStart: caret,
        selectionEnd: caret,
      };
    }

    _backspaceFree({ value, selectionStart, selectionEnd }) {
      const current = String(value ?? '');
      const start = Number(selectionStart ?? current.length);
      const end = Number(selectionEnd ?? start);

      if (start !== end) {
        const next = current.slice(0, start) + current.slice(end);
        return { ok: true, value: next, selectionStart: start, selectionEnd: start };
      }
      if (start <= 0) return { ok: false, value: current, selectionStart: start, selectionEnd: end, reason: 'Nothing to delete' };

      const next = current.slice(0, start - 1) + current.slice(end);
      return { ok: true, value: next, selectionStart: start - 1, selectionEnd: start - 1 };
    }

    _deleteForwardFree({ value, selectionStart, selectionEnd }) {
      const current = String(value ?? '');
      const start = Number(selectionStart ?? current.length);
      const end = Number(selectionEnd ?? start);

      if (start !== end) {
        const next = current.slice(0, start) + current.slice(end);
        return { ok: true, value: next, selectionStart: start, selectionEnd: start };
      }
      if (start >= current.length) return { ok: false, value: current, selectionStart: start, selectionEnd: end, reason: 'Nothing to delete' };

      const next = current.slice(0, start) + current.slice(start + 1);
      return { ok: true, value: next, selectionStart: start, selectionEnd: start };
    }

    _insertMask({ value, selectionStart, selectionEnd, input, mask }, strict) {
      const state = this._parseMaskValue(value, mask);
      const current = String(value ?? '');
      const start = Number(selectionStart ?? current.length);
      const end = Number(selectionEnd ?? start);
      const range = start === end
        ? { startToken: this._findNextTokenFromCaret(state, start), endToken: this._findPrevTokenFromCaret(state, end) }
        : this._selectionToTokenRange(state, start, end);

      const slots = state.slots.slice();

      if (start !== end && range.startToken !== -1 && range.endToken !== -1) {
        for (let i = range.startToken; i <= range.endToken; i++) slots[i] = '';
      }

      let writeIndex = start === end
        ? this._findNextWritableToken(mask, slots, this._findNextTokenFromCaret(state, start))
        : this._findNextWritableToken(mask, slots, range.startToken);

      const chars = [...String(input ?? '')];
      const accepted = [];

      for (const ch of chars) {
        if (writeIndex === -1) {
          if (strict) return { ok: false, value: current, selectionStart: start, selectionEnd: end, reason: 'No slot available' };
          break;
        }

        const tokenNode = this._tokenNodeAt(mask, writeIndex);
        if (!tokenNode.test(ch)) {
          if (strict) return { ok: false, value: current, selectionStart: start, selectionEnd: end, reason: `Character \"${ch}\" is not allowed here` };
          continue;
        }

        slots[writeIndex] = tokenNode.transform(ch);
        accepted.push(writeIndex);
        writeIndex = this._findNextWritableToken(mask, slots, writeIndex + 1);
      }

      if (strict && chars.length && accepted.length !== chars.length) {
        return { ok: false, value: current, selectionStart: start, selectionEnd: end, reason: 'Input was not fully accepted' };
      }

      state.slots = slots;
      const nextValue = this._renderMaskState(state);
      const nextToken = accepted.length ? this._findNextWritableToken(mask, slots, accepted[accepted.length - 1] + 1) : this._findNextTokenFromCaret(state, start);
      const caret = nextToken === -1 ? nextValue.length : this._caretFromTokenIndex(state, nextToken);

      return { ok: true, value: nextValue, selectionStart: caret, selectionEnd: caret };
    }

    _backspaceMask({ value, selectionStart, selectionEnd, mask }) {
      const state = this._parseMaskValue(value, mask);
      const current = String(value ?? '');
      const start = Number(selectionStart ?? current.length);
      const end = Number(selectionEnd ?? start);

      if (start !== end) return this._clearMaskRange(state, start, end);

      const tokenIndex = this._findPrevFilledTokenFromCaret(state, start);
      if (tokenIndex === -1) {
        return { ok: false, value: current, selectionStart: start, selectionEnd: end, reason: 'Nothing to delete' };
      }

      return this._removeMaskTokens(state, [tokenIndex], tokenIndex);
    }

    _deleteForwardMask({ value, selectionStart, selectionEnd, mask }) {
      const state = this._parseMaskValue(value, mask);
      const current = String(value ?? '');
      const start = Number(selectionStart ?? current.length);
      const end = Number(selectionEnd ?? start);

      if (start !== end) return this._clearMaskRange(state, start, end);

      const tokenIndex = this._findNextFilledTokenFromCaret(state, start);
      if (tokenIndex === -1) {
        return { ok: false, value: current, selectionStart: start, selectionEnd: end, reason: 'Nothing to delete' };
      }

      return this._removeMaskTokens(state, [tokenIndex], tokenIndex);
    }

    _parseMaskValue(value, compiled) {
      const input = [...String(value ?? '')];
      const slots = new Array(compiled.slotCount).fill('');
      let inputIndex = 0;
      let tokenIndex = 0;

      for (const node of compiled.nodes) {
        if (node.type === 'literal') {
          if (input[inputIndex] === node.value) inputIndex++;
          continue;
        }

        while (inputIndex < input.length) {
          const ch = input[inputIndex];
          if (node.test(ch)) {
            slots[tokenIndex] = node.transform(ch);
            inputIndex++;
            break;
          }
          inputIndex++;
        }
        tokenIndex++;
      }

      return { compiled, slots };
    }

    _renderMaskState(state) {
      const { compiled, slots } = state;
      const lastFilled = this._lastFilledToken(slots);
      if (lastFilled === -1) return '';

      let out = '';
      let tokenIndex = 0;

      for (const node of compiled.nodes) {
        if (node.type === 'literal') {
          const nextToken = this._nextTokenIndex(compiled, tokenIndex);
          if (nextToken !== -1 && nextToken <= lastFilled + 1) out += node.value;
          continue;
        }

        if (tokenIndex <= lastFilled && slots[tokenIndex]) out += slots[tokenIndex];
        tokenIndex++;
      }
      return out;
    }

    _lastFilledToken(slots) {
      for (let i = slots.length - 1; i >= 0; i--) if (slots[i]) return i;
      return -1;
    }

    _nextTokenIndex(compiled, fromTokenIndex) {
      let tokenCounter = 0;
      for (const node of compiled.nodes) {
        if (node.type === 'token') {
          if (tokenCounter >= fromTokenIndex) return tokenCounter;
          tokenCounter++;
        }
      }
      return -1;
    }

    _tokenNodeAt(compiled, tokenIndex) {
      let count = 0;
      for (const node of compiled.nodes) {
        if (node.type === 'token') {
          if (count === tokenIndex) return node;
          count++;
        }
      }
      return null;
    }

    _findNextWritableToken(compiled, slots, fromIndex) {
      const start = Math.max(0, Number.isFinite(fromIndex) ? fromIndex : 0);
      for (let i = start; i < compiled.slotCount; i++) {
        if (slots[i] === '') return i;
      }
      return -1;
    }

    _selectionToTokenRange(state, selectionStart, selectionEnd) {
      return {
        startToken: this._findNextTokenFromCaret(state, selectionStart),
        endToken: this._findPrevTokenFromCaret(state, selectionEnd),
      };
    }

    _removeMaskTokens(state, tokenIndexes, caretTokenIndex) {
      const removed = new Set(tokenIndexes);
      const remaining = [];

      for (let i = 0; i < state.slots.length; i++) {
        if (!removed.has(i) && state.slots[i]) remaining.push(state.slots[i]);
      }

      state.slots = this._fitCharactersToMask(state.compiled, remaining);
      const nextValue = this._renderMaskState(state);
      const caret = this._caretFromTokenIndex(state, Math.max(0, caretTokenIndex));

      return { ok: true, value: nextValue, selectionStart: caret, selectionEnd: caret };
    }

    _clearMaskRange(state, selectionStart, selectionEnd) {
      const range = this._selectionToTokenRange(state, selectionStart, selectionEnd);
      if (range.startToken === -1 || range.endToken === -1) {
        return { ok: true, value: this._renderMaskState(state), selectionStart, selectionEnd: selectionStart };
      }

      const tokenIndexes = [];
      for (let i = range.startToken; i <= range.endToken; i++) {
        if (state.slots[i]) tokenIndexes.push(i);
      }

      if (!tokenIndexes.length) {
        const caret = this._caretFromTokenIndex(state, range.startToken);
        return { ok: true, value: this._renderMaskState(state), selectionStart: caret, selectionEnd: caret };
      }

      return this._removeMaskTokens(state, tokenIndexes, range.startToken);
    }

    _fitCharactersToMask(compiled, characters) {
      const slots = new Array(compiled.slotCount).fill('');
      let charIndex = 0;
      let tokenIndex = 0;

      for (const node of compiled.nodes) {
        if (node.type !== 'token') continue;

        while (charIndex < characters.length) {
          const ch = characters[charIndex++];
          if (node.test(ch)) {
            slots[tokenIndex] = node.transform(ch);
            break;
          }
        }

        tokenIndex++;
      }

      return slots;
    }

    _buildCaretMap(state) {
      const { compiled, slots } = state;
      const map = [];
      const lastFilled = this._lastFilledToken(slots);
      let visual = 0;
      let tokenIndex = 0;

      if (lastFilled === -1) {
        for (const node of compiled.nodes) {
          if (node.type === 'token') {
            map.push({ tokenIndex, start: visual, end: visual });
            tokenIndex++;
          }
        }
        return map;
      }

      for (const node of compiled.nodes) {
        if (node.type === 'literal') {
          const nextToken = this._nextTokenIndex(compiled, tokenIndex);
          if (nextToken !== -1 && nextToken <= lastFilled + 1) visual += node.value.length;
          continue;
        }

        const ch = slots[tokenIndex] || '';
        map.push({ tokenIndex, start: visual, end: visual + ch.length });
        visual += ch.length;
        tokenIndex++;
      }

      return map;
    }

    _findPrevTokenFromCaret(state, caret) {
      const map = this._buildCaretMap(state);
      for (let i = map.length - 1; i >= 0; i--) {
        if (map[i].start < caret || map[i].end <= caret) return map[i].tokenIndex;
      }
      return -1;
    }

    _findPrevFilledTokenFromCaret(state, caret) {
      const map = this._buildCaretMap(state);
      for (let i = map.length - 1; i >= 0; i--) {
        const tokenIndex = map[i].tokenIndex;
        if (!state.slots[tokenIndex]) continue;
        if (map[i].start < caret || map[i].end <= caret) return tokenIndex;
      }
      return -1;
    }

    _findNextTokenFromCaret(state, caret) {
      const map = this._buildCaretMap(state);
      for (let i = 0; i < map.length; i++) {
        if (map[i].end >= caret) return map[i].tokenIndex;
      }
      return -1;
    }

    _findNextFilledTokenFromCaret(state, caret) {
      const map = this._buildCaretMap(state);
      for (let i = 0; i < map.length; i++) {
        const tokenIndex = map[i].tokenIndex;
        if (!state.slots[tokenIndex]) continue;
        if (map[i].end > caret || (map[i].start >= caret && map[i].end >= caret)) return tokenIndex;
      }
      return -1;
    }

    _caretFromTokenIndex(state, tokenIndex) {
      const map = this._buildCaretMap(state);
      const hit = map.find(item => item.tokenIndex === tokenIndex);
      return hit ? hit.start : this._renderMaskState(state).length;
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = InputMaskEngine;
  } else {
    global.InputMaskEngine = InputMaskEngine;
  }
})(typeof window !== 'undefined' ? window : globalThis);
