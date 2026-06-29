using CUE4Parse.Compression;
using CUE4Parse.Encryption.Aes;
using CUE4Parse.FileProvider;
using CUE4Parse.MappingsProvider.Usmap;
using CUE4Parse.UE4.Objects.Core.Misc;
using CUE4Parse.UE4.Objects.UObject;
using CUE4Parse.UE4.Versions;

namespace SfGameData.Extraction;

/// <summary>
/// Throwaway investigation helper (#172 slice E): mounts the install and prints the
/// raw property layout of the project-assembly phase assets (FGGamePhase /
/// GP_Project_Assembly_Phase_*) so we can see which field holds the deliverable cost.
/// Invoked via <c>--dump-gamephases</c>; not part of the normal extraction.
/// </summary>
public static class GamePhaseDump
{
    public static void Dump(string paks, string usmap)
    {
        OodleHelper.DownloadOodleDll();
        OodleHelper.Initialize();

        var provider = new DefaultFileProvider(paks, SearchOption.TopDirectoryOnly, new VersionContainer(EGame.GAME_UE5_6));
        provider.MappingsContainer = new FileUsmapTypeMappingsProvider(usmap);
        provider.Initialize();
        provider.SubmitKey(new FGuid(), new FAesKey(new byte[32]));
        Console.WriteLine($"mounted. files = {provider.Files.Count}");

        // Find candidate phase/space-elevator assets by path.
        var keys = provider.Files.Keys
            .Where(k => k.EndsWith(".uasset") &&
                        (k.Contains("/GamePhases/") || k.Contains("GP_Project_Assembly") ||
                         k.Contains("ProjectAssembly") || k.Contains("SpaceElevator")))
            .OrderBy(k => k, StringComparer.Ordinal)
            .ToList();
        Console.WriteLine($"candidate assets = {keys.Count}");
        foreach (var k in keys) { Console.WriteLine($"  {k}"); }

        foreach (var k in keys.Where(k => k.Contains("/GamePhases/")))
        {
            try
            {
                var pkg = provider.LoadPackage(k);
                foreach (var e in pkg.GetExports().Where(x => x.ExportType == "FGGamePhase"))
                {
                    Console.WriteLine($"\n==== {k} :: {e.Name}");
                    Console.WriteLine(Newtonsoft.Json.JsonConvert.SerializeObject(e, Newtonsoft.Json.Formatting.Indented));
                }
            }
            catch (Exception ex) { Console.Error.WriteLine($"[dump] {k}: {ex.Message}"); }
        }
        Console.WriteLine("DUMP DONE");
    }
}
