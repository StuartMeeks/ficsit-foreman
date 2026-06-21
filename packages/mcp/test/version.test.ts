import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseDocsFile } from '../src/parser/index.js';

function tempDocsDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'foreman-ver-'));
}

describe('version detection', () => {
  it('reads gameVersion from a meta.json sidecar', () => {
    const dir = tempDocsDir();
    fs.writeFileSync(path.join(dir, 'en-US.json'), '[]');
    fs.writeFileSync(
      path.join(dir, 'meta.json'),
      JSON.stringify({ gameVersion: '1.2.3.0', build: 493833, channel: 'stable' }),
    );
    expect(parseDocsFile(path.join(dir, 'en-US.json')).gameData.version).toBe('1.2.3.0');
  });

  it('falls back to "unknown" when no metadata is present', () => {
    const dir = tempDocsDir();
    fs.writeFileSync(path.join(dir, 'en-US.json'), '[]');
    expect(parseDocsFile(path.join(dir, 'en-US.json')).gameData.version).toBe('unknown');
  });
});
