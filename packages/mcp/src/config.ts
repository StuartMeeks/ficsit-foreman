import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
const DEFAULT_HTTP_PORT = 8080;

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

/**
 * Resolves the path to the docs file from the environment, in priority order:
 *   1. SATISFACTORY_DOCS_PATH — full path to en-US.json
 *   2. SATISFACTORY_GAME_DIR  — install root; append CommunityResources/Docs/
 *      (en-US.json for 1.x, falling back to the pre-1.0 Docs.json)
 *   3. Neither set → no path; the server starts with empty data and a warning.
 */
export interface DocsPathResolution {
  path?: string;
  warning?: string;
}

const DOCS_SUBPATH = ['CommunityResources', 'Docs'];
const DOCS_FILENAMES = ['en-US.json', 'Docs.json'];

/** Expands a leading `~` to the user's home directory. */
function expandHome(input: string): string {
  if (input === '~') {
    return os.homedir();
  }
  if (input.startsWith('~/')) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

export function resolveDocsPath(env: NodeJS.ProcessEnv = process.env): DocsPathResolution {
  const direct = env['SATISFACTORY_DOCS_PATH']?.trim();
  if (direct !== undefined && direct !== '') {
    const resolved = expandHome(direct);
    if (fs.existsSync(resolved)) {
      return { path: resolved };
    }
    return { warning: `SATISFACTORY_DOCS_PATH is set to '${resolved}' but no file exists there.` };
  }

  const gameDir = env['SATISFACTORY_GAME_DIR']?.trim();
  if (gameDir !== undefined && gameDir !== '') {
    const docsDir = path.join(expandHome(gameDir), ...DOCS_SUBPATH);
    for (const filename of DOCS_FILENAMES) {
      const candidate = path.join(docsDir, filename);
      if (fs.existsSync(candidate)) {
        return { path: candidate };
      }
    }
    return {
      warning: `SATISFACTORY_GAME_DIR is set but no ${DOCS_FILENAMES.join('/')} was found under '${docsDir}'.`,
    };
  }

  return {
    warning:
      'Neither SATISFACTORY_DOCS_PATH nor SATISFACTORY_GAME_DIR is set; starting with empty game data.',
  };
}
