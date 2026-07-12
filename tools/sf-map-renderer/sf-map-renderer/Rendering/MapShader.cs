using SfMapRenderer.Configuration;

namespace SfMapRenderer.Rendering;

/// <summary>The three colour rasters a render produces.</summary>
public sealed record MapImages(byte[] Surface, byte[] ObjectLayer, byte[] Composite);

/// <summary>
/// Colours the map. The <em>surface</em> raster (land/water/void, hillshaded on the bare landscape) is
/// computed for every cell, and the <em>object</em> raster (rock/coral/foliage, hillshaded on the object
/// height) only where an object is topmost — so a layer can reveal the ground beneath. The flat composite
/// is the surface with the object drawn over it.
/// </summary>
public static class MapShader
{
    public static MapImages Render(RenderState state, RenderOptions options)
    {
        var frame = state.Frame;
        int width = frame.Width, height = frame.Height;
        var baseHeight = state.BaseHeight;
        var heightGrid = state.Height;
        var terrain = state.Terrain;
        var isOcean = state.IsOcean;
        var isLake = state.IsLake;
        var waterZ = state.WaterZ;
        var volumeVoid = state.VolumeVoid;
        var objectKind = state.ObjectKind;
        var objectColour = state.ObjectColour;

        double lightX = -0.7071, lightY = -0.7071, lightZ = 1.0;
        var length = Math.Sqrt(lightX * lightX + lightY * lightY + lightZ * lightZ);
        lightX /= length;
        lightY /= length;
        lightZ /= length;
        var cellCm = frame.CellWidthCm;

        var surface = new byte[width * height * 3];
        var objectRaster = new byte[width * height * 3];
        var composite = new byte[width * height * 3];

        // NW-lit hillshade of height array `h` at cell (x,y). Void neighbours fall back to the centre height.
        double Shade(float[] h, int x, int y, int idx)
        {
            var centre = h[idx];
            var left = x > 0 ? h[idx - 1] : centre;
            var right = x < width - 1 ? h[idx + 1] : centre;
            var top = y > 0 ? h[idx - width] : centre;
            var bottom = y < height - 1 ? h[idx + width] : centre;
            if (left == 0)
            {
                left = centre;
            }

            if (right == 0)
            {
                right = centre;
            }

            if (top == 0)
            {
                top = centre;
            }

            if (bottom == 0)
            {
                bottom = centre;
            }

            var dzdx = (frame.HeightToZ(right) - frame.HeightToZ(left)) / (2 * cellCm);
            var dzdy = (frame.HeightToZ(bottom) - frame.HeightToZ(top)) / (2 * cellCm);
            double nx = -dzdx, ny = -dzdy, nz = 1.0;
            var normalLength = Math.Sqrt(nx * nx + ny * ny + nz * nz);
            return 0.45 + 0.55 * Math.Clamp((nx * lightX + ny * lightY + nz * lightZ) / normalLength, 0, 1);
        }

        for (var y = 0; y < height; y++)
        {
            for (var x = 0; x < width; x++)
            {
                var idx = y * width + x;
                var cell = idx * 3;
                var landHeight = baseHeight[idx];
                var isWater = isOcean[idx] || isLake[idx];
                var waterSurface = isWater ? (waterZ[idx] != 0 ? waterZ[idx] : options.OceanZ) : 0.0;
                double r, g, b;

                if (landHeight == 0 && !isWater)
                {
                    (r, g, b) = volumeVoid[idx] ? (22, 55, 110) : (46, 49, 55);
                }
                else if (isWater)
                {
                    // Floor is the raised solid top (terrain or a submerged rock), so shallow water over a
                    // submerged spire reads shallow rather than deep. Void seabed falls back to a deep floor.
                    var floorZ = landHeight == 0 ? waterSurface - 8000 : frame.HeightToZ(heightGrid[idx]);
                    // A square-root ramp over ~40 m gives shallow inland lakes/rivers a visible depth gradient
                    // (the old linear /7000 ramp mapped their 0–5 m to ~0, so every lake read the same pale blue),
                    // while deep ocean still saturates to the darkest tone.
                    var depth = Math.Clamp(Math.Sqrt(Math.Max(0, waterSurface - floorZ) / 4000.0), 0, 1);
                    // Inland water gets a darker deep end for more depth contrast; the ocean (and the blue-box
                    // deep-sea margin it must match) keeps its original ramp, whose deep tone ≈ the (22,55,110)
                    // volume-void override.
                    var oceanBand = waterSurface is >= -1850 and <= -1600;
                    if (oceanBand)
                    {
                        r = 22 + 40 * (1 - depth);
                        g = 52 + 70 * (1 - depth);
                        b = 104 + 74 * (1 - depth);
                    }
                    else
                    {
                        r = 15 + 49 * (1 - depth);
                        g = 40 + 84 * (1 - depth);
                        b = 88 + 92 * (1 - depth);
                    }
                }
                else
                {
                    var shade = Shade(baseHeight, x, y, idx);
                    double baseR, baseG, baseB;
                    if (terrain[cell] != 0 || terrain[cell + 1] != 0 || terrain[cell + 2] != 0)
                    {
                        baseR = terrain[cell];
                        baseG = terrain[cell + 1];
                        baseB = terrain[cell + 2];
                    }
                    else
                    {
                        var elevation = Math.Clamp((frame.HeightToZ(landHeight) - options.SeaLevelZ) / 40000.0, 0, 1);
                        baseR = 90 + 130 * elevation;
                        baseG = 120 + 100 * elevation;
                        baseB = 70 + 120 * elevation;
                    }

                    r = baseR * shade;
                    g = baseG * shade;
                    b = baseB * shade;
                }

                surface[cell] = (byte)Math.Clamp(r, 0, 255);
                surface[cell + 1] = (byte)Math.Clamp(g, 0, 255);
                surface[cell + 2] = (byte)Math.Clamp(b, 0, 255);
                composite[cell] = surface[cell];
                composite[cell + 1] = surface[cell + 1];
                composite[cell + 2] = surface[cell + 2];

                if (objectKind[idx] != 0)
                {
                    var shade = Shade(heightGrid, x, y, idx);
                    // The per-family base colour written by the rasteriser; fall back to the kind palette if unset.
                    (double baseR, double baseG, double baseB) =
                        objectColour[cell] != 0 || objectColour[cell + 1] != 0 || objectColour[cell + 2] != 0
                            ? (objectColour[cell], objectColour[cell + 1], objectColour[cell + 2])
                            : objectKind[idx] switch
                            {
                                2 => (205, 116, 104), // coral
                                3 => (70, 120, 74),   // tree foliage
                                _ => (143, 135, 122), // rock
                            };
                    objectRaster[cell] = (byte)Math.Clamp(baseR * shade, 0, 255);
                    objectRaster[cell + 1] = (byte)Math.Clamp(baseG * shade, 0, 255);
                    objectRaster[cell + 2] = (byte)Math.Clamp(baseB * shade, 0, 255);
                    composite[cell] = objectRaster[cell];
                    composite[cell + 1] = objectRaster[cell + 1];
                    composite[cell + 2] = objectRaster[cell + 2];
                }
            }
        }

        return new MapImages(surface, objectRaster, composite);
    }
}
