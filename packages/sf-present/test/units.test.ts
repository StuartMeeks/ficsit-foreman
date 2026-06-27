import { describe, expect, it } from 'vitest';

import { cmToMetres, compassBearing, metresToCm } from '../src/units.js';

describe('unit conversion', () => {
  it('converts centimetres to metres exactly (no rounding)', () => {
    expect(cmToMetres(100)).toBe(1);
    expect(cmToMetres(128784.40625)).toBe(1287.8440625);
  });

  it('round-trips metres → centimetres', () => {
    expect(metresToCm(1)).toBe(100);
    expect(cmToMetres(metresToCm(42.5))).toBe(42.5);
  });
});

describe('compassBearing', () => {
  it('reads Satisfactory world axes (+X East, +Y South)', () => {
    const origin = { x: 0, y: 0 };
    expect(compassBearing(origin, { x: 100, y: 0 })).toBe('E');
    expect(compassBearing(origin, { x: 0, y: 100 })).toBe('S');
    expect(compassBearing(origin, { x: 0, y: -100 })).toBe('N');
    expect(compassBearing(origin, { x: -100, y: 0 })).toBe('W');
    expect(compassBearing(origin, { x: 100, y: -100 })).toBe('NE');
  });
});
