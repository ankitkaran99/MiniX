import * as vscode from 'vscode';
import { MiniXProjectIndex, MiniXSymbol } from './indexer';

export class MiniXDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private readonly index: MiniXProjectIndex) {}

  provideDefinition(document: vscode.TextDocument, position: vscode.Position): vscode.Definition | undefined {
    const token = readToken(document, position);
    if (!token) {
      return undefined;
    }

    const candidates = this.index.allSymbols().filter((symbol) =>
      symbol.name === token ||
      symbol.name.endsWith(`.${token}`) ||
      stripQuotes(symbol.name) === token
    );
    if (candidates.length === 0) {
      return undefined;
    }
    return candidates.map((symbol) => new vscode.Location(symbol.uri, symbol.range));
  }
}

export class MiniXDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
  constructor(private readonly index: MiniXProjectIndex) {}

  provideDocumentSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] {
    const file = this.index.getFile(document.uri);
    if (!file) {
      return [];
    }
    return file.symbols.map(toDocumentSymbol);
  }
}

function toDocumentSymbol(symbol: MiniXSymbol): vscode.DocumentSymbol {
  const documentSymbol = new vscode.DocumentSymbol(
    symbol.name,
    symbol.detail ?? `Mini-X ${symbol.kind}`,
    toSymbolKind(symbol.kind),
    symbol.range,
    symbol.range
  );
  return documentSymbol;
}

function toSymbolKind(kind: string): vscode.SymbolKind {
  switch (kind) {
    case 'component':
      return vscode.SymbolKind.Class;
    case 'store':
      return vscode.SymbolKind.Module;
    case 'route':
      return vscode.SymbolKind.Namespace;
    case 'event':
      return vscode.SymbolKind.Event;
    case 'lifecycle':
      return vscode.SymbolKind.Method;
    case 'prop':
      return vscode.SymbolKind.Property;
    default:
      return vscode.SymbolKind.String;
  }
}

function readToken(document: vscode.TextDocument, position: vscode.Position): string | undefined {
  const quoted = document.getWordRangeAtPosition(position, /['"][^'"]+['"]/);
  if (quoted) {
    return stripQuotes(document.getText(quoted));
  }
  const range = document.getWordRangeAtPosition(position, /[$A-Za-z_][\w$.-]*/);
  return range ? document.getText(range) : undefined;
}

function stripQuotes(value: string): string {
  return value.replace(/^['"]|['"]$/g, '');
}

