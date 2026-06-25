import { useCallback, useEffect, useRef, useState } from 'react';

import { AuthScreen } from './components/AuthScreen.js';
import { ChatColumn } from './components/ChatColumn.js';
import { Header } from './components/Header.js';
import { Onboarding } from './components/Onboarding.js';
import { SecurityDialog } from './components/SecurityDialog.js';
import { SettingsDialog } from './components/SettingsDialog.js';
import { WorkOrderPanel } from './components/WorkOrderPanel.js';
import { useForeman } from './useForeman.js';

const SPLIT_KEY = 'foreman.chatSplit';
const MIN_PCT = 20;
const MAX_PCT = 75;

function clampPct(value: number): number {
  return Math.min(MAX_PCT, Math.max(MIN_PCT, value));
}

function initialSplit(): number {
  try {
    const stored = Number.parseFloat(localStorage.getItem(SPLIT_KEY) ?? '');
    if (Number.isFinite(stored)) {
      return clampPct(stored);
    }
  } catch {
    /* ignore storage failures */
  }
  return 30;
}

export function App(): React.JSX.Element {
  const foreman = useForeman();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [chatPct, setChatPct] = useState(initialSplit);
  const mainRef = useRef<HTMLElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    try {
      localStorage.setItem(SPLIT_KEY, String(chatPct));
    } catch {
      /* ignore storage failures */
    }
  }, [chatPct]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current || mainRef.current === null) {
      return;
    }
    const rect = mainRef.current.getBoundingClientRect();
    setChatPct(clampPct(((e.clientX - rect.left) / rect.width) * 100));
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') {
      setChatPct((p) => clampPct(p - 2));
    } else if (e.key === 'ArrowRight') {
      setChatPct((p) => clampPct(p + 2));
    }
  }, []);

  // Auth check still running: hold on the splash before deciding what to show.
  if (foreman.authStatus === 'loading') {
    return (
      <div className="splash">
        <span className="label">Checking your credentials…</span>
      </div>
    );
  }

  // Signed out: the account gate stands before everything else.
  if (foreman.authStatus === 'anon') {
    return (
      <AuthScreen
        onSignIn={foreman.signIn}
        onSignUp={foreman.signUp}
        onVerifyTotp={foreman.verifyTwoFactor}
        onVerifyBackupCode={foreman.verifyBackupCode}
      />
    );
  }

  if (foreman.booting) {
    return (
      <div className="splash">
        <span className="label">Bringing the foreman online…</span>
      </div>
    );
  }

  if (foreman.needsOnboarding && foreman.bootError === null) {
    return <Onboarding onComplete={foreman.completeOnboarding} />;
  }

  return (
    <div className="app">
      <Header
        playthroughId={foreman.playthrough?.id ?? null}
        userEmail={foreman.user?.email ?? null}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenSecurity={() => setSecurityOpen(true)}
        onSignOut={() => void foreman.signOut()}
      />

      {foreman.keyNeeded ? (
        <div className="banner">
          <span>An API key is required to talk to the foreman.</span>
          <button type="button" onClick={() => setSettingsOpen(true)}>
            Add a key
          </button>
        </div>
      ) : null}

      {foreman.bootError !== null ? (
        <div className="banner">
          <span>{foreman.bootError}</span>
        </div>
      ) : null}

      <main
        className="main"
        ref={mainRef}
        style={{ ['--chat-pct']: `${chatPct}%` } as React.CSSProperties}
      >
        <ChatColumn messages={foreman.messages} sending={foreman.sending} onSend={foreman.send} />
        <div
          className="divider"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize chat and work-order panels"
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onKeyDown={onKeyDown}
        />
        <WorkOrderPanel
          playthroughId={foreman.playthrough?.id ?? null}
          current={foreman.currentOrder}
          history={foreman.history}
          actions={foreman.workOrders}
        />
      </main>

      {settingsOpen ? (
        <SettingsDialog
          playthrough={foreman.playthrough}
          foreman={foreman.foreman}
          llm={foreman.llm}
          onClose={() => setSettingsOpen(false)}
          onSave={foreman.saveSettings}
        />
      ) : null}

      {securityOpen ? (
        <SecurityDialog
          twoFactorEnabled={foreman.user?.twoFactorEnabled ?? false}
          onClose={() => setSecurityOpen(false)}
          onChanged={foreman.refreshUser}
        />
      ) : null}
    </div>
  );
}
