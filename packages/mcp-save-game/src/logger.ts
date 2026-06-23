/**
 * stderr-only logger.
 *
 * CRITICAL: the MCP stdio transport owns **stdout** for protocol framing. Any
 * write to stdout (a stray `console.log`) corrupts the JSON-RPC stream and
 * breaks the connection. All diagnostics therefore go to stderr. The adopted
 * save parser also logs its own ("trailing data") warnings to stderr, which is
 * safe for the same reason.
 */
const PREFIX = '[foreman-mcp-save-game]';

export const logger = {
  info(...args: unknown[]): void {
    console.error(PREFIX, ...args);
  },
  warn(...args: unknown[]): void {
    console.error(`${PREFIX} [warn]`, ...args);
  },
  error(...args: unknown[]): void {
    console.error(`${PREFIX} [error]`, ...args);
  },
};
