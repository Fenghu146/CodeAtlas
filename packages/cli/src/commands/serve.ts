// ============================================================
// serve command - Start web visualization server with API + WebSocket
// ============================================================

import path from 'path';
import fs from 'fs';
import http from 'http';
import url from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { SQLiteStore, ProjectScanner, FileWatcher } from '@codeatlas/core';

export async function serveCommand(options: { port?: string; watch?: boolean }) {
  const port = parseInt(options.port || '8080');
  const projectPath = process.cwd();

  // Check if web build exists (look relative to project root)
  const webDistPath = path.join(projectPath, 'packages', 'web', 'dist');

  // Initialize store
  const dbPath = path.join(projectPath, '.codeatlas', 'db.sqlite');
  let store: SQLiteStore | null = null;

  if (fs.existsSync(dbPath)) {
    try {
      store = new SQLiteStore({ dbPath });
    } catch (err) {
      console.warn('⚠️  Could not open database:', err);
    }
  }

  if (!fs.existsSync(webDistPath)) {
    console.log('\n⚠️  Web visualization not built yet.');
    console.log('\n  To build it, run:');
    console.log('    cd packages/web && pnpm run build\n');
    console.log('  Starting API-only server...\n');
  }

  console.log(`\n🌐 CodeAtlas Server`);
  console.log('═'.repeat(50));
  console.log(`📁 Project: ${projectPath}`);
  console.log(`🔗 URL: http://localhost:${port}`);
  console.log(`💾 Database: ${store ? 'Connected' : 'Not found (run codeatlas scan first)'}`);

  // Setup file watcher if enabled
  let watcher: FileWatcher | null = null;
  let scanner: ProjectScanner | null = null;

  if (options.watch && store) {
    scanner = new ProjectScanner(store);
    watcher = new FileWatcher(projectPath, scanner, {
      debounceDelay: 1000,
      autoScan: true,
    });
    console.log(`👁️  File watcher: enabled`);
  }

  console.log('\nPress Ctrl+C to stop.\n');

  // Create HTTP server
  const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url!, true);
    const pathname = parsedUrl.pathname || '/';

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // API routes
    if (pathname.startsWith('/api/')) {
      await handleApiRoute(pathname, parsedUrl.query, store, res);
      return;
    }

    // Static file serving (if web dist exists)
    if (fs.existsSync(webDistPath)) {
      serveStaticFile(webDistPath, pathname, res);
    } else {
      // Placeholder page
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(getPlaceholderHtml(port, store !== null));
    }
  });

  // Setup WebSocket server
  const wss = new WebSocketServer({ server });
  const clients = new Set<WebSocket>();

  wss.on('connection', (ws: WebSocket) => {
    clients.add(ws);
    console.log(`🔌 WebSocket client connected (${clients.size} total)`);

    ws.on('close', () => {
      clients.delete(ws);
      console.log(`🔌 WebSocket client disconnected (${clients.size} total)`);
    });

    // Send initial state
    if (store) {
      const stats = store.getStats();
      ws.send(JSON.stringify({ type: 'init', stats }));
    }
  });

  // Broadcast to all clients
  function broadcast(message: any) {
    const data = JSON.stringify(message);
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  // Connect watcher to WebSocket
  if (watcher) {
    watcher.on('update', (result: any) => {
      broadcast({
        type: 'graph-update',
        timestamp: Date.now(),
        result,
      });
    });

    watcher.on('error', (error: any) => {
      broadcast({
        type: 'error',
        message: error.message,
      });
    });

    await watcher.start();
  }

  // Start server
  server.listen(port, () => {
    console.log(`✅ Server running at http://localhost:${port}/`);
    console.log(`   API: http://localhost:${port}/api/graph`);
    console.log(`   WebSocket: ws://localhost:${port}`);
  });

  // Cleanup on exit
  process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down...');
    if (watcher) {
      await watcher.stop();
    }
    server.close();
    process.exit(0);
  });
}

// ============================================================
// API Route Handler
// ============================================================

async function handleApiRoute(
  pathname: string,
  query: any,
  store: SQLiteStore | null,
  res: http.ServerResponse,
): Promise<void> {
  if (!store) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Database not available. Run codeatlas scan first.' }));
    return;
  }

  try {
    if (pathname === '/api/graph') {
      const limit = parseInt(query.limit as string) || 200;
      const layers = query.layers ? (query.layers as string).split(',') : undefined;

      let symbols;
      if (layers && layers.length > 0) {
        symbols = [];
        for (const layer of layers) {
          symbols.push(...store.getSymbolsByLayer(layer as any));
        }
      } else {
        symbols = store.searchSymbols('', { limit: 10000 });
      }

      if (symbols.length > limit) {
        symbols = symbols.slice(0, limit);
      }

      const symbolIds = new Set(symbols.map(s => s.id));
      const edges: any[] = [];

      // Pre-compute caller counts for node sizing
      const callerCounts = store.getCallerCounts(symbols.map(s => s.id));

      for (const symbol of symbols) {
        const outgoing = store.getRelationshipsFrom(symbol.id);
        for (const rel of outgoing) {
          if (symbolIds.has(rel.targetId)) {
            edges.push({ sourceId: rel.sourceId, targetId: rel.targetId, kind: rel.kind });
          }
        }
      }

      // Add referenceCount to nodes for sizing
      const nodesWithWeight = symbols.map(s => ({
        ...s,
        referenceCount: callerCounts.get(s.id) ?? 0,
      }));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ nodes: nodesWithWeight, edges }));
    } else if (pathname === '/api/stats') {
      const stats = store.getStats();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(stats));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  } catch (error: any) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

// ============================================================
// Static File Serving
// ============================================================

function serveStaticFile(basePath: string, pathname: string, res: http.ServerResponse): void {
  // Default to index.html
  if (pathname === '/') {
    pathname = '/index.html';
  }

  const filePath = path.join(basePath, pathname);

  // Security: prevent directory traversal
  if (!filePath.startsWith(basePath)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const extname = path.extname(filePath).toLowerCase();
  const contentTypes: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpg',
    '.svg': 'image/svg+xml',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  };

  const contentType = contentTypes[extname] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        // Try index.html for SPA routing
        fs.readFile(path.join(basePath, 'index.html'), (err2, indexContent) => {
          if (err2) {
            res.writeHead(404);
            res.end('Not Found');
          } else {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(indexContent, 'utf-8');
          }
        });
      } else {
        res.writeHead(500);
        res.end('Server Error');
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
}

// ============================================================
// Placeholder HTML
// ============================================================

function getPlaceholderHtml(port: number, hasDb: boolean): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CodeAtlas</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }
    h1 { color: #333; }
    .card { border: 1px solid #ddd; border-radius: 8px; padding: 20px; margin: 20px 0; }
    .status { color: #666; }
    code { background: #f4f4f4; padding: 2px 6px; border-radius: 4px; }
    .success { color: #22c55e; }
    .warning { color: #f59e0b; }
  </style>
</head>
<body>
  <h1>🗺️ CodeAtlas</h1>
  <p class="status">API Server running on port ${port}</p>

  <div class="card">
    <h3>Database Status</h3>
    <p class="${hasDb ? 'success' : 'warning'}">
      ${hasDb ? '✅ Connected' : '⚠️ Not found - Run codeatlas scan first'}
    </p>
  </div>

  <div class="card">
    <h3>API Endpoints</h3>
    <ul>
      <li><code>GET /api/graph</code> - Get graph data</li>
      <li><code>GET /api/stats</code> - Get statistics</li>
    </ul>
  </div>

  <div class="card">
    <h3>WebSocket</h3>
    <p>Connect to <code>ws://localhost:${port}</code> for real-time updates</p>
  </div>

  <div class="card">
    <h3>Web Visualization</h3>
    <p>To enable the full visualization:</p>
    <ol>
      <li>Build the web package: <code>cd packages/web && npm run build</code></li>
      <li>Restart this server: <code>codeatlas serve</code></li>
    </ol>
  </div>
</body>
</html>`;
}
