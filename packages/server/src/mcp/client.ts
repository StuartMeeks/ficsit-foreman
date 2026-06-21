import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { logger } from '../logger.js';

/** A tool advertised by the MCP server, in the shape we hand to Anthropic. */
export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the tool's input (Anthropic `input_schema`). */
  inputSchema: Record<string, unknown>;
}

/** The flattened result of invoking an MCP tool. */
export interface ToolInvocationResult {
  /** Tool output text (MCP text content blocks, concatenated). */
  text: string;
  isError: boolean;
}

/**
 * The subset of MCP behaviour the chat loop depends on. Defining it as an
 * interface lets tests substitute a fake gateway without a live MCP server.
 */
export interface McpGateway {
  /** Game data version reported by the MCP server (for stamping work orders). */
  readonly gameVersion: string;
  listTools(): Promise<ToolDefinition[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<ToolInvocationResult>;
}

interface RawToolContent {
  type: string;
  text?: string;
}

/**
 * Connects to the Phase 1 MCP server over Streamable HTTP and exposes its tools
 * to the foreman. The game data version is read once from the server's /health
 * endpoint (derived from the MCP URL) so newly-issued work orders can be tagged
 * with the version they were built for.
 */
export class McpHttpClient implements McpGateway {
  private readonly client: Client;
  private readonly transport: StreamableHTTPClientTransport;
  private connected = false;
  private cachedTools: ToolDefinition[] | undefined;
  private version = 'unknown';

  public constructor(private readonly mcpUrl: string) {
    this.client = new Client({ name: 'foreman-server', version: '0.1.0' });
    this.transport = new StreamableHTTPClientTransport(new URL(mcpUrl));
  }

  public get gameVersion(): string {
    return this.version;
  }

  /** Establishes the MCP session and reads the game data version. Idempotent. */
  public async connect(): Promise<void> {
    if (this.connected) {
      return;
    }
    await this.client.connect(this.transport);
    this.connected = true;
    this.version = await this.fetchVersion();
    logger.info(`Connected to MCP server at ${this.mcpUrl} (game version ${this.version})`);
  }

  public async listTools(): Promise<ToolDefinition[]> {
    if (this.cachedTools !== undefined) {
      return this.cachedTools;
    }
    await this.connect();
    const response = await this.client.listTools();
    this.cachedTools = response.tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? '',
      inputSchema: (tool.inputSchema ?? { type: 'object' }) as Record<string, unknown>,
    }));
    return this.cachedTools;
  }

  public async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolInvocationResult> {
    await this.connect();
    try {
      const result = await this.client.callTool({ name, arguments: args });
      const content = Array.isArray(result.content) ? (result.content as RawToolContent[]) : [];
      const text = content
        .filter((block) => block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('\n');
      return { text: text.length > 0 ? text : '(no output)', isError: result.isError === true };
    } catch (error) {
      logger.error(`MCP tool '${name}' failed:`, error);
      return { text: `Tool '${name}' failed: ${describeError(error)}`, isError: true };
    }
  }

  public async close(): Promise<void> {
    if (!this.connected) {
      return;
    }
    await this.client.close();
    this.connected = false;
  }

  /** Reads the version from the MCP server's HTTP /health sibling endpoint. */
  private async fetchVersion(): Promise<string> {
    try {
      const healthUrl = new URL(this.mcpUrl);
      healthUrl.pathname = healthUrl.pathname.replace(/\/mcp\/?$/, '/health');
      const response = await fetch(healthUrl);
      if (!response.ok) {
        return 'unknown';
      }
      const body = (await response.json()) as { version?: unknown };
      return typeof body.version === 'string' ? body.version : 'unknown';
    } catch (error) {
      logger.warn('Could not read game data version from MCP /health:', describeError(error));
      return 'unknown';
    }
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
