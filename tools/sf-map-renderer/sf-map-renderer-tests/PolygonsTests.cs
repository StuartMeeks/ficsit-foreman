using SfMapRenderer.Geometry;

using Xunit;

namespace SfMapRenderer.Tests;

public class PolygonsTests
{
    private static readonly (double X, double Y)[] UnitSquare =
        [(0, 0), (10, 0), (10, 10), (0, 10)];

    [Theory]
    [InlineData(5, 5, true)]
    [InlineData(0.1, 0.1, true)]
    [InlineData(15, 5, false)]
    [InlineData(-1, 5, false)]
    [InlineData(5, 20, false)]
    public void ContainsMatchesEvenOddRule(double x, double y, bool expected)
    {
        Assert.Equal(expected, Polygons.Contains(UnitSquare, x, y));
    }
}
