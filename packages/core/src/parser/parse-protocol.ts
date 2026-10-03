// ============================================================
// Parse Protocol - message contract for parse child processes
// ============================================================
// Shared by the child entry (parse-child.ts) and the pool (parser-pool.ts).
// Keep this module type-only so it never pulls runtime code into children.
// Messages are discriminated unions: `kind` separates lifecycle from job
// outcomes, and `ok` separates success from failure so callers never have to
// defend against half-filled messages.
// ============================================================

import type { ParseResult } from './index.js';

/** One parse job sent to a child. */
export interface ParseRequest {
  /** Correlation id assigned by the pool. */
  id: number;
  /** Path used for language detection and symbol locations. */
  filePath: string;
  /** Full file content (UTF-8). */
  content: string;
}

/** Child -> pool message. */
export type ParseMessage =
  /** Sent once when the child is initialized and ready for jobs. */
  | { kind: 'ready'; rssMb?: number }
  /** A finished job — success carries the parse tree summary. */
  | {
      kind: 'result';
      id: number;
      ok: true;
      result: ParseResult;
      /** Child RSS in MB after the job — used for recycle decisions. */
      rssMb?: number;
      /** Wall time the child spent parsing, excluding dispatch and IPC. */
      parseMs?: number;
    }
  /** A finished job that could not be parsed. */
  | {
      kind: 'result';
      id: number;
      ok: false;
      error: { message: string; stack?: string };
      rssMb?: number;
    };
