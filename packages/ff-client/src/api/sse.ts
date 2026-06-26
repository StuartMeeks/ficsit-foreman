// Minimal Server-Sent Events parser for the chat stream. The backend frames
// events as `event: <name>\n` + one or more `data: <text>\n` lines, terminated
// by a blank line. EventSource only supports GET, so we read the POST response
// body ourselves.

export interface SseEvent {
  event: string;
  data: string;
}

/**
 * Parses a single SSE frame (the text between blank-line separators). Returns
 * null for frames with no data lines (e.g. comments/keep-alives). Exported for
 * testing.
 */
export function parseFrame(raw: string): SseEvent | null {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      // A single leading space after the colon is part of the framing, not data.
      dataLines.push(line.slice('data:'.length).replace(/^ /, ''));
    }
  }
  if (dataLines.length === 0) {
    return null;
  }
  return { event, data: dataLines.join('\n') };
}

/**
 * Reads a response body stream and yields decoded SSE events as they arrive,
 * buffering across chunk boundaries so a frame split mid-stream is reassembled.
 */
export async function* parseSseStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<SseEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let separator = buffer.indexOf('\n\n');
      while (separator !== -1) {
        const frame = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        const event = parseFrame(frame);
        if (event !== null) {
          yield event;
        }
        separator = buffer.indexOf('\n\n');
      }
    }
  } finally {
    reader.releaseLock();
  }
}
