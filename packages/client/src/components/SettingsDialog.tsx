import { useState } from 'react';

import type { Foreman, Playthrough } from '../api/types.js';
import type { LlmSettings } from '../useForeman.js';
import { NewForemanModal } from './NewForemanModal.js';
import { PioneerProfileFields } from './PioneerProfile.js';
import { SecurityDialog } from './SecurityDialog.js';

interface SettingsDialogProps {
  playthrough: Playthrough | null;
  foremen: Foreman[];
  llm: LlmSettings;
  /** Whether the account has two-factor enabled (for the Security section). */
  twoFactorEnabled: boolean;
  onClose: () => void;
  onSave: (input: { pioneerProfile: string; llm: LlmSettings }) => Promise<void>;
  onAddForeman: (input: { name: string; personality?: string }) => Promise<Foreman>;
  onEditForeman: (id: string, patch: { name?: string; personality?: string }) => Promise<void>;
  onRemoveForeman: (id: string) => Promise<void>;
  onUseForeman: (id: string) => Promise<void>;
  /** Re-reads the user after MFA is enabled/disabled in the Security section. */
  onRefreshUser: () => Promise<void> | void;
}

type Section = 'playthrough' | 'llm' | 'security' | 'billing';

const SECTIONS: { key: Section; label: string }[] = [
  { key: 'playthrough', label: 'This Playthrough' },
  { key: 'llm', label: 'LLM' },
  { key: 'security', label: 'Security' },
  { key: 'billing', label: 'Billing' },
];

/**
 * Sectioned settings reached from the account menu. "This Playthrough" holds the
 * foreman attached to the active playthrough (with the reusable library, since a
 * persona is shared across every playthrough that uses it) plus the pioneer
 * profile; LLM holds the provider/model/key (kept only in this browser);
 * Security manages two-factor (its setup opens a second-level dialog); Billing
 * is a placeholder. Pioneer profile + LLM are saved together via the footer;
 * foreman edits apply immediately.
 */
export function SettingsDialog({
  playthrough,
  foremen,
  llm,
  twoFactorEnabled,
  onClose,
  onSave,
  onAddForeman,
  onEditForeman,
  onRemoveForeman,
  onUseForeman,
  onRefreshUser,
}: SettingsDialogProps): React.JSX.Element {
  const [section, setSection] = useState<Section>('playthrough');
  const [securityOpen, setSecurityOpen] = useState(false);
  const [pioneerProfile, setPioneerProfile] = useState(playthrough?.pioneerProfile ?? '');
  const [provider, setProvider] = useState(llm.provider);
  const [model, setModel] = useState(llm.model);
  const [baseUrl, setBaseUrl] = useState(llm.baseUrl);
  const [apiKey, setApiKey] = useState(llm.apiKey);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [addingForeman, setAddingForeman] = useState(false);

  // Show the foreman attached to this playthrough first; the rest are the
  // reusable library, switchable via "Use here".
  const attachedFirst = [...foremen].sort(
    (a, b) => Number(b.id === playthrough?.foremanId) - Number(a.id === playthrough?.foremanId),
  );

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
      await onSave({ pioneerProfile, llm: { apiKey, provider, model, baseUrl } });
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

        {section === 'playthrough' ? (
          <div className="settings-section">
            <span className="label">Foreman</span>
            <p className="hint">
              The persona attached to this playthrough is shown first; the rest are your reusable
              library — pick &ldquo;Use here&rdquo; to switch. Editing a persona changes it for
              every playthrough that uses it.
            </p>
            <div className="foreman-list">
              {attachedFirst.map((f) => (
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

            <button type="button" className="icon-button" onClick={() => setAddingForeman(true)}>
              + New foreman
            </button>

            {addingForeman ? (
              <NewForemanModal onCreate={onAddForeman} onClose={() => setAddingForeman(false)} />
            ) : null}

            <div className="settings-subsection">
              <span className="label">Pioneer profile</span>
              <p className="hint">
                Your play style for this playthrough. Takes effect next message.
              </p>
              <PioneerProfileFields value={pioneerProfile} onChange={setPioneerProfile} />
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

        {section === 'security' ? (
          <div className="settings-section">
            <p className="hint">
              Two-factor authentication is{' '}
              <strong>{twoFactorEnabled ? 'enabled' : 'not enabled'}</strong>. When enabled, a code
              from your authenticator app (or a recovery code) is required at every sign-in.
            </p>
            <button type="button" className="icon-button" onClick={() => setSecurityOpen(true)}>
              {twoFactorEnabled ? 'Manage two-factor' : 'Set up two-factor'}
            </button>

            {securityOpen ? (
              <SecurityDialog
                twoFactorEnabled={twoFactorEnabled}
                onChanged={onRefreshUser}
                onClose={() => setSecurityOpen(false)}
              />
            ) : null}
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
