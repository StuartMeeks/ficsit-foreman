using SfGameData.Extraction;

// `sf-game-data-extractor` — the single offline producer of the bundled game-data
// dataset (see docs/sf-game-data-extractor.md). For now it is a thin front end over
// the world extraction reused from the former `fg-extract` (#158): it resolves the
// run's inputs and calls the library. Later slices add the en-US.json parse and
// merge both sources into one output file.

// Paths are overridable by environment variable so this runs on any host; the
// defaults document the machine the dataset was originally extracted on.
var paks =
    Environment.GetEnvironmentVariable("SF_PAKS")
    ?? @"D:\Games\Steam\steamapps\common\Satisfactory\FactoryGame\Content\Paks";
var usmap =
    Environment.GetEnvironmentVariable("SF_USMAP")
    ?? @"D:\Games\Steam\steamapps\common\Satisfactory\CommunityResources\FactoryGame.usmap";
var outPath = Environment.GetEnvironmentVariable("OUT") ?? @"sf-game-data.json";

// The version this dataset describes. Overridable so a re-extraction for a new
// game build stamps the correct version without editing this file; the defaults
// document the build the dataset was originally extracted from.
var gameVersion = Environment.GetEnvironmentVariable("GAME_VERSION") ?? "1.2.3.0";
var build = int.TryParse(Environment.GetEnvironmentVariable("BUILD"), out var parsedBuild)
    ? parsedBuild
    : 493833;

WorldExtractor.Run(new ExtractOptions(paks, usmap, outPath, gameVersion, build));
