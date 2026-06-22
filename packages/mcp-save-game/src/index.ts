// FICSIT Foreman — save-game MCP server (scaffold).
//
// This package is a placeholder ready for the v1 implementation described in
// SPEC.md: parse a Satisfactory save file → normalised JSON → MCP tools
// (get_player_state, get_unlocked_recipes, get_milestones, get_storage,
// get_collectibles).
//
// Nothing is implemented yet. The entry point logs that it is a stub and exits
// so the workspace builds cleanly; it deliberately does not start a server.

const SAVE_FILE_PATH = process.env['SAVE_FILE_PATH'];

process.stderr.write(
  '[foreman-mcp-save-game] Not yet implemented — this is a v1 scaffold. ' +
    `SAVE_FILE_PATH=${SAVE_FILE_PATH ?? '(unset)'}. See packages/mcp-save-game/SPEC.md.\n`,
);

process.exit(0);
