using System.Globalization;

using SfMapRenderer.Rendering;

namespace SfMapRenderer.Diagnostics;

/// <summary>
/// The PROBEXY probe: for each world coordinate, reports the seabed/rock heights, water classification and
/// the render prediction — the first-reach diagnostic for a land/water/void dispute.
/// </summary>
public sealed class PointProbe
{
    private readonly IReadOnlyList<(double X, double Y)> _coordinates;

    public PointProbe(IReadOnlyList<(double X, double Y)> coordinates)
    {
        _coordinates = coordinates;
    }

    public void Report(RenderState state)
    {
        var frame = state.Frame;
        int width = frame.Width, height = frame.Height;
        foreach (var (wx, wy) in _coordinates)
        {
            var column = (int)Math.Round(frame.FractionalColumn(wx));
            var row = (int)Math.Round(frame.FractionalRow(wy));
            if (column < 0 || column >= width || row < 0 || row >= height)
            {
                Console.WriteLine($"({wx:F0},{wy:F0}) OUT OF GRID");
                continue;
            }

            var idx = row * width + column;
            var raisedHeight = state.Height[idx];
            var seabed = state.BaseHeight[idx];
            var rockTopZ = raisedHeight == 0 ? double.NaN : frame.HeightToZ(raisedHeight);
            var seabedZ = seabed == 0 ? double.NaN : frame.HeightToZ(seabed);
            var waterSurface = state.IsOcean[idx] ? state.WaterZ[idx].ToString("F0", CultureInfo.InvariantCulture) : "-";
            var render = state.IsOcean[idx] && !state.IsRock[idx] ? "OCEAN"
                : raisedHeight != 0 ? "land/rock"
                : state.VolumeVoid[idx] ? "OCEAN(void)"
                : "VOID(grey)";
            Console.WriteLine($"({wx:F0},{wy:F0}) rockTopZ={rockTopZ:F0} seabedZ={seabedZ:F0} isRock={state.IsRock[idx]}  isOcean={state.IsOcean[idx]} isLake={state.IsLake[idx]}  waterZ(surf)={waterSurface}  oceanVoid={state.OceanVoid[idx]} volVoid={state.VolumeVoid[idx]}  render={render}");
        }

        Console.WriteLine("DONE");
    }
}
