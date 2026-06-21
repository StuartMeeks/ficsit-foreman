import express, { type Express } from 'express';

import type { AppDeps } from './deps.js';
import { logger } from './logger.js';
import { chatRouter } from './routes/chat.js';
import { sessionsRouter } from './routes/sessions.js';
import { workOrdersRouter } from './routes/workOrders.js';

/**
 * Builds the Express application from its dependencies. Routes are pure
 * functions of {@link AppDeps}, so the app can be constructed with real or fake
 * services in tests without a network listener.
 */
export function buildApp(deps: AppDeps): Express {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'foreman-server',
      model: deps.config.model,
      mcpUrl: deps.config.mcpUrl,
      gameVersion: deps.mcp.gameVersion,
    });
  });

  // More specific paths first; the SSE chat route and work-order sub-resources
  // sit beneath the same /api/sessions prefix.
  app.use('/api/sessions/:sessionId/chat', chatRouter(deps));
  app.use('/api/sessions/:sessionId/work-orders', workOrdersRouter(deps));
  app.use('/api/sessions', sessionsRouter(deps));

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found.' });
  });

  // Centralised error handler — nothing is swallowed silently.
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ): void => {
      logger.error('Unhandled request error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error.' });
      }
    },
  );

  return app;
}
