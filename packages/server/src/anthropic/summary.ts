import Anthropic from '@anthropic-ai/sdk';

import type { SessionService } from '../services/sessionService.js';
import type { ChatMessage } from '../types.js';
import { logger } from '../logger.js';

/** The summariser's instruction — kept verbatim per the Phase 2 spec. */
const SUMMARY_INSTRUCTION =
  'Summarise this Satisfactory factory session concisely: what was built, what decisions ' +
  'were made, what did the pioneer say they enjoyed or disliked. Max 200 words. Plain text, ' +
  'no headings.';

interface SummaryCreateParams {
  model: string;
  max_tokens: number;
  system: string;
  messages: { role: 'user'; content: string }[];
}

interface SummaryResponse {
  content: { type: string; text?: string }[];
}

/** Minimal Anthropic surface the summariser needs — non-streaming create only. */
export interface SummaryClient {
  messages: { create(params: SummaryCreateParams): Promise<SummaryResponse> };
}

export type SummaryClientFactory = (apiKey: string) => SummaryClient;

/** Settings the summariser depends on. */
export interface SummaryConfig {
  summaryModel: string;
  summaryMaxTokens: number;
  historyWindow: number;
}

const defaultClientFactory: SummaryClientFactory = (apiKey) =>
  new Anthropic({ apiKey }) as unknown as SummaryClient;

/**
 * Maintains a session's running summary so context survives beyond the history
 * window. Summarisation is triggered fire-and-forget after a chat turn once the
 * conversation has rolled past the window at least once; it folds the messages
 * that fall outside the window into the prior summary using a cheap model.
 */
export class SummaryService {
  /** Sessions currently being summarised, to avoid stacking concurrent calls. */
  private readonly inFlight = new Set<string>();

  public constructor(
    private readonly sessions: SessionService,
    private readonly config: SummaryConfig,
    private readonly clientFactory: SummaryClientFactory = defaultClientFactory,
  ) {}

  /** True once the message count has rolled past the window at least once. */
  public shouldSummarise(messageCount: number): boolean {
    return messageCount > this.config.historyWindow * 2;
  }

  /**
   * Fire-and-forget entry point: if the session has grown past the threshold,
   * regenerate and store its summary. Never throws — failures are logged so a
   * background summarisation can never crash the request that scheduled it.
   */
  public async summariseIfNeeded(sessionId: string, apiKey: string): Promise<void> {
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
      const summary = await this.summarise(apiKey, older, session.summary);
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
   * summary with a single non-streaming call. Exposed for testing.
   */
  public async summarise(
    apiKey: string,
    messages: ChatMessage[],
    priorSummary?: string,
  ): Promise<string> {
    const client = this.clientFactory(apiKey);
    const transcript = messages
      .map((message) => `${message.role === 'user' ? 'Pioneer' : 'Foreman'}: ${message.content}`)
      .join('\n');
    const prior = priorSummary?.trim();
    const priorBlock =
      prior !== undefined && prior.length > 0 ? `Summary so far:\n${prior}\n\n` : '';
    const response = await client.messages.create({
      model: this.config.summaryModel,
      max_tokens: this.config.summaryMaxTokens,
      system: SUMMARY_INSTRUCTION,
      messages: [
        { role: 'user', content: `${priorBlock}Conversation to summarise:\n${transcript}` },
      ],
    });
    return response.content
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('')
      .trim();
  }
}
