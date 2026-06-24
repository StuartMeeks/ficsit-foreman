import { base32 } from '@better-auth/utils/base32';
import { createOTP } from '@better-auth/utils/otp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAuth, type Auth } from '../src/auth.js';
import { createTestDb, type TestDb } from './helpers.js';

let db: TestDb;
let auth: Auth;

const PASSWORD = 'password1234';

beforeAll(async () => {
  db = await createTestDb();
  auth = createAuth(db.prisma);
});

afterAll(async () => {
  await db.cleanup();
});

/** A tiny cookie jar: accumulates Set-Cookie across calls into a Cookie header. */
function makeJar(): { update: (res: Response) => void; header: () => Headers } {
  const jar = new Map<string, string>();
  return {
    update: (res: Response): void => {
      for (const c of res.headers.getSetCookie()) {
        const [pair] = c.split(';');
        const eq = pair?.indexOf('=') ?? -1;
        if (pair !== undefined && eq > 0) {
          jar.set(pair.slice(0, eq), pair.slice(eq + 1));
        }
      }
    },
    header: (): Headers =>
      new Headers({
        cookie: [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; '),
      }),
  };
}

/** Better Auth stores a raw secret; the otpauth URI carries its base32 form. */
function totpFor(totpURI: string): Promise<string> {
  const uriSecret = new URL(totpURI).searchParams.get('secret') ?? '';
  const raw = new TextDecoder().decode(base32.decode(uriSecret));
  return createOTP(raw).totp();
}

/** Signs up a fresh user and returns its session jar + the enrolment data. */
async function enrolUser(email: string): Promise<{
  jar: ReturnType<typeof makeJar>;
  totpURI: string;
  backupCodes: string[];
}> {
  const jar = makeJar();
  const signUp = await auth.api.signUpEmail({
    body: { name: 'Pioneer', email, password: PASSWORD },
    asResponse: true,
  });
  jar.update(signUp);
  const enrol = await auth.api.enableTwoFactor({
    body: { password: PASSWORD },
    headers: jar.header(),
  });
  const totpURI = (enrol as { totpURI: string }).totpURI;
  const backupCodes = (enrol as { backupCodes: string[] }).backupCodes;
  // Confirm a code to actually switch 2FA on.
  const verify = await auth.api.verifyTOTP({
    body: { code: await totpFor(totpURI), trustDevice: false },
    headers: jar.header(),
    asResponse: true,
  });
  jar.update(verify);
  return { jar, totpURI, backupCodes };
}

describe('two-factor (MFA)', () => {
  it('enables 2FA and then requires a second factor at sign-in', async () => {
    const email = 'mfa-a@example.com';
    await enrolUser(email);

    const user = await db.prisma.user.findUnique({ where: { email } });
    expect(user?.twoFactorEnabled).toBe(true);

    const signIn = await auth.api.signInEmail({ body: { email, password: PASSWORD } });
    expect((signIn as { twoFactorRedirect?: boolean }).twoFactorRedirect).toBe(true);
  });

  it('completes a pending sign-in with a TOTP code', async () => {
    const email = 'mfa-b@example.com';
    const { totpURI } = await enrolUser(email);

    const jar = makeJar();
    const signIn = await auth.api.signInEmail({
      body: { email, password: PASSWORD },
      asResponse: true,
    });
    jar.update(signIn);

    const verify = await auth.api.verifyTOTP({
      body: { code: await totpFor(totpURI), trustDevice: false },
      headers: jar.header(),
      asResponse: true,
    });
    jar.update(verify);

    const session = await auth.api.getSession({ headers: jar.header() });
    expect(session?.user?.email).toBe(email);
  });

  it('completes a pending sign-in with a single-use backup code', async () => {
    const email = 'mfa-c@example.com';
    const { backupCodes } = await enrolUser(email);

    const jar = makeJar();
    const signIn = await auth.api.signInEmail({
      body: { email, password: PASSWORD },
      asResponse: true,
    });
    jar.update(signIn);

    const verify = await auth.api.verifyBackupCode({
      body: { code: backupCodes[0] ?? '', trustDevice: false },
      headers: jar.header(),
      asResponse: true,
    });
    jar.update(verify);

    const session = await auth.api.getSession({ headers: jar.header() });
    expect(session?.user?.email).toBe(email);
  });

  it('skips the second factor on a trusted device', async () => {
    const email = 'mfa-d@example.com';
    const { totpURI } = await enrolUser(email);

    // Sign in and verify with trustDevice: true — the response sets a trust cookie.
    const jar = makeJar();
    const signIn = await auth.api.signInEmail({
      body: { email, password: PASSWORD },
      asResponse: true,
    });
    jar.update(signIn);
    const verify = await auth.api.verifyTOTP({
      body: { code: await totpFor(totpURI), trustDevice: true },
      headers: jar.header(),
      asResponse: true,
    });
    jar.update(verify);

    // A fresh sign-in carrying the trust cookie should NOT demand a second factor.
    const again = await auth.api.signInEmail({
      body: { email, password: PASSWORD },
      headers: jar.header(),
    });
    expect((again as { twoFactorRedirect?: boolean }).twoFactorRedirect ?? false).toBe(false);
  });
});
