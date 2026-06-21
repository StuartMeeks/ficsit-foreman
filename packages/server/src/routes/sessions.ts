import { Router } from 'express';

import type { AppDeps } from '../deps.js';
import { createSessionSchema, updateSessionSchema } from '../validation.js';

/** Routes for session lifecycle: create, fetch, and update personality/profile. */
export function sessionsRouter(deps: AppDeps): Router {
  const router = Router();

  // Create a session, optionally seeding personality and pioneer profile.
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
    const session = await deps.sessions.create(parsed.data);
    res.status(201).json(session);
  });

  router.get('/:sessionId', async (req, res) => {
    const session = await deps.sessions.get(req.params.sessionId);
    if (session === undefined) {
      res.status(404).json({ error: 'Session not found.' });
      return;
    }
    res.json(session);
  });

  // Update personality and/or pioneer profile. Takes effect on the next message.
  router.patch('/:sessionId', async (req, res) => {
    const parsed = updateSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const session = await deps.sessions.update(req.params.sessionId, parsed.data);
    if (session === undefined) {
      res.status(404).json({ error: 'Session not found.' });
      return;
    }
    res.json(session);
  });

  return router;
}
