// API types, mirroring the @foreman/server contracts the client talks to.

export type WorkOrderStatus = 'active' | 'completed' | 'abandoned';

export interface LineItem {
  item: string;
  quantity: number;
  unit: string;
}

export interface ExpectedOutput {
  item: string;
  perMinute: number;
}

export interface WorkOrder {
  id: string;
  sequenceNumber: number;
  status: WorkOrderStatus;
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
}

export interface Session {
  id: string;
  personality: string;
  pioneerProfile: string;
  summary?: string;
  createdAt: string;
  updatedAt: string;
}

export type ChatRole = 'user' | 'assistant';
