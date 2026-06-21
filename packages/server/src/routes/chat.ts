import { Router } from 'express';

import type { AppDeps } from '../deps.js';
import { runChat, type ChatDeps } from '../anthropic/chat.js';
import { logger } from '../logger.js';
import { openSse } from '../sse.js';
import { chatSchema } from '../validation.js';

/**
 * Chat route, mounted under /api/sessions/:sessionId/chat. Streams the foreman's
 * response over SSE while running the tool-use loop server-side. The Anthropic
 * key is the client-supplied free-tier key (request header) if present, else the
 * server's hosted key.
 */
export function chatRouter(deps: AppDeps): Router {
  const router = Router({ mergeParams: true });

  const chatDeps: ChatDeps = {
    model: deps.config.model,
    maxTokens: deps.config.maxTokens,
    systemPromptTemplate: deps.systemPromptTemplate,
    historyWindow: deps.config.historyWindow,
    sessions: deps.sessions,
    workOrders: deps.workOrders,
    mcp: deps.mcp,
  };

  router.post('/', async (req, res) => {
    const { sessionId = '' } = req.params as { sessionId?: string };

    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const session = await deps.sessions.get(sessionId);
    if (session === undefined) {
      res.status(404).json({ error: 'Session not found.' });
      return;
    }

    const headerKey = req.header(deps.config.clientKeyHeader)?.trim();
    const apiKey = headerKey && headerKey.length > 0 ? headerKey : deps.config.hostedApiKey;
    if (apiKey === undefined) {
      res.status(400).json({
        error: `No Anthropic API key. Supply one via the '${deps.config.clientKeyHeader}' header, or configure ANTHROPIC_API_KEY on the server.`,
      });
      return;
    }

    // Persist the user turn before building history, so it is included in the
    // windowed context sent to the model.
    await deps.sessions.appendMessage(sessionId, 'user', parsed.data.message);

    const sse = openSse(res);
    try {
      const finalText = await runChat({ session, apiKey }, chatDeps, {
        text: (delta) => sse.send('text', { delta }),
        toolUse: (name) => sse.send('tool_use', { name }),
        workOrder: (order) => sse.send('work_order', order),
      });
      if (finalText.length > 0) {
        await deps.sessions.appendMessage(sessionId, 'assistant', finalText);
      }
      sse.send('done', { ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Chat turn failed for session '${sessionId}':`, error);
      sse.send('error', { message });
    } finally {
      sse.close();
    }

    // Refresh the running summary in the background once the conversation has
    // rolled past the window. Fire-and-forget — never blocks the response, and
    // the service swallows and logs its own errors.
    void deps.summary.summariseIfNeeded(sessionId, apiKey);
  });

  return router;
}
