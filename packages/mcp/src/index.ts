#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { emptyGameData, parseDocsFile } from './parser/index.js';
import type { GameData } from './parser/types.js';
import { initGraph } from './graph/index.js';
import { registerTools } from './tools/index.js';
import { resolveDocsPath } from './config.js';
import { logger } from './logger.js';

const SERVER_NAME = 'foreman-mcp';
const SERVER_VERSION = '0.1.0';

/** Loads `.env` from the package dir and the workspace root (cwd-independent). */
function loadEnv(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // dist/ or src/ → package root is one up; workspace root is three up.
  dotenv.config({ path: path.resolve(here, '..', '.env') });
  dotenv.config({ path: path.resolve(here, '..', '..', '..', '.env') });
  dotenv.config(); // also honour a .env in the current working directory
}

function loadGameData(): GameData {
  const { path: docsPath, warning } = resolveDocsPath();
  if (warning !== undefined) {
    logger.warn(warning);
  }
  if (docsPath === undefined) {
    return emptyGameData('unknown');
  }
  try {
    const { gameData, parseWarnings } = parseDocsFile(docsPath);
    for (const message of parseWarnings) {
      logger.warn(message);
    }
    return gameData;
  } catch (error) {
    logger.error(`Failed to read or parse docs file at '${docsPath}':`, error);
    return emptyGameData('unknown');
  }
}

async function main(): Promise<void> {
  loadEnv();
  const gameData = loadGameData();
  const graph = await initGraph(gameData);

  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerTools(server, graph);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info(`Ready. Serving Satisfactory game data (version: ${gameData.version}).`);
}

main().catch((error: unknown) => {
  logger.error('Fatal error during startup:', error);
  process.exit(1);
});
