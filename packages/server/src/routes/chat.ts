import { Router } from 'express';

import type { AppDeps } from '../deps.js';
import { clientLlmConfig, serverLlmConfig } from '../config.js';
import { runChat, type ChatDeps } from '../llm/chat.js';
import type { LlmRuntimeConfig } from '../llm/types.js';
import { logger } from '../logger.js';
import { openSse } from '../sse.js';
import { chatSchema } from '../validation.js';

/**
 * Chat route, mounted under /api/sessions/:sessionId/chat. Streams the foreman's
 * response over SSE while running the tool-use loop server-side. The provider,
 * model, and key are resolved per request: a client that supplies its own key
 * (header) may also override provider/model/base URL (body); otherwise the
 * server's configured defaults and hosted key are used.
 */
export function chatRouter(deps: AppDeps): Router {
  const router = Router({ mergeParams: true });

  const chatDeps: ChatDeps = {
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

    // A client key (header) unlocks its own provider/model/base-URL override.
    // Without one, fall back entirely to the server's configured defaults.
    const headerKey = req.header(deps.config.clientKeyHeader)?.trim();
    let llm: LlmRuntimeConfig;
    if (headerKey !== undefined && headerKey.length > 0) {
      llm = clientLlmConfig(
        deps.config,
        { provider: parsed.data.provider, model: parsed.data.model, baseUrl: parsed.data.baseUrl },
        headerKey,
      );
    } else if (deps.config.hostedApiKey !== undefined) {
      llm = serverLlmConfig(deps.config, deps.config.hostedApiKey);
    } else {
      res.status(400).json({
        error: `No LLM API key. Supply one via the '${deps.config.clientKeyHeader}' header, or configure a server key (LLM_API_KEY).`,
      });
      return;
    }

    // Persist the user turn before building history, so it is included in the
    // windowed context sent to the model.
    await deps.sessions.appendMessage(sessionId, 'user', parsed.data.message);

    const sse = openSse(res);
    try {
      const provider = deps.llmProviderFactory(llm);
      const finalText = await runChat(
        { session, provider, model: llm.model, maxTokens: llm.maxTokens },
        chatDeps,
        {
          text: (delta) => sse.send('text', { delta }),
          toolUse: (name) => sse.send('tool_use', { name }),
          workOrder: (order) => sse.send('work_order', order),
        },
      );
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

    // Refresh the running summary in the background, on the same provider/config.
    void deps.summary.summariseIfNeeded(sessionId, llm);
  });

  return router;
}
