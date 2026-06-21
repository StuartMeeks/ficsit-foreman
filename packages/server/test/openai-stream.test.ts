import { describe, expect, it } from 'vitest';

import { consumeOpenAiStream, type OpenAiStreamChunk } from '../src/llm/openai.js';
import type { LlmStreamEvent } from '../src/llm/types.js';

async function* chunks(items: OpenAiStreamChunk[]): AsyncGenerator<OpenAiStreamChunk> {
  for (const item of items) {
    yield item;
  }
}

function textChunk(content: string, finish: string | null = null): OpenAiStreamChunk {
  return { choices: [{ delta: { content }, finish_reason: finish }] };
}

describe('consumeOpenAiStream', () => {
  it('accumulates text deltas in order and finishes with stop', async () => {
    const events: LlmStreamEvent[] = [];
    const result = await consumeOpenAiStream(
      chunks([textChunk('Hello '), textChunk('there.', 'stop')]),
      (e) => events.push(e),
    );
    expect(result.text).toBe('Hello there.');
    expect(result.stopReason).toBe('stop');
    expect(result.toolCalls).toEqual([]);
    expect(events.filter((e) => e.type === 'text').map((e) => (e.type === 'text' ? e.delta : ''))).toEqual([
      'Hello ',
      'there.',
    ]);
  });

  it('reassembles multiple tool calls with arguments split across chunks', async () => {
    const result = await consumeOpenAiStream(
      chunks([
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'a', function: { name: 'get_item', arguments: '{"name":' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"Iron"}' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 1, id: 'b', function: { name: 'get_recipe', arguments: '{"name":"Plate"}' } }] } }] },
        { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      ]),
      () => {},
    );
    expect(result.stopReason).toBe('tool_use');
    expect(result.toolCalls).toEqual([
      { id: 'a', name: 'get_item', arguments: { name: 'Iron' } },
      { id: 'b', name: 'get_recipe', arguments: { name: 'Plate' } },
    ]);
  });

  it('handles a tool-only turn with no text content', async () => {
    const result = await consumeOpenAiStream(
      chunks([
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'x', function: { name: 'list_schematics', arguments: '' } }] }, finish_reason: 'tool_calls' }] },
      ]),
      () => {},
    );
    expect(result.text).toBe('');
    expect(result.toolCalls).toEqual([{ id: 'x', name: 'list_schematics', arguments: {} }]);
    expect(result.stopReason).toBe('tool_use');
  });

  it('treats empty/whitespace arguments as an empty object without throwing', async () => {
    const result = await consumeOpenAiStream(
      chunks([
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'y', function: { name: 'noargs', arguments: '   ' } }] }, finish_reason: 'tool_calls' }] },
      ]),
      () => {},
    );
    expect(result.toolCalls).toEqual([{ id: 'y', name: 'noargs', arguments: {} }]);
  });
});
