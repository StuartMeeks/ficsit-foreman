import { useState } from 'react';

import type { Foreman, Playthrough } from '../api/types.js';
import type { LlmSettings } from '../useForeman.js';

interface SettingsDialogProps {
  playthrough: Playthrough | null;
  foremen: Foreman[];
  llm: LlmSettings;
  onClose: () => void;
  onSave: (input: { pioneerProfile: string; llm: LlmSettings }) => Promise<void>;
  onAddForeman: (input: { name: string; personality?: string }) => Promise<unknown>;
  onEditForeman: (id: string, patch: { name?: string; personality?: string }) => Promise<void>;
  onRemoveForeman: (id: string) => Promise<void>;
  onUseForeman: (id: string) => Promise<void>;
}

type Section = 'foremen' | 'pioneer' | 'llm' | 'billing';

const SECTIONS: { key: Section; label: string }[] = [
  { key: 'foremen', label: 'Foremen' },
  { key: 'pioneer', label: 'Pioneer' },
  { key: 'llm', label: 'LLM' },
  { key: 'billing', label: 'Billing' },
];

/**
 * Sectioned settings: the foreman library (reusable personas), the active
 * playthrough's pioneer profile, the LLM provider/model/key (held only in this
 * browser), and a billing placeholder. Pioneer + LLM are saved together via the
 * footer; foreman edits apply immediately (a persona is shared across every
 * playthrough that uses it).
 */
export function SettingsDialog({
  playthrough,
  foremen,
  llm,
  onClose,
  onSave,
  onAddForeman,
  onEditForeman,
  onRemoveForeman,
  onUseForeman,
}: SettingsDialogProps): React.JSX.Element {
  const [section, setSection] = useState<Section>('foremen');
  const [pioneerProfile, setPioneerProfile] = useState(playthrough?.pioneerProfile ?? '');
  const [provider, setProvider] = useState(llm.provider);
  const [model, setModel] = useState(llm.model);
  const [baseUrl, setBaseUrl] = useState(llm.baseUrl);
  const [apiKey, setApiKey] = useState(llm.apiKey);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [addingForeman, setAddingForeman] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPersonality, setNewPersonality] = useState('');

  const modelPlaceholder =
    provider === 'openai'
      ? 'gpt-4.1'
      : provider === 'anthropic'
        ? 'claude-sonnet-4-6'
        : 'server default';

  const guard = (fn: () => Promise<void>): void => {
    setError(null);
    void fn().catch((e: unknown) =>
      setError(e instanceof Error ? e.message : 'Something went wrong.'),
    );
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await onSave({ pioneerProfile, llm: { apiKey, provider, model, baseUrl } });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  };

  const addForeman = (): void => {
    if (newName.trim().length === 0) {
      return;
    }
    guard(async () => {
      await onAddForeman({ name: newName.trim(), personality: newPersonality });
      setNewName('');
      setNewPersonality('');
      setAddingForeman(false);
    });
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="dialog settings-dialog"
        role="dialog"
        aria-label="Settings"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>Settings</h2>

        <div className="settings-tabs" role="tablist">
          {SECTIONS.map((s) => (
            <button
              type="button"
              key={s.key}
              role="tab"
              aria-selected={section === s.key}
              className={`settings-tab${section === s.key ? ' selected' : ''}`}
              onClick={() => setSection(s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>

        {section === 'foremen' ? (
          <div className="settings-section">
            <p className="hint">
              Reusable foreman personas. Editing one changes it for every playthrough that uses it.
            </p>
            <div className="foreman-list">
              {foremen.map((f) => (
                <ForemanRow
                  key={f.id}
                  foreman={f}
                  attached={f.id === playthrough?.foremanId}
                  onEdit={(patch) => onEditForeman(f.id, patch)}
                  onRemove={() => onRemoveForeman(f.id)}
                  onUse={() => onUseForeman(f.id)}
                  onError={setError}
                />
              ))}
            </div>

            {addingForeman ? (
              <div className="foreman-edit">
                <div className="field">
                  <label htmlFor="nf-name">Name</label>
                  <input
                    id="nf-name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g. ADA"
                    autoComplete="off"
                  />
                </div>
                <div className="field">
                  <label htmlFor="nf-persona">Personality</label>
                  <textarea
                    id="nf-persona"
                    value={newPersonality}
                    onChange={(e) => setNewPersonality(e.target.value)}
                    placeholder="e.g. Calm, methodical planner who explains trade-offs."
                  />
                </div>
                <div className="actions">
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => setAddingForeman(false)}
                  >
                    Cancel
                  </button>
                  <button type="button" className="send" onClick={addForeman}>
                    Add foreman
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="icon-button" onClick={() => setAddingForeman(true)}>
                + New foreman
              </button>
            )}
          </div>
        ) : null}

        {section === 'pioneer' ? (
          <div className="settings-section">
            <p className="hint">Your play style for this playthrough. Takes effect next message.</p>
            <div className="field">
              <label htmlFor="pioneer">Pioneer profile</label>
              <textarea
                id="pioneer"
                value={pioneerProfile}
                onChange={(e) => setPioneerProfile(e.target.value)}
                placeholder="e.g. Returning player, goal-oriented, wants direction but room to build."
              />
            </div>
          </div>
        ) : null}

        {section === 'llm' ? (
          <div className="settings-section">
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
                  For OpenAI-compatible providers: OpenAI, OpenRouter, Gemini (OpenAI-compatible),
                  Azure OpenAI. Leave blank for OpenAI.
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
                Needed unless the server has its own key. Sent with each message; never stored on
                the server. A key also unlocks the provider/model override above.
              </span>
            </div>
          </div>
        ) : null}

        {section === 'billing' ? (
          <div className="settings-section">
            <p className="hint">Billing &amp; subscription management is coming soon.</p>
          </div>
        ) : null}

        {error !== null ? <p className="err">{error}</p> : null}

        <div className="actions">
          <button type="button" className="icon-button" onClick={onClose}>
            Close
          </button>
          <button type="button" className="send" onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ForemanRowProps {
  foreman: Foreman;
  attached: boolean;
  onEdit: (patch: { name?: string; personality?: string }) => Promise<void>;
  onRemove: () => Promise<void>;
  onUse: () => Promise<void>;
  onError: (message: string) => void;
}

/** One row in the foreman library: view, inline edit, use-here, delete. */
function ForemanRow({
  foreman,
  attached,
  onEdit,
  onRemove,
  onUse,
  onError,
}: ForemanRowProps): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(foreman.name);
  const [personality, setPersonality] = useState(foreman.personality);

  const guard = (fn: () => Promise<void>): void => {
    void fn().catch((e: unknown) =>
      onError(e instanceof Error ? e.message : 'Something went wrong.'),
    );
  };

  if (editing) {
    return (
      <div className="foreman-edit">
        <div className="field">
          <label htmlFor={`fe-name-${foreman.id}`}>Name</label>
          <input
            id={`fe-name-${foreman.id}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
          />
        </div>
        <div className="field">
          <label htmlFor={`fe-persona-${foreman.id}`}>Personality</label>
          <textarea
            id={`fe-persona-${foreman.id}`}
            value={personality}
            onChange={(e) => setPersonality(e.target.value)}
          />
        </div>
        <div className="actions">
          <button type="button" className="icon-button" onClick={() => setEditing(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="send"
            onClick={() =>
              guard(async () => {
                await onEdit({ name: name.trim(), personality });
                setEditing(false);
              })
            }
          >
            Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="foreman-row">
      <div className="foreman-meta">
        <span className="foreman-name">
          {foreman.name}
          {attached ? <span className="foreman-badge">in use</span> : null}
        </span>
        <span className="foreman-persona">{foreman.personality || 'No personality set.'}</span>
      </div>
      <div className="foreman-actions">
        {!attached ? (
          <button type="button" className="icon-button" onClick={() => guard(onUse)}>
            Use here
          </button>
        ) : null}
        <button type="button" className="icon-button" onClick={() => setEditing(true)}>
          Edit
        </button>
        <button
          type="button"
          className="icon-button danger"
          disabled={attached}
          title={attached ? 'Detach it from this playthrough first.' : 'Delete this foreman'}
          onClick={() => guard(onRemove)}
        >
          Delete
        </button>
      </div>
    </div>
  );
}
