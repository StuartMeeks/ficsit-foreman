import { describe, expect, it } from 'vitest';

import { resolveServerConfig } from '../src/config.js';

describe('resolveServerConfig', () => {
  it('defaults to stdio on port 8723', () => {
    expect(resolveServerConfig({})).toEqual({ transport: 'stdio', host: '0.0.0.0', port: 8723 });
  });

  it('honours http transport, host and port overrides', () => {
    const config = resolveServerConfig({
      MCP_TRANSPORT: 'http',
      MCP_HTTP_HOST: '127.0.0.1',
      MCP_HTTP_PORT: '9000',
    });
    expect(config).toEqual({ transport: 'http', host: '127.0.0.1', port: 9000 });
  });
});
