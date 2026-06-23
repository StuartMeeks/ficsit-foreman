import { describe, expect, it } from 'vitest';

import { decodeBuffer } from '../src/parser/reader.js';

const sample = [
  { NativeClass: "Class'/Script/FactoryGame.FGRecipe'", Classes: [{ ClassName: 'X_C' }] },
];
const json = JSON.stringify(sample);

describe('decodeBuffer', () => {
  it('decodes UTF-16 LE with a BOM and strips it', () => {
    const buffer = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(json, 'utf16le')]);
    expect(JSON.parse(decodeBuffer(buffer))).toEqual(sample);
  });

  it('decodes UTF-16 LE without a BOM (detected from the NUL high byte)', () => {
    const buffer = Buffer.from(json, 'utf16le');
    expect(JSON.parse(decodeBuffer(buffer))).toEqual(sample);
  });

  it('decodes UTF-8 with a BOM and strips it', () => {
    const buffer = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(json, 'utf8')]);
    expect(JSON.parse(decodeBuffer(buffer))).toEqual(sample);
  });

  it('decodes plain UTF-8', () => {
    expect(JSON.parse(decodeBuffer(Buffer.from(json, 'utf8')))).toEqual(sample);
  });
});
