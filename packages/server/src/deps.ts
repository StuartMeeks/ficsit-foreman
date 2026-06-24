import type { Auth } from './auth.js';
import type { ServerConfig } from './config.js';
import type { LlmProviderFactory } from './llm/provider.js';
import type { SummaryService } from './llm/summary.js';
import type { McpGateway } from './mcp/client.js';
import type { SessionService } from './services/sessionService.js';
import type { WorkOrderService } from './services/workOrderService.js';

/** Everything the HTTP layer needs, assembled once at startup. */
export interface AppDeps {
  config: ServerConfig;
  /** The Better Auth instance (owns /api/auth/* and session resolution). */
  auth: Auth;
  sessions: SessionService;
  workOrders: WorkOrderService;
  mcp: McpGateway;
  /** Maintains each session's running summary in the background. */
  summary: SummaryService;
  /** Builds an LLM provider from a resolved per-request runtime config. */
  llmProviderFactory: LlmProviderFactory;
  /** The foreman system prompt template (placeholders not yet substituted). */
  systemPromptTemplate: string;
}
