using CUE4Parse.Compression;
using CUE4Parse.Encryption.Aes;
using CUE4Parse.FileProvider;
using CUE4Parse.MappingsProvider.Usmap;
using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse.UE4.Assets.Objects;
using CUE4Parse.UE4.Versions;
using CUE4Parse.UE4.Objects.Core.Misc;
using CUE4Parse.UE4.Objects.Core.Math;

// hprobe render — #246 tier-1 proof: reassemble the landscape heightmap and write a
// shaded-relief + land/water PPM aligned to world-cm.
//   $env:DS = downsample factor (default 8);  output: map.ppm + map-bounds.txt

OodleHelper.DownloadOodleDll();
OodleHelper.Initialize();
var paks = Environment.GetEnvironmentVariable("SF_PAKS") ?? @"D:\Games\Steam\steamapps\common\Satisfactory\FactoryGame\Content\Paks";
var usmap = Environment.GetEnvironmentVariable("SF_USMAP") ?? @"D:\Games\Steam\steamapps\common\Satisfactory\CommunityResources\FactoryGame.usmap";
var provider = new DefaultFileProvider(paks, SearchOption.TopDirectoryOnly, new VersionContainer(EGame.GAME_UE5_6));
provider.MappingsContainer = new FileUsmapTypeMappingsProvider(usmap);
provider.Initialize();
provider.SubmitKey(new FGuid(), new FAesKey(new byte[32]));
Console.WriteLine($"mounted. files = {provider.Files.Count}");

var ds = int.TryParse(Environment.GetEnvironmentVariable("DS"), out var d) ? d : 8;
// Landscape-to-world (probed from proxy root ∘ section base): worldXY = ORIGIN + SB*100.
const double ACTOR_X = -50800, ACTOR_Y = -50800, SCALE = 100.0;
const double ZMID = 32768.0, ZSCALE = 1.0 / 128.0; // height(cm) = ACTOR_Z + (h16-ZMID)*ZSCALE*SCALE
// Landscape height decode base = the LandscapeStreamingProxy rootLoc.Z, CONFIRMED uniform = 100 across
// all 125 proxies (MODE=proxy). So the decode is correct as-is; ZADJ default 0. (An earlier +51 was a
// mis-diagnosis — the gap between the ocean VOLUME top −1730 and the visible waterline is a volume/surface
// offset, handled by OCEANZ, not a decode error.)
double ACTOR_Z = 100.0 + (double.TryParse(Environment.GetEnvironmentVariable("ZADJ"), out var _zadj) ? _zadj : 0.0);

var cells = provider.Files.Keys.Where(k => k.Contains("/_Generated_/") && k.EndsWith(".umap")).ToList();

if ((Environment.GetEnvironmentVariable("MODE") ?? "") == "layers")
{
    var counts = new Dictionary<string, int>();
    var nn = 0;
    foreach (var cell in cells)
    {
        if (++nn % 1000 == 0) Console.WriteLine($"  ...{nn}/{cells.Count}");
        try
        {
            foreach (var e in provider.LoadPackage(cell).GetExports())
            {
                if (e.ExportType != "LandscapeComponent") continue;
                var allocRaw = e.GetOrDefault<FStructFallback[]>("WeightmapLayerAllocations") ?? Array.Empty<FStructFallback>();
                foreach (var a in allocRaw)
                {
                    var nm = a.GetOrDefault<UObject?>("LayerInfo")?.Name?.Replace("_LayerInfo", "") ?? "?";
                    counts[nm] = counts.GetValueOrDefault(nm) + 1;
                }
            }
        }
        catch { }
    }
    Console.WriteLine("\n=== DISTINCT LANDSCAPE LAYERS ===");
    foreach (var (k, c) in counts.OrderByDescending(x => x.Value)) Console.WriteLine($"  {c,6}  {k}");
    Console.WriteLine("\nDONE");
    return;
}

if ((Environment.GetEnvironmentVariable("MODE") ?? "") == "rockprobe")
{
    // Understand how /Environment/Rock/ meshes are placed: component type, transform, instancing, bounds.
    var shown = 0;
    foreach (var cell in cells)
    {
        if (shown >= 12) break;
        try
        {
            foreach (var e in provider.LoadPackage(cell).GetExports())
            {
                if (shown >= 12 || !e.ExportType.Contains("StaticMeshComponent")) continue;
                var pi = e.Properties.FirstOrDefault(p => p.Name.Text == "StaticMesh")?.Tag?.GenericValue as CUE4Parse.UE4.Objects.UObject.FPackageIndex;
                var path = pi?.ResolvedObject?.GetPathName();
                if (path == null || !path.Contains("/Environment/Rock/")) continue;
                shown++;
                var rl = e.Properties.Any(p => p.Name.Text == "RelativeLocation") ? e.GetOrDefault<FVector>("RelativeLocation") : new FVector(0, 0, 0);
                var rs = e.Properties.Any(p => p.Name.Text == "RelativeScale3D") ? e.GetOrDefault<FVector>("RelativeScale3D") : new FVector(1, 1, 1);
                var perInst = e.Properties.FirstOrDefault(p => p.Name.Text == "PerInstanceSMData")?.Tag?.GenericValue as CUE4Parse.UE4.Assets.Objects.UScriptArray;
                var sm = (pi?.ResolvedObject?.Load()) as CUE4Parse.UE4.Assets.Exports.StaticMesh.UStaticMesh;
                var bb = sm?.RenderData?.Bounds;
                var asset = path[(path.LastIndexOf('/') + 1)..];
                Console.WriteLine($"[{e.ExportType}] mesh={asset}  instances={(perInst?.Properties.Count.ToString() ?? "single")}");
                Console.WriteLine($"    relLoc=({rl.X:F0},{rl.Y:F0},{rl.Z:F0}) relScale=({rs.X:F1},{rs.Y:F1},{rs.Z:F1})  bounds Origin=({bb?.Origin.X:F0},{bb?.Origin.Y:F0},{bb?.Origin.Z:F0}) Extent=({bb?.BoxExtent.X:F0},{bb?.BoxExtent.Y:F0},{bb?.BoxExtent.Z:F0})");
            }
        }
        catch (Exception ex) { Console.Error.WriteLine($"[cell] {ex.Message}"); }
    }
    Console.WriteLine("\nDONE");
    return;
}

if ((Environment.GetEnvironmentVariable("MODE") ?? "") == "meshes")
{
    // Histogram placed StaticMesh assets (by folder + by asset) to find rock/cliff/mesa
    // formations vs foliage/clutter, for the "higher ground" pass.
    var byFolder = new Dictionary<string, int>();
    var byAsset = new Dictionary<string, int>();
    var nn = 0;
    foreach (var cell in cells)
    {
        if (++nn % 1000 == 0) Console.WriteLine($"  ...{nn}/{cells.Count}");
        try
        {
            foreach (var e in provider.LoadPackage(cell).GetExports())
            {
                if (!e.ExportType.Contains("StaticMeshComponent")) continue;
                var pi = e.Properties.FirstOrDefault(p => p.Name.Text == "StaticMesh")?.Tag?.GenericValue as CUE4Parse.UE4.Objects.UObject.FPackageIndex;
                var path = pi?.ResolvedObject?.GetPathName();
                if (path == null) continue;
                var dot = path.LastIndexOf('.'); if (dot > 0) path = path[..dot];
                var slash = path.LastIndexOf('/');
                var folder = slash > 0 ? path[..slash] : path;
                var asset = slash > 0 ? path[(slash + 1)..] : path;
                byFolder[folder] = byFolder.GetValueOrDefault(folder) + 1;
                byAsset[asset] = byAsset.GetValueOrDefault(asset) + 1;
            }
        }
        catch { }
    }
    Console.WriteLine("\n=== TOP FOLDERS (by placed-component count) ===");
    foreach (var (k, c) in byFolder.OrderByDescending(x => x.Value).Take(35)) Console.WriteLine($"  {c,7}  {k}");
    Console.WriteLine("\n=== TOP ASSETS ===");
    foreach (var (k, c) in byAsset.OrderByDescending(x => x.Value).Take(40)) Console.WriteLine($"  {c,7}  {k}");
    Console.WriteLine("\nDONE");
    return;
}

if ((Environment.GetEnvironmentVariable("MODE") ?? "") == "pickupdump")
{
    var xy = (Environment.GetEnvironmentVariable("OA") ?? "0,0").Split(',');
    double tx = double.Parse(xy[0]), ty = double.Parse(xy[1]);
    double rad = double.TryParse(Environment.GetEnvironmentVariable("OAR"), out var rr) ? rr : 25000;
    var lvl = provider.Files.Keys.Where(k => k.Contains("/GameLevel01/") && k.EndsWith(".umap")).ToList();
    var shown = 0;
    foreach (var pkg in lvl)
    {
        try
        {
            foreach (var e in provider.LoadPackage(pkg).GetExports())
            {
                if (e.ExportType != "FGItemPickup_Spawnable" && !e.ExportType.Contains("Hatcher") && !e.ExportType.Contains("CreatureSpawner")) continue;
                FVector? loc = e.Properties.Any(p => p.Name.Text == "RelativeLocation") ? e.GetOrDefault<FVector>("RelativeLocation") : e.GetOrDefault<UObject?>("RootComponent")?.GetOrDefault<FVector>("RelativeLocation");
                if (loc == null) continue;
                var l = loc.Value;
                if (Math.Sqrt((l.X - tx) * (l.X - tx) + (l.Y - ty) * (l.Y - ty)) > rad) continue;
                if (shown++ > 14) { Console.WriteLine("DONE"); return; }
                Console.WriteLine($"[{e.ExportType}] {e.Name} @({l.X:F0},{l.Y:F0},{l.Z:F0})");
                foreach (var p in e.Properties)
                    Console.WriteLine($"    .{p.Name.Text} = {p.Tag?.GenericValue}");
            }
        }
        catch { }
    }
    Console.WriteLine("DONE");
    return;
}

if ((Environment.GetEnvironmentVariable("MODE") ?? "") == "objectsat")
{
    // What placed objects sit near a coord? env OA="x,y", OAR=radius cm. Report non-terrain/foliage.
    var pts = (Environment.GetEnvironmentVariable("OA") ?? "0,0").Split(';', StringSplitOptions.RemoveEmptyEntries)
        .Select(s => { var a = s.Split(','); return (x: double.Parse(a[0]), y: double.Parse(a[1]), label: a.Length > 2 ? a[2] : s); }).ToList();
    double rad = double.TryParse(Environment.GetEnvironmentVariable("OAR"), out var rr) ? rr : 30000;
    var lvl = provider.Files.Keys.Where(k => k.Contains("/GameLevel01/") && k.EndsWith(".umap")).ToList();
    var perPt = pts.Select(_ => new Dictionary<string, int>()).ToList();
    var nn = 0;
    foreach (var pkg in lvl)
    {
        if (++nn % 3000 == 0) Console.WriteLine($"  ...{nn}/{lvl.Count}");
        try
        {
            foreach (var e in provider.LoadPackage(pkg).GetExports())
            {
                FVector? loc = e.Properties.Any(p => p.Name.Text == "RelativeLocation") ? e.GetOrDefault<FVector>("RelativeLocation") : null;
                if (loc == null)
                {
                    var root = e.GetOrDefault<UObject?>("RootComponent");
                    if (root != null && root.Properties.Any(p => p.Name.Text == "RelativeLocation")) loc = root.GetOrDefault<FVector>("RelativeLocation");
                }
                if (loc == null) continue;
                var l = loc.Value;
                var t = e.ExportType;
                if (t.Contains("Landscape") || t.Contains("Foliage")) continue;
                var pi2 = e.Properties.FirstOrDefault(p => p.Name.Text is "StaticMesh" or "mStaticMesh")?.Tag?.GenericValue as CUE4Parse.UE4.Objects.UObject.FPackageIndex;
                var mp = pi2?.ResolvedObject?.GetPathName() ?? "";
                if (Environment.GetEnvironmentVariable("OAMESH") == "1" && mp.Length > 0) { var mm = mp[..mp.LastIndexOf('.')]; mm = mm[(mm.IndexOf("/Environment/") is var ii && ii >= 0 ? ii : mm.LastIndexOf('/'))..]; t = $"{t} [{mm}]"; }
                for (var k = 0; k < pts.Count; k++)
                    if (Math.Sqrt((l.X - pts[k].x) * (l.X - pts[k].x) + (l.Y - pts[k].y) * (l.Y - pts[k].y)) <= rad)
                    {
                        perPt[k][t] = perPt[k].GetValueOrDefault(t) + 1;
                        // OALIST=1: dump each Rock instance's exact origin + mesh (for building ROCKEXCLUDEAT).
                        if (Environment.GetEnvironmentVariable("OALIST") == "1" && mp.Contains("/Environment/Rock/"))
                        {
                            var scl = e.Properties.Any(p => p.Name.Text == "RelativeScale3D") ? e.GetOrDefault<FVector>("RelativeScale3D") : new FVector(1, 1, 1);
                            var mn = mp[(mp.LastIndexOf('/') + 1)..]; mn = mn[..mn.LastIndexOf('.')];
                            Console.WriteLine($"  [{pts[k].label}] {mn}@{l.X:F0},{l.Y:F0}  z={l.Z:F0} scale=({scl.X:F1},{scl.Y:F1},{scl.Z:F1})");
                        }
                    }
            }
        }
        catch { }
    }
    for (var k = 0; k < pts.Count; k++)
    {
        Console.WriteLine($"\n=== {pts[k].label} ({pts[k].x},{pts[k].y}) within {rad / 100:F0}m ===");
        foreach (var (t, c) in perPt[k].OrderByDescending(x => x.Value).Take(12)) Console.WriteLine($"  {c,3}x  {t}");
    }
    Console.WriteLine("\nDONE");
    return;
}

if ((Environment.GetEnvironmentVariable("MODE") ?? "") == "voldist")
{
    // Distribution of FGWaterVolume surface Z (maxZ) across the whole world.
    var lvl = provider.Files.Keys.Where(k => k.Contains("/GameLevel01/") && k.EndsWith(".umap")).ToList();
    var surf = new List<(double sz, double depth, string name)>();
    foreach (var pkg in lvl)
    {
        try
        {
            foreach (var e in provider.LoadPackage(pkg).GetExports())
            {
                if (e.ExportType != "FGWaterVolume") continue;
                var root = e.GetOrDefault<UObject?>("RootComponent");
                if (root?.GetOrDefault<UObject?>("Brush") is not CUE4Parse.UE4.Objects.Engine.UModel brush || brush.Points is not { Length: > 0 } pp) continue;
                var loc = root.Properties.Any(p => p.Name.Text == "RelativeLocation") ? root.GetOrDefault<FVector>("RelativeLocation") : new FVector(0, 0, 0);
                var scl = root.Properties.Any(p => p.Name.Text == "RelativeScale3D") ? root.GetOrDefault<FVector>("RelativeScale3D") : new FVector(1, 1, 1);
                double maxZ = -1e18, minZ = 1e18;
                foreach (var p in pp) { var z = loc.Z + p.Z * scl.Z; if (z > maxZ) maxZ = z; if (z < minZ) minZ = z; }
                surf.Add((maxZ, maxZ - minZ, e.Name));
            }
        }
        catch { }
    }
    Console.WriteLine($"\n=== {surf.Count} FGWaterVolumes — surfaceZ histogram (bucketed to 5cm) ===");
    foreach (var g in surf.GroupBy(s => Math.Round(s.sz / 5.0) * 5.0).OrderBy(g => g.Key))
        Console.WriteLine($"  surfZ≈{g.Key,7:F0}  x{g.Count(),-4}  depths[{g.Min(s => s.depth):F0}..{g.Max(s => s.depth):F0}]");
    Console.WriteLine($"\n=== deep ocean-scale volumes (depth > 3000cm) surfZ values ===");
    foreach (var s in surf.Where(s => s.depth > 3000).OrderBy(s => s.sz)) Console.WriteLine($"  {s.sz,7:F0}  depth={s.depth,7:F0}  {s.name}");
    Console.WriteLine("\nDONE");
    return;
}

if ((Environment.GetEnvironmentVariable("MODE") ?? "") == "volat")
{
    // Which FGWaterVolume actor covers each coord, and its AUTHORED surface Z (from the game files)?
    var vpts = (Environment.GetEnvironmentVariable("VA") ?? "0,0").Split(';', StringSplitOptions.RemoveEmptyEntries)
        .Select(s => { var a = s.Split(','); return (x: double.Parse(a[0]), y: double.Parse(a[1])); }).ToList();
    var lvl = provider.Files.Keys.Where(k => k.Contains("/GameLevel01/") && k.EndsWith(".umap")).ToList();
    var lines = new List<string>();
    foreach (var pkg in lvl)
    {
        try
        {
            foreach (var e in provider.LoadPackage(pkg).GetExports())
            {
                if (e.ExportType != "FGWaterVolume") continue;
                var root = e.GetOrDefault<UObject?>("RootComponent");
                if (root?.GetOrDefault<UObject?>("Brush") is not CUE4Parse.UE4.Objects.Engine.UModel brush
                    || brush.Points is not { Length: > 0 } pp || brush.Nodes is not { Length: > 0 } nds || brush.Verts is not { Length: > 0 } vv) continue;
                var loc = root.Properties.Any(p => p.Name.Text == "RelativeLocation") ? root.GetOrDefault<FVector>("RelativeLocation") : new FVector(0, 0, 0);
                var scl = root.Properties.Any(p => p.Name.Text == "RelativeScale3D") ? root.GetOrDefault<FVector>("RelativeScale3D") : new FVector(1, 1, 1);
                var yaw = (root.Properties.Any(p => p.Name.Text == "RelativeRotation") ? root.GetOrDefault<FRotator>("RelativeRotation").Yaw : 0.0) * Math.PI / 180.0;
                double cyw = Math.Cos(yaw), syw = Math.Sin(yaw);
                double maxZ = -1e18, minZ = 1e18;
                foreach (var p in pp) { var z = loc.Z + p.Z * scl.Z; if (z > maxZ) maxZ = z; if (z < minZ) minZ = z; }
                (double x, double y) W(FVector p) { double sx = p.X * scl.X, sy2 = p.Y * scl.Y; return (loc.X + sx * cyw - sy2 * syw, loc.Y + sx * syw + sy2 * cyw); }
                var faces = new List<(double x, double y)[]>();
                foreach (var node in nds)
                {
                    int nv = node.NumVertices; if (nv < 3) continue;
                    var poly = new (double x, double y)[nv]; var ok = true;
                    for (var k = 0; k < nv; k++) { var vi = node.iVertPool + k; if (vi < 0 || vi >= vv.Length) { ok = false; break; } var pidx = vv[vi].pVertex; if (pidx < 0 || pidx >= pp.Length) { ok = false; break; } poly[k] = W(pp[pidx]); }
                    if (ok) faces.Add(poly);
                }
                for (var q = 0; q < vpts.Count; q++)
                    if (faces.Any(poly => PointInPoly(poly, vpts[q].x, vpts[q].y)))
                        lines.Add($"pt{q} ({vpts[q].x:F0},{vpts[q].y:F0}) IN {e.Name}  surfZ(max)={maxZ:F0}  minZ={minZ:F0}  loc.Z={loc.Z:F0}  scl.Z={scl.Z:F2}");
            }
        }
        catch { }
    }
    foreach (var s in lines.OrderBy(x => x)) Console.WriteLine("  " + s);
    Console.WriteLine("DONE");
    return;
}

if ((Environment.GetEnvironmentVariable("MODE") ?? "") == "oceanmesh")
{
    // Inspect the open-ocean water plane: is SM_GEN_WaterPlane a coastline-following mesh or one big quad?
    var lvl = provider.Files.Keys.Where(k => k.Contains("/GameLevel01/") && k.EndsWith(".umap")).ToList();
    // test points: J4 c3 shallow (should be ocean) + a southern dry basin (should NOT be)
    var tests = new (double x, double y, string tag)[] { (36210, -195420, "J4c3"), (-40000, 180000, "southbasin"), (200000, 120000, "swampE") };
    int nn = 0;
    foreach (var pkg in lvl)
    {
        if (++nn % 3000 == 0) Console.WriteLine($"  ...{nn}/{lvl.Count}");
        try
        {
            foreach (var e in provider.LoadPackage(pkg).GetExports())
            {
                var pi = e.Properties.FirstOrDefault(p => p.Name.Text == "StaticMesh")?.Tag?.GenericValue as CUE4Parse.UE4.Objects.UObject.FPackageIndex;
                var path = pi?.ResolvedObject?.GetPathName() ?? "";
                if (!path.Contains("WaterPlane") && !e.ExportType.Contains("WaterPlane")) continue;
                if (pi?.ResolvedObject?.Load() is not CUE4Parse.UE4.Assets.Exports.StaticMesh.UStaticMesh sm || sm.RenderData?.LODs is not { Length: > 0 } lods) continue;
                var loc = e.Properties.Any(p => p.Name.Text == "RelativeLocation") ? e.GetOrDefault<FVector>("RelativeLocation") : new FVector(0, 0, 0);
                var scl = e.Properties.Any(p => p.Name.Text == "RelativeScale3D") ? e.GetOrDefault<FVector>("RelativeScale3D") : new FVector(1, 1, 1);
                var yaw = (e.Properties.Any(p => p.Name.Text == "RelativeRotation") ? e.GetOrDefault<FRotator>("RelativeRotation").Yaw : 0.0) * Math.PI / 180.0;
                double cyw = Math.Cos(yaw), syw = Math.Sin(yaw);
                var lod = lods.OrderBy(l => l.PositionVertexBuffer?.Verts?.Length ?? int.MaxValue).First();
                var vb = lod.PositionVertexBuffer?.Verts;
                if (vb == null) continue;
                double mnx = 1e18, mxx = -1e18, mny = 1e18, mxy = -1e18;
                foreach (var v in vb) { double wx = loc.X + (v.X * scl.X) * cyw - (v.Y * scl.Y) * syw, wy = loc.Y + (v.X * scl.X) * syw + (v.Y * scl.Y) * cyw; mnx = Math.Min(mnx, wx); mxx = Math.Max(mxx, wx); mny = Math.Min(mny, wy); mxy = Math.Max(mxy, wy); }
                Console.WriteLine($"[{e.ExportType}] {e.Name} mesh={path[(path.LastIndexOf('.') + 1)..]} loc=({loc.X:F0},{loc.Y:F0},{loc.Z:F0}) scl=({scl.X:F2},{scl.Y:F2}) verts={vb.Length} tris={(lod.IndexBuffer?.Length ?? 0) / 3}");
                Console.WriteLine($"     worldXY bounds X[{mnx:F0},{mxx:F0}] Y[{mny:F0},{mxy:F0}]  span {(mxx - mnx) / 100:F0}m x {(mxy - mny) / 100:F0}m");
            }
        }
        catch { }
    }
    Console.WriteLine("\nDONE");
    return;
}

if ((Environment.GetEnvironmentVariable("MODE") ?? "") == "riverdump")
{
    // Structure of a BP_River_PROT_C actor: dump every export in its package.
    var lvl = provider.Files.Keys.Where(k => k.Contains("/GameLevel01/") && k.EndsWith(".umap")).ToList();
    foreach (var pkg in lvl)
    {
        try
        {
            var pk = provider.LoadPackage(pkg);
            if (!pk.GetExports().Any(e => e.Name.StartsWith("BP_River_PROT"))) continue;
            Console.WriteLine($"PKG {pkg}");
            var actor = pk.GetExports().First(e => e.Name.StartsWith("BP_River_PROT"));
            // root transform
            var rc = actor.GetOrDefault<UObject?>("RootComponent");
            if (rc != null)
            {
                var rloc = rc.GetOrDefault<FVector>("RelativeLocation", new FVector(0, 0, 0));
                var rrot = rc.GetOrDefault<CUE4Parse.UE4.Objects.Core.Math.FRotator>("RelativeRotation", new CUE4Parse.UE4.Objects.Core.Math.FRotator(0, 0, 0));
                var rscl = rc.GetOrDefault<FVector>("RelativeScale3D", new FVector(1, 1, 1));
                Console.WriteLine($"  ROOT [{rc.ExportType}] {rc.Name} loc=({rloc.X:F0},{rloc.Y:F0},{rloc.Z:F0}) rot=(p{rrot.Pitch:F0},y{rrot.Yaw:F0},r{rrot.Roll:F0}) scl=({rscl.X:F2},{rscl.Y:F2},{rscl.Z:F2})");
                Console.WriteLine($"       rootprops: {string.Join(",", rc.Properties.Select(p => p.Name.Text))}");
            }
            // spline curve
            var sc = actor.GetOrDefault<UObject?>("mSplineComponent");
            if (sc != null)
            {
                Console.WriteLine($"  SPLINE [{sc.ExportType}] {sc.Name} props: {string.Join(",", sc.Properties.Select(p => p.Name.Text))}");
                var sloc = sc.GetOrDefault<FVector>("RelativeLocation", new FVector(0, 0, 0));
                Console.WriteLine($"       splineloc=({sloc.X:F0},{sloc.Y:F0},{sloc.Z:F0})");
                var curves = sc.Properties.FirstOrDefault(p => p.Name.Text == "SplineCurves");
                if (curves != null)
                {
                    var sca = curves.Tag?.GenericValue as CUE4Parse.UE4.Assets.Objects.FStructFallback;
                    var pos = sca?.Properties.FirstOrDefault(p => p.Name.Text == "Position")?.Tag?.GenericValue as CUE4Parse.UE4.Assets.Objects.FStructFallback;
                    var pts = pos?.Properties.FirstOrDefault(p => p.Name.Text == "Points")?.Tag?.GenericValue as CUE4Parse.UE4.Assets.Objects.UScriptArray;
                    Console.WriteLine($"       spline point count = {pts?.Properties.Count ?? -1}");
                    if (pts != null)
                        foreach (var sp in pts.Properties.Take(8))
                        {
                            var pf = sp.GenericValue as CUE4Parse.UE4.Assets.Objects.FStructFallback;
                            var ov = pf?.Properties.FirstOrDefault(p => p.Name.Text == "OutVal")?.Tag?.GenericValue;
                            Console.WriteLine($"         pt OutVal = {ov}");
                        }
                }
            }
            // first spline mesh comp
            var smcs = actor.GetOrDefault<UScriptArray?>("mSplineMeshComponents");
            Console.WriteLine($"  splineMeshComponents count = {smcs?.Properties.Count ?? -1}");
            if (smcs != null && smcs.Properties.Count > 0)
            {
                var smc = (smcs.Properties[0].GenericValue as CUE4Parse.UE4.Objects.UObject.FPackageIndex)?.ResolvedObject?.Load();
                for (int si = 0; si < Math.Min(4, smcs.Properties.Count); si++)
                {
                    var smcN = (smcs.Properties[si].GenericValue as CUE4Parse.UE4.Objects.UObject.FPackageIndex)?.ResolvedObject?.Load();
                    if (smcN == null) continue;
                    var spRaw = smcN.Properties.FirstOrDefault(p => p.Name.Text == "SplineParams")?.Tag?.GenericValue;
                    var sp = spRaw as CUE4Parse.UE4.Assets.Objects.FStructFallback
                             ?? (spRaw as CUE4Parse.UE4.Assets.Objects.FScriptStruct)?.StructType as CUE4Parse.UE4.Assets.Objects.FStructFallback;
                    if (si == 0) Console.WriteLine($"       SplineParams runtime = {spRaw?.GetType().Name}; inner = {(spRaw as CUE4Parse.UE4.Assets.Objects.FScriptStruct)?.StructType?.GetType().Name}");
                    if (sp == null) { Console.WriteLine($"       smc{si} SP unwrap failed"); continue; }
                    Console.WriteLine($"       smc{si} SP fields:");
                    foreach (var p in sp.Properties)
                        Console.WriteLine($"            .{p.Name.Text} = {p.Tag?.GenericValue}  [{p.Tag?.GenericValue?.GetType().Name}]");
                    if (si == 0)
                    {
                        var m = (smcN.Properties.FirstOrDefault(p => p.Name.Text == "StaticMesh")?.Tag?.GenericValue as CUE4Parse.UE4.Objects.UObject.FPackageIndex)?.ResolvedObject?.Load() as CUE4Parse.UE4.Assets.Exports.StaticMesh.UStaticMesh;
                        if (m?.RenderData?.Bounds != null)
                            Console.WriteLine($"       SM_RiverPlane bounds: origin={m.RenderData.Bounds.Origin} extent={m.RenderData.Bounds.BoxExtent}");
                    }
                }
            }
            Console.WriteLine("\nDONE");
            return;
        }
        catch { }
    }
    Console.WriteLine("no river package found\nDONE");
    return;
}

if ((Environment.GetEnvironmentVariable("MODE") ?? "") == "nearwater")
{
    // What water-ish actors sit near a coord? env NW="x,y". Sweep level + cells.
    var xy = (Environment.GetEnvironmentVariable("NW") ?? "0,0").Split(',');
    double tx = double.Parse(xy[0]), ty = double.Parse(xy[1]);
    var lvl = provider.Files.Keys.Where(k => k.Contains("/GameLevel01/") && k.EndsWith(".umap")).ToList();
    var hits = new List<(double d, string s)>();
    var nn = 0;
    foreach (var pkg in lvl)
    {
        if (++nn % 2000 == 0) Console.WriteLine($"  ...{nn}/{lvl.Count}");
        try
        {
            foreach (var e in provider.LoadPackage(pkg).GetExports())
            {
                var t = e.ExportType;
                var pi = e.Properties.FirstOrDefault(p => p.Name.Text == "StaticMesh")?.Tag?.GenericValue as CUE4Parse.UE4.Objects.UObject.FPackageIndex;
                var mesh = pi?.ResolvedObject?.GetPathName() ?? "";
                var isW = t.Contains("Water") || t.Contains("River") || t.Contains("Ocean") || mesh.Contains("Water") || mesh.Contains("River");
                if (!isW) continue;
                var root = e.GetOrDefault<UObject?>("RootComponent") ?? e.GetOrDefault<UObject?>("WaterSurface") ?? e.GetOrDefault<UObject?>("DefaultSceneRoot");
                var loc = root != null && root.Properties.Any(p => p.Name.Text == "RelativeLocation") ? root.GetOrDefault<FVector>("RelativeLocation") : (e.Properties.Any(p => p.Name.Text == "RelativeLocation") ? e.GetOrDefault<FVector>("RelativeLocation") : new FVector(0, 0, 0));
                var dst = Math.Sqrt((loc.X - tx) * (loc.X - tx) + (loc.Y - ty) * (loc.Y - ty));
                if (dst < 60000) hits.Add((dst, $"{t}  {e.Name}  loc=({loc.X:F0},{loc.Y:F0},{loc.Z:F0})  mesh={mesh[(mesh.LastIndexOf('/') + 1)..]}"));
            }
        }
        catch { }
    }
    foreach (var (dst, s) in hits.OrderBy(h => h.d).Take(20)) Console.WriteLine($"  {dst / 100,5:F0}m  {s}");
    Console.WriteLine("\nDONE");
    return;
}

if ((Environment.GetEnvironmentVariable("MODE") ?? "") == "voldump")
{
    // Transform every FGWaterVolume brush to world; dump AABB + surface-Z + point count.
    var lvl = provider.Files.Keys.Where(k => k.Contains("/GameLevel01/") && k.EndsWith(".umap") && !k.Contains("/_Generated_/")).ToList();
    var lines = new List<string>();
    foreach (var pkg in lvl)
    {
        foreach (var e in provider.LoadPackage(pkg).GetExports())
        {
            if (e.ExportType != "FGWaterVolume") continue;
            var root = e.GetOrDefault<UObject?>("RootComponent");
            var brush = root?.GetOrDefault<UObject?>("Brush") as CUE4Parse.UE4.Objects.Engine.UModel;
            if (root == null || brush?.Points is not { Length: > 0 } pts) continue;
            var loc = root.Properties.Any(p => p.Name.Text == "RelativeLocation") ? root.GetOrDefault<FVector>("RelativeLocation") : new FVector(0, 0, 0);
            var scl = root.Properties.Any(p => p.Name.Text == "RelativeScale3D") ? root.GetOrDefault<FVector>("RelativeScale3D") : new FVector(1, 1, 1);
            var yaw = (root.Properties.Any(p => p.Name.Text == "RelativeRotation") ? root.GetOrDefault<FRotator>("RelativeRotation").Yaw : 0.0) * Math.PI / 180.0;
            double cy = Math.Cos(yaw), sy = Math.Sin(yaw);
            double minx = 1e18, maxx = -1e18, miny = 1e18, maxy = -1e18, minz = 1e18, maxz = -1e18;
            foreach (var p in pts)
            {
                double sx = p.X * scl.X, syy = p.Y * scl.Y, sz = p.Z * scl.Z;
                double wx = loc.X + sx * cy - syy * sy, wy = loc.Y + sx * sy + syy * cy, wz = loc.Z + sz;
                minx = Math.Min(minx, wx); maxx = Math.Max(maxx, wx); miny = Math.Min(miny, wy); maxy = Math.Max(maxy, wy); minz = Math.Min(minz, wz); maxz = Math.Max(maxz, wz);
            }
            lines.Add($"{e.Name}\t{pts.Length}\t{minx:F0}\t{maxx:F0}\t{miny:F0}\t{maxy:F0}\t{minz:F0}\t{maxz:F0}");
        }
    }
    File.WriteAllLines(Path.Combine(Directory.GetCurrentDirectory(), "voldump.tsv"), lines);
    Console.WriteLine($"wrote voldump.tsv ({lines.Count} volumes)\nDONE");
    return;
}

if ((Environment.GetEnvironmentVariable("MODE") ?? "") == "watervol")
{
    // Spike: what geometry can we get from an FGWaterVolume? (brush / body-setup / box / convex)
    var lvl = provider.Files.Keys.Where(k => k.Contains("/GameLevel01/") && k.EndsWith(".umap") && !k.Contains("/_Generated_/")).ToList();
    var shown = 0;
    void DumpProps(UObject o, string tag, int depth)
    {
        var pad = new string(' ', depth * 3);
        Console.WriteLine($"{pad}[{tag}] {o.ExportType} {o.Name}");
        foreach (var p in o.Properties)
        {
            var v = p.Tag?.GenericValue;
            var s = v?.ToString() ?? "null";
            if (s.Length > 80) s = s[..80];
            Console.WriteLine($"{pad}   {p.Name.Text} <{p.PropertyType.Text}> = {s}");
        }
    }
    foreach (var pkg in lvl)
    {
        if (shown >= 2) break;
        foreach (var e in provider.LoadPackage(pkg).GetExports())
        {
            if (shown >= 2 || e.ExportType != "FGWaterVolume") continue;
            shown++;
            Console.WriteLine($"\n===== FGWaterVolume {e.Name} =====");
            var root = e.GetOrDefault<UObject?>("RootComponent");
            if (root != null) DumpProps(root, "RootComponent", 1);
            // Dig into the body-setup AggGeom (convex/box collision elements)
            var bs = root?.GetOrDefault<UObject?>("BrushBodySetup");
            var agg = bs?.Properties.FirstOrDefault(p => p.Name.Text == "AggGeom")?.Tag?.GenericValue as CUE4Parse.UE4.Assets.Objects.FStructFallback;
            if (agg != null)
            {
                foreach (var p in agg.Properties)
                {
                    var arr = p.Tag?.GenericValue as CUE4Parse.UE4.Assets.Objects.UScriptArray;
                    Console.WriteLine($"   AggGeom.{p.Name.Text} = {(arr != null ? $"array[{arr.Properties.Count}]" : p.Tag?.GenericValue?.ToString())}");
                    if (arr is { Properties.Count: > 0 })
                    {
                        var el = (arr.Properties[0].GenericValue as CUE4Parse.UE4.Assets.Objects.FScriptStruct)?.StructType as CUE4Parse.UE4.Assets.Objects.FStructFallback ?? arr.Properties[0].GenericValue as CUE4Parse.UE4.Assets.Objects.FStructFallback;
                        if (el != null)
                            foreach (var cp in el.Properties)
                            {
                                var cv = cp.Tag?.GenericValue as CUE4Parse.UE4.Assets.Objects.UScriptArray;
                                Console.WriteLine($"      [0].{cp.Name.Text} <{cp.PropertyType.Text}> = {(cv != null ? $"array[{cv.Properties.Count}]" : cp.Tag?.GenericValue?.ToString()?[..Math.Min(50, cp.Tag?.GenericValue?.ToString()?.Length ?? 0)])}");
                            }
                    }
                }
            }
            // Model (brush) — Points is the vertex list; transform by the component gives the water footprint.
            var brush = root?.GetOrDefault<UObject?>("Brush") as CUE4Parse.UE4.Objects.Engine.UModel;
            if (brush != null)
            {
                var b = brush.Bounds;
                Console.WriteLine($"   UModel {brush.Name}: Points={brush.Points?.Length ?? -1}  Bounds Origin=({b.Origin.X:F0},{b.Origin.Y:F0},{b.Origin.Z:F0}) Extent=({b.BoxExtent.X:F0},{b.BoxExtent.Y:F0},{b.BoxExtent.Z:F0})");
                if (brush.Points is { Length: > 0 } pts)
                {
                    double zx = pts.Min(p => p.X), zX = pts.Max(p => p.X), zy = pts.Min(p => p.Y), zY = pts.Max(p => p.Y), zz = pts.Min(p => p.Z), zZ = pts.Max(p => p.Z);
                    Console.WriteLine($"     local Points AABB X[{zx:F0},{zX:F0}] Y[{zy:F0},{zY:F0}] Z[{zz:F0},{zZ:F0}]");
                }
            }
        }
    }
    Console.WriteLine("\nDONE");
    return;
}

if ((Environment.GetEnvironmentVariable("MODE") ?? "") == "oceandump")
{
    // Dump every ocean/water surface feature (X,Y,Z + type) so per-cell water-level queries can be
    // answered locally against this list.
    var lvl = provider.Files.Keys.Where(k => k.Contains("/GameLevel01/") && k.EndsWith(".umap") && !k.Contains("/_Generated_/")).ToList();
    FVector RL(UObject? c) => c != null && c.Properties.Any(p => p.Name.Text == "RelativeLocation") ? c.GetOrDefault<FVector>("RelativeLocation") : new FVector(0, 0, 0);
    var lines = new List<string>();
    foreach (var pkg in lvl)
    {
        foreach (var e in provider.LoadPackage(pkg).GetExports())
        {
            if (e.ExportType.Contains("OceanSpline"))
            {
                var rl = RL(e.GetOrDefault<UObject?>("RootComponent") ?? e.GetOrDefault<UObject?>("DefaultSceneRoot"));
                lines.Add($"OceanSpline\t{rl.X:F0}\t{rl.Y:F0}\t{rl.Z:F0}");
            }
            else if (e.ExportType == "BP_WaterPlane_C")
            {
                var sm = e.GetOrDefault<UObject?>("SourceMesh") as CUE4Parse.UE4.Assets.Exports.StaticMesh.UStaticMesh;
                var b = sm?.RenderData?.Bounds;
                if (b != null) lines.Add($"WaterPlane\t{b.Origin.X:F0}\t{b.Origin.Y:F0}\t{b.Origin.Z:F0}");
            }
            else if (e.ExportType.Contains("Water"))
            {
                var ws = e.GetOrDefault<UObject?>("WaterSurface");
                if (ws != null && ws.Properties.Any(p => p.Name.Text == "RelativeLocation"))
                {
                    var loc = ws.GetOrDefault<FVector>("RelativeLocation");
                    lines.Add($"{e.ExportType}\t{loc.X:F0}\t{loc.Y:F0}\t{loc.Z:F0}");
                }
            }
        }
    }
    File.WriteAllLines(Path.Combine(Directory.GetCurrentDirectory(), "oceandump.tsv"), lines);
    Console.WriteLine($"wrote oceandump.tsv ({lines.Count} features)");
    Console.WriteLine("DONE");
    return;
}

if ((Environment.GetEnvironmentVariable("MODE") ?? "") == "oceans")
{
    // Probe per-side ocean surface Z. Ocean is traced by BPW_OceanSplineTool points, surfaced by
    // BP_WaterPlane meshes, and volumed by FGWaterVolume. Tag each by X (west < 50800 < east).
    var lvl = provider.Files.Keys.Where(k => k.Contains("/GameLevel01/") && k.EndsWith(".umap") && !k.Contains("/_Generated_/")).ToList();
    FVector RL(UObject? c) => c != null && c.Properties.Any(p => p.Name.Text == "RelativeLocation") ? c.GetOrDefault<FVector>("RelativeLocation") : new FVector(0, 0, 0);
    var west = new List<double>(); var east = new List<double>();
    var planes = new List<(double x, double y, double z)>();
    foreach (var pkg in lvl)
    {
        foreach (var e in provider.LoadPackage(pkg).GetExports())
        {
            if (e.ExportType.Contains("OceanSpline"))
            {
                var rl = RL(e.GetOrDefault<UObject?>("RootComponent") ?? e.GetOrDefault<UObject?>("DefaultSceneRoot"));
                (rl.X < 50800 ? west : east).Add(rl.Z);
            }
            else if (e.ExportType == "BP_WaterPlane_C")
            {
                var sm = e.GetOrDefault<UObject?>("SourceMesh") as CUE4Parse.UE4.Assets.Exports.StaticMesh.UStaticMesh;
                var b = sm?.RenderData?.Bounds;
                if (b != null) planes.Add((b.Origin.X, b.Origin.Y, b.Origin.Z));
            }
        }
    }
    west.Sort(); east.Sort();
    double Med(List<double> l) => l.Count == 0 ? double.NaN : l[l.Count / 2];
    Console.WriteLine($"OceanSpline points: WEST n={west.Count} Zmin={(west.Count > 0 ? west[0] : 0):F0} median={Med(west):F0} Zmax={(west.Count > 0 ? west[^1] : 0):F0}");
    Console.WriteLine($"OceanSpline points: EAST n={east.Count} Zmin={(east.Count > 0 ? east[0] : 0):F0} median={Med(east):F0} Zmax={(east.Count > 0 ? east[^1] : 0):F0}");
    Console.WriteLine("BP_WaterPlane surfaces (world XYZ of mesh bounds origin):");
    foreach (var (x, y, z) in planes.OrderBy(p => p.x)) Console.WriteLine($"   ({x,9:F0},{y,9:F0})  Z={z:F0}  [{(x < 50800 ? "WEST" : "EAST")}]");
    Console.WriteLine("\nDONE");
    return;
}

if ((Environment.GetEnvironmentVariable("MODE") ?? "") == "wbase")
{
    var lvl = provider.Files.Keys.Where(k => k.Contains("/GameLevel01/") && k.EndsWith(".umap") && !k.Contains("/_Generated_/")).ToList();
    var shown = 0;
    foreach (var pkg in lvl)
    {
        if (shown >= 4) break;
        foreach (var e in provider.LoadPackage(pkg).GetExports())
        {
            if (shown >= 4 || !e.ExportType.Contains("Water")) continue;
            var ws = e.GetOrDefault<UObject?>("WaterSurface");
            if (ws == null) continue;
            // The mesh is on the component archetype (Template), not the instance.
            var tmpl = ws.Template?.Load();
            var smObj = ws.GetOrDefault<UObject?>("StaticMesh") ?? tmpl?.GetOrDefault<UObject?>("StaticMesh");
            var sm = smObj as CUE4Parse.UE4.Assets.Exports.StaticMesh.UStaticMesh;
            var bb = sm?.RenderData?.Bounds;
            var scl = ws.GetOrDefault<FVector>("RelativeScale3D");
            shown++;
            Console.WriteLine($"{e.ExportType} ws={ws.ExportType} tmpl={(tmpl?.Name ?? "null")} mesh={(sm?.Name ?? smObj?.GetType().Name ?? "null")}");
            if (bb != null) Console.WriteLine($"   baseMeshBounds Extent=({bb.BoxExtent.X:F0},{bb.BoxExtent.Y:F0},{bb.BoxExtent.Z:F0})  scale=({scl.X:F0},{scl.Y:F0})  => footprint ~({bb.BoxExtent.X * scl.X:F0} x {bb.BoxExtent.Y * scl.Y:F0}) cm");
        }
    }
    Console.WriteLine("\nDONE");
    return;
}

if ((Environment.GetEnvironmentVariable("MODE") ?? "") == "wsdump")
{
    var lvl = provider.Files.Keys.Where(k => k.Contains("/GameLevel01/") && k.EndsWith(".umap") && !k.Contains("/_Generated_/")).ToList();
    var shown = 0;
    foreach (var pkg in lvl)
    {
        if (shown >= 2) break;
        foreach (var e in provider.LoadPackage(pkg).GetExports())
        {
            if (shown >= 2 || !e.ExportType.Contains("Water")) continue;
            var ws = e.GetOrDefault<UObject?>("WaterSurface");
            if (ws == null) continue;
            shown++;
            Console.WriteLine($"\n=== {e.ExportType} {e.Name} -> WaterSurface [{ws.ExportType} {ws.Name}] ===");
            foreach (var p in ws.Properties)
            {
                var v = p.Tag?.GenericValue?.ToString() ?? "";
                if (v.Length > 90) v = v[..90];
                Console.WriteLine($"   {p.Name.Text} <{p.PropertyType.Text}> = {v}");
            }
        }
    }
    Console.WriteLine("\nDONE");
    return;
}

if ((Environment.GetEnvironmentVariable("MODE") ?? "") == "lakeinfo")
{
    var lvl = provider.Files.Keys.Where(k => k.Contains("/GameLevel01/") && k.EndsWith(".umap") && !k.Contains("/_Generated_/")).ToList();
    FVector RL(UObject? c) => c != null && c.Properties.Any(p => p.Name.Text == "RelativeLocation") ? c.GetOrDefault<FVector>("RelativeLocation") : new FVector(0, 0, 0);
    var shown = 0;
    foreach (var pkg in lvl)
    {
        if (shown >= 8) break;
        foreach (var e in provider.LoadPackage(pkg).GetExports())
        {
            if (shown >= 8) break;
            if (!e.ExportType.Contains("Water")) continue;
            var ws = e.GetOrDefault<UObject?>("WaterSurface");
            if (ws == null) continue;
            var rl = RL(e.GetOrDefault<UObject?>("RootComponent"));
            var wl = RL(ws);
            var sm = ws.GetOrDefault<UObject?>("StaticMesh") as CUE4Parse.UE4.Assets.Exports.StaticMesh.UStaticMesh;
            var b = sm?.RenderData?.Bounds;
            shown++;
            Console.WriteLine($"{e.ExportType} {e.Name}");
            Console.WriteLine($"   rootLoc=({rl.X:F0},{rl.Y:F0},{rl.Z:F0}) wsRelLoc=({wl.X:F0},{wl.Y:F0},{wl.Z:F0})");
            Console.WriteLine($"   meshBounds Origin=({b?.Origin.X:F0},{b?.Origin.Y:F0},{b?.Origin.Z:F0}) Extent=({b?.BoxExtent.X:F0},{b?.BoxExtent.Y:F0},{b?.BoxExtent.Z:F0})");
        }
    }
    Console.WriteLine("\nDONE");
    return;
}

if ((Environment.GetEnvironmentVariable("MODE") ?? "") == "watermesh")
{
    // Generated ocean planes bake the surface height into the mesh; read bounds Origin.Z.
    var planes = provider.Files.Keys.Where(k => k.Contains("/GeneratedWaterPlanes/") && k.Contains("SM_GEN_WaterPlane") && k.EndsWith(".uasset")).OrderBy(k => k).ToList();
    Console.WriteLine($"found {planes.Count} generated water-plane meshes");
    foreach (var p in planes.Take(20))
    {
        try
        {
            var mesh = provider.LoadPackage(p).GetExports().OfType<CUE4Parse.UE4.Assets.Exports.StaticMesh.UStaticMesh>().FirstOrDefault();
            var b = mesh?.RenderData?.Bounds;
            var nm = p[(p.LastIndexOf('/') + 1)..];
            if (b == null) { Console.WriteLine($"  {nm}: no bounds"); continue; }
            Console.WriteLine($"  {nm,-28} Origin.Z={b.Origin.Z:F0}  ExtentZ={b.BoxExtent.Z:F0}  (surface top≈{b.Origin.Z + b.BoxExtent.Z:F0})  XY≈({b.Origin.X:F0},{b.Origin.Y:F0})");
        }
        catch (Exception ex) { Console.WriteLine($"  {p}: {ex.Message}"); }
    }
    Console.WriteLine("\nDONE");
    return;
}

if ((Environment.GetEnvironmentVariable("MODE") ?? "") == "sealevel")
{
    var levelPkgs2 = provider.Files.Keys.Where(k => k.Contains("/GameLevel01/") && k.EndsWith(".umap") && !k.Contains("/_Generated_/")).ToList();
    Console.WriteLine("water-plane + ocean-volume Z (persistent level)...");
    foreach (var pkg in levelPkgs2)
    {
        foreach (var e in provider.LoadPackage(pkg).GetExports())
        {
            if (e.ExportType != "BP_WaterPlane_C" && e.ExportType != "FGWaterVolume" && e.ExportType != "BP_Water_C") continue;
            var root = e.GetOrDefault<UObject?>("RootComponent") ?? e.GetOrDefault<UObject?>("DefaultSceneRoot");
            var loc = root != null && root.Properties.Any(p => p.Name.Text == "RelativeLocation") ? (FVector?) root.GetOrDefault<FVector>("RelativeLocation") : null;
            var sc = root != null && root.Properties.Any(p => p.Name.Text == "RelativeScale3D") ? (FVector?) root.GetOrDefault<FVector>("RelativeScale3D") : null;
            Console.WriteLine($"  {e.ExportType,-18} {e.Name,-28} rootLoc={(loc == null ? "(default 0,0,0)" : $"({loc.Value.X:F0},{loc.Value.Y:F0},{loc.Value.Z:F0})")} scale={(sc == null ? "1" : $"{sc.Value.Z:F1}")}");
        }
    }
    Console.WriteLine("\nDONE");
    return;
}

if ((Environment.GetEnvironmentVariable("MODE") ?? "") == "proxy")
{
    // Does each LandscapeStreamingProxy carry its own Z (and scale.Z)? Histogram rootLoc.Z + scale.Z
    // across ALL proxies. If they vary, the height decode must use per-proxy Z, not a global ACTOR_Z.
    var zs = new List<(double z, double sz, double sx, int sbx, int sby, string name)>();
    foreach (var cell in cells)
    {
        try
        {
            var exps = provider.LoadPackage(cell).GetExports().ToList();
            var proxy = exps.FirstOrDefault(e => e.ExportType == "LandscapeStreamingProxy");
            if (proxy == null) continue;
            var root = proxy.GetOrDefault<UObject?>("RootComponent");
            var rl = root != null && root.Properties.Any(p => p.Name.Text == "RelativeLocation") ? root.GetOrDefault<FVector>("RelativeLocation") : new FVector(0, 0, 0);
            var rs = root != null && root.Properties.Any(p => p.Name.Text == "RelativeScale3D") ? root.GetOrDefault<FVector>("RelativeScale3D") : new FVector(1, 1, 1);
            var lcomps = exps.Where(e => e.ExportType == "LandscapeComponent").Select(e => (x: e.GetOrDefault<int>("SectionBaseX"), y: e.GetOrDefault<int>("SectionBaseY"))).ToList();
            if (lcomps.Count == 0) continue;
            zs.Add((rl.Z, rs.Z, rs.X, lcomps.Min(c => c.x), lcomps.Min(c => c.y), proxy.Name));
        }
        catch { }
    }
    Console.WriteLine($"\n=== {zs.Count} proxies — rootLoc.Z histogram (5cm buckets) ===");
    foreach (var g in zs.GroupBy(z => Math.Round(z.z / 5.0) * 5.0).OrderBy(g => g.Key))
        Console.WriteLine($"  rootLoc.Z≈{g.Key,7:F0}  x{g.Count()}");
    Console.WriteLine($"\n=== scale.Z histogram ===");
    foreach (var g in zs.GroupBy(z => Math.Round(z.sz, 3)).OrderBy(g => g.Key)) Console.WriteLine($"  scale.Z={g.Key}  x{g.Count()}");
    // proxies covering Stu's two waterline spots (west ≈ SBX/SBY, Spire) — report rootLoc.Z for each
    Console.WriteLine($"\n=== proxy rootLoc.Z near key spots (SBX = (worldX+50800)/100) ===");
    foreach (var (wx, wy, tag) in new[] { (-279100.0, -156600.0, "WEST/B5"), (-37300.0, -229200.0, "SPIRE/H3") })
    {
        double sbx = (wx + 50800) / 100, sby = (wy + 50800) / 100;
        var hit = zs.Where(z => sbx >= z.sbx && sbx < z.sbx + 128 * 8 && sby >= z.sby && sby < z.sby + 128 * 8).OrderBy(z => Math.Abs(z.sbx - sbx) + Math.Abs(z.sby - sby)).FirstOrDefault();
        Console.WriteLine($"  {tag} (SBX≈{sbx:F0},SBY≈{sby:F0}) -> proxy {hit.name} rootLoc.Z={hit.z:F0} scaleZ={hit.sz}");
    }
    Console.WriteLine("\nDONE");
    return;
}

var SEA_Z = double.TryParse(Environment.GetEnvironmentVariable("SEA"), out var seaOv) ? seaOv : -1646.0; // ocean surface Z; tunable via SEA

// Water bodies (lakes/rivers): each carries a WaterSurface whose (absolute) location gives
// the surface world point + its fill Z. Used to flood inland water above sea level (crater lakes).
var levelPkgs = provider.Files.Keys.Where(k => k.Contains("/GameLevel01/") && k.EndsWith(".umap") && !k.Contains("/_Generated_/")).ToList();
var waterSeeds = new List<(double x, double y, double z, double sx, double sy, double yaw)>();
void TryAddWater(UObject e)
{
    if (!e.ExportType.Contains("Water")) return;
    var ws = e.GetOrDefault<UObject?>("WaterSurface");
    if (ws == null || !ws.Properties.Any(p => p.Name.Text == "RelativeLocation")) return;
    var loc = ws.GetOrDefault<FVector>("RelativeLocation");
    var scl = ws.Properties.Any(p => p.Name.Text == "RelativeScale3D") ? ws.GetOrDefault<FVector>("RelativeScale3D") : new FVector(1, 1, 1);
    var yaw = ws.Properties.Any(p => p.Name.Text == "RelativeRotation") ? ws.GetOrDefault<FRotator>("RelativeRotation").Yaw : 0.0;
    waterSeeds.Add((loc.X, loc.Y, loc.Z, scl.X, scl.Y, yaw));
}

// HIGHER GROUND: rock/cliff/mesa formations are individual StaticMeshComponents (under
// /Environment/Rock/) placed on top of the landscape. Collect each instance's transform so we
// can rasterise the mesh tops into the height grid (max(landscape, meshTop)).
var rocks = new List<(CUE4Parse.UE4.Objects.UObject.FPackageIndex pi, FVector loc, FRotator rot, FVector scale)>();
// Instance-level excludes: "MeshName@x,y" entries (world-cm, matched within ±100m). Kills one specific
// placed instance without touching the mesh's other legit uses (CliffFormation_05 has 544 placements!).
// Each off-map landmass is a few mega-meshes, traced via the ROCKAT footprint probe. Defaults so far:
//   T11 + off-frame slabs · AN east column (5 CaveSplitter) · AE-AK bottom strip (CliffFormation + CliffPillar).
var rockExcludeAt = (Environment.GetEnvironmentVariable("ROCKEXCLUDEAT")
        ?? "CliffFormation_05@418204,92745;CliffFormation_05@612135,252648"
         + ";CaveSplitter_01@428654,-181910;CaveSplitter_01@428083,-81758;CaveSplitter_01@429599,-127807"
         + ";CaveSplitter_01@426951,-233372;CaveSplitter_01@540008,-33723"
         + ";CliffFormation_05@227628,389675;CliffPillar_01@378630,334237"
         + ";CaveSplitter_01@117941,-327752;CaveSplitter_01@108671,-358332;CaveSplitter_01@74971,-329122" // north T1-X2
         + ";CaveSplitter_01@467211,-200017;CliffPillar_01@454008,64780;CliffPillar_01@467213,72703")     // AN right stragglers
    .Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
    .Select(s => { var at = s.Split('@'); var xy = at[1].Split(','); return (name: at[0], x: double.Parse(xy[0]), y: double.Parse(xy[1])); })
    .ToArray();
var rockExcluded = 0;
void TryAddRock(UObject e)
{
    if (!e.ExportType.Contains("StaticMeshComponent")) return;
    var pi = e.Properties.FirstOrDefault(p => p.Name.Text == "StaticMesh")?.Tag?.GenericValue as CUE4Parse.UE4.Objects.UObject.FPackageIndex;
    var path = pi?.ResolvedObject?.GetPathName();
    if (path == null || !path.Contains("/Environment/Rock/")) return;
    if (!e.Properties.Any(p => p.Name.Text == "RelativeLocation")) return;
    var loc = e.GetOrDefault<FVector>("RelativeLocation");
    if (rockExcludeAt.Any(x => path.Contains(x.name + ".") && Math.Abs(loc.X - x.x) < 10000 && Math.Abs(loc.Y - x.y) < 10000))
    {
        rockExcluded++;
        return;
    }
    var rot = e.Properties.Any(p => p.Name.Text == "RelativeRotation") ? e.GetOrDefault<FRotator>("RelativeRotation") : new FRotator(0, 0, 0);
    var scl = e.Properties.Any(p => p.Name.Text == "RelativeScale3D") ? e.GetOrDefault<FVector>("RelativeScale3D") : new FVector(1, 1, 1);
    rocks.Add((pi!, loc, rot, scl));
}

// WATER from the game's actual geometry: each FGWaterVolume is a brush (UModel.Points). Transform the
// points by the component (loc/rot/scale) and keep the world XY AABB + surface Z. Water = inside the
// footprint AND terrain <= surface Z — so below-sea-level DRY land is correctly excluded.
// Each entry is ONE convex BSP face of a water volume (world XY) + the volume's surface Z. The union
// of a volume's faces is its exact (possibly concave) footprint — no convex-hull over-cover.
var volumes = new List<((double x, double y)[] poly, double surfZ)>();
void TryAddVolume(UObject e)
{
    if (e.ExportType != "FGWaterVolume") return;
    var root = e.GetOrDefault<UObject?>("RootComponent");
    if (root?.GetOrDefault<UObject?>("Brush") is not CUE4Parse.UE4.Objects.Engine.UModel brush
        || brush.Points is not { Length: > 0 } pts || brush.Nodes is not { Length: > 0 } nodes || brush.Verts is not { Length: > 0 } verts) return;
    var loc = root.Properties.Any(p => p.Name.Text == "RelativeLocation") ? root.GetOrDefault<FVector>("RelativeLocation") : new FVector(0, 0, 0);
    var scl = root.Properties.Any(p => p.Name.Text == "RelativeScale3D") ? root.GetOrDefault<FVector>("RelativeScale3D") : new FVector(1, 1, 1);
    var yaw = (root.Properties.Any(p => p.Name.Text == "RelativeRotation") ? root.GetOrDefault<FRotator>("RelativeRotation").Yaw : 0.0) * Math.PI / 180.0;
    double cyw = Math.Cos(yaw), syw = Math.Sin(yaw);
    double maxZ = -1e18;
    foreach (var p in pts) maxZ = Math.Max(maxZ, loc.Z + p.Z * scl.Z);
    (double x, double y) W(FVector p) { double sx = p.X * scl.X, sy2 = p.Y * scl.Y; return (loc.X + sx * cyw - sy2 * syw, loc.Y + sx * syw + sy2 * cyw); }
    foreach (var node in nodes)
    {
        int nv = node.NumVertices; if (nv < 3) continue;
        var poly = new (double x, double y)[nv]; var ok = true;
        for (var k = 0; k < nv; k++)
        {
            var vi = node.iVertPool + k;
            if (vi < 0 || vi >= verts.Length) { ok = false; break; }
            var pi = verts[vi].pVertex;
            if (pi < 0 || pi >= pts.Length) { ok = false; break; }
            poly[k] = W(pts[pi]);
        }
        if (ok) volumes.Add((poly, maxZ));
    }
}

// RIVERS: BP_River_PROT_C actors are shallow flowing water with no FGWaterVolume. The RootComponent
// is a SplineComponent (world loc/rot/scale); mSplineMeshComponents deform SM_RiverPlane along the
// spline. Each SplineMeshComponent's SplineParams gives a cubic-Hermite segment (StartPos/Tangent ->
// EndPos/Tangent) in the actor's local frame + a cross-stream Scale.X. We Hermite-sample the centreline,
// transform to world, and stamp a ribbon into the water grid where terrain is at/below the river surface.
var rivers = new List<(FVector loc, double yaw, FVector scl, List<(FVector p0, FVector t0, FVector p1, FVector t1, double s0, double s1)> segs)>();
FVector AsVec(object? o)
{
    if (o is CUE4Parse.UE4.Assets.Objects.FScriptStruct fs) o = fs.StructType;
    if (o is FVector v) return v;
    if (o is FStructFallback fb) return new FVector(fb.GetOrDefault<float>("X"), fb.GetOrDefault<float>("Y"), fb.GetOrDefault<float>("Z"));
    return new FVector(0, 0, 0);
}
double AsScaleX(object? o)
{
    if (o is CUE4Parse.UE4.Assets.Objects.FScriptStruct fs) o = fs.StructType;
    if (o is CUE4Parse.UE4.Objects.Core.Math.FVector2D v2) return v2.X;
    if (o is FStructFallback fb) return fb.GetOrDefault<float>("X");
    return 1.0;
}
void TryAddRiver(UObject e)
{
    if (e.ExportType != "BP_River_PROT_C") return;
    var root = e.GetOrDefault<UObject?>("RootComponent");
    if (root == null || !root.Properties.Any(p => p.Name.Text == "RelativeLocation")) return;
    var loc = root.GetOrDefault<FVector>("RelativeLocation");
    var yaw = (root.Properties.Any(p => p.Name.Text == "RelativeRotation") ? root.GetOrDefault<FRotator>("RelativeRotation").Yaw : 0.0) * Math.PI / 180.0;
    var scl = root.Properties.Any(p => p.Name.Text == "RelativeScale3D") ? root.GetOrDefault<FVector>("RelativeScale3D") : new FVector(1, 1, 1);
    var smcs = e.GetOrDefault<CUE4Parse.UE4.Assets.Objects.UScriptArray?>("mSplineMeshComponents");
    if (smcs == null) return;
    var segs = new List<(FVector, FVector, FVector, FVector, double, double)>();
    foreach (var it in smcs.Properties)
    {
        var smc = (it.GenericValue as CUE4Parse.UE4.Objects.UObject.FPackageIndex)?.ResolvedObject?.Load();
        var spRaw = smc?.Properties.FirstOrDefault(p => p.Name.Text == "SplineParams")?.Tag?.GenericValue;
        var sp = spRaw as FStructFallback ?? (spRaw as CUE4Parse.UE4.Assets.Objects.FScriptStruct)?.StructType as FStructFallback;
        if (sp == null) continue;
        object? F(string nm) => sp.Properties.FirstOrDefault(p => p.Name.Text == nm)?.Tag?.GenericValue;
        segs.Add((AsVec(F("StartPos")), AsVec(F("StartTangent")), AsVec(F("EndPos")), AsVec(F("EndTangent")), AsScaleX(F("StartScale")), AsScaleX(F("EndScale"))));
    }
    if (segs.Count > 0) rivers.Add((loc, yaw, scl, segs));
}

// Per component: section base, heightmap, and the weightmap textures + layer allocations
// (layer name -> which weightmap texture + channel carries its blend weight).
var comps = new List<(int sx, int sy, UTexture2D tex, UTexture2D[] wtex, (string layer, int ti, int ch)[] alloc)>();
Console.WriteLine($"pass A: collecting LandscapeComponents from {cells.Count} cells...");
var n = 0;
foreach (var cell in cells)
{
    if (++n % 1000 == 0) Console.WriteLine($"  ...{n}/{cells.Count} comps={comps.Count}");
    try
    {
        foreach (var e in provider.LoadPackage(cell).GetExports())
        {
            TryAddWater(e);
            TryAddRock(e);
            TryAddRiver(e);
            if (e.ExportType != "LandscapeComponent") continue;
            var sx = e.GetOrDefault<int>("SectionBaseX");
            var sy = e.GetOrDefault<int>("SectionBaseY");
            if (e.GetOrDefault<UObject?>("HeightmapTexture") is not UTexture2D t) continue;
            var wtex = e.GetOrDefault<UTexture2D[]>("WeightmapTextures") ?? Array.Empty<UTexture2D>();
            var allocRaw = e.GetOrDefault<FStructFallback[]>("WeightmapLayerAllocations") ?? Array.Empty<FStructFallback>();
            var alloc = allocRaw.Select(a =>
            {
                var name = a.GetOrDefault<UObject?>("LayerInfo")?.Name?.Replace("_LayerInfo", "") ?? "";
                return (layer: name, ti: (int) a.GetOrDefault<byte>("WeightmapTextureIndex"), ch: (int) a.GetOrDefault<byte>("WeightmapTextureChannel"));
            }).Where(a => a.layer.Length > 0).ToArray();
            comps.Add((sx, sy, t, wtex, alloc));
        }
    }
    catch (Exception ex) { Console.Error.WriteLine($"[cell] {cell}: {ex.Message}"); }
}
if (comps.Count == 0) { Console.WriteLine("no components"); return; }
Console.WriteLine("collecting water bodies from persistent level...");
foreach (var pkg in levelPkgs) { try { foreach (var e in provider.LoadPackage(pkg).GetExports()) { TryAddWater(e); TryAddVolume(e); } } catch { } }
Console.WriteLine($"water seeds: {waterSeeds.Count}");
// Expand the grid by ~one overlay grid-unit of margin on every side (so the map isn't clipped
// against the frame). All world↔grid conversions use these bounds, so this just works downstream.
const int PADQ = 360; // quads of margin per side (~one A–T grid column)
int minSX = comps.Min(c => c.sx) - PADQ, maxSX = comps.Max(c => c.sx) + PADQ;
int minSY = comps.Min(c => c.sy) - PADQ, maxSY = comps.Max(c => c.sy) + PADQ;
int qW = maxSX - minSX + 128, qH = maxSY - minSY + 128;
int outW = (qW + ds - 1) / ds, outH = (qH + ds - 1) / ds;
Console.WriteLine($"components={comps.Count}  section X[{minSX}..{maxSX}] Y[{minSY}..{maxSY}]  grid {qW}x{qH} -> out {outW}x{outH} (ds={ds})");

var height = new float[outW * outH]; // h16 (0 = unfilled)
var terr = new byte[outW * outH * 3]; // dominant-layer colour (0,0,0 = none)
var wetW = new byte[outW * outH]; // max WetSand/Puddles weight per cell (game's wetness signal)
// Landscape VISIBILITY holes: cells painted with LandscapeVisibilityLayerInfo are masked out in-game
// (invisible landscape — holes through to caves). Our heightmap still has (deep) data there, so without
// this they render as deep terrain instead of void. Null their height => they become void. Env VISHOLE=0
// disables; VISTHRESH tunes the mask weight cut.
var visHole = Environment.GetEnvironmentVariable("VISHOLE") != "0";
var visThresh = int.TryParse(Environment.GetEnvironmentVariable("VISTHRESH"), out var _vt) ? _vt : 128;
var visHoleCells = 0;
Console.WriteLine("pass B: decode heightmap + weightmaps, splat...");
var probePts = new HashSet<(int, int)>();
var probeLabel = new Dictionary<(int, int), string>();
if (Environment.GetEnvironmentVariable("LAYERAT") is { Length: > 0 } laStr)
{
    foreach (var seg in laStr.Split(';', StringSplitOptions.RemoveEmptyEntries))
    {
        var pp = seg.Split(','); double lwx = double.Parse(pp[0]), lwy = double.Parse(pp[1]);
        int pox = (int) Math.Round(((lwx - ACTOR_X) / SCALE - minSX) / ds), poy = (int) Math.Round(((lwy - ACTOR_Y) / SCALE - minSY) / ds);
        probePts.Add((pox, poy)); probeLabel[(pox, poy)] = $"{lwx},{lwy}";
        Console.WriteLine($"LAYERAT probe cell ox={pox} oy={poy} (world {lwx},{lwy})");
    }
}
n = 0;
int failH = 0, failW = 0;
var byteForCh = new[] { 2, 1, 0, 3 }; // PF_B8G8R8A8 on disk = B,G,R,A; channel R,G,B,A -> byte
foreach (var (sx, sy, tex, wtex, alloc) in comps)
{
    if (++n % 500 == 0) Console.WriteLine($"  ...{n}/{comps.Count}");
    int w, h; byte[] hd;
    // --- HEIGHT (must always splat; a weightmap problem must never leave a hole) ---
    try
    {
        var mip = tex.GetFirstMip();
        var hdat = mip?.BulkData?.Data;
        if (mip == null || hdat == null || hdat.Length < mip.SizeX * mip.SizeY * 4) { failH++; continue; }
        w = mip.SizeX; h = mip.SizeY; hd = hdat;
    }
    catch (Exception ex) { failH++; Console.Error.WriteLine($"[height] {ex.Message}"); continue; }
    for (var j = 0; j < h; j += ds)
    {
        var oy = (sy - minSY + j) / ds;
        if (oy < 0 || oy >= outH) continue;
        for (var i = 0; i < w; i += ds)
        {
            var ox = (sx - minSX + i) / ds;
            if (ox < 0 || ox >= outW) continue;
            var p = (j * w + i) * 4;
            height[oy * outW + ox] = (hd[p + 2] << 8) | hd[p + 1];
        }
    }
    // --- TERRAIN COLOUR from weightmaps (best-effort; failure only loses colour, not height) ---
    try
    {
        var wdata = wtex.Select(t => { try { var m = t.GetFirstMip(); return (m?.BulkData?.Data, m?.SizeX ?? 0, m?.SizeY ?? 0); } catch { return (null, 0, 0); } }).ToArray();
        for (var j = 0; j < h; j += ds)
        {
            var oy = (sy - minSY + j) / ds;
            if (oy < 0 || oy >= outH) continue;
            for (var i = 0; i < w; i += ds)
            {
                var ox = (sx - minSX + i) / ds;
                if (ox < 0 || ox >= outW) continue;
                var p = (j * w + i) * 4;
                double sr = 0, sg = 0, sb = 0, sw = 0;
                foreach (var (layer, ti, ch) in alloc)
                {
                    if (ti < 0 || ti >= wdata.Length) continue;
                    var (wd, ww, wh) = wdata[ti];
                    if (wd == null || ww != w || wh != h) continue;
                    var off = p + byteForCh[Math.Clamp(ch, 0, 3)];
                    if (off >= wd.Length) continue;
                    double wv = wd[off];
                    if (wv <= 0) continue;
                    if (probePts.Contains((ox, oy))) Console.WriteLine($"  LAYERAT[{probeLabel.GetValueOrDefault((ox, oy))}] {layer,-14} weight={wv,3}");
                    if (visHole && layer == "LandscapeVisibilityLayerInfo" && wv >= visThresh) { height[oy * outW + ox] = 0; visHoleCells++; }
                    // WetSand/Puddles = the game's water's-edge signal (wet ground). CoralRock is NOT
                    // captured — coral can be dry exposed rock; it only becomes water if the connectivity
                    // spread reaches it from a genuine wet seed.
                    if (layer is "WetSand" or "Puddles") { var gw = oy * outW + ox; if (wv > wetW[gw]) wetW[gw] = (byte) wv; }
                    var (cr, cg, cb) = LayerColor(layer);
                    sr += wv * cr; sg += wv * cg; sb += wv * cb; sw += wv;
                }
                if (sw > 0)
                {
                    var gi = oy * outW + ox;
                    terr[gi * 3] = (byte) (sr / sw); terr[gi * 3 + 1] = (byte) (sg / sw); terr[gi * 3 + 2] = (byte) (sb / sw);
                }
            }
        }
    }
    catch (Exception ex) { failW++; Console.Error.WriteLine($"[weight] {ex.Message}"); }
}
var voids = height.Count(v => v == 0);
Console.WriteLine($"pass B done. height-fail={failH} weight-fail={failW}  void cells={voids}/{outW * outH} ({100.0 * voids / (outW * outH):F1}%)  visibility-holes nulled={visHoleCells}");

if ((Environment.GetEnvironmentVariable("MODE") ?? "") == "ztest")
{
    // Compare decoded terrain Z at known collectible (x,y) against their real z (ground truth).
    var json = System.Text.Json.JsonDocument.Parse(File.ReadAllText(@"D:\Code\StuartMeeks\ficsit-foreman\tools\fg-probe\world-locations.json"));
    var arr = json.RootElement.GetProperty("collectibles");
    int shown = 0; double sumDiff = 0; int cnt = 0;
    foreach (var c in arr.EnumerateArray())
    {
        double x = c.GetProperty("x").GetDouble(), y = c.GetProperty("y").GetDouble(), z = c.GetProperty("z").GetDouble();
        var col = (int) Math.Round(((x - ACTOR_X) / SCALE - minSX) / ds);
        var row = (int) Math.Round(((y - ACTOR_Y) / SCALE - minSY) / ds);
        if (col < 0 || col >= outW || row < 0 || row >= outH) continue;
        var h = height[row * outW + col];
        if (h == 0) continue;
        var myZ = Zof(h);
        sumDiff += myZ - z; cnt++;
        if (shown++ < 25) Console.WriteLine($"  ({x,8:F0},{y,8:F0})  realZ={z,8:F0}  myZ={myZ,8:F0}  diff={myZ - z,7:F0}");
    }
    Console.WriteLine($"\nmean(myZ - realZ) = {sumDiff / Math.Max(1, cnt):F0} cm over {cnt} collectibles");
    Console.WriteLine("DONE");
    return;
}

double Zof(float h16) => ACTOR_Z + (h16 - ZMID) * ZSCALE * SCALE; // cm
double cell_cm = ds * SCALE;

// HIGHER GROUND: rasterise the placed rock meshes' tops into the height grid (max with the
// landscape). Each mesh is transformed by its instance (scale→rotate→translate) and z-buffered.
var isRock = new bool[outW * outH];
// Base seabed = the landscape heightmap BEFORE rocks raise it. Water is classified against THIS, so
// rock spires (whose bases are submerged) don't punch holes in the water or block the shelf spread —
// they render as grey islands ON TOP of the water instead. Zof(baseH) = base ground Z.
var baseH = (float[]) height.Clone();
// OUTER VOID: seabed-void (baseH==0, no landscape mesh) that is border-connected = genuinely off-map.
// Computed on baseH (BEFORE rocks raise height, so rock cells don't block the flood-fill). Distinguishes
// Abyss floaters (rock over border-connected void → clip) from Spire spires (over reef, or over small
// INLAND baseH==0 gaps surrounded by seabed → keep). Fully geometric — the deterministic rock-clip source.
var outerVoid = new bool[outW * outH];
{
    var oq = new Queue<int>();
    void OV(int i) { if (!outerVoid[i] && baseH[i] == 0) { outerVoid[i] = true; oq.Enqueue(i); } }
    for (var x = 0; x < outW; x++) { OV(x); OV((outH - 1) * outW + x); }
    for (var y = 0; y < outH; y++) { OV(y * outW); OV(y * outW + outW - 1); }
    while (oq.Count > 0)
    {
        var i = oq.Dequeue(); int cx = i % outW, cy = i / outW;
        if (cx > 0) OV(i - 1); if (cx < outW - 1) OV(i + 1);
        if (cy > 0) OV(i - outW); if (cy < outH - 1) OV(i + outW);
    }
    Console.WriteLine($"outer void (border-connected seabed-void): {outerVoid.Count(b => b)} cells");
}
// VOID DISTANCE: cells from each outer-void cell to the nearest landmass (non-outer-void). Coastal cliffs
// overhang the void by only a thin fringe (small dist); Abyss masses extend far out (large dist). The
// default "fringe" rock-clip keeps rock within MARGIN cells of land, clips rock deeper in the void.
var voidDist = new int[outW * outH];
{
    var dq = new Queue<int>();
    for (var i = 0; i < outerVoid.Length; i++) { if (!outerVoid[i]) { voidDist[i] = 0; dq.Enqueue(i); } else voidDist[i] = int.MaxValue; }
    while (dq.Count > 0)
    {
        var i = dq.Dequeue(); int cx = i % outW, cy = i / outW; int nd = voidDist[i] + 1;
        void D(int j) { if (outerVoid[j] && voidDist[j] > nd) { voidDist[j] = nd; dq.Enqueue(j); } }
        if (cx > 0) D(i - 1); if (cx < outW - 1) D(i + 1);
        if (cy > 0) D(i - outW); if (cy < outH - 1) D(i + outW);
    }
}
var voidMargin = int.TryParse(Environment.GetEnvironmentVariable("VOIDMARGIN"), out var _vm) ? _vm : 12;
// Topo-map void mask (aligned to the render grid): 1 = off-map abyss (from the authoritative topological
// map's black region). Used to clip rock ONLY where it's genuinely off-map — so rock spires/islands over
// water (topo blue, not black) are KEPT, unlike the blunt baseH==0 clip. Grid-index, so it's ds-specific.
byte[]? voidMask = null;
{
    var vmPath = Environment.GetEnvironmentVariable("VOIDMASK");
    if (vmPath != null && File.Exists(vmPath))
    {
        var vm = File.ReadAllBytes(vmPath);
        if (vm.Length == outW * outH) { voidMask = vm; Console.WriteLine($"loaded topo void mask ({vm.Length} cells, {vm.Count(b => b != 0)} void)"); }
        else Console.WriteLine($"VOIDMASK size {vm.Length} != grid {outW * outH} — ignored (wrong ds?)");
    }
}
// Topo LAND mask (1 = topo says land, 0 = water/void). Preferred over voidMask: clip rock where NOT land, so
// the Abyss Cliffs (topo water) get clipped while Spire spires/islands (topo land) are kept. Grid-index, ds-specific.
byte[]? landMask = null;
{
    var lmPath = Environment.GetEnvironmentVariable("LANDMASK");
    if (lmPath != null && File.Exists(lmPath))
    {
        var lm = File.ReadAllBytes(lmPath);
        if (lm.Length == outW * outH) { landMask = lm; Console.WriteLine($"loaded topo land mask ({lm.Length} cells, {lm.Count(b => b != 0)} land)"); }
        else Console.WriteLine($"LANDMASK size {lm.Length} != grid {outW * outH} — ignored (wrong ds?)");
    }
}
var rockClip = Environment.GetEnvironmentVariable("ROCKCLIP") != "0";
var clipMode = Environment.GetEnvironmentVariable("ROCKCLIPMODE") ?? "none"; // default: render ALL rock; junk removed per-mesh via ROCKEXCLUDE
// Sea level used by the "surface" clip: over off-map void, only rock ABOVE the waterline is visible land
// (islands/cliffs); submerged rock lies under the ocean. Same value as the ocean unify (OCEANZ).
var rockSeaZ = double.TryParse(Environment.GetEnvironmentVariable("OCEANZ"), out var _rsz) ? _rsz : -1755.0;
if (Environment.GetEnvironmentVariable("ROCKS") != "0")
{
    Console.WriteLine($"higher-ground: rasterising {rocks.Count} rock instances...");
    var meshCache = new Dictionary<string, (FVector[] verts, int[] tris)>();
    (FVector[] verts, int[] tris) GetMesh(CUE4Parse.UE4.Objects.UObject.FPackageIndex pi)
    {
        var path = pi.ResolvedObject?.GetPathName() ?? "";
        if (meshCache.TryGetValue(path, out var cached)) return cached;
        var res = (Array.Empty<FVector>(), Array.Empty<int>());
        try
        {
            if (pi.ResolvedObject?.Load() is CUE4Parse.UE4.Assets.Exports.StaticMesh.UStaticMesh sm && sm.RenderData?.LODs is { Length: > 0 } lods)
            {
                for (var li = 0; li < lods.Length; li++) // LOD0 first = full detail (smooth cliffs, no facets)
                {
                    var lod = lods[li];
                    if (lod?.PositionVertexBuffer?.Verts is { Length: > 0 } vb && lod.IndexBuffer is { Length: > 2 } ib)
                    {
                        var tri = new int[ib.Length];
                        for (var k = 0; k < ib.Length; k++) tri[k] = ib[k];
                        res = (vb, tri);
                        break;
                    }
                }
            }
        }
        catch { }
        meshCache[path] = res;
        return res;
    }
    const double D2R = Math.PI / 180.0, H_PER_CM = 128.0 / 100.0; // h16 units per world-cm (inverse of ZSCALE*SCALE)
    var landH = (float[]) height.Clone(); // landscape baseline, to colour only substantial formations as rock
    const double ROCK_COLOUR_H = 300.0 * H_PER_CM; // grey a cell only where a formation rises >~3 m above ground
    long raised = 0;
    // ROCKAT="x,y;..." — report which rock instance(s) rasterise onto each target world-XY cell (mesh@origin),
    // so a rendered landmass can be traced to the exact instances and excluded via ROCKEXCLUDEAT.
    var rockAtTargets = (Environment.GetEnvironmentVariable("ROCKAT") ?? "")
        .Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
        .Select(s => { var a = s.Split(','); return (gx: (int) Math.Round(((double.Parse(a[0]) - ACTOR_X) / SCALE - minSX) / ds), gy: (int) Math.Round(((double.Parse(a[1]) - ACTOR_Y) / SCALE - minSY) / ds), label: s); }).ToList();
    var rockAtHits = new Dictionary<int, HashSet<string>>();
    foreach (var (pi, loc, rot, scale) in rocks)
    {
        var (verts, tris) = GetMesh(pi);
        if (verts.Length == 0 || tris.Length < 3) continue;
        var _mpath = pi.ResolvedObject?.GetPathName() ?? "";
        var meshName = _mpath.Length > 0 ? _mpath[(_mpath.LastIndexOf('/') + 1)..].Split('.')[0] : "?";
        double P = rot.Pitch * D2R, Y = rot.Yaw * D2R, Rr = rot.Roll * D2R;
        double CP = Math.Cos(P), SP = Math.Sin(P), CY = Math.Cos(Y), SY = Math.Sin(Y), CR = Math.Cos(Rr), SR = Math.Sin(Rr);
        double r00 = CP * CY, r01 = CP * SY, r02 = SP;                                   // UE FRotationMatrix rows
        double r10 = SR * SP * CY - CR * SY, r11 = SR * SP * SY + CR * CY, r12 = -SR * CP;
        double r20 = -(CR * SP * CY + SR * SY), r21 = CY * SR - CR * SP * SY, r22 = CR * CP;
        var gxA = new double[verts.Length]; var gyA = new double[verts.Length]; var zA = new double[verts.Length];
        for (var k = 0; k < verts.Length; k++)
        {
            var v = verts[k];
            double sx = v.X * scale.X, sy = v.Y * scale.Y, sz = v.Z * scale.Z;
            double wx = loc.X + sx * r00 + sy * r10 + sz * r20;
            double wy = loc.Y + sx * r01 + sy * r11 + sz * r21;
            double wz = loc.Z + sx * r02 + sy * r12 + sz * r22;
            gxA[k] = ((wx - ACTOR_X) / SCALE - minSX) / ds;
            gyA[k] = ((wy - ACTOR_Y) / SCALE - minSY) / ds;
            zA[k] = wz;
        }
        for (var t = 0; t + 2 < tris.Length; t += 3)
        {
            int i0 = tris[t], i1 = tris[t + 1], i2 = tris[t + 2];
            if (i0 >= verts.Length || i1 >= verts.Length || i2 >= verts.Length) continue;
            double ax = gxA[i0], ay = gyA[i0], az = zA[i0], bx = gxA[i1], by = gyA[i1], bz = zA[i1], cx2 = gxA[i2], cy2 = gyA[i2], cz = zA[i2];
            int x0 = (int) Math.Floor(Math.Min(ax, Math.Min(bx, cx2))), x1 = (int) Math.Ceiling(Math.Max(ax, Math.Max(bx, cx2)));
            int y0 = (int) Math.Floor(Math.Min(ay, Math.Min(by, cy2))), y1 = (int) Math.Ceiling(Math.Max(ay, Math.Max(by, cy2)));
            if (x1 < 0 || y1 < 0 || x0 >= outW || y0 >= outH) continue;
            if (x1 - x0 > 150 || y1 - y0 > 150) continue; // runaway/degenerate triangle -> skip
            x0 = Math.Max(0, x0); y0 = Math.Max(0, y0); x1 = Math.Min(outW - 1, x1); y1 = Math.Min(outH - 1, y1);
            double den = (by - cy2) * (ax - cx2) + (cx2 - bx) * (ay - cy2);
            if (Math.Abs(den) < 1e-9) continue;
            if (Math.Abs(den) < 0.4 && (x1 - x0 > 12 || y1 - y0 > 12)) continue; // thin sliver spanning far -> skip
            for (var py = y0; py <= y1; py++)
            for (var pxx = x0; pxx <= x1; pxx++)
            {
                double l1 = ((by - cy2) * (pxx - cx2) + (cx2 - bx) * (py - cy2)) / den;
                double l2 = ((cy2 - ay) * (pxx - cx2) + (ax - cx2) * (py - cy2)) / den;
                double l3 = 1 - l1 - l2;
                if (l1 < -0.02 || l2 < -0.02 || l3 < -0.02) continue;
                double z = l1 * az + l2 * bz + l3 * cz;
                var h16 = 32768.0 + (z - ACTOR_Z) * H_PER_CM;
                var idx = py * outW + pxx;
                // Per-cell clip modes (fallbacks). The DEFAULT "island" mode raises all rock here and
                // instead removes DETACHED floaters in a connectivity post-pass below (keeps coastal
                // cliffs attached to the mainland). land|void|basezero|outervoid = topo/geometry masks.
                if (rockClip && (clipMode switch {
                        "land" => landMask != null && landMask[idx] == 0,
                        "void" => voidMask != null && voidMask[idx] != 0,
                        "basezero" => baseH[idx] == 0,
                        "outervoid" => outerVoid[idx],
                        "fringe" => outerVoid[idx] && voidDist[idx] > voidMargin, // keep coastal fringe, clip deep-void masses
                        "surface" => outerVoid[idx] && z <= rockSeaZ, // over void keep only above-waterline rock
                        _ => false })) // "none": render everything
                    continue;
                if (h16 > height[idx]) { height[idx] = (float) h16; if (h16 - landH[idx] > ROCK_COLOUR_H) isRock[idx] = true; raised++; }
                if (rockAtTargets.Count > 0)
                    foreach (var tgt in rockAtTargets)
                        if (Math.Abs(pxx - tgt.gx) <= 1 && Math.Abs(py - tgt.gy) <= 1)
                            (rockAtHits.TryGetValue(tgt.gy * outW + tgt.gx, out var st) ? st : rockAtHits[tgt.gy * outW + tgt.gx] = new HashSet<string>())
                                .Add($"{meshName}@{loc.X:F0},{loc.Y:F0} (z={z:F0},scale={scale.Z:F1})");
            }
        }
    }
    Console.WriteLine($"higher-ground: {meshCache.Count} unique meshes, raised {raised} cells, excluded {rockExcluded} instances.");
    foreach (var tgt in rockAtTargets)
    {
        Console.WriteLine($"ROCKAT {tgt.label} (cell {tgt.gx},{tgt.gy}):");
        if (rockAtHits.TryGetValue(tgt.gy * outW + tgt.gx, out var st)) foreach (var s in st.OrderByDescending(x => x)) Console.WriteLine($"    {s}");
        else Console.WriteLine("    (no rock rasterised here)");
    }

    // CONNECTIVITY POST-PASS (default clipMode=island): keep rock CONNECTED to the mainland (coastal
    // cliffs), remove DETACHED rock islands floating in border-void (Abyss floaters). Flood-fill from
    // every landscape cell (baseH!=0) through 8-connected SOLID cells (height!=0 = landscape or rock);
    // any rock cell the flood never reaches sits alone over void → revert it to seabed/void.
    if (rockClip && clipMode == "island")
    {
        var reach = new bool[outW * outH];
        var mq = new Queue<int>();
        for (var i = 0; i < baseH.Length; i++) if (baseH[i] != 0) { reach[i] = true; mq.Enqueue(i); } // seeds = real landscape
        while (mq.Count > 0)
        {
            var i = mq.Dequeue(); int cx = i % outW, cy = i / outW;
            for (var dy = -1; dy <= 1; dy++)
            for (var dx = -1; dx <= 1; dx++)
            {
                if (dx == 0 && dy == 0) continue;
                int nx = cx + dx, ny = cy + dy;
                if (nx < 0 || ny < 0 || nx >= outW || ny >= outH) continue;
                int j = ny * outW + nx;
                if (!reach[j] && height[j] != 0) { reach[j] = true; mq.Enqueue(j); } // spread through solid (rock or land)
            }
        }
        int reverted = 0;
        for (var i = 0; i < height.Length; i++)
            if (isRock[i] && !reach[i]) { height[i] = baseH[i]; isRock[i] = false; reverted++; } // detached floater → drop
        Console.WriteLine($"connectivity clip: reverted {reverted} detached rock-island cells (kept coastal cliffs).");
    }
}

// OCEAN = below-sea cells connected to the map edge, BUT void (unmeshed, no data) is a
// BARRIER: void conducts only to other void, never into terrain. So the sea reaches land
// only through genuine below-sea terrain, not through data gaps. Enclosed below-sea basins
// (and land that only borders void) stay dry.
// WATER = the game's actual FGWaterVolume geometry (rasterised below), NOT a sea-level flood-fill.
var isOcean = new bool[outW * outH];
var isLake = new bool[outW * outH]; // set by the inland-body fill (vs the sea flood) — for debug
var waterZ = new double[outW * outH]; // surface Z of the water covering each ocean/lake cell
// Phase 1: the REAL sea = void connected to the map border. Inland void holes (data gaps inside
// the continent) are NOT sea, so terrain touching them must NOT seed the ocean.
var oceanVoid = new bool[outW * outH];
{
    var vq = new Queue<int>();
    void SV(int i) { if (!oceanVoid[i] && height[i] == 0) { oceanVoid[i] = true; vq.Enqueue(i); } }
    for (var x = 0; x < outW; x++) { SV(x); SV((outH - 1) * outW + x); }
    for (var y = 0; y < outH; y++) { SV(y * outW); SV(y * outW + outW - 1); }
    while (vq.Count > 0)
    {
        var i = vq.Dequeue(); int cx = i % outW, cy = i / outW;
        if (cx > 0) SV(i - 1);
        if (cx < outW - 1) SV(i + 1);
        if (cy > 0) SV(i - outW);
        if (cy < outH - 1) SV(i + outW);
    }
}
// Rasterise every FGWaterVolume: within its world XY footprint, any terrain cell at/below the
// volume's surface Z is water. This captures ocean, lakes, rivers and high-altitude crater lakes
// at their true surface heights, and — because water only exists where a volume is — below-sea dry
// land is never flooded. Overlaps keep the highest surface (deepest water).
Console.WriteLine($"water-volume rasterise ({volumes.Count} FGWaterVolume faces)...");
// Unify the ocean: the game ships the sea as ~32 deep FGWaterVolumes staggered across −1635..−1815 (they
// are invisible physics volumes; the visible water is ONE uniform mesh). Snap every sea-level-band volume
// (surfZ −1600..−1850) to a single OCEAN_Z so the shoreline has no authoring-noise steps. Lakes and
// crater lakes (surfZ > −1600) are NOT touched — they keep their own heights. Default −1730 = exactly the
// Spire Coast's current level, so that shoreline is unchanged by construction.
double oceanZ = double.TryParse(Environment.GetEnvironmentVariable("OCEANZ"), out var _oz) ? _oz : -1755.0;
bool oceanBand(double z) => z >= -1850 && z <= -1600;
// volVoid = VOID cells (no seabed mesh) that fall inside an ocean-band FGWaterVolume footprint. This is the
// AUTHORITATIVE ocean-vs-void signal for the off-map region: the game's water physics volume is present
// there even though the landscape mesh isn't. Renders blue; void OUTSIDE every volume renders grey.
// Replaces the old seaVoid R=300 distance dilation (which both over- and under-reached).
var volVoid = new bool[outW * outH];
foreach (var (poly, surfZRaw) in volumes)
{
    double surfZ = oceanBand(surfZRaw) ? oceanZ : surfZRaw;
    double vminX = poly.Min(p => p.x), vmaxX = poly.Max(p => p.x), vminY = poly.Min(p => p.y), vmaxY = poly.Max(p => p.y);
    int gx0 = Math.Max(0, (int) (((vminX - ACTOR_X) / SCALE - minSX) / ds));
    int gx1 = Math.Min(outW - 1, (int) Math.Ceiling(((vmaxX - ACTOR_X) / SCALE - minSX) / ds));
    int gy0 = Math.Max(0, (int) (((vminY - ACTOR_Y) / SCALE - minSY) / ds));
    int gy1 = Math.Min(outH - 1, (int) Math.Ceiling(((vmaxY - ACTOR_Y) / SCALE - minSY) / ds));
    for (var gy = gy0; gy <= gy1; gy++)
    for (var gx = gx0; gx <= gx1; gx++)
    {
        var idx = gy * outW + gx;
        if (baseH[idx] != 0 && Zof(baseH[idx]) > surfZ) continue;   // SEABED above the surface -> not water here (ignore rocks on top)
        double worldX = ACTOR_X + (minSX + gx * ds) * SCALE, worldY = ACTOR_Y + (minSY + gy * ds) * SCALE;
        if (!PointInPoly(poly, worldX, worldY)) continue;           // inside this face's projection
        if (baseH[idx] == 0) { if (oceanBand(surfZRaw)) volVoid[idx] = true; continue; } // void inside ocean volume -> blue, not land
        if (!isOcean[idx] || surfZ > waterZ[idx]) { isOcean[idx] = true; waterZ[idx] = surfZ; }
    }
}
// Manual ocean-blue override: void cells inside these world-XY boxes render blue. The far-west frame margin
// (cols A-B + C33/C34) is west ocean that the FGWaterVolume footprints don't quite reach. "x0,y0,x1,y1;..."
{
    var blueBoxes = (Environment.GetEnvironmentVariable("BLUEBOX")
            ?? "-340800,-340800,-301630,340968;-301630,300864,-282045,340968")
        .Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
        .Select(s => { var b = s.Split(','); return (x0: double.Parse(b[0]), y0: double.Parse(b[1]), x1: double.Parse(b[2]), y1: double.Parse(b[3])); })
        .ToArray();
    var nb = 0;
    for (var gy = 0; gy < outH; gy++)
    for (var gx = 0; gx < outW; gx++)
    {
        var idx = gy * outW + gx;
        if (baseH[idx] != 0 || volVoid[idx]) continue;
        double wx = ACTOR_X + (minSX + gx * ds) * SCALE, wy = ACTOR_Y + (minSY + gy * ds) * SCALE;
        if (blueBoxes.Any(b => wx >= b.x0 && wx <= b.x1 && wy >= b.y0 && wy <= b.y1)) { volVoid[idx] = true; nb++; }
    }
    if (nb > 0) Console.WriteLine($"blue-box override: {nb} void cells forced ocean-blue.");
}

// Rivers: Hermite-sample each BP_River spline segment, transform to world, stamp a ribbon of
// half-width = RIVERW * cross-stream-scale wherever terrain is at/below the river surface (+tol).
if (Environment.GetEnvironmentVariable("RIVERS") != "0" && rivers.Count > 0)
{
    double riverW = double.TryParse(Environment.GetEnvironmentVariable("RIVERW"), out var rvw) ? rvw : 200.0; // cm half-width at scale=1
    double riverTol = double.TryParse(Environment.GetEnvironmentVariable("RIVERTOL"), out var rvt) ? rvt : 400.0; // cm terrain-above-surface slack
    Console.WriteLine($"river rasterise ({rivers.Count} BP_River actors, W={riverW} tol={riverTol})...");
    long rvMarked = 0;
    foreach (var (loc, yaw, scl, segs) in rivers)
    {
        double cyr = Math.Cos(yaw), syr = Math.Sin(yaw);
        (double x, double y, double z) Wr(FVector p)
        {
            double lx = p.X * scl.X, ly = p.Y * scl.Y, lz = p.Z * scl.Z;
            return (loc.X + lx * cyr - ly * syr, loc.Y + lx * syr + ly * cyr, loc.Z + lz);
        }
        foreach (var (p0, t0, p1, t1, s0, s1) in segs)
        {
            const int NS = 48;
            for (var i = 0; i <= NS; i++)
            {
                double t = (double) i / NS, t2 = t * t, t3 = t2 * t;
                double h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
                var lp = new FVector(
                    (float) (h00 * p0.X + h10 * t0.X + h01 * p1.X + h11 * t1.X),
                    (float) (h00 * p0.Y + h10 * t0.Y + h01 * p1.Y + h11 * t1.Y),
                    (float) (h00 * p0.Z + h10 * t0.Z + h01 * p1.Z + h11 * t1.Z));
                var (wx, wy, wz) = Wr(lp);
                double half = riverW * (s0 + (s1 - s0) * t);
                int gx0 = Math.Max(0, (int) (((wx - half - ACTOR_X) / SCALE - minSX) / ds)), gx1 = Math.Min(outW - 1, (int) Math.Ceiling(((wx + half - ACTOR_X) / SCALE - minSX) / ds));
                int gy0 = Math.Max(0, (int) (((wy - half - ACTOR_Y) / SCALE - minSY) / ds)), gy1 = Math.Min(outH - 1, (int) Math.Ceiling(((wy + half - ACTOR_Y) / SCALE - minSY) / ds));
                double h2 = half * half;
                for (var gy = gy0; gy <= gy1; gy++)
                for (var gx = gx0; gx <= gx1; gx++)
                {
                    var j = gy * outW + gx;
                    if (isOcean[j] || height[j] == 0) continue;
                    if (Zof(height[j]) > wz + riverTol) continue; // bank well above the river surface
                    double worldX = ACTOR_X + (minSX + gx * ds) * SCALE, worldY = ACTOR_Y + (minSY + gy * ds) * SCALE;
                    double dx = worldX - wx, dy = worldY - wy;
                    if (dx * dx + dy * dy > h2) continue;
                    isOcean[j] = true; isLake[j] = true; waterZ[j] = wz; rvMarked++;
                }
            }
        }
    }
    Console.WriteLine($"  rivers: marked={rvMarked} cells");
}

// Supplement: shallow BP_Water/TranslucentWater bodies with NO gameplay volume (too shallow to swim,
// e.g. small rivers/ponds). Their WaterSurface is a scaled+rotated plane — fill its rectangle where
// terrain is at/below the surface, ONLY where a volume hasn't already put water.
Console.WriteLine($"shallow-water supplement ({waterSeeds.Count} BP_Water bodies)...");
long suppMarked = 0, suppInRect = 0, suppSkipOcean = 0, suppSkipHigh = 0;
var sdbg = 0;
foreach (var (wx, wy, wz, sxu, syu, yawDeg) in waterSeeds)
{
    double a = 50.0 * Math.Max(1, Math.Abs(sxu)), b = 50.0 * Math.Max(1, Math.Abs(syu)); // WaterPlane half-size (cm) x scale
    if (sdbg++ < 5) Console.WriteLine($"   body ({wx:F0},{wy:F0},{wz:F0}) scale=({sxu:F0},{syu:F0}) -> footprint {a * 2:F0}x{b * 2:F0} cm");
    var yaw = yawDeg * Math.PI / 180.0;
    double cyaw = Math.Cos(-yaw), syaw = Math.Sin(-yaw);
    var rad = Math.Max(a, b);
    int gx0 = Math.Max(0, (int) (((wx - rad - ACTOR_X) / SCALE - minSX) / ds)), gx1 = Math.Min(outW - 1, (int) (((wx + rad - ACTOR_X) / SCALE - minSX) / ds));
    int gy0 = Math.Max(0, (int) (((wy - rad - ACTOR_Y) / SCALE - minSY) / ds)), gy1 = Math.Min(outH - 1, (int) (((wy + rad - ACTOR_Y) / SCALE - minSY) / ds));
    for (var gy = gy0; gy <= gy1; gy++)
    for (var gx = gx0; gx <= gx1; gx++)
    {
        var j = gy * outW + gx;
        if (isOcean[j]) { suppSkipOcean++; continue; }
        if (height[j] == 0) continue;
        if (Zof(height[j]) > wz) { suppSkipHigh++; continue; }
        double worldX = ACTOR_X + (minSX + gx * ds) * SCALE, worldY = ACTOR_Y + (minSY + gy * ds) * SCALE;
        double dx = worldX - wx, dy = worldY - wy;
        double rx = dx * cyaw - dy * syaw, ry = dx * syaw + dy * cyaw;
        if (Math.Abs(rx) <= a && Math.Abs(ry) <= b) { suppInRect++; isOcean[j] = true; isLake[j] = true; waterZ[j] = wz; suppMarked++; }
    }
}
Console.WriteLine($"  supplement: marked={suppMarked}  skipOcean={suppSkipOcean}  skipTerrainAboveSurface={suppSkipHigh}");
if (Environment.GetEnvironmentVariable("CELLS") is { Length: > 0 } cells2)
{
    double cw = outW / 20.0, ch = outH / 17.0; // A–T x 1–17 overlay grid
    foreach (var cn in cells2.Split(',', StringSplitOptions.RemoveEmptyEntries))
    {
        var t = cn.Trim();
        int c = char.ToUpper(t[0]) - 'A', r = int.Parse(t[1..]) - 1;
        int x0 = (int) (c * cw), x1 = (int) ((c + 1) * cw), y0 = (int) (r * ch), y1 = (int) ((r + 1) * ch);
        long water = 0, land = 0, voidc = 0, lake = 0, tot = 0;
        for (var y = y0; y < y1; y++)
        for (var x = x0; x < x1; x++)
        {
            var idx = y * outW + x; tot++;
            if (height[idx] == 0) voidc++;
            else if (isLake[idx]) lake++;
            else if (isOcean[idx]) water++;
            else land++;
        }
        Console.WriteLine($"{t,-4} land={100.0 * land / tot,4:F0}%  sea={100.0 * water / tot,4:F0}%  lake={100.0 * lake / tot,3:F0}%  void={100.0 * voidc / tot,4:F0}%");
    }
    Console.WriteLine("DONE");
    return;
}


// Void aesthetics: OPEN-OCEAN void (border-connected = oceanVoid) near the sea reads as ocean-blue
// (so the west/east/north oceans extend to the frame). Restricted to oceanVoid so ENCLOSED void holes
// (inland landscape holes, e.g. I12 b4 by the swamp, or E15 d4) never turn blue — they stay dark-grey.
var seaVoid = new bool[outW * outH];
{
    const int R = 300;
    var depth = new int[outW * outH];
    var sq = new Queue<int>();
    for (var i = 0; i < outW * outH; i++)
    {
        if (height[i] != 0 || !oceanVoid[i]) continue; // only the open sea (border-connected void)
        int cx = i % outW, cy = i / outW;
        var adj = (cx > 0 && isOcean[i - 1]) || (cx < outW - 1 && isOcean[i + 1]) || (cy > 0 && isOcean[i - outW]) || (cy < outH - 1 && isOcean[i + outW]);
        if (adj) { seaVoid[i] = true; sq.Enqueue(i); }
    }
    while (sq.Count > 0)
    {
        var i = sq.Dequeue(); if (depth[i] >= R) continue; int cx = i % outW, cy = i / outW;
        void S(int j) { if (height[j] == 0 && oceanVoid[j] && !seaVoid[j]) { seaVoid[j] = true; depth[j] = depth[i] + 1; sq.Enqueue(j); } }
        if (cx > 0) S(i - 1);
        if (cx < outW - 1) S(i + 1);
        if (cy > 0) S(i - outW);
        if (cy < outH - 1) S(i + outW);
    }
}

if (Environment.GetEnvironmentVariable("PROBEXY") is { Length: > 0 } pxy)
{
    foreach (var pair in pxy.Split(';', StringSplitOptions.RemoveEmptyEntries))
    {
        var xy = pair.Split(','); double wx = double.Parse(xy[0]), wy = double.Parse(xy[1]);
        var col = (int) Math.Round(((wx - ACTOR_X) / SCALE - minSX) / ds);
        var row = (int) Math.Round(((wy - ACTOR_Y) / SCALE - minSY) / ds);
        if (col < 0 || col >= outW || row < 0 || row >= outH) { Console.WriteLine($"({wx:F0},{wy:F0}) OUT OF GRID"); continue; }
        var idx = row * outW + col; var h = height[idx]; var bh = baseH[idx];
        Console.WriteLine($"({wx:F0},{wy:F0}) rockTopZ={(h == 0 ? double.NaN : Zof(h)):F0} seabedZ={(bh == 0 ? double.NaN : Zof(bh)):F0} isRock={isRock[idx]}  isOcean={isOcean[idx]} isLake={isLake[idx]}  waterZ(surf)={(isOcean[idx] ? waterZ[idx].ToString("F0") : "-")}  oceanVoid={oceanVoid[idx]} volVoid={volVoid[idx]}  render={(isOcean[idx] && !isRock[idx] ? "OCEAN" : h != 0 ? "land/rock" : volVoid[idx] ? "OCEAN(void)" : "VOID(grey)")}");
    }
    Console.WriteLine("DONE");
    return;
}

// COASTAL SHELF: the landscape mesh continues UNDERWATER past the shoreline, so meshed terrain
// below sea level renders as land right up to the mesh edge (the blue void beyond). Flood such
// below-sea terrain wherever it connects — through other below-sea terrain — to the ocean-void
// (seaVoid). Above-sea terrain is a wall, so enclosed below-sea DRY basins (held by a coastline
// ridge) never get seeded and stay land. Fills the coastal shelf (Spire Coast etc.) to sea level.
// OFF by default: connectivity floods too broadly (over-floods the southern coast, which connects
// to the ocean via below-sea terrain). The material-based wet-sand pass below is the precise
// mechanism for coastal shallows. Opt in with SHELF=1 for diagnostics only.
if (Environment.GetEnvironmentVariable("SHELF") == "1")
{
    double shelfSea = double.TryParse(Environment.GetEnvironmentVariable("SHELFZ"), out var sz) ? sz : -1699.0;
    var q = new Queue<int>();
    bool BelowSea(int i) => height[i] != 0 && Zof(height[i]) < shelfSea;
    for (var i = 0; i < outW * outH; i++)
    {
        if (isOcean[i] || !BelowSea(i)) continue;
        int cx = i % outW, cy = i / outW;
        var touchesSea = (cx > 0 && seaVoid[i - 1]) || (cx < outW - 1 && seaVoid[i + 1]) || (cy > 0 && seaVoid[i - outW]) || (cy < outH - 1 && seaVoid[i + outW]);
        if (touchesSea) { isOcean[i] = true; waterZ[i] = shelfSea; q.Enqueue(i); }
    }
    long shelfN = q.Count;
    while (q.Count > 0)
    {
        var i = q.Dequeue(); int cx = i % outW, cy = i / outW;
        void SP(int j) { if (!isOcean[j] && BelowSea(j)) { isOcean[j] = true; waterZ[j] = shelfSea; q.Enqueue(j); shelfN++; } }
        if (cx > 0) SP(i - 1);
        if (cx < outW - 1) SP(i + 1);
        if (cy > 0) SP(i - outW);
        if (cy < outH - 1) SP(i + outW);
    }
    Console.WriteLine($"coastal-shelf flood: {shelfN} cells (seed from seaVoid, spread through below-sea terrain)");
}

// SUBMERGED WET-SAND: enclosed below-sea shallows with no water actor (Spire Coast lagoons) that
// the shelf flood can't reach are painted by the game with WetSand/Puddles — its own wetness signal.
// So below-sea + strongly-WetSand terrain = shallow water. Dry inland basins are Sand/Soil/Grass, not
// WetSand, so they're never caught. Marked as lake (shallow surface = sea level).
if (Environment.GetEnvironmentVariable("WETWATER") != "0")
{
    int wetThresh = int.TryParse(Environment.GetEnvironmentVariable("WETTHRESH"), out var wt) ? wt : 50;
    // Wet cells sitting up to WETRISE cm ABOVE sea are small (<1m) waterline bumps the water still
    // covers — include them (only wet-material cells, so dry inland can never be caught).
    double wetRise = double.TryParse(Environment.GetEnvironmentVariable("WETRISE"), out var wr) ? wr : 0.0;
    // Depth cap: only SHALLOW wet cells are coastal shallows. Deep-below-sea wet terrain is a dry bowl
    // (e.g. the Blue Crater floor, coral-painted, 28-96 m below sea — its real water is a deep
    // FGWaterVolume at −9600, handled separately). Cells deeper than WETDEEP below sea are left dry.
    double wetDeep = double.TryParse(Environment.GetEnvironmentVariable("WETDEEP"), out var wd2) ? wd2 : 500.0;
    // True water surface (Stu ground-truth at Spire Coast H3 c4/d4: land −1726 sits ~40cm above water,
    // waterlines at terrain −1734/−1773 → water ≈ −1760, ~60cm below the −1699 ocean-spline constant).
    double wetSea = double.TryParse(Environment.GetEnvironmentVariable("WETSEA"), out var ws) ? ws : -1755.0, wetCut = wetSea + wetRise, wetFloor = wetSea - wetDeep;
    bool ShallowSub(int i) { if (baseH[i] == 0) return false; var z = Zof(baseH[i]); return z < wetCut && z >= wetFloor; } // seabed, not rock-raised
    var wq = new Queue<int>();
    // SEED: shallow WetSand/Puddles cells — the genuine water's edge.
    for (var i = 0; i < outW * outH; i++)
        if (!isOcean[i] && wetW[i] >= wetThresh && ShallowSub(i)) { isOcean[i] = true; isLake[i] = true; waterZ[i] = Math.Max(wetSea, Zof(baseH[i])); wq.Enqueue(i); }
    long wetSeed = wq.Count, wetN = wq.Count;
    // SPREAD: flood connected shallow below-sea terrain (any material) reachable from a wet seed. This
    // fills coral/sand shelf that is actually part of the water body, but NOT isolated inland coral
    // (e.g. L15 b2, Blue Crater walls) which no wet seed touches.
    while (wq.Count > 0)
    {
        var i = wq.Dequeue(); int cx = i % outW, cy = i / outW;
        void SP(int j) { if (!isOcean[j] && ShallowSub(j)) { isOcean[j] = true; isLake[j] = true; waterZ[j] = Math.Max(wetSea, Zof(baseH[j])); wq.Enqueue(j); wetN++; } }
        if (cx > 0) SP(i - 1);
        if (cx < outW - 1) SP(i + 1);
        if (cy > 0) SP(i - outW);
        if (cy < outH - 1) SP(i + outW);
    }
    Console.WriteLine($"submerged shallows: {wetSeed} wet seeds -> {wetN} cells (WetSand/Puddles>={wetThresh}, spread through shallow below-sea terrain)");
}

var lx = -0.7071; var ly = -0.7071; var lz = 1.0; var ll = Math.Sqrt(lx * lx + ly * ly + lz * lz);
lx /= ll; ly /= ll; lz /= ll;
var rgb = new byte[outW * outH * 3];
for (var y = 0; y < outH; y++)
for (var x = 0; x < outW; x++)
{
    var idx = y * outW + x;
    var hc = height[idx];
    var zc = hc == 0 ? -99999 : Zof(hc);
    if (Environment.GetEnvironmentVariable("DEBUG") == "1")
    {
        var i3 = idx * 3;
        if (hc == 0) { rgb[i3] = 255; rgb[i3 + 1] = 0; rgb[i3 + 2] = 255; }              // void = magenta
        else if (isLake[idx]) { rgb[i3] = 0; rgb[i3 + 1] = 230; rgb[i3 + 2] = 230; }     // inland-body fill = cyan
        else if (isOcean[idx] && !isRock[idx]) { rgb[i3] = 0; rgb[i3 + 1] = 90; rgb[i3 + 2] = 220; } // SEA flood = blue (rock spires draw as land)
        else { var g = (byte) Math.Clamp((zc - SEA_Z) / 200.0 + 50, 0, 255); rgb[i3] = g; rgb[i3 + 1] = g; rgb[i3 + 2] = g; } // land = grey by height
        continue;
    }
    if (isOcean[idx] && !isRock[idx]) // rock spires sit ON TOP of the water -> fall through to land/rock shading
    {
        // depth below this cell's own water surface, measured to the SEABED (base landscape, not rocks)
        var surf = waterZ[idx];
        var zcBase = baseH[idx] == 0 ? surf - 8000 : Zof(baseH[idx]);
        var depthCm = surf - zcBase;
        var depth = Math.Clamp(depthCm / 7000.0, 0, 1); // 0..70m -> shallow..deep
        rgb[idx * 3] = (byte)(22 + 36 * (1 - depth));
        rgb[idx * 3 + 1] = (byte)(52 + 64 * (1 - depth));
        rgb[idx * 3 + 2] = (byte)(104 + 74 * (1 - depth));
        continue;
    }
    if (hc == 0) // void inside an ocean FGWaterVolume -> ocean-blue; void outside every volume -> dark grey
    {
        if (volVoid[idx]) { rgb[idx * 3] = 22; rgb[idx * 3 + 1] = 55; rgb[idx * 3 + 2] = 110; }
        else { rgb[idx * 3] = 46; rgb[idx * 3 + 1] = 49; rgb[idx * 3 + 2] = 55; }
        continue;
    }
    // land: hillshade
    var xl = x > 0 ? height[idx - 1] : hc; var xr = x < outW - 1 ? height[idx + 1] : hc;
    var yt = y > 0 ? height[idx - outW] : hc; var yb = y < outH - 1 ? height[idx + outW] : hc;
    if (xl == 0) xl = hc; if (xr == 0) xr = hc; if (yt == 0) yt = hc; if (yb == 0) yb = hc;
    var dzdx = (Zof(xr) - Zof(xl)) / (2 * cell_cm);
    var dzdy = (Zof(yb) - Zof(yt)) / (2 * cell_cm);
    var nx = -dzdx; var ny = -dzdy; var nz = 1.0; var nl = Math.Sqrt(nx * nx + ny * ny + nz * nz);
    var shade = Math.Clamp((nx * lx + ny * ly + nz * lz) / nl, 0, 1);
    double baseR, baseG, baseB;
    if (isRock[idx]) { baseR = 143; baseG = 135; baseB = 122; } // higher-ground rock formation
    else if (terr[idx * 3] != 0 || terr[idx * 3 + 1] != 0 || terr[idx * 3 + 2] != 0)
    { baseR = terr[idx * 3]; baseG = terr[idx * 3 + 1]; baseB = terr[idx * 3 + 2]; }
    else { var e = Math.Clamp((zc - SEA_Z) / 40000.0, 0, 1); baseR = 90 + 130 * e; baseG = 120 + 100 * e; baseB = 70 + 120 * e; }
    var s = 0.45 + 0.55 * shade;
    rgb[idx * 3] = (byte)Math.Clamp(baseR * s, 0, 255);
    rgb[idx * 3 + 1] = (byte)Math.Clamp(baseG * s, 0, 255);
    rgb[idx * 3 + 2] = (byte)Math.Clamp(baseB * s, 0, 255);
}

var outPpm = Path.Combine(Directory.GetCurrentDirectory(), "map.ppm");
using (var fs = new FileStream(outPpm, FileMode.Create))
{
    var header = System.Text.Encoding.ASCII.GetBytes($"P6\n{outW} {outH}\n255\n");
    fs.Write(header, 0, header.Length);
    fs.Write(rgb, 0, rgb.Length);
}
double wx0 = ACTOR_X + minSX * SCALE, wy0 = ACTOR_Y + minSY * SCALE;
double wx1 = ACTOR_X + (maxSX + 127) * SCALE, wy1 = ACTOR_Y + (maxSY + 127) * SCALE;
File.WriteAllText(Path.Combine(Directory.GetCurrentDirectory(), "map-bounds.txt"),
    $"outW={outW} outH={outH} ds={ds}\nworldCm X[{wx0}..{wx1}] Y[{wy0}..{wy1}]\nseaLevelZ={SEA_Z}\n");
Console.WriteLine($"wrote {outPpm} ({outW}x{outH})  seaLevelZ={SEA_Z}");
Console.WriteLine("DONE");

// Approximate real terrain colour for a landscape layer, by name.
static (byte, byte, byte) LayerColor(string name)
{
    var n = name.ToLowerInvariant();
    if (n.Contains("sand") || n.Contains("dune") || n.Contains("desert") || n.Contains("beach")) return (206, 178, 126);
    if (n.Contains("forest") || n.Contains("jungle") || n.Contains("tree")) return (58, 84, 48);
    if (n.Contains("grass") || n.Contains("moss") || n.Contains("field") || n.Contains("meadow")) return (104, 132, 70);
    if (n.Contains("snow") || n.Contains("ice")) return (232, 236, 240);
    if (n.Contains("coral")) return (178, 168, 142);
    if (n.Contains("rock") || n.Contains("stone") || n.Contains("cliff") || n.Contains("gravel") || n.Contains("mountain") || n.Contains("scree")) return (140, 132, 120);
    if (n.Contains("soil") || n.Contains("dirt") || n.Contains("mud") || n.Contains("ground")) return (112, 90, 62);
    return (120, 128, 96);
}

// 2D convex hull (Andrew's monotone chain) of a point cloud — the tight footprint of a water volume.
static (double x, double y)[] ConvexHull(List<(double x, double y)> pts)
{
    var p = pts.Distinct().OrderBy(a => a.x).ThenBy(a => a.y).ToList();
    if (p.Count < 3) return p.ToArray();
    double Cross((double x, double y) o, (double x, double y) a, (double x, double y) b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    var h = new List<(double x, double y)>();
    foreach (var q in p) { while (h.Count >= 2 && Cross(h[^2], h[^1], q) <= 0) h.RemoveAt(h.Count - 1); h.Add(q); }
    var lower = h.Count + 1;
    for (var i = p.Count - 2; i >= 0; i--) { var q = p[i]; while (h.Count >= lower && Cross(h[^2], h[^1], q) <= 0) h.RemoveAt(h.Count - 1); h.Add(q); }
    h.RemoveAt(h.Count - 1);
    return h.ToArray();
}

// Ray-cast point-in-polygon test (world XY).
static bool PointInPoly((double x, double y)[] poly, double px, double py)
{
    var inside = false;
    for (int i = 0, j = poly.Length - 1; i < poly.Length; j = i++)
        if ((poly[i].y > py) != (poly[j].y > py) && px < (poly[j].x - poly[i].x) * (py - poly[i].y) / (poly[j].y - poly[i].y) + poly[i].x)
            inside = !inside;
    return inside;
}
