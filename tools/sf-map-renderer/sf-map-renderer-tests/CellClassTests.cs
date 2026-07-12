using SfMapRenderer.Rendering;

using Xunit;

namespace SfMapRenderer.Tests;

public class CellClassTests
{
    [Fact]
    public void PacksSurfaceObjectAndTrunkIntoTheDocumentedBits()
    {
        // bits 0-1 surface, bits 2-3 object, bit 4 trunk.
        Assert.Equal(6, CellClass.Pack(SurfaceClass.Land, ObjectKind.Rock, hasTrunkDisc: false));       // 2 | (1<<2)
        Assert.Equal(29, CellClass.Pack(SurfaceClass.Water, ObjectKind.Foliage, hasTrunkDisc: true));    // 1 | (3<<2) | 16
        Assert.Equal(0, CellClass.Pack(SurfaceClass.Void, ObjectKind.None, hasTrunkDisc: false));
    }

    [Theory]
    [InlineData(false, false, false, SurfaceClass.Void)]
    [InlineData(false, false, true, SurfaceClass.Water)]   // off-map void inside an ocean volume
    [InlineData(true, false, false, SurfaceClass.Land)]
    [InlineData(true, true, false, SurfaceClass.Water)]    // water wins over land
    [InlineData(false, true, false, SurfaceClass.Water)]
    public void ResolvesSurfaceClass(bool hasLandscape, bool isWater, bool isOceanVoid, SurfaceClass expected)
    {
        Assert.Equal(expected, CellClass.ResolveSurface(hasLandscape, isWater, isOceanVoid));
    }
}
