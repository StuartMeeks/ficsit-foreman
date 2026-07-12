using System.Globalization;
using System.Text;

using SfMapRenderer.Imaging;

using SixLabors.Fonts;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Drawing.Processing;
using SixLabors.ImageSharp.PixelFormats;
using SixLabors.ImageSharp.Processing;

namespace SfMapRenderer.Artifacts;

/// <summary>
/// Builds the interactive, toggleable-layer HTML artifact from a LAYERS render: one transparent PNG per
/// layer (ground/water/void from the surface raster; rocks/coral/foliage from the object raster; trunks as
/// flat discs) plus biome/name/grid overlays, stacked with a checkbox each and pan/zoom (the port of layers.py).
/// </summary>
public static class LayeredMapArtifactBuilder
{
    private const int Columns = 40;
    private const int Rows = 34;

    public static void Build(string surfacePath, string objectPath, string layersPath, string biomesPath, int targetWidth)
    {
        var (width, height, surface) = PpmReader.Read(surfacePath);
        var (_, _, objectRaster) = PpmReader.Read(objectPath);
        var classes = File.ReadAllBytes(layersPath);

        var tw = Math.Min(targetWidth, width);
        var th = (int)Math.Round((double)tw * height / width);
        var scale = (double)tw / width;

        var layers = new List<(string Id, string Label, string Base64)>
        {
            ("void", "Void", RasterLayer(width, height, tw, th, i => (classes[i] & 3) == 0, surface, null)),
            ("water", "Water", RasterLayer(width, height, tw, th, i => (classes[i] & 3) == 1, surface, null)),
            ("ground", "Ground", RasterLayer(width, height, tw, th, i => (classes[i] & 3) == 2, surface, null)),
            ("coral", "Coral", RasterLayer(width, height, tw, th, i => ((classes[i] >> 2) & 3) == 2, objectRaster, null)),
            ("rocks", "Rocks", RasterLayer(width, height, tw, th, i => ((classes[i] >> 2) & 3) == 1, objectRaster, null)),
            ("trunks", "Tree trunks", RasterLayer(width, height, tw, th, i => (classes[i] & 16) != 0, null, new Rgb24(120, 82, 52))),
            ("foliage", "Tree foliage", RasterLayer(width, height, tw, th, i => ((classes[i] >> 2) & 3) == 3, objectRaster, null)),
            ("biomes", "Biome edges", OverlayLayer(tw, th, ctx => DrawBiomeEdges(ctx, biomesPath, scale))),
            ("names", "Biome names", OverlayLayer(tw, th, ctx => DrawBiomeNames(ctx, biomesPath, scale))),
            ("grid", "Grid A1-AN34", OverlayLayer(tw, th, ctx => DrawGrid(ctx, tw, th, scale))),
        };

        var html = AssembleHtml(layers, tw, th);
        File.WriteAllText(Path.Combine(Directory.GetCurrentDirectory(), "map-layers.html"), html);
        Console.WriteLine($"wrote map-layers.html  ({tw}x{th}, {layers.Count} layers, {html.Length / 1024} KB)");
    }

    /// <summary>A full-extent layer: source colour where the predicate holds, transparent elsewhere, then downscaled.</summary>
    private static string RasterLayer(int width, int height, int tw, int th, Func<int, bool> included, byte[]? source, Rgb24? flat)
    {
        var pixels = new byte[width * height * 4];
        for (var i = 0; i < width * height; i++)
        {
            if (!included(i))
            {
                continue;
            }

            if (flat is { } colour)
            {
                pixels[i * 4] = colour.R;
                pixels[i * 4 + 1] = colour.G;
                pixels[i * 4 + 2] = colour.B;
            }
            else
            {
                pixels[i * 4] = source![i * 3];
                pixels[i * 4 + 1] = source[i * 3 + 1];
                pixels[i * 4 + 2] = source[i * 3 + 2];
            }

            pixels[i * 4 + 3] = 255;
        }

        using var image = Image.LoadPixelData<Rgba32>(pixels, width, height);
        image.Mutate(x => x.Resize(new ResizeOptions { Size = new Size(tw, th), Sampler = KnownResamplers.Lanczos3, Mode = ResizeMode.Stretch }));
        return ToPngBase64(image);
    }

    private static string OverlayLayer(int tw, int th, Action<IImageProcessingContext> draw)
    {
        using var image = new Image<Rgba32>(tw, th);
        image.Mutate(draw);
        return ToPngBase64(image);
    }

    private static void DrawBiomeEdges(IImageProcessingContext ctx, string biomesPath, double scale)
    {
        foreach (var biome in BiomeDataset.Load(biomesPath))
        {
            foreach (var polygon in biome.Polygons)
            {
                var points = polygon.Select(p => MapAnnotations.Pixel(p.X, p.Y, scale)).ToArray();
                MapAnnotations.DrawPolyline(ctx, Color.FromRgba(255, 240, 60, 210), 2f, [.. points, points[0]]);
            }
        }
    }

    private static void DrawBiomeNames(IImageProcessingContext ctx, string biomesPath, double scale)
    {
        var font = EmbeddedFont.At(Math.Max(11, (float)Math.Round(15 * scale / 0.4)));
        foreach (var biome in BiomeDataset.Load(biomesPath))
        {
            var all = biome.Polygons.SelectMany(poly => poly.Select(p => MapAnnotations.Pixel(p.X, p.Y, scale))).ToList();
            var centreX = all.Average(p => p.X);
            var centreY = all.Average(p => p.Y);
            var size = TextMeasurer.MeasureSize(biome.Name, new TextOptions(font));
            ctx.DrawText(biome.Name, font, Color.Black, new PointF(centreX - size.Width / 2, centreY - size.Height / 2));
        }
    }

    private static void DrawGrid(IImageProcessingContext ctx, int tw, int th, double scale)
    {
        double cellWidth = (double)tw / Columns, cellHeight = (double)th / Rows;
        var gridColor = Color.FromRgba(0, 255, 255, 150);
        for (var c = 0; c <= Columns; c++)
        {
            MapAnnotations.DrawPolyline(ctx, gridColor, 1f, [new PointF((float)(c * cellWidth), 0), new PointF((float)(c * cellWidth), th)]);
        }

        for (var r = 0; r <= Rows; r++)
        {
            MapAnnotations.DrawPolyline(ctx, gridColor, 1f, [new PointF(0, (float)(r * cellHeight)), new PointF(tw, (float)(r * cellHeight))]);
        }

        var font = EmbeddedFont.At(Math.Max(9, (float)Math.Round(13 * scale / 0.4)));
        for (var c = 0; c < Columns; c++)
        {
            for (var r = 0; r < Rows; r++)
            {
                ctx.DrawText($"{MapAnnotations.ColumnLabel(c)}{r + 1}", font, Color.Black, new PointF((float)(c * cellWidth + 2), (float)(r * cellHeight + 1)));
            }
        }
    }

    private static string ToPngBase64(Image image)
    {
        using var stream = new MemoryStream();
        image.SaveAsPng(stream);
        return Convert.ToBase64String(stream.ToArray());
    }

    private static string AssembleHtml(List<(string Id, string Label, string Base64)> layers, int tw, int th)
    {
        var images = new StringBuilder();
        var rows = new StringBuilder();
        for (var i = 0; i < layers.Count; i++)
        {
            var (id, label, base64) = layers[i];
            images.Append(CultureInfo.InvariantCulture, $"<img class=\"ly\" id=\"ly-{id}\" style=\"z-index:{(i + 1) * 10};\" src=\"data:image/png;base64,{base64}\" alt=\"{label}\">\n");
            rows.Append(CultureInfo.InvariantCulture, $"<label class=\"row\"><input type=\"checkbox\" data-ly=\"{id}\" checked> {label}</label>\n");
        }

        return HtmlTemplate
            .Replace("__TW__", tw.ToString(System.Globalization.CultureInfo.InvariantCulture))
            .Replace("__TH__", th.ToString(System.Globalization.CultureInfo.InvariantCulture))
            .Replace("__IMGS__", images.ToString())
            .Replace("__ROWS__", rows.ToString());
    }

    private const string HtmlTemplate = """
<title>Satisfactory base map — layers (#246)</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing:border-box; }
  body { margin:0; background:#14171c; color:#dfe3ea; font:14px/1.4 system-ui,sans-serif; }
  #wrap { display:flex; align-items:flex-start; gap:14px; padding:14px; height:100vh; }
  #map { position:relative; flex:1 1 auto; height:100%; overflow:hidden; background:#0d0f13; border-radius:8px;
          box-shadow:0 2px 16px #0008; cursor:grab; touch-action:none; }
  #map.drag { cursor:grabbing; }
  #view { position:absolute; top:0; left:0; width:__TW__px; aspect-ratio:__TW__/__TH__; transform-origin:0 0; }
  #view img.ly { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; }
  #panel { flex:0 0 190px; background:#1c2129; border:1px solid #2c333d; border-radius:10px; padding:12px 14px; align-self:flex-start; }
  #panel h1 { font-size:13px; letter-spacing:.06em; text-transform:uppercase; color:#8b97a8; margin:0 0 6px; }
  #panel .hint { color:#6b7686; font-size:11px; margin:0 0 10px; }
  .row { display:flex; align-items:center; gap:8px; padding:4px 0; cursor:pointer; user-select:none; }
  .row input { accent-color:#e6b800; width:15px; height:15px; }
  #reset { margin-top:10px; width:100%; background:#2c333d; color:#dfe3ea; border:0; border-radius:6px; padding:6px; cursor:pointer; }
</style>
<div id="wrap">
  <div id="map"><div id="view">
__IMGS__
  </div></div>
  <div id="panel">
    <h1>Layers</h1>
    <p class="hint">scroll to zoom · drag to pan</p>
__ROWS__
    <button id="reset">Reset view</button>
  </div>
</div>
<script>
  document.querySelectorAll('#panel input').forEach(cb => cb.addEventListener('change', () => {
    document.getElementById('ly-' + cb.dataset.ly).style.display = cb.checked ? '' : 'none';
  }));
  const map = document.getElementById('map'), view = document.getElementById('view');
  let sc = 1, tx = 0, ty = 0;
  const BASE = __TW__;
  function fit() { sc = map.clientWidth / BASE; tx = 0; ty = 0; apply(); }
  function apply() { view.style.transform = `translate(${tx}px,${ty}px) scale(${sc})`; }
  map.addEventListener('wheel', e => {
    e.preventDefault();
    const r = map.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    const f = Math.exp(-e.deltaY * 0.0015), ns = Math.min(40, Math.max(map.clientWidth / BASE * 0.9, sc * f));
    tx = mx - (mx - tx) * (ns / sc); ty = my - (my - ty) * (ns / sc); sc = ns; apply();
  }, { passive: false });
  let dragging = false, px2 = 0, py2 = 0;
  map.addEventListener('pointerdown', e => { dragging = true; px2 = e.clientX; py2 = e.clientY; map.classList.add('drag'); map.setPointerCapture(e.pointerId); });
  map.addEventListener('pointermove', e => { if (!dragging) return; tx += e.clientX - px2; ty += e.clientY - py2; px2 = e.clientX; py2 = e.clientY; apply(); });
  map.addEventListener('pointerup', e => { dragging = false; map.classList.remove('drag'); });
  document.getElementById('reset').addEventListener('click', fit);
  window.addEventListener('resize', fit); fit();
</script>
""";
}
