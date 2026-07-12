using SfMapRenderer.Artifacts;

using Xunit;

namespace SfMapRenderer.Tests;

public class BiomeDatasetTests
{
    [Fact]
    public void LoadsNamesAndWorldCmRings()
    {
        var path = Path.GetTempFileName();
        try
        {
            File.WriteAllText(path,
                """
                { "biomes": [ { "name": "Test Biome", "polygons": [ [ [1.0, 2.0], [3.0, 4.0], [5.0, 6.0] ] ] } ] }
                """);

            var biomes = BiomeDataset.Load(path);

            var biome = Assert.Single(biomes);
            Assert.Equal("Test Biome", biome.Name);
            var ring = Assert.Single(biome.Polygons);
            Assert.Equal(3, ring.Length);
            Assert.Equal((1.0, 2.0), ring[0]);
            Assert.Equal((5.0, 6.0), ring[2]);
        }
        finally
        {
            File.Delete(path);
        }
    }
}
