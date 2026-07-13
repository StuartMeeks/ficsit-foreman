namespace SfMapRenderer.Configuration;

/// <summary>Which sections of a tree mesh to rasterise.</summary>
public enum TreePart
{
    Both,
    Trunk,
    Foliage,
}

/// <summary>One placed rock instance to drop, matched by mesh name within ±100 m of an origin.</summary>
public readonly record struct RockExclusion(string MeshName, double X, double Y);

/// <summary>A world-XY rectangle used to force off-map void cells to ocean-blue.</summary>
public readonly record struct WorldRect(double X0, double Y0, double X1, double Y1);

/// <summary>
/// Every render tunable, in one typed place (each maps to a CLI option). Defaults reproduce the old
/// tool's environment-variable defaults exactly, so a default render is byte-identical.
/// </summary>
public sealed class RenderOptions
{
    /// <summary>Output downsample factor (<c>DS</c>). 8 = fast preview; 2 = full-res 3917×3409.</summary>
    public int Downsample { get; init; } = 8;

    /// <summary>Landscape Z offset (<c>ZADJ</c>) — left at 0; the historical "+51" was a mis-diagnosis.</summary>
    public double ZAdjust { get; init; }

    /// <summary>Rasterise <c>/Environment/Rock/</c> meshes (<c>ROCKS</c>).</summary>
    public bool RenderRocks { get; init; } = true;

    /// <summary>Per-instance rock exclusions (<c>ROCKEXCLUDEAT</c>).</summary>
    public IReadOnlyList<RockExclusion> RockExclusions { get; init; } = DefaultRockExclusions;

    /// <summary>Flora mesh-path substrings to render (<c>FLORA</c>); empty = flora off. Coral vs tree is
    /// decided by a <c>/Coral/</c> segment in the path.</summary>
    public IReadOnlyList<string> FloraFolders { get; init; } = DefaultFloraFolders;

    /// <summary>Flora colour cut in cm above the landscape (<c>FLORAH</c>) — low, so canopies fill.</summary>
    public double FloraColourHeightCm { get; init; } = 50.0;

    /// <summary>Which tree sections to raise (<c>TREEPART</c>).</summary>
    public TreePart TreePart { get; init; } = TreePart.Both;

    /// <summary>Trunk-disc slice height in cm above the ground it touches (<c>TRUNKBAND</c>).</summary>
    public double TrunkBandCm { get; init; } = 250.0;

    /// <summary>Also emit the surface/object rasters + per-cell class byte (<c>LAYERS</c>).</summary>
    public bool EmitLayers { get; init; }

    /// <summary>Unified sea level for ocean-band water volumes (<c>OCEANZ</c>).</summary>
    public double OceanZ { get; init; } = -1730.0;

    /// <summary>Strength of the landscape macro-variation pigment overlay, 0 disables (<c>PIGMENT</c>).</summary>
    public double PigmentStrength { get; init; } = 0.6;

    /// <summary>Per-instance rock colour jitter strength, 0 disables (<c>ROCKJITTER</c>).</summary>
    public double RockJitter { get; init; } = 0.18;

    /// <summary>World-XY rectangles forcing void cells ocean-blue (<c>BLUEBOX</c>).</summary>
    public IReadOnlyList<WorldRect> BlueBoxes { get; init; } = DefaultBlueBoxes;

    /// <summary>Null landscape-visibility holes to void (<c>VISHOLE</c>) at weight ≥ <see cref="VisibilityThreshold"/>.</summary>
    public bool NullVisibilityHoles { get; init; } = true;
    public int VisibilityThreshold { get; init; } = 128;

    /// <summary>Stamp BP_River ribbons (<c>RIVERS</c>) of half-width <see cref="RiverHalfWidthCm"/> where terrain
    /// is at/below the river surface plus <see cref="RiverToleranceCm"/>.</summary>
    public bool RenderRivers { get; init; } = true;
    public double RiverHalfWidthCm { get; init; } = 200.0;
    public double RiverToleranceCm { get; init; } = 400.0;

    /// <summary>Wet-sand shallow shelf (<c>WETWATER</c> and its tunables).</summary>
    public bool WetWater { get; init; } = true;
    public double WetSeaZ { get; init; } = -1730.0;
    public double WetRiseCm { get; init; }
    public double WetDeepCm { get; init; } = 500.0;
    public int WetThreshold { get; init; } = 50;

    /// <summary>Ocean surface Z used for the land-elevation colour ramp fallback + the bounds sidecar (<c>SEA</c>).</summary>
    public double SeaLevelZ { get; init; } = -1646.0;

    // All coral and every tree species under /Foliage/Trees/ (Kapok, DioTree, GreenTree, BluePalm, Bamboo,
    // PurpleTree, SnailBottomTree, TitanTree, Huegelainen/BalloonTree, DypsisPalm, SnakeLegs, AmberTree,
    // DeadSwampTree, …) — the full aerial canopy. Coral vs tree is decided by a /Coral/ segment.
    private static readonly string[] DefaultFloraFolders =
        ["/Environment/Foliage/Coral/", "/Environment/Foliage/Trees/"];

    // The settled ~15-instance off-map cliff list: east column, SE corner, bottom strip, north edge.
    private static readonly RockExclusion[] DefaultRockExclusions =
    [
        new("CliffFormation_05", 418204, 92745),
        new("CliffFormation_05", 612135, 252648),
        new("CaveSplitter_01", 428654, -181910),
        new("CaveSplitter_01", 428083, -81758),
        new("CaveSplitter_01", 429599, -127807),
        new("CaveSplitter_01", 426951, -233372),
        new("CaveSplitter_01", 540008, -33723),
        new("CliffFormation_05", 227628, 389675),
        new("CliffPillar_01", 378630, 334237),
        new("CaveSplitter_01", 117941, -327752),
        new("CaveSplitter_01", 108671, -358332),
        new("CaveSplitter_01", 74971, -329122),
        new("CaveSplitter_01", 467211, -200017),
        new("CliffPillar_01", 454008, 64780),
        new("CliffPillar_01", 467213, 72703),
    ];

    // The far-west frame margin (cols A-B + C33/C34) that the FGWaterVolume footprints don't quite reach.
    private static readonly WorldRect[] DefaultBlueBoxes =
    [
        new(-340800, -340800, -301630, 340968),
        new(-301630, 300864, -282045, 340968),
    ];
}
