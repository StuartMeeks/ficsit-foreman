#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { resolveSavePath, resolveServerConfig, type ServerConfig } from './config.js';
import { startHttpServer } from './http.js';
import { logger } from './logger.js';
import { SaveStoreRegistry } from './store/registry.js';
import { SaveStore } from './store/saveStore.js';
import { registerTools } from './tools/index.js';

const SERVER_NAME = 'foreman-mcp-save-game';
const SERVER_VERSION = '0.1.0';

/** Loads `.env` from the package dir and the workspace root (cwd-independent). */
function loadEnv(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // dist/ or src/ → package root is one up; workspace root is three up.
  dotenv.config({ path: path.resolve(here, '..', '.env') });
  dotenv.config({ path: path.resolve(here, '..', '..', '..', '.env') });
  dotenv.config(); // also honour a .env in the current working directory
}

function buildRegistry(config: ServerConfig): SaveStoreRegistry {
  const { path: savePath, warning } = resolveSavePath();
  if (warning !== undefined) {
    logger.warn(warning);
  }
  const defaultStore = new SaveStore(savePath);
  logger.info(`Default save source: ${savePath ?? '(none — running with an empty state)'}`);
  if (config.saveDataDir !== undefined) {
    logger.info(`Per-playthrough saves served from: ${config.saveDataDir}`);
  }
  return new SaveStoreRegistry(defaultStore, config.saveDataDir);
}

async function main(): Promise<void> {
  loadEnv();
  const config = resolveServerConfig();
  const registry = buildRegistry(config);

  if (config.transport === 'http') {
    await startHttpServer(registry, config.host, config.port, SERVER_NAME, SERVER_VERSION);
    return;
  }

  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerTools(server, registry);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('Transport: stdio (no network port — the client talks over stdin/stdout).');
}

main().catch((error: unknown) => {
  logger.error('Fatal error during startup:', error);
  process.exit(1);
});
