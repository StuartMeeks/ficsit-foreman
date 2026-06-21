import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Shared, mutable state driving the fake SDK. `transports` records every
// transport instance built, so we can assert a fresh one is made per connect.
const state = vi.hoisted(() => ({
  connectAttempts: 0,
  failConnect: false,
  failCall: false,
  transports: [] as { started: boolean; closed: boolean }[],
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => {
  class StreamableHTTPClientTransport {
    public started = false;
    public closed = false;
    public constructor(public readonly url: URL) {
      state.transports.push(this);
    }
    public async start(): Promise<void> {
      if (this.started) {
        throw new Error('StreamableHTTPClientTransport already started!');
      }
      this.started = true;
    }
    public async close(): Promise<void> {
      this.closed = true;
    }
  }
  return { StreamableHTTPClientTransport };
});

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => {
  class Client {
    public constructor(public readonly info: unknown) {}
    public async connect(transport: { start(): Promise<void> }): Promise<void> {
      await transport.start();
      state.connectAttempts += 1;
      if (state.failConnect) {
        throw new Error('initialize failed (server not ready)');
      }
    }
    public async listTools(): Promise<unknown> {
      return { tools: [{ name: 'get_item', description: 'd', inputSchema: { type: 'object' } }] };
    }
    public async callTool(): Promise<unknown> {
      if (state.failCall) {
        throw new Error('transport error');
      }
      return { content: [{ type: 'text', text: 'ok' }], isError: false };
    }
    public async close(): Promise<void> {}
  }
  return { Client };
});

import { McpHttpClient } from '../src/mcp/client.js';

beforeEach(() => {
  state.connectAttempts = 0;
  state.failConnect = false;
  state.failCall = false;
  state.transports = [];
  vi.stubGlobal(
    'fetch',
    async () => ({ ok: true, json: async () => ({ version: '1.2.3.0' }) }) as unknown as Response,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('McpHttpClient reconnect', () => {
  it('recovers after a failed initial connect (no "already started")', async () => {
    const client = new McpHttpClient('http://localhost:8723/mcp');

    state.failConnect = true;
    await expect(client.connect()).rejects.toThrow(/server not ready/);
    expect(state.transports[0]?.closed).toBe(true); // poisoned transport was closed

    // Server is now up: the next use must build a fresh transport and succeed.
    state.failConnect = false;
    const tools = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['get_item']);
    expect(state.transports).toHaveLength(2); // a brand-new transport, not a restart
    expect(client.gameVersion).toBe('1.2.3.0');
  });

  it('shares a single connect across concurrent callers', async () => {
    const client = new McpHttpClient('http://localhost:8723/mcp');
    await Promise.all([client.listTools(), client.callTool('get_item', {})]);
    expect(state.connectAttempts).toBe(1);
    expect(state.transports).toHaveLength(1);
  });

  it('returns an error result and reconnects after a tool failure', async () => {
    const client = new McpHttpClient('http://localhost:8723/mcp');
    state.failCall = true;
    const failed = await client.callTool('get_item', {});
    expect(failed.isError).toBe(true);
    expect(failed.text).toContain('failed');

    // Next call rebuilds the connection and succeeds.
    state.failCall = false;
    const ok = await client.callTool('get_item', {});
    expect(ok.isError).toBe(false);
    expect(state.transports).toHaveLength(2);
  });
});
