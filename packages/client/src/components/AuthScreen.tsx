import { useState } from 'react';

interface AuthScreenProps {
  onSignIn: (email: string, password: string) => Promise<void>;
  onSignUp: (name: string, email: string, password: string) => Promise<void>;
}

type Mode = 'signin' | 'signup';

/**
 * The sign-in / sign-up gate shown before onboarding or the main app. Accounts
 * are required (#63): every pioneer's sessions, work orders and chat history are
 * scoped to their user. Sessions are HttpOnly cookies set by the backend — no
 * credential is stored in the browser. The personality/profile onboarding runs
 * only once authenticated.
 */
export function AuthScreen({ onSignIn, onSignUp }: AuthScreenProps): React.JSX.Element {
  const [mode, setMode] = useState<Mode>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSignUp = mode === 'signup';
  const canSubmit =
    email.trim().length > 0 &&
    password.length > 0 &&
    (!isSignUp || name.trim().length > 0) &&
    !submitting;

  const switchMode = (next: Mode): void => {
    setMode(next);
    setError(null);
  };

  const submit = async (): Promise<void> => {
    if (!canSubmit) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (isSignUp) {
        await onSignUp(name.trim(), email.trim(), password);
      } else {
        await onSignIn(email.trim(), password);
      }
      // On success the app re-renders past this gate; no local reset needed.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Authentication failed.');
      setSubmitting(false);
    }
  };

  return (
    <div className="onboarding">
      <div className="onboarding-shell">
        <div className="onboarding-top">
          <div className="wordmark">
            <span className="glyph" aria-hidden="true" />
            FOREMAN
          </div>
        </div>

        <section className="onboarding-step">
          <span className="label">{isSignUp ? 'Create account' : 'Sign in'}</span>
          <h1 className="onboarding-title">
            {isSignUp ? 'Sign up for duty.' : 'Welcome back, pioneer.'}
          </h1>
          <p className="onboarding-lede">
            {isSignUp
              ? 'Create an account to keep your sessions, work orders and chat history together and to hand.'
              : 'Sign in to pick up where you left off.'}
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            {isSignUp ? (
              <div className="field">
                <label htmlFor="auth-name">Name</label>
                <input
                  id="auth-name"
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
            ) : null}

            <div className="field">
              <label htmlFor="auth-email">Email</label>
              <input
                id="auth-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="auth-password">Password</label>
              <input
                id="auth-password"
                type="password"
                autoComplete={isSignUp ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {error !== null ? <p className="err">{error}</p> : null}

            <div className="onboarding-actions">
              <button type="submit" className="send" disabled={!canSubmit}>
                {submitting
                  ? isSignUp
                    ? 'Creating account'
                    : 'Signing in'
                  : isSignUp
                    ? 'Create account'
                    : 'Sign in'}
              </button>
            </div>
          </form>

          <p className="auth-switch">
            {isSignUp ? 'Already have an account?' : 'New here?'}{' '}
            <button
              type="button"
              className="link-button"
              onClick={() => switchMode(isSignUp ? 'signin' : 'signup')}
            >
              {isSignUp ? 'Sign in' : 'Create an account'}
            </button>
          </p>
        </section>
      </div>
    </div>
  );
}
