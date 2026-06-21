import { z } from 'zod';

/**
 * Shared zod schemas for request bodies and tool inputs. Centralised so the
 * REST routes and the foreman's work-order tools validate against identical
 * shapes.
 */

export const lineItemSchema = z.object({
  item: z.string(),
  quantity: z.number(),
  unit: z.string(),
});

export const expectedOutputSchema = z.object({
  item: z.string(),
  perMinute: z.number(),
});

export const pioneerFeedbackSchema = z.object({
  enjoyedAspects: z.array(z.string()).default([]),
  didNotEnjoy: z.array(z.string()).default([]),
  freeformNotes: z.string().optional(),
});

export const workOrderCreateSchema = z.object({
  title: z.string().min(1),
  objective: z.string().min(1),
  tier: z.number().int().min(0).max(9),
  estimatedDuration: z.string().min(1),
  requiredItems: z.array(lineItemSchema),
  buildSteps: z.array(z.string()),
  expectedOutput: z.array(expectedOutputSchema),
  notes: z.string().optional(),
});

export const workOrderCompleteSchema = z.object({
  completionSummary: z.string().min(1),
  adaptations: z.array(z.string()).optional(),
  pioneerFeedback: pioneerFeedbackSchema.optional(),
});

export const workOrderUpdateSchema = z
  .object({
    status: z.enum(['active', 'completed', 'abandoned']).optional(),
    notes: z.string().optional(),
    adaptations: z.array(z.string()).optional(),
    completionSummary: z.string().optional(),
    pioneerFeedback: pioneerFeedbackSchema.optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, {
    message: 'At least one field must be provided.',
  });

export const createSessionSchema = z.object({
  id: z.string().min(1).optional(),
  personality: z.string().optional(),
  pioneerProfile: z.string().optional(),
});

export const updateSessionSchema = z
  .object({
    personality: z.string().optional(),
    pioneerProfile: z.string().optional(),
  })
  .refine((patch) => patch.personality !== undefined || patch.pioneerProfile !== undefined, {
    message: 'Provide personality and/or pioneerProfile.',
  });

export const chatSchema = z.object({
  message: z.string().min(1),
  // Optional per-request LLM override (effective only with a client-supplied key).
  provider: z.enum(['anthropic', 'openai']).optional(),
  model: z.string().optional(),
  baseUrl: z.string().optional(),
});
