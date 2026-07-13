using CUE4Parse.UE4.Assets.Exports.Material;

using SfMapRenderer.Assets;
using SfMapRenderer.Meshes;

namespace SfMapRenderer.Diagnostics.Surveys;

/// <summary>
/// Samples and prints the average albedo colour of each material on the first mesh of the named families —
/// the smoke test for texture decoding (channel order, sane colours) before it feeds the render.
/// </summary>
public static class MaterialColourProbe
{
    private static readonly string[] DefaultFamilies =
        ["DesertRock", "Cliff", "Boulder", "Kapok", "GreenTree", "AmberTree", "TitanTree", "Coral"];

    public static void Report(GameAssetProvider assets, IReadOnlyList<string>? families = null)
    {
        var want = families ?? DefaultFamilies;
        var sampler = new MaterialColourSampler();
        var seen = new HashSet<string>();

        foreach (var cell in assets.GeneratedCellPackages())
        {
            try
            {
                foreach (var export in assets.Provider.LoadPackage(cell).GetExports())
                {
                    if (!export.ExportType.Contains("StaticMeshComponent", StringComparison.Ordinal))
                    {
                        continue;
                    }

                    var path = export.MeshIndex()?.ResolvedObject?.GetPathName();
                    if (path == null || !want.Any(w => path.Contains(w, StringComparison.Ordinal)))
                    {
                        continue;
                    }

                    var name = path[(path.LastIndexOf('/') + 1)..].Split('.')[0];
                    if (!seen.Add(name))
                    {
                        continue;
                    }

                    if (export.MeshIndex()!.ResolvedObject?.Load() is not UStaticMesh mesh || mesh.StaticMaterials is not { } materials)
                    {
                        continue;
                    }

                    Console.WriteLine($"\n{name}");
                    foreach (var slot in materials)
                    {
                        var material = slot.MaterialInterface?.Load() as UUnrealMaterial;
                        var colour = sampler.Sample(material);
                        var materialName = slot.MaterialInterface?.Name ?? "?";
                        Console.WriteLine(colour is { } c
                            ? $"    {materialName,-40} -> ({c.R},{c.G},{c.B})"
                            : $"    {materialName,-40} -> (no colour)");
                    }

                    if (seen.Count >= want.Count)
                    {
                        Console.WriteLine("\nDONE");
                        return;
                    }
                }
            }
            catch
            {
                // Skip a cell that fails to load.
            }
        }

        Console.WriteLine("\nDONE");
    }
}
