using SfMapRenderer.Flora;

using Xunit;

namespace SfMapRenderer.Tests;

public class TreeSectionClassifierTests
{
    [Theory]
    [InlineData("M_TitanTree_Leaf", true)]
    [InlineData("Branches_01", true)]
    [InlineData("Canopy", true)]
    [InlineData("SM_Mushroom_Cap", true)]
    [InlineData("Liana_Mat", true)]
    [InlineData("T_Bark", false)]
    [InlineData("Trunk_Wood", false)]
    [InlineData("Stone", false)]
    public void IdentifiesFoliageSections(string materialName, bool expected)
    {
        Assert.Equal(expected, TreeSectionClassifier.IsFoliageMaterial(materialName));
    }
}
