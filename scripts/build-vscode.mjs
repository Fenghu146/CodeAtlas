#!/usr/bin/env node
/**
 * Build the VS Code extension for packaging.
 *
 * VS Code extensions load their entry as CommonJS from the extension host, and
 * a bundled single-file entry is the only reliable form for a workspace that
 * ships native WASM grammars and a spawnable worker script:
 *
 *   dist/extension.js      — CJS bundle (external: vscode)
 *   dist/parse-child.js    — CJS bundle, spawned as a parser worker process
 *   dist/language-packs/   — tree-sitter .wasm grammars (19 MB, binary assets)
 *
 * Path resolution inside the bundle uses core's `assetDir()`, which prefers
 * `import.meta.url` (ESM source) and falls back to `__dirname` (this CJS
 * bundle). So core finds grammars in `language-packs/` next to the bundle and
 * spawns `./parse-child.js` next to it even though esbuild substitutes
 * `import.meta.url` away in CJS output.
 */
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const vscodePkg = join(root, 'packages', 'vscode');
const coreDist = join(root, 'packages', 'core', 'dist');
const coreSrc = join(root, 'packages', 'core', 'src');
const out = join(vscodePkg, 'dist');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// 1. Extension entry: CJS bundle, VS Code's runtime provides `vscode`.
await build({
  entryPoints: [join(vscodePkg, 'src', 'extension.ts')],
  outfile: join(out, 'extension.js'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  sourcemap: false,
  logLevel: 'warning',
});

// 2. Parser worker: spawned as a plain node process, bundled to be standalone.
await build({
  entryPoints: [join(coreDist, 'parser', 'parse-child.js')],
  outfile: join(out, 'parse-child.js'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['node:*'],
  sourcemap: false,
  logLevel: 'warning',
});

// 3. WASM assets: binary assets loaded at runtime relative to the module.
//    a) web-tree-sitter's runtime (tree-sitter.wasm) is copied next to the
//       bundle so its Emscripten loader can find it (verified by smoke test).
//    b) The language grammars are core's own `language-packs/`.
cpSync(join(coreSrc, 'parser', 'language-packs'), join(out, 'language-packs'), {
  recursive: true,
});
const treeSitterWasm = join(root, 'packages', 'core', 'node_modules', 'web-tree-sitter', 'tree-sitter.wasm');
cpSync(treeSitterWasm, join(out, 'tree-sitter.wasm'));
console.log('tree-sitter.wasm: copied from web-tree-sitter');
console.log(`language-packs: copied from core (tree-sitter grammars)`);