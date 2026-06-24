// Authentication client. Wraps the Better Auth React client (cookie-based
// sessions — no token is stored in localStorage) behind small async helpers the
// foreman hook can call. Same-origin: the dev server and the production nginx
// image both proxy /api to the backend, so the default base URL is correct.

import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient();

/** The authenticated user, as the UI needs it. */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

function messageOf(error: { message?: string } | null | undefined, fallback: string): string {
  return error?.message !== undefined && error.message.length > 0 ? error.message : fallback;
}

/** Resolves the current user from the session cookie, or null if signed out. */
export async function fetchCurrentUser(): Promise<AuthUser | null> {
  const { data } = await authClient.getSession();
  if (data?.user === undefined || data.user === null) {
    return null;
  }
  return { id: data.user.id, email: data.user.email, name: data.user.name };
}

/** Creates an account and starts a session. Throws on failure. */
export async function signUp(name: string, email: string, password: string): Promise<AuthUser> {
  const { data, error } = await authClient.signUp.email({ name, email, password });
  if (error !== null || data === null) {
    throw new Error(messageOf(error, 'Could not create the account.'));
  }
  return { id: data.user.id, email: data.user.email, name: data.user.name };
}

/** Signs in with email + password. Throws on failure. */
export async function signIn(email: string, password: string): Promise<AuthUser> {
  const { data, error } = await authClient.signIn.email({ email, password });
  if (error !== null || data === null) {
    throw new Error(messageOf(error, 'Could not sign in.'));
  }
  return { id: data.user.id, email: data.user.email, name: data.user.name };
}

/** Ends the current session. */
export async function signOut(): Promise<void> {
  await authClient.signOut();
}
