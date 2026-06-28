import * as vscode from 'vscode';
import * as ts from 'typescript';
import { MiniXProjectIndex, MiniXSymbol } from './indexer';
import { directives, ignoredGlob, lifecycleHooks, supportedFileGlob } from './miniXData';

const scriptExtensions = new Set(['.js', '.mjs', '.ts']);
const directiveNames = directives.map((item) => item.name);

export class MiniXScanner {
  private watcher?: vscode.FileSystemWatcher;
  private scanToken = 0;

  constructor(private readonly index: MiniXProjectIndex) {}

  start(context: vscode.ExtensionContext): void {
    this.watcher = vscode.workspace.createFileSystemWatcher(supportedFileGlob);
    context.subscriptions.push(
      this.watcher,
      this.watcher.onDidCreate((uri) => void this.scanUri(uri)),
      this.watcher.onDidChange((uri) => void this.scanUri(uri)),
      this.watcher.onDidDelete((uri) => this.index.removeFile(uri)),
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (this.isSupported(document.uri)) {
          void this.scanDocument(document);
        }
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (this.isSupported(event.document.uri)) {
          void this.scanDocument(event.document);
        }
      })
    );
  }

  async scanWorkspace(): Promise<number> {
    const token = ++this.scanToken;
    const maxFiles = vscode.workspace.getConfiguration('minix').get<number>('maxFiles', 5000);
    const uris = await vscode.workspace.findFiles(supportedFileGlob, ignoredGlob, maxFiles);
    if (token !== this.scanToken) {
      return 0;
    }

    let count = 0;
    for (const uri of uris) {
      try {
        await this.scanUri(uri);
        count++;
      } catch (error) {
        console.error(`[Mini-X] Failed to scan ${uri.fsPath}`, error);
      }
    }
    return count;
  }

  async scanUri(uri: vscode.Uri): Promise<void> {
    if (!this.isSupported(uri) || this.isIgnored(uri)) {
      return;
    }

    const openDocument = vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri.toString());
    if (openDocument) {
      await this.scanDocument(openDocument);
      return;
    }

    const bytes = await vscode.workspace.fs.readFile(uri);
    const text = Buffer.from(bytes).toString('utf8');
    this.index.updateFile(uri, this.scanText(uri, text));
  }

  async scanDocument(document: vscode.TextDocument): Promise<void> {
    if (!this.isSupported(document.uri) || this.isIgnored(document.uri)) {
      return;
    }
    this.index.updateFile(document.uri, this.scanText(document.uri, document.getText()));
  }

  scanText(uri: vscode.Uri, text: string): MiniXSymbol[] {
    const symbols: MiniXSymbol[] = [];
    const ext = getExtension(uri.fsPath);
    if (scriptExtensions.has(ext)) {
      symbols.push(...scanScript(uri, text));
      for (const template of extractTemplateStrings(text)) {
        symbols.push(...scanMarkup(uri, text, template.text, template.offset));
      }
    } else {
      symbols.push(...scanMarkup(uri, text, text, 0));
      for (const template of extractTemplateStrings(text)) {
        symbols.push(...scanMarkup(uri, text, template.text, template.offset));
      }
    }
    return symbols;
  }

  private isSupported(uri: vscode.Uri): boolean {
    return /\.(js|mjs|ts|html|blade\.php|php)$/i.test(uri.fsPath);
  }

  private isIgnored(uri: vscode.Uri): boolean {
    return /[\\/](node_modules|vendor|\.git|dist|build|storage|\.cache|cache|tmp|temp)[\\/]/i.test(uri.fsPath);
  }
}

function scanScript(uri: vscode.Uri, text: string): MiniXSymbol[] {
  const symbols: MiniXSymbol[] = [];
  const scriptKind = getExtension(uri.fsPath) === '.ts' ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const source = ts.createSourceFile(uri.fsPath, text, ts.ScriptTarget.Latest, true, scriptKind);

  const addSymbol = (kind: MiniXSymbol['kind'], name: string, node: ts.Node, detail?: string) => {
    symbols.push({
      kind,
      name,
      uri,
      range: rangeFromOffsets(text, node.getStart(source), node.getEnd()),
      detail
    });
  };

  const visit = (node: ts.Node) => {
    if (ts.isClassDeclaration(node) && node.name) {
      if (looksLikeComponentClass(node)) {
        addSymbol('component', node.name.text, node);
      }
      const propsMember = node.members.find((member) =>
        ts.isPropertyDeclaration(member) &&
        member.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword) &&
        member.name.getText(source) === 'props'
      );
      if (propsMember) {
        addSymbol('prop', `${node.name.text}.props`, propsMember);
      }
      for (const member of node.members) {
        const name = member.name?.getText(source).replace(/^['"]|['"]$/g, '');
        if (name && lifecycleHooks.some((hook) => hook.name === name)) {
          addSymbol('lifecycle', `${node.name.text}.${name}`, member);
        }
      }
    }

    if (ts.isCallExpression(node)) {
      const expression = node.expression.getText(source);
      if (expression === 'MiniXStore.define') {
        const name = getStringArg(node, source, 0) ?? 'anonymous-store';
        addSymbol('store', name, node);
      }
      if (expression.endsWith('createRouter') || expression === 'MiniXRouter.createRouter') {
        addSymbol('route', 'router', node);
        collectRoutesFromRouterCall(uri, text, source, node, symbols);
      }
      if (/\.use$/.test(expression) && node.arguments.length > 0) {
        addSymbol('plugin', node.arguments[0].getText(source), node.arguments[0]);
      }
      if (/MiniX\.\$bus\.(emit|on|off)$/.test(expression)) {
        const name = getStringArg(node, source, 0) ?? expression;
        addSymbol('event', name, node, expression);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);
  return symbols;
}

function looksLikeComponentClass(node: ts.ClassDeclaration): boolean {
  const memberNames = node.members.map((member) => member.name?.getText().replace(/^['"]|['"]$/g, '') ?? '');
  return memberNames.some((name) =>
    ['data', 'view', 'template', 'registerComponents', 'mounted', 'beforeMount', 'updated', 'beforeUnmount', 'unmounted', 'watch', 'methods', 'props', 'rules', 'stores'].includes(name)
  );
}

function collectRoutesFromRouterCall(
  uri: vscode.Uri,
  text: string,
  source: ts.SourceFile,
  node: ts.CallExpression,
  symbols: MiniXSymbol[]
): void {
  const walk = (child: ts.Node) => {
    if (ts.isPropertyAssignment(child) && child.name.getText(source) === 'name') {
      const initializer = child.initializer;
      if (ts.isStringLiteralLike(initializer)) {
        symbols.push({
          kind: 'route',
          name: initializer.text,
          uri,
          range: rangeFromOffsets(text, initializer.getStart(source), initializer.getEnd())
        });
      }
    }
    ts.forEachChild(child, walk);
  };
  node.arguments.forEach(walk);
}

function scanMarkup(uri: vscode.Uri, fullText: string, text: string, baseOffset: number): MiniXSymbol[] {
  const symbols: MiniXSymbol[] = [];
  const attrPattern = /(?:^|\s)(@[\w:-]+|x-[\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = attrPattern.exec(text))) {
    const name = match[1];
    const known = directiveNames.some((directive) => name === directive || name.startsWith(`${directive}:`) || name.startsWith(`${directive}.`));
    if (!known && !name.startsWith('@')) {
      continue;
    }
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    const start = baseOffset + match.index + match[0].indexOf(name);
    symbols.push({
      kind: name.startsWith('@') || name.startsWith('x-on') ? 'event' : 'directive',
      name,
      uri,
      range: rangeFromOffsets(fullText, start, start + name.length),
      detail: value
    });
    if (name === 'x-component' && value) {
      symbols.push({
        kind: 'component',
        name: value,
        uri,
        range: rangeFromOffsets(fullText, start, start + match[0].length),
        detail: 'template usage'
      });
    }
  }
  return symbols;
}

function extractTemplateStrings(text: string): Array<{ text: string; offset: number }> {
  const templates: Array<{ text: string; offset: number }> = [];
  const pattern = /(?:view|template)\s*\([^)]*\)\s*\{[\s\S]*?return\s*`([\s\S]*?)`|(?:html|template)\s*[:=]\s*`([\s\S]*?)`/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const content = match[1] ?? match[2];
    if (!content) {
      continue;
    }
    const backtickOffset = match[0].indexOf('`');
    templates.push({
      text: content,
      offset: match.index + backtickOffset + 1
    });
  }
  return templates;
}

function getStringArg(node: ts.CallExpression, source: ts.SourceFile, index: number): string | undefined {
  const arg = node.arguments[index];
  return arg && ts.isStringLiteralLike(arg) ? arg.text : undefined;
}

function getExtension(path: string): string {
  if (/\.blade\.php$/i.test(path)) {
    return '.blade.php';
  }
  const match = path.match(/\.[^.]+$/);
  return match ? match[0].toLowerCase() : '';
}

export function rangeFromOffsets(text: string, start: number, end: number): vscode.Range {
  return new vscode.Range(positionAt(text, start), positionAt(text, end));
}

export function positionAt(text: string, offset: number): vscode.Position {
  const clamped = Math.max(0, Math.min(offset, text.length));
  const prefix = text.slice(0, clamped);
  const lines = prefix.split(/\r\n|\r|\n/);
  return new vscode.Position(lines.length - 1, lines[lines.length - 1].length);
}

