#!/usr/bin/env node
// Scan benchmark: wall time + peak process-tree RSS for `codeatlas scan <path> --full`.
// Usage: node scripts/bench-scan.mjs <projectPath> [iterations]

import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repoRoot, 'packages/cli/dist/index.js');

const project = process.argv[2];
const iterations = Number(process.argv[3] ?? 1);
if (!project) {
  console.error('usage: node scripts/bench-scan.mjs <projectPath> [iterations]');
  process.exit(1);
}

/** Sum VmRSS (kB) of a process and all its descendants via /proc. */
function treeRssKb(rootPid) {
  const childrenOf = new Map();
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const stat = readFileSync(`/proc/${entry}/stat`, 'utf8');
      const ppid = Number(stat.slice(stat.lastIndexOf(')') + 1).trim().split(' ')[1]);
      if (!childrenOf.has(ppid)) childrenOf.set(ppid, []);
      childrenOf.get(ppid).push(Number(entry));
    } catch { /* process vanished */ }
  }
  const stack = [rootPid];
  const seen = new Set();
  let total = 0;
  while (stack.length) {
    const pid = stack.pop();
    if (seen.has(pid)) continue;
    seen.add(pid);
    try {
      const status = readFileSync(`/proc/${pid}/status`, 'utf8');
      const m = status.match(/VmRSS:\s+(\d+) kB/);
      if (m) total += Number(m[1]);
    } catch { /* gone */ }
    for (const child of childrenOf.get(pid) ?? []) stack.push(child);
  }
  return total;
}

function benchOnce() {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(process.execPath, [cli, 'scan', project, '--full'], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let peakKb = 0;
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const sampler = setInterval(() => {
      peakKb = Math.max(peakKb, treeRssKb(child.pid));
    }, 50);
    child.on('error', reject);
    child.on('exit', (code) => {
      clearInterval(sampler);
      const elapsedMs = Date.now() - started;
      if (code !== 0) {
        reject(new Error(`scan exited ${code}\n${out}`));
        return;
      }
      const pick = (label) => {
        const m = out.match(new RegExp(`${label}:\\s+(\\d+)`));
        return m ? Number(m[1]) : '?';
      };
      resolve({
        elapsedMs,
        peakRssMb: Math.round(peakKb / 1024),
        files: pick('Files scanned'),
        symbols: pick('Symbols found'),
        relationships: pick('Relationships'),
      });
    });
  });
}

const results = [];
for (let i = 0; i < iterations; i++) {
  const r = await benchOnce();
  results.push(r);
  console.log(`run ${i + 1}: ${r.elapsedMs}ms, peak RSS ${r.peakRssMb}MB (${r.files} files / ${r.symbols} symbols / ${r.relationships} relationships)`);
}
const times = results.map((r) => r.elapsedMs).sort((a, b) => a - b);
console.log(`\nmedian: ${times[Math.floor(times.length / 2)]}ms, peak RSS (max): ${Math.max(...results.map((r) => r.peakRssMb))}MB`);