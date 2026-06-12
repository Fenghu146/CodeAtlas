// ============================================================
// GraphWebviewProvider - Interactive graph visualization
// ============================================================

import * as vscode from 'vscode';
import { SQLiteStore } from '@codeatlas/core';

export class GraphWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'codeatlas.graphView';

  private _view?: vscode.WebviewView;
  private store: SQLiteStore | null = null;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'refresh':
          await this.refreshGraph();
          break;
        case 'selectNode':
          this.selectNode(message.id);
          break;
      }
    });
  }

  setStore(store: SQLiteStore) {
    this.store = store;
    this.refreshGraph();
  }

  public async refreshGraph() {
    if (!this._view || !this.store) return;

    const graphData = this.getGraphData();
    this._view.webview.postMessage({ command: 'updateGraph', data: graphData });
  }

  private getGraphData() {
    if (!this.store) return { nodes: [], edges: [] };

    const stats = this.store.getStats();
    const symbols = this.store.searchSymbols('*', { limit: 500 });

    const nodes = symbols.map(s => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      layer: s.layer,
      file: s.filePath,
      line: s.startLine,
      exported: s.exported,
    }));

    const edges: any[] = [];
    for (const symbol of symbols) {
      const outgoing = this.store.getRelationshipsFrom(symbol.id);
      for (const rel of outgoing) {
        edges.push({
          id: rel.id,
          source: rel.sourceId,
          target: rel.targetId,
          kind: rel.kind,
        });
      }
    }

    return { nodes, edges, stats };
  }

  private selectNode(nodeId: string) {
    // Find symbol and open file
    if (!this.store) return;
    const symbol = this.store.getSymbol(nodeId);
    if (symbol) {
      vscode.commands.executeCommand('vscode.open', vscode.Uri.file(symbol.filePath), {
        selection: new vscode.Range(symbol.startLine - 1, 0, symbol.startLine - 1, 0),
      });
    }
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.js')
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Code Graph</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: var(--vscode-font-family);
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      overflow: hidden;
    }
    #graph { width: 100vw; height: 100vh; }
    .controls {
      position: absolute;
      bottom: 10px;
      right: 10px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .controls button {
      width: 30px;
      height: 30px;
      background: var(--vscode-button-background);
      border: 1px solid var(--vscode-button-border);
      border-radius: 4px;
      color: var(--vscode-button-foreground);
      cursor: pointer;
    }
    .controls button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      color: var(--vscode-descriptionForeground);
    }
    .empty-state h2 { margin-bottom: 8px; }
    .empty-state code {
      background: var(--vscode-textCodeBlock-background);
      padding: 2px 6px;
      border-radius: 4px;
    }
  </style>
</head>
<body>
  <div id="graph"></div>
  <div class="controls">
    <button id="btnZoomIn" title="Zoom in">+</button>
    <button id="btnZoomOut" title="Zoom out">−</button>
    <button id="btnFit" title="Fit to screen">⊡</button>
  </div>

  <script src="https://unpkg.com/cytoscape@3.28.0/dist/cytoscape.min.js"></script>
  <script>
    const vscode = acquireVsCodeApi();
    let cy = null;
    let graphData = null;

    // Layer colors
    const LAYER_COLORS = {
      interface: '#3b82f6',
      business: '#22c55e',
      data: '#f97316',
      utility: '#94a3b8',
      unknown: '#6b7280',
    };

    // Initialize
    function initGraph(data) {
      if (!data || data.nodes.length === 0) {
        document.getElementById('graph').innerHTML = \`
          <div class="empty-state">
            <h2>No Graph Data</h2>
            <p>Run <code>CodeAtlas: Scan Project</code> first</p>
          </div>
        \`;
        return;
      }

      const elements = [
        ...data.nodes.map(node => ({
          data: {
            id: node.id,
            label: node.name,
            kind: node.kind,
            layer: node.layer,
            file: node.file,
            line: node.line,
          },
          classes: \`layer-\${node.layer} kind-\${node.kind}\`,
        })),
        ...data.edges.map((edge, i) => ({
          data: {
            id: \`e-\${i}\`,
            source: edge.source,
            target: edge.target,
            kind: edge.kind,
          },
          classes: \`rel-\${edge.kind}\`,
        })),
      ];

      cy = cytoscape({
        container: document.getElementById('graph'),
        elements,
        style: [
          {
            selector: 'node',
            style: {
              'label': 'data(label)',
              'text-valign': 'center',
              'text-halign': 'center',
              'font-size': '10px',
              'color': '#f1f5f9',
              'text-outline-color': '#0f172a',
              'text-outline-width': 2,
              'width': 30,
              'height': 30,
              'border-width': 2,
              'border-color': '#475569',
              'background-opacity': 0.9,
            },
          },
          ...Object.entries(LAYER_COLORS).map(([layer, color]) => ({
            selector: \`node.layer-\${layer}\`,
            style: { 'background-color': color },
          })),
          {
            selector: 'edge',
            style: {
              'width': 1,
              'line-color': '#475569',
              'target-arrow-color': '#475569',
              'target-arrow-shape': 'triangle',
              'curve-style': 'bezier',
              'arrow-scale': 0.6,
              'opacity': 0.4,
            },
          },
          {
            selector: 'node:selected',
            style: {
              'border-width': 3,
              'border-color': '#f59e0b',
              'z-index': 999,
            },
          },
        ],
        layout: {
          name: 'cose',
          animate: true,
          nodeRepulsion: () => 8000,
          idealEdgeLength: () => 100,
          gravity: 0.25,
        },
        minZoom: 0.1,
        maxZoom: 5,
        wheelSensitivity: 0.3,
      });

      // Click to select
      cy.on('tap', 'node', (evt) => {
        vscode.postMessage({ command: 'selectNode', id: evt.target.id() });
      });

      // Controls
      document.getElementById('btnZoomIn').onclick = () => cy.zoom(cy.zoom() * 1.3);
      document.getElementById('btnZoomOut').onclick = () => cy.zoom(cy.zoom() / 1.3);
      document.getElementById('btnFit').onclick = () => cy.fit(undefined, 50);
    }

    // Handle messages from extension
    window.addEventListener('message', (event) => {
      const message = event.data;
      switch (message.command) {
        case 'updateGraph':
          graphData = message.data;
          if (cy) {
            cy.destroy();
          }
          initGraph(message.data);
          break;
      }
    });

    // Request initial data
    vscode.postMessage({ command: 'refresh' });
  </script>
</body>
</html>`;
  }
}
