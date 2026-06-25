import { useEffect, useState } from 'react';

import type { Playthrough } from '../api/types.js';

interface PlaythroughSwitcherProps {
  playthroughs: Playthrough[];
  current: Playthrough | null;
  onSwitch: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

/** A playthrough's display name: its set name, else a short id fallback. */
export function playthroughLabel(playthrough: Playthrough | null): string {
  if (playthrough === null) {
    return 'No playthrough';
  }
  return playthrough.name !== undefined && playthrough.name.length > 0
    ? playthrough.name
    : `Playthrough ${playthrough.id.slice(0, 8)}`;
}

/**
 * Header dropdown to switch between playthroughs and reach the lifecycle actions
 * (new / rename / delete). The current playthrough's chat history and work
 * orders are resumed by the parent when {@link onSwitch} fires.
 */
export function PlaythroughSwitcher({
  playthroughs,
  current,
  onSwitch,
  onNew,
  onRename,
  onDelete,
}: PlaythroughSwitcherProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');

  // Close the menu (and any rename) whenever the active playthrough changes.
  useEffect(() => {
    setOpen(false);
    setRenaming(false);
  }, [current?.id]);

  const close = (): void => {
    setOpen(false);
    setRenaming(false);
  };

  const beginRename = (): void => {
    setDraft(current?.name ?? '');
    setRenaming(true);
  };

  const commitRename = (): void => {
    const name = draft.trim();
    if (current !== null && name.length > 0) {
      onRename(current.id, name);
    }
    close();
  };

  const confirmDelete = (): void => {
    if (current === null) {
      return;
    }
    const ok = window.confirm(
      `Delete "${playthroughLabel(current)}"? This removes its chat and work orders.`,
    );
    if (ok) {
      onDelete(current.id);
    }
    close();
  };

  return (
    <div className="switcher">
      <button
        type="button"
        className="switcher-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="switcher-name">{playthroughLabel(current)}</span>
        <span className="switcher-caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open ? (
        <>
          <div className="switcher-backdrop" onClick={close} aria-hidden="true" />
          <div className="switcher-menu" role="menu">
            <div className="switcher-list">
              {playthroughs.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  role="menuitemradio"
                  aria-checked={p.id === current?.id}
                  className={`switcher-item${p.id === current?.id ? ' selected' : ''}`}
                  onClick={() => {
                    onSwitch(p.id);
                    close();
                  }}
                >
                  <span className="switcher-tick" aria-hidden="true">
                    {p.id === current?.id ? '✓' : ''}
                  </span>
                  {playthroughLabel(p)}
                </button>
              ))}
            </div>

            <div className="switcher-divider" />

            <button
              type="button"
              className="switcher-action"
              onClick={() => {
                onNew();
                close();
              }}
            >
              + New playthrough
            </button>

            {current !== null && !renaming ? (
              <button type="button" className="switcher-action" onClick={beginRename}>
                ✎ Rename
              </button>
            ) : null}

            {renaming ? (
              <div className="switcher-rename">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      commitRename();
                    } else if (e.key === 'Escape') {
                      setRenaming(false);
                    }
                  }}
                  placeholder="Playthrough name"
                  autoFocus
                />
                <button type="button" className="icon-button" onClick={commitRename}>
                  Save
                </button>
              </div>
            ) : null}

            {current !== null ? (
              <button type="button" className="switcher-action danger" onClick={confirmDelete}>
                🗑 Delete
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
