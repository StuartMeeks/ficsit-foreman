using SfMapRenderer.Collection;
using SfMapRenderer.Rendering;

using Xunit;

namespace SfMapRenderer.Tests;

public class ObjectPaletteTests
{
    [Theory]
    [InlineData("/Game/FactoryGame/World/Environment/Foliage/Trees/AmberTree/SM_AmberTree_01", 176, 126, 52)]
    [InlineData("/Game/FactoryGame/World/Environment/Foliage/Trees/PurpleTree_01/SM_PurpleTree", 128, 92, 150)]
    [InlineData("/Game/FactoryGame/World/Environment/Foliage/Trees/Kapok/SM_Kapok_01", 60, 110, 55)]
    public void TreesGetTheirSpeciesColour(string path, byte r, byte g, byte b)
    {
        Assert.Equal((r, g, b), ObjectPalette.ColourFor(path, PlacedMeshKind.Tree));
    }

    [Fact]
    public void DesertRockIsTanAndCliffIsGrey()
    {
        Assert.Equal(((byte)182, (byte)152, (byte)112), ObjectPalette.ColourFor(".../Environment/Rock/DesertRock/SM_DesertRock_01", PlacedMeshKind.Rock));
        Assert.Equal(((byte)140, (byte)132, (byte)120), ObjectPalette.ColourFor(".../Environment/Rock/Cliff/CliffPillar_01", PlacedMeshKind.Rock));
    }

    [Fact]
    public void UnknownFamilyFallsBackToTheKindDefault()
    {
        Assert.Equal(((byte)70, (byte)120, (byte)74), ObjectPalette.ColourFor(".../Trees/Unknown/SM_X", PlacedMeshKind.Tree));
        // All coral renders one fixed purple, regardless of species.
        Assert.Equal(((byte)152, (byte)100, (byte)170), ObjectPalette.ColourFor(".../Coral/CoralTree/SM_X", PlacedMeshKind.Coral));
        Assert.Equal(((byte)152, (byte)100, (byte)170), ObjectPalette.ColourFor(".../Coral/Unknown/SM_X", PlacedMeshKind.Coral));
        Assert.Equal(((byte)143, (byte)135, (byte)122), ObjectPalette.ColourFor(".../Rock/Unknown/SM_X", PlacedMeshKind.Rock));
    }
}
