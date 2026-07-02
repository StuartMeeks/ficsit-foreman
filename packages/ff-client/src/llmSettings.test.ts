import { describe, expect, it } from 'vitest';

import { MAX_HISTORY_WINDOW, MIN_HISTORY_WINDOW, parseHistoryWindow } from './llmSettings.js';

describe('parseHistoryWindow', () => {
  it('returns 0 (server default) for blank or non-numeric input', () => {
    expect(parseHistoryWindow('')).toBe(0);
    expect(parseHistoryWindow('   ')).toBe(0);
    expect(parseHistoryWindow('abc')).toBe(0);
  });

  it('returns 0 for zero and negative values', () => {
    expect(parseHistoryWindow('0')).toBe(0);
    expect(parseHistoryWindow('-5')).toBe(0);
  });

  it('clamps to the server-accepted range', () => {
    expect(parseHistoryWindow('1')).toBe(MIN_HISTORY_WINDOW);
    expect(parseHistoryWindow('9999')).toBe(MAX_HISTORY_WINDOW);
  });

  it('passes in-range values through, ignoring whitespace', () => {
    expect(parseHistoryWindow('20')).toBe(20);
    expect(parseHistoryWindow(' 42 ')).toBe(42);
    expect(parseHistoryWindow(String(MIN_HISTORY_WINDOW))).toBe(MIN_HISTORY_WINDOW);
    expect(parseHistoryWindow(String(MAX_HISTORY_WINDOW))).toBe(MAX_HISTORY_WINDOW);
  });
});
