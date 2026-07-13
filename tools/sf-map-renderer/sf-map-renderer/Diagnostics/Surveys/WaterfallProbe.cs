using CUE4Parse.UE4.Assets.Objects;

using SfMapRenderer.Assets;

namespace SfMapRenderer.Diagnostics.Surveys;

/// <summary>
/// Dumps the structure of the BP_WaterFallTool actors nearest a coordinate — property tags, any spline-mesh
/// component array (as BP_River has), and child static-mesh component transforms — so we can decide how to
/// render a waterfall's flowing water (reuse the river spline path, or stamp a mesh footprint).
/// </summary>
public static class WaterfallProbe
{
    public static void Report(GameAssetProvider assets, double targetX, double targetY)
    {
        var packages = assets.AllGameLevelPackages();
        var hits = new List<(double Distance, UObject Export)>();
        foreach (var package in packages)
        {
            try
            {
                foreach (var export in assets.Provider.LoadPackage(package).GetExports())
                {
                    if (!export.ExportType.Contains("WaterFall", StringComparison.OrdinalIgnoreCase))
                    {
                        continue;
                    }

                    var root = export.GetOrDefault<UObject?>("RootComponent");
                    var loc = root != null && root.HasRelativeLocation() ? root.GetOrDefault<FVector>("RelativeLocation") : new FVector(0, 0, 0);
                    var d = Math.Sqrt((loc.X - targetX) * (loc.X - targetX) + (loc.Y - targetY) * (loc.Y - targetY));
                    if (d < 40000)
                    {
                        hits.Add((d, export));
                    }
                }
            }
            catch
            {
                // Skip a package that fails to load.
            }
        }

        foreach (var (distance, export) in hits.OrderBy(h => h.Distance).Take(2))
        {
            Dump(distance, export);
        }

        Console.WriteLine("\nDONE");
    }

    private static void Dump(double distance, UObject export)
    {
        Console.WriteLine($"\n===== {export.ExportType}  {export.Name}  ({distance / 100:F0}m) =====");
        var root = export.GetOrDefault<UObject?>("RootComponent");
        if (root != null)
        {
            Console.WriteLine($"  root loc={root.GetOrDefault<FVector>("RelativeLocation")}  scale={root.GetOrDefault<FVector>("RelativeScale3D")}");
        }

        Console.WriteLine($"  Width={export.GetOrDefault<int>("Width")}  Curvature={export.GetOrDefault<double>("Curvature Amount")}");
        foreach (var compName in new[] { "Waterfall Top Center", "Waterfall Bottom Center" })
        {
            var comp = export.GetOrDefault<UObject?>(compName);
            if (comp != null)
            {
                var rel = comp.GetOrDefault<FVector>("RelativeLocation");
                Console.WriteLine($"  {compName}: rel={rel}  hasAbs={comp.HasRelativeLocation()}");
            }
        }

        // Spline-mesh component array, as BP_River carries?
        foreach (var arrayName in new[] { "mSplineMeshComponents", "SplineMeshComponents", "mSplineComponent", "Spline" })
        {
            var arr = export.GetOrDefault<UScriptArray?>(arrayName);
            if (arr != null)
            {
                Console.WriteLine($"  {arrayName}: {arr.Properties.Count} entries");
            }

            var single = export.GetOrDefault<UObject?>(arrayName);
            if (single != null)
            {
                Console.WriteLine($"  {arrayName}: single component {single.ExportType} {single.Name}");
                foreach (var p in single.Properties)
                {
                    Console.WriteLine($"      .{p.Name} ({p.PropertyType})");
                }
            }
        }
    }
}
