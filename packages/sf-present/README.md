# @foreman/sf-present

Reusable Satisfactory **presentation/formatting** helpers — the edge layer that
turns raw, game-native data into pioneer-facing strings and units.

The neutral data libraries (`@foreman/sf-core`, `@foreman/sf-game-data`,
`@foreman/sf-save-data`) emit raw, faithful data: class names, centimetres, full
precision. Anything that *formats* that for a human lives here, so it is reusable
by any consumer — the MCP server, the app, or a community tool — without pulling in
the MCP server. Zero runtime dependencies.

See `docs/component-architecture.md` → *Presentation boundary* for the rule.

## Exports

| Helper | What it does |
|---|---|
| `humaniseClassName(className)` | Cosmetic class → Title-Case fallback (`Desc_IronPlate_C` → "Iron Plate", `Research_Caterium_C` → "Caterium"). Used when a class has no authored game-data display name. Handles save-instance forms (`_UAID_…`, `_C_<n>`). |
| `cmToMetres(cm)` / `metresToCm(m)` | World-coordinate unit conversion. Saves/datasets store centimetres (Unreal units); the in-game HUD shows metres. No rounding — exact round-trip. |
| `compassBearing(origin, target)` | 8-point compass bearing ("N", "NE", …) between two points, using Satisfactory's world axes (+X East, +Y South). |

Structural identity helpers (`classNameFromPath`, `extractClassNames`) are **not**
here — they live in `@foreman/sf-core`.
