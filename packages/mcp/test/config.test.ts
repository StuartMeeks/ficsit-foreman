import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { resolveDocsPath } from '../src/config.js';

/** A path guaranteed not to exist, so the bundled fallback is "absent" in tests. */
const NO_BUNDLED = path.join(os.tmpdir(), 'foreman-no-such-bundled', 'en-US.json');

function tempDocsFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foreman-cfg-'));
  const file = path.join(dir, 'en-US.json');
  fs.writeFileSync(file, '[]');
  return file;
}

describe('resolveDocsPath', () => {
  it('prefers SATISFACTORY_DOCS_PATH when the file exists', () => {
    const file = tempDocsFile();
    expect(resolveDocsPath({ SATISFACTORY_DOCS_PATH: file }, NO_BUNDLED).path).toBe(file);
  });

  it('falls back to SATISFACTORY_GAME_DIR', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'foreman-game-'));
    const docsDir = path.join(root, 'CommunityResources', 'Docs');
    fs.mkdirSync(docsDir, { recursive: true });
    const file = path.join(docsDir, 'en-US.json');
    fs.writeFileSync(file, '[]');
    expect(resolveDocsPath({ SATISFACTORY_GAME_DIR: root }, NO_BUNDLED).path).toBe(file);
  });

  it('uses the bundled fallback when no env var resolves', () => {
    const bundled = tempDocsFile();
    const result = resolveDocsPath({}, bundled);
    expect(result.path).toBe(bundled);
    expect(result.warning).toContain('bundled');
  });

  it('falls through to the bundled fallback when DOCS_PATH is set but missing', () => {
    const bundled = tempDocsFile();
    const result = resolveDocsPath({ SATISFACTORY_DOCS_PATH: '/no/such/en-US.json' }, bundled);
    expect(result.path).toBe(bundled);
    expect(result.warning).toContain('no file exists');
  });

  it('warns and returns no path when nothing is available', () => {
    const result = resolveDocsPath({}, NO_BUNDLED);
    expect(result.path).toBeUndefined();
    expect(result.warning).toBeTruthy();
  });
});
