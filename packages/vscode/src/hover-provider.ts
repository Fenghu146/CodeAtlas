// ============================================================
// HoverProvider - Show symbol info on hover
// ============================================================

import * as vscode from 'vscode';
import { SQLiteStore } from '@codeatlas/core';

const LAYER_EMOJI: Record<string, string> = {
  interface: '🔵',
  business: '🟢',
  data: '🟠',
  utility: '⚪',
  unknown: '❓',
};

export class CodeAtlasHoverProvider implements vscode.HoverProvider {
  private store: SQLiteStore | null = null;

  constructor() {}

  setStore(store: SQLiteStore) {
    this.store = store;
  }

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.ProviderResult<vscode.Hover> {
    if (!this.store) return null;

    // Get the word at cursor
    const wordRange = document.getWordRangeAtPosition(position);
    if (!wordRange) return null;

    const word = document.getText(wordRange);
    if (!word || word.length < 2) return null;

    // Search for the symbol
    const results = this.store.searchSymbols(word, { limit: 5 });
    if (results.length === 0) return null;

    // Find exact match in current file first
    const currentFile = document.uri.fsPath;
    const symbol = results.find(s => s.filePath === currentFile && s.name === word)
      ?? results.find(s => s.name === word)
      ?? results[0];

    // Build hover content
    const lines: string[] = [];

    // Header
    const emoji = LAYER_EMOJI[symbol.layer] ?? '❓';
    lines.push(`**${emoji} ${symbol.name}** (${symbol.kind})`);
    lines.push('');

    // Location
    lines.push(`📍 \`${symbol.filePath}:${symbol.startLine}\``);

    // Layer
    lines.push(`🏗️ Layer: **${symbol.layer}**`);

    // Export status
    if (symbol.exported) {
      lines.push(`📤 Exported`);
    }

    // Complexity
    if (symbol.complexity !== undefined) {
      lines.push(`📊 Complexity: ${symbol.complexity}`);
    }

    // AI Summary
    if (symbol.aiSummary) {
      lines.push('');
      lines.push(`🤖 *${symbol.aiSummary}*`);
    }

    // Doc comment
    if (symbol.docComment) {
      lines.push('');
      lines.push(symbol.docComment);
    }

    // Callers/Callees count
    const callers = this.store.getCallers(symbol.id);
    const callees = this.store.getCallees(symbol.id);
    if (callers.length > 0 || callees.length > 0) {
      lines.push('');
      lines.push(`📞 Callers: ${callers.length} | 📞 Callees: ${callees.length}`);
    }

    const markdown = new vscode.MarkdownString(lines.join('\n'));
    return new vscode.Hover(markdown, wordRange);
  }
}
