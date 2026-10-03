// ============================================================
// Shared CLI helpers for locating the CodeAtlas index
// ============================================================
//
// Every command that reads the index resolves it as
// `<project>/.codeatlas/db.sqlite`, where `<project>` comes from the
// `--project` option and falls back to the current working directory.

import path from 'path';
import fs from 'fs';
import { SQLiteStore } from '@codeatlas/core';

export interface ProjectOption {
  project?: string;
}

/** Resolve the project root from a command's options. */
export function resolveProjectPath(options?: ProjectOption): string {
  return path.resolve(options?.project ?? process.cwd());
}

/** Absolute path of the index database for a project. */
export function indexPathFor(options?: ProjectOption): string {
  return path.join(resolveProjectPath(options), '.codeatlas', 'db.sqlite');
}

/**
 * Open the index store for a project (caller closes it).
 * Read commands go through here so a missing index produces one clear error
 * instead of silently querying an empty database.
 */
export function openStore(options?: ProjectOption): SQLiteStore {
  const dbPath = indexPathFor(options);
  if (!fs.existsSync(dbPath)) {
    console.error(`\n❌ No CodeAtlas index at ${dbPath}\n`);
    console.error('   Run `codeatlas scan` in the project first.\n');
    process.exit(1);
  }
  return new SQLiteStore({ dbPath });
}
