import { describe, expect, it } from 'vitest';

import { parseFrame, parseSseStream } from './sse.js';

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

describe('parseFrame', () => {
  it('reads the event name and data payload', () => {
    expect(parseFrame('event: text\ndata: {"delta":"hi"}')).toEqual({
      event: 'text',
      data: '{"delta":"hi"}',
    });
  });

  it('defaults the event name to message', () => {
    expect(parseFrame('data: plain')).toEqual({ event: 'message', data: 'plain' });
  });

  it('joins multiple data lines with newlines', () => {
    expect(parseFrame('event: x\ndata: a\ndata: b')?.data).toBe('a\nb');
  });

  it('returns null for frames with no data (comments / keep-alives)', () => {
    expect(parseFrame(': keep-alive')).toBeNull();
  });
});

describe('parseSseStream', () => {
  it('yields events split across chunk boundaries', async () => {
    const stream = streamOf([
      'event: text\nda',
      'ta: {"delta":"he',
      'llo"}\n\nevent: done\ndata: {}\n\n',
    ]);
    const events: string[] = [];
    for await (const event of parseSseStream(stream)) {
      events.push(`${event.event}:${event.data}`);
    }
    expect(events).toEqual(['text:{"delta":"hello"}', 'done:{}']);
  });

  it('handles several events in one chunk', async () => {
    const stream = streamOf([
      'event: tool_use\ndata: {"name":"get_recipe"}\n\nevent: text\ndata: {"delta":"ok"}\n\n',
    ]);
    const names: string[] = [];
    for await (const event of parseSseStream(stream)) {
      names.push(event.event);
    }
    expect(names).toEqual(['tool_use', 'text']);
  });
});
