import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { resolveDocsPath } from '../src/config.js';

/** A data dir guaranteed not to exist, so no bundled channel is found. */
const NO_DATA_DIR = path.join(os.tmpdir(), 'foreman-no-such-data');

function tempDocsFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foreman-cfg-'));
  const file = path.join(dir, 'en-US.json');
  fs.writeFileSync(file, '[]');
  return file;
}

/** Builds a temp data dir with en-US.json under each named channel. */
function tempDataDir(channels: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foreman-data-'));
  for (const channel of channels) {
    fs.mkdirSync(path.join(dir, channel), { recursive: true });
    fs.writeFileSync(path.join(dir, channel, 'en-US.json'), '[]');
  }
  return dir;
}

describe('resolveDocsPath', () => {
  it('prefers SATISFACTORY_DOCS_PATH when the file exists', () => {
    const file = tempDocsFile();
    expect(resolveDocsPath({ SATISFACTORY_DOCS_PATH: file }, NO_DATA_DIR).path).toBe(file);
  });

  it('falls back to SATISFACTORY_GAME_DIR', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'foreman-game-'));
    const docsDir = path.join(root, 'CommunityResources', 'Docs');
    fs.mkdirSync(docsDir, { recursive: true });
    const file = path.join(docsDir, 'en-US.json');
    fs.writeFileSync(file, '[]');
    expect(resolveDocsPath({ SATISFACTORY_GAME_DIR: root }, NO_DATA_DIR).path).toBe(file);
  });

  it('uses the stable channel by default', () => {
    const dataDir = tempDataDir(['stable', 'experimental']);
    const result = resolveDocsPath({}, dataDir);
    expect(result.path).toBe(path.join(dataDir, 'stable', 'en-US.json'));
    expect(result.warning).toContain('stable');
  });

  it('selects the experimental channel when requested', () => {
    const dataDir = tempDataDir(['stable', 'experimental']);
    const result = resolveDocsPath({ SATISFACTORY_GAME_CHANNEL: 'experimental' }, dataDir);
    expect(result.path).toBe(path.join(dataDir, 'experimental', 'en-US.json'));
  });

  it('falls back to the other channel when the requested one is absent', () => {
    const dataDir = tempDataDir(['stable']); // no experimental
    const result = resolveDocsPath({ SATISFACTORY_GAME_CHANNEL: 'experimental' }, dataDir);
    expect(result.path).toBe(path.join(dataDir, 'stable', 'en-US.json'));
    expect(result.warning).toContain('unavailable');
  });

  it('warns and defaults to stable on an invalid channel', () => {
    const dataDir = tempDataDir(['stable']);
    const result = resolveDocsPath({ SATISFACTORY_GAME_CHANNEL: 'nightly' }, dataDir);
    expect(result.path).toBe(path.join(dataDir, 'stable', 'en-US.json'));
    expect(result.warning).toContain('invalid');
  });

  it('warns and returns no path when nothing is available', () => {
    const result = resolveDocsPath({}, NO_DATA_DIR);
    expect(result.path).toBeUndefined();
    expect(result.warning).toBeTruthy();
  });
});
