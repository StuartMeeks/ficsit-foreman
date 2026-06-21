# Contributing to Foreman

Thanks for helping out. This is a community-first project — contributions of
code, docs, and game-data updates are all welcome.

## Conventions

Commit, branch, and pull-request conventions are documented in
[`CLAUDE.md`](./CLAUDE.md) (see **Git, Commit & PR Conventions**). In short:

- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org/)
  (`type(scope): subject`) with a body explaining what and why.
- **Branches** are prefixed `feature/`, `bugfix/`, or `hotfix/` with a kebab-case slug.
- **Pull requests** are one logical change each, squash-merged, with a complete
  description written at creation time.

## Development

```bash
npm install
npm run build      # type-check / build packages/mcp
npm run lint       # ESLint + Prettier
npm test           # Vitest (runs on hand-crafted fixtures)
```

CI (`build` + `lint` + `test`) runs on every PR and must pass before merge.

## Supplying game data (`en-US.json`)

The MCP server can read game data from a local install, but it also supports a
**bundled fallback** committed to the repository at
**`packages/mcp/data/en-US.json`** (used when neither `SATISFACTORY_DOCS_PATH`
nor `SATISFACTORY_GAME_DIR` is configured). Maintainers and the community keep
this file current as the game updates.

When you contribute an `en-US.json` (a new file or an update), follow this rule:

> **One file only.** The commit must contain **only**
> `packages/mcp/data/en-US.json`, and the pull request must be **solely** for
> that file — no code changes, no doc changes, nothing else.

Why: the file is large, it changes wholesale between game versions, and keeping
it isolated makes data PRs trivial to review and keeps them out of the way of
code review.

How to prepare one:

1. Copy `CommunityResources/Docs/en-US.json` from a **latest-stable** game
   install (it is UTF-16 LE — leave the encoding as-is; the parser handles it).
2. Place it at `packages/mcp/data/en-US.json`.
3. Commit **only** that file, e.g.:

   ```bash
   git checkout -b feature/update-bundled-game-data
   git add packages/mcp/data/en-US.json
   git commit -m "chore(data): update bundled en-US.json to game <version>"
   ```

4. Open a PR containing only that commit.

> **Note:** `en-US.json` is Satisfactory game data © Coffee Stain Studios.
> Only the bundled-fallback copy under `packages/mcp/data/` is tracked; a local
> working copy under `game-data/` is gitignored and must not be committed.
