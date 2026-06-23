#!/usr/bin/env node
// Validates bundled game-data pull requests.
//
// Two independent concerns:
//
//   1. Docs drops (en-US.json + meta.json). A docs PR must:
//        - touch only files under a single packages/game-data-core/data/<channel>/ directory;
//        - contain that channel's en-US.json and a well-formed meta.json
//          ({ gameVersion: string, build: positive int, channel: <dir name> });
//        - bump build strictly above that channel's current build on the base branch.
//
//   2. The world-location dataset (world-locations.json). Validated whenever it
//      changes, with NO isolation rule (it is bundled alongside loader code):
//        - well-formed; collectibles[] and resourceNodes[] present;
//        - counts equal the actual array lengths;
//        - collectible counts equal the known fixed world totals;
//        - gameVersion matches the channel's meta.json.
//
// On PRs that touch no bundled game data, this is a no-op (exit 0), so it is
// safe to require as a status check on every pull request.

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = 'packages/game-data-core/data';
const CHANNELS = ['stable', 'experimental'];
const WORLD_FILE = 'world-locations.json';

/** Fixed public world totals — the completeness oracle for a regenerated dataset. */
const KNOWN_COLLECTIBLE_TOTALS = {
  mercerSphere: 298,
  somersloop: 106,
  powerSlugBlue: 596,
  powerSlugYellow: 389,
  powerSlugPurple: 257,
  hardDrive: 118,
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

const isWorldFile = (file) => file.startsWith(`${DATA_DIR}/`) && file.endsWith(`/${WORLD_FILE}`);

// Docs drops gate on en-US.json/meta.json only. The world dataset is validated
// separately (below) and never triggers the docs-isolation rules.
const docsChanged = changed.filter(
  (file) =>
    file.startsWith(`${DATA_DIR}/`) && file !== `${DATA_DIR}/README.md` && !isWorldFile(file),
);
const worldChanged = changed.filter(isWorldFile);

if (docsChanged.length === 0 && worldChanged.length === 0) {
  console.log('No bundled game-data changes; nothing to validate.');
  process.exit(0);
}

// --- 1. Docs drop validation (isolation + well-formed meta + monotonic build) ---
if (docsChanged.length > 0) {
  const touchedChannels = new Set(
    docsChanged.map((file) => file.slice(DATA_DIR.length + 1).split('/')[0]),
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
      `A game-data docs PR must contain only files under ${channelDir}/. Unexpected changes:\n  ${stray.join('\n  ')}`,
    );
  }

  if (CHANNELS.includes(channel)) {
    const docsPath = path.join(channelDir, 'en-US.json');
    const metaPath = path.join(channelDir, 'meta.json');
    if (!fs.existsSync(docsPath)) {
      fail(`${docsPath} is missing.`);
    }

    let meta;
    if (!fs.existsSync(metaPath)) {
      fail(`${metaPath} is missing.`);
    } else {
      try {
        meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      } catch {
        fail(`${metaPath} is not valid JSON.`);
      }
    }

    if (meta) {
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
      if (Number.isInteger(baseBuild) && Number.isInteger(meta.build) && meta.build <= baseBuild) {
        fail(
          `build (${meta.build}) must be greater than the current ${channel} build (${baseBuild}).`,
        );
      }
    }
  }
}

// --- 2. World-location dataset validation (no isolation rule) ---
for (const file of worldChanged) {
  validateWorldFile(file);
}

if (errors.length > 0) {
  console.error('Game-data validation failed:');
  for (const error of errors) {
    console.error(`  ✗ ${error}`);
  }
  process.exit(1);
}

const what = [
  docsChanged.length > 0 ? 'docs' : null,
  worldChanged.length > 0 ? 'world locations' : null,
]
  .filter(Boolean)
  .join(' + ');
console.log(`✓ bundled game data is valid (${what}).`);

function validateWorldFile(file) {
  const channel = file.slice(DATA_DIR.length + 1).split('/')[0];
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    fail(`${file} is not valid JSON.`);
    return;
  }
  if (!Array.isArray(data.collectibles) || !Array.isArray(data.resourceNodes)) {
    fail(`${file} must have array 'collectibles' and 'resourceNodes'.`);
    return;
  }

  // counts must equal the actual array lengths.
  const tally = {};
  for (const c of [...data.collectibles, ...data.resourceNodes]) {
    tally[c.kind] = (tally[c.kind] ?? 0) + 1;
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

  // gameVersion must match the channel's meta.json.
  const metaPath = path.join(DATA_DIR, channel, 'meta.json');
  if (fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (typeof meta.gameVersion === 'string' && data.gameVersion !== meta.gameVersion) {
        fail(
          `${file}: gameVersion ('${data.gameVersion}') must match ${channel} meta.json ('${meta.gameVersion}').`,
        );
      }
    } catch {
      // meta.json validity is the docs block's concern.
    }
  }
}
