import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveTrustedOrigins } from '../src/auth.js';

/** Builds a Request carrying the given headers (Origin / Host / forwarded). */
function req(headers: Record<string, string>): Request {
  return new Request('http://internal/api/auth/sign-up/email', { method: 'POST', headers });
}

const ENV_KEY = 'AUTH_TRUSTED_ORIGINS';
let saved: string | undefined;

beforeEach(() => {
  saved = process.env[ENV_KEY];
  delete process.env[ENV_KEY];
});

afterEach(() => {
  if (saved === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = saved;
  }
});

describe('resolveTrustedOrigins', () => {
  it('trusts a same-origin request (Origin host matches Host)', () => {
    const result = resolveTrustedOrigins(
      req({ origin: 'http://192.168.0.5:8080', host: '192.168.0.5:8080' }),
    );
    expect(result).toContain('http://192.168.0.5:8080');
  });

  it('preserves the scheme the browser sent (https behind a TLS proxy)', () => {
    const result = resolveTrustedOrigins(
      req({ origin: 'https://foreman.example.com', host: 'foreman.example.com' }),
    );
    expect(result).toContain('https://foreman.example.com');
  });

  it('prefers X-Forwarded-Host when present', () => {
    const result = resolveTrustedOrigins(
      req({
        origin: 'https://foreman.example.com',
        host: 'internal:8724',
        'x-forwarded-host': 'foreman.example.com',
      }),
    );
    expect(result).toContain('https://foreman.example.com');
  });

  it('does NOT trust a cross-site Origin (host mismatch)', () => {
    const result = resolveTrustedOrigins(
      req({ origin: 'https://evil.example.com', host: '192.168.0.5:8080' }),
    );
    expect(result).not.toContain('https://evil.example.com');
    expect(result).toHaveLength(0);
  });

  it('always includes explicitly configured AUTH_TRUSTED_ORIGINS', () => {
    process.env[ENV_KEY] = 'https://a.example.com, https://b.example.com';
    const result = resolveTrustedOrigins(
      req({ origin: 'https://evil.example.com', host: '192.168.0.5:8080' }),
    );
    expect(result).toEqual(['https://a.example.com', 'https://b.example.com']);
  });

  it('returns only the configured list when there is no request', () => {
    process.env[ENV_KEY] = 'https://a.example.com';
    expect(resolveTrustedOrigins(undefined)).toEqual(['https://a.example.com']);
  });

  it('ignores a malformed Origin header', () => {
    const result = resolveTrustedOrigins(req({ origin: 'not a url', host: 'h:1' }));
    expect(result).toHaveLength(0);
  });
});
