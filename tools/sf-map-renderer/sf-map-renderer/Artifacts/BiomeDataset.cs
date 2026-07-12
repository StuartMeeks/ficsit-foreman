using System.Text.Json;

namespace SfMapRenderer.Artifacts;

/// <summary>A named biome and its world-cm boundary rings.</summary>
public sealed record Biome(string Name, IReadOnlyList<(double X, double Y)[]> Polygons);

/// <summary>
/// Loads the canonical biome polygons from <c>packages/sf-game-data/data/biomes.json</c> (#239) — the
/// same dataset the overlay and layered-artifact renderers draw. Rings are world-cm <c>[x, y]</c> pairs.
/// </summary>
public static class BiomeDataset
{
    public static IReadOnlyList<Biome> Load(string path)
    {
        using var stream = File.OpenRead(path);
        using var document = JsonDocument.Parse(stream);

        var biomes = new List<Biome>();
        foreach (var biomeElement in document.RootElement.GetProperty("biomes").EnumerateArray())
        {
            var name = biomeElement.GetProperty("name").GetString() ?? "";
            var polygons = new List<(double X, double Y)[]>();
            foreach (var polygonElement in biomeElement.GetProperty("polygons").EnumerateArray())
            {
                var ring = new List<(double X, double Y)>();
                foreach (var pointElement in polygonElement.EnumerateArray())
                {
                    ring.Add((pointElement[0].GetDouble(), pointElement[1].GetDouble()));
                }

                polygons.Add([.. ring]);
            }

            biomes.Add(new Biome(name, polygons));
        }

        return biomes;
    }
}
