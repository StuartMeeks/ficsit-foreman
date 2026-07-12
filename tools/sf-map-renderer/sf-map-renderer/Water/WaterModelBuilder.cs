using SfMapRenderer.Collection;
using SfMapRenderer.Configuration;
using SfMapRenderer.Geometry;
using SfMapRenderer.Rendering;

namespace SfMapRenderer.Water;

/// <summary>
/// Lays the water model onto the render state, in the game's own geometry order: flood the border-connected
/// void, rasterise the FGWaterVolume footprints (unifying the ocean band and flagging ocean-void), apply the
/// blue-box margin override, stamp river ribbons and shallow ponds, then flood the wet-sand shelf. Each step
/// is a separate call so the CELLS/PROBEXY probes can slot in between the ponds and the wet-sand flood, and
/// ztest before any of it — exactly as the original early-returns did.
/// </summary>
public static class WaterModelBuilder
{
    private static bool IsOceanBand(double z) => z >= -1850 && z <= -1600;

    /// <summary>The real sea: void connected to the map border. Inland data-gap void is not sea.</summary>
    public static void FloodOceanVoid(RenderState state)
    {
        var frame = state.Frame;
        int width = frame.Width, height = frame.Height;
        var heightGrid = state.Height;
        var oceanVoid = state.OceanVoid;
        var queue = new Queue<int>();

        void Seed(int i)
        {
            if (!oceanVoid[i] && heightGrid[i] == 0)
            {
                oceanVoid[i] = true;
                queue.Enqueue(i);
            }
        }

        for (var x = 0; x < width; x++)
        {
            Seed(x);
            Seed((height - 1) * width + x);
        }

        for (var y = 0; y < height; y++)
        {
            Seed(y * width);
            Seed(y * width + width - 1);
        }

        while (queue.Count > 0)
        {
            var i = queue.Dequeue();
            int cx = i % width, cy = i / width;
            if (cx > 0)
            {
                Seed(i - 1);
            }

            if (cx < width - 1)
            {
                Seed(i + 1);
            }

            if (cy > 0)
            {
                Seed(i - width);
            }

            if (cy < height - 1)
            {
                Seed(i + width);
            }
        }
    }

    /// <summary>
    /// Rasterise every FGWaterVolume face: a cell is water where the seabed is at/below the volume's surface.
    /// Sea-band volumes snap to the unified <c>OCEANZ</c>; void cells inside an ocean-band volume become
    /// ocean-void (blue). Overlaps keep the highest surface.
    /// </summary>
    public static void RasteriseVolumes(RenderState state, IReadOnlyList<WaterVolumeFace> volumes, RenderOptions options)
    {
        Console.WriteLine($"water-volume rasterise ({volumes.Count} FGWaterVolume faces)...");
        var frame = state.Frame;
        int width = frame.Width, height = frame.Height;
        var baseHeight = state.BaseHeight;
        var isOcean = state.IsOcean;
        var waterZ = state.WaterZ;
        var volumeVoid = state.VolumeVoid;

        foreach (var (polygon, rawSurfaceZ) in volumes)
        {
            var surfaceZ = IsOceanBand(rawSurfaceZ) ? options.OceanZ : rawSurfaceZ;
            double minX = polygon.Min(p => p.X), maxX = polygon.Max(p => p.X), minY = polygon.Min(p => p.Y), maxY = polygon.Max(p => p.Y);
            int gx0 = Math.Max(0, (int)frame.FractionalColumn(minX)), gx1 = Math.Min(width - 1, (int)Math.Ceiling(frame.FractionalColumn(maxX)));
            int gy0 = Math.Max(0, (int)frame.FractionalRow(minY)), gy1 = Math.Min(height - 1, (int)Math.Ceiling(frame.FractionalRow(maxY)));

            for (var gy = gy0; gy <= gy1; gy++)
            {
                for (var gx = gx0; gx <= gx1; gx++)
                {
                    var index = gy * width + gx;
                    if (baseHeight[index] != 0 && frame.HeightToZ(baseHeight[index]) > surfaceZ)
                    {
                        continue;
                    }

                    if (!Polygons.Contains(polygon, frame.WorldXAtColumn(gx), frame.WorldYAtRow(gy)))
                    {
                        continue;
                    }

                    if (baseHeight[index] == 0)
                    {
                        if (IsOceanBand(rawSurfaceZ))
                        {
                            volumeVoid[index] = true;
                        }

                        continue;
                    }

                    if (!isOcean[index] || surfaceZ > waterZ[index])
                    {
                        isOcean[index] = true;
                        waterZ[index] = surfaceZ;
                    }
                }
            }
        }
    }

    /// <summary>Force void cells inside the far-west margin rectangles to ocean-blue.</summary>
    public static void ApplyBlueBoxes(RenderState state, RenderOptions options)
    {
        var frame = state.Frame;
        int width = frame.Width, height = frame.Height;
        var baseHeight = state.BaseHeight;
        var volumeVoid = state.VolumeVoid;
        var boxes = options.BlueBoxes;
        var forced = 0;

        for (var gy = 0; gy < height; gy++)
        {
            for (var gx = 0; gx < width; gx++)
            {
                var index = gy * width + gx;
                if (baseHeight[index] != 0 || volumeVoid[index])
                {
                    continue;
                }

                double wx = frame.WorldXAtColumn(gx), wy = frame.WorldYAtRow(gy);
                if (boxes.Any(b => wx >= b.X0 && wx <= b.X1 && wy >= b.Y0 && wy <= b.Y1))
                {
                    volumeVoid[index] = true;
                    forced++;
                }
            }
        }

        if (forced > 0)
        {
            Console.WriteLine($"blue-box override: {forced} void cells forced ocean-blue.");
        }
    }

    /// <summary>Hermite-sample each BP_River segment and stamp a ribbon where terrain is at/below the surface.</summary>
    public static void StampRivers(RenderState state, IReadOnlyList<RiverActor> rivers, RenderOptions options)
    {
        var riverHalfWidth = options.RiverHalfWidthCm;
        var riverTolerance = options.RiverToleranceCm;
        Console.WriteLine($"river rasterise ({rivers.Count} BP_River actors, W={riverHalfWidth} tol={riverTolerance})...");

        var frame = state.Frame;
        int width = frame.Width, height = frame.Height;
        var heightGrid = state.Height;
        var isOcean = state.IsOcean;
        var isLake = state.IsLake;
        var waterZ = state.WaterZ;
        long marked = 0;

        foreach (var river in rivers)
        {
            double cos = Math.Cos(river.Yaw), sin = Math.Sin(river.Yaw);

            (double X, double Y, double Z) ToWorld(FVector p)
            {
                double lx = p.X * river.Scale.X, ly = p.Y * river.Scale.Y, lz = p.Z * river.Scale.Z;
                return (river.Location.X + lx * cos - ly * sin, river.Location.Y + lx * sin + ly * cos, river.Location.Z + lz);
            }

            foreach (var segment in river.Segments)
            {
                const int samples = 48;
                for (var i = 0; i <= samples; i++)
                {
                    double t = (double)i / samples, t2 = t * t, t3 = t2 * t;
                    double h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
                    var local = new FVector(
                        (float)(h00 * segment.StartPos.X + h10 * segment.StartTangent.X + h01 * segment.EndPos.X + h11 * segment.EndTangent.X),
                        (float)(h00 * segment.StartPos.Y + h10 * segment.StartTangent.Y + h01 * segment.EndPos.Y + h11 * segment.EndTangent.Y),
                        (float)(h00 * segment.StartPos.Z + h10 * segment.StartTangent.Z + h01 * segment.EndPos.Z + h11 * segment.EndTangent.Z));
                    var (wx, wy, wz) = ToWorld(local);
                    var half = riverHalfWidth * (segment.StartScale + (segment.EndScale - segment.StartScale) * t);

                    int gx0 = Math.Max(0, (int)frame.FractionalColumn(wx - half)), gx1 = Math.Min(width - 1, (int)Math.Ceiling(frame.FractionalColumn(wx + half)));
                    int gy0 = Math.Max(0, (int)frame.FractionalRow(wy - half)), gy1 = Math.Min(height - 1, (int)Math.Ceiling(frame.FractionalRow(wy + half)));
                    var halfSquared = half * half;

                    for (var gy = gy0; gy <= gy1; gy++)
                    {
                        for (var gx = gx0; gx <= gx1; gx++)
                        {
                            var j = gy * width + gx;
                            if (isOcean[j] || heightGrid[j] == 0)
                            {
                                continue;
                            }

                            if (frame.HeightToZ(heightGrid[j]) > wz + riverTolerance)
                            {
                                continue;
                            }

                            double dx = frame.WorldXAtColumn(gx) - wx, dy = frame.WorldYAtRow(gy) - wy;
                            if (dx * dx + dy * dy > halfSquared)
                            {
                                continue;
                            }

                            isOcean[j] = true;
                            isLake[j] = true;
                            waterZ[j] = wz;
                            marked++;
                        }
                    }
                }
            }
        }

        Console.WriteLine($"  rivers: marked={marked} cells");
    }

    /// <summary>Fill shallow BP_Water bodies (a scaled/rotated surface plane) where not already ocean.</summary>
    public static void FillShallowPonds(RenderState state, IReadOnlyList<WaterBodySeed> seeds, RenderOptions options)
    {
        Console.WriteLine($"shallow-water supplement ({seeds.Count} BP_Water bodies)...");
        var frame = state.Frame;
        int width = frame.Width, height = frame.Height;
        var heightGrid = state.Height;
        var isOcean = state.IsOcean;
        var isLake = state.IsLake;
        var waterZ = state.WaterZ;
        long marked = 0, skippedOcean = 0, skippedHigh = 0;
        var debugged = 0;

        foreach (var seed in seeds)
        {
            double halfWidth = 50.0 * Math.Max(1, Math.Abs(seed.ScaleX)), halfDepth = 50.0 * Math.Max(1, Math.Abs(seed.ScaleY));
            if (debugged++ < 5)
            {
                Console.WriteLine($"   body ({seed.X:F0},{seed.Y:F0},{seed.Z:F0}) scale=({seed.ScaleX:F0},{seed.ScaleY:F0}) -> footprint {halfWidth * 2:F0}x{halfDepth * 2:F0} cm");
            }

            var yaw = seed.Yaw * Math.PI / 180.0;
            double cos = Math.Cos(-yaw), sin = Math.Sin(-yaw);
            var radius = Math.Max(halfWidth, halfDepth);
            int gx0 = Math.Max(0, (int)frame.FractionalColumn(seed.X - radius)), gx1 = Math.Min(width - 1, (int)frame.FractionalColumn(seed.X + radius));
            int gy0 = Math.Max(0, (int)frame.FractionalRow(seed.Y - radius)), gy1 = Math.Min(height - 1, (int)frame.FractionalRow(seed.Y + radius));

            for (var gy = gy0; gy <= gy1; gy++)
            {
                for (var gx = gx0; gx <= gx1; gx++)
                {
                    var j = gy * width + gx;
                    if (isOcean[j])
                    {
                        skippedOcean++;
                        continue;
                    }

                    if (heightGrid[j] == 0)
                    {
                        continue;
                    }

                    if (frame.HeightToZ(heightGrid[j]) > seed.Z)
                    {
                        skippedHigh++;
                        continue;
                    }

                    double dx = frame.WorldXAtColumn(gx) - seed.X, dy = frame.WorldYAtRow(gy) - seed.Y;
                    double rx = dx * cos - dy * sin, ry = dx * sin + dy * cos;
                    if (Math.Abs(rx) <= halfWidth && Math.Abs(ry) <= halfDepth)
                    {
                        isOcean[j] = true;
                        isLake[j] = true;
                        waterZ[j] = seed.Z;
                        marked++;
                    }
                }
            }
        }

        Console.WriteLine($"  supplement: marked={marked}  skipOcean={skippedOcean}  skipTerrainAboveSurface={skippedHigh}");
    }

    /// <summary>
    /// Seed from shallow WetSand/Puddles cells, then BFS-spread through connected shallow below-sea terrain
    /// (any material) within a depth cap — the coastal shelf the meshed landscape hides underwater.
    /// </summary>
    public static void FloodWetSand(RenderState state, RenderOptions options)
    {
        var frame = state.Frame;
        int width = frame.Width, height = frame.Height, cellCount = width * height;
        var baseHeight = state.BaseHeight;
        var wetWeight = state.WetWeight;
        var isOcean = state.IsOcean;
        var isLake = state.IsLake;
        var waterZ = state.WaterZ;

        var threshold = options.WetThreshold;
        double wetSea = options.WetSeaZ, wetCut = wetSea + options.WetRiseCm, wetFloor = wetSea - options.WetDeepCm;

        bool IsShallowSubmerged(int i)
        {
            if (baseHeight[i] == 0)
            {
                return false;
            }

            var z = frame.HeightToZ(baseHeight[i]);
            return z < wetCut && z >= wetFloor;
        }

        var queue = new Queue<int>();
        for (var i = 0; i < cellCount; i++)
        {
            if (!isOcean[i] && wetWeight[i] >= threshold && IsShallowSubmerged(i))
            {
                isOcean[i] = true;
                isLake[i] = true;
                waterZ[i] = Math.Max(wetSea, frame.HeightToZ(baseHeight[i]));
                queue.Enqueue(i);
            }
        }

        long seeded = queue.Count, flooded = queue.Count;
        while (queue.Count > 0)
        {
            var i = queue.Dequeue();
            int cx = i % width, cy = i / width;

            void Spread(int j)
            {
                if (!isOcean[j] && IsShallowSubmerged(j))
                {
                    isOcean[j] = true;
                    isLake[j] = true;
                    waterZ[j] = Math.Max(wetSea, frame.HeightToZ(baseHeight[j]));
                    queue.Enqueue(j);
                    flooded++;
                }
            }

            if (cx > 0)
            {
                Spread(i - 1);
            }

            if (cx < width - 1)
            {
                Spread(i + 1);
            }

            if (cy > 0)
            {
                Spread(i - width);
            }

            if (cy < height - 1)
            {
                Spread(i + width);
            }
        }

        Console.WriteLine($"submerged shallows: {seeded} wet seeds -> {flooded} cells (WetSand/Puddles>={threshold}, spread through shallow below-sea terrain)");
    }
}
