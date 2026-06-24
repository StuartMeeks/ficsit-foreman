import { toNodeHandler } from 'better-auth/node';
import express, { type Express } from 'express';

import type { AppDeps } from './deps.js';
import { logger } from './logger.js';
import { requireAuth, requireSessionOwnership } from './middleware/auth.js';
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

  // Better Auth owns /api/auth/*. Its handler reads the raw request body itself,
  // so it MUST be mounted before express.json(). (Express 5 splat syntax.)
  app.all('/api/auth/*splat', toNodeHandler(deps.auth));

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

  // Everything under /api/sessions requires authentication. Session-scoped
  // sub-resources (chat, work orders) additionally require that the caller owns
  // the session. More specific paths are mounted first; they share the prefix.
  const needsAuth = requireAuth(deps.auth);
  const ownsSession = requireSessionOwnership(deps.sessions);
  app.use('/api/sessions/:sessionId/chat', needsAuth, ownsSession, chatRouter(deps));
  app.use('/api/sessions/:sessionId/work-orders', needsAuth, ownsSession, workOrdersRouter(deps));
  app.use('/api/sessions', needsAuth, sessionsRouter(deps));

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
