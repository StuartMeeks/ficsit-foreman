import { useState } from 'react';

import type { Session } from '../api/types.js';

interface SettingsDialogProps {
  session: Session | null;
  apiKey: string;
  onClose: () => void;
  onSave: (input: { personality: string; pioneerProfile: string; apiKey: string }) => Promise<void>;
}

/**
 * Settings: the foreman's personality and the pioneer profile (stored on the
 * session), plus an optional Anthropic API key held only in this browser. A key
 * is needed unless the server is configured with its own.
 */
export function SettingsDialog({
  session,
  apiKey,
  onClose,
  onSave,
}: SettingsDialogProps): React.JSX.Element {
  const [personality, setPersonality] = useState(session?.personality ?? '');
  const [pioneerProfile, setPioneerProfile] = useState(session?.pioneerProfile ?? '');
  const [key, setKey] = useState(apiKey);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await onSave({ personality, pioneerProfile, apiKey: key });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-label="Settings"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>Settings</h2>
        <p className="hint">Changes take effect on your next message.</p>

        <div className="field">
          <label htmlFor="personality">Foreman personality</label>
          <textarea
            id="personality"
            value={personality}
            onChange={(e) => setPersonality(e.target.value)}
            placeholder="e.g. Gruff, no-nonsense shift boss who respects competence and hates wasted time."
          />
        </div>

        <div className="field">
          <label htmlFor="pioneer">Pioneer profile</label>
          <textarea
            id="pioneer"
            value={pioneerProfile}
            onChange={(e) => setPioneerProfile(e.target.value)}
            placeholder="e.g. Returning player, goal-oriented, wants direction but room to build."
          />
        </div>

        <div className="field">
          <label htmlFor="apikey">Anthropic API key</label>
          <input
            id="apikey"
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="sk-ant-…  (stored only in this browser)"
            autoComplete="off"
          />
          <span className="hint">
            Only needed if the server has no key of its own. Sent with each message; never stored on
            the server.
          </span>
        </div>

        {error !== null ? <p className="err">{error}</p> : null}

        <div className="actions">
          <button type="button" className="icon-button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="send" onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
