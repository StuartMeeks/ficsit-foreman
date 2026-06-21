import { Router } from 'express';

import type { AppDeps } from '../deps.js';
import { workOrderCreateSchema, workOrderUpdateSchema } from '../validation.js';

/**
 * Routes for work orders, mounted under /api/sessions/:sessionId/work-orders.
 * Creation stamps the current game data version and supersedes any active order
 * (handled in the service). `mergeParams` exposes the parent :sessionId.
 */
export function workOrdersRouter(deps: AppDeps): Router {
  const router = Router({ mergeParams: true });

  const sessionId = (req: { params: Record<string, string> }): string => req.params.sessionId ?? '';

  // Create a new work order (the REST path; the foreman uses the create tool).
  router.post('/', async (req, res) => {
    const session = await deps.sessions.get(sessionId(req));
    if (session === undefined) {
      res.status(404).json({ error: 'Session not found.' });
      return;
    }
    const parsed = workOrderCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const order = await deps.workOrders.create(session.id, parsed.data, deps.mcp.gameVersion);
    res.status(201).json(order);
  });

  // Full history, oldest first.
  router.get('/', async (req, res) => {
    const session = await deps.sessions.get(sessionId(req));
    if (session === undefined) {
      res.status(404).json({ error: 'Session not found.' });
      return;
    }
    res.json(await deps.workOrders.list(session.id));
  });

  // The current active order (404 when none is active).
  router.get('/active', async (req, res) => {
    const session = await deps.sessions.get(sessionId(req));
    if (session === undefined) {
      res.status(404).json({ error: 'Session not found.' });
      return;
    }
    const active = await deps.workOrders.getActive(session.id);
    if (active === undefined) {
      res.status(404).json({ error: 'No active work order.' });
      return;
    }
    res.json(active);
  });

  router.get('/:id', async (req, res) => {
    const order = await deps.workOrders.get(sessionId(req), req.params.id);
    if (order === undefined) {
      res.status(404).json({ error: 'Work order not found.' });
      return;
    }
    res.json(order);
  });

  // Update an order: complete, abandon, add adaptations or pioneer feedback.
  router.patch('/:id', async (req, res) => {
    const parsed = workOrderUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const order = await deps.workOrders.update(sessionId(req), req.params.id, parsed.data);
    if (order === undefined) {
      res.status(404).json({ error: 'Work order not found.' });
      return;
    }
    res.json(order);
  });

  return router;
}
