import * as vscode from 'vscode';
import { rangeFromOffsets } from './scanner';

export const diagnosticSource = 'Mini-X';

export enum MiniXDiagnosticCode {
  DefineComponent = 'minix.defineComponent',
  GlobalComponent = 'minix.globalComponent',
  MissingMount = 'minix.missingMount',
  InvalidXFor = 'minix.invalidXFor',
  EmptyXComponent = 'minix.emptyXComponent',
  UnsupportedXModel = 'minix.unsupportedXModel',
  UndefinedBus = 'minix.undefinedBus',
  DuplicateComponent = 'minix.duplicateComponent',
  EmptyTemplate = 'minix.emptyTemplate',
  XOnLonghand = 'minix.xOnLonghand',
  MissingXKey = 'minix.missingXKey'
}

export class MiniXDiagnostics {
  readonly collection = vscode.languages.createDiagnosticCollection('minix');

  validate(document: vscode.TextDocument): void {
    if (!isSupported(document)) {
      this.collection.delete(document.uri);
      return;
    }
    const text = document.getText();
    const diagnostics: vscode.Diagnostic[] = [];

    collectScriptDiagnostics(text, diagnostics);
    collectMarkupDiagnostics(text, diagnostics);

    this.collection.set(document.uri, diagnostics);
  }

  validateOpenDocuments(): void {
    for (const document of vscode.workspace.textDocuments) {
      this.validate(document);
    }
  }

  dispose(): void {
    this.collection.dispose();
  }
}

function collectScriptDiagnostics(text: string, diagnostics: vscode.Diagnostic[]): void {
  addMatches(text, /\bMiniX\.defineComponent\s*\(/g, diagnostics, MiniXDiagnosticCode.DefineComponent, 'MiniX components are class-based. Do not use MiniX.defineComponent.', vscode.DiagnosticSeverity.Warning);
  addMatches(text, /\bMiniX\.component\s*\(/g, diagnostics, MiniXDiagnosticCode.GlobalComponent, 'Mini-X components should be registered locally with registerComponents(), not MiniX.component().', vscode.DiagnosticSeverity.Warning);

  collectMissingMountDiagnostics(text, diagnostics);

  if (/MiniX\.\$bus\./.test(text) && !/(MiniX\.\$bus\s*=|\bbus\s*:|eventBus|\$bus\s*:)/.test(text)) {
    addMatches(text, /MiniX\.\$bus\.(?:emit|on|off)\b/g, diagnostics, MiniXDiagnosticCode.UndefinedBus, 'MiniX.$bus usage detected. Ensure the event bus plugin or runtime support is initialized before use.', vscode.DiagnosticSeverity.Information);
  }

  const classNames = new Map<string, number>();
  const classPattern = /\bclass\s+([A-Z][A-Za-z0-9_]*)\b/g;
  let classMatch: RegExpExecArray | null;
  while ((classMatch = classPattern.exec(text))) {
    const name = classMatch[1];
    const previous = classNames.get(name);
    if (previous !== undefined) {
      diagnostics.push(makeDiagnostic(text, classMatch.index, classMatch.index + classMatch[0].length, MiniXDiagnosticCode.DuplicateComponent, `Duplicate component class name "${name}" in this file.`, vscode.DiagnosticSeverity.Warning));
      diagnostics.push(makeDiagnostic(text, previous, previous + name.length, MiniXDiagnosticCode.DuplicateComponent, `Duplicate component class name "${name}" in this file.`, vscode.DiagnosticSeverity.Warning));
    } else {
      classNames.set(name, classMatch.index + classMatch[0].indexOf(name));
    }
  }

  const emptyTemplatePattern = /\b(?:view|template)\s*\([^)]*\)\s*\{[\s\S]*?return\s*(`\s*`|['"]\s*['"])/g;
  addMatches(text, emptyTemplatePattern, diagnostics, MiniXDiagnosticCode.EmptyTemplate, 'Template/view returns an empty string.', vscode.DiagnosticSeverity.Warning);
}

function collectMarkupDiagnostics(text: string, diagnostics: vscode.Diagnostic[]): void {
  const attrPattern = /<([a-zA-Z][\w:-]*)\b([^<>]*)>/g;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = attrPattern.exec(text))) {
    const tag = tagMatch[1].toLowerCase();
    const attrs = tagMatch[2];
    const tagStart = tagMatch.index;
    const attrStart = tagStart + tagMatch[0].indexOf(attrs);

    const xFor = readAttr(attrs, 'x-for');
    if (xFor && !/^\s*(?:\([^)]+\)|[A-Za-z_$][\w$]*)\s+(?:in|of)\s+.+/.test(xFor.value)) {
      diagnostics.push(makeDiagnostic(text, attrStart + xFor.offset, attrStart + xFor.offset + xFor.raw.length, MiniXDiagnosticCode.InvalidXFor, 'x-for should look like "item in items" or "(item, index) in items".', vscode.DiagnosticSeverity.Warning));
    }
    if (xFor && !/(?:\sx-key\s*=|\s:key\s*=|\sx-bind:key\s*=|\skey\s*=)/.test(attrs)) {
      diagnostics.push(makeDiagnostic(text, attrStart + xFor.offset, attrStart + xFor.offset + xFor.raw.length, MiniXDiagnosticCode.MissingXKey, 'Repeated Mini-X templates should use a stable x-key or :key when possible.', vscode.DiagnosticSeverity.Information));
    }

    const component = readAttr(attrs, 'x-component');
    if (component && !component.value.trim()) {
      diagnostics.push(makeDiagnostic(text, attrStart + component.offset, attrStart + component.offset + component.raw.length, MiniXDiagnosticCode.EmptyXComponent, 'x-component needs a component name.', vscode.DiagnosticSeverity.Warning));
    }

    const model = readAttr(attrs, 'x-model');
    if (model && !['input', 'textarea', 'select'].includes(tag)) {
      diagnostics.push(makeDiagnostic(text, attrStart + model.offset, attrStart + model.offset + model.raw.length, MiniXDiagnosticCode.UnsupportedXModel, 'x-model is supported on input, textarea, and select elements.', vscode.DiagnosticSeverity.Warning));
    }

    const longhand = attrs.match(/\sx-on:([\w.-]+)\s*=/);
    if (longhand?.index !== undefined) {
      diagnostics.push(makeDiagnostic(text, attrStart + longhand.index + 1, attrStart + longhand.index + longhand[0].length, MiniXDiagnosticCode.XOnLonghand, 'Use @event shorthand if preferred.', vscode.DiagnosticSeverity.Hint));
    }
  }
}

function readAttr(attrs: string, name: string): { raw: string; value: string; offset: number } | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\s(${escaped})(?:\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>` + '`' + `]+)))?`);
  const match = attrs.match(pattern);
  if (!match || match.index === undefined) {
    return undefined;
  }
  return {
    raw: match[0].trim(),
    value: match[2] ?? match[3] ?? match[4] ?? '',
    offset: match.index + match[0].indexOf(match[1])
  };
}

function addMatches(text: string, pattern: RegExp, diagnostics: vscode.Diagnostic[], code: MiniXDiagnosticCode, message: string, severity: vscode.DiagnosticSeverity): void {
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    diagnostics.push(makeDiagnostic(text, match.index, match.index + match[0].length, code, message, severity));
  }
}

function collectMissingMountDiagnostics(text: string, diagnostics: vscode.Diagnostic[]): void {
  const pattern = /\bMiniX\.createApp\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const openParen = match.index + match[0].lastIndexOf('(');
    const createAppEnd = findMatchingParen(text, openParen);
    if (createAppEnd < 0) {
      continue;
    }

    const chain = readCallChain(text, createAppEnd + 1);
    if (!chain.hasMount) {
      diagnostics.push(makeDiagnostic(
        text,
        match.index,
        chain.end,
        MiniXDiagnosticCode.MissingMount,
        "MiniX.createApp(...) should usually be chained to .mount('#app').",
        vscode.DiagnosticSeverity.Warning
      ));
    }
    pattern.lastIndex = createAppEnd + 1;
  }
}

function readCallChain(text: string, start: number): { end: number; hasMount: boolean } {
  let index = start;
  let end = start;
  let hasMount = false;

  while (index < text.length) {
    index = skipWhitespace(text, index);
    if (text[index] !== '.') {
      break;
    }

    const memberStart = index + 1;
    const memberMatch = /^[A-Za-z_$][\w$]*/.exec(text.slice(memberStart));
    if (!memberMatch) {
      break;
    }

    const memberName = memberMatch[0];
    index = skipWhitespace(text, memberStart + memberName.length);
    if (text[index] !== '(') {
      end = index;
      continue;
    }

    const closeParen = findMatchingParen(text, index);
    if (closeParen < 0) {
      end = text.length;
      break;
    }

    if (memberName === 'mount') {
      hasMount = true;
    }
    index = closeParen + 1;
    end = index;
  }

  return { end, hasMount };
}

function skipWhitespace(text: string, start: number): number {
  let index = start;
  while (index < text.length && /\s/.test(text[index])) {
    index++;
  }
  return index;
}

function findMatchingParen(text: string, openParen: number): number {
  let depth = 0;
  let quote: string | undefined;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = openParen; index < text.length; index++) {
    const char = text[index];
    const next = text[index + 1];

    if (inLineComment) {
      if (char === '\n' || char === '\r') {
        inLineComment = false;
      }
      continue;
    }
    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        index++;
      }
      continue;
    }
    if (quote) {
      if (char === '\\') {
        index++;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }

    if (char === '/' && next === '/') {
      inLineComment = true;
      index++;
      continue;
    }
    if (char === '/' && next === '*') {
      inBlockComment = true;
      index++;
      continue;
    }
    if (char === '"' || char === '\'' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(') {
      depth++;
    } else if (char === ')') {
      depth--;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function makeDiagnostic(text: string, start: number, end: number, code: MiniXDiagnosticCode, message: string, severity: vscode.DiagnosticSeverity): vscode.Diagnostic {
  const diagnostic = new vscode.Diagnostic(rangeFromOffsets(text, start, end), message, severity);
  diagnostic.source = diagnosticSource;
  diagnostic.code = code;
  return diagnostic;
}

function isSupported(document: vscode.TextDocument): boolean {
  return ['javascript', 'javascriptreact', 'typescript', 'typescriptreact', 'html', 'php'].includes(document.languageId) ||
    /\.(js|mjs|ts|html|blade\.php|php)$/i.test(document.uri.fsPath);
}
