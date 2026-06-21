// Thin API client for the Foreman backend. All paths are same-origin relative
// (/api/...); the dev server and the production nginx image both proxy /api to
// the backend, so there is no CORS and no base URL to configure.

import { parseSseStream } from './sse.js';
import type { Session, WorkOrder } from './types.js';

const API_KEY_HEADER = 'x-anthropic-api-key';

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
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as Session;
}

export async function getSession(id: string): Promise<Session | null> {
  const response = await fetch(`/api/sessions/${id}`);
  if (response.status === 404) {
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
    body: JSON.stringify(patch),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as Session;
}

export async function getActiveWorkOrder(sessionId: string): Promise<WorkOrder | null> {
  const response = await fetch(`/api/sessions/${sessionId}/work-orders/active`);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as WorkOrder;
}

export async function listWorkOrders(sessionId: string): Promise<WorkOrder[]> {
  const response = await fetch(`/api/sessions/${sessionId}/work-orders`);
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as WorkOrder[];
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
  handlers: ChatHandlers,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`/api/sessions/${sessionId}/chat`, {
      method: 'POST',
      headers: jsonHeaders(apiKey),
      body: JSON.stringify({ message }),
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
