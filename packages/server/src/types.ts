/**
 * Shared API types for the FICSIT Foreman backend. The WorkOrder shape mirrors
 * WORK_ORDER_SPEC.md (the canonical Work Orders v2 design) and is what crosses
 * the HTTP API and the foreman's work-order tools. The database stores its
 * complex fields as JSON-encoded TEXT (see prisma/schema.prisma); the work-order
 * service does the marshalling.
 *
 * Core design rule (see the spec): the *plan* and *execution progress* are
 * separate. Plan revisions are snapshotted; execution state (checked flags,
 * built counts, logged hours) lives only on the live record, with the audit
 * trail as its history. The snapshot/definition shapes below encode that split.
 */

import type { CollectibleKind, Purity } from '@foreman/game-data-core';

export type { CollectibleKind, Purity };

/** Lifecycle state. `new`/`active`/`paused`/`blocked` are non-terminal. */
export type WorkOrderState =
  | 'new'
  | 'active'
  | 'paused'
  | 'blocked'
  | 'completed'
  | 'cancelled'
  | 'superseded';

export type TerminalWorkOrderState = 'completed' | 'cancelled' | 'superseded';

/** Who is performing an action. Asserted by call site, not authenticated. */
export type WorkOrderActor = 'Pioneer' | 'Foreman' | 'System';

export type WorkOrderRelationshipType =
  | 'prerequisite'
  | 'exploration'
  | 'hard_drive_hunt'
  | 'mam_research'
  | 'resource_gathering'
  | 'infrastructure_support'
  | 'corrective_action';

/** A point in the Satisfactory world, in Unreal units (centimetres). */
export interface Coordinates {
  x: number;
  y: number;
  z?: number;
}

/**
 * What a work order produces. Power is the hero metric for a power plant, so
 * output is a discriminated union rather than a bare item rate.
 */
export type ExpectedOutput =
  | { kind: 'item'; item: string; perMinute: number; unit?: string }
  | { kind: 'power'; megawatts: number }
  | { kind: 'unlock'; schematic: string }
  | { kind: 'infrastructure'; description: string };

// --- Checklist items -------------------------------------------------------
// Each carries a stable `id` so a plan revision can merge execution state
// forward (items that still exist keep their checked state / built count).
// The `*Def` shapes are the plan-only definition (no execution fields); the
// live shapes extend them with the execution state the Pioneer owns.

export interface MachineRequirementDef {
  id: string;
  machineName: string;
  requiredCount: number;
  recipeName?: string;
  notes?: string;
}
export interface MachineRequirement extends MachineRequirementDef {
  /** Manual; execution state owned by the Pioneer. */
  builtCount: number;
}

export interface MaterialRequirementDef {
  id: string;
  itemName: string;
  requiredQuantity: number;
  notes?: string;
}
export interface MaterialRequirement extends MaterialRequirementDef {
  /** Execution state owned by the Pioneer. */
  checked: boolean;
}

export interface WorkOrderStepDef {
  id: string;
  title: string;
  description?: string;
  order: number;
}
export interface WorkOrderStep extends WorkOrderStepDef {
  /** Execution state owned by the Pioneer. */
  checked: boolean;
}

export interface RecipeItemRate {
  itemName: string;
  perMinute: number;
}

export interface RecipeAssignment {
  /** Optional; recipes are not checklist items, so no stable id is required. */
  id?: string;
  machineName: string;
  recipeName: string;
  inputItems?: RecipeItemRate[];
  outputItems?: RecipeItemRate[];
  notes?: string;
}

export interface LocationRecommendation {
  summary: string;
  coordinates?: Coordinates;
  relativeToPlayer?: string;
  rationale?: string;
}

export interface ResourceNodeReference {
  id?: string;
  resourceName: string;
  purity?: Purity;
  coordinates?: Coordinates;
  /** Centimetres; convert to metres for display. */
  distanceFromPlayer?: number;
  distanceFromWorkOrderLocation?: number;
  notes?: string;
}

// --- Opportunities (optional Foreman guidance) -----------------------------

export interface CollectibleOpportunity {
  id?: string;
  /** Reuses the game-data CollectibleKind — no parallel enum. */
  kind: CollectibleKind;
  coordinates?: Coordinates;
  /** Centimetres; show in metres. */
  distance?: number;
  reason?: string;
  optional: boolean;
}

export interface OverclockingOption {
  target: string;
  recommendation: string;
  powerShardCount?: number;
  expectedEffect?: string;
  notes?: string;
}

export interface AwesomeShopSuggestion {
  itemName: string;
  reason: string;
  priority?: 'low' | 'medium' | 'high';
}

export interface WorkOrderOpportunities {
  nearbyCollectiblesFromPlayer?: CollectibleOpportunity[];
  nearbyCollectiblesFromWorkOrderLocation?: CollectibleOpportunity[];
  overclockingOptions?: OverclockingOption[];
  awesomeShopSuggestions?: AwesomeShopSuggestion[];
  notes?: string[];
}

// --- Pioneer feedback (optional, captured at completion) -------------------

export interface PioneerFeedback {
  enjoyedAspects: string[];
  didNotEnjoy: string[];
  freeformNotes?: string;
}

/**
 * The plan portion of a work order — everything the Foreman owns. This is what a
 * revision snapshot stores: structural definitions only, NOT execution state
 * (no checked flags, built counts, or logged hours).
 */
export interface WorkOrderPlanSnapshot {
  title: string;
  goal: string;
  objective?: string;
  strategicSignificance?: string;
  successCondition?: string;
  /** Satisfactory milestone tier (0–9). */
  tier?: number;
  /** Foreman build notes — freeform guidance shown alongside the order. */
  notes?: string[];
  locationRecommendation?: LocationRecommendation;
  resourceNodes?: ResourceNodeReference[];
  machines: MachineRequirementDef[];
  buildMaterials: MaterialRequirementDef[];
  recipes: RecipeAssignment[];
  expectedOutputs: ExpectedOutput[];
  buildSteps: WorkOrderStepDef[];
  opportunities?: WorkOrderOpportunities;
  blockedReason?: string;
  blockedResolutionHint?: string;
  relationshipToParent?: WorkOrderRelationshipType;
  parentWorkOrderId?: string;
}

/** A live work order: the plan plus the Pioneer-owned execution state. */
export interface WorkOrder {
  id: string;
  /** Per-session, monotonic. Displayed as WO-001, WO-002, … */
  sequenceNumber: number;
  /** Game data version this order was built for. */
  version: string;

  // Plan (Foreman-owned)
  title: string;
  goal: string;
  objective?: string;
  strategicSignificance?: string;
  successCondition?: string;
  tier?: number;
  notes?: string[];
  locationRecommendation?: LocationRecommendation;
  resourceNodes?: ResourceNodeReference[];
  machines: MachineRequirement[];
  buildMaterials: MaterialRequirement[];
  recipes: RecipeAssignment[];
  expectedOutputs: ExpectedOutput[];
  buildSteps: WorkOrderStep[];
  opportunities?: WorkOrderOpportunities;
  blockedReason?: string;
  blockedResolutionHint?: string;

  // Execution (Pioneer-owned)
  state: WorkOrderState;
  startedAt?: string;
  pausedAt?: string;
  blockedAt?: string;
  completedAt?: string;
  hoursLogged?: number;
  /** Captured at completion; optional. */
  completionSummary?: string;
  pioneerFeedback?: PioneerFeedback;

  // Revision / acknowledgement
  currentRevision: number;
  lastAcknowledgedRevision?: number;
  /** Derived: currentRevision > (lastAcknowledgedRevision ?? 0). Never stored. */
  hasUnacknowledgedRevision: boolean;

  // Relationships
  parentWorkOrderId?: string;
  relationshipToParent?: WorkOrderRelationshipType;
  /** Derived: ids of orders whose parentWorkOrderId is this order. */
  childWorkOrderIds: string[];

  createdAt: string;
  updatedAt: string;
}

/** Audit trail event types (append-only). */
export type WorkOrderAuditEventType =
  | 'work_order_created'
  | 'work_order_revised'
  | 'revision_acknowledged'
  | 'reverted_to_revision'
  | 'state_transitioned'
  | 'started'
  | 'paused'
  | 'resumed'
  | 'blocked'
  | 'unblocked'
  | 'completed'
  | 'force_completed'
  | 'cancelled'
  | 'superseded'
  | 'completion_proposed'
  | 'child_work_order_created'
  | 'child_work_order_completed'
  | 'material_checked'
  | 'material_unchecked'
  | 'step_checked'
  | 'step_unchecked'
  | 'machine_built_count_changed'
  | 'hours_logged'
  | 'recipe_choice_changed'
  | 'build_plan_adapted'
  | 'migration_event';

export interface WorkOrderAuditEvent {
  id: string;
  workOrderId: string;
  timestamp: string;
  actor: WorkOrderActor;
  eventType: WorkOrderAuditEventType;
  revisionNumber?: number;
  previousRevisionNumber?: number;
  note?: string;
  details?: unknown;
}

export interface WorkOrderRevision {
  id: string;
  workOrderId: string;
  revisionNumber: number;
  createdAt: string;
  createdBy: WorkOrderActor;
  reason?: string;
  changeSummary?: string;
  planSnapshot: WorkOrderPlanSnapshot;
}

/** A single plan field that differs between two revisions. */
export interface WorkOrderFieldChange {
  /** Plan field name, e.g. 'goal', 'tier', 'machines', 'expectedOutputs'. */
  field: string;
  before: unknown;
  after: unknown;
}

/** Field-level diff between two plan-revision snapshots (for the UI banner). */
export interface WorkOrderRevisionDiff {
  fromRevision: number;
  toRevision: number;
  changes: WorkOrderFieldChange[];
}

export interface Session {
  id: string;
  personality: string;
  pioneerProfile: string;
  /** Condensed running record of the session; undefined until first summarised. */
  summary?: string;
  createdAt: string;
  updatedAt: string;
}

/** A persisted conversational turn (user input or the foreman's final text). */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}
