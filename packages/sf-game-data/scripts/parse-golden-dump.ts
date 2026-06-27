/**
 * Golden-diff gate (#159), TypeScript side. Runs the canonical hand-written
 * parser over an en-US.json and writes the ParseResult as JSON, to be compared
 * against the C# port's output (see parse-golden-compare.mjs).
 *
 * Version/build are fixed so the only non-deterministic field is
 * gameData.parsedAt, which the comparer ignores.
 *
 *   npx tsx scripts/parse-golden-dump.ts <en-US.json> <out.json>
 */
import fs from 'node:fs';

import { parseGameData } from '../src/parser/index.js';
import { readDocsFile } from '../src/parser/reader.js';

const [input, output] = process.argv.slice(2);
if (input === undefined || output === undefined) {
  console.error('usage: tsx scripts/parse-golden-dump.ts <en-US.json> <out.json>');
  process.exit(1);
}

const raw = readDocsFile(input);
const result = parseGameData(raw, 'GOLDEN', 0);
fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');

const d = result.gameData;
console.log(
  `parsed items=${Object.keys(d.items).length} resources=${Object.keys(d.resources).length} ` +
    `recipes=${Object.keys(d.recipes).length} buildings=${Object.keys(d.buildings).length} ` +
    `schematics=${Object.keys(d.schematics).length}`,
);
console.log(`written -> ${output}`);
