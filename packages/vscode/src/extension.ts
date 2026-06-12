// ============================================================
// CodeAtlas VSCode Extension - Main Entry Point
// ============================================================

import * as vscode from 'vscode';
import * as path from 'path';
import { SQLiteStore, ProjectScanner, ImpactAnalyzer } from '@codeatlas/core';
import { StructureTreeProvider, LayersTreeProvider } from './tree-provider';
import { GraphWebviewProvider } from './webview-provider';
import { CodeAtlasHoverProvider } from './hover-provider';
import { CodeAtlasCodeLensProvider } from './codelens-provider';

// Global state
let store: SQLiteStore | null = null;
let structureProvider: StructureTreeProvider;
let layersProvider: LayersTreeProvider;
let graphProvider: GraphWebviewProvider;
let hoverProvider: CodeAtlasHoverProvider;
let codeLensProvider: CodeAtlasCodeLensProvider;

/**
 * Called when the extension is activated.
 */
export function activate(context: vscode.ExtensionContext) {
  console.log('CodeAtlas extension activating...');

  // Get workspace root
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    vscode.window.showWarningMessage('CodeAtlas: No workspace folder found');
    return;
  }

  // Initialize providers
  structureProvider = new StructureTreeProvider();
  layersProvider = new LayersTreeProvider();
  graphProvider = new GraphWebviewProvider(context.extensionUri);
  hoverProvider = new CodeAtlasHoverProvider();
  codeLensProvider = new CodeAtlasCodeLensProvider();

  // Initialize store (async) and set on providers when ready
  const dbPath = path.join(workspaceRoot, '.codeatlas', 'db.sqlite');
  SQLiteStore.create({ dbPath }).then(initializedStore => {
    store = initializedStore;
    structureProvider.setStore(store, workspaceRoot);
    layersProvider.setStore(store);
    hoverProvider.setStore(store);
    codeLensProvider.setStore(store);
  }).catch(err => {
    vscode.window.showErrorMessage(`CodeAtlas: Failed to initialize database: ${err}`);
  });

  // Register TreeView providers
  vscode.window.registerTreeDataProvider('codeatlas.structureView', structureProvider);
  vscode.window.registerTreeDataProvider('codeatlas.layersView', layersProvider);

  // Register WebviewView provider
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(GraphWebviewProvider.viewType, graphProvider)
  );

  // Register Hover provider
  context.subscriptions.push(
    vscode.languages.registerHoverProvider('*', hoverProvider)
  );

  // Register CodeLens provider
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider('*', codeLensProvider)
  );

  // Register commands
  registerCommands(context, workspaceRoot);

  // Watch for file changes
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.{ts,js,py,go,rs,java}');
  watcher.onDidChange(() => {
    codeLensProvider.refresh();
  });
  context.subscriptions.push(watcher);

  console.log('CodeAtlas extension activated');
}

function registerCommands(context: vscode.ExtensionContext, workspaceRoot: string) {
  // Scan command
  context.subscriptions.push(
    vscode.commands.registerCommand('codeatlas.scan', async () => {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'CodeAtlas: Scanning...' },
        async (progress) => {
          try {
            const scanner = new ProjectScanner(store!);
            const result = await scanner.scan({
              projectPath: workspaceRoot,
              onProgress: (current, total, file) => {
                progress.report({
                  message: `${current}/${total}`,
                  increment: (1 / total) * 100,
                });
              },
            });

            vscode.window.showInformationMessage(
              `CodeAtlas: Scanned ${result.filesScanned} files, found ${result.symbolsFound} symbols`
            );

            // Refresh all views
            structureProvider.refresh();
            layersProvider.refresh();
            graphProvider.refreshGraph();
            codeLensProvider.refresh();
          } catch (err) {
            vscode.window.showErrorMessage(`CodeAtlas scan failed: ${err}`);
          }
        }
      );
    })
  );

  // Search command
  context.subscriptions.push(
    vscode.commands.registerCommand('codeatlas.search', async () => {
      const query = await vscode.window.showInputBox({
        prompt: 'Search symbols',
        placeHolder: 'e.g., UserService, handleAuth, create',
      });
      if (!query) return;

      const results = store!.searchSymbols(query, { limit: 20 });
      if (results.length === 0) {
        vscode.window.showInformationMessage(`No symbols found for "${query}"`);
        return;
      }

      const items = results.map(s => ({
        label: `${s.name}`,
        description: `${s.kind} · ${s.layer}`,
        detail: `${s.filePath}:${s.startLine}`,
        symbol: s,
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: `Found ${results.length} symbols`,
      });

      if (selected) {
        const uri = vscode.Uri.file(path.join(workspaceRoot, selected.symbol.filePath));
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, {
          selection: new vscode.Range(
            selected.symbol.startLine - 1, 0,
            selected.symbol.startLine - 1, 0
          ),
        });
      }
    })
  );

  // Show Graph command
  context.subscriptions.push(
    vscode.commands.registerCommand('codeatlas.showGraph', () => {
      const panel = vscode.window.createWebviewPanel(
        'codeatlas.graph',
        'Code Graph',
        vscode.ViewColumn.Two,
        { enableScripts: true, retainContextWhenHidden: true }
      );
      panel.webview.html = getGraphWebviewHtml();
    })
  );

  // Analyze Impact command
  context.subscriptions.push(
    vscode.commands.registerCommand('codeatlas.analyzeImpact', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
      }

      const selection = editor.document.getText(editor.selection);
      if (!selection) {
        vscode.window.showWarningMessage('Select a symbol name first');
        return;
      }

      const results = store!.searchSymbols(selection, { limit: 5 });
      if (results.length === 0) {
        vscode.window.showInformationMessage(`Symbol "${selection}" not found`);
        return;
      }

      const symbol = results[0];
      const analyzer = new ImpactAnalyzer(store!);
      const impact = analyzer.analyze(symbol.id, 3);

      if (impact) {
        // Show in output channel
        const channel = vscode.window.createOutputChannel('CodeAtlas Impact');
        channel.clear();
        channel.appendLine(impact.summary);
        channel.show();
      }
    })
  );

  // Explain File command
  context.subscriptions.push(
    vscode.commands.registerCommand('codeatlas.explainFile', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const filePath = editor.document.uri.fsPath;
      const relativePath = path.relative(workspaceRoot, filePath).replace(/\\/g, '/');
      const symbols = store!.getSymbolsByFile(relativePath);

      if (symbols.length === 0) {
        vscode.window.showInformationMessage('No symbols found in this file');
        return;
      }

      // Show file summary
      const lines = [
        `## ${relativePath}`,
        '',
        `**${symbols.length} symbols found:**`,
        '',
      ];

      for (const s of symbols) {
        lines.push(`- **${s.name}** (${s.kind}, ${s.layer}) @ line ${s.startLine}`);
      }

      const panel = vscode.window.createWebviewPanel(
        'codeatlas.explain',
        `Explain: ${path.basename(filePath)}`,
        vscode.ViewColumn.Two,
        {}
      );
      panel.webview.html = getExplainWebviewHtml(lines.join('\n'));
    })
  );

  // Show Layers command
  context.subscriptions.push(
    vscode.commands.registerCommand('codeatlas.showLayers', async () => {
      const stats = store!.getStats();
      const layers = ['interface', 'business', 'data', 'utility'] as const;

      const lines = [
        '## Architecture Layers',
        '',
        `**${stats.symbols} symbols, ${stats.relationships} relationships, ${stats.files} files**`,
        '',
      ];

      for (const layer of layers) {
        const symbols = store!.getSymbolsByLayer(layer);
        const pct = stats.symbols > 0 ? Math.round((symbols.length / stats.symbols) * 100) : 0;
        lines.push(`### ${layer.toUpperCase()} (${symbols.length} symbols, ${pct}%)`);
        lines.push('');
        for (const s of symbols.slice(0, 10)) {
          lines.push(`- ${s.name} (${s.kind}) @ ${s.filePath}:${s.startLine}`);
        }
        if (symbols.length > 10) {
          lines.push(`- ... and ${symbols.length - 10} more`);
        }
        lines.push('');
      }

      const panel = vscode.window.createWebviewPanel(
        'codeatlas.layers',
        'Architecture Layers',
        vscode.ViewColumn.Two,
        {}
      );
      panel.webview.html = getExplainWebviewHtml(lines.join('\n'));
    })
  );

  // Show Callers
  context.subscriptions.push(
    vscode.commands.registerCommand('codeatlas.showCallers', (symbolId: string) => {
      const callers = store!.getCallers(symbolId);
      const symbol = store!.getSymbol(symbolId);

      const items = callers.map(s => ({
        label: s.name,
        description: `${s.kind} · ${s.layer}`,
        detail: `${s.filePath}:${s.startLine}`,
        symbol: s,
      }));

      vscode.window.showQuickPick(items, {
        placeHolder: `${callers.length} callers of ${symbol?.name ?? symbolId}`,
      }).then(selected => {
        if (selected) {
          const uri = vscode.Uri.file(path.join(workspaceRoot, selected.symbol.filePath));
          vscode.window.showTextDocument(uri, {
            selection: new vscode.Range(
              selected.symbol.startLine - 1, 0,
              selected.symbol.startLine - 1, 0
            ),
          });
        }
      });
    })
  );

  // Show Callees
  context.subscriptions.push(
    vscode.commands.registerCommand('codeatlas.showCallees', (symbolId: string) => {
      const callees = store!.getCallees(symbolId);
      const symbol = store!.getSymbol(symbolId);

      const items = callees.map(s => ({
        label: s.name,
        description: `${s.kind} · ${s.layer}`,
        detail: `${s.filePath}:${s.startLine}`,
        symbol: s,
      }));

      vscode.window.showQuickPick(items, {
        placeHolder: `${callees.length} callees of ${symbol?.name ?? symbolId}`,
      }).then(selected => {
        if (selected) {
          const uri = vscode.Uri.file(path.join(workspaceRoot, selected.symbol.filePath));
          vscode.window.showTextDocument(uri, {
            selection: new vscode.Range(
              selected.symbol.startLine - 1, 0,
              selected.symbol.startLine - 1, 0
            ),
          });
        }
      });
    })
  );
}

/**
 * Called when the extension is deactivated.
 */
export function deactivate() {
  if (store) {
    store.close();
  }
}

// ============================================================
// Helper functions
// ============================================================

function getGraphWebviewHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { margin: 0; padding: 0; overflow: hidden; }
    #graph { width: 100vw; height: 100vh; }
  </style>
</head>
<body>
  <div id="graph"></div>
  <script src="https://unpkg.com/cytoscape@3.28.0/dist/cytoscape.min.js"></script>
  <script>
    // Graph visualization will be loaded here
    document.getElementById('graph').innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:#888;">Graph visualization loading...</div>';
  </script>
</body>
</html>`;
}

function getExplainWebviewHtml(markdown: string): string {
  // Simple markdown to HTML conversion
  const html = markdown
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    .replace(/\n\n/g, '<br><br>');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: var(--vscode-font-family);
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      padding: 20px;
      line-height: 1.6;
    }
    h1, h2, h3 { margin-top: 16px; margin-bottom: 8px; }
    code {
      background: var(--vscode-textCodeBlock-background);
      padding: 2px 6px;
      border-radius: 4px;
    }
    ul { margin: 8px 0; }
    li { margin: 4px 0; }
  </style>
</head>
<body>
  ${html}
</body>
</html>`;
}
