import { Router, type Request } from 'express';

import type { AppDeps } from '../deps.js';
import { requireSessionOwnership } from '../middleware/auth.js';
import { createSessionSchema, updateSessionSchema } from '../validation.js';

/**
 * Routes for session lifecycle: create, fetch, update, and claim. Every route
 * runs behind {@link requireAuth} (mounted in app.ts), so `req.user` is always
 * present. Reads and updates additionally require that the caller owns the
 * session; creation binds the new session to the caller.
 */
export function sessionsRouter(deps: AppDeps): Router {
  const router = Router();
  const ownsSession = requireSessionOwnership(deps.sessions);

  const sessionId = (req: Request): string => {
    const { sessionId: id = '' } = req.params as { sessionId?: string };
    return id;
  };

  // Create a session owned by the caller, optionally seeding personality and
  // pioneer profile. A client that already holds a local anonymous session id
  // should claim it instead (see POST /:sessionId/claim).
  router.post('/', async (req, res) => {
    const parsed = createSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    if (parsed.data.id !== undefined) {
      const existing = await deps.sessions.get(parsed.data.id);
      if (existing !== undefined) {
        res.status(409).json({ error: `Session '${parsed.data.id}' already exists.` });
        return;
      }
    }
    const session = await deps.sessions.create({ ...parsed.data, userId: req.user!.id });
    res.status(201).json(session);
  });

  // List the caller's own sessions, most recently updated first.
  router.get('/', async (req, res) => {
    res.json(await deps.sessions.listForUser(req.user!.id));
  });

  // Claim a pre-accounts anonymous session (one created before sign-in) for the
  // caller. Idempotent if already owned; 403 if owned by another user.
  router.post('/:sessionId/claim', async (req, res) => {
    const result = await deps.sessions.claim(sessionId(req), req.user!.id);
    if (result.ok) {
      res.json(result.session);
      return;
    }
    if (result.reason === 'notFound') {
      res.status(404).json({ error: 'Session not found.' });
      return;
    }
    res.status(403).json({ error: 'Forbidden.' });
  });

  router.get('/:sessionId', ownsSession, async (req, res) => {
    const session = await deps.sessions.get(sessionId(req));
    if (session === undefined) {
      res.status(404).json({ error: 'Session not found.' });
      return;
    }
    res.json(session);
  });

  // Update personality and/or pioneer profile. Takes effect on the next message.
  router.patch('/:sessionId', ownsSession, async (req, res) => {
    const parsed = updateSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const session = await deps.sessions.update(sessionId(req), parsed.data);
    if (session === undefined) {
      res.status(404).json({ error: 'Session not found.' });
      return;
    }
    res.json(session);
  });

  return router;
}
