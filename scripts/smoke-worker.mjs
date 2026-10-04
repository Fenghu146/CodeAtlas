#!/usr/bin/env node
// Smoke: run the bundled parse-child.js as a standalone worker and ask it to
// parse a real snippet. Verifies wasm grammar resolution survives bundling.
import { spawn } from 'node:child_process';

const script = process.argv[2];
if (!script) { console.error('usage: smoke-worker.mjs <parse-child.js>'); process.exit(2); }

const child = spawn(process.execPath, [script], { stdio: ['pipe', 'pipe', 'inherit'] });
const buffer = [];
let state = '';
child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  state += chunk;
  let idx;
  while ((idx = state.indexOf('\n')) >= 0) {
    buffer.push(state.slice(0, idx));
    state = state.slice(idx + 1);
  }
});

child.stdin.write(JSON.stringify({
  id: 1,
  content: "class Foo { bar() { return this.baz(); } }\nexport const answer = 42;",
  filePath: 'smoke.ts',
}) + '\n');
child.stdin.end();

child.on('exit', (code) => {
  for (const line of buffer) {
    if (!line.trim()) continue;
    try {
      const res = JSON.parse(line);
      if (res.id === 1) {
        // Protocol: { ok, result: { symbols, relationships }, ... }; tolerate
        // a flat shape too in case the response is unwrapped later.
        const payload = res.result ?? res;
        const kinds = {};
        for (const s of payload.symbols ?? []) kinds[s.kind] = (kinds[s.kind] ?? 0) + 1;
        console.log('parse ok:', res.ok, '| symbols:', JSON.stringify(kinds),
          '| calls:', (payload.relationships ?? []).length);
        process.exit(res.ok ? 0 : 1);
      }
    } catch { /* ready/trace lines */ }
  }
  console.error('no response received, exit', code);
  process.exit(1);
});
setTimeout(() => { console.error('timeout'); child.kill(); process.exit(1); }, 30000).unref();