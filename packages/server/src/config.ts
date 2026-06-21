import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Backend runtime configuration, resolved from the environment. Every value has
 * a sensible default so the server starts for local development with no `.env`.
 */
export interface ServerConfig {
  /** HTTP bind host. */
  host: string;
  /** HTTP port. */
  port: number;
  /** Anthropic model the foreman runs on. */
  model: string;
  /** Upper bound on tokens per Anthropic response. */
  maxTokens: number;
  /**
   * Server-held Anthropic API key (hosted tier). May be undefined — free-tier
   * clients supply their own key per request via {@link clientKeyHeader}.
   */
  hostedApiKey: string | undefined;
  /** Request header a free-tier client uses to pass its own Anthropic key. */
  clientKeyHeader: string;
  /** URL of the Phase 1 MCP server's Streamable HTTP endpoint. */
  mcpUrl: string;
  /** Number of most-recent stored messages sent with each chat request. */
  historyWindow: number;
  /** Resolved absolute path to the foreman system prompt markdown file. */
  systemPromptPath: string;
}

const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_PORT = 8724;
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_CLIENT_KEY_HEADER = 'x-anthropic-api-key';
const DEFAULT_MCP_URL = 'http://127.0.0.1:8723/mcp';
const DEFAULT_HISTORY_WINDOW = 20;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw?.trim() ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Locates the foreman system prompt. Priority: SYSTEM_PROMPT_PATH env override,
 * then a copy bundled beside the package (Docker image), then the repo-root
 * source of truth (local dev). Returns the first that exists, else the package
 * path so the caller's read error is explicit.
 */
export function resolveSystemPromptPath(env: NodeJS.ProcessEnv = process.env): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // dist/ or src/ → package root is one up; workspace root is three up.
  const packageRoot = path.resolve(here, '..');
  const candidates = [
    env['SYSTEM_PROMPT_PATH']?.trim(),
    path.join(packageRoot, 'SYSTEM_PROMPT.md'),
    path.resolve(packageRoot, '..', '..', 'SYSTEM_PROMPT.md'),
  ].filter((candidate): candidate is string => candidate !== undefined && candidate.length > 0);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[candidates.length - 1] ?? path.join(packageRoot, 'SYSTEM_PROMPT.md');
}

/** Resolves all backend configuration from the environment. */
export function resolveServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const hostedApiKey = env['ANTHROPIC_API_KEY']?.trim();
  return {
    host: env['HOST']?.trim() || DEFAULT_HOST,
    port: parsePositiveInt(env['PORT'], DEFAULT_PORT),
    model: env['ANTHROPIC_MODEL']?.trim() || DEFAULT_MODEL,
    maxTokens: parsePositiveInt(env['ANTHROPIC_MAX_TOKENS'], DEFAULT_MAX_TOKENS),
    hostedApiKey: hostedApiKey && hostedApiKey.length > 0 ? hostedApiKey : undefined,
    clientKeyHeader: (env['CLIENT_KEY_HEADER']?.trim() || DEFAULT_CLIENT_KEY_HEADER).toLowerCase(),
    mcpUrl: env['MCP_URL']?.trim() || DEFAULT_MCP_URL,
    historyWindow: parsePositiveInt(env['HISTORY_WINDOW'], DEFAULT_HISTORY_WINDOW),
    systemPromptPath: resolveSystemPromptPath(env),
  };
}
