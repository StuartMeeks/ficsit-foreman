import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { loadWorldLocations, bundledDataDir } from '../src/index.js';
import type { WorldLocations } from '../src/index.js';

/** A data dir guaranteed not to exist, so no bundled channel is found. */
const NO_DATA_DIR = path.join(os.tmpdir(), 'foreman-no-such-world');

const SAMPLE: WorldLocations = {
  gameVersion: '1.2.3.0',
  build: 1,
  source: 'test',
  counts: { mercerSphere: 1, resourceNode: 1 },
  collectibles: [{ id: 'a', kind: 'mercerSphere', x: 0, y: 0, z: 0 }],
  resourceNodes: [{ id: 'n', kind: 'resourceNode', resourceClass: 'Desc_OreIron_C', purity: 'pure', x: 1, y: 2, z: 3 }],
};

function tempFile(contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foreman-world-'));
  const file = path.join(dir, 'world-locations.json');
  fs.writeFileSync(file, contents);
  return file;
}

/** Builds a temp data dir with world-locations.json under each named channel. */
function tempDataDir(channels: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foreman-worlddata-'));
  for (const channel of channels) {
    fs.mkdirSync(path.join(dir, channel), { recursive: true });
    fs.writeFileSync(path.join(dir, channel, 'world-locations.json'), JSON.stringify(SAMPLE));
  }
  return dir;
}

describe('loadWorldLocations', () => {
  it('prefers WORLD_LOCATIONS_PATH when the file exists', () => {
    const file = tempFile(JSON.stringify(SAMPLE));
    const result = loadWorldLocations({ WORLD_LOCATIONS_PATH: file }, NO_DATA_DIR);
    expect(result.path).toBe(file);
    expect(result.world.collectibles).toHaveLength(1);
    expect(result.warning).toBeUndefined();
  });

  it('falls back to the bundled channel', () => {
    const dir = tempDataDir(['stable']);
    const result = loadWorldLocations({}, dir);
    expect(result.world.resourceNodes[0]?.resourceClass).toBe('Desc_OreIron_C');
    expect(result.warning).toMatch(/bundled stable/);
  });

  it('falls back to the other channel when the requested one has no dataset', () => {
    const dir = tempDataDir(['stable']);
    const result = loadWorldLocations({ SATISFACTORY_GAME_CHANNEL: 'experimental' }, dir);
    expect(result.world.collectibles).toHaveLength(1);
    expect(result.warning).toMatch(/has no dataset/);
  });

  it('degrades to an empty dataset with a warning when nothing is resolvable', () => {
    const result = loadWorldLocations({}, NO_DATA_DIR);
    expect(result.world.collectibles).toHaveLength(0);
    expect(result.world.resourceNodes).toHaveLength(0);
    expect(result.warning).toMatch(/No world-location dataset available/);
  });

  it('degrades to empty on a malformed file', () => {
    const file = tempFile('{ not valid json');
    const result = loadWorldLocations({ WORLD_LOCATIONS_PATH: file }, NO_DATA_DIR);
    expect(result.world.collectibles).toHaveLength(0);
    expect(result.warning).toMatch(/Failed to read/);
  });

  it('degrades to empty when the shape is wrong', () => {
    const file = tempFile(JSON.stringify({ gameVersion: 'x' }));
    const result = loadWorldLocations({ WORLD_LOCATIONS_PATH: file }, NO_DATA_DIR);
    expect(result.world.collectibles).toHaveLength(0);
    expect(result.warning).toMatch(/malformed/);
  });
});

describe('bundled world-locations dataset', () => {
  const { world } = loadWorldLocations({}, bundledDataDir());

  it('matches the known fixed world totals for every collectible kind', () => {
    expect(world.counts).toMatchObject({
      mercerSphere: 298,
      somersloop: 106,
      powerSlugBlue: 596,
      powerSlugYellow: 389,
      powerSlugPurple: 257,
      hardDrive: 118,
    });
  });

  it('keeps counts in step with the actual array lengths', () => {
    const tally: Record<string, number> = {};
    for (const c of world.collectibles) {
      tally[c.kind] = (tally[c.kind] ?? 0) + 1;
    }
    for (const n of world.resourceNodes) {
      tally[n.kind] = (tally[n.kind] ?? 0) + 1;
    }
    expect(tally).toEqual(world.counts);
  });

  it('matches the stable channel game version', () => {
    const meta: { gameVersion: string } = JSON.parse(
      fs.readFileSync(path.join(bundledDataDir(), 'stable', 'meta.json'), 'utf8'),
    );
    expect(world.gameVersion).toBe(meta.gameVersion);
  });
});
