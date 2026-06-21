#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

import { buildApp } from './app.js';
import { resolveServerConfig } from './config.js';
import { disconnectDb, prisma } from './db.js';
import type { AppDeps } from './deps.js';
import { logger } from './logger.js';
import { loadSystemPromptTemplate } from './anthropic/systemPrompt.js';
import { SummaryService } from './anthropic/summary.js';
import { McpHttpClient } from './mcp/client.js';
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

  const mcp = new McpHttpClient(config.mcpUrl);
  // Attempt an eager connection so the game version is known and tool listing is
  // warm. The MCP server may not be up yet — that is not fatal; tools reconnect
  // on demand the first time the foreman calls one.
  try {
    await mcp.connect();
  } catch (error) {
    logger.warn(
      `Could not reach MCP server at ${config.mcpUrl} yet — will retry on first use.`,
      error,
    );
  }

  const sessions = new SessionService(prisma);
  const deps: AppDeps = {
    config,
    sessions,
    workOrders: new WorkOrderService(prisma),
    mcp,
    summary: new SummaryService(sessions, {
      summaryModel: config.summaryModel,
      summaryMaxTokens: config.summaryMaxTokens,
      historyWindow: config.historyWindow,
    }),
    systemPromptTemplate,
  };

  const app = buildApp(deps);
  const server = app.listen(config.port, config.host, () => {
    logger.info(`Listening on http://${config.host}:${config.port} (health: /health)`);
    logger.info(
      `Model: ${config.model} | MCP: ${config.mcpUrl} | history window: ${config.historyWindow}`,
    );
    if (config.hostedApiKey === undefined) {
      logger.warn(
        `No hosted ANTHROPIC_API_KEY set — clients must supply their own via the '${config.clientKeyHeader}' header.`,
      );
    }
  });

  const shutdown = (signal: string): void => {
    logger.info(`Received ${signal}; shutting down.`);
    server.close(() => {
      void Promise.allSettled([mcp.close(), disconnectDb()]).then(() => process.exit(0));
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  logger.error('Fatal error during startup:', error);
  process.exit(1);
});
