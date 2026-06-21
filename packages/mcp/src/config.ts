import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
 *   3. Bundled fallback — a copy of en-US.json committed to the repository at
 *      `packages/mcp/data/en-US.json` (supplied by the community via PRs).
 *   4. None available → no path; the server starts with empty data and a warning.
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

/** Location of the optional bundled fallback copy of en-US.json (`<pkg>/data/`). */
export function bundledDocsPath(): string {
  // This module compiles to either src/ (tsx) or dist/ — both one level under
  // the package root, so the bundled data sits at `../data/en-US.json`.
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(moduleDir, '..', 'data', 'en-US.json');
}

export function resolveDocsPath(
  env: NodeJS.ProcessEnv = process.env,
  bundledPath: string = bundledDocsPath(),
): DocsPathResolution {
  const warnings: string[] = [];

  const direct = env['SATISFACTORY_DOCS_PATH']?.trim();
  if (direct !== undefined && direct !== '') {
    const resolved = expandHome(direct);
    if (fs.existsSync(resolved)) {
      return { path: resolved };
    }
    warnings.push(`SATISFACTORY_DOCS_PATH is set to '${resolved}' but no file exists there.`);
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
    warnings.push(
      `SATISFACTORY_GAME_DIR is set but no ${DOCS_FILENAMES.join('/')} was found under '${docsDir}'.`,
    );
  }

  // Fall back to the bundled copy when no local install/path is configured.
  if (fs.existsSync(bundledPath)) {
    const prefix = warnings.length > 0 ? `${warnings.join(' ')} ` : '';
    return {
      path: bundledPath,
      warning: `${prefix}Using the bundled game-data fallback (${bundledPath}); it may lag the latest game version.`,
    };
  }

  warnings.push(
    'No game data available: set SATISFACTORY_DOCS_PATH or SATISFACTORY_GAME_DIR, or add a bundled data/en-US.json. Starting with empty game data.',
  );
  return { warning: warnings.join(' ') };
}
