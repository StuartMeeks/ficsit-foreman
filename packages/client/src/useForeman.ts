import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  fetchCurrentUser,
  signIn as apiSignIn,
  signOut as apiSignOut,
  signUp as apiSignUp,
  type AuthUser,
} from './api/auth.js';
import {
  acknowledgeRevision,
  claimSession,
  createSession,
  listWorkOrders,
  logHours,
  patchSession,
  revertToRevision,
  setMachineBuiltCount,
  setMaterialChecked,
  setStepChecked,
  streamChat,
  transitionWorkOrder,
  type ClientLlmConfig,
  type TransitionOptions,
} from './api/client.js';
import {
  TERMINAL_STATES,
  type Session,
  type WorkOrder,
  type WorkOrderAction,
} from './api/types.js';

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

/** Whether the auth check is still running, finished signed-out, or signed-in. */
export type AuthStatus = 'loading' | 'anon' | 'authed';

export interface ForemanState {
  authStatus: AuthStatus;
  user: AuthUser | null;
  signIn(email: string, password: string): Promise<void>;
  signUp(name: string, email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  session: Session | null;
  messages: ChatMsg[];
  /** The order the work-order panel should display (active, else latest). */
  currentOrder: WorkOrder | null;
  history: WorkOrder[];
  workOrders: WorkOrderActions;
  sending: boolean;
  booting: boolean;
  needsOnboarding: boolean;
  bootError: string | null;
  llm: LlmSettings;
  keyNeeded: boolean;
  send(text: string): void;
  completeOnboarding(input: { personality: string; pioneerProfile: string }): Promise<void>;
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

/** A session is un-onboarded until it carries a personality or pioneer profile. */
function isUnonboarded(session: Session): boolean {
  return session.personality.trim().length === 0 && session.pioneerProfile.trim().length === 0;
}

function isTerminal(order: WorkOrder): boolean {
  return TERMINAL_STATES.includes(order.state);
}

/**
 * The order the panel should show. A newly-issued order is `new` (not `active`),
 * so we can't rely on the /active endpoint alone: prefer the active order, then
 * the latest non-terminal one, then simply the latest (so a just-completed order
 * stays on screen in its terminal state).
 */
function pickCurrent(history: WorkOrder[]): WorkOrder | null {
  if (history.length === 0) {
    return null;
  }
  const bySeqDesc = [...history].sort((a, b) => b.sequenceNumber - a.sequenceNumber);
  return (
    bySeqDesc.find((o) => o.state === 'active') ??
    bySeqDesc.find((o) => !isTerminal(o)) ??
    bySeqDesc[0] ??
    null
  );
}

/** Pioneer-driven work-order mutations. Each swaps the updated order into state. */
export interface WorkOrderActions {
  transition(id: string, action: WorkOrderAction, options?: TransitionOptions): Promise<void>;
  setMaterial(id: string, materialId: string, checked: boolean): Promise<void>;
  setStep(id: string, stepId: string, checked: boolean): Promise<void>;
  setMachine(id: string, machineId: string, builtCount: number): Promise<void>;
  acknowledge(id: string, revisionNumber?: number): Promise<void>;
  revert(id: string, revisionNumber: number): Promise<void>;
  logHours(id: string, hours: number): Promise<void>;
}

export function useForeman(): ForemanState {
  const [authStatus, setAuthStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [history, setHistory] = useState<WorkOrder[]>([]);
  const currentOrder = useMemo(() => pickCurrent(history), [history]);
  const [sending, setSending] = useState(false);
  const [booting, setBooting] = useState(true);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
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
    setHistory(await listWorkOrders(sessionId));
  }, []);

  /** Swap a mutated order into history in place (no full refetch / flicker). */
  const replaceOrder = useCallback((updated: WorkOrder) => {
    setHistory((prev) => {
      const idx = prev.findIndex((o) => o.id === updated.id);
      if (idx === -1) {
        return [...prev, updated];
      }
      const next = prev.slice();
      next[idx] = updated;
      return next;
    });
  }, []);

  /**
   * Resolves the signed-in user's working session. The browser may hold a local
   * session id from before sign-in (or a prior visit); we claim it for the user
   * (idempotent if already theirs), and fall through to onboarding if it is gone
   * or belongs to someone else. A session counts as onboarded once it carries a
   * personality or pioneer profile; the session itself is created lazily when
   * onboarding completes.
   */
  const loadSession = useCallback(async () => {
    const existingId = readStorage(SESSION_KEY);
    const loaded = existingId ? await claimSession(existingId) : null;
    if (loaded === null) {
      writeStorage(SESSION_KEY, '');
    }
    if (loaded === null || isUnonboarded(loaded)) {
      setSession(loaded);
      setNeedsOnboarding(true);
      return;
    }
    setSession(loaded);
    setNeedsOnboarding(false);
    await loadOrders(loaded.id);
  }, [loadOrders]);

  useEffect(() => {
    if (booted.current) {
      return;
    }
    booted.current = true;
    void (async () => {
      try {
        const current = await fetchCurrentUser();
        if (current === null) {
          setAuthStatus('anon');
          return;
        }
        setUser(current);
        setAuthStatus('authed');
        await loadSession();
      } catch (error) {
        setBootError(error instanceof Error ? error.message : 'Failed to start a session.');
      } finally {
        setBooting(false);
      }
    })();
  }, [loadSession]);

  /** Runs the post-authentication session load, surfacing boot errors. */
  const enterApp = useCallback(
    async (current: AuthUser) => {
      setUser(current);
      setAuthStatus('authed');
      setBootError(null);
      setBooting(true);
      try {
        await loadSession();
      } catch (error) {
        setBootError(error instanceof Error ? error.message : 'Failed to start a session.');
      } finally {
        setBooting(false);
      }
    },
    [loadSession],
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      await enterApp(await apiSignIn(email, password));
    },
    [enterApp],
  );

  const signUp = useCallback(
    async (name: string, email: string, password: string) => {
      await enterApp(await apiSignUp(name, email, password));
    },
    [enterApp],
  );

  const signOut = useCallback(async () => {
    await apiSignOut();
    setUser(null);
    setAuthStatus('anon');
    setSession(null);
    setMessages([]);
    setHistory([]);
    setNeedsOnboarding(false);
    setBootError(null);
    // The local session id is kept so the next sign-in reclaims the same session.
  }, []);

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
          // The foreman created/revised an order; reflect it immediately and
          // refetch the list so a freshly-issued order joins the history.
          replaceOrder(order);
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
    [llm, loadOrders, patchMessage, replaceOrder, sending, session],
  );

  const workOrders = useMemo<WorkOrderActions>(() => {
    const sid = (): string => {
      if (session === null) {
        throw new Error('No active session.');
      }
      return session.id;
    };
    return {
      transition: async (id, action, options) => {
        replaceOrder(await transitionWorkOrder(sid(), id, action, options));
      },
      setMaterial: async (id, materialId, checked) => {
        replaceOrder(await setMaterialChecked(sid(), id, materialId, checked));
      },
      setStep: async (id, stepId, checked) => {
        replaceOrder(await setStepChecked(sid(), id, stepId, checked));
      },
      setMachine: async (id, machineId, builtCount) => {
        replaceOrder(await setMachineBuiltCount(sid(), id, machineId, builtCount));
      },
      acknowledge: async (id, revisionNumber) => {
        replaceOrder(await acknowledgeRevision(sid(), id, revisionNumber));
      },
      revert: async (id, revisionNumber) => {
        replaceOrder(await revertToRevision(sid(), id, revisionNumber));
      },
      logHours: async (id, hours) => {
        replaceOrder(await logHours(sid(), id, hours));
      },
    };
  }, [replaceOrder, session]);

  const completeOnboarding = useCallback(
    async (input: { personality: string; pioneerProfile: string }) => {
      // Reuse an existing empty session (e.g. one left behind by an abandoned
      // first run) rather than orphaning it; otherwise create a fresh one.
      const onboarded =
        session !== null ? await patchSession(session.id, input) : await createSession(input);
      writeStorage(SESSION_KEY, onboarded.id);
      setSession(onboarded);
      setNeedsOnboarding(false);
      await loadOrders(onboarded.id);
    },
    [loadOrders, session],
  );

  const saveSettings = useCallback(
    async (input: { personality: string; pioneerProfile: string; llm: LlmSettings }) => {
      // The user's own provider key, held only in their browser so they need not
      // re-enter it each visit. It is sent solely as the request header they
      // authorised and never persisted server-side. localStorage is clear-text
      // by nature; this at-rest exposure is an accepted trade-off for a key the
      // user owns on their own machine.
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
    authStatus,
    user,
    signIn,
    signUp,
    signOut,
    session,
    messages,
    currentOrder,
    history,
    workOrders,
    sending,
    booting,
    needsOnboarding,
    bootError,
    llm,
    keyNeeded,
    send,
    completeOnboarding,
    saveSettings,
  };
}
