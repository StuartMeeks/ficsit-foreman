// API types, mirroring the @foreman/ff-server contracts the client talks to
// (Work Orders v2 — see docs/work-orders.md).

export type WorkOrderState =
  'new' | 'active' | 'paused' | 'blocked' | 'completed' | 'cancelled' | 'superseded';

export const TERMINAL_STATES: readonly WorkOrderState[] = ['completed', 'cancelled', 'superseded'];

export type WorkOrderActor = 'Pioneer' | 'Foreman' | 'System';

export type CollectibleKind =
  | 'mercerSphere'
  | 'somersloop'
  | 'powerSlugBlue'
  | 'powerSlugYellow'
  | 'powerSlugPurple'
  | 'hardDrive'
  | 'helmet'
  | 'mtape';

export type Purity = 'impure' | 'normal' | 'pure';

export interface Coordinates {
  x: number;
  y: number;
  z?: number;
}

export type ExpectedOutput =
  | { kind: 'item'; item: string; perMinute: number; unit?: string }
  | { kind: 'power'; megawatts: number }
  | { kind: 'unlock'; schematic: string }
  | { kind: 'infrastructure'; description: string };

export interface BuildCostLine {
  itemName: string;
  itemClass?: string;
  amount: number;
}

/** The plan-only shape of a buildable, as stored in revision snapshots. */
export interface BuildableDef {
  id: string;
  name: string;
  buildingClass?: string;
  requiredCount: number;
  recipeName?: string;
  notes?: string;
  /** Per-unit build cost, resolved server-side; [] when unresolved. */
  buildCost: BuildCostLine[];
}

export interface Buildable extends BuildableDef {
  /** Execution state owned by the Pioneer (0..requiredCount, uncapped). */
  builtCount: number;
}

/** The plan-only shape of a build step, as stored in revision snapshots. */
export interface WorkOrderStepDef {
  id: string;
  title: string;
  description?: string;
  order: number;
  /** The buildables this step requires (with per-unit cost). */
  buildables: BuildableDef[];
}

export interface WorkOrderStep extends WorkOrderStepDef {
  /** Execution state owned by the Pioneer. */
  checked: boolean;
  /** The step's buildables carrying per-buildable built counts. */
  buildables: Buildable[];
}

export interface RecipeItemRate {
  itemName: string;
  perMinute: number;
}

export interface RecipeAssignment {
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
  distanceFromPlayer?: number;
  distanceFromWorkOrderLocation?: number;
  notes?: string;
}

export interface CollectibleOpportunity {
  id?: string;
  kind: CollectibleKind;
  coordinates?: Coordinates;
  distance?: number;
  reason?: string;
  optional: boolean;
}

export type OrderType = 'build' | 'explore';

/** What a hard-drive pod / gated site needs to open (server-derived). */
export interface UnlockCost {
  item?: { itemClass: string; amount: number };
  powerMW?: number;
}

/** One collectible on an explore-order route. Facts are server-derived; `collected` is execution. */
export interface ExploreCollectible {
  id: string;
  kind: CollectibleKind;
  guid?: string;
  schematic?: string;
  collected: boolean;
  coordinates?: Coordinates;
  reason?: string;
  unlockCost?: UnlockCost;
}

/** A stop on an explore-order route. */
export interface ExploreWaypoint {
  id: string;
  order: number;
  label?: string;
  coordinates: Coordinates;
  relativeToPlayer?: string;
  collectibles: ExploreCollectible[];
  notes?: string;
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

export interface PioneerFeedback {
  enjoyedAspects: string[];
  didNotEnjoy: string[];
  freeformNotes?: string;
}

export type WorkOrderRelationshipType =
  | 'prerequisite'
  | 'exploration'
  | 'hard_drive_hunt'
  | 'mam_research'
  | 'resource_gathering'
  | 'infrastructure_support'
  | 'corrective_action';

export interface WorkOrder {
  id: string;
  sequenceNumber: number;
  /** 'build' (WO-) or 'explore' (EO-, #207). */
  orderType: OrderType;
  version: string;

  // Plan
  title: string;
  goal: string;
  objective?: string;
  strategicSignificance?: string;
  successCondition?: string;
  tier?: number;
  notes?: string[];
  locationRecommendation?: LocationRecommendation;
  resourceNodes?: ResourceNodeReference[];
  recipes: RecipeAssignment[];
  expectedOutputs: ExpectedOutput[];
  buildSteps: WorkOrderStep[];
  /** Explore orders only: the collection route. */
  waypoints?: ExploreWaypoint[];
  opportunities?: WorkOrderOpportunities;
  blockedReason?: string;
  blockedResolutionHint?: string;

  // Execution
  state: WorkOrderState;
  startedAt?: string;
  pausedAt?: string;
  blockedAt?: string;
  completedAt?: string;
  hoursLogged?: number;
  completionSummary?: string;
  pioneerFeedback?: PioneerFeedback;

  // Revision / acknowledgement
  currentRevision: number;
  lastAcknowledgedRevision?: number;
  hasUnacknowledgedRevision: boolean;

  // Relationships
  parentWorkOrderId?: string;
  relationshipToParent?: WorkOrderRelationshipType;
  childWorkOrderIds: string[];

  createdAt: string;
  updatedAt: string;
}

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
  | 'step_checked'
  | 'step_unchecked'
  | 'buildable_built_count_changed'
  | 'collectible_collected'
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

/**
 * A plan-only snapshot of an order at a revision — no execution state
 * (no checked flags, built counts, or logged hours). Mirrors the server's
 * WorkOrderPlanSnapshot.
 */
export interface WorkOrderPlanSnapshot {
  orderType?: OrderType;
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
  recipes: RecipeAssignment[];
  expectedOutputs: ExpectedOutput[];
  /** Build steps, each carrying the buildables it requires (with per-unit cost). */
  buildSteps: WorkOrderStepDef[];
  /** Explore orders only: the collection route. */
  waypoints?: ExploreWaypoint[];
  opportunities?: WorkOrderOpportunities;
  blockedReason?: string;
  blockedResolutionHint?: string;
  relationshipToParent?: WorkOrderRelationshipType;
  parentWorkOrderId?: string;
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

export interface WorkOrderFieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface WorkOrderRevisionDiff {
  fromRevision: number;
  toRevision: number;
  changes: WorkOrderFieldChange[];
}

/** The lifecycle actions the transitions endpoint accepts. */
export type WorkOrderAction =
  | 'Start'
  | 'Pause'
  | 'Resume'
  | 'Block'
  | 'Unblock'
  | 'Complete'
  | 'ForceComplete'
  | 'Cancel'
  | 'Supersede';

/** A reusable foreman persona, owned by the user and attached to playthroughs. */
export interface Foreman {
  id: string;
  name: string;
  personality: string;
  createdAt: string;
  updatedAt: string;
}

/** The current uploaded `.sav` attached to a playthrough (metadata only). */
export interface Save {
  id: string;
  fileName: string;
  saveName?: string;
  version?: string;
  sessionName?: string;
  mapName?: string;
  buildVersion?: number;
  saveVersion?: number;
  playDurationSeconds?: number;
  sizeBytes: number;
  uploadedAt: string;
}

/** A non-fatal advisory returned alongside an uploaded/previewed save. */
export interface SaveWarning {
  kind: 'build_mismatch' | 'playtime_regressed' | 'collectibles_synced';
  message: string;
  saveBuild?: number;
  gameDataBuild?: number;
}

/** Collectibles auto-marked collected on a re-upload (#209-B). */
export interface CollectibleSyncSummary {
  synced: number;
  orders: { id: string; label: string; collected: number }[];
}

/** The save-upload response: the stored save plus any advisories. */
export interface SaveUploadResult {
  save: Save;
  warnings: SaveWarning[];
  /** Collectibles auto-marked collected on this re-upload (#209-B); absent when none. */
  collectibleSync?: CollectibleSyncSummary;
}

/** Header identity parsed from a save (same-game matching + warnings). */
export interface SaveIdentity {
  saveName?: string;
  sessionName?: string;
  mapName?: string;
  buildVersion?: number;
  saveVersion?: number;
  playDurationSeconds?: number;
}

/** A playthrough whose current save matches an uploaded save's identity. */
export interface SaveMatch {
  playthroughId: string;
  playthroughName?: string;
  currentSave: { saveName?: string; playDurationSeconds?: number; uploadedAt: string };
  reason: 'session_map_match';
  playtimeRegressed: boolean;
}

/** The same-game preview response. */
export interface SavePreviewResult {
  identity: SaveIdentity;
  matches: SaveMatch[];
  warnings: SaveWarning[];
}

export interface Playthrough {
  id: string;
  foremanId: string;
  name?: string;
  pioneerProfile: string;
  summary?: string;
  save?: Save;
  createdAt: string;
  updatedAt: string;
}

/** A stored chat message, for re-hydrating history on load / switch. */
export interface StoredMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
}

export type ChatRole = 'user' | 'assistant';
