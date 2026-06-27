/**
 * Builds the connection graph from a real `.sav` and prints its stats and build
 * time — the numbers behind the in-memory-vs-Kùzu spike (see the package README).
 * Real saves are never used in unit tests; run this against a local save instead:
 *
 *   npm run inspect -w @foreman/sf-save-data-graph -- ~/saves/sam-good-12.sav
 *
 * Defaults to `~/saves/sam-good-12.sav` when no path is given.
 */
import { homedir } from 'node:os';
import path from 'node:path';

import { normaliseSave, parseSaveFile } from '@foreman/sf-save-data';

import { buildSaveGraph } from '../index.js';

function main(): void {
  const savePath = process.argv[2] ?? path.join(homedir(), 'saves', 'sam-good-12.sav');
  process.stderr.write(`Parsing ${savePath} …\n`);

  const parseStart = process.hrtime.bigint();
  const raw = parseSaveFile(savePath, path.basename(savePath));
  const parseMs = Number(process.hrtime.bigint() - parseStart) / 1e6;

  const normaliseStart = process.hrtime.bigint();
  const { state } = normaliseSave(raw, new Date().toISOString());
  const normaliseMs = Number(process.hrtime.bigint() - normaliseStart) / 1e6;

  // The graph is now a pure projection of state.topology, so the build itself is
  // trivial — the connectivity work happens in normaliseSave above.
  const buildStart = process.hrtime.bigint();
  const graph = buildSaveGraph(state);
  const buildMs = Number(process.hrtime.bigint() - buildStart) / 1e6;

  const stats = graph.stats();
  process.stdout.write(
    JSON.stringify(
      {
        savePath,
        parseMs: Math.round(parseMs),
        normaliseMs: Math.round(normaliseMs * 10) / 10,
        buildMs: Math.round(buildMs * 10) / 10,
        stats,
        warnings: graph.warnings,
      },
      null,
      2,
    ) + '\n',
  );
}

main();
