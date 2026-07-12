using SfMapRenderer.Artifacts;

using SixLabors.ImageSharp;

using Xunit;

namespace SfMapRenderer.Tests;

public class MapAnnotationsTests
{
    // A 4000×3400 image over the 40×34 grid → 100×100 px cells, so a cell's centre is (col+0.5)·100, (row+0.5)·100.
    private const double Width = 4000;
    private const double Height = 3400;

    [Theory]
    [InlineData("A1", 50, 50)]     // first column, first row
    [InlineData("J4", 950, 350)]   // J = column index 9
    [InlineData("aa1", 2650, 50)]  // AA = column index 26; case-insensitive
    [InlineData("AN34", 3950, 3350)] // last column, last row
    public void TryCellCentreResolvesToTheCellCentre(string cell, double expectedX, double expectedY)
    {
        Assert.True(MapAnnotations.TryCellCentre(cell, Width, Height, out var centre));
        Assert.Equal(expectedX, centre.X, precision: 3);
        Assert.Equal(expectedY, centre.Y, precision: 3);
    }

    [Theory]
    [InlineData("A1 right", 85, 50)]            // +0.35 in x → (0.85)·100
    [InlineData("J4 bottom", 950, 385)]         // +0.35 in y → (3.85)·100
    [InlineData("S6 (bottom right)", 1885, 585)] // corner, parentheses ignored: col18, row5
    [InlineData("A1 top left", 15, 15)]         // −0.35 in both
    [InlineData("F14 down half", 550, 1400)]    // col5, row13; +0.5 in y → (13.5+0.5)? no: (13+1.0)·100
    [InlineData("W15 right 0.6 down 0.25", 2310, 1475)] // col22 +0.6 → 23.1·100; row14 +0.25 → 14.75·100
    [InlineData("H31 bottom right 0.85", 835, 3085)]    // col7 +0.85 → 7.85·100; row30 +0.35 → 30.85·100
    public void TryCellCentreAppliesWithinCellNudge(string cell, double expectedX, double expectedY)
    {
        Assert.True(MapAnnotations.TryCellCentre(cell, Width, Height, out var centre));
        Assert.Equal(expectedX, centre.X, precision: 3);
        Assert.Equal(expectedY, centre.Y, precision: 3);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("1")]     // no column letters
    [InlineData("A")]     // no row digits
    [InlineData("A0")]    // rows are 1-based
    [InlineData("A35")]   // past 34 rows
    [InlineData("AO1")]   // past column AN (index 40)
    [InlineData("ZZ1")]   // three-plus effective columns; out of range
    public void TryCellCentreRejectsInvalidReferences(string? cell)
    {
        Assert.False(MapAnnotations.TryCellCentre(cell, Width, Height, out _));
    }

    [Fact]
    public void ParseColourHandlesNamesHexAndFallback()
    {
        Assert.Equal(Color.White, MapAnnotations.ParseColour("white", Color.Black));
        Assert.Equal(Color.White, MapAnnotations.ParseColour("#FFFFFF", Color.Black));
        Assert.Equal(Color.Black, MapAnnotations.ParseColour(null, Color.Black));
        Assert.Equal(Color.Black, MapAnnotations.ParseColour("not-a-colour", Color.Black));
    }
}
