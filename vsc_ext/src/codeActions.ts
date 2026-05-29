import * as vscode from 'vscode';
import { MiniXDiagnosticCode, diagnosticSource } from './diagnostics';

export class MiniXCodeActionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(document: vscode.TextDocument, range: vscode.Range, context: vscode.CodeActionContext): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    for (const diagnostic of context.diagnostics.filter((item) => item.source === diagnosticSource)) {
      switch (diagnostic.code) {
        case MiniXDiagnosticCode.DefineComponent:
          actions.push(replaceDefineComponent(document, diagnostic));
          break;
        case MiniXDiagnosticCode.MissingMount:
          actions.push(addMount(document, diagnostic));
          break;
        case MiniXDiagnosticCode.XOnLonghand:
          actions.push(convertXOn(document, diagnostic));
          break;
        case MiniXDiagnosticCode.MissingXKey:
          actions.push(addXKey(document, diagnostic));
          break;
      }
    }
    return actions.filter(Boolean);
  }
}

function replaceDefineComponent(document: vscode.TextDocument, diagnostic: vscode.Diagnostic): vscode.CodeAction {
  const action = new vscode.CodeAction('Replace with class component skeleton', vscode.CodeActionKind.QuickFix);
  const edit = new vscode.WorkspaceEdit();
  const line = diagnostic.range.start.line;
  const className = inferComponentName(document, diagnostic.range) ?? 'App';
  edit.replace(document.uri, new vscode.Range(new vscode.Position(line, 0), document.lineAt(line).range.end), `class ${className} {\n\tdata() {\n\t\treturn {};\n\t}\n\n\tview() {\n\t\treturn \`\n\t\t\t<div></div>\n\t\t\`;\n\t}\n}`);
  action.edit = edit;
  action.diagnostics = [diagnostic];
  return action;
}

function addMount(document: vscode.TextDocument, diagnostic: vscode.Diagnostic): vscode.CodeAction {
  const action = new vscode.CodeAction("Add .mount('#app')", vscode.CodeActionKind.QuickFix);
  const edit = new vscode.WorkspaceEdit();
  edit.insert(document.uri, diagnostic.range.end, ".mount('#app')");
  action.edit = edit;
  action.diagnostics = [diagnostic];
  return action;
}

function convertXOn(document: vscode.TextDocument, diagnostic: vscode.Diagnostic): vscode.CodeAction {
  const text = document.getText(diagnostic.range);
  const match = text.match(/x-on:([\w.-]+)/);
  const action = new vscode.CodeAction('Convert to @event shorthand', vscode.CodeActionKind.QuickFix);
  if (match) {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, diagnostic.range, text.replace(`x-on:${match[1]}`, `@${match[1]}`));
    action.edit = edit;
  }
  action.diagnostics = [diagnostic];
  return action;
}

function addXKey(document: vscode.TextDocument, diagnostic: vscode.Diagnostic): vscode.CodeAction {
  const action = new vscode.CodeAction('Add x-key to repeated element', vscode.CodeActionKind.QuickFix);
  const line = document.lineAt(diagnostic.range.start.line);
  const edit = new vscode.WorkspaceEdit();
  const forText = document.getText(diagnostic.range);
  const iterator = forText.match(/x-for\s*=\s*["']\s*(?:\(\s*)?([A-Za-z_$][\w$]*)/)?.[1] ?? 'item';
  const insertAt = line.text.indexOf('>', diagnostic.range.end.character);
  if (insertAt >= 0) {
    edit.insert(document.uri, new vscode.Position(line.lineNumber, insertAt), ` x-key="${iterator}.id"`);
  } else {
    edit.insert(document.uri, diagnostic.range.end, ` x-key="${iterator}.id"`);
  }
  action.edit = edit;
  action.diagnostics = [diagnostic];
  return action;
}

function inferComponentName(document: vscode.TextDocument, range: vscode.Range): string | undefined {
  const prefix = document.getText(new vscode.Range(new vscode.Position(0, 0), range.start));
  return prefix.match(/(?:const|let|var)\s+([A-Z][A-Za-z0-9_]*)\s*=\s*$/)?.[1];
}

