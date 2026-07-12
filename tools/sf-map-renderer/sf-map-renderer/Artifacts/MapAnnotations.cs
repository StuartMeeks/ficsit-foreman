using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Drawing;
using SixLabors.ImageSharp.Drawing.Processing;
using SixLabors.ImageSharp.Processing;

namespace SfMapRenderer.Artifacts;

/// <summary>Shared world→pixel mapping and label helpers for the review overlay and the layered artifact.</summary>
public static class MapAnnotations
{
    // The standard DS=2 render frame the Python companions assumed: origin −50800, 1 quad = 100 cm,
    // section min −2900, downsample 2. `scale` is the target-vs-full-res factor (1 for the full-res overlay).
    public static PointF Pixel(double worldX, double worldY, double scale)
    {
        var x = ((worldX + 50800) / 100 + 2900) / 2 * scale;
        var y = ((worldY + 50800) / 100 + 2900) / 2 * scale;
        return new PointF((float)x, (float)y);
    }

    /// <summary>0→A … 25→Z, 26→AA … 39→AN.</summary>
    public static string ColumnLabel(int column) =>
        column < 26 ? ((char)('A' + column)).ToString() : "A" + (char)('A' + column - 26);

    /// <summary>Draws connected line segments (the DrawLines convenience isn't in ImageSharp.Drawing 1.0).</summary>
    public static void DrawPolyline(IImageProcessingContext ctx, Color color, float thickness, PointF[] points)
    {
        var path = new PathBuilder().AddLines(points).Build();
        ctx.Draw(color, thickness, path);
    }
}
