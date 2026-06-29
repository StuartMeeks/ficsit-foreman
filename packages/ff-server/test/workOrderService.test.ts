import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  WorkOrderService,
  formatWorkOrderLabel,
  type CreateWorkOrderInput,
} from '../src/services/workOrderService.js';
import { createTestDb, createTestPlaythrough, type TestDb } from './helpers.js';

let db: TestDb;
let service: WorkOrderService;

async function seedPlaythrough(): Promise<string> {
  return createTestPlaythrough(db.prisma);
}

function sampleInput(title: string): CreateWorkOrderInput {
  return {
    title,
    goal: 'Stand up an iron plate line.',
    objective: 'Smelt and press to 20 plates/min.',
    buildSteps: [
      {
        title: 'Place constructors',
        buildables: [
          {
            name: 'Constructor',
            requiredCount: 2,
            buildCost: [
              {
                itemName: 'Reinforced Iron Plate',
                itemClass: 'Desc_IronPlateReinforced_C',
                amount: 2,
              },
            ],
          },
        ],
      },
      { title: 'Connect belts' },
    ],
    expectedOutputs: [{ kind: 'item', item: 'Iron Plate', perMinute: 20 }],
  };
}

beforeAll(async () => {
  db = await createTestDb();
  service = new WorkOrderService(db.prisma);
});

afterAll(async () => {
  await db.cleanup();
});

describe('WorkOrderService — creation & numbering', () => {
  it('numbers orders sequentially per playthrough', async () => {
    const playthrough = await seedPlaythrough();
    const first = await service.create(playthrough, sampleInput('First'), '1.0.0');
    const second = await service.create(playthrough, sampleInput('Second'), '1.0.0');
    expect(first.sequenceNumber).toBe(1);
    expect(second.sequenceNumber).toBe(2);
    expect(formatWorkOrderLabel(second.sequenceNumber)).toBe('WO-002');
  });

  it('issues orders in the `new` state and does NOT supersede the previous one', async () => {
    const playthrough = await seedPlaythrough();
    const first = await service.create(playthrough, sampleInput('First'), '1.0.0');
    await service.create(playthrough, sampleInput('Second'), '1.0.0');

    const reloadedFirst = await service.get(playthrough, first.id);
    expect(reloadedFirst?.state).toBe('new');
    expect(await service.getActive(playthrough)).toBeUndefined();
    expect(await service.list(playthrough)).toHaveLength(2);
  });

  it('writes an initial revision and a created audit event', async () => {
    const playthrough = await seedPlaythrough();
    const order = await service.create(playthrough, sampleInput('Audited'), '1.0.0');
    const revisions = await service.getRevisions(playthrough, order.id);
    const audit = await service.getAuditTrail(playthrough, order.id);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]?.revisionNumber).toBe(1);
    expect(audit.map((e) => e.eventType)).toContain('work_order_created');
  });

  it('round-trips JSON-encoded fields with generated stable ids', async () => {
    const playthrough = await seedPlaythrough();
    const created = await service.create(playthrough, sampleInput('Round trip'), '1.2.3.0');
    const fetched = await service.get(playthrough, created.id);
    const buildable = fetched?.buildSteps[0]?.buildables[0];
    expect(buildable?.name).toBe('Constructor');
    expect(buildable?.id).toBeTruthy();
    expect(buildable?.builtCount).toBe(0);
    expect(buildable?.buildCost[0]?.itemName).toBe('Reinforced Iron Plate');
    expect(fetched?.buildSteps).toHaveLength(2);
    expect(fetched?.buildSteps[1]?.buildables).toEqual([]); // step with no buildables
    expect(fetched?.expectedOutputs[0]).toEqual({
      kind: 'item',
      item: 'Iron Plate',
      perMinute: 20,
    });
    expect(fetched?.version).toBe('1.2.3.0');
  });

  it('does not flag the initial issue as an unacknowledged revision', async () => {
    const playthrough = await seedPlaythrough();
    const order = await service.create(playthrough, sampleInput('Fresh'), '1.0.0');
    expect(order.currentRevision).toBe(1);
    expect(order.hasUnacknowledgedRevision).toBe(false);
  });

  it('getCurrent finds a new (unstarted) order, and prefers the active one', async () => {
    const playthrough = await seedPlaythrough();
    const a = await service.create(playthrough, sampleInput('A'), '1.0.0');
    // Nothing active yet — getCurrent still resolves the freshly-issued order.
    expect((await service.getCurrent(playthrough))?.id).toBe(a.id);
    const b = await service.create(playthrough, sampleInput('B'), '1.0.0');
    await service.transition(playthrough, b.id, 'Start', 'Pioneer');
    expect((await service.getCurrent(playthrough))?.id).toBe(b.id);
  });
});

describe('WorkOrderService — transitions', () => {
  it('starts then completes an order (Pioneer)', async () => {
    const playthrough = await seedPlaythrough();
    const order = await service.create(playthrough, sampleInput('Lifecycle'), '1.0.0');

    const started = await service.transition(playthrough, order.id, 'Start', 'Pioneer');
    expect(started.ok && started.order.state).toBe('active');
    expect((await service.getActive(playthrough))?.id).toBe(order.id);

    const completed = await service.transition(playthrough, order.id, 'Complete', 'Pioneer');
    expect(completed.ok && completed.order.state).toBe('completed');
    expect(completed.ok && completed.order.completedAt).toBeTruthy();
    expect(await service.getActive(playthrough)).toBeUndefined();
  });

  it('forbids the Foreman from completing (Option A)', async () => {
    const playthrough = await seedPlaythrough();
    const order = await service.create(playthrough, sampleInput('No foreman complete'), '1.0.0');
    await service.transition(playthrough, order.id, 'Start', 'Pioneer');
    const result = await service.transition(playthrough, order.id, 'Complete', 'Foreman');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('actor');
  });

  it('enforces a single active order per playthrough', async () => {
    const playthrough = await seedPlaythrough();
    const a = await service.create(playthrough, sampleInput('A'), '1.0.0');
    const b = await service.create(playthrough, sampleInput('B'), '1.0.0');
    await service.transition(playthrough, a.id, 'Start', 'Pioneer');
    const result = await service.transition(playthrough, b.id, 'Start', 'Pioneer');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('conflict');
  });

  it('locks terminal orders against further transitions and plan edits', async () => {
    const playthrough = await seedPlaythrough();
    const order = await service.create(playthrough, sampleInput('Terminal'), '1.0.0');
    await service.transition(playthrough, order.id, 'Start', 'Pioneer');
    await service.transition(playthrough, order.id, 'Complete', 'Pioneer');

    const reTransition = await service.transition(playthrough, order.id, 'Pause', 'Pioneer');
    expect(reTransition.ok).toBe(false);
    expect(!reTransition.ok && reTransition.reason).toBe('terminal');

    const rePlan = await service.updatePlan(playthrough, order.id, { goal: 'changed' });
    expect(rePlan.ok).toBe(false);
    expect(!rePlan.ok && rePlan.reason).toBe('terminal');
  });

  it('requires reason fields for Block, Cancel, and ForceComplete', async () => {
    const playthrough = await seedPlaythrough();
    const order = await service.create(playthrough, sampleInput('Reasons'), '1.0.0');
    await service.transition(playthrough, order.id, 'Start', 'Pioneer');

    const block = await service.transition(playthrough, order.id, 'Block', 'Foreman', {});
    expect(!block.ok && block.reason).toBe('requirement');

    const force = await service.transition(playthrough, order.id, 'ForceComplete', 'Pioneer', {});
    expect(!force.ok && force.reason).toBe('requirement');

    const forceOk = await service.transition(playthrough, order.id, 'ForceComplete', 'Pioneer', {
      forceCompletionReason: 'Out of time.',
      incompleteItemSummary: '1 of 2 machines built.',
    });
    expect(forceOk.ok && forceOk.order.state).toBe('completed');
  });
});

describe('WorkOrderService — plan revisions vs execution', () => {
  it('preserves per-buildable built count when the plan is revised (merge-forward)', async () => {
    const playthrough = await seedPlaythrough();
    const order = await service.create(playthrough, sampleInput('Merge'), '1.0.0');
    const stepId = order.buildSteps[0]!.id;
    const buildableId = order.buildSteps[0]!.buildables[0]!.id;

    await service.setBuildableBuiltCount(playthrough, order.id, stepId, buildableId, 1);

    // Revise: keep the existing step + buildable (by id), add a new buildable.
    const revised = await service.updatePlan(playthrough, order.id, {
      buildSteps: [
        {
          id: stepId,
          title: 'Place constructors',
          buildables: [
            { id: buildableId, name: 'Constructor', requiredCount: 2 },
            { name: 'Conveyor Splitter', requiredCount: 2 },
          ],
        },
      ],
    });
    expect(revised.ok).toBe(true);
    if (!revised.ok) {
      return;
    }
    expect(revised.order.currentRevision).toBe(2);
    const buildables = revised.order.buildSteps[0]!.buildables;
    expect(buildables.find((b) => b.id === buildableId)?.builtCount).toBe(1);
    expect(buildables.find((b) => b.name === 'Conveyor Splitter')?.builtCount).toBe(0);
  });

  it('merge-forward preserves step checked + buildable built counts by stable id', async () => {
    const playthrough = await seedPlaythrough();
    const order = await service.create(playthrough, sampleInput('Merge all'), '1.0.0');
    const stepId = order.buildSteps[0]!.id;
    const buildableId = order.buildSteps[0]!.buildables[0]!.id;

    await service.setStepChecked(playthrough, order.id, stepId, true);
    await service.setBuildableBuiltCount(playthrough, order.id, stepId, buildableId, 2);

    // Revise: keep the step + its buildable (by id), add a new buildable + a new step.
    const revised = await service.updatePlan(playthrough, order.id, {
      buildSteps: [
        {
          id: stepId,
          title: 'Place constructors',
          buildables: [
            { id: buildableId, name: 'Constructor', requiredCount: 2 },
            { name: 'Smelter', requiredCount: 4 },
          ],
        },
        { title: 'Wire power' },
      ],
    });
    expect(revised.ok).toBe(true);
    if (!revised.ok) {
      return;
    }
    const o = revised.order;
    // Surviving ids keep their progress; brand-new items default to unchecked / 0.
    expect(o.buildSteps.find((s) => s.id === stepId)?.checked).toBe(true);
    expect(o.buildSteps.find((s) => s.title === 'Wire power')?.checked).toBe(false);
    const survivingStep = o.buildSteps.find((s) => s.id === stepId)!;
    expect(survivingStep.buildables.find((b) => b.id === buildableId)?.builtCount).toBe(2);
    expect(survivingStep.buildables.find((b) => b.name === 'Smelter')?.builtCount).toBe(0);
  });

  it('reverts the plan only, leaving execution progress intact', async () => {
    const playthrough = await seedPlaythrough();
    const order = await service.create(playthrough, sampleInput('Revert'), '1.0.0');
    const stepId = order.buildSteps[0]!.id;

    await service.setStepChecked(playthrough, order.id, stepId, true);
    await service.logHours(playthrough, order.id, 1.5);
    await service.updatePlan(playthrough, order.id, { goal: 'Revised goal' });

    const reverted = await service.revertToRevision(playthrough, order.id, 1, 'Pioneer');
    expect(reverted.ok).toBe(true);
    if (!reverted.ok) {
      return;
    }
    // Plan restored to revision 1...
    expect(reverted.order.goal).toBe('Stand up an iron plate line.');
    expect(reverted.order.currentRevision).toBe(3);
    // ...but execution progress survives.
    expect(reverted.order.buildSteps.find((s) => s.id === stepId)?.checked).toBe(true);
    expect(reverted.order.hoursLogged).toBe(1.5);

    const audit = await service.getAuditTrail(playthrough, order.id);
    expect(audit.map((e) => e.eventType)).toContain('reverted_to_revision');
  });

  it('tracks acknowledgement of revisions', async () => {
    const playthrough = await seedPlaythrough();
    const order = await service.create(playthrough, sampleInput('Ack'), '1.0.0');
    const revised = await service.updatePlan(playthrough, order.id, { goal: 'New goal' });
    expect(revised.ok && revised.order.hasUnacknowledgedRevision).toBe(true);

    const acked = await service.acknowledgeRevision(playthrough, order.id);
    expect(acked.ok && acked.order.hasUnacknowledgedRevision).toBe(false);
  });

  it('emits specific audit events for recipe and build-plan changes', async () => {
    const playthrough = await seedPlaythrough();
    const order = await service.create(playthrough, sampleInput('Specific audit'), '1.0.0');

    await service.updatePlan(playthrough, order.id, {
      recipes: [{ machineName: 'Constructor', recipeName: 'Alternate: Steel Screw' }],
    });
    await service.updatePlan(playthrough, order.id, {
      buildSteps: [
        { title: 'Place constructors', buildables: [{ name: 'Constructor', requiredCount: 4 }] },
      ],
    });

    const types = (await service.getAuditTrail(playthrough, order.id)).map((e) => e.eventType);
    expect(types).toContain('recipe_choice_changed');
    expect(types).toContain('build_plan_adapted');
  });

  it('records execution mutations as audit events, not revisions', async () => {
    const playthrough = await seedPlaythrough();
    const order = await service.create(playthrough, sampleInput('Exec audit'), '1.0.0');
    const stepId = order.buildSteps[0]!.id;
    const buildableId = order.buildSteps[0]!.buildables[0]!.id;

    await service.setBuildableBuiltCount(playthrough, order.id, stepId, buildableId, 1);
    const revisions = await service.getRevisions(playthrough, order.id);
    const audit = await service.getAuditTrail(playthrough, order.id);
    // Still only the initial revision — execution does not snapshot.
    expect(revisions).toHaveLength(1);
    expect(audit.map((e) => e.eventType)).toContain('buildable_built_count_changed');
  });
});

describe('WorkOrderService — completion proposal (Option A)', () => {
  it('records a completion_proposed audit event without changing state', async () => {
    const playthrough = await seedPlaythrough();
    const order = await service.create(playthrough, sampleInput('Propose'), '1.0.0');
    await service.transition(playthrough, order.id, 'Start', 'Pioneer');

    const outcome = await service.proposeCompletion(playthrough, order.id, 'Looks finished.');
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    // Proposing never completes — only the pioneer may (Option A).
    expect(outcome.order.state).toBe('active');

    const audit = await service.getAuditTrail(playthrough, order.id);
    const last = audit[audit.length - 1];
    expect(last?.eventType).toBe('completion_proposed');
    expect(last?.actor).toBe('Foreman');
    expect(last?.note).toBe('Looks finished.');
  });

  it('refuses to propose completion of a new (unstarted) order', async () => {
    const playthrough = await seedPlaythrough();
    const order = await service.create(playthrough, sampleInput('Not started'), '1.0.0');
    const outcome = await service.proposeCompletion(playthrough, order.id, 'looks done');
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.reason).toBe('state');
    expect(!outcome.ok && outcome.message).toMatch(/started/i);
  });

  it('refuses to propose completion of a terminal order', async () => {
    const playthrough = await seedPlaythrough();
    const order = await service.create(playthrough, sampleInput('Terminal propose'), '1.0.0');
    await service.transition(playthrough, order.id, 'Start', 'Pioneer');
    await service.transition(playthrough, order.id, 'Complete', 'Pioneer');

    const outcome = await service.proposeCompletion(playthrough, order.id, 'too late');
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.reason).toBe('terminal');
  });
});

describe('WorkOrderService — tier, notes & revision diff', () => {
  it('round-trips tier and foreman notes, and preserves them across a revert', async () => {
    const playthrough = await seedPlaythrough();
    const order = await service.create(
      playthrough,
      { ...sampleInput('Tiered'), tier: 3, notes: ['Leave 2-unit gaps.', 'Run coal belts first.'] },
      '1.0.0',
    );
    expect(order.tier).toBe(3);
    expect(order.notes).toEqual(['Leave 2-unit gaps.', 'Run coal belts first.']);

    await service.updatePlan(playthrough, order.id, { tier: 4, goal: 'Bigger plant' });
    const reverted = await service.revertToRevision(playthrough, order.id, 1, 'Pioneer');
    expect(reverted.ok && reverted.order.tier).toBe(3);
    expect(reverted.ok && reverted.order.notes).toEqual([
      'Leave 2-unit gaps.',
      'Run coal belts first.',
    ]);
  });

  it('computes a field-level diff between revisions', async () => {
    const playthrough = await seedPlaythrough();
    const order = await service.create(
      playthrough,
      { ...sampleInput('Diff me'), tier: 2 },
      '1.0.0',
    );
    await service.updatePlan(playthrough, order.id, {
      tier: 3,
      goal: 'Revised goal',
      buildSteps: [
        { title: 'Place constructors', buildables: [{ name: 'Constructor', requiredCount: 4 }] },
      ],
    });

    const diff = await service.diffRevisions(playthrough, order.id);
    expect(diff?.fromRevision).toBe(1);
    expect(diff?.toRevision).toBe(2);
    const fields = (diff?.changes ?? []).map((c) => c.field);
    expect(fields).toContain('goal');
    expect(fields).toContain('tier');
    expect(fields).toContain('buildSteps');
    const tierChange = diff?.changes.find((c) => c.field === 'tier');
    expect(tierChange?.before).toBe(2);
    expect(tierChange?.after).toBe(3);
  });
});

describe('WorkOrderService — parent/child', () => {
  it('auto-unblocks a blocked parent when its child completes', async () => {
    const playthrough = await seedPlaythrough();
    const parent = await service.create(playthrough, sampleInput('Parent'), '1.0.0');
    await service.transition(playthrough, parent.id, 'Start', 'Pioneer');
    await service.transition(playthrough, parent.id, 'Block', 'Foreman', {
      blockedReason: 'Recipe locked.',
      blockedResolutionHint: 'Research it.',
    });

    const child = await service.create(
      playthrough,
      {
        ...sampleInput('Child'),
        parentWorkOrderId: parent.id,
        relationshipToParent: 'mam_research',
      },
      '1.0.0',
    );
    await service.transition(playthrough, child.id, 'Start', 'Pioneer');
    await service.transition(playthrough, child.id, 'Complete', 'Pioneer');

    const reloadedParent = await service.get(playthrough, parent.id);
    expect(reloadedParent?.state).toBe('active');
    expect(reloadedParent?.blockedReason).toBeUndefined();
    expect(reloadedParent?.childWorkOrderIds).toContain(child.id);

    const parentAudit = await service.getAuditTrail(playthrough, parent.id);
    const types = parentAudit.map((e) => e.eventType);
    expect(types).toContain('child_work_order_created');
    expect(types).toContain('child_work_order_completed');
    expect(types).toContain('unblocked');
  });
});
