# Bundled game data

This directory holds an optional **bundled fallback** copy of Satisfactory's
`en-US.json`, used by the MCP server when no local game install is configured
(i.e. neither `SATISFACTORY_DOCS_PATH` nor `SATISFACTORY_GAME_DIR` resolves to a
file). See the resolution order in [`../README.md`](../README.md).

Expected file: **`en-US.json`** — the file straight from a game install's
`CommunityResources/Docs/en-US.json` (UTF-16 LE; the parser handles the
encoding). Use the latest stable game version.

This file is supplied by maintainers or the community via pull requests. When
contributing it, follow the strict one-file rule in
[`CONTRIBUTING.md`](../../../CONTRIBUTING.md): the commit and the PR must contain
**only** `packages/mcp/data/en-US.json` — no code or other changes.

If `en-US.json` is absent here, the server still runs; it simply falls through
to an empty dataset (with a warning) when no other source is configured.
