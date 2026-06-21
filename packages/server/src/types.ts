/**
 * Shared API types for the FICSIT Foreman backend. The WorkOrder shape mirrors
 * the interface in SPEC.md and is what crosses the HTTP API and the foreman's
 * work-order tools — the database stores its complex fields as JSON-encoded TEXT
 * (see prisma/schema.prisma) and the work-order service does the marshalling.
 */

export type WorkOrderStatus = 'active' | 'completed' | 'abandoned';

export interface LineItem {
  item: string;
  quantity: number;
  /** e.g. "units", "per minute". */
  unit: string;
}

export interface ExpectedOutput {
  item: string;
  perMinute: number;
}

export interface PioneerFeedback {
  /** What the pioneer found fun — captured at close-out. */
  enjoyedAspects: string[];
  /** What felt tedious, frustrating, or unfun. */
  didNotEnjoy: string[];
  /** Optional open-ended comment from the pioneer. */
  freeformNotes?: string;
}

export interface WorkOrder {
  id: string;
  /** Per-session, monotonic. Displayed as WO-001, WO-002, … */
  sequenceNumber: number;
  status: WorkOrderStatus;
  /** Game data version this order was built for. */
  version: string;
  issuedAt: string;
  completedAt?: string;

  title: string;
  objective: string;
  tier: number;
  estimatedDuration: string;

  requiredItems: LineItem[];
  buildSteps: string[];
  expectedOutput: ExpectedOutput[];

  notes?: string;
  adaptations?: string[];
  completionSummary?: string;
  pioneerFeedback?: PioneerFeedback;
}

export interface Session {
  id: string;
  personality: string;
  pioneerProfile: string;
  createdAt: string;
  updatedAt: string;
}

/** A persisted conversational turn (user input or the foreman's final text). */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}
