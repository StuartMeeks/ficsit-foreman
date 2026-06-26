#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import {
  emptyGameData,
  loadWorldLocations,
  parseDocsFile,
  resolveDocsPath,
  WorldQueries,
} from '@foreman/sf-game-data';
import type { GameData } from '@foreman/sf-game-data';
import { initGraph } from '@foreman/sf-game-data-graph';
import { registerTools } from './tools/index.js';
import { resolveServerConfig } from './config.js';
import { startHttpServer } from './http.js';
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

function loadGameData(): { gameData: GameData; docsPath: string | undefined } {
  const { path: docsPath, warning } = resolveDocsPath();
  if (warning !== undefined) {
    logger.warn(warning);
  }
  if (docsPath === undefined) {
    return { gameData: emptyGameData('unknown'), docsPath: undefined };
  }
  try {
    const { gameData, parseWarnings } = parseDocsFile(docsPath);
    for (const message of parseWarnings) {
      logger.warn(message);
    }
    return { gameData, docsPath };
  } catch (error) {
    logger.error(`Failed to read or parse docs file at '${docsPath}':`, error);
    return { gameData: emptyGameData('unknown'), docsPath: undefined };
  }
}

/** Echoes what was loaded and from where, so startup is self-explanatory. */
function logStartupSummary(gameData: GameData, docsPath: string | undefined): void {
  logger.info(`Game data source: ${docsPath ?? '(none — running with an empty dataset)'}`);
  logger.info(
    `Game version: ${gameData.version} | ` +
      `items=${count(gameData.items)} resources=${count(gameData.resources)} ` +
      `recipes=${count(gameData.recipes)} buildings=${count(gameData.buildings)} ` +
      `schematics=${count(gameData.schematics)}`,
  );
}

function count(record: Record<string, unknown>): number {
  return Object.keys(record).length;
}

async function main(): Promise<void> {
  loadEnv();
  const { gameData, docsPath } = loadGameData();
  const graph = await initGraph(gameData);
  logStartupSummary(gameData, docsPath);

  const { world, warning: worldWarning } = loadWorldLocations();
  if (worldWarning !== undefined) {
    logger.warn(worldWarning);
  }
  logger.info(
    `World locations: collectibles=${world.collectibles.length} resourceNodes=${world.resourceNodes.length}`,
  );
  const worldQueries = new WorldQueries(world, gameData);

  const config = resolveServerConfig();
  if (config.transport === 'http') {
    await startHttpServer(
      graph,
      worldQueries,
      config.host,
      config.port,
      SERVER_NAME,
      SERVER_VERSION,
    );
    return;
  }

  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerTools(server, graph, worldQueries);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('Transport: stdio (no network port — the client talks over stdin/stdout).');
}

main().catch((error: unknown) => {
  logger.error('Fatal error during startup:', error);
  process.exit(1);
});
