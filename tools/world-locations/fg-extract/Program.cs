using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.RegularExpressions;
using CUE4Parse.Compression;
using CUE4Parse.Encryption.Aes;
using CUE4Parse.FileProvider;
using CUE4Parse.MappingsProvider.Usmap;
using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Objects.Core.Math;
using CUE4Parse.UE4.Objects.Core.Misc;
using CUE4Parse.UE4.Versions;

OodleHelper.DownloadOodleDll();
OodleHelper.Initialize();

// Paths are overridable by environment variable so this runs on any host; the
// defaults document the machine the dataset was originally extracted on.
var paks =
    Environment.GetEnvironmentVariable("SF_PAKS")
    ?? @"D:\Games\Steam\steamapps\common\Satisfactory\FactoryGame\Content\Paks";
var usmap =
    Environment.GetEnvironmentVariable("SF_USMAP")
    ?? @"D:\Games\Steam\steamapps\common\Satisfactory\CommunityResources\FactoryGame.usmap";
var outPath = Environment.GetEnvironmentVariable("OUT") ?? @"world-locations.json";

// The version this dataset describes. Overridable so a re-extraction for a new
// game build stamps the correct version without editing this file; the defaults
// document the build the dataset was originally extracted from.
var gameVersion = Environment.GetEnvironmentVariable("GAME_VERSION") ?? "1.2.3.0";
var build = int.TryParse(Environment.GetEnvironmentVariable("BUILD"), out var parsedBuild)
    ? parsedBuild
    : 493833;

var provider = new DefaultFileProvider(paks, SearchOption.TopDirectoryOnly, new VersionContainer(EGame.GAME_UE5_6));
provider.MappingsContainer = new FileUsmapTypeMappingsProvider(usmap);
provider.Initialize();
provider.SubmitKey(new FGuid(), new FAesKey(new byte[32]));
Console.WriteLine($"mounted. files = {provider.Files.Count}");

// Collectible classes, mapped to dataset kinds. The first six are GUID-keyed
// pickups in the _Generated_ cells (spheres/sloops/slugs) plus drop pods. The
// customizer pickups (helmet in a cell, music tapes in the persistent level) are
// SCHEMATIC-keyed instead — they carry no mItemPickupGuid; what they grant is a
// cosmetic schematic (mSchematic), so "collected" is read from the save's
// unlocked schematics rather than mDestroyedPickups.
var collectibleKinds = new Dictionary<string, string>
{
    ["BP_WAT2_C"] = "mercerSphere",     // 298 in assets — matches the known Mercer total
    ["BP_WAT1_C"] = "somersloop",       // 106 in assets — matches the known Somersloop total
    ["BP_Crystal_C"] = "powerSlugBlue",
    ["BP_Crystal_mk2_C"] = "powerSlugYellow",
    ["BP_Crystal_mk3_C"] = "powerSlugPurple",
    ["BP_DropPod_C"] = "hardDrive",
    ["BP_UnlockPickup_Customization_C"] = "helmet", // 1, in a cell; grants a Helmet schematic
    ["BP_TapePickup_C"] = "mtape",                  // 3, in the persistent level; grant Tape schematics
};

// Kinds keyed by the schematic they unlock rather than a pickup GUID.
var schematicKinds = new HashSet<string> { "helmet", "mtape" };

// Resource-node classes (live in the base Persistent_Level), mapped to dataset kinds.
var nodeKinds = new Dictionary<string, string>
{
    ["BP_ResourceNode_C"] = "resourceNode",
    ["BP_FrackingSatellite_C"] = "frackingSatellite",
    ["BP_FrackingCore_C"] = "frackingCore",
    ["BP_ResourceNodeGeyser_C"] = "geyser",
};

FVector? Loc(UObject e)
{
    var root = e.GetOrDefault<UObject?>("RootComponent");
    return root?.GetOrDefault<FVector>("RelativeLocation");
}

// The actor's stable GUID, as the save records it when the collectible is
// collected. Pickups (spheres/sloops/slugs) carry it as `mItemPickupGuid`
// (matched against FGScannableSubsystem.mDestroyedPickups); drop pods carry it
// as `mDropPodGuid` (matched against mLootedDropPods). Emitted as 32 uppercase
// hex chars (the four FGuid uint32s, in file order) so the save MCP can match it
// directly. Null when absent/zero (so the field is simply omitted).
string? GuidFor(UObject e, string kind)
{
    var g = kind == "hardDrive"
        ? e.GetOrDefault<FGuid>("mDropPodGuid")
        : e.GetOrDefault<FGuid>("mItemPickupGuid");
    if (g.A == 0 && g.B == 0 && g.C == 0 && g.D == 0) { return null; }
    return $"{g.A:X8}{g.B:X8}{g.C:X8}{g.D:X8}";
}

// The cosmetic schematic a customizer pickup grants (helmet/tape), as the save
// records it once unlocked. `mSchematic` is a class reference; we keep its
// trailing `Schematic_*_C` identifier, which the save MCP matches against the
// pioneer's unlocked schematics to compute collected status. Null when absent.
string? SchematicFor(UObject e)
{
    var raw = e.Properties.FirstOrDefault(p => p.Name.Text == "mSchematic")?.Tag?.GenericValue?.ToString();
    if (raw == null) { return null; }
    var m = Regex.Match(raw, @"\.([A-Za-z0-9_]+)'?$");
    return m.Success ? m.Groups[1].Value : null;
}

// Extract the trailing "Desc_X_C" class identifier from an object-reference property.
string? Ref(UObject e, string prop)
{
    var raw = e.Properties.FirstOrDefault(p => p.Name.Text == prop)?.Tag?.GenericValue?.ToString();
    if (raw == null) { return null; }
    var m = Regex.Match(raw, @"\.([A-Za-z0-9_]+)'?$");
    return m.Success ? m.Groups[1].Value : raw;
}

string Purity(UObject e)
{
    var raw = e.Properties.FirstOrDefault(p => p.Name.Text == "mPurity")?.Tag?.GenericValue?.ToString();
    if (raw == null) { return "normal"; }            // unversioned default is omitted
    if (raw.Contains("Inpure")) { return "impure"; } // game's enum spells it "RP_Inpure"
    if (raw.Contains("Pure")) { return "pure"; }
    return "normal";
}

var collectibles = new List<object>();
var collCounts = new Dictionary<string, int>();
var nodes = new List<object>();
var nodeCounts = new Dictionary<string, int>();
var seenCollectibles = new HashSet<string>(); // dedupe by id across both passes

void AddCollectible(UObject e, string kind)
{
    var loc = Loc(e);
    if (loc == null) { return; }
    if (!seenCollectibles.Add($"{kind}:{e.Name}")) { return; }
    int x = (int) loc.Value.X, y = (int) loc.Value.Y, z = (int) loc.Value.Z;
    // Schematic-keyed kinds (helmet/tapes) carry a schematic instead of a GUID.
    object entry = schematicKinds.Contains(kind)
        ? new { id = e.Name, kind, schematic = SchematicFor(e), x, y, z }
        : new { id = e.Name, kind, guid = GuidFor(e, kind), x, y, z };
    collectibles.Add(entry);
    collCounts[kind] = collCounts.GetValueOrDefault(kind) + 1;
}

// --- Pass 1: collectibles (incl. the customizer helmet) from the WP cells ---
var cells = provider.Files.Keys.Where(k => k.Contains("/_Generated_/") && k.EndsWith(".umap")).ToList();
Console.WriteLine($"sweeping {cells.Count} cells for collectibles...");
var n = 0;
foreach (var cell in cells)
{
    if (++n % 1000 == 0) { Console.WriteLine($"  ...{n}/{cells.Count}"); }
    try
    {
        foreach (var e in provider.LoadPackage(cell).GetExports())
        {
            if (collectibleKinds.TryGetValue(e.ExportType, out var kind)) { AddCollectible(e, kind); }
        }
    }
    catch (Exception ex) { Console.Error.WriteLine($"[cell] {cell}: {ex.Message}"); }
}

// --- Pass 2: resource nodes (+ drop pods and music tapes) from the persistent level ---
var levelPkgs = provider.Files.Keys
    .Where(k => k.Contains("/GameLevel01/") && k.EndsWith(".umap") && !k.Contains("/_Generated_/"))
    .ToList();
Console.WriteLine($"sweeping {levelPkgs.Count} persistent-level package(s) for resource nodes...");
foreach (var pkgPath in levelPkgs)
{
    try
    {
        foreach (var e in provider.LoadPackage(pkgPath).GetExports())
        {
            // Collectibles that live in the persistent level rather than the cells.
            if (collectibleKinds.TryGetValue(e.ExportType, out var ck) && (ck == "hardDrive" || ck == "mtape"))
            {
                AddCollectible(e, ck);
            }
            if (!nodeKinds.TryGetValue(e.ExportType, out var kind)) { continue; }
            var loc = Loc(e);
            if (loc == null) { continue; }
            var resourceClass = kind == "geyser" ? null : Ref(e, "mResourceClass");
            var purity = kind == "frackingCore" ? null : Purity(e);
            nodes.Add(new { id = e.Name, kind, resourceClass, purity, x = (int) loc.Value.X, y = (int) loc.Value.Y, z = (int) loc.Value.Z });
            nodeCounts[kind] = nodeCounts.GetValueOrDefault(kind) + 1;
        }
    }
    catch (Exception ex) { Console.Error.WriteLine($"[lvl] {pkgPath}: {ex.Message}"); }
}

// Alphabetical so the counts block is stable across re-extractions.
var counts = new SortedDictionary<string, int>(StringComparer.Ordinal);
foreach (var kv in collCounts) { counts[kv.Key] = kv.Value; }
foreach (var kv in nodeCounts) { counts[kv.Key] = kv.Value; }

var dataset = new
{
    gameVersion,
    build,
    source = "first-party asset extraction (CUE4Parse + shipped FactoryGame.usmap)",
    counts,
    // Deterministic ordering (kind, then id) so a regenerated dataset diffs only
    // on genuine world changes, not on asset-enumeration order.
    collectibles = collectibles
        .OrderBy(c => (string) ((dynamic) c).kind, StringComparer.Ordinal)
        .ThenBy(c => (string) ((dynamic) c).id, StringComparer.Ordinal)
        .ToList(),
    resourceNodes = nodes
        .OrderBy(c => (string) ((dynamic) c).kind, StringComparer.Ordinal)
        .ThenBy(c => (string) ((dynamic) c).id, StringComparer.Ordinal)
        .ToList(),
};

// UnsafeRelaxedJsonEscaping keeps printable ASCII such as '+' literal instead of
// escaping it to a unicode sequence; this is a data file, not HTML, so relaxed
// escaping is safe and keeps the output readable.
var json = JsonSerializer.Serialize(dataset, new JsonSerializerOptions
{
    WriteIndented = true,
    Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
});
// Always write LF, even though this tool runs on Windows (where the indented
// serialiser emits CRLF). The committed dataset is LF; emitting it directly
// keeps `git diff`/status clean before .gitattributes normalisation kicks in.
json = json.Replace("\r\n", "\n");
File.WriteAllText(outPath, json);

Console.WriteLine("=== COUNTS ===");
foreach (var kv in counts.OrderBy(k => k.Key)) { Console.WriteLine($"  {kv.Key}: {kv.Value}"); }
Console.WriteLine($"collectibles={collectibles.Count} resourceNodes={nodes.Count}");
Console.WriteLine($"written -> {outPath}");
Console.WriteLine("DONE");
