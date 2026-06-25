import { useRef, useState } from 'react';

import type { Foreman } from '../api/types.js';
import type { NewPlaythroughInput } from '../useForeman.js';

interface NewPlaythroughModalProps {
  foremen: Foreman[];
  onCreateForeman: (input: { name: string; personality?: string }) => Promise<Foreman>;
  onCreate: (input: NewPlaythroughInput) => Promise<void>;
  onClose: () => void;
}

const CREATE_NEW = '__new__';

/**
 * Lightweight "new playthrough" flow: name it, pick (or create) a foreman,
 * optionally drop in a `.sav` (the name defaults from the save when left blank),
 * and optionally describe the pioneer's play style for this run.
 */
export function NewPlaythroughModal({
  foremen,
  onCreateForeman,
  onCreate,
  onClose,
}: NewPlaythroughModalProps): React.JSX.Element {
  const [name, setName] = useState('');
  // Default to creating a foreman when the user has none yet.
  const [foremanChoice, setForemanChoice] = useState(foremen[0]?.id ?? CREATE_NEW);
  const [newForemanName, setNewForemanName] = useState('');
  const [newForemanPersonality, setNewForemanPersonality] = useState('');
  const [pioneerProfile, setPioneerProfile] = useState('');
  const [saveFile, setSaveFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const creatingForeman = foremanChoice === CREATE_NEW;
  const canCreate = creatingForeman ? newForemanName.trim().length > 0 : foremanChoice.length > 0;

  const pickFile = (files: FileList | null): void => {
    const file = files?.[0];
    if (file !== undefined) {
      setSaveFile(file);
    }
  };

  const create = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      const foremanId = creatingForeman
        ? (
            await onCreateForeman({
              name: newForemanName.trim(),
              personality: newForemanPersonality,
            })
          ).id
        : foremanChoice;
      await onCreate({
        foremanId,
        name: name.trim() || undefined,
        pioneerProfile: pioneerProfile.trim() || undefined,
        saveFile: saveFile ?? undefined,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the playthrough.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-label="New playthrough"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>New playthrough</h2>
        <p className="hint">
          Pick a foreman and optionally upload a save. Leave the name blank to use the save&apos;s
          name.
        </p>

        <div className="field">
          <label htmlFor="pt-name">Name</label>
          <input
            id="pt-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Iron World (or leave blank to use the save name)"
            autoComplete="off"
          />
        </div>

        <div className="field">
          <label htmlFor="pt-foreman">Foreman</label>
          <select
            id="pt-foreman"
            value={foremanChoice}
            onChange={(e) => setForemanChoice(e.target.value)}
          >
            {foremen.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
            <option value={CREATE_NEW}>+ Create new foreman…</option>
          </select>
        </div>

        {creatingForeman ? (
          <>
            <div className="field">
              <label htmlFor="pt-fname">New foreman name</label>
              <input
                id="pt-fname"
                value={newForemanName}
                onChange={(e) => setNewForemanName(e.target.value)}
                placeholder="e.g. ADA"
                autoComplete="off"
              />
            </div>
            <div className="field">
              <label htmlFor="pt-fpersona">New foreman personality</label>
              <textarea
                id="pt-fpersona"
                value={newForemanPersonality}
                onChange={(e) => setNewForemanPersonality(e.target.value)}
                placeholder="e.g. Gruff, no-nonsense shift boss who respects competence."
              />
            </div>
          </>
        ) : null}

        <div className="field">
          <label htmlFor="pt-save">Save file (optional)</label>
          <div
            className={`dropzone${dragging ? ' dragging' : ''}`}
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              pickFile(e.dataTransfer.files);
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                fileInput.current?.click();
              }
            }}
          >
            {saveFile !== null ? (
              <span className="dropzone-file">{saveFile.name}</span>
            ) : (
              <span className="dropzone-hint">Drop a .sav here, or click to choose a file</span>
            )}
          </div>
          <input
            id="pt-save"
            ref={fileInput}
            type="file"
            accept=".sav"
            hidden
            onChange={(e) => pickFile(e.target.files)}
          />
        </div>

        <div className="field">
          <label htmlFor="pt-profile">Pioneer profile (optional)</label>
          <textarea
            id="pt-profile"
            value={pioneerProfile}
            onChange={(e) => setPioneerProfile(e.target.value)}
            placeholder="e.g. Returning player, goal-oriented, wants direction but room to build."
          />
        </div>

        {error !== null ? <p className="err">{error}</p> : null}

        <div className="actions">
          <button type="button" className="icon-button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="send"
            onClick={() => void create()}
            disabled={!canCreate || submitting}
          >
            {submitting ? 'Creating' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
