import type { ToolDefinition } from '../mcp/client.js';
import type { WorkOrder } from '../types.js';
import { formatWorkOrderLabel, type WorkOrderService } from '../services/workOrderService.js';
import { workOrderCompleteSchema, workOrderCreateSchema } from '../validation.js';

/** Dependencies the work-order tool handlers need. */
export interface WorkOrderToolDeps {
  workOrders: WorkOrderService;
  /** Current game data version, stamped onto newly-issued orders. */
  gameVersion: () => string;
}

/** Outcome of a work-order tool call: text for the model, struct for the UI. */
export interface WorkOrderToolOutcome {
  text: string;
  isError: boolean;
  /** The affected order, surfaced to the client over SSE. */
  workOrder?: WorkOrder;
}

export const CREATE_WORK_ORDER = 'create_work_order';
export const COMPLETE_WORK_ORDER = 'complete_work_order';
const WORK_ORDER_TOOL_NAMES = new Set<string>([CREATE_WORK_ORDER, COMPLETE_WORK_ORDER]);

/** True when `name` is one of the server-local work-order tools. */
export function isWorkOrderTool(name: string): boolean {
  return WORK_ORDER_TOOL_NAMES.has(name);
}

/**
 * Anthropic tool definitions for the foreman's work-order capabilities. These
 * are merged with the MCP game-data tools when calling the model.
 */
export function workOrderToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: CREATE_WORK_ORDER,
      description:
        'Issue a new work order to the pioneer. A specific, single-session task with everything needed to start building. Issuing a new order automatically abandons the current active one — narrate that transition in your reply. Use the game-data tools to get accurate material lists and rates before issuing.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short, memorable title.' },
          objective: { type: 'string', description: 'One sentence — what done looks like.' },
          tier: {
            type: 'integer',
            minimum: 0,
            maximum: 9,
            description: 'Satisfactory milestone tier.',
          },
          estimatedDuration: { type: 'string', description: 'e.g. "20–30 minutes".' },
          requiredItems: {
            type: 'array',
            description: 'Materials the pioneer needs on hand before starting.',
            items: {
              type: 'object',
              properties: {
                item: { type: 'string' },
                quantity: { type: 'number' },
                unit: { type: 'string', description: 'e.g. "units", "per minute".' },
              },
              required: ['item', 'quantity', 'unit'],
            },
          },
          buildSteps: {
            type: 'array',
            description: 'Ordered, plain-language build instructions.',
            items: { type: 'string' },
          },
          expectedOutput: {
            type: 'array',
            description: 'What the line produces, per item.',
            items: {
              type: 'object',
              properties: {
                item: { type: 'string' },
                perMinute: { type: 'number' },
              },
              required: ['item', 'perMinute'],
            },
          },
          notes: { type: 'string', description: 'Optional commentary issued with the order.' },
        },
        required: [
          'title',
          'objective',
          'tier',
          'estimatedDuration',
          'requiredItems',
          'buildSteps',
          'expectedOutput',
        ],
      },
    },
    {
      name: COMPLETE_WORK_ORDER,
      description:
        "Close out the session's active work order as completed. Provide a two-sentence completion summary, any mid-order adaptations that occurred, and the pioneer's feedback on what they enjoyed and what felt tedious.",
      inputSchema: {
        type: 'object',
        properties: {
          completionSummary: {
            type: 'string',
            description: 'Two sentences max — what was achieved and why it matters.',
          },
          adaptations: {
            type: 'array',
            description: 'Mid-order changes (power crisis, bottleneck, pivot).',
            items: { type: 'string' },
          },
          pioneerFeedback: {
            type: 'object',
            properties: {
              enjoyedAspects: { type: 'array', items: { type: 'string' } },
              didNotEnjoy: { type: 'array', items: { type: 'string' } },
              freeformNotes: { type: 'string' },
            },
          },
        },
        required: ['completionSummary'],
      },
    },
  ];
}

/**
 * Validates and executes a work-order tool call. Returns a text result for the
 * model to read back and, where relevant, the affected order for the client.
 */
export async function handleWorkOrderTool(
  sessionId: string,
  name: string,
  input: unknown,
  deps: WorkOrderToolDeps,
): Promise<WorkOrderToolOutcome> {
  if (name === CREATE_WORK_ORDER) {
    return handleCreate(sessionId, input, deps);
  }
  if (name === COMPLETE_WORK_ORDER) {
    return handleComplete(sessionId, input, deps);
  }
  return { text: `Unknown work-order tool '${name}'.`, isError: true };
}

async function handleCreate(
  sessionId: string,
  input: unknown,
  deps: WorkOrderToolDeps,
): Promise<WorkOrderToolOutcome> {
  const parsed = workOrderCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { text: `Invalid create_work_order arguments: ${parsed.error.message}`, isError: true };
  }
  const previousActive = await deps.workOrders.getActive(sessionId);
  const order = await deps.workOrders.create(sessionId, parsed.data, deps.gameVersion());
  const label = formatWorkOrderLabel(order.sequenceNumber);
  const supersede =
    previousActive !== undefined
      ? ` Superseded ${formatWorkOrderLabel(previousActive.sequenceNumber)} (now abandoned) — tell the pioneer you are closing it out.`
      : '';
  return {
    text: `Issued ${label}: "${order.title}" (active).${supersede}`,
    isError: false,
    workOrder: order,
  };
}

async function handleComplete(
  sessionId: string,
  input: unknown,
  deps: WorkOrderToolDeps,
): Promise<WorkOrderToolOutcome> {
  const parsed = workOrderCompleteSchema.safeParse(input);
  if (!parsed.success) {
    return {
      text: `Invalid complete_work_order arguments: ${parsed.error.message}`,
      isError: true,
    };
  }
  const patch: Parameters<WorkOrderService['completeActive']>[1] = {
    completionSummary: parsed.data.completionSummary,
  };
  if (parsed.data.adaptations !== undefined) {
    patch.adaptations = parsed.data.adaptations;
  }
  if (parsed.data.pioneerFeedback !== undefined) {
    patch.pioneerFeedback = parsed.data.pioneerFeedback;
  }
  const order = await deps.workOrders.completeActive(sessionId, patch);
  if (order === undefined) {
    return {
      text: 'No active work order to complete. Nothing was changed.',
      isError: true,
    };
  }
  return {
    text: `Closed out ${formatWorkOrderLabel(order.sequenceNumber)}: "${order.title}" (completed).`,
    isError: false,
    workOrder: order,
  };
}
