// ============================================================
// Logger - Minimal, protocol-safe logging for the core engine
// ============================================================
// All output is written to stderr. The core engine is consumed by
// adapters that may use stdout for machine-readable protocols — most
// notably the MCP stdio transport, where any write to stdout corrupts
// the JSON-RPC stream. Routing logs to stderr keeps those channels clean.

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Whether debug-level output is enabled (set CODEATLAS_DEBUG=1 to opt in). */
const DEBUG_ENABLED = process.env.CODEATLAS_DEBUG === '1' || process.env.CODEATLAS_DEBUG === 'true';

function write(level: LogLevel, message: string): void {
  if (level === 'debug' && !DEBUG_ENABLED) return;
  process.stderr.write(`[codeatlas] ${message}\n`);
}

/**
 * Protocol-safe logger. Every method writes to stderr so that consumers
 * which rely on stdout (CLI pipelines, MCP servers, CI logs) stay clean.
 */
export const logger = {
  debug(message: string): void {
    write('debug', message);
  },
  info(message: string): void {
    write('info', message);
  },
  warn(message: string): void {
    write('warn', message);
  },
  error(message: string): void {
    write('error', message);
  },
};

export type { LogLevel };
