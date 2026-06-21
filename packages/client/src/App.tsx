import { useState } from 'react';

import { ChatColumn } from './components/ChatColumn.js';
import { Header } from './components/Header.js';
import { SettingsDialog } from './components/SettingsDialog.js';
import { WorkOrderPanel } from './components/WorkOrderPanel.js';
import { useForeman } from './useForeman.js';

export function App(): React.JSX.Element {
  const foreman = useForeman();
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="app">
      <Header
        sessionId={foreman.session?.id ?? null}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {foreman.keyNeeded ? (
        <div className="banner">
          <span>An Anthropic API key is required to talk to the foreman.</span>
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

      <main className="main">
        <ChatColumn messages={foreman.messages} sending={foreman.sending} onSend={foreman.send} />
        <WorkOrderPanel active={foreman.activeWorkOrder} history={foreman.history} />
      </main>

      {settingsOpen ? (
        <SettingsDialog
          session={foreman.session}
          llm={foreman.llm}
          onClose={() => setSettingsOpen(false)}
          onSave={foreman.saveSettings}
        />
      ) : null}
    </div>
  );
}
