// ============================================================
// StructureTreeProvider - Sidebar tree view for code structure
// ============================================================

import * as vscode from 'vscode';
import { SQLiteStore, Symbol, Layer, SymbolKind } from '@codeatlas/core';

/** Tree item with extra metadata */
interface StructureItem {
  label: string;
  kind: 'layer' | 'file' | 'symbol' | 'group';
  layer?: Layer;
  symbolKind?: SymbolKind;
  filePath?: string;
  line?: number;
  symbolId?: string;
  collapsibleState: vscode.TreeItemCollapsibleState;
  tooltip?: string;
  description?: string;
}

/** Layer display config */
const LAYER_CONFIG: Record<Layer, { emoji: string; color: string }> = {
  interface: { emoji: '🔵', color: '#3b82f6' },
  business: { emoji: '🟢', color: '#22c55e' },
  data:     { emoji: '🟠', color: '#f97316' },
  utility:  { emoji: '⚪', color: '#94a3b8' },
  unknown:  { emoji: '❓', color: '#6b7280' },
};

/** Symbol kind icons */
const KIND_ICONS: Partial<Record<SymbolKind, string>> = {
  class:     'symbol-class',
  function:  'symbol-method',
  method:    'symbol-method',
  interface: 'symbol-interface',
  type:      'symbol-interface',
  enum:      'symbol-enum',
  variable:  'symbol-variable',
  constant:  'symbol-variable',
  module:    'symbol-module',
  property:  'symbol-property',
};

export class StructureTreeProvider implements vscode.TreeDataProvider<StructureItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<StructureItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private store: SQLiteStore | null = null;
  private projectPath: string = '';

  constructor() {}

  /** Set the store and project path (called after scan) */
  setStore(store: SQLiteStore, projectPath: string) {
    this.store = store;
    this.projectPath = projectPath;
    this.refresh();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: StructureItem): vscode.TreeItem {
    const item = new vscode.TreeItem(element.label, element.collapsibleState);

    // Icon
    if (element.kind === 'layer' && element.layer) {
      const config = LAYER_CONFIG[element.layer];
      item.iconPath = new vscode.ThemeIcon('folder', new vscode.ThemeColor(this.layerToColor(element.layer)));
    } else if (element.kind === 'file') {
      item.iconPath = new vscode.ThemeIcon('file');
    } else if (element.kind === 'symbol' && element.symbolKind) {
      const iconName = KIND_ICONS[element.symbolKind] ?? 'symbol-misc';
      item.iconPath = new vscode.ThemeIcon(iconName);
    } else if (element.kind === 'group') {
      item.iconPath = new vscode.ThemeIcon('folder');
    }

    // Tooltip
    item.tooltip = element.tooltip ?? element.label;

    // Description
    if (element.description) {
      item.description = element.description;
    }

    // Click to open file
    if (element.filePath && element.line) {
      item.command = {
        command: 'vscode.open',
        title: 'Open',
        arguments: [
          vscode.Uri.file(element.filePath),
          { selection: new vscode.Range(element.line - 1, 0, element.line - 1, 0) },
        ],
      };
    }

    return item;
  }

  getChildren(element?: StructureItem): StructureItem[] {
    if (!this.store) {
      return [{ label: 'Run "CodeAtlas: Scan Project" to build graph', kind: 'group', collapsibleState: vscode.TreeItemCollapsibleState.None }];
    }

    // Root level: show layers
    if (!element) {
      return this.getRootItems();
    }

    // Layer level: show files
    if (element.kind === 'layer' && element.layer) {
      return this.getFileItems(element.layer);
    }

    // File level: show symbols
    if (element.kind === 'file' && element.filePath) {
      return this.getSymbolItems(element.filePath);
    }

    return [];
  }

  private getRootItems(): StructureItem[] {
    const layers: Layer[] = ['interface', 'business', 'data', 'utility', 'unknown'];
    const items: StructureItem[] = [];

    for (const layer of layers) {
      const symbols = this.store!.getSymbolsByLayer(layer);
      if (symbols.length === 0) continue;

      const config = LAYER_CONFIG[layer];
      items.push({
        label: `${config.emoji} ${layer.charAt(0).toUpperCase() + layer.slice(1)}`,
        kind: 'layer',
        layer,
        collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
        description: `${symbols.length} symbols`,
      });
    }

    return items;
  }

  private getFileItems(layer: Layer): StructureItem[] {
    const symbols = this.store!.getSymbolsByLayer(layer);
    const fileMap = new Map<string, Symbol[]>();

    for (const s of symbols) {
      if (!fileMap.has(s.filePath)) {
        fileMap.set(s.filePath, []);
      }
      fileMap.get(s.filePath)!.push(s);
    }

    const items: StructureItem[] = [];
    for (const [file, fileSymbols] of fileMap) {
      const relativePath = file;
      items.push({
        label: this.getFileName(file),
        kind: 'file',
        filePath: this.projectPath ? `${this.projectPath}/${file}` : file,
        collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        description: `${fileSymbols.length} symbols`,
        tooltip: file,
      });
    }

    return items;
  }

  private getSymbolItems(filePath: string): StructureItem[] {
    const symbols = this.store!.getSymbolsByFile(filePath);
    return symbols.map(s => ({
      label: s.name,
      kind: 'symbol' as const,
      symbolKind: s.kind,
      layer: s.layer,
      filePath: this.projectPath ? `${this.projectPath}/${s.filePath}` : s.filePath,
      line: s.startLine,
      symbolId: s.id,
      collapsibleState: vscode.TreeItemCollapsibleState.None,
      description: s.kind,
      tooltip: `${s.name} (${s.kind}) @ ${s.filePath}:${s.startLine}`,
    }));
  }

  private getFileName(filePath: string): string {
    const parts = filePath.split(/[/\\]/);
    return parts[parts.length - 1] ?? filePath;
  }

  private layerToColor(layer: Layer): string {
    const colors: Record<Layer, string> = {
      interface: 'charts.blue',
      business: 'charts.green',
      data: 'charts.orange',
      utility: 'charts.foreground',
      unknown: 'disabledForeground',
    };
    return colors[layer] ?? 'charts.foreground';
  }
}

// ============================================================
// LayersTreeProvider - Architecture layers overview
// ============================================================

interface LayerItem {
  label: string;
  layer: Layer | 'summary';
  count?: number;
  percentage?: number;
  collapsibleState: vscode.TreeItemCollapsibleState;
}

export class LayersTreeProvider implements vscode.TreeDataProvider<LayerItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<LayerItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private store: SQLiteStore | null = null;

  constructor() {}

  setStore(store: SQLiteStore) {
    this.store = store;
    this.refresh();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: LayerItem): vscode.TreeItem {
    const item = new vscode.TreeItem(element.label, element.collapsibleState);

    if (element.layer !== 'summary') {
      const config = LAYER_CONFIG[element.layer];
      item.iconPath = new vscode.ThemeIcon('symbol-enum');
      item.description = `${element.count} symbols (${element.percentage}%)`;

      // Progress bar visualization
      const bars = Math.round((element.percentage ?? 0) / 10);
      item.description = `${'█'.repeat(bars)}${'░'.repeat(10 - bars)} ${element.count}`;
    } else {
      item.iconPath = new vscode.ThemeIcon('graph');
    }

    return item;
  }

  getChildren(element?: LayerItem): LayerItem[] {
    if (!this.store) {
      return [{ label: 'No data', layer: 'summary', collapsibleState: vscode.TreeItemCollapsibleState.None }];
    }

    if (!element) {
      return this.getLayerItems();
    }

    return [];
  }

  private getLayerItems(): LayerItem[] {
    const stats = this.store!.getStats();
    const layers: Layer[] = ['interface', 'business', 'data', 'utility'];
    const items: LayerItem[] = [];

    // Summary
    items.push({
      label: '📊 Project Summary',
      layer: 'summary',
      collapsibleState: vscode.TreeItemCollapsibleState.None,
    });

    // Each layer
    for (const layer of layers) {
      const symbols = this.store!.getSymbolsByLayer(layer);
      const percentage = stats.symbols > 0 ? Math.round((symbols.length / stats.symbols) * 100) : 0;
      const config = LAYER_CONFIG[layer];

      items.push({
        label: `${config.emoji} ${layer.charAt(0).toUpperCase() + layer.slice(1)}`,
        layer,
        count: symbols.length,
        percentage,
        collapsibleState: vscode.TreeItemCollapsibleState.None,
      });
    }

    return items;
  }
}
