using SixLabors.Fonts;

namespace SfMapRenderer.Imaging;

/// <summary>The embedded Lato Regular face, used for the overlay and layered-artifact labels.</summary>
public static class EmbeddedFont
{
    private static readonly FontFamily Family = Load();

    public static Font At(float size) => Family.CreateFont(size, FontStyle.Regular);

    private static FontFamily Load()
    {
        var assembly = typeof(EmbeddedFont).Assembly;
        var resource = assembly.GetManifestResourceNames().First(n => n.EndsWith("Lato-Regular.ttf", StringComparison.Ordinal));
        using var stream = assembly.GetManifestResourceStream(resource)!;
        return new FontCollection().Add(stream, System.Globalization.CultureInfo.InvariantCulture);
    }
}
