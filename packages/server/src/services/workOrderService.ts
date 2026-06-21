import type { PrismaClient, WorkOrder as WorkOrderRow } from '@prisma/client';

import type {
  ExpectedOutput,
  LineItem,
  PioneerFeedback,
  WorkOrder,
  WorkOrderStatus,
} from '../types.js';

/** Fields the foreman (or client) supplies when issuing a new work order. */
export interface CreateWorkOrderInput {
  title: string;
  objective: string;
  tier: number;
  estimatedDuration: string;
  requiredItems: LineItem[];
  buildSteps: string[];
  expectedOutput: ExpectedOutput[];
  notes?: string;
}

/** Fields that may be patched on an existing order (close-out, feedback). */
export interface UpdateWorkOrderInput {
  status?: WorkOrderStatus;
  notes?: string;
  adaptations?: string[];
  completionSummary?: string;
  pioneerFeedback?: PioneerFeedback;
}

/**
 * Persistence and lifecycle for work orders. Enforces the two SPEC.md
 * invariants: per-session monotonic sequence numbers (rendered WO-001, …) and
 * at most one `active` order per session. Issuing a new order while one is
 * active is a normal operation — the existing active order is abandoned, not
 * rejected; the foreman narrates that transition in chat.
 */
export class WorkOrderService {
  public constructor(private readonly prisma: PrismaClient) {}

  /**
   * Creates a new active work order. Any currently-active order for the session
   * is transitioned to `abandoned` first. The whole operation runs in a
   * transaction so the single-active invariant cannot be violated by a race.
   */
  public async create(
    sessionId: string,
    input: CreateWorkOrderInput,
    version: string,
  ): Promise<WorkOrder> {
    const row = await this.prisma.$transaction(async (tx): Promise<WorkOrderRow> => {
      await tx.workOrder.updateMany({
        where: { sessionId, status: 'active' },
        data: { status: 'abandoned', completedAt: new Date() },
      });

      const aggregate = await tx.workOrder.aggregate({
        where: { sessionId },
        _max: { sequenceNumber: true },
      });
      const nextSequence = (aggregate._max.sequenceNumber ?? 0) + 1;

      return tx.workOrder.create({
        data: {
          sessionId,
          sequenceNumber: nextSequence,
          status: 'active',
          version,
          title: input.title,
          objective: input.objective,
          tier: input.tier,
          estimatedDuration: input.estimatedDuration,
          requiredItems: JSON.stringify(input.requiredItems),
          buildSteps: JSON.stringify(input.buildSteps),
          expectedOutput: JSON.stringify(input.expectedOutput),
          notes: input.notes ?? null,
        },
      });
    });
    return rowToWorkOrder(row);
  }

  /** All work orders for a session, oldest first (history order). */
  public async list(sessionId: string): Promise<WorkOrder[]> {
    const rows = await this.prisma.workOrder.findMany({
      where: { sessionId },
      orderBy: { sequenceNumber: 'asc' },
    });
    return rows.map(rowToWorkOrder);
  }

  /** The session's current active order, or undefined if none. */
  public async getActive(sessionId: string): Promise<WorkOrder | undefined> {
    const row = await this.prisma.workOrder.findFirst({
      where: { sessionId, status: 'active' },
    });
    return row === null ? undefined : rowToWorkOrder(row);
  }

  /** A single order by id, scoped to its session. */
  public async get(sessionId: string, id: string): Promise<WorkOrder | undefined> {
    const row = await this.prisma.workOrder.findFirst({ where: { id, sessionId } });
    return row === null ? undefined : rowToWorkOrder(row);
  }

  /**
   * Patches an existing order — used for close-out (complete/abandon, summary,
   * adaptations, pioneer feedback) by both the REST route and the foreman's
   * `complete_work_order` tool. Moving to a terminal status stamps `completedAt`.
   */
  public async update(
    sessionId: string,
    id: string,
    patch: UpdateWorkOrderInput,
  ): Promise<WorkOrder | undefined> {
    const existing = await this.prisma.workOrder.findFirst({ where: { id, sessionId } });
    if (existing === null) {
      return undefined;
    }

    const movingToTerminal =
      patch.status !== undefined && patch.status !== 'active' && existing.status === 'active';

    const row = await this.prisma.workOrder.update({
      where: { id },
      data: {
        status: patch.status ?? existing.status,
        completedAt: movingToTerminal ? new Date() : existing.completedAt,
        notes: patch.notes ?? existing.notes,
        adaptations:
          patch.adaptations !== undefined
            ? JSON.stringify(patch.adaptations)
            : existing.adaptations,
        completionSummary: patch.completionSummary ?? existing.completionSummary,
        pioneerFeedback:
          patch.pioneerFeedback !== undefined
            ? JSON.stringify(patch.pioneerFeedback)
            : existing.pioneerFeedback,
      },
    });
    return rowToWorkOrder(row);
  }

  /**
   * Closes out the session's active order as completed. Convenience for the
   * foreman's `complete_work_order` tool. Returns undefined if there is no
   * active order to close.
   */
  public async completeActive(
    sessionId: string,
    patch: Omit<UpdateWorkOrderInput, 'status'>,
  ): Promise<WorkOrder | undefined> {
    const active = await this.prisma.workOrder.findFirst({
      where: { sessionId, status: 'active' },
    });
    if (active === null) {
      return undefined;
    }
    return this.update(sessionId, active.id, { ...patch, status: 'completed' });
  }
}

/** Renders a sequence number as the human-readable WO-001 form. */
export function formatWorkOrderLabel(sequenceNumber: number): string {
  return `WO-${String(sequenceNumber).padStart(3, '0')}`;
}

/** Maps a database row to the API WorkOrder shape, decoding JSON-encoded fields. */
export function rowToWorkOrder(row: WorkOrderRow): WorkOrder {
  const order: WorkOrder = {
    id: row.id,
    sequenceNumber: row.sequenceNumber,
    status: row.status as WorkOrderStatus,
    version: row.version,
    issuedAt: row.issuedAt.toISOString(),
    title: row.title,
    objective: row.objective,
    tier: row.tier,
    estimatedDuration: row.estimatedDuration,
    requiredItems: parseJson<LineItem[]>(row.requiredItems, []),
    buildSteps: parseJson<string[]>(row.buildSteps, []),
    expectedOutput: parseJson<ExpectedOutput[]>(row.expectedOutput, []),
  };
  if (row.completedAt !== null) {
    order.completedAt = row.completedAt.toISOString();
  }
  if (row.notes !== null) {
    order.notes = row.notes;
  }
  if (row.adaptations !== null) {
    order.adaptations = parseJson<string[]>(row.adaptations, []);
  }
  if (row.completionSummary !== null) {
    order.completionSummary = row.completionSummary;
  }
  if (row.pioneerFeedback !== null) {
    const feedback = parseJson<PioneerFeedback | undefined>(row.pioneerFeedback, undefined);
    if (feedback !== undefined) {
      order.pioneerFeedback = feedback;
    }
  }
  return order;
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
