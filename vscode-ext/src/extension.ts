import * as vscode from 'vscode';
import { MiniXCodeActionProvider } from './codeActions';
import { registerCommands } from './commands';
import { MiniXCompletionProvider } from './completionProvider';
import { MiniXDiagnostics } from './diagnostics';
import { MiniXHoverProvider } from './hoverProvider';
import { MiniXProjectIndex } from './indexer';
import { supportedLanguages } from './miniXData';
import { MiniXDefinitionProvider, MiniXDocumentSymbolProvider } from './navigationProvider';
import { MiniXScanner } from './scanner';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const index = new MiniXProjectIndex();
  const scanner = new MiniXScanner(index);
  const diagnostics = new MiniXDiagnostics();
  const selector: vscode.DocumentSelector = supportedLanguages.map((language) => ({ language, scheme: 'file' }));

  scanner.start(context);

  context.subscriptions.push(
    index,
    diagnostics,
    vscode.languages.registerCompletionItemProvider(selector, new MiniXCompletionProvider(index), '.', 'x', '@', '$', ':', '<', ' '),
    vscode.languages.registerHoverProvider(selector, new MiniXHoverProvider()),
    vscode.languages.registerDefinitionProvider(selector, new MiniXDefinitionProvider(index)),
    vscode.languages.registerDocumentSymbolProvider(selector, new MiniXDocumentSymbolProvider(index)),
    vscode.languages.registerCodeActionsProvider(selector, new MiniXCodeActionProvider(), {
      providedCodeActionKinds: MiniXCodeActionProvider.providedCodeActionKinds
    }),
    vscode.workspace.onDidOpenTextDocument((document) => diagnostics.validate(document)),
    vscode.workspace.onDidSaveTextDocument((document) => diagnostics.validate(document)),
    vscode.workspace.onDidChangeTextDocument((event) => diagnostics.validate(event.document))
  );

  registerCommands(context, index, scanner, diagnostics);
  diagnostics.validateOpenDocuments();

  if (vscode.workspace.getConfiguration('minix').get<boolean>('scanOnActivation', true)) {
    void scanner.scanWorkspace().catch((error) => {
      console.error('[Mini-X] Initial workspace scan failed', error);
    });
  }
}

export function deactivate(): void {}
