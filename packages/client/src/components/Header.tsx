interface HeaderProps {
  /** The playthrough switcher control, rendered next to the wordmark. */
  switcher?: React.ReactNode;
  userEmail: string | null;
  onOpenSettings: () => void;
  onOpenSecurity: () => void;
  onSignOut: () => void;
}

/** Global header: wordmark, playthrough switcher, live dot, settings, sign-out. */
export function Header({
  switcher,
  userEmail,
  onOpenSettings,
  onOpenSecurity,
  onSignOut,
}: HeaderProps): React.JSX.Element {
  return (
    <header className="header">
      <div className="wordmark">
        <span className="glyph" aria-hidden="true" />
        FOREMAN
      </div>
      {switcher !== undefined ? <div className="header-switcher">{switcher}</div> : null}
      <div className="spacer" />
      {userEmail !== null ? <span className="label">{userEmail}</span> : null}
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
