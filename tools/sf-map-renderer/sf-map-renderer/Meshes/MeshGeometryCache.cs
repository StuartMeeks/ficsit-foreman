using SfMapRenderer.Flora;

namespace SfMapRenderer.Meshes;

/// <summary>LOD0 geometry for a placed mesh: vertices, triangle indices, and a per-triangle foliage flag.</summary>
public sealed record MeshGeometry(FVector[] Vertices, int[] Triangles, bool[] TriangleIsFoliage);

/// <summary>
/// Loads and caches a static mesh's LOD0 geometry (by asset path), classifying each triangle as foliage
/// or trunk from its material section. LOD0 is used for full detail (smooth cliffs, no facets).
/// </summary>
public sealed class MeshGeometryCache
{
    private static readonly MeshGeometry Empty = new([], [], []);

    private readonly Dictionary<string, MeshGeometry> _cache = [];

    public int Count => _cache.Count;

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

    private static MeshGeometry Load(FPackageIndex mesh)
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

                var triangleIsFoliage = new bool[indexBuffer.Length / 3];
                if (lod.Sections != null)
                {
                    foreach (var section in lod.Sections)
                    {
                        var material = materials != null && section.MaterialIndex < materials.Length ? materials[section.MaterialIndex] : null;
                        var materialPath = material?.MaterialInterface?.GetPathName() ?? "";
                        var materialBaseName = materialPath.Contains('/')
                            ? materialPath[(materialPath.LastIndexOf('/') + 1)..].Split('.')[0]
                            : materialPath;
                        var name = (material?.MaterialSlotName.Text ?? "") + " " + materialBaseName;
                        if (!TreeSectionClassifier.IsFoliageMaterial(name))
                        {
                            continue;
                        }

                        for (var triangle = (int)(section.FirstIndex / 3);
                             triangle < (section.FirstIndex + section.NumTriangles * 3) / 3 && triangle < triangleIsFoliage.Length;
                             triangle++)
                        {
                            triangleIsFoliage[triangle] = true;
                        }
                    }
                }

                return new MeshGeometry(vertices, triangles, triangleIsFoliage);
            }
        }
        catch
        {
            // A mesh that fails to load contributes no relief — the same tolerant behaviour as before.
        }

        return Empty;
    }
}
