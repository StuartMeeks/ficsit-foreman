import type { ServerConfig } from './config.js';
import type { McpGateway } from './mcp/client.js';
import type { SessionService } from './services/sessionService.js';
import type { WorkOrderService } from './services/workOrderService.js';

/** Everything the HTTP layer needs, assembled once at startup. */
export interface AppDeps {
  config: ServerConfig;
  sessions: SessionService;
  workOrders: WorkOrderService;
  mcp: McpGateway;
  /** The foreman system prompt template (placeholders not yet substituted). */
  systemPromptTemplate: string;
}
