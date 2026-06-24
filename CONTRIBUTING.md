# Contributing to FICSIT Foreman

Thanks for helping out. This is a community-first project — contributions of
code, docs, and game-data updates are all welcome.

## Conventions

This file is the single home for our conventions (`CLAUDE.md` points here).

### Commits — Conventional Commits, body required
- Format `type(optional-scope): subject` — imperative, lowercase subject, no
  trailing full stop (e.g. `feat(server): add HTTP transport`).
- Allowed types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`,
  `build`, `ci`, `chore`, `revert`.
- **A body is required** — explain *what* changed and *why* (wrap ~72 cols).
- Breaking changes: `type!: subject` plus a `BREAKING CHANGE:` footer.

### Branches
- Prefix by work type: `feature/<slug>`, `bugfix/<slug>`, `hotfix/<slug>`.
- `<slug>`: lowercase, words joined by `-`, drop filler words.
- **Never commit directly to `main`** — branch first (also enforced by a ruleset).

### Pull requests
- One logical change per PR; keep it small (aim < ~500 changed lines).
- **Squash-merge** so `main` stays linear; the squash message follows the commit
  convention above.
- Update a branch from `main` with **rebase**, not a merge commit.
- Title: the Conventional Commit summary. Write the **complete** description at
  creation time, not in a later edit.
- AI-generated PRs must begin the body with: `🤖 AI-generated PR — Please review
  carefully.`

### Code standards
- Always use curly braces, even for single-line `if`/`else`/loops.
- Explicit return types on all exported functions.
- No `any` — use `unknown` and narrow it.
- Errors are logged with context, never silently swallowed.
- Parser warnings are collected into `parseWarnings[]`, not thrown.
- **British English** in all comments and documentation.

## Development

```bash
npm install
npm run build      # type-check / build the workspaces
npm run lint       # ESLint + Prettier
npm test           # Vitest
```

CI (`build` + `lint` + `test`) runs on every PR and must pass before merge.
Docker image builds run only when image-relevant files change.

## Supplying game data (`en-US.json`)

The MCP server can read game data from a local install, but it also ships
**bundled game data per release channel** so it works out of the box. At most two
channels are kept — the latest **stable** and the latest **experimental** build:

```
packages/game-data-core/data/
  stable/        en-US.json + meta.json
  experimental/  en-US.json + meta.json
```

`meta.json` describes the data:

```json
{ "gameVersion": "1.2.3.0", "build": 493833, "channel": "stable" }
```

When you contribute game data (a new channel snapshot or an update to one),
follow this rule — it is enforced by the **Validate game data** CI check:

> **One channel per PR.** The pull request must contain **only** the two files
> under a single `packages/game-data-core/data/<channel>/` directory — its `en-US.json` and
> `meta.json` — and nothing else (no code, no docs, no other channel).

The check also requires that `meta.channel` matches the directory, `build` is a
positive integer, and `build` is **strictly greater** than that channel's current
value (so a channel only ever moves forward). Different channels are independent.

Why: the file is large, it changes wholesale between game versions, and keeping
each update isolated makes data PRs trivial to review.

How to prepare one:

1. Copy `CommunityResources/Docs/en-US.json` from a game install on the relevant
   channel (it is UTF-16 LE — leave the encoding as-is; the parser handles it).
2. Place it at `packages/game-data-core/data/<channel>/en-US.json` (`<channel>` =
   `stable` or `experimental`).
3. Add `packages/game-data-core/data/<channel>/meta.json` with the `gameVersion`, `build`
   (from the in-game build number) and `channel`.
4. Commit **only** those two files, e.g.:

   ```bash
   git checkout -b feature/update-stable-game-data
   git add packages/game-data-core/data/stable/en-US.json packages/game-data-core/data/stable/meta.json
   git commit -m "chore(data): update stable game data to 1.2.3.0 (build 493833)"
   ```

5. Open a PR containing only that commit.

> **Note:** `en-US.json` is Satisfactory game data © Coffee Stain Studios.
> Only the bundled channel copies under `packages/game-data-core/data/` are tracked; a local
> working copy under `game-data/` is gitignored and must not be committed.
