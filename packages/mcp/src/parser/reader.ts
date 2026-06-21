import fs from 'node:fs';

/** Byte-order mark (U+FEFF), built from an escape so no literal BOM sits in source. */
const BOM = new RegExp('^\\uFEFF');

/**
 * Decodes a docs-file buffer to a string, handling the UTF-16 LE encoding the
 * game uses. A byte-order mark is stripped when present; when absent, UTF-16 LE
 * is detected from the NUL high byte of the leading ASCII `[` (`0x5B 0x00`).
 */
export function decodeBuffer(buffer: Buffer): string {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.toString('utf16le').replace(BOM, '');
  }
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.toString('utf8').replace(BOM, '');
  }
  if (buffer.length >= 2 && buffer[1] === 0x00) {
    return buffer.toString('utf16le').replace(BOM, '');
  }
  return buffer.toString('utf8').replace(BOM, '');
}

/** Reads and JSON-parses the docs file. Throws only on unreadable/invalid JSON. */
export function readDocsFile(filePath: string): unknown {
  const buffer = fs.readFileSync(filePath);
  return JSON.parse(decodeBuffer(buffer));
}
