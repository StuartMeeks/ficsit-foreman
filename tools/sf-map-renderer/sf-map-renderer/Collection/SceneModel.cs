namespace SfMapRenderer.Collection;

/// <summary>One weightmap layer allocation: layer name → weightmap texture index + channel.</summary>
public readonly record struct WeightmapAllocation(string Layer, int TextureIndex, int Channel);

/// <summary>A 128×128 landscape tile: its section base plus the height + weightmap textures.</summary>
public sealed record LandscapeTile(
    int SectionX,
    int SectionY,
    UTexture2D Heightmap,
    UTexture2D[] Weightmaps,
    WeightmapAllocation[] Allocations,
    UUnrealMaterial? Material);

/// <summary>A shallow water body (BP_Water/river/pond) with a visual surface plane but no gameplay volume.</summary>
public readonly record struct WaterBodySeed(double X, double Y, double Z, double ScaleX, double ScaleY, double Yaw);

/// <summary>What a placed mesh contributes to relief and colour.</summary>
public enum PlacedMeshKind
{
    Rock,
    Coral,
    Tree,
}

/// <summary>A placed rock/flora instance whose top is rasterised into the height grid.</summary>
public readonly record struct PlacedMesh(
    FPackageIndex Mesh,
    FVector Location,
    FRotator Rotation,
    FVector Scale,
    PlacedMeshKind Kind);

/// <summary>
/// One convex BSP face of an <c>FGWaterVolume</c> (world-XY) with the volume's box Z extent
/// (<paramref name="MinZ"/>..<paramref name="SurfaceZ"/>). The rasteriser pairs the volume with its true
/// <c>BP_Water</c> surface plane using the face's own centroid (the root origin is unreliable — some volumes
/// sit at world (0,0,0) with world-space brush points).
/// </summary>
public readonly record struct WaterVolumeFace((double X, double Y)[] Polygon, double SurfaceZ, double MinZ);

/// <summary>One cubic-Hermite segment of a river centreline, in the actor's local frame.</summary>
public readonly record struct RiverSegment(
    FVector StartPos,
    FVector StartTangent,
    FVector EndPos,
    FVector EndTangent,
    double StartScale,
    double EndScale);

/// <summary>A BP_River actor: its world transform plus the spline-mesh segments that deform SM_RiverPlane.</summary>
public sealed record RiverActor(FVector Location, double Yaw, FVector Scale, IReadOnlyList<RiverSegment> Segments);
