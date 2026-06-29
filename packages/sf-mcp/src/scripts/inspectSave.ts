/**
 * Debug CLI for inspecting a real `.sav` and confirming the class names in
 * `constants.ts`. This is a standalone tool (NOT the MCP server), so it prints to
 * stdout. Point it at a save with `SAVE_FILE_PATH` or pass a path argument.
 *
 *   npm run inspect                       # overview of SAVE_FILE_PATH
 *   npm run inspect typepaths [save]      # typePath histogram (top 60)
 *   npm run inspect props <substr> [save] # property keys of matching objects
 *   npm run inspect diff <saveA> <saveB>  # collectables/typePath delta
 *   npm run inspect get_player_state [save]   # run a tool (any of the five)
 */
import { loadWorldLocations } from '@foreman/sf-game-data';

import { expandHome } from '../config.js';
import { loadGameDataIndex, makeNameResolver, type NameResolver } from '../gameData.js';
import { normaliseSave } from '@foreman/sf-save-data';
import { classNameFromPath } from '@foreman/sf-save-data';
import type { RawObject, RawSave } from '@foreman/sf-save-data';
import { parseSaveFile } from '@foreman/sf-save-data';
import {
  collectedGuidSet,
  unlockedSchematicSet,
  collectibleProgressView,
  milestones,
  nearbyFromWorld,
  playerSummary,
  storageView,
  unlockedRecipes,
} from '../query/selectors.js';
import { SaveStore } from '../store/saveStore.js';

type ToolRunner = (state: ReturnType<typeof loadState>, resolve: NameResolver) => unknown;

const TOOL_RUNNERS: Record<string, ToolRunner> = {
  get_player_state: (s, r) => playerSummary(s, r),
  get_unlocked_recipes: (s, r) => unlockedRecipes(s, r),
  get_milestones: (s, r) => milestones(s, loadGameDataIndex(), r),
  get_storage: (s, r) => storageView(s, r),
  get_collectibles: (s) => collectibleProgressView(s, loadWorldLocations().world),
  // Nearby uses the player's own location as the origin (when known), querying
  // the static world dataset (same source the MCP tool uses).
  get_nearby: (s, r) => {
    // Origin must be metres — exactly what get_player_state hands the foreman.
    const origin = playerSummary(s, r).location;
    return origin === undefined
      ? { error: 'player location unknown in this save' }
      : nearbyFromWorld(
          loadWorldLocations().world.collectibles,
          origin,
          {},
          collectedGuidSet(s),
          unlockedSchematicSet(s),
          r,
        );
  },
};

function out(value: unknown): void {
  // This is a CLI (not the MCP server), so stdout is the intended output channel.
  console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}

function resolvePath(arg: string | undefined): string {
  const raw = arg ?? process.env['SAVE_FILE_PATH'];
  if (raw === undefined || raw.length === 0) {
    throw new Error('No save specified — pass a path or set SAVE_FILE_PATH.');
  }
  return expandHome(raw);
}

function allObjects(raw: RawSave): RawObject[] {
  return Object.values(raw.levels ?? {}).flatMap((level) => level?.objects ?? []);
}

function allCollectables(raw: RawSave): string[] {
  return Object.values(raw.levels ?? {}).flatMap((level) =>
    (level?.collectables ?? []).map((ref) => ref.pathName),
  );
}

function loadState(filePath: string): ReturnType<typeof normaliseSave>['state'] {
  return normaliseSave(parseSaveFile(filePath, 'inspect'), new Date().toISOString()).state;
}

function histogram(paths: string[]): Map<string, number> {
  const hist = new Map<string, number>();
  for (const p of paths) {
    const c = classNameFromPath(p);
    hist.set(c, (hist.get(c) ?? 0) + 1);
  }
  return hist;
}

function printHistogram(title: string, hist: Map<string, number>, top: number): void {
  out(`\n=== ${title} (top ${top}) ===`);
  for (const [name, count] of [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, top)) {
    out(`${String(count).padStart(6)}  ${name}`);
  }
}

function runTypePaths(savePath: string): void {
  const raw = parseSaveFile(savePath, 'inspect');
  const objects = allObjects(raw);
  out(`objects: ${objects.length}`);
  printHistogram('typePaths', histogram(objects.map((o) => o.typePath ?? '')), 60);
}

function runProps(substr: string, savePath: string): void {
  const raw = parseSaveFile(savePath, 'inspect');
  const matches = allObjects(raw).filter(
    (o) => (o.typePath ?? '').includes(substr) || (o.instanceName ?? '').includes(substr),
  );
  out(`matched ${matches.length} object(s) on '${substr}':`);
  for (const obj of matches.slice(0, 5)) {
    const props = obj.properties;
    const keys = Array.isArray(props)
      ? props.map((p) =>
          typeof p === 'object' && p !== null && 'name' in p ? String(p.name) : '?',
        )
      : props !== null && typeof props === 'object'
        ? Object.keys(props)
        : [];
    out(`\n  typePath: ${obj.typePath}`);
    out(`  instance: ${obj.instanceName}`);
    out(`  propKeys: ${keys.join(', ')}`);
  }
}

function runDiff(pathA: string, pathB: string): void {
  const a = parseSaveFile(pathA, 'a');
  const b = parseSaveFile(pathB, 'b');
  const collA = histogram(allCollectables(a));
  const collB = histogram(allCollectables(b));
  const keys = new Set([...collA.keys(), ...collB.keys()]);
  out(`=== collectables delta (B - A) — non-zero, top 40 ===`);
  const deltas = [...keys]
    .map((k) => ({ k, d: (collB.get(k) ?? 0) - (collA.get(k) ?? 0) }))
    .filter((x) => x.d !== 0)
    .sort((x, y) => Math.abs(y.d) - Math.abs(x.d))
    .slice(0, 40);
  for (const { k, d } of deltas) {
    out(`${(d > 0 ? `+${d}` : String(d)).padStart(7)}  ${k}`);
  }
}

function runTool(name: string, savePath: string): void {
  const runner = TOOL_RUNNERS[name];
  if (runner === undefined) {
    throw new Error(`Unknown tool '${name}'. Known: ${Object.keys(TOOL_RUNNERS).join(', ')}`);
  }
  const store = SaveStore.fromState(loadState(savePath));
  const resolveName = makeNameResolver(loadGameDataIndex());
  out({
    version: store.version,
    saveName: store.saveName,
    result: runner(store.getState(), resolveName),
  });
}

function runSummary(savePath: string): void {
  const state = loadState(savePath);
  out({
    version: state.version,
    saveName: state.saveName,
    player: { location: state.player.location, items: state.player.inventory.length },
    storageContainers: state.storage.containers.length,
    depotItems: state.storage.dimensionalDepot.length,
    recipes: state.recipes.length,
    milestones: state.milestones.length,
    mamResearch: state.mamResearch.length,
    assemblyPhase: state.assemblyPhase?.phase,
    collectedPickups: state.collectedPickupGuids.length,
    lootedDropPods: state.lootedDropPodGuids.length,
    warnings: state.warnings.length,
  });
}

function main(): void {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case undefined:
    case 'summary':
      runSummary(resolvePath(rest[0]));
      return;
    case 'typepaths':
      runTypePaths(resolvePath(rest[0]));
      return;
    case 'props': {
      const substr = rest[0];
      if (substr === undefined) {
        throw new Error('usage: inspect props <substr> [save]');
      }
      runProps(substr, resolvePath(rest[1]));
      return;
    }
    case 'diff': {
      if (rest[0] === undefined || rest[1] === undefined) {
        throw new Error('usage: inspect diff <saveA> <saveB>');
      }
      runDiff(expandHome(rest[0]), expandHome(rest[1]));
      return;
    }
    default:
      runTool(command, resolvePath(rest[0]));
  }
}

main();
