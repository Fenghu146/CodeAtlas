// ============================================================
// CodeAtlas Web App - Main Application Logic
// ============================================================

import cytoscape, { type Core, type EventObject } from 'cytoscape';

// ========================
// Configuration
// ========================
const LAYER_COLORS: Record<string, string> = {
  interface: '#3b82f6',
  business: '#22c55e',
  data: '#f97316',
  utility: '#94a3b8',
  unknown: '#6b7280',
};

const KIND_SHAPES: Record<string, string> = {
  class: 'diamond',
  function: 'roundrectangle',
  method: 'roundrectangle',
  interface: 'hexagon',
  type: 'hexagon',
  enum: 'octagon',
  variable: 'ellipse',
  constant: 'ellipse',
  module: 'rectangle',
  property: 'ellipse',
  namespace: 'rectangle',
};

// ========================
// App State
// ========================
interface AppState {
  cy: Core | null;
  activeLayers: Set<string>;
  selectedNode: string | null;
  graphData: { nodes: any[]; edges: any[] } | null;
  layoutType: 'cose' | 'breadthfirst' | 'circle';
}

const state: AppState = {
  cy: null,
  activeLayers: new Set(['interface', 'business', 'data', 'utility', 'unknown']),
  selectedNode: null,
  graphData: null,
  layoutType: 'cose',
};

// ========================
// Initialization
// ========================
async function init() {
  console.log('CodeAtlas Web initializing...');
  
  // Load graph data from API or local file
  state.graphData = await loadGraphData();
  
  if (state.graphData && state.graphData.nodes.length > 0) {
    initGraph(state.graphData);
    updateStats(state.graphData);
    hideEmptyState();
  }
  
  setupEventListeners();
}

// ========================
// Data Loading
// ========================
async function loadGraphData(): Promise<{ nodes: any[]; edges: any[] } | null> {
  try {
    // Try fetching from API (when served by codeatlas serve)
    const response = await fetch('/api/graph');
    if (response.ok) {
      return await response.json();
    }
  } catch {
    // Not running via serve command
  }

  // Try loading from URL parameter
  const params = new URLSearchParams(window.location.search);
  const dataUrl = params.get('data');
  if (dataUrl) {
    try {
      const response = await fetch(dataUrl);
      return await response.json();
    } catch (err) {
      console.error('Failed to load graph data from URL:', err);
    }
  }

  return null;
}

// ========================
// Graph Initialization
// ========================
function initGraph(data: { nodes: any[]; edges: any[] }) {
  const container = document.getElementById('cy')!;

  // Transform data to Cytoscape format
  const elements = [
    ...data.nodes.map(node => ({
      data: {
        id: node.id,
        label: node.name,
        kind: node.kind,
        layer: node.layer,
        file: node.filePath,
        line: node.startLine,
        exported: node.exported,
        complexity: node.complexity,
        weight: node.referenceCount ?? 1,
      },
      classes: `layer-${node.layer} kind-${node.kind}`,
    })),
    ...data.edges.map((edge, i) => ({
      data: {
        id: `e-${i}`,
        source: edge.sourceId,
        target: edge.targetId,
        kind: edge.kind,
        label: edge.kind,
      },
      classes: `rel-${edge.kind}`,
    })),
  ];

  state.cy = cytoscape({
    container,
    elements,
    
    style: [
      // Node base style
      {
        selector: 'node',
        style: {
          'label': 'data(label)',
          'text-valign': 'center',
          'text-halign': 'center',
          'font-size': '11px',
          'color': '#f1f5f9',
          'text-outline-color': '#0f172a',
          'text-outline-width': 2,
          'width': 'mapData(weight, 1, 50, 30, 80)',
          'height': 'mapData(weight, 1, 50, 30, 80)',
          'border-width': 2,
          'border-color': '#475569',
          'background-opacity': 0.9,
        },
      },
      // Layer colors
      ...Object.entries(LAYER_COLORS).map(([layer, color]) => ({
        selector: `node.layer-${layer}`,
        style: { 'background-color': color },
      })),
      // Kind shapes
      ...Object.entries(KIND_SHAPES).map(([kind, shape]) => ({
        selector: `node.kind-${kind}`,
        style: { 'shape': shape },
      })),
      // Edge base style
      {
        selector: 'edge',
        style: {
          'width': 1.5,
          'line-color': '#475569',
          'target-arrow-color': '#475569',
          'target-arrow-shape': 'triangle',
          'curve-style': 'bezier',
          'arrow-scale': 0.8,
          'opacity': 0.5,
        },
      },
      // Highlighted state
      {
        selector: 'node:selected',
        style: {
          'border-width': 3,
          'border-color': '#f59e0b',
          'z-index': 999,
        },
      },
      {
        selector: 'node.highlighted',
        style: {
          'border-width': 3,
          'border-color': '#f59e0b',
          'opacity': 1,
        },
      },
      {
        selector: 'edge.highlighted',
        style: {
          'width': 3,
          'line-color': '#f59e0b',
          'target-arrow-color': '#f59e0b',
          'opacity': 1,
        },
      },
      // Dimmed state
      {
        selector: 'node.dimmed',
        style: { 'opacity': 0.2 },
      },
      {
        selector: 'edge.dimmed',
        style: { 'opacity': 0.1 },
      },
    ],

    layout: {
      name: 'cose',
      animate: true,
      animationDuration: 800,
      nodeRepulsion: () => 8000,
      idealEdgeLength: () => 100,
      gravity: 0.25,
      numIter: 1000,
    } as any,

    // Interaction settings
    minZoom: 0.1,
    maxZoom: 5,
    wheelSensitivity: 0.3,
  });

  // Event handlers
  state.cy.on('tap', 'node', (evt: EventObject) => {
    selectNode(evt.target.id());
  });

  state.cy.on('tap', (evt: EventObject) => {
    if (evt.target === state.cy) {
      deselectAll();
    }
  });

  state.cy.on('dbltap', 'node', (evt: EventObject) => {
    focusOnNeighbors(evt.target.id());
  });
}

// ========================
// Node Selection & Detail Panel
// ========================
function selectNode(nodeId: string) {
  if (!state.cy) return;

  state.selectedNode = nodeId;
  const node = state.cy.getElementById(nodeId);
  const data = node.data();

  // Highlight node and neighbors
  state.cy.elements().removeClass('highlighted dimmed');
  const neighborhood = node.closedNeighborhood();
  state.cy.elements().addClass('dimmed');
  neighborhood.removeClass('dimmed').addClass('highlighted');

  // Update detail panel
  const panel = document.getElementById('detailPanel')!;
  panel.classList.remove('hidden');

  document.getElementById('detailName')!.textContent = data.label;
  
  const kindBadge = document.getElementById('detailKind')!;
  kindBadge.textContent = data.kind;
  
  const layerBadge = document.getElementById('detailLayer')!;
  layerBadge.textContent = data.layer;
  layerBadge.className = `badge layer-${data.layer}`;

  document.getElementById('detailFile')!.textContent = `${data.file}:${data.line}`;
  document.getElementById('detailComplexity')!.textContent = data.complexity ?? '-';

  // Count callers and callees
  const incoming = state.cy.edges(`[target = "${nodeId}"]`).length;
  const outgoing = state.cy.edges(`[source = "${nodeId}"]`).length;
  document.getElementById('detailCallers')!.textContent = String(incoming);
  document.getElementById('detailCallees')!.textContent = String(outgoing);
}

function deselectAll() {
  if (!state.cy) return;
  state.selectedNode = null;
  state.cy.elements().removeClass('highlighted dimmed');
  document.getElementById('detailPanel')!.classList.add('hidden');
}

function focusOnNeighbors(nodeId: string) {
  if (!state.cy) return;
  const node = state.cy.getElementById(nodeId);
  state.cy.fit(node.closedNeighborhood(), 50);
}

// ========================
// Layer Filtering
// ========================
function updateLayerFilter() {
  if (!state.cy) return;

  state.cy.nodes().forEach(node => {
    const layer = node.data('layer');
    if (state.activeLayers.has(layer)) {
      node.style('display', 'element');
    } else {
      node.style('display', 'none');
    }
  });

  // Also hide edges connected to hidden nodes
  state.cy.edges().forEach(edge => {
    const sourceVisible = edge.source().style('display') !== 'none';
    const targetVisible = edge.target().style('display') !== 'none';
    edge.style('display', sourceVisible && targetVisible ? 'element' : 'none');
  });
}

// ========================
// Stats Update
// ========================
function updateStats(data: { nodes: any[]; edges: any[] }) {
  const files = new Set(data.nodes.map(n => n.file ?? n.filePath));
  document.getElementById('statFiles')!.textContent = String(files.size);
  document.getElementById('statSymbols')!.textContent = String(data.nodes.length);
  document.getElementById('statRelationships')!.textContent = String(data.edges.length);

  // Layer counts
  const layerCounts: Record<string, number> = {};
  for (const node of data.nodes) {
    const layer = node.layer ?? 'unknown';
    layerCounts[layer] = (layerCounts[layer] ?? 0) + 1;
  }
  document.getElementById('countInterface')!.textContent = String(layerCounts.interface ?? 0);
  document.getElementById('countBusiness')!.textContent = String(layerCounts.business ?? 0);
  document.getElementById('countData')!.textContent = String(layerCounts.data ?? 0);
  document.getElementById('countUtility')!.textContent = String(layerCounts.utility ?? 0);
}

function hideEmptyState() {
  document.getElementById('emptyState')!.style.display = 'none';
}

// ========================
// Event Listeners
// ========================
function setupEventListeners() {
  // Search
  const searchInput = document.getElementById('searchInput') as HTMLInputElement;
  searchInput.addEventListener('input', (e) => {
    const query = (e.target as HTMLInputElement).value.toLowerCase();
    if (query.length < 2) {
      document.getElementById('searchResults')!.classList.add('hidden');
      return;
    }
    performSearch(query);
  });

  // Layer toggles
  document.querySelectorAll('.layer-toggle input').forEach(input => {
    input.addEventListener('change', (e) => {
      const layer = (e.target as HTMLInputElement).dataset.layer!;
      if ((e.target as HTMLInputElement).checked) {
        state.activeLayers.add(layer);
      } else {
        state.activeLayers.delete(layer);
      }
      updateLayerFilter();
    });
  });

  // Graph controls
  document.getElementById('btnZoomIn')?.addEventListener('click', () => {
    state.cy?.zoom(state.cy.zoom() * 1.3);
  });
  document.getElementById('btnZoomOut')?.addEventListener('click', () => {
    state.cy?.zoom(state.cy.zoom() / 1.3);
  });
  document.getElementById('btnFit')?.addEventListener('click', () => {
    state.cy?.fit(undefined, 50);
  });
  document.getElementById('btnLayout')?.addEventListener('click', () => {
    cycleLayout();
  });
  document.getElementById('btnFullscreen')?.addEventListener('click', () => {
    document.getElementById('graphContainer')?.requestFullscreen();
  });

  // Detail panel close
  document.getElementById('detailClose')?.addEventListener('click', deselectAll);

  // Detail panel actions
  document.getElementById('btnCopyPath')?.addEventListener('click', () => {
    const file = document.getElementById('detailFile')?.textContent;
    if (file) navigator.clipboard.writeText(file);
  });
}

// ========================
// Search
// ========================
function performSearch(query: string) {
  if (!state.cy || !state.graphData) return;

  const results = state.graphData.nodes.filter(n =>
    n.name?.toLowerCase().includes(query) ||
    n.label?.toLowerCase().includes(query) ||
    n.file?.toLowerCase().includes(query) ||
    n.filePath?.toLowerCase().includes(query)
  ).slice(0, 10);

  const container = document.getElementById('searchResults')!;
  if (results.length === 0) {
    container.innerHTML = '<div class="search-result-item">No results</div>';
    container.classList.remove('hidden');
    return;
  }

  container.innerHTML = results.map(r => `
    <div class="search-result-item" data-id="${r.id}">
      <strong>${r.name ?? r.label}</strong>
      <span style="color: var(--text-muted); margin-left: 8px;">(${r.kind})</span>
      <br>
      <small style="color: var(--text-muted);">${r.filePath ?? r.file}:${r.startLine ?? r.line}</small>
    </div>
  `).join('');
  container.classList.remove('hidden');

  // Click to focus
  container.querySelectorAll('.search-result-item').forEach(item => {
    item.addEventListener('click', () => {
      const id = (item as HTMLElement).dataset.id!;
      selectNode(id);
      const node = state.cy!.getElementById(id);
      state.cy!.animate({ fit: { eles: node, padding: 100 } } as any);
      container.classList.add('hidden');
    });
  });
}

// ========================
// Layout Cycling
// ========================
function cycleLayout() {
  if (!state.cy) return;

  const layouts = ['cose', 'breadthfirst', 'circle'] as const;
  const currentIdx = layouts.indexOf(state.layoutType);
  state.layoutType = layouts[(currentIdx + 1) % layouts.length];

  const layoutOptions: Record<string, any> = {
    cose: { name: 'cose', animate: true, nodeRepulsion: () => 8000, idealEdgeLength: () => 100 },
    breadthfirst: { name: 'breadthfirst', animate: true, padding: 50 },
    circle: { name: 'circle', animate: true, padding: 50 },
  };

  state.cy.layout(layoutOptions[state.layoutType]).run();
}

// ========================
// Boot
// ========================
document.addEventListener('DOMContentLoaded', init);
