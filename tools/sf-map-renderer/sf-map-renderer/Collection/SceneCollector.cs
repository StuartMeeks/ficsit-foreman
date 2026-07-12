using SfMapRenderer.Assets;
using SfMapRenderer.Configuration;

namespace SfMapRenderer.Collection;

/// <summary>
/// Pass A: sweeps the landscape cells and the persistent level, accumulating everything the render
/// needs — landscape tiles, placed rock/flora meshes, water volumes, rivers and shallow-water seeds.
/// Each <c>TryAdd*</c> mirrors the corresponding routine in the original single-file renderer so the
/// collected order (and therefore the rasterise/z-buffer order) is preserved exactly.
/// </summary>
public sealed class SceneCollector
{
    private readonly RenderOptions _options;

    public SceneCollector(RenderOptions options)
    {
        _options = options;
    }

    public List<LandscapeTile> Tiles { get; } = [];
    public List<WaterBodySeed> WaterSeeds { get; } = [];
    public List<PlacedMesh> Meshes { get; } = [];
    public List<WaterVolumeFace> WaterVolumes { get; } = [];
    public List<RiverActor> Rivers { get; } = [];
    public int FloraInstanceCount { get; private set; }
    public int ExcludedRockCount { get; private set; }

    /// <summary>A landscape tile — its section base plus height and weightmap textures.</summary>
    public void TryAddTile(UObject export)
    {
        if (export.ExportType != "LandscapeComponent")
        {
            return;
        }

        if (export.GetOrDefault<UObject?>("HeightmapTexture") is not UTexture2D heightmap)
        {
            return;
        }

        var weightmaps = export.GetOrDefault<UTexture2D[]>("WeightmapTextures") ?? [];
        var rawAllocations = export.GetOrDefault<FStructFallback[]>("WeightmapLayerAllocations") ?? [];
        var allocations = rawAllocations
            .Select(a => new WeightmapAllocation(
                a.GetOrDefault<UObject?>("LayerInfo")?.Name?.Replace("_LayerInfo", "", StringComparison.Ordinal) ?? "",
                a.GetOrDefault<byte>("WeightmapTextureIndex"),
                a.GetOrDefault<byte>("WeightmapTextureChannel")))
            .Where(a => a.Layer.Length > 0)
            .ToArray();

        Tiles.Add(new LandscapeTile(
            export.GetOrDefault<int>("SectionBaseX"),
            export.GetOrDefault<int>("SectionBaseY"),
            heightmap,
            weightmaps,
            allocations));
    }

    /// <summary>A shallow water body: its visual WaterSurface plane (location + scale + yaw in degrees).</summary>
    public void TryAddWaterSeed(UObject export)
    {
        if (!export.ExportType.Contains("Water", StringComparison.Ordinal))
        {
            return;
        }

        var surface = export.GetOrDefault<UObject?>("WaterSurface");
        if (surface == null || !surface.HasRelativeLocation())
        {
            return;
        }

        var location = surface.RelativeLocation();
        var scale = surface.RelativeScale();
        var yawDegrees = surface.Properties.Any(p => p.Name.Text == "RelativeRotation")
            ? surface.GetOrDefault<FRotator>("RelativeRotation").Yaw
            : 0.0;

        WaterSeeds.Add(new WaterBodySeed(location.X, location.Y, location.Z, scale.X, scale.Y, yawDegrees));
    }

    /// <summary>A placed rock or flora mesh (individual component or, for flora, instanced foliage).</summary>
    public void TryAddMesh(UObject export)
    {
        if (!export.ExportType.Contains("StaticMeshComponent", StringComparison.Ordinal))
        {
            return;
        }

        var mesh = export.MeshIndex();
        var path = mesh?.ResolvedObject?.GetPathName();
        if (path == null)
        {
            return;
        }

        var kind = ClassifyMesh(path);
        if (kind == null)
        {
            return;
        }

        // Instanced foliage (FoliageInstancedStaticMeshComponent) has no RelativeLocation — its transforms
        // live in the serialized instance buffer. Individual placements take the branch below.
        if (!export.HasRelativeLocation())
        {
            if (kind is PlacedMeshKind.Coral or PlacedMeshKind.Tree
                && export is UInstancedStaticMeshComponent instanced
                && instanced.PerInstanceSMData is { Length: > 0 } instances)
            {
                var origin = export.GetOrDefault<FVector>("TranslatedInstanceSpaceOrigin");
                foreach (var instance in instances)
                {
                    var transform = instance.TransformData;
                    var world = new FVector(
                        origin.X + transform.Translation.X,
                        origin.Y + transform.Translation.Y,
                        origin.Z + transform.Translation.Z);
                    Meshes.Add(new PlacedMesh(mesh!, world, transform.Rotation.Rotator(), transform.Scale3D, kind.Value));
                    FloraInstanceCount++;
                }
            }

            return;
        }

        var location = export.RelativeLocation();
        if (kind == PlacedMeshKind.Rock && IsExcluded(path, location))
        {
            ExcludedRockCount++;
            return;
        }

        Meshes.Add(new PlacedMesh(mesh!, location, export.RelativeRotation(), export.RelativeScale(), kind.Value));
    }

    /// <summary>A BP_River actor: its transform plus every SM_RiverPlane spline segment.</summary>
    public void TryAddRiver(UObject export)
    {
        if (export.ExportType != "BP_River_PROT_C")
        {
            return;
        }

        var root = export.GetOrDefault<UObject?>("RootComponent");
        if (root == null || !root.HasRelativeLocation())
        {
            return;
        }

        var splineMeshes = export.GetOrDefault<UScriptArray?>("mSplineMeshComponents");
        if (splineMeshes == null)
        {
            return;
        }

        var segments = new List<RiverSegment>();
        foreach (var entry in splineMeshes.Properties)
        {
            var splineMesh = (entry.GenericValue as FPackageIndex)?.ResolvedObject?.Load();
            var rawParams = splineMesh?.Properties.FirstOrDefault(p => p.Name.Text == "SplineParams")?.Tag?.GenericValue;
            var splineParams = rawParams as FStructFallback ?? (rawParams as FScriptStruct)?.StructType as FStructFallback;
            if (splineParams == null)
            {
                continue;
            }

            object? Field(string name) => splineParams.Properties.FirstOrDefault(p => p.Name.Text == name)?.Tag?.GenericValue;
            segments.Add(new RiverSegment(
                AsVector(Field("StartPos")), AsVector(Field("StartTangent")),
                AsVector(Field("EndPos")), AsVector(Field("EndTangent")),
                AsScaleX(Field("StartScale")), AsScaleX(Field("EndScale"))));
        }

        if (segments.Count > 0)
        {
            Rivers.Add(new RiverActor(root.RelativeLocation(), root.RelativeYawRadians(), root.RelativeScale(), segments));
        }
    }

    /// <summary>An FGWaterVolume brush: each convex BSP face transformed to a world-XY polygon + surface Z.</summary>
    public void TryAddWaterVolume(UObject export)
    {
        if (export.ExportType != "FGWaterVolume")
        {
            return;
        }

        var root = export.GetOrDefault<UObject?>("RootComponent");
        if (root?.GetOrDefault<UObject?>("Brush") is not UModel brush
            || brush.Points is not { Length: > 0 } points
            || brush.Nodes is not { Length: > 0 } nodes
            || brush.Verts is not { Length: > 0 } verts)
        {
            return;
        }

        var location = root.RelativeLocation();
        var scale = root.RelativeScale();
        var yaw = root.RelativeYawRadians();
        double cos = Math.Cos(yaw), sin = Math.Sin(yaw);

        double surfaceZ = -1e18;
        foreach (var point in points)
        {
            surfaceZ = Math.Max(surfaceZ, location.Z + point.Z * scale.Z);
        }

        (double X, double Y) ToWorld(FVector point)
        {
            double sx = point.X * scale.X, sy = point.Y * scale.Y;
            return (location.X + sx * cos - sy * sin, location.Y + sx * sin + sy * cos);
        }

        foreach (var node in nodes)
        {
            int vertexCount = node.NumVertices;
            if (vertexCount < 3)
            {
                continue;
            }

            var polygon = new (double X, double Y)[vertexCount];
            var valid = true;
            for (var k = 0; k < vertexCount; k++)
            {
                var vertIndex = node.iVertPool + k;
                if (vertIndex < 0 || vertIndex >= verts.Length)
                {
                    valid = false;
                    break;
                }

                var pointIndex = verts[vertIndex].pVertex;
                if (pointIndex < 0 || pointIndex >= points.Length)
                {
                    valid = false;
                    break;
                }

                polygon[k] = ToWorld(points[pointIndex]);
            }

            if (valid)
            {
                WaterVolumes.Add(new WaterVolumeFace(polygon, surfaceZ));
            }
        }
    }

    private PlacedMeshKind? ClassifyMesh(string path)
    {
        if (path.Contains("/Environment/Rock/", StringComparison.Ordinal))
        {
            return PlacedMeshKind.Rock;
        }

        foreach (var folder in _options.FloraFolders)
        {
            if (path.Contains(folder, StringComparison.Ordinal))
            {
                return path.Contains("/Coral/", StringComparison.Ordinal) ? PlacedMeshKind.Coral : PlacedMeshKind.Tree;
            }
        }

        return null;
    }

    private bool IsExcluded(string path, FVector location) =>
        _options.RockExclusions.Any(x =>
            path.Contains(x.MeshName + ".", StringComparison.Ordinal)
            && Math.Abs(location.X - x.X) < 10000
            && Math.Abs(location.Y - x.Y) < 10000);

    private static FVector AsVector(object? value)
    {
        if (value is FScriptStruct scriptStruct)
        {
            value = scriptStruct.StructType;
        }

        return value switch
        {
            FVector vector => vector,
            FStructFallback fallback => new FVector(fallback.GetOrDefault<float>("X"), fallback.GetOrDefault<float>("Y"), fallback.GetOrDefault<float>("Z")),
            _ => new FVector(0, 0, 0),
        };
    }

    private static double AsScaleX(object? value)
    {
        if (value is FScriptStruct scriptStruct)
        {
            value = scriptStruct.StructType;
        }

        return value switch
        {
            FVector2D vector2 => vector2.X,
            FStructFallback fallback => fallback.GetOrDefault<float>("X"),
            _ => 1.0,
        };
    }
}
