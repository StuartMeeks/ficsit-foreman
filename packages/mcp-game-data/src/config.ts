import os from 'node:os';

/**
 * Server transport configuration. Docs-path / bundled-data resolution lives in
 * `@foreman/sf-game-data` (see `resolveDocsPath`); this file is only the
 * network-transport half that the server process owns.
 */

/** Which transport the server should expose. */
export type TransportKind = 'stdio' | 'http';

export interface ServerConfig {
  transport: TransportKind;
  /** HTTP bind host (only meaningful when transport is 'http'). */
  host: string;
  /** HTTP port (only meaningful when transport is 'http'). */
  port: number;
}

const DEFAULT_HTTP_HOST = '0.0.0.0';
const DEFAULT_HTTP_PORT = 8723;

/**
 * Resolves transport configuration from the environment. Defaults to stdio
 * (what Claude Desktop spawns). Set `MCP_TRANSPORT=http` to listen on a network
 * port instead; tune it with `MCP_HTTP_HOST` and `MCP_HTTP_PORT`.
 */
export function resolveServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const transport: TransportKind =
    env['MCP_TRANSPORT']?.trim().toLowerCase() === 'http' ? 'http' : 'stdio';
  const host = env['MCP_HTTP_HOST']?.trim() || DEFAULT_HTTP_HOST;
  const parsedPort = Number.parseInt(env['MCP_HTTP_PORT']?.trim() ?? '', 10);
  const port = Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : DEFAULT_HTTP_PORT;
  return { transport, host, port };
}

/** Non-internal IPv4 addresses of this machine, for echoing a reachable URL. */
export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) {
        out.push(net.address);
      }
    }
  }
  return out;
}
