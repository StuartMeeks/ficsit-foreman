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
            // Absent optional fields degrade cleanly.
            Assert.Null(biome.LabelCell);
            Assert.Null(biome.StartIndex);
            Assert.Null(biome.LabelColour);
            Assert.Empty(biome.SubLocations);
            Assert.Equal("Test Biome", biome.DisplayLabel);
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void LoadsLabelCellStartIndexAndSubLocations()
    {
        var path = Path.GetTempFileName();
        try
        {
            File.WriteAllText(path,
                """
                { "biomes": [ {
                    "name": "GRASS FIELDS",
                    "startIndex": 1,
                    "labelCell": "J4",
                    "subLocations": [ { "name": "Forgotten Beach", "labelCell": "C8" }, { "name": "Savanna" } ],
                    "polygons": [ [ [0.0, 0.0], [1.0, 0.0], [1.0, 1.0] ] ]
                } ] }
                """);

            var biome = Assert.Single(BiomeDataset.Load(path));
            Assert.Equal("GRASS FIELDS", biome.Name);
            Assert.Equal("J4", biome.LabelCell);
            Assert.Equal(1, biome.StartIndex);
            // A starting biome gets a "(START n)" line appended for the map label; the name itself is untouched.
            Assert.Equal("GRASS FIELDS\n( START 1 )", biome.DisplayLabel);
            Assert.Collection(
                biome.SubLocations,
                first => { Assert.Equal("Forgotten Beach", first.Name); Assert.Equal("C8", first.LabelCell); },
                second => { Assert.Equal("Savanna", second.Name); Assert.Null(second.LabelCell); });
        }
        finally
        {
            File.Delete(path);
        }
    }
}
