import type { McpGateway, ToolDefinition } from '../mcp/client.js';
import type { BuildCostLine, WorkOrder } from '../types.js';
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
  /** MCP gateway — resolves every game-data name in a plan (buildings, recipes, items,
   * schematics) and enriches buildable build costs, rejecting the order on any miss. */
  mcp: McpGateway;
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

const buildablesSchema = {
  type: 'array',
  description:
    'The buildables this step requires — every machine AND logistics piece (belts, splitters, mergers, pipes, poles), each with how many to build. Enumerate per consumer: e.g. an 8-generator plant needs a splitter and a merger PER generator, and belts feeding each machine — not one or two of each. Do NOT include build-cost materials; the server computes the construction cost from game data automatically.',
  items: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Building display name, e.g. "Coal Generator".' },
      requiredCount: { type: 'integer', minimum: 0 },
      recipeName: { type: 'string' },
      notes: { type: 'string' },
    },
    required: ['name', 'requiredCount'],
  },
};

const stepsSchema = {
  type: 'array',
  description:
    'Ordered build steps; each is checkable and holds the buildables (with counts) it requires.',
  items: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      description: { type: 'string' },
      buildables: buildablesSchema,
    },
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
  const enrich = await resolvePlanReferences(parsed.data, deps.mcp);
  if (!enrich.ok) {
    return { text: enrich.message, isError: true };
  }
  const power = await verifyPlanPower(parsed.data, deps.mcp);
  if (!power.ok) {
    return { text: power.message, isError: true };
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
  const enrich = await resolvePlanReferences(patch, deps.mcp);
  if (!enrich.ok) {
    return { text: enrich.message, isError: true };
  }
  const power = await verifyPlanPower(patch, deps.mcp);
  if (!power.ok) {
    return { text: power.message, isError: true };
  }
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
  const enrich = await resolvePlanReferences(parsed.data, deps.mcp);
  if (!enrich.ok) {
    return { text: enrich.message, isError: true };
  }
  const power = await verifyPlanPower(parsed.data, deps.mcp);
  if (!power.ok) {
    return { text: power.message, isError: true };
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

/** Per-unit build cost + resolved class for one buildable, from `get_building`. */
interface ResolvedBuild {
  buildingClass?: string;
  buildCost: BuildCostLine[];
}

interface BuildableInput {
  name: string;
  buildingClass?: string;
  buildCost?: BuildCostLine[];
  requiredCount?: number;
}
interface StepInput {
  buildables?: BuildableInput[];
}

/** Outcome of plan-reference resolution: ok, or a rejection naming what failed. */
export type EnrichResult = { ok: true } | { ok: false; unresolved: string[]; message: string };

/** The kinds of game-data name a plan carries, each resolved against its own MCP tools. */
type RefKind = 'building' | 'recipe' | 'item' | 'schematic';

interface KindConfig {
  /** Exact-match resolver tool (returns `isError` on a miss). */
  getTool: string;
  /** Key the resolver wraps its entity under on success. */
  responseKey: string;
  /** Discovery tool backing best-match suggestions. */
  listTool: string;
  /** Key the discovery tool wraps its list under. */
  listKey: string;
  /** Human label for the rejection message (singular). */
  label: string;
}

/**
 * How each name kind resolves. `building` covers both buildables and recipe
 * `machineName`s (a machine is a building); resources fold into items, so
 * `resourceName` resolves via `get_item`. Slice 1 (#222) added `list_items` /
 * `list_recipes` and `search` on `list_schematics` to source suggestions here.
 */
const KIND: Record<RefKind, KindConfig> = {
  building: {
    getTool: 'get_building',
    responseKey: 'building',
    listTool: 'list_buildings',
    listKey: 'buildings',
    label: 'building',
  },
  recipe: {
    getTool: 'get_recipe',
    responseKey: 'recipe',
    listTool: 'list_recipes',
    listKey: 'recipes',
    label: 'recipe',
  },
  item: {
    getTool: 'get_item',
    responseKey: 'item',
    listTool: 'list_items',
    listKey: 'items',
    label: 'item',
  },
  schematic: {
    getTool: 'get_schematic',
    responseKey: 'schematic',
    listTool: 'list_schematics',
    listKey: 'schematics',
    label: 'schematic',
  },
};

const KIND_ORDER: RefKind[] = ['building', 'recipe', 'item', 'schematic'];

/** The name-bearing plan fields resolution walks. All optional (revise sends a partial plan). */
interface PlanInput {
  buildSteps?: StepInput[];
  recipes?: {
    machineName?: string;
    recipeName?: string;
    inputItems?: { itemName?: string }[];
    outputItems?: { itemName?: string }[];
  }[];
  expectedOutputs?: { kind: string; item?: string; schematic?: string; megawatts?: number }[];
  resourceNodes?: { resourceName?: string }[];
}

/**
 * Resolves every game-data name a plan carries — buildables, recipe machine/recipe/item
 * names, expected-output items and unlock schematics, and resource-node names — against
 * the sf-mcp resolver tools. Buildables are additionally enriched with their per-unit
 * `buildCost` + class in place. If ANY name fails to resolve, returns a rejection whose
 * message groups each bad name by kind with best-match suggestions and a pointer to the
 * relevant `list_*` tool. The caller must NOT persist on a rejection, so a wrong name is
 * corrected up front rather than silently degrading the plan (#220 for buildables, #222
 * for the rest).
 */
export async function resolvePlanReferences(
  plan: PlanInput,
  mcp: McpGateway,
): Promise<EnrichResult> {
  const misses: Record<RefKind, Set<string>> = {
    building: new Set(),
    recipe: new Set(),
    item: new Set(),
    schematic: new Set(),
  };

  // Buildables: enrich buildCost/class in place, collecting misses under `building`.
  await enrichBuildables(plan, mcp, (name) => misses.building.add(name));

  // Every other name field, existence-only, deduplicated per kind.
  const toResolve: Record<RefKind, Set<string>> = {
    building: new Set(),
    recipe: new Set(),
    item: new Set(),
    schematic: new Set(),
  };
  for (const recipe of plan.recipes ?? []) {
    if (recipe.machineName !== undefined) {
      toResolve.building.add(recipe.machineName);
    }
    if (recipe.recipeName !== undefined) {
      toResolve.recipe.add(recipe.recipeName);
    }
    for (const line of [...(recipe.inputItems ?? []), ...(recipe.outputItems ?? [])]) {
      if (line.itemName !== undefined) {
        toResolve.item.add(line.itemName);
      }
    }
  }
  for (const output of plan.expectedOutputs ?? []) {
    if (output.kind === 'item' && output.item !== undefined) {
      toResolve.item.add(output.item);
    }
    if (output.kind === 'unlock' && output.schematic !== undefined) {
      toResolve.schematic.add(output.schematic);
    }
  }
  for (const node of plan.resourceNodes ?? []) {
    if (node.resourceName !== undefined) {
      toResolve.item.add(node.resourceName);
    }
  }

  for (const kind of KIND_ORDER) {
    for (const name of toResolve[kind]) {
      if (!(await nameResolves(name, KIND[kind], mcp))) {
        misses[kind].add(name);
      }
    }
  }

  return buildEnrichResult(misses, mcp);
}

/**
 * Resolves every DISTINCT buildable name to its class + per-unit `buildCost` via
 * `get_building`, mutating `buildSteps` in place, and reports each unresolved name via
 * `onMiss` (its buildCost is cleared so a wrong name never ships a stale cost).
 */
async function enrichBuildables(
  plan: { buildSteps?: StepInput[] },
  mcp: McpGateway,
  onMiss: (name: string) => void,
): Promise<void> {
  const steps = plan.buildSteps ?? [];
  const names = new Set<string>();
  for (const step of steps) {
    for (const b of step.buildables ?? []) {
      names.add(b.name);
    }
  }
  if (names.size === 0) {
    return;
  }

  const resolved = new Map<string, ResolvedBuild | null>();
  for (const name of names) {
    resolved.set(name, await resolveBuild(name, mcp));
  }

  for (const step of steps) {
    for (const b of step.buildables ?? []) {
      const r = resolved.get(b.name);
      if (r === null || r === undefined) {
        b.buildCost = [];
        onMiss(b.name);
      } else {
        b.buildCost = r.buildCost;
        if (r.buildingClass !== undefined) {
          b.buildingClass = r.buildingClass;
        }
      }
    }
  }
}

/** Whether a name resolves exactly via its kind's `get_*` tool (non-error, entity present). */
async function nameResolves(name: string, cfg: KindConfig, mcp: McpGateway): Promise<boolean> {
  try {
    const res = await mcp.callTool(cfg.getTool, { name });
    if (res.isError) {
      return false;
    }
    const parsed = JSON.parse(res.text) as Record<string, unknown>;
    return parsed[cfg.responseKey] !== undefined;
  } catch {
    return false;
  }
}

/** A compact `{ className, displayName }` entry as returned by a `list_*` discovery tool. */
interface NameEntry {
  className: string;
  displayName: string;
}

/** Fetches a kind's full name list once (for suggestions); [] if the tool is unavailable. */
async function fetchNames(cfg: KindConfig, mcp: McpGateway): Promise<NameEntry[]> {
  try {
    const res = await mcp.callTool(cfg.listTool, {});
    if (res.isError) {
      return [];
    }
    const parsed = JSON.parse(res.text) as Record<string, NameEntry[] | undefined>;
    return parsed[cfg.listKey] ?? [];
  } catch {
    return [];
  }
}

/** Significant lower-case tokens of a name (drops single-character noise like "T"). */
function tokenise(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}

/**
 * Up to five best-match display names for a miss: the highest token-overlap tier against
 * a kind's name list. Advisory only — the model must re-issue with an exact name, so this
 * surfaces candidates without ever resolving on the model's behalf.
 */
function suggestFor(name: string, candidates: NameEntry[]): string[] {
  const tokens = tokenise(name);
  if (tokens.length === 0 || candidates.length === 0) {
    return [];
  }
  let best = 0;
  const scored = candidates.map((c) => {
    const haystack = `${c.displayName} ${c.className}`.toLowerCase();
    const score = tokens.reduce((n, t) => (haystack.includes(t) ? n + 1 : n), 0);
    best = Math.max(best, score);
    return { displayName: c.displayName, score };
  });
  if (best === 0) {
    return [];
  }
  return scored
    .filter((s) => s.score === best)
    .map((s) => s.displayName)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 5);
}

/**
 * Turns per-kind misses into an `EnrichResult`: ok if none, otherwise a rejection whose
 * message groups bad names by kind (each with suggestions + a pointer to the kind's
 * `list_*` tool) and whose `unresolved` is the flat list of bad names.
 */
async function buildEnrichResult(
  misses: Record<RefKind, Set<string>>,
  mcp: McpGateway,
): Promise<EnrichResult> {
  const unresolved: string[] = [];
  const sections: string[] = [];
  for (const kind of KIND_ORDER) {
    const names = misses[kind];
    if (names.size === 0) {
      continue;
    }
    const cfg = KIND[kind];
    const candidates = await fetchNames(cfg, mcp);
    const lines = [...names].map((name) => {
      unresolved.push(name);
      const suggestions = suggestFor(name, candidates);
      return suggestions.length > 0
        ? `  • "${name}" → did you mean: ${suggestions.join(', ')}?`
        : `  • "${name}" → no close match found.`;
    });
    const heading = `${cfg.label[0]!.toUpperCase()}${cfg.label.slice(1)} names (confirm with ${cfg.listTool}):`;
    sections.push(`${heading}\n${lines.join('\n')}`);
  }
  if (unresolved.length === 0) {
    return { ok: true };
  }
  return {
    ok: false,
    unresolved,
    message:
      `Work order not created: these names don't match the game data — correct them and ` +
      `retry with the exact in-game display names.\n${sections.join('\n')}`,
  };
}

/** Resolves one buildable name to its class + per-unit build cost via `get_building`. */
async function resolveBuild(name: string, mcp: McpGateway): Promise<ResolvedBuild | null> {
  try {
    const res = await mcp.callTool('get_building', { name });
    if (res.isError) {
      return null;
    }
    const parsed = JSON.parse(res.text) as {
      building?: {
        className?: string;
        buildCost?: { item?: string; itemClassName?: string; amount?: number }[];
      };
    };
    const building = parsed.building;
    if (building === undefined) {
      return null;
    }
    const buildCost: BuildCostLine[] = (building.buildCost ?? []).map((c) => ({
      itemName: c.item ?? c.itemClassName ?? 'Unknown',
      ...(c.itemClassName !== undefined ? { itemClass: c.itemClassName } : {}),
      amount: c.amount ?? 0,
    }));
    return {
      buildCost,
      ...(building.className !== undefined ? { buildingClass: building.className } : {}),
    };
  } catch {
    return null;
  }
}

// --- Quantity verification: power output (#223) ----------------------------

/** Outcome of a quantity check: ok, or a rejection explaining the mismatch. */
export type PowerCheckResult = { ok: true } | { ok: false; message: string };

/** A fixed-output power generator: class → display name + per-unit MW. */
interface FixedGenerator {
  displayName: string;
  powerProduction: number;
}

/**
 * Fetches the fixed-output power generators keyed by class name via
 * `list_power_generators`. Excludes variable-output generators (Geothermal), whose
 * output is geyser-dependent and so can't be verified from a count. [] if unavailable.
 */
async function fetchPowerGenerators(mcp: McpGateway): Promise<Map<string, FixedGenerator>> {
  const map = new Map<string, FixedGenerator>();
  try {
    const res = await mcp.callTool('list_power_generators', {});
    if (res.isError) {
      return map;
    }
    const parsed = JSON.parse(res.text) as {
      generators?: {
        className?: string;
        displayName?: string;
        powerProduction?: number;
        variablePowerProduction?: boolean;
      }[];
    };
    for (const g of parsed.generators ?? []) {
      if (
        g.className !== undefined &&
        typeof g.powerProduction === 'number' &&
        g.variablePowerProduction !== true
      ) {
        map.set(g.className, {
          displayName: g.displayName ?? g.className,
          powerProduction: g.powerProduction,
        });
      }
    }
  } catch {
    return map;
  }
  return map;
}

/** Formats an MW figure without noisy trailing decimals. */
function fmtMW(mw: number): string {
  return Number.isInteger(mw) ? String(mw) : mw.toFixed(2);
}

/**
 * Verifies a plan's declared power output against what its generator buildables actually
 * produce. Power is deterministic — generators can't be overclocked, so `powerProduction`
 * is fixed — making this the one quantitative check safe to hard-reject (#223). Rejects
 * only UNDER-provision (the plant can't produce its claimed MW); over-provisioning is
 * legitimate headroom. Skips (ok) whenever it can't see BOTH a power output and generator
 * buildables in the plan — so partial revises are never falsely rejected.
 */
export async function verifyPlanPower(plan: PlanInput, mcp: McpGateway): Promise<PowerCheckResult> {
  let declaredMW = 0;
  let hasPowerOutput = false;
  for (const output of plan.expectedOutputs ?? []) {
    if (output.kind === 'power' && typeof output.megawatts === 'number') {
      declaredMW += output.megawatts;
      hasPowerOutput = true;
    }
  }
  if (!hasPowerOutput || declaredMW <= 0) {
    return { ok: true };
  }

  const generators = await fetchPowerGenerators(mcp);
  if (generators.size === 0) {
    return { ok: true };
  }

  // Aggregate generator buildables by type (a generator may appear across several steps).
  const byType = new Map<string, { displayName: string; powerProduction: number; count: number }>();
  for (const step of plan.buildSteps ?? []) {
    for (const b of step.buildables ?? []) {
      if (b.buildingClass === undefined) {
        continue;
      }
      const gen = generators.get(b.buildingClass);
      if (gen === undefined) {
        continue;
      }
      const entry = byType.get(b.buildingClass) ?? { ...gen, count: 0 };
      entry.count += b.requiredCount ?? 0;
      byType.set(b.buildingClass, entry);
    }
  }
  const types = [...byType.values()];
  if (types.length === 0) {
    return { ok: true };
  }

  const actualMW = types.reduce((sum, t) => sum + t.count * t.powerProduction, 0);
  if (actualMW + 1e-6 >= declaredMW) {
    return { ok: true };
  }

  const built = types.map((t) => `${t.count}× ${t.displayName}`).join(' + ');
  const base =
    `Work order not created: it claims ${fmtMW(declaredMW)} MW but its ${built} ` +
    `produce ${fmtMW(actualMW)} MW`;
  if (types.length === 1) {
    const t = types[0]!;
    const needed = Math.ceil(declaredMW / t.powerProduction);
    return {
      ok: false,
      message:
        `${base} (${fmtMW(t.powerProduction)} MW each). For ${fmtMW(declaredMW)} MW you need ` +
        `${needed}× ${t.displayName}. Adjust the count or the target and retry.`,
    };
  }
  return {
    ok: false,
    message:
      `${base}. Increase generator counts (or lower the target) so total output is at ` +
      `least ${fmtMW(declaredMW)} MW, then retry.`,
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
