# Bundled game data

This directory holds **bundled game data per release channel**, used by the MCP
server when no local game install is configured (i.e. neither
`SATISFACTORY_DOCS_PATH` nor `SATISFACTORY_GAME_DIR` resolves to a file). See the
resolution order in [`../README.md`](../README.md).

## Layout

At most two channels are kept — the latest **stable** and the latest
**experimental** build:

```
data/
  stable/
    en-US.json            # from a stable install's CommunityResources/Docs/ (UTF-16 LE)
    meta.json             # { "gameVersion": "1.2.3.0", "build": 493833, "channel": "stable" }
    sf-game-data.json  # static collectible + resource-node coordinates (see below)
  experimental/
    en-US.json
    meta.json             # { ..., "channel": "experimental" }
```

The server selects a channel with `SATISFACTORY_GAME_CHANNEL` (`stable` |
`experimental`, default `stable`; it falls back to the other channel if the
requested one is absent). The parser reads `gameVersion` from `meta.json`, so the
server reports the real version instead of `unknown`.

## World locations

`sf-game-data.json` is a static, first-party dataset of every fixed placement
in the Satisfactory world — collectibles (Mercer Spheres, Somersloops, power
slugs, hard-drive drop pods) and resource extraction points (ore/fluid nodes,
fracking satellites and cores, geothermal geysers) — with coordinates (Unreal
units), resource type and purity. Loaded by `loadWorldLocations()` and exposed
through the `sf-mcp` world tools. Override its path with
`SF_GAME_DATA_PATH`.

It was extracted from the packaged level files with
[CUE4Parse](https://github.com/FabianFG/CUE4Parse) and the `FactoryGame.usmap`
mappings shipped in the game's `CommunityResources/`. Only factual coordinates
are stored — no game assets are redistributed. CI validates that the collectible
counts match the known fixed world totals and that `gameVersion` matches
`meta.json`.

## Contributing data

Data is supplied by maintainers or the community via pull requests, and a CI
gate validates each one. Follow the rules in
[`CONTRIBUTING.md`](../../../CONTRIBUTING.md): a data PR updates **one** channel,
contains **only** that channel's `en-US.json` + `meta.json`, and bumps `build`
above the channel's current value.

If a channel is absent, the server still runs; it falls through to the other
channel, or to an empty dataset (with a warning) when nothing is configured.
