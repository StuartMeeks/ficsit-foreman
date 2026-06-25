interface HeaderProps {
  playthroughId: string | null;
  userEmail: string | null;
  onOpenSettings: () => void;
  onOpenSecurity: () => void;
  onSignOut: () => void;
}

/** Global header: wordmark, playthrough indicator, live dot, settings, sign-out. */
export function Header({
  playthroughId,
  userEmail,
  onOpenSettings,
  onOpenSecurity,
  onSignOut,
}: HeaderProps): React.JSX.Element {
  const shortId = playthroughId !== null ? playthroughId.slice(0, 8) : '—';
  return (
    <header className="header">
      <div className="wordmark">
        <span className="glyph" aria-hidden="true" />
        FOREMAN
      </div>
      <div className="spacer" />
      {userEmail !== null ? <span className="label">{userEmail}</span> : null}
      <span className="label">PLAYTHROUGH {shortId}</span>
      <span className="status">
        <span className="pulse-dot" aria-hidden="true" />
        <span className="label">ONLINE</span>
      </span>
      <button type="button" className="icon-button" onClick={onOpenSettings}>
        Settings
      </button>
      <button type="button" className="icon-button" onClick={onOpenSecurity}>
        Security
      </button>
      <button type="button" className="icon-button" onClick={onSignOut}>
        Sign out
      </button>
    </header>
  );
}
