#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

import { buildApp } from './app.js';
import { createAuth } from './auth.js';
import { resolveServerConfig } from './config.js';
import { disconnectDb, prisma } from './db.js';
import type { AppDeps } from './deps.js';
import { logger } from './logger.js';
import { loadSystemPromptTemplate } from './anthropic/systemPrompt.js';
import { createProvider } from './llm/factory.js';
import { SummaryService } from './llm/summary.js';
import { McpAggregateGateway } from './mcp/aggregateGateway.js';
import { McpHttpClient } from './mcp/client.js';
import type { McpGateway } from './mcp/client.js';
import { SessionService } from './services/sessionService.js';
import { WorkOrderService } from './services/workOrderService.js';

/** Loads `.env` from the package dir, the workspace root, and the cwd. */
function loadEnv(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  dotenv.config({ path: path.resolve(here, '..', '.env') });
  dotenv.config({ path: path.resolve(here, '..', '..', '..', '.env') });
  dotenv.config();
}

async function main(): Promise<void> {
  loadEnv();
  const config = resolveServerConfig();

  const systemPromptTemplate = loadSystemPromptTemplate(config.systemPromptPath);
  logger.info(`Loaded system prompt from ${config.systemPromptPath}`);

  // Game-data is the primary MCP server; the optional save-game server is merged
  // in when SAVE_MCP_URL is set so the foreman can read player location and
  // remaining collectibles for location-aware opportunities.
  const gameDataMcp = new McpHttpClient(config.mcpUrl);
  const saveMcp =
    config.saveMcpUrl !== undefined ? new McpHttpClient(config.saveMcpUrl) : undefined;
  const mcpClients = saveMcp !== undefined ? [gameDataMcp, saveMcp] : [gameDataMcp];
  const mcp: McpGateway =
    saveMcp !== undefined ? new McpAggregateGateway(gameDataMcp, [saveMcp]) : gameDataMcp;

  // Attempt eager connections so the game version is known and tool listing is
  // warm. A server may not be up yet — that is not fatal; tools reconnect on
  // demand the first time the foreman calls one.
  await Promise.all(
    mcpClients.map((client, index) =>
      client.connect().catch((error: unknown) => {
        const url = index === 0 ? config.mcpUrl : config.saveMcpUrl;
        logger.warn(`Could not reach MCP server at ${url} yet — will retry on first use.`, error);
      }),
    ),
  );

  const sessions = new SessionService(prisma);
  const deps: AppDeps = {
    config,
    auth: createAuth(prisma),
    sessions,
    workOrders: new WorkOrderService(prisma),
    mcp,
    summary: new SummaryService(sessions, { historyWindow: config.historyWindow }, createProvider),
    llmProviderFactory: createProvider,
    systemPromptTemplate,
  };

  const app = buildApp(deps);
  const server = app.listen(config.port, config.host, () => {
    logger.info(`Listening on http://${config.host}:${config.port} (health: /health)`);
    const mcpSummary =
      config.saveMcpUrl !== undefined ? `${config.mcpUrl} + ${config.saveMcpUrl}` : config.mcpUrl;
    logger.info(
      `LLM: ${config.providerKind} (${config.model})${config.baseUrl !== undefined ? ` @ ${config.baseUrl}` : ''} | ` +
        `MCP: ${mcpSummary} | history window: ${config.historyWindow}`,
    );
    if (config.hostedApiKey === undefined) {
      logger.warn(
        `No hosted LLM key set — clients must supply their own via the '${config.clientKeyHeader}' header.`,
      );
    }
  });

  const shutdown = (signal: string): void => {
    logger.info(`Received ${signal}; shutting down.`);
    server.close(() => {
      void Promise.allSettled([...mcpClients.map((client) => client.close()), disconnectDb()]).then(
        () => process.exit(0),
      );
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  logger.error('Fatal error during startup:', error);
  process.exit(1);
});
