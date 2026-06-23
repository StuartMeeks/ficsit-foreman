import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { expandHome, resolveSavePath, resolveServerConfig } from '../src/config.js';

describe('resolveServerConfig', () => {
  it('defaults to stdio on 0.0.0.0:8726', () => {
    expect(resolveServerConfig({})).toEqual({ transport: 'stdio', host: '0.0.0.0', port: 8726 });
  });

  it('honours http overrides', () => {
    const config = resolveServerConfig({
      MCP_TRANSPORT: 'http',
      MCP_HTTP_HOST: '127.0.0.1',
      MCP_HTTP_PORT: '9001',
    });
    expect(config).toEqual({ transport: 'http', host: '127.0.0.1', port: 9001 });
  });
});

describe('resolveSavePath', () => {
  it('warns and returns no path when SAVE_FILE_PATH is unset', () => {
    const result = resolveSavePath({});
    expect(result.path).toBeUndefined();
    expect(result.warning).toMatch(/not set/);
  });

  it('warns when the configured file does not exist', () => {
    const result = resolveSavePath({ SAVE_FILE_PATH: '/nonexistent/Save.sav' });
    expect(result.path).toBeUndefined();
    expect(result.warning).toMatch(/no file exists/);
  });

  it('returns the path when the file exists', () => {
    const existing = fileURLToPath(import.meta.url); // this test file certainly exists
    expect(resolveSavePath({ SAVE_FILE_PATH: existing })).toEqual({ path: existing });
  });
});

describe('expandHome', () => {
  it('expands a leading ~/', () => {
    expect(expandHome('~/saves/x.sav').startsWith('~')).toBe(false);
  });

  it('leaves absolute paths untouched', () => {
    expect(expandHome('/abs/path.sav')).toBe('/abs/path.sav');
  });
});
