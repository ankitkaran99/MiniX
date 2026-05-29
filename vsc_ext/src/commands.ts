import * as vscode from 'vscode';
import { MiniXDiagnostics } from './diagnostics';
import { MiniXProjectIndex } from './indexer';
import { MiniXScanner } from './scanner';
import { componentTemplate, routerTemplate, storeTemplate, toKebab, toPascal } from './snippets';

export function registerCommands(
  context: vscode.ExtensionContext,
  index: MiniXProjectIndex,
  scanner: MiniXScanner,
  diagnostics: MiniXDiagnostics
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('minix.scanWorkspace', async () => {
      const count = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Scanning Mini-X workspace' },
        () => scanner.scanWorkspace()
      );
      vscode.window.showInformationMessage(`Mini-X indexed ${count} file${count === 1 ? '' : 's'}.`);
    }),
    vscode.commands.registerCommand('minix.showProjectIndex', async () => {
      const document = await vscode.workspace.openTextDocument({
        language: 'markdown',
        content: index.toMarkdown()
      });
      await vscode.window.showTextDocument(document, { preview: true });
    }),
    vscode.commands.registerCommand('minix.createComponent', async () => {
      const folder = await pickTargetFolder();
      if (!folder) {
        return;
      }
      const rawName = await vscode.window.showInputBox({
        title: 'Mini-X: Create Component',
        prompt: 'Component class name or file name',
        value: 'ExampleCard',
        validateInput: validateName
      });
      if (!rawName) {
        return;
      }
      const className = toPascal(rawName);
      await createFile(folder, `${className}.js`, componentTemplate(className));
    }),
    vscode.commands.registerCommand('minix.createStore', async () => {
      const folder = await pickTargetFolder();
      if (!folder) {
        return;
      }
      const rawName = await vscode.window.showInputBox({
        title: 'Mini-X: Create Store',
        prompt: 'Store name',
        value: 'counter',
        validateInput: validateName
      });
      if (!rawName) {
        return;
      }
      await createFile(folder, `${toKebab(rawName)}.store.js`, storeTemplate(rawName));
    }),
    vscode.commands.registerCommand('minix.createRouter', async () => {
      const folder = await pickTargetFolder();
      if (!folder) {
        return;
      }
      const history = await vscode.window.showQuickPick(['createWebHistory', 'createWebHashHistory'], {
        title: 'Mini-X: Create Router',
        placeHolder: 'Choose router history mode'
      });
      if (!history) {
        return;
      }
      await createFile(folder, 'router.js', routerTemplate(history === 'createWebHashHistory'));
    }),
    vscode.commands.registerCommand('minix.validateCurrentFile', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('Open a Mini-X file to validate.');
        return;
      }
      diagnostics.validate(editor.document);
      const count = diagnostics.collection.get(editor.document.uri)?.length ?? 0;
      vscode.window.showInformationMessage(`Mini-X validation found ${count} issue${count === 1 ? '' : 's'} in the current file.`);
    })
  );
}

async function pickTargetFolder(): Promise<vscode.Uri | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    vscode.window.showWarningMessage('Open a workspace folder before creating Mini-X files.');
    return undefined;
  }
  if (folders.length === 1) {
    return folders[0].uri;
  }
  const picked = await vscode.window.showQuickPick(folders.map((folder) => ({
    label: folder.name,
    description: folder.uri.fsPath,
    folder
  })), { title: 'Choose target workspace folder' });
  return picked?.folder.uri;
}

async function createFile(folder: vscode.Uri, fileName: string, content: string): Promise<void> {
  const relative = await vscode.window.showInputBox({
    title: 'Mini-X: File Path',
    prompt: 'Path relative to the selected workspace folder',
    value: fileName,
    validateInput: (value) => value.trim() ? undefined : 'Enter a file path.'
  });
  if (!relative) {
    return;
  }
  const uri = vscode.Uri.joinPath(folder, ...relative.split(/[\\/]+/).filter(Boolean));
  try {
    await vscode.workspace.fs.stat(uri);
    vscode.window.showErrorMessage(`File already exists: ${basename(uri)}`);
    return;
  } catch {
    await createParentDirectory(folder, relative);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);
  }
}

async function createParentDirectory(folder: vscode.Uri, relativePath: string): Promise<void> {
  const parts = relativePath.split(/[\\/]+/).filter(Boolean);
  const directoryParts = parts.slice(0, -1);
  if (directoryParts.length > 0) {
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder, ...directoryParts));
  }
}

function basename(uri: vscode.Uri): string {
  return uri.path.split('/').filter(Boolean).pop() ?? uri.toString();
}

function validateName(value: string): string | undefined {
  return value.trim() ? undefined : 'Enter a name.';
}
