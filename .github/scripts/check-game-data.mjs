#!/usr/bin/env node
// Validates bundled game-data pull requests.
//
// A game-data PR must:
//   - touch only files under a single packages/mcp-game-data/data/<channel>/ directory,
//     where <channel> is `stable` or `experimental`;
//   - contain that channel's en-US.json and a well-formed meta.json
//     ({ gameVersion: string, build: positive int, channel: <dir name> });
//   - bump build strictly above that channel's current build on the base branch.
//
// On PRs that touch no bundled game data, this is a no-op (exit 0), so it is
// safe to require as a status check on every pull request.

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = 'packages/mcp-game-data/data';
const CHANNELS = ['stable', 'experimental'];

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

const dataChanged = changed.filter(
  (file) => file.startsWith(`${DATA_DIR}/`) && file !== `${DATA_DIR}/README.md`,
);

if (dataChanged.length === 0) {
  console.log('No bundled game-data changes; nothing to validate.');
  process.exit(0);
}

// 1. Isolation + single channel.
const touchedChannels = new Set(dataChanged.map((file) => file.slice(DATA_DIR.length + 1).split('/')[0]));
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

// 2. Channel contents are well-formed (validated against the checked-out HEAD).
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

    // 3. Monotonic build, per channel, against the base branch.
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

if (errors.length > 0) {
  console.error('Game-data validation failed:');
  for (const error of errors) {
    console.error(`  ✗ ${error}`);
  }
  process.exit(1);
}

console.log(`✓ ${channel} game data is valid.`);
