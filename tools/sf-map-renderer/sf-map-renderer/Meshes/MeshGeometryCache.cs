using CUE4Parse.UE4.Assets.Exports.Material;

using SfMapRenderer.Flora;

namespace SfMapRenderer.Meshes;

/// <summary>
/// LOD0 geometry for a placed mesh: vertices, triangle indices, a per-triangle foliage flag, and a per-triangle
/// base colour sampled from the section's material texture (0,0,0 = not sampled → caller uses its palette).
/// </summary>
public sealed record MeshGeometry(FVector[] Vertices, int[] Triangles, bool[] TriangleIsFoliage, byte[] TriangleColour);

/// <summary>
/// Loads and caches a static mesh's LOD0 geometry (by asset path), classifying each triangle as foliage or
/// trunk from its material section and sampling each section's material albedo colour. LOD0 is used for full
/// detail (smooth cliffs, no facets) — and, conveniently, excludes the LOD billboard/imposter materials.
/// </summary>
public sealed class MeshGeometryCache
{
    private static readonly MeshGeometry Empty = new([], [], [], []);

    private readonly Dictionary<string, MeshGeometry> _cache = [];
    private readonly MaterialColourSampler _sampler = new();

    public int Count => _cache.Count;

    public int SampledMaterialCount => _sampler.Count;

    public MeshGeometry Get(FPackageIndex mesh)
    {
        var path = mesh.ResolvedObject?.GetPathName() ?? "";
        if (_cache.TryGetValue(path, out var cached))
        {
            return cached;
        }

        var geometry = Load(mesh);
        _cache[path] = geometry;
        return geometry;
    }

    private MeshGeometry Load(FPackageIndex mesh)
    {
        try
        {
            if (mesh.ResolvedObject?.Load() is not UStaticMesh staticMesh || staticMesh.RenderData?.LODs is not { Length: > 0 } lods)
            {
                return Empty;
            }

            var materials = staticMesh.StaticMaterials;
            foreach (var lod in lods)
            {
                if (lod?.PositionVertexBuffer?.Verts is not { Length: > 0 } vertices || lod.IndexBuffer is not { Length: > 2 } indexBuffer)
                {
                    continue;
                }

                var triangles = new int[indexBuffer.Length];
                for (var k = 0; k < indexBuffer.Length; k++)
                {
                    triangles[k] = (int)indexBuffer[k];
                }

                var triangleCount = indexBuffer.Length / 3;
                var triangleIsFoliage = new bool[triangleCount];
                var triangleColour = new byte[triangleCount * 3];
                if (lod.Sections != null)
                {
                    foreach (var section in lod.Sections)
                    {
                        var material = materials != null && section.MaterialIndex < materials.Length ? materials[section.MaterialIndex] : null;
                        var materialPath = material?.MaterialInterface?.GetPathName() ?? "";
                        var materialBaseName = materialPath.Contains('/') ? materialPath[(materialPath.LastIndexOf('/') + 1)..].Split('.')[0] : materialPath;
                        var isFoliage = TreeSectionClassifier.IsFoliageMaterial((material?.MaterialSlotName.Text ?? "") + " " + materialBaseName);
                        var colour = _sampler.Sample(material?.MaterialInterface?.Load() as UUnrealMaterial);

                        var first = (int)(section.FirstIndex / 3);
                        var last = Math.Min(triangleCount, (int)((section.FirstIndex + section.NumTriangles * 3) / 3));
                        for (var triangle = first; triangle < last && triangle >= 0; triangle++)
                        {
                            if (isFoliage)
                            {
                                triangleIsFoliage[triangle] = true;
                            }

                            if (colour is { } c)
                            {
                                triangleColour[triangle * 3] = c.R;
                                triangleColour[triangle * 3 + 1] = c.G;
                                triangleColour[triangle * 3 + 2] = c.B;
                            }
                        }
                    }
                }

                return new MeshGeometry(vertices, triangles, triangleIsFoliage, triangleColour);
            }
        }
        catch
        {
            // A mesh that fails to load contributes no relief — the same tolerant behaviour as before.
        }

        return Empty;
    }
}
