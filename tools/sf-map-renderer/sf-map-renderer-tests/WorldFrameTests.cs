using SfMapRenderer.Configuration;

using Xunit;

namespace SfMapRenderer.Tests;

public class WorldFrameTests
{
    // The standard full-res frame: DS=2, section min −2900 (comps min −2540 minus the 360 margin).
    private static WorldFrame StandardFrame() => new(downsample: 2, minSectionX: -2900, minSectionY: -2900, width: 3917, height: 3409, actorZ: 100.0);

    [Fact]
    public void HeightMidpointDecodesToActorZ()
    {
        Assert.Equal(100.0, StandardFrame().HeightToZ(WorldFrame.HeightMid), precision: 6);
    }

    [Fact]
    public void OneHundredTwentyEightHeightUnitsIsOneMetre()
    {
        // 128 h16 units = 1 m = 100 cm above the actor base.
        Assert.Equal(200.0, StandardFrame().HeightToZ(WorldFrame.HeightMid + 128), precision: 6);
    }

    [Theory]
    [InlineData(0.0)]
    [InlineData(12345.0)]
    [InlineData(-9600.0)]
    public void HeightAndZRoundTrip(double z)
    {
        var frame = StandardFrame();
        Assert.Equal(z, frame.HeightToZ(frame.ZToHeight16(z)), precision: 6);
    }

    [Fact]
    public void ColumnZeroMapsToTheDocumentedWorldOrigin()
    {
        // docs: at DS=2, worldX = −340800 + gx·200.
        var frame = StandardFrame();
        Assert.Equal(-340800.0, frame.WorldXAtColumn(0), precision: 6);
        Assert.Equal(-340600.0, frame.WorldXAtColumn(1), precision: 6);
    }

    [Fact]
    public void FractionalColumnInvertsWorldXAtColumn()
    {
        var frame = StandardFrame();
        Assert.Equal(0.0, frame.FractionalColumn(frame.WorldXAtColumn(0)), precision: 6);
        Assert.Equal(37.0, frame.FractionalColumn(frame.WorldXAtColumn(37)), precision: 6);
    }
}
