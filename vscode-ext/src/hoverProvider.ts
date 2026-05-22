import * as vscode from 'vscode';
import { allDocItems, markdownFor } from './miniXData';

export class MiniXHoverProvider implements vscode.HoverProvider {
  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    const range = document.getWordRangeAtPosition(position, /[@$.\w:-]+/);
    if (!range) {
      return undefined;
    }

    const word = document.getText(range);
    const item = allDocItems.find((doc) =>
      doc.name === word ||
      word.startsWith(`${doc.name}:`) ||
      word.startsWith(`${doc.name}.`) ||
      (word === '$store' && doc.name === '$store')
    );
    return item ? new vscode.Hover(markdownFor(item), range) : undefined;
  }
}

