import Anthropic from '@anthropic-ai/sdk';

import type { McpGateway } from '../mcp/client.js';
import type { SessionService } from '../services/sessionService.js';
import type { WorkOrderService } from '../services/workOrderService.js';
import type { Session, WorkOrder } from '../types.js';
import { logger } from '../logger.js';
import { buildSystemPrompt } from './systemPrompt.js';
import {
  handleWorkOrderTool,
  isWorkOrderTool,
  workOrderToolDefinitions,
} from '../tools/workOrderTools.js';

/** Backing services and settings the chat loop needs. */
export interface ChatDeps {
  model: string;
  maxTokens: number;
  systemPromptTemplate: string;
  historyWindow: number;
  sessions: SessionService;
  workOrders: WorkOrderService;
  mcp: McpGateway;
}

/** A single chat turn to run. The user message is already persisted. */
export interface ChatRequest {
  session: Session;
  /** Resolved Anthropic API key (client-supplied free-tier key, or hosted key). */
  apiKey: string;
}

/** Sink for streaming events as the turn unfolds. */
export interface ChatEvents {
  /** A chunk of assistant text. */
  text(delta: string): void;
  /** The foreman has invoked a tool (game-data or work-order). */
  toolUse(name: string): void;
  /** A work order was created or closed out. */
  workOrder(order: WorkOrder): void;
}

/** Safety bound on tool-use round-trips within a single turn. */
const MAX_TOOL_ITERATIONS = 12;

/**
 * Runs one foreman chat turn: assembles the windowed history and system prompt,
 * then drives the Anthropic tool-use loop server-side — streaming text to the
 * caller and invoking MCP game-data tools and work-order tools as the model
 * requests them — until the model returns a final answer. Returns the full
 * assistant text for persistence.
 */
export async function runChat(
  req: ChatRequest,
  deps: ChatDeps,
  events: ChatEvents,
): Promise<string> {
  const anthropic = new Anthropic({ apiKey: req.apiKey });
  const system = buildSystemPrompt(deps.systemPromptTemplate, req.session);
  const tools = await assembleTools(deps.mcp);

  const history = await deps.sessions.recentMessages(req.session.id, deps.historyWindow);
  const messages: Anthropic.MessageParam[] = history.map((message) => ({
    role: message.role,
    content: message.content,
  }));

  let streamedText = '';

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
    const stream = anthropic.messages.stream({
      model: deps.model,
      max_tokens: deps.maxTokens,
      system,
      messages,
      tools,
    });
    stream.on('text', (delta: string) => {
      streamedText += delta;
      events.text(delta);
    });

    const final = await stream.finalMessage();
    messages.push({ role: 'assistant', content: final.content });

    if (final.stop_reason !== 'tool_use') {
      return streamedText;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of final.content) {
      if (block.type !== 'tool_use') {
        continue;
      }
      events.toolUse(block.name);
      const outcome = await dispatchTool(req.session.id, block, deps, events);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: outcome.text,
        is_error: outcome.isError,
      });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  logger.warn(
    `Tool loop hit the ${MAX_TOOL_ITERATIONS}-iteration cap; returning partial response.`,
  );
  return streamedText;
}

/** Merges the MCP game-data tools with the server-local work-order tools. */
async function assembleTools(mcp: McpGateway): Promise<Anthropic.Tool[]> {
  const mcpTools = await mcp.listTools();
  const all = [...mcpTools, ...workOrderToolDefinitions()];
  return all.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
  }));
}

interface ToolOutcome {
  text: string;
  isError: boolean;
}

/** Routes a tool call to the work-order handler or the MCP server. */
async function dispatchTool(
  sessionId: string,
  block: Anthropic.ToolUseBlock,
  deps: ChatDeps,
  events: ChatEvents,
): Promise<ToolOutcome> {
  if (isWorkOrderTool(block.name)) {
    const outcome = await handleWorkOrderTool(sessionId, block.name, block.input, {
      workOrders: deps.workOrders,
      gameVersion: () => deps.mcp.gameVersion,
    });
    if (outcome.workOrder !== undefined) {
      events.workOrder(outcome.workOrder);
    }
    return { text: outcome.text, isError: outcome.isError };
  }
  const args = (block.input ?? {}) as Record<string, unknown>;
  return deps.mcp.callTool(block.name, args);
}
