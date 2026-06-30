import * as vscode from 'vscode';
import { MiniXProjectIndex } from './indexer';
import { componentMembers, directives, globalApis, markdownFor, routerApis, storeApis, formApis, i18nApis } from './miniXData';

export class MiniXCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private readonly index: MiniXProjectIndex) {}

  provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
    const linePrefix = document.lineAt(position).text.slice(0, position.character);
    const inMarkup = isMarkupContext(document, position, linePrefix);
    const items: vscode.CompletionItem[] = [];

    if (inMarkup) {
      items.push(...directives.map((item) => toCompletion(item, vscode.CompletionItemKind.Property)));
      this.index.allSymbols('component').forEach((symbol) => {
        const completion = new vscode.CompletionItem(symbol.name, vscode.CompletionItemKind.Class);
        completion.detail = 'Mini-X component';
        completion.documentation = symbol.detail ?? 'Indexed Mini-X component.';
        items.push(completion);

        const kebabName = toKebabCase(symbol.name);
        if (kebabName.includes('-')) {
          const completionTag = new vscode.CompletionItem(kebabName, vscode.CompletionItemKind.Class);
          completionTag.detail = 'Mini-X auto-component tag';
          completionTag.documentation = `Mounts ${symbol.name} component using tag-based syntax.`;
          
          const hasLessThan = /<\s*[\w-]*$/.test(linePrefix);
          if (hasLessThan) {
            completionTag.insertText = new vscode.SnippetString(`${kebabName} x-props="$1">\n\t$0\n</${kebabName}>`);
          } else {
            completionTag.insertText = new vscode.SnippetString(`<${kebabName} x-props="$1">\n\t$0\n</${kebabName}>`);
          }
          items.push(completionTag);
        }
      });
      items.push(...this.index.allSymbols('store').map((symbol) => {
        const completion = new vscode.CompletionItem(`$store('${symbol.name}')`, vscode.CompletionItemKind.Value);
        completion.detail = 'Mini-X store';
        completion.documentation = `Indexed Mini-X store "${symbol.name}".`;
        return completion;
      }));
      return items;
    }

    items.push(...globalApis.map((item) => toCompletion(item, vscode.CompletionItemKind.Method)));
    items.push(...componentMembers.map((item) => toCompletion(item, vscode.CompletionItemKind.Method)));
    items.push(...storeApis.map((item) => toCompletion(item, vscode.CompletionItemKind.Function)));
    items.push(...routerApis.map((item) => toCompletion(item, vscode.CompletionItemKind.Function)));
    items.push(...formApis.map((item) => toCompletion(item, vscode.CompletionItemKind.Property)));
    items.push(...i18nApis.map((item) => toCompletion(item, vscode.CompletionItemKind.Property)));
    items.push(...this.index.allSymbols().map((symbol) => {
      const completion = new vscode.CompletionItem(symbol.name, symbolKind(symbol.kind));
      completion.detail = `Mini-X ${symbol.kind}`;
      completion.documentation = symbol.detail;
      return completion;
    }));
    return items;
  }
}

function toCompletion(item: { name: string; detail: string; documentation: string; insertText?: string }, kind: vscode.CompletionItemKind): vscode.CompletionItem {
  const completion = new vscode.CompletionItem(item.name, kind);
  completion.detail = item.detail;
  completion.documentation = markdownFor(item);
  if (item.insertText) {
    completion.insertText = new vscode.SnippetString(item.insertText);
  }
  return completion;
}

function isMarkupContext(document: vscode.TextDocument, position: vscode.Position, linePrefix: string): boolean {
  if (['html', 'php'].includes(document.languageId)) {
    return true;
  }
  if (/`[^`]*$/.test(document.getText(new vscode.Range(new vscode.Position(Math.max(0, position.line - 20), 0), position)))) {
    return /<[\w!-]?[^\n`]*$/.test(linePrefix) || /\s(?:x-|@)[\w:-]*$/.test(linePrefix);
  }
  return /<[\w!-]?[^\n]*$/.test(linePrefix) || /\s(?:x-|@)[\w:-]*$/.test(linePrefix);
}

function symbolKind(kind: string): vscode.CompletionItemKind {
  switch (kind) {
    case 'component':
      return vscode.CompletionItemKind.Class;
    case 'store':
      return vscode.CompletionItemKind.Module;
    case 'route':
      return vscode.CompletionItemKind.Reference;
    case 'event':
      return vscode.CompletionItemKind.Event;
    default:
      return vscode.CompletionItemKind.Value;
  }
}

function toKebabCase(str: string): string {
  return str
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

