import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Resolves the path to the docs file from the environment, in priority order:
 *   1. SATISFACTORY_DOCS_PATH — full path to en-US.json
 *   2. SATISFACTORY_GAME_DIR  — install root; append CommunityResources/Docs/
 *      (en-US.json for 1.x, falling back to the pre-1.0 Docs.json)
 *   3. Neither set → no path; the server starts with empty data and a warning.
 */
export interface DocsPathResolution {
  path?: string;
  warning?: string;
}

const DOCS_SUBPATH = ['CommunityResources', 'Docs'];
const DOCS_FILENAMES = ['en-US.json', 'Docs.json'];

/** Expands a leading `~` to the user's home directory. */
function expandHome(input: string): string {
  if (input === '~') {
    return os.homedir();
  }
  if (input.startsWith('~/')) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

export function resolveDocsPath(env: NodeJS.ProcessEnv = process.env): DocsPathResolution {
  const direct = env['SATISFACTORY_DOCS_PATH']?.trim();
  if (direct !== undefined && direct !== '') {
    const resolved = expandHome(direct);
    if (fs.existsSync(resolved)) {
      return { path: resolved };
    }
    return { warning: `SATISFACTORY_DOCS_PATH is set to '${resolved}' but no file exists there.` };
  }

  const gameDir = env['SATISFACTORY_GAME_DIR']?.trim();
  if (gameDir !== undefined && gameDir !== '') {
    const docsDir = path.join(expandHome(gameDir), ...DOCS_SUBPATH);
    for (const filename of DOCS_FILENAMES) {
      const candidate = path.join(docsDir, filename);
      if (fs.existsSync(candidate)) {
        return { path: candidate };
      }
    }
    return {
      warning: `SATISFACTORY_GAME_DIR is set but no ${DOCS_FILENAMES.join('/')} was found under '${docsDir}'.`,
    };
  }

  return {
    warning:
      'Neither SATISFACTORY_DOCS_PATH nor SATISFACTORY_GAME_DIR is set; starting with empty game data.',
  };
}
