import type { SessionService } from '../services/sessionService.js';
import type { ChatMessage } from '../types.js';
import { logger } from '../logger.js';
import { createProvider } from './factory.js';
import type { LlmProvider, LlmProviderFactory } from './provider.js';
import type { LlmRuntimeConfig } from './types.js';

/** The summariser's instruction — kept verbatim per the Phase 2 spec. */
const SUMMARY_INSTRUCTION =
  'Summarise this Satisfactory factory session concisely: what was built, what decisions ' +
  'were made, what did the pioneer say they enjoyed or disliked. Max 200 words. Plain text, ' +
  'no headings.';

/** Settings the summariser depends on. */
export interface SummaryConfig {
  historyWindow: number;
}

/**
 * Maintains a session's running summary so context survives beyond the history
 * window. Provider-agnostic: it builds a provider from the same runtime config
 * the chat turn used, so summaries run on the player's chosen provider with that
 * provider's cheaper summary model.
 */
export class SummaryService {
  private readonly inFlight = new Set<string>();

  public constructor(
    private readonly sessions: SessionService,
    private readonly config: SummaryConfig,
    private readonly providerFactory: LlmProviderFactory = createProvider,
  ) {}

  /** True once the message count has rolled past the window at least once. */
  public shouldSummarise(messageCount: number): boolean {
    return messageCount > this.config.historyWindow * 2;
  }

  /**
   * Fire-and-forget entry point: if the session has grown past the threshold,
   * regenerate and store its summary using the request's provider/config. Never
   * throws — failures are logged so a background summarisation can never crash
   * the request that scheduled it.
   */
  public async summariseIfNeeded(sessionId: string, llm: LlmRuntimeConfig): Promise<void> {
    if (this.inFlight.has(sessionId)) {
      return;
    }
    try {
      const count = await this.sessions.countMessages(sessionId);
      if (!this.shouldSummarise(count)) {
        return;
      }
      this.inFlight.add(sessionId);
      const session = await this.sessions.get(sessionId);
      if (session === undefined) {
        return;
      }
      const older = await this.sessions.messagesBeforeWindow(sessionId, this.config.historyWindow);
      if (older.length === 0) {
        return;
      }
      const provider = this.providerFactory(llm);
      const summary = await this.summarise(provider, llm, older, session.summary);
      if (summary.length > 0) {
        await this.sessions.updateSummary(sessionId, summary);
        logger.info(
          `Updated running summary for session '${sessionId}' (${summary.length} chars).`,
        );
      }
    } catch (error) {
      logger.error(`Background summarisation failed for session '${sessionId}':`, error);
    } finally {
      this.inFlight.delete(sessionId);
    }
  }

  /**
   * Produces a fresh summary by folding the given messages into the prior
   * summary with a single non-streaming completion. Exposed for testing.
   */
  public async summarise(
    provider: LlmProvider,
    llm: LlmRuntimeConfig,
    messages: ChatMessage[],
    priorSummary?: string,
  ): Promise<string> {
    const transcript = messages
      .map((message) => `${message.role === 'user' ? 'Pioneer' : 'Foreman'}: ${message.content}`)
      .join('\n');
    const prior = priorSummary?.trim();
    const priorBlock =
      prior !== undefined && prior.length > 0 ? `Summary so far:\n${prior}\n\n` : '';
    return provider.complete({
      system: SUMMARY_INSTRUCTION,
      userText: `${priorBlock}Conversation to summarise:\n${transcript}`,
      model: llm.summaryModel,
      maxTokens: llm.summaryMaxTokens,
    });
  }
}
