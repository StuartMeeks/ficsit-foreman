import { useState } from 'react';

import type { Foreman, Playthrough } from '../api/types.js';
import type { LlmSettings } from '../useForeman.js';

interface SettingsDialogProps {
  playthrough: Playthrough | null;
  foreman: Foreman | null;
  llm: LlmSettings;
  onClose: () => void;
  onSave: (input: {
    personality: string;
    pioneerProfile: string;
    llm: LlmSettings;
  }) => Promise<void>;
}

/**
 * Settings: the foreman's personality (stored on the foreman) and the pioneer
 * profile (stored on the playthrough), plus the LLM provider/model/key (held
 * only in this browser). Leave the provider on "Server default" to use whatever
 * the server is configured for.
 */
export function SettingsDialog({
  playthrough,
  foreman,
  llm,
  onClose,
  onSave,
}: SettingsDialogProps): React.JSX.Element {
  const [personality, setPersonality] = useState(foreman?.personality ?? '');
  const [pioneerProfile, setPioneerProfile] = useState(playthrough?.pioneerProfile ?? '');
  const [provider, setProvider] = useState(llm.provider);
  const [model, setModel] = useState(llm.model);
  const [baseUrl, setBaseUrl] = useState(llm.baseUrl);
  const [apiKey, setApiKey] = useState(llm.apiKey);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const modelPlaceholder =
    provider === 'openai'
      ? 'gpt-4.1'
      : provider === 'anthropic'
        ? 'claude-sonnet-4-6'
        : 'server default';

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await onSave({
        personality,
        pioneerProfile,
        llm: { apiKey, provider, model, baseUrl },
      });
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
          <label htmlFor="provider">LLM provider</label>
          <select id="provider" value={provider} onChange={(e) => setProvider(e.target.value)}>
            <option value="">Server default</option>
            <option value="anthropic">Anthropic (Claude)</option>
            <option value="openai">OpenAI-compatible</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="model">Model</label>
          <input
            id="model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={modelPlaceholder}
            autoComplete="off"
          />
        </div>

        {provider === 'openai' ? (
          <div className="field">
            <label htmlFor="baseurl">Base URL (optional)</label>
            <input
              id="baseurl"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
              autoComplete="off"
            />
            <span className="hint">
              For OpenAI-compatible providers: OpenAI, OpenRouter, Gemini (OpenAI-compatible), Azure
              OpenAI. Leave blank for OpenAI.
            </span>
          </div>
        ) : null}

        <div className="field">
          <label htmlFor="apikey">LLM API key</label>
          <input
            id="apikey"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Your provider key (stored only in this browser)"
            autoComplete="off"
          />
          <span className="hint">
            Needed unless the server has its own key. Sent with each message; never stored on the
            server. A key also unlocks the provider/model override above.
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
