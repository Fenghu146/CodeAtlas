import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Directory holding runtime assets — the tree-sitter WASM grammars in
 * `language-packs/` and the spawnable parser worker `parse-child.js`.
 *
 * Resolution must survive three module shapes:
 *
 *  - ESM source (tsc output, vitest): `import.meta.url` is the module URL.
 *  - CJS bundle (esbuild for the VS Code extension and the parser worker):
 *    esbuild substitutes `import.meta.url` with `undefined`, but `__dirname`
 *    points at the bundle's own directory.
 *  - An explicit `CODEATLAS_ASSET_DIR` override for custom layouts.
 */
export function assetDir(): string {
  const override = process.env.CODEATLAS_ASSET_DIR;
  if (override) return override;

  let metaUrl: unknown;
  try {
    metaUrl = import.meta.url;
  } catch {
    metaUrl = undefined;
  }
  if (typeof metaUrl === 'string') {
    try {
      return path.dirname(fileURLToPath(metaUrl));
    } catch {
      // Not a usable file URL — fall through to CJS / cwd.
    }
  }

  // CJS bundle: `__dirname` is the bundle directory. In ESM it is undefined,
  // and `typeof` keeps the bare identifier from throwing.
  const cjsDir = typeof __dirname === 'string' ? __dirname : undefined;
  if (cjsDir) return cjsDir;

  return process.cwd();
}