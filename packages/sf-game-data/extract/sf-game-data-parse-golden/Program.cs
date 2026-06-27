using System.Text.Json;
using SfGameData.Parse;

// Usage: sf-game-data-parse-golden <en-US.json> <out.json>
// Parses the docs file with the C# parser and writes the ParseResult as JSON for
// the golden-diff against the TypeScript parser. Version/build are fixed so the
// only non-deterministic field is gameData.parsedAt, which the comparer ignores.
if (args.Length < 2)
{
    Console.Error.WriteLine("usage: sf-game-data-parse-golden <en-US.json> <out.json>");
    return 1;
}

var inputPath = args[0];
var outputPath = args[1];

var result = DocsReader.ParseDocsFile(inputPath, "GOLDEN", 0);
var json = JsonSerializer.Serialize(result, ParseJson.Options).Replace("\r\n", "\n");
File.WriteAllText(outputPath, json);

var data = result.GameData;
Console.WriteLine(
    $"parsed items={data.Items.Count} resources={data.Resources.Count} recipes={data.Recipes.Count} "
    + $"buildings={data.Buildings.Count} schematics={data.Schematics.Count}");
Console.WriteLine($"written -> {outputPath}");
return 0;
