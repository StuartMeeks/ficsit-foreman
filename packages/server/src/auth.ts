import type { PrismaClient } from '@prisma/client';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';

/**
 * Maps the database URL to the Prisma provider Better Auth's adapter expects.
 * Mirrors the dev-SQLite / prod-Postgres split the rest of the server uses;
 * anything that isn't a Postgres URL is treated as SQLite (the local default).
 */
function providerFor(databaseUrl: string | undefined): 'sqlite' | 'postgresql' {
  const url = databaseUrl?.trim().toLowerCase() ?? '';
  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) {
    return 'postgresql';
  }
  return 'sqlite';
}

/** Comma-separated origins permitted to send credentialed requests. */
function parseTrustedOrigins(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/**
 * Builds the Better Auth instance over a given Prisma client. Email + password
 * is the primary first factor; passkey / two-factor plugins are added in the
 * MFA slice (#63 Slice 2).
 *
 * Better Auth's own `session` table is mapped to the `AuthSession` Prisma model
 * (`session: { modelName: 'authSession' }`) so it does not collide with our
 * domain `Session` (a play session). Sessions are HttpOnly cookies — no token
 * is exposed to client JavaScript.
 *
 * Taking the client as an argument (rather than importing the singleton) keeps
 * auth on the same dependency-injection footing as the services, so tests can
 * point it at an isolated database.
 *
 * `BETTER_AUTH_SECRET` must be set in any non-dev deployment; without it Better
 * Auth falls back to a development secret (fine for local dev and tests).
 *
 * The return type is inferred rather than annotated: Better Auth's instance type
 * is parameterised by the exact options and is not cleanly nameable, and the
 * inferred type is what gives {@link AuthUser} its precise shape via `$Infer`.
 */
export function createAuth(prisma: PrismaClient) {
  return betterAuth({
    secret: process.env['BETTER_AUTH_SECRET'],
    baseURL: process.env['BETTER_AUTH_URL'],
    basePath: '/api/auth',
    trustedOrigins: parseTrustedOrigins(process.env['AUTH_TRUSTED_ORIGINS']),
    database: prismaAdapter(prisma, { provider: providerFor(process.env['DATABASE_URL']) }),
    emailAndPassword: { enabled: true },
    session: { modelName: 'authSession' },
  });
}

/** The Better Auth instance type. */
export type Auth = ReturnType<typeof createAuth>;

/** The authenticated user shape Better Auth resolves from a session cookie. */
export type AuthUser = Auth['$Infer']['Session']['user'];
