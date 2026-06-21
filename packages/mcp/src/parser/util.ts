import type { RawClass } from './types.js';

/** Collects non-fatal parse warnings. Nothing in the parser ever throws. */
export class Warnings {
  private readonly messages: string[] = [];

  public add(message: string): void {
    this.messages.push(message);
  }

  public all(): string[] {
    return [...this.messages];
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads a string field, returning '' when absent or not a string. */
export function getString(obj: RawClass, key: string): string {
  const value = obj[key];
  return typeof value === 'string' ? value : '';
}

/**
 * Reads a numeric field. Several numbers in the docs are stored as strings
 * (e.g. "6.000000"); both forms are handled. Returns `fallback` when absent
 * or unparseable.
 */
export function getNumber(obj: RawClass, key: string, fallback = 0): number {
  const value = obj[key];
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}
