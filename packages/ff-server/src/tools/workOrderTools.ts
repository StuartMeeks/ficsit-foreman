import type { ToolDefinition } from '../mcp/client.js';
import type { WorkOrder } from '../types.js';
import {
  formatWorkOrderLabel,
  type UpdatePlanInput,
  type WorkOrderOutcome,
  type WorkOrderService,
} from '../services/workOrderService.js';
import {
  blockToolSchema,
  proposeCompletionSchema,
  reviseToolSchema,
  supersedeToolSchema,
  unblockToolSchema,
  workOrderCreateSchema,
} from '../validation.js';

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
export const PROPOSE_COMPLETION = 'propose_completion';
export const REVISE_WORK_ORDER = 'revise_work_order';
export const BLOCK_WORK_ORDER = 'block_work_order';
export const UNBLOCK_WORK_ORDER = 'unblock_work_order';
export const SUPERSEDE_WORK_ORDER = 'supersede_work_order';
export const CREATE_CHILD_WORK_ORDER = 'create_child_work_order';

const WORK_ORDER_TOOL_NAMES = new Set<string>([
  CREATE_WORK_ORDER,
  PROPOSE_COMPLETION,
  REVISE_WORK_ORDER,
  BLOCK_WORK_ORDER,
  UNBLOCK_WORK_ORDER,
  SUPERSEDE_WORK_ORDER,
  CREATE_CHILD_WORK_ORDER,
]);

/** True when `name` is one of the server-local work-order tools. */
export function isWorkOrderTool(name: string): boolean {
  return WORK_ORDER_TOOL_NAMES.has(name);
}

// --- JSON Schema fragments for tool inputs ---------------------------------

const expectedOutputItemSchema = {
  oneOf: [
    {
      type: 'object',
      properties: {
        kind: { const: 'item' },
        item: { type: 'string' },
        perMinute: { type: 'number' },
        unit: { type: 'string' },
      },
      required: ['kind', 'item', 'perMinute'],
    },
    {
      type: 'object',
      properties: { kind: { const: 'power' }, megawatts: { type: 'number' } },
      required: ['kind', 'megawatts'],
    },
    {
      type: 'object',
      properties: { kind: { const: 'unlock' }, schematic: { type: 'string' } },
      required: ['kind', 'schematic'],
    },
    {
      type: 'object',
      properties: { kind: { const: 'infrastructure' }, description: { type: 'string' } },
      required: ['kind', 'description'],
    },
  ],
};

const machinesSchema = {
  type: 'array',
  description: 'Machines to build, with required counts. Built counts start at 0.',
  items: {
    type: 'object',
    properties: {
      machineName: { type: 'string' },
      requiredCount: { type: 'integer', minimum: 0 },
      recipeName: { type: 'string' },
      notes: { type: 'string' },
    },
    required: ['machineName', 'requiredCount'],
  },
};

const materialsSchema = {
  type: 'array',
  description: 'Materials the pioneer should have on hand; each is checkable.',
  items: {
    type: 'object',
    properties: {
      itemName: { type: 'string' },
      requiredQuantity: { type: 'number' },
      notes: { type: 'string' },
    },
    required: ['itemName', 'requiredQuantity'],
  },
};

const stepsSchema = {
  type: 'array',
  description: 'Ordered, plain-language build steps; each is checkable.',
  items: {
    type: 'object',
    properties: { title: { type: 'string' }, description: { type: 'string' } },
    required: ['title'],
  },
};

const planProperties: Record<string, unknown> = {
  title: { type: 'string', description: 'Short, memorable title.' },
  goal: { type: 'string', description: 'One concise sentence — the purpose of the order.' },
  objective: { type: 'string', description: 'A fuller instruction of what to accomplish.' },
  strategicSignificance: { type: 'string', description: 'Why this work matters now.' },
  successCondition: { type: 'string', description: 'The specific condition that means done.' },
  tier: { type: 'integer', minimum: 0, maximum: 9, description: 'Satisfactory milestone tier.' },
  locationRecommendation: {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      coordinates: {
        type: 'object',
        properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } },
        required: ['x', 'y'],
      },
      relativeToPlayer: { type: 'string' },
      rationale: { type: 'string' },
    },
    required: ['summary'],
  },
  machines: machinesSchema,
  buildMaterials: materialsSchema,
  buildSteps: stepsSchema,
  expectedOutputs: {
    type: 'array',
    description:
      'What the order produces. Use kind=power (MW) as the hero output for power plants.',
    items: expectedOutputItemSchema,
  },
  notes: {
    type: 'array',
    description: 'Freeform foreman build notes / guidance shown alongside the order.',
    items: { type: 'string' },
  },
};

/**
 * Anthropic tool definitions for the foreman's work-order capabilities. Merged
 * with the MCP game-data tools when calling the model. Completion is Pioneer-
 * only (Option A): the foreman may only PROPOSE completion, never close out.
 */
export function workOrderToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: CREATE_WORK_ORDER,
      description:
        'Issue a NEW work order — a specific, self-contained task with everything needed to start. Use this ONLY for genuinely new work. To change the order the pioneer is already on (add/edit a step, swap a recipe, adjust counts, change the goal), call revise_work_order instead — do NOT create a second order. It starts in the `new` state for the pioneer to begin; it does NOT abandon any existing order (use supersede_work_order for that). Resolve alternate recipe choices and use the game-data + save-game tools for accurate materials, rates, locations, and opportunities before issuing.',
      inputSchema: {
        type: 'object',
        properties: planProperties,
        required: ['title', 'goal'],
      },
    },
    {
      name: PROPOSE_COMPLETION,
      description:
        'Suggest to the pioneer that the active work order looks finished. This does NOT complete it — only the pioneer may complete a work order. Use when the build appears done and you want to prompt them to confirm.',
      inputSchema: {
        type: 'object',
        properties: {
          workOrderId: { type: 'string', description: 'Target order; defaults to the active one.' },
          note: { type: 'string', description: 'Why you think it is complete.' },
        },
      },
    },
    {
      name: REVISE_WORK_ORDER,
      description:
        "Revise the current order's plan (any plan fields). Defaults to the order the pioneer is on — use this whenever they ask to adjust, add to, or change the active work order, rather than issuing a new one. Creates a new revision the pioneer acknowledges; their checklist progress is preserved. Provide a changeSummary describing what changed and why.",
      inputSchema: {
        type: 'object',
        properties: {
          workOrderId: { type: 'string', description: 'Target order; defaults to the active one.' },
          ...planProperties,
          changeSummary: { type: 'string', description: 'What changed since the last revision.' },
        },
      },
    },
    {
      name: BLOCK_WORK_ORDER,
      description:
        'Mark an order blocked when it cannot continue. Always supply a clear reason and a resolution hint (e.g. a prerequisite child order).',
      inputSchema: {
        type: 'object',
        properties: {
          workOrderId: { type: 'string' },
          blockedReason: { type: 'string' },
          blockedResolutionHint: { type: 'string' },
        },
        required: ['blockedReason', 'blockedResolutionHint'],
      },
    },
    {
      name: UNBLOCK_WORK_ORDER,
      description: 'Clear a block once resolved. Supply a note on how it was resolved.',
      inputSchema: {
        type: 'object',
        properties: {
          workOrderId: { type: 'string' },
          resolutionNote: { type: 'string' },
        },
        required: ['resolutionNote'],
      },
    },
    {
      name: SUPERSEDE_WORK_ORDER,
      description:
        'Replace an order with a newer strategic instruction. Issue the replacement with create_work_order first, then supersede the old one referencing the new id.',
      inputSchema: {
        type: 'object',
        properties: {
          workOrderId: { type: 'string', description: 'The order being superseded.' },
          supersededByWorkOrderId: { type: 'string', description: 'The replacement order id.' },
          supersededReason: { type: 'string' },
        },
        required: ['supersededByWorkOrderId', 'supersededReason'],
      },
    },
    {
      name: CREATE_CHILD_WORK_ORDER,
      description:
        'Create a prerequisite/supporting child of a parent order (e.g. hard-drive hunt, MAM research, resource gathering). Often paired with block_work_order on the parent. Completing the child auto-unblocks a blocked parent.',
      inputSchema: {
        type: 'object',
        properties: {
          parentWorkOrderId: {
            type: 'string',
            description: 'Parent; defaults to the active order.',
          },
          relationshipToParent: {
            type: 'string',
            enum: [
              'prerequisite',
              'exploration',
              'hard_drive_hunt',
              'mam_research',
              'resource_gathering',
              'infrastructure_support',
              'corrective_action',
            ],
          },
          ...planProperties,
        },
        required: ['title', 'goal', 'relationshipToParent'],
      },
    },
  ];
}

/**
 * Validates and executes a work-order tool call. Returns a text result for the
 * model to read back and, where relevant, the affected order for the client.
 */
export async function handleWorkOrderTool(
  playthroughId: string,
  name: string,
  input: unknown,
  deps: WorkOrderToolDeps,
): Promise<WorkOrderToolOutcome> {
  switch (name) {
    case CREATE_WORK_ORDER:
      return handleCreate(playthroughId, input, deps);
    case PROPOSE_COMPLETION:
      return handleProposeCompletion(playthroughId, input, deps);
    case REVISE_WORK_ORDER:
      return handleRevise(playthroughId, input, deps);
    case BLOCK_WORK_ORDER:
      return handleBlock(playthroughId, input, deps);
    case UNBLOCK_WORK_ORDER:
      return handleUnblock(playthroughId, input, deps);
    case SUPERSEDE_WORK_ORDER:
      return handleSupersede(playthroughId, input, deps);
    case CREATE_CHILD_WORK_ORDER:
      return handleCreateChild(playthroughId, input, deps);
    default:
      return { text: `Unknown work-order tool '${name}'.`, isError: true };
  }
}

async function handleCreate(
  playthroughId: string,
  input: unknown,
  deps: WorkOrderToolDeps,
): Promise<WorkOrderToolOutcome> {
  const parsed = workOrderCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { text: `Invalid create_work_order arguments: ${parsed.error.message}`, isError: true };
  }
  const order = await deps.workOrders.create(playthroughId, parsed.data, deps.gameVersion());
  const label = formatWorkOrderLabel(order.sequenceNumber);
  return {
    text: `Issued ${label}: "${order.title}" (state: new). Tell the pioneer it is ready to start.`,
    isError: false,
    workOrder: order,
  };
}

async function handleProposeCompletion(
  playthroughId: string,
  input: unknown,
  deps: WorkOrderToolDeps,
): Promise<WorkOrderToolOutcome> {
  const parsed = proposeCompletionSchema.safeParse(input);
  if (!parsed.success) {
    return { text: `Invalid propose_completion arguments: ${parsed.error.message}`, isError: true };
  }
  const target = await resolveTargetId(deps, playthroughId, parsed.data.workOrderId);
  if (target.error !== undefined) {
    return { text: target.error, isError: true };
  }
  const outcome = await deps.workOrders.proposeCompletion(
    playthroughId,
    target.id,
    parsed.data.note,
  );
  return mapOutcome(outcome, (order) => ({
    text: `Proposed completion of ${formatWorkOrderLabel(order.sequenceNumber)}. Ask the pioneer to confirm — only they can mark it complete.`,
    workOrder: order,
  }));
}

async function handleRevise(
  playthroughId: string,
  input: unknown,
  deps: WorkOrderToolDeps,
): Promise<WorkOrderToolOutcome> {
  const parsed = reviseToolSchema.safeParse(input);
  if (!parsed.success) {
    return { text: `Invalid revise_work_order arguments: ${parsed.error.message}`, isError: true };
  }
  const target = await resolveTargetId(deps, playthroughId, parsed.data.workOrderId);
  if (target.error !== undefined) {
    return { text: target.error, isError: true };
  }
  const { workOrderId: _id, changeSummary, ...patch } = parsed.data;
  void _id;
  const meta = changeSummary !== undefined ? { changeSummary } : {};
  const outcome = await deps.workOrders.updatePlan(
    playthroughId,
    target.id,
    patch as UpdatePlanInput,
    'Foreman',
    meta,
  );
  return mapOutcome(outcome, (order) => ({
    text: `Revised ${formatWorkOrderLabel(order.sequenceNumber)} (now revision ${order.currentRevision}). The pioneer will see a plan-changed notice to acknowledge.`,
    workOrder: order,
  }));
}

async function handleBlock(
  playthroughId: string,
  input: unknown,
  deps: WorkOrderToolDeps,
): Promise<WorkOrderToolOutcome> {
  const parsed = blockToolSchema.safeParse(input);
  if (!parsed.success) {
    return { text: `Invalid block_work_order arguments: ${parsed.error.message}`, isError: true };
  }
  const target = await resolveTargetId(deps, playthroughId, parsed.data.workOrderId);
  if (target.error !== undefined) {
    return { text: target.error, isError: true };
  }
  const outcome = await deps.workOrders.transition(playthroughId, target.id, 'Block', 'Foreman', {
    blockedReason: parsed.data.blockedReason,
    blockedResolutionHint: parsed.data.blockedResolutionHint,
  });
  return mapOutcome(outcome, (order) => ({
    text: `Blocked ${formatWorkOrderLabel(order.sequenceNumber)}: ${parsed.data.blockedReason}`,
    workOrder: order,
  }));
}

async function handleUnblock(
  playthroughId: string,
  input: unknown,
  deps: WorkOrderToolDeps,
): Promise<WorkOrderToolOutcome> {
  const parsed = unblockToolSchema.safeParse(input);
  if (!parsed.success) {
    return { text: `Invalid unblock_work_order arguments: ${parsed.error.message}`, isError: true };
  }
  const target = await resolveTargetId(deps, playthroughId, parsed.data.workOrderId);
  if (target.error !== undefined) {
    return { text: target.error, isError: true };
  }
  const outcome = await deps.workOrders.transition(playthroughId, target.id, 'Unblock', 'Foreman', {
    resolutionNote: parsed.data.resolutionNote,
  });
  return mapOutcome(outcome, (order) => ({
    text: `Unblocked ${formatWorkOrderLabel(order.sequenceNumber)} (now active).`,
    workOrder: order,
  }));
}

async function handleSupersede(
  playthroughId: string,
  input: unknown,
  deps: WorkOrderToolDeps,
): Promise<WorkOrderToolOutcome> {
  const parsed = supersedeToolSchema.safeParse(input);
  if (!parsed.success) {
    return {
      text: `Invalid supersede_work_order arguments: ${parsed.error.message}`,
      isError: true,
    };
  }
  const target = await resolveTargetId(deps, playthroughId, parsed.data.workOrderId);
  if (target.error !== undefined) {
    return { text: target.error, isError: true };
  }
  const outcome = await deps.workOrders.transition(
    playthroughId,
    target.id,
    'Supersede',
    'Foreman',
    {
      supersededByWorkOrderId: parsed.data.supersededByWorkOrderId,
      supersededReason: parsed.data.supersededReason,
    },
  );
  return mapOutcome(outcome, (order) => ({
    text: `Superseded ${formatWorkOrderLabel(order.sequenceNumber)}.`,
    workOrder: order,
  }));
}

async function handleCreateChild(
  playthroughId: string,
  input: unknown,
  deps: WorkOrderToolDeps,
): Promise<WorkOrderToolOutcome> {
  const parsed = workOrderCreateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      text: `Invalid create_child_work_order arguments: ${parsed.error.message}`,
      isError: true,
    };
  }
  if (parsed.data.relationshipToParent === undefined) {
    return { text: 'create_child_work_order requires relationshipToParent.', isError: true };
  }
  let parentId = parsed.data.parentWorkOrderId;
  if (parentId === undefined) {
    const current = await deps.workOrders.getCurrent(playthroughId);
    if (current === undefined) {
      return {
        text: 'No parentWorkOrderId given and no current order to parent to.',
        isError: true,
      };
    }
    parentId = current.id;
  }
  const order = await deps.workOrders.create(
    playthroughId,
    { ...parsed.data, parentWorkOrderId: parentId },
    deps.gameVersion(),
  );
  return {
    text: `Issued child ${formatWorkOrderLabel(order.sequenceNumber)}: "${order.title}" under the parent. Completing it will auto-unblock a blocked parent.`,
    isError: false,
    workOrder: order,
  };
}

/** Resolves the target order id (explicit, or the playthrough's current order). */
async function resolveTargetId(
  deps: WorkOrderToolDeps,
  playthroughId: string,
  explicitId: string | undefined,
): Promise<{ id: string; error?: undefined } | { id?: undefined; error: string }> {
  if (explicitId !== undefined) {
    return { id: explicitId };
  }
  // The "current" order — active, or the latest non-terminal — so the foreman can
  // act on an order it just issued (which is `new`, not yet `active`).
  const current = await deps.workOrders.getCurrent(playthroughId);
  if (current === undefined) {
    return { error: 'No workOrderId given and no current work order in this playthrough.' };
  }
  return { id: current.id };
}

/** Maps a service outcome to a tool outcome, rendering failures as error text. */
function mapOutcome(
  outcome: WorkOrderOutcome,
  onOk: (order: WorkOrder) => { text: string; workOrder: WorkOrder },
): WorkOrderToolOutcome {
  if (!outcome.ok) {
    return { text: outcome.message, isError: true };
  }
  const { text, workOrder } = onOk(outcome.order);
  return { text, isError: false, workOrder };
}
