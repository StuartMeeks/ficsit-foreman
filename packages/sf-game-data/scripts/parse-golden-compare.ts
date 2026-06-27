/**
 * Golden-diff gate (#159), comparison side. Structurally compares the TypeScript
 * parser's output against the C# port's output — by value, so JS-vs-.NET float
 * *formatting* never matters. Object key order is ignored; array order is
 * significant (both parsers preserve source order). `gameData.parsedAt` is
 * ignored (non-deterministic); `parseWarnings` is compared as a sorted multiset.
 *
 * Exits non-zero with a diff report on any mismatch.
 *
 *   npx tsx scripts/parse-golden-compare.ts <golden-ts.json> <csharp.json>
 */
import fs from 'node:fs';

const [tsPath, csPath] = process.argv.slice(2);
if (tsPath === undefined || csPath === undefined) {
  console.error('usage: tsx scripts/parse-golden-compare.ts <golden-ts.json> <csharp.json>');
  process.exit(1);
}

const a = JSON.parse(fs.readFileSync(tsPath, 'utf8'));
const b = JSON.parse(fs.readFileSync(csPath, 'utf8'));

// parsedAt is inherently non-deterministic — drop it from both before comparing.
delete a?.gameData?.parsedAt;
delete b?.gameData?.parsedAt;

// parseWarnings: order is not contractual, so compare as a sorted multiset.
const sortWarnings = (o) => {
  if (Array.isArray(o?.parseWarnings)) {
    o.parseWarnings = [...o.parseWarnings].sort();
  }
};
sortWarnings(a);
sortWarnings(b);

const diffs = [];
const MAX = 50;

function compare(x, y, path) {
  if (diffs.length >= MAX) {
    return;
  }
  if (typeof x === 'number' || typeof y === 'number') {
    if (x !== y) {
      diffs.push(`${path}: ts=${JSON.stringify(x)} cs=${JSON.stringify(y)}`);
    }
    return;
  }
  if (Array.isArray(x) || Array.isArray(y)) {
    if (!Array.isArray(x) || !Array.isArray(y)) {
      diffs.push(`${path}: array/non-array mismatch (ts=${typeof x} cs=${typeof y})`);
      return;
    }
    if (x.length !== y.length) {
      diffs.push(`${path}: length ts=${x.length} cs=${y.length}`);
    }
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      compare(x[i], y[i], `${path}[${i}]`);
    }
    return;
  }
  if (x !== null && y !== null && typeof x === 'object' && typeof y === 'object') {
    const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
    for (const k of keys) {
      if (!(k in x)) {
        diffs.push(`${path}.${k}: missing on TS side`);
      } else if (!(k in y)) {
        diffs.push(`${path}.${k}: missing on C# side`);
      } else {
        compare(x[k], y[k], `${path}.${k}`);
      }
    }
    return;
  }
  if (x !== y) {
    diffs.push(`${path}: ts=${JSON.stringify(x)} cs=${JSON.stringify(y)}`);
  }
}

compare(a, b, '$');

if (diffs.length === 0) {
  console.log(
    '✓ golden-diff PASS — C# parser output is structurally identical to the TypeScript parser.',
  );
  process.exit(0);
}

console.error(
  `✗ golden-diff FAIL — ${diffs.length}${diffs.length >= MAX ? '+' : ''} difference(s):`,
);
for (const d of diffs) {
  console.error(`  ${d}`);
}
process.exit(1);
