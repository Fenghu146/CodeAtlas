// ============================================================
// CodeLensProvider - Show caller/callee counts above functions
// ============================================================

import * as vscode from 'vscode';
import { SQLiteStore } from '@codeatlas/core';

export class CodeAtlasCodeLensProvider implements vscode.CodeLensProvider {
  private store: SQLiteStore | null = null;
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  constructor() {}

  setStore(store: SQLiteStore) {
    this.store = store;
    this._onDidChangeCodeLenses.fire();
  }

  refresh() {
    this._onDidChangeCodeLenses.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!this.store) return [];

    const lenses: vscode.CodeLens[] = [];
    const filePath = this.getRelativePath(document.uri.fsPath);

    // Get symbols in this file
    const symbols = this.store.getSymbolsByFile(filePath);

    for (const symbol of symbols) {
      // Only show for functions, methods, classes
      if (!['function', 'method', 'class'].includes(symbol.kind)) continue;

      const line = symbol.startLine - 1; // Convert to 0-based
      if (line < 0 || line >= document.lineCount) continue;

      const range = new vscode.Range(line, 0, line, 0);

      // Get callers and callees
      const callers = this.store.getCallers(symbol.id);
      const callees = this.store.getCallees(symbol.id);

      // Caller lens
      if (callers.length > 0) {
        lenses.push(new vscode.CodeLens(range, {
          title: `↑ ${callers.length} caller${callers.length > 1 ? 's' : ''}`,
          command: 'codeatlas.showCallers',
          arguments: [symbol.id],
          tooltip: `Show ${callers.length} callers of ${symbol.name}`,
        }));
      }

      // Callee lens
      if (callees.length > 0) {
        lenses.push(new vscode.CodeLens(range, {
          title: `↓ ${callees.length} callee${callees.length > 1 ? 's' : ''}`,
          command: 'codeatlas.showCallees',
          arguments: [symbol.id],
          tooltip: `Show ${callees.length} callees of ${symbol.name}`,
        }));
      }

      // Layer badge
      const layerEmoji: Record<string, string> = {
        interface: '🔵',
        business: '🟢',
        data: '🟠',
        utility: '⚪',
        unknown: '❓',
      };
      const emoji = layerEmoji[symbol.layer] ?? '❓';
      lenses.push(new vscode.CodeLens(range, {
        title: `${emoji} ${symbol.layer}`,
        command: '',
        tooltip: `Layer: ${symbol.layer}`,
      }));
    }

    return lenses;
  }

  private getRelativePath(absolutePath: string): string {
    // Try to get relative path from workspace
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (workspaceFolder) {
      const workspacePath = workspaceFolder.uri.fsPath;
      if (absolutePath.startsWith(workspacePath)) {
        return absolutePath.slice(workspacePath.length + 1).replace(/\\/g, '/');
      }
    }
    return absolutePath;
  }
}
