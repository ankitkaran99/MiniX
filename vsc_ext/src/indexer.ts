import * as vscode from 'vscode';

export type MiniXSymbolKind =
  | 'component'
  | 'plugin'
  | 'store'
  | 'route'
  | 'directive'
  | 'lifecycle'
  | 'prop'
  | 'event'
  | 'template';

export interface MiniXSymbol {
  kind: MiniXSymbolKind;
  name: string;
  uri: vscode.Uri;
  range: vscode.Range;
  detail?: string;
}

export interface MiniXFileIndex {
  uri: vscode.Uri;
  symbols: MiniXSymbol[];
  scannedAt: number;
}

export interface MiniXIndexSnapshot {
  files: number;
  symbols: Record<MiniXSymbolKind, MiniXSymbol[]>;
}

const symbolKinds: MiniXSymbolKind[] = [
  'component',
  'plugin',
  'store',
  'route',
  'directive',
  'lifecycle',
  'prop',
  'event',
  'template'
];

export class MiniXProjectIndex {
  private readonly files = new Map<string, MiniXFileIndex>();
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;

  updateFile(uri: vscode.Uri, symbols: MiniXSymbol[]): void {
    this.files.set(uri.toString(), {
      uri,
      symbols,
      scannedAt: Date.now()
    });
    this.emitter.fire();
  }

  removeFile(uri: vscode.Uri): void {
    if (this.files.delete(uri.toString())) {
      this.emitter.fire();
    }
  }

  clear(): void {
    this.files.clear();
    this.emitter.fire();
  }

  getFile(uri: vscode.Uri): MiniXFileIndex | undefined {
    return this.files.get(uri.toString());
  }

  allSymbols(kind?: MiniXSymbolKind): MiniXSymbol[] {
    const symbols: MiniXSymbol[] = [];
    for (const file of this.files.values()) {
      symbols.push(...file.symbols.filter((symbol) => !kind || symbol.kind === kind));
    }
    return symbols;
  }

  snapshot(): MiniXIndexSnapshot {
    const grouped = Object.fromEntries(symbolKinds.map((kind) => [kind, [] as MiniXSymbol[]])) as unknown as Record<MiniXSymbolKind, MiniXSymbol[]>;
    for (const file of this.files.values()) {
      for (const symbol of file.symbols) {
        grouped[symbol.kind].push(symbol);
      }
    }
    return {
      files: this.files.size,
      symbols: grouped
    };
  }

  toMarkdown(): string {
    const snapshot = this.snapshot();
    const lines = ['# Mini-X Project Index', '', `Indexed files: ${snapshot.files}`, ''];
    for (const kind of symbolKinds) {
      const symbols = snapshot.symbols[kind];
      lines.push(`## ${kind} (${symbols.length})`);
      if (symbols.length === 0) {
        lines.push('', '_None found._', '');
        continue;
      }
      for (const symbol of symbols.sort((a, b) => a.name.localeCompare(b.name))) {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(symbol.uri);
        const path = workspaceFolder ? vscode.workspace.asRelativePath(symbol.uri) : symbol.uri.fsPath;
        lines.push(`- ${symbol.name} - ${path}:${symbol.range.start.line + 1}`);
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
