import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  fetchCurrentUser,
  signIn as apiSignIn,
  signOut as apiSignOut,
  signUp as apiSignUp,
  verifyBackupCode as apiVerifyBackupCode,
  verifyTotp as apiVerifyTotp,
  type AuthUser,
} from './api/auth.js';
import {
  acknowledgeRevision,
  claimPlaythrough,
  createForeman,
  createPlaythrough,
  getForeman,
  listWorkOrders,
  logHours,
  patchForeman,
  patchPlaythrough,
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
  type Foreman,
  type Playthrough,
  type WorkOrder,
  type WorkOrderAction,
} from './api/types.js';

const PLAYTHROUGH_KEY = 'foreman.playthroughId';
// Pre-#86 builds stored the working id under this key; read it once as a
// fallback so an existing browser keeps its playthrough after the rename.
const LEGACY_SESSION_KEY = 'foreman.sessionId';
const API_KEY = 'foreman.apiKey';
const PROVIDER_KEY = 'foreman.provider';
const MODEL_KEY = 'foreman.model';
const BASE_URL_KEY = 'foreman.baseUrl';

/** Default name for the foreman minted during onboarding (renamed later, #61). */
const DEFAULT_FOREMAN_NAME = 'Foreman';

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
  /** Resolves `{ twoFactorRequired }`; when true, call {@link verifyTwoFactor}. */
  signIn(email: string, password: string): Promise<{ twoFactorRequired: boolean }>;
  signUp(name: string, email: string, password: string): Promise<void>;
  verifyTwoFactor(code: string, trustDevice: boolean): Promise<void>;
  verifyBackupCode(code: string, trustDevice: boolean): Promise<void>;
  /** Re-reads the current user (e.g. after enabling/disabling MFA). */
  refreshUser(): Promise<void>;
  signOut(): Promise<void>;
  playthrough: Playthrough | null;
  /** The foreman attached to the current playthrough (its persona). */
  foreman: Foreman | null;
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

/** The working playthrough id, falling back to the pre-#86 storage key. */
function readPlaythroughId(): string {
  return readStorage(PLAYTHROUGH_KEY) || readStorage(LEGACY_SESSION_KEY);
}

/**
 * A playthrough is un-onboarded until its foreman carries a personality or it
 * carries a pioneer profile. A playthrough with no resolvable foreman is treated
 * as un-onboarded so the flow re-mints one.
 */
function isUnonboarded(playthrough: Playthrough, foreman: Foreman | null): boolean {
  const persona = foreman?.personality.trim() ?? '';
  return persona.length === 0 && playthrough.pioneerProfile.trim().length === 0;
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
  const [playthrough, setPlaythrough] = useState<Playthrough | null>(null);
  const [foreman, setForeman] = useState<Foreman | null>(null);
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

  const loadOrders = useCallback(async (playthroughId: string) => {
    setHistory(await listWorkOrders(playthroughId));
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
   * Resolves the signed-in user's working playthrough. The browser may hold a
   * local playthrough id from before sign-in (or a prior visit); we claim it for
   * the user (idempotent if already theirs), and fall through to onboarding if it
   * is gone or belongs to someone else. A playthrough counts as onboarded once
   * its foreman carries a personality or it carries a pioneer profile; the
   * playthrough itself is created lazily when onboarding completes.
   */
  const loadPlaythrough = useCallback(async () => {
    const existingId = readPlaythroughId();
    const loaded = existingId ? await claimPlaythrough(existingId) : null;
    if (loaded === null) {
      writeStorage(PLAYTHROUGH_KEY, '');
      setPlaythrough(null);
      setForeman(null);
      setNeedsOnboarding(true);
      return;
    }
    writeStorage(PLAYTHROUGH_KEY, loaded.id);
    const attachedForeman = await getForeman(loaded.foremanId);
    setPlaythrough(loaded);
    setForeman(attachedForeman);
    if (isUnonboarded(loaded, attachedForeman)) {
      setNeedsOnboarding(true);
      return;
    }
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
        await loadPlaythrough();
      } catch (error) {
        setBootError(error instanceof Error ? error.message : 'Failed to start a playthrough.');
      } finally {
        setBooting(false);
      }
    })();
  }, [loadPlaythrough]);

  /** Runs the post-authentication playthrough load, surfacing boot errors. */
  const enterApp = useCallback(
    async (current: AuthUser) => {
      setUser(current);
      setAuthStatus('authed');
      setBootError(null);
      setBooting(true);
      try {
        await loadPlaythrough();
      } catch (error) {
        setBootError(error instanceof Error ? error.message : 'Failed to start a playthrough.');
      } finally {
        setBooting(false);
      }
    },
    [loadPlaythrough],
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      const result = await apiSignIn(email, password);
      if (result.kind === 'twoFactor') {
        // MFA enabled: hold here until the second factor is verified.
        return { twoFactorRequired: true };
      }
      await enterApp(result.user);
      return { twoFactorRequired: false };
    },
    [enterApp],
  );

  const verifyTwoFactor = useCallback(
    async (code: string, trustDevice: boolean) => {
      await enterApp(await apiVerifyTotp(code, trustDevice));
    },
    [enterApp],
  );

  const verifyBackupCode = useCallback(
    async (code: string, trustDevice: boolean) => {
      await enterApp(await apiVerifyBackupCode(code, trustDevice));
    },
    [enterApp],
  );

  const signUp = useCallback(
    async (name: string, email: string, password: string) => {
      await enterApp(await apiSignUp(name, email, password));
    },
    [enterApp],
  );

  const refreshUser = useCallback(async () => {
    setUser(await fetchCurrentUser());
  }, []);

  const signOut = useCallback(async () => {
    await apiSignOut();
    setUser(null);
    setAuthStatus('anon');
    setPlaythrough(null);
    setForeman(null);
    setMessages([]);
    setHistory([]);
    setNeedsOnboarding(false);
    setBootError(null);
    // The local playthrough id is kept so the next sign-in reclaims it.
  }, []);

  const patchMessage = useCallback((id: string, patch: Partial<ChatMsg>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (trimmed.length === 0 || sending || playthrough === null) {
        return;
      }
      const playthroughId = playthrough.id;
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

      void streamChat(playthroughId, trimmed, llm.apiKey || undefined, override, {
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
          void loadOrders(playthroughId);
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
    [llm, loadOrders, patchMessage, replaceOrder, sending, playthrough],
  );

  const workOrders = useMemo<WorkOrderActions>(() => {
    const pid = (): string => {
      if (playthrough === null) {
        throw new Error('No active playthrough.');
      }
      return playthrough.id;
    };
    return {
      transition: async (id, action, options) => {
        replaceOrder(await transitionWorkOrder(pid(), id, action, options));
      },
      setMaterial: async (id, materialId, checked) => {
        replaceOrder(await setMaterialChecked(pid(), id, materialId, checked));
      },
      setStep: async (id, stepId, checked) => {
        replaceOrder(await setStepChecked(pid(), id, stepId, checked));
      },
      setMachine: async (id, machineId, builtCount) => {
        replaceOrder(await setMachineBuiltCount(pid(), id, machineId, builtCount));
      },
      acknowledge: async (id, revisionNumber) => {
        replaceOrder(await acknowledgeRevision(pid(), id, revisionNumber));
      },
      revert: async (id, revisionNumber) => {
        replaceOrder(await revertToRevision(pid(), id, revisionNumber));
      },
      logHours: async (id, hours) => {
        replaceOrder(await logHours(pid(), id, hours));
      },
    };
  }, [replaceOrder, playthrough]);

  const completeOnboarding = useCallback(
    async (input: { personality: string; pioneerProfile: string }) => {
      // Reuse an existing playthrough + foreman (e.g. one left behind by an
      // abandoned first run) rather than orphaning them; otherwise mint a fresh
      // foreman and playthrough. Persona lives on the foreman, profile on the
      // playthrough.
      let nextForeman: Foreman;
      let nextPlaythrough: Playthrough;
      if (playthrough !== null && foreman !== null) {
        nextForeman = await patchForeman(foreman.id, { personality: input.personality });
        nextPlaythrough = await patchPlaythrough(playthrough.id, {
          pioneerProfile: input.pioneerProfile,
        });
      } else {
        nextForeman = await createForeman({
          name: DEFAULT_FOREMAN_NAME,
          personality: input.personality,
        });
        nextPlaythrough = await createPlaythrough({
          foremanId: nextForeman.id,
          pioneerProfile: input.pioneerProfile,
        });
      }
      writeStorage(PLAYTHROUGH_KEY, nextPlaythrough.id);
      setForeman(nextForeman);
      setPlaythrough(nextPlaythrough);
      setNeedsOnboarding(false);
      await loadOrders(nextPlaythrough.id);
    },
    [loadOrders, playthrough, foreman],
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
      if (foreman !== null) {
        setForeman(await patchForeman(foreman.id, { personality: input.personality }));
      }
      if (playthrough !== null) {
        setPlaythrough(
          await patchPlaythrough(playthrough.id, { pioneerProfile: input.pioneerProfile }),
        );
      }
    },
    [playthrough, foreman],
  );

  return {
    authStatus,
    user,
    signIn,
    signUp,
    verifyTwoFactor,
    verifyBackupCode,
    refreshUser,
    signOut,
    playthrough,
    foreman,
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
