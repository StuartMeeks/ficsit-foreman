import { useCallback, useEffect, useRef, useState } from 'react';

import {
  createSession,
  getActiveWorkOrder,
  getSession,
  listWorkOrders,
  patchSession,
  streamChat,
  type ClientLlmConfig,
} from './api/client.js';
import type { Session, WorkOrder } from './api/types.js';

const SESSION_KEY = 'foreman.sessionId';
const API_KEY = 'foreman.apiKey';
const PROVIDER_KEY = 'foreman.provider';
const MODEL_KEY = 'foreman.model';
const BASE_URL_KEY = 'foreman.baseUrl';

export interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  tools: string[];
  error?: string;
  streaming: boolean;
}

/** LLM settings the user can configure (empty = use the server default). */
export interface LlmSettings {
  apiKey: string;
  provider: string;
  model: string;
  baseUrl: string;
}

export interface ForemanState {
  session: Session | null;
  messages: ChatMsg[];
  activeWorkOrder: WorkOrder | null;
  history: WorkOrder[];
  sending: boolean;
  bootError: string | null;
  llm: LlmSettings;
  keyNeeded: boolean;
  send(text: string): void;
  saveSettings(input: {
    personality: string;
    pioneerProfile: string;
    llm: LlmSettings;
  }): Promise<void>;
}

function readStorage(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore storage failures */
  }
}

export function useForeman(): ForemanState {
  const [session, setSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [activeWorkOrder, setActiveWorkOrder] = useState<WorkOrder | null>(null);
  const [history, setHistory] = useState<WorkOrder[]>([]);
  const [sending, setSending] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [llm, setLlm] = useState<LlmSettings>(() => ({
    apiKey: readStorage(API_KEY),
    provider: readStorage(PROVIDER_KEY),
    model: readStorage(MODEL_KEY),
    baseUrl: readStorage(BASE_URL_KEY),
  }));
  const [keyNeeded, setKeyNeeded] = useState(false);
  const booted = useRef(false);

  const loadOrders = useCallback(async (sessionId: string) => {
    const [active, all] = await Promise.all([
      getActiveWorkOrder(sessionId),
      listWorkOrders(sessionId),
    ]);
    setActiveWorkOrder(active);
    setHistory(all);
  }, []);

  useEffect(() => {
    if (booted.current) {
      return;
    }
    booted.current = true;
    void (async () => {
      try {
        const existingId = readStorage(SESSION_KEY);
        let loaded = existingId ? await getSession(existingId) : null;
        if (loaded === null) {
          loaded = await createSession({});
          writeStorage(SESSION_KEY, loaded.id);
        }
        setSession(loaded);
        await loadOrders(loaded.id);
      } catch (error) {
        setBootError(error instanceof Error ? error.message : 'Failed to start a session.');
      }
    })();
  }, [loadOrders]);

  const patchMessage = useCallback((id: string, patch: Partial<ChatMsg>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (trimmed.length === 0 || sending || session === null) {
        return;
      }
      const sessionId = session.id;
      const assistantId = crypto.randomUUID();
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: 'user', content: trimmed, tools: [], streaming: false },
        { id: assistantId, role: 'assistant', content: '', tools: [], streaming: true },
      ]);
      setSending(true);
      setKeyNeeded(false);

      const override: ClientLlmConfig = {
        provider:
          llm.provider === 'anthropic' || llm.provider === 'openai' ? llm.provider : undefined,
        model: llm.model || undefined,
        baseUrl: llm.baseUrl || undefined,
      };

      void streamChat(sessionId, trimmed, llm.apiKey || undefined, override, {
        onText: (delta) =>
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + delta } : m)),
          ),
        onToolUse: (name) =>
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, tools: [...m.tools, name] } : m)),
          ),
        onWorkOrder: (order) => {
          setActiveWorkOrder(order.status === 'active' ? order : null);
          void loadOrders(sessionId);
        },
        onError: (message) => {
          patchMessage(assistantId, { error: message });
          if (/api key/i.test(message)) {
            setKeyNeeded(true);
          }
        },
      })
        .catch((error: unknown) =>
          patchMessage(assistantId, {
            error: error instanceof Error ? error.message : 'Stream failed.',
          }),
        )
        .finally(() => {
          patchMessage(assistantId, { streaming: false });
          setSending(false);
        });
    },
    [llm, loadOrders, patchMessage, sending, session],
  );

  const saveSettings = useCallback(
    async (input: { personality: string; pioneerProfile: string; llm: LlmSettings }) => {
      writeStorage(API_KEY, input.llm.apiKey);
      writeStorage(PROVIDER_KEY, input.llm.provider);
      writeStorage(MODEL_KEY, input.llm.model);
      writeStorage(BASE_URL_KEY, input.llm.baseUrl);
      setLlm(input.llm);
      if (session !== null) {
        const updated = await patchSession(session.id, {
          personality: input.personality,
          pioneerProfile: input.pioneerProfile,
        });
        setSession(updated);
      }
    },
    [session],
  );

  return {
    session,
    messages,
    activeWorkOrder,
    history,
    sending,
    bootError,
    llm,
    keyNeeded,
    send,
    saveSettings,
  };
}
