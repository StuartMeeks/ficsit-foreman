interface HeaderProps {
  sessionId: string | null;
  onOpenSettings: () => void;
}

/** Global header: wordmark, session indicator, live dot, settings. */
export function Header({ sessionId, onOpenSettings }: HeaderProps): React.JSX.Element {
  const shortId = sessionId !== null ? sessionId.slice(0, 8) : '—';
  return (
    <header className="header">
      <div className="wordmark">
        <span className="glyph" aria-hidden="true" />
        FOREMAN
      </div>
      <div className="spacer" />
      <span className="label">SESSION {shortId}</span>
      <span className="status">
        <span className="pulse-dot" aria-hidden="true" />
        <span className="label">ONLINE</span>
      </span>
      <button type="button" className="icon-button" onClick={onOpenSettings}>
        Settings
      </button>
    </header>
  );
}
