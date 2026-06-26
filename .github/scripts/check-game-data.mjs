#!/usr/bin/env node
// Validates bundled game-data pull requests.
//
// A bundled channel is a THREE-FILE BUNDLE under
// packages/sf-game-data/data/<channel>/:
//
//   en-US.json           the raw Satisfactory docs (game data)
//   meta.json            { gameVersion, build, channel }
//   world-locations.json the extracted collectible/resource-node dataset
//
// The three describe one game build and move together. A data PR must:
//   - touch only files under a SINGLE channel directory (one channel per PR);
//   - leave the channel bundle COMPLETE — all three files present;
//   - ship a well-formed meta.json ({ gameVersion: string, build: positive int,
//     channel: <dir name> }) and bump build strictly above that channel's
//     current build on the base branch;
//   - ship a well-formed world-locations.json whose collectibles[]/resourceNodes[]
//     counts equal the actual array lengths and whose collectible counts equal the
//     known fixed world totals;
//   - keep meta.json and world-locations.json in lockstep: identical gameVersion
//     AND build. (This is what stops a version being "bumped" without a genuine
//     re-extraction — both files only ever move together, and the world totals are
//     re-checked against the fixed oracle.)
//
// On PRs that touch no bundled game data, this is a no-op (exit 0), so it is
// safe to require as a status check on every pull request.

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = 'packages/sf-game-data/data';
const CHANNELS = ['stable', 'experimental'];
const BUNDLE_FILES = ['en-US.json', 'meta.json', 'world-locations.json'];

/** Fixed public world totals — the completeness oracle for a regenerated dataset. */
const KNOWN_COLLECTIBLE_TOTALS = {
  mercerSphere: 298,
  somersloop: 106,
  powerSlugBlue: 596,
  powerSlugYellow: 389,
  powerSlugPurple: 257,
  hardDrive: 118,
  helmet: 1,
  mtape: 3,
  crashSitePart: 703,
};

const baseSha = process.env.BASE_SHA;
const headSha = process.env.HEAD_SHA ?? 'HEAD';

const errors = [];
const fail = (message) => errors.push(message);

function git(command) {
  // Capture stderr (pipe) so expected failures — e.g. `git show` for a channel
  // that doesn't exist on the base branch — don't leak `fatal:` noise to logs.
  return execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

const changed = git(`git diff --name-only ${baseSha} ${headSha}`)
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);

// Every tracked bundle file under data/, excluding the human-facing README.
const dataChanged = changed.filter(
  (file) => file.startsWith(`${DATA_DIR}/`) && file !== `${DATA_DIR}/README.md`,
);

if (dataChanged.length === 0) {
  console.log('No bundled game-data changes; nothing to validate.');
  process.exit(0);
}

// --- 1. One channel per PR ---
const touchedChannels = new Set(
  dataChanged.map((file) => file.slice(DATA_DIR.length + 1).split('/')[0]),
);
if (touchedChannels.size > 1) {
  fail(`Update one channel per PR. Channels touched: ${[...touchedChannels].join(', ')}.`);
}
const channel = [...touchedChannels][0];
if (!CHANNELS.includes(channel)) {
  fail(`Unknown channel directory '${channel}'. Allowed: ${CHANNELS.join(', ')}.`);
}
const channelDir = `${DATA_DIR}/${channel}`;
const stray = changed.filter((file) => !file.startsWith(`${channelDir}/`));
if (stray.length > 0) {
  fail(
    `A game-data PR must contain only files under ${channelDir}/. Unexpected changes:\n  ${stray.join('\n  ')}`,
  );
}

if (CHANNELS.includes(channel)) {
  validateBundle(channel, channelDir);
}

if (errors.length > 0) {
  console.error('Game-data validation failed:');
  for (const error of errors) {
    console.error(`  ✗ ${error}`);
  }
  process.exit(1);
}

console.log(`✓ bundled game data is valid (${channel} three-file bundle).`);

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    fail(`${file} is not valid JSON.`);
    return undefined;
  }
}

function validateBundle(channel, channelDir) {
  // The bundle must be complete: all three files present.
  for (const name of BUNDLE_FILES) {
    if (!fs.existsSync(path.join(channelDir, name))) {
      fail(`${path.join(channelDir, name)} is missing — a channel bundle needs all of: ${BUNDLE_FILES.join(', ')}.`);
    }
  }

  const meta = validateMeta(channel, channelDir);
  const world = validateWorldFile(channelDir);

  // meta.json and world-locations.json must describe the same build.
  if (meta && world) {
    if (world.gameVersion !== meta.gameVersion) {
      fail(
        `world-locations.json gameVersion ('${world.gameVersion}') must match meta.json ('${meta.gameVersion}').`,
      );
    }
    if (world.build !== meta.build) {
      fail(
        `world-locations.json build (${world.build}) must match meta.json (${meta.build}).`,
      );
    }
  }
}

function validateMeta(channel, channelDir) {
  const metaPath = path.join(channelDir, 'meta.json');
  if (!fs.existsSync(metaPath)) {
    return undefined;
  }
  const meta = readJson(metaPath);
  if (!meta) {
    return undefined;
  }

  if (typeof meta.gameVersion !== 'string' || meta.gameVersion.trim() === '') {
    fail('meta.gameVersion must be a non-empty string.');
  }
  if (!Number.isInteger(meta.build) || meta.build <= 0) {
    fail('meta.build must be a positive integer.');
  }
  if (meta.channel !== channel) {
    fail(`meta.channel ('${meta.channel}') must equal the directory name ('${channel}').`);
  }

  let baseBuild = null;
  try {
    baseBuild = JSON.parse(git(`git show ${baseSha}:${metaPath}`)).build;
  } catch {
    baseBuild = null; // channel did not exist on the base branch — first one is fine.
  }
  // A channel only moves forward, never back. A meta.json change is a new
  // build/version and must advance the build; a world-locations.json-only
  // re-extraction at the same build is allowed (build stays equal).
  const metaChanged = changed.includes(metaPath);
  if (Number.isInteger(baseBuild) && Number.isInteger(meta.build)) {
    if (meta.build < baseBuild) {
      fail(`build (${meta.build}) must not be lower than the current ${channel} build (${baseBuild}).`);
    } else if (metaChanged && meta.build === baseBuild) {
      fail(
        `meta.json changed but build (${meta.build}) did not advance past the current ${channel} build (${baseBuild}).`,
      );
    }
  }

  return meta;
}

function validateWorldFile(channelDir) {
  const file = path.join(channelDir, 'world-locations.json');
  if (!fs.existsSync(file)) {
    return undefined;
  }
  const data = readJson(file);
  if (!data) {
    return undefined;
  }
  if (!Array.isArray(data.collectibles) || !Array.isArray(data.resourceNodes)) {
    fail(`${file} must have array 'collectibles' and 'resourceNodes'.`);
    return undefined;
  }

  // counts must equal the actual array lengths.
  const tally = {};
  for (const c of [...data.collectibles, ...data.resourceNodes]) {
    tally[c.kind] = (tally[c.kind] ?? 0) + 1;
  }
  // Loose crash-site parts are a separate array (no per-entry kind); they tally as `crashSitePart`.
  const loot = Array.isArray(data.lootPickups) ? data.lootPickups : [];
  if (loot.length > 0) {
    tally['crashSitePart'] = loot.length;
  }
  for (const [kind, n] of Object.entries(tally)) {
    if (data.counts?.[kind] !== n) {
      fail(`${file}: counts.${kind} (${data.counts?.[kind]}) != actual array length (${n}).`);
    }
  }
  for (const kind of Object.keys(data.counts ?? {})) {
    if (tally[kind] === undefined) {
      fail(`${file}: counts.${kind} present but no matching entries exist.`);
    }
  }

  // collectible counts must equal the known fixed world totals.
  for (const [kind, expected] of Object.entries(KNOWN_COLLECTIBLE_TOTALS)) {
    if (data.counts?.[kind] !== expected) {
      fail(`${file}: ${kind} count (${data.counts?.[kind]}) != known world total (${expected}).`);
    }
  }

  return data;
}
