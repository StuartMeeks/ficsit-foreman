using CUE4Parse.Compression;
using CUE4Parse.Encryption.Aes;
using CUE4Parse.FileProvider;
using CUE4Parse.MappingsProvider.Usmap;
using CUE4Parse.UE4.Objects.Core.Misc;
using CUE4Parse.UE4.Versions;

namespace SfMapRenderer.Assets;

/// <summary>
/// Wraps the CUE4Parse provider over a local Satisfactory install (UE 5.6) and exposes the package
/// groups the renderer scans: the World-Partition landscape cells and the persistent level.
/// </summary>
public sealed class GameAssetProvider : IDisposable
{
    private readonly DefaultFileProvider _provider;

    public GameAssetProvider(string paksDirectory, string usmapPath)
    {
        OodleHelper.DownloadOodleDll();
        OodleHelper.Initialize();

        _provider = new DefaultFileProvider(paksDirectory, SearchOption.TopDirectoryOnly, new VersionContainer(EGame.GAME_UE5_6));
        _provider.MappingsContainer = new FileUsmapTypeMappingsProvider(usmapPath);
        _provider.Initialize();
        _provider.SubmitKey(new FGuid(), new FAesKey(new byte[32]));
    }

    public DefaultFileProvider Provider => _provider;

    public int FileCount => _provider.Files.Count;

    /// <summary>World-Partition landscape tiles: <c>.../_Generated_/*.umap</c>.</summary>
    public List<string> GeneratedCellPackages() =>
        [.. _provider.Files.Keys.Where(k => k.Contains("/_Generated_/", StringComparison.Ordinal) && k.EndsWith(".umap", StringComparison.Ordinal))];

    /// <summary>The persistent level only (water volumes, rivers, ocean planes): GameLevel01, excluding cells.</summary>
    public List<string> PersistentLevelPackages() =>
        [.. _provider.Files.Keys.Where(k => k.Contains("/GameLevel01/", StringComparison.Ordinal) && k.EndsWith(".umap", StringComparison.Ordinal) && !k.Contains("/_Generated_/", StringComparison.Ordinal))];

    /// <summary>Every GameLevel01 package including cells (used by the pickup/object probes).</summary>
    public List<string> AllGameLevelPackages() =>
        [.. _provider.Files.Keys.Where(k => k.Contains("/GameLevel01/", StringComparison.Ordinal) && k.EndsWith(".umap", StringComparison.Ordinal))];

    public void Dispose() => _provider.Dispose();
}
