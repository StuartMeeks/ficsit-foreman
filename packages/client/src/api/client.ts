// Thin API client for the Foreman backend. All paths are same-origin relative
// (/api/...); the dev server and the production nginx image both proxy /api to
// the backend, so there is no CORS and no base URL to configure.

import { parseSseStream } from './sse.js';
import type {
  Session,
  WorkOrder,
  WorkOrderAction,
  WorkOrderAuditEvent,
  WorkOrderRevision,
  WorkOrderRevisionDiff,
} from './types.js';

const API_KEY_HEADER = 'x-anthropic-api-key';

// Auth is a HttpOnly session cookie, so every request must be credentialed for
// the backend to recognise the signed-in user.
const CREDENTIALS: RequestCredentials = 'include';

function jsonHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (apiKey !== undefined && apiKey.length > 0) {
    headers[API_KEY_HEADER] = apiKey;
  }
  return headers;
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? `Request failed (${response.status}).`;
  } catch {
    return `Request failed (${response.status}).`;
  }
}

export interface CreateSessionInput {
  personality?: string;
  pioneerProfile?: string;
}

export async function createSession(input: CreateSessionInput): Promise<Session> {
  const response = await fetch('/api/sessions', {
    method: 'POST',
    headers: jsonHeaders(),
    credentials: CREDENTIALS,
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as Session;
}

export async function getSession(id: string): Promise<Session | null> {
  const response = await fetch(`/api/sessions/${id}`, { credentials: CREDENTIALS });
  if (response.status === 404 || response.status === 403) {
    return null;
  }
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as Session;
}

/**
 * Claims a pre-accounts anonymous session (the local `foreman.sessionId`) for
 * the signed-in user on first login. Returns the session if claimed or already
 * owned; null if it no longer exists or belongs to another user.
 */
export async function claimSession(id: string): Promise<Session | null> {
  const response = await fetch(`/api/sessions/${id}/claim`, {
    method: 'POST',
    headers: jsonHeaders(),
    credentials: CREDENTIALS,
  });
  if (response.status === 404 || response.status === 403) {
    return null;
  }
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as Session;
}

export async function patchSession(
  id: string,
  patch: { personality?: string; pioneerProfile?: string },
): Promise<Session> {
  const response = await fetch(`/api/sessions/${id}`, {
    method: 'PATCH',
    headers: jsonHeaders(),
    credentials: CREDENTIALS,
    body: JSON.stringify(patch),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as Session;
}

export async function getActiveWorkOrder(sessionId: string): Promise<WorkOrder | null> {
  const response = await fetch(`/api/sessions/${sessionId}/work-orders/active`, {
    credentials: CREDENTIALS,
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as WorkOrder;
}

export async function listWorkOrders(sessionId: string): Promise<WorkOrder[]> {
  const response = await fetch(`/api/sessions/${sessionId}/work-orders`, {
    credentials: CREDENTIALS,
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as WorkOrder[];
}

// ── Work-order v2 mutations & reads ─────────────────────────────────────────
// All mutating endpoints return the updated WorkOrder; callers swap it into
// local state in place. Failures (409 conflict, 403 actor, 400 requirement)
// surface as a thrown Error carrying the server's message.

const wo = (sessionId: string, id: string): string =>
  `/api/sessions/${sessionId}/work-orders/${id}`;

async function send<T>(url: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: jsonHeaders(),
    credentials: CREDENTIALS,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as T;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: CREDENTIALS });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as T;
}

/** Extra fields a transition may require (block reason, completion summary, …). */
export interface TransitionOptions {
  blockedReason?: string;
  blockedResolutionHint?: string;
  resolutionNote?: string;
  cancellationReason?: string;
  supersededByWorkOrderId?: string;
  supersededReason?: string;
  forceCompletionReason?: string;
  incompleteItemSummary?: string;
  completionSummary?: string;
}

export async function transitionWorkOrder(
  sessionId: string,
  id: string,
  action: WorkOrderAction,
  options: TransitionOptions = {},
): Promise<WorkOrder> {
  return send<WorkOrder>(`${wo(sessionId, id)}/transitions`, 'POST', {
    action,
    actor: 'Pioneer',
    ...options,
  });
}

export async function setMaterialChecked(
  sessionId: string,
  id: string,
  materialId: string,
  checked: boolean,
): Promise<WorkOrder> {
  return send<WorkOrder>(`${wo(sessionId, id)}/materials/${materialId}`, 'PATCH', { checked });
}

export async function setStepChecked(
  sessionId: string,
  id: string,
  stepId: string,
  checked: boolean,
): Promise<WorkOrder> {
  return send<WorkOrder>(`${wo(sessionId, id)}/steps/${stepId}`, 'PATCH', { checked });
}

export async function setMachineBuiltCount(
  sessionId: string,
  id: string,
  machineId: string,
  builtCount: number,
): Promise<WorkOrder> {
  return send<WorkOrder>(`${wo(sessionId, id)}/machines/${machineId}`, 'PATCH', { builtCount });
}

export async function logHours(sessionId: string, id: string, hours: number): Promise<WorkOrder> {
  return send<WorkOrder>(`${wo(sessionId, id)}/hours`, 'POST', { hours });
}

export async function acknowledgeRevision(
  sessionId: string,
  id: string,
  revisionNumber?: number,
): Promise<WorkOrder> {
  return send<WorkOrder>(`${wo(sessionId, id)}/acknowledge`, 'POST', { revisionNumber });
}

export async function revertToRevision(
  sessionId: string,
  id: string,
  revisionNumber: number,
): Promise<WorkOrder> {
  return send<WorkOrder>(`${wo(sessionId, id)}/revert`, 'POST', { revisionNumber });
}

export async function getAuditTrail(sessionId: string, id: string): Promise<WorkOrderAuditEvent[]> {
  return getJson<WorkOrderAuditEvent[]>(`${wo(sessionId, id)}/audit`);
}

export async function getRevisions(sessionId: string, id: string): Promise<WorkOrderRevision[]> {
  return getJson<WorkOrderRevision[]>(`${wo(sessionId, id)}/revisions`);
}

export async function getRevisionDiff(
  sessionId: string,
  id: string,
  from?: number,
  to?: number,
): Promise<WorkOrderRevisionDiff> {
  const params = new URLSearchParams();
  if (from !== undefined) {
    params.set('from', String(from));
  }
  if (to !== undefined) {
    params.set('to', String(to));
  }
  const qs = params.toString();
  return getJson<WorkOrderRevisionDiff>(`${wo(sessionId, id)}/revisions/diff${qs ? `?${qs}` : ''}`);
}

/** Per-request LLM override (effective only when an API key is supplied). */
export interface ClientLlmConfig {
  provider?: 'anthropic' | 'openai';
  model?: string;
  baseUrl?: string;
}

/** Callbacks invoked as the foreman's streamed turn unfolds. */
export interface ChatHandlers {
  onText(delta: string): void;
  onToolUse(name: string): void;
  onWorkOrder(order: WorkOrder): void;
  onError(message: string): void;
}

/**
 * Sends a message and streams the foreman's response, dispatching SSE events to
 * the handlers. Resolves when the stream ends (the `done` event or stream
 * close). Network/HTTP failures surface through onError.
 */
export async function streamChat(
  sessionId: string,
  message: string,
  apiKey: string | undefined,
  llm: ClientLlmConfig,
  handlers: ChatHandlers,
): Promise<void> {
  const body: Record<string, unknown> = { message };
  if (llm.provider !== undefined) {
    body['provider'] = llm.provider;
  }
  if (llm.model !== undefined && llm.model.length > 0) {
    body['model'] = llm.model;
  }
  if (llm.baseUrl !== undefined && llm.baseUrl.length > 0) {
    body['baseUrl'] = llm.baseUrl;
  }

  let response: Response;
  try {
    response = await fetch(`/api/sessions/${sessionId}/chat`, {
      method: 'POST',
      headers: jsonHeaders(apiKey),
      credentials: CREDENTIALS,
      body: JSON.stringify(body),
    });
  } catch {
    handlers.onError('Could not reach the foreman. Is the backend running?');
    return;
  }

  if (!response.ok || response.body === null) {
    handlers.onError(await readError(response));
    return;
  }

  for await (const event of parseSseStream(response.body)) {
    switch (event.event) {
      case 'text': {
        handlers.onText((JSON.parse(event.data) as { delta: string }).delta);
        break;
      }
      case 'tool_use': {
        handlers.onToolUse((JSON.parse(event.data) as { name: string }).name);
        break;
      }
      case 'work_order': {
        handlers.onWorkOrder(JSON.parse(event.data) as WorkOrder);
        break;
      }
      case 'error': {
        handlers.onError((JSON.parse(event.data) as { message: string }).message);
        break;
      }
      case 'done':
      default:
        break;
    }
  }
}
