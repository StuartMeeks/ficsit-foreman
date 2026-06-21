import { describe, expect, it } from 'vitest';

import { clientLlmConfig, resolveServerConfig } from '../src/config.js';

describe('resolveServerConfig', () => {
  it('defaults to anthropic with the legacy key header', () => {
    const config = resolveServerConfig({});
    expect(config.providerKind).toBe('anthropic');
    expect(config.model).toBe('claude-sonnet-4-6');
    expect(config.summaryModel).toBe('claude-haiku-4-5');
    expect(config.clientKeyHeader).toBe('x-anthropic-api-key');
  });

  it('honours the legacy ANTHROPIC_* env (back-compat)', () => {
    const config = resolveServerConfig({
      ANTHROPIC_API_KEY: 'sk-ant-test',
      ANTHROPIC_MODEL: 'claude-custom',
      ANTHROPIC_MAX_TOKENS: '2048',
    });
    expect(config.providerKind).toBe('anthropic');
    expect(config.model).toBe('claude-custom');
    expect(config.maxTokens).toBe(2048);
    expect(config.hostedApiKey).toBe('sk-ant-test');
  });

  it('resolves an OpenAI-compatible provider with a base URL', () => {
    const config = resolveServerConfig({
      LLM_PROVIDER: 'openai',
      LLM_BASE_URL: 'https://openrouter.ai/api/v1',
      OPENAI_API_KEY: 'sk-oai-test',
    });
    expect(config.providerKind).toBe('openai');
    expect(config.model).toBe('gpt-4.1');
    expect(config.summaryModel).toBe('gpt-4.1-mini');
    expect(config.baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(config.hostedApiKey).toBe('sk-oai-test');
  });

  it('prefers LLM_* over legacy ANTHROPIC_* when both are set', () => {
    const config = resolveServerConfig({ LLM_MODEL: 'llm-model', ANTHROPIC_MODEL: 'legacy' });
    expect(config.model).toBe('llm-model');
  });
});

describe('clientLlmConfig override', () => {
  it('switches provider and falls back to that provider defaults', () => {
    const server = resolveServerConfig({}); // anthropic default
    const resolved = clientLlmConfig(server, { provider: 'openai' }, 'sk-client');
    expect(resolved.providerKind).toBe('openai');
    expect(resolved.model).toBe('gpt-4.1');
    expect(resolved.summaryModel).toBe('gpt-4.1-mini');
    expect(resolved.apiKey).toBe('sk-client');
  });

  it('keeps the server model when the provider is unchanged', () => {
    const server = resolveServerConfig({ ANTHROPIC_MODEL: 'claude-custom' });
    const resolved = clientLlmConfig(server, {}, 'sk-client');
    expect(resolved.providerKind).toBe('anthropic');
    expect(resolved.model).toBe('claude-custom');
  });
});
