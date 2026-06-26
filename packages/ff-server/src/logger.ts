/**
 * Minimal structured logger. Unlike the MCP stdio server, the backend does not
 * reserve stdout for a protocol, so ordinary stdout/stderr is fine. Errors are
 * always logged with context — never silently swallowed.
 */
const PREFIX = '[foreman-ff-server]';

export const logger = {
  info(...args: unknown[]): void {
    console.log(PREFIX, ...args);
  },
  warn(...args: unknown[]): void {
    console.warn(`${PREFIX} [warn]`, ...args);
  },
  error(...args: unknown[]): void {
    console.error(`${PREFIX} [error]`, ...args);
  },
};
