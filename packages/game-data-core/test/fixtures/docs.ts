/**
 * Hand-crafted docs fixture covering every edge case the parser must handle.
 * Mirrors the real `en-US.json` structure (Unreal string encodings included)
 * but is small enough to reason about. The real game file is never committed.
 */

/** Builds an Unreal class reference as it appears inside mIngredients/mProduct. */
function ref(className: string): string {
  const base = className.replace(/_C$/, '');
  return `"/Script/Engine.BlueprintGeneratedClass'/Game/FactoryGame/Test/${base}.${className}'"`;
}

/** Builds the `((ItemClass=…,Amount=…),(…))` encoding from [class, amount] pairs. */
function itemAmounts(pairs: [string, number][]): string {
  return `((${pairs.map(([cn, amt]) => `ItemClass=${ref(cn)},Amount=${amt}`).join('),(')}))`;
}

/** Builds the mProducedIn tuple of bare quoted class paths. */
function producedIn(classNames: string[]): string {
  return `(${classNames.map((cn) => `"/Game/FactoryGame/Buildable/${cn.replace(/_C$/, '')}.${cn}"`).join(',')})`;
}

const BUILD_GUN = '"/Game/FactoryGame/Equipment/BuildGun/BP_BuildGun.BP_BuildGun_C"';

export const FIXTURE_VERSION = 'test-1.0';

export const rawDocs: unknown = [
  {
    NativeClass: "Class'/Script/FactoryGame.FGResourceDescriptor'",
    Classes: [
      {
        ClassName: 'Desc_OreIron_C',
        mDisplayName: 'Iron Ore',
        mDescription: 'Ore.',
        mForm: 'RF_SOLID',
        mStackSize: 'SS_HUGE',
        mCachedStackSize: 500,
        mResourceSinkPoints: '1',
      },
      {
        ClassName: 'Desc_Water_C',
        mDisplayName: 'Water',
        mDescription: 'Wet.',
        mForm: 'RF_LIQUID',
        mStackSize: 'SS_FLUID',
        mResourceSinkPoints: '0',
      },
      {
        ClassName: 'Desc_LiquidOil_C',
        mDisplayName: 'Crude Oil',
        mDescription: 'Oily.',
        mForm: 'RF_LIQUID',
        mStackSize: 'SS_FLUID',
        mResourceSinkPoints: '0',
      },
    ],
  },
  {
    NativeClass: "Class'/Script/FactoryGame.FGItemDescriptor'",
    Classes: [
      {
        ClassName: 'Desc_IronIngot_C',
        mDisplayName: 'Iron Ingot',
        mForm: 'RF_SOLID',
        mStackSize: 'SS_HUGE',
        mCachedStackSize: 100,
        mResourceSinkPoints: '2',
      },
      {
        ClassName: 'Desc_IronPlate_C',
        mDisplayName: 'Iron Plate',
        mForm: 'RF_SOLID',
        mStackSize: 'SS_BIG',
        mCachedStackSize: 200,
        mResourceSinkPoints: '6',
      },
      {
        ClassName: 'Desc_IronRod_C',
        mDisplayName: 'Iron Rod',
        mForm: 'RF_SOLID',
        mStackSize: 'SS_BIG',
        mResourceSinkPoints: '4',
      },
      {
        ClassName: 'Desc_IronScrew_C',
        mDisplayName: 'Screw',
        mForm: 'RF_SOLID',
        mStackSize: 'SS_MEDIUM',
        mResourceSinkPoints: '2',
      },
      {
        ClassName: 'Desc_IronPlateReinforced_C',
        mDisplayName: 'Reinforced Iron Plate',
        mForm: 'RF_SOLID',
        mStackSize: 'SS_MEDIUM',
        mResourceSinkPoints: '120',
      },
      {
        ClassName: 'Desc_Plastic_C',
        mDisplayName: 'Plastic',
        mForm: 'RF_SOLID',
        mStackSize: 'SS_BIG',
        mResourceSinkPoints: '75',
      },
      {
        ClassName: 'Desc_HeavyOilResidue_C',
        mDisplayName: 'Heavy Oil Residue',
        mForm: 'RF_LIQUID',
        mStackSize: 'SS_FLUID',
        mResourceSinkPoints: '0',
      },
    ],
  },
  {
    NativeClass: "Class'/Script/FactoryGame.FGBuildableManufacturer'",
    Classes: [
      { ClassName: 'Build_SmelterMk1_C', mDisplayName: 'Smelter', mPowerConsumption: '4.000000' },
      {
        ClassName: 'Build_ConstructorMk1_C',
        mDisplayName: 'Constructor',
        mPowerConsumption: '4.000000',
      },
      {
        ClassName: 'Build_AssemblerMk1_C',
        mDisplayName: 'Assembler',
        mPowerConsumption: '15.000000',
      },
      {
        ClassName: 'Build_OilRefinery_C',
        mDisplayName: 'Refinery',
        mPowerConsumption: '30.000000',
      },
      {
        ClassName: 'Build_HadronCollider_C',
        mDisplayName: 'Particle Accelerator',
        mPowerConsumption: '0.000000',
      },
    ],
  },
  {
    NativeClass: "Class'/Script/FactoryGame.FGBuildableConveyorBelt'",
    Classes: [
      {
        ClassName: 'Build_ConveyorBeltMk1_C',
        mDisplayName: 'Conveyor Belt Mk.1',
        mSpeed: '120.000000',
      },
    ],
  },
  {
    NativeClass: "Class'/Script/FactoryGame.FGBuildableResourceExtractor'",
    Classes: [
      {
        ClassName: 'Build_MinerMk1_C',
        mDisplayName: 'Miner Mk.1',
        mExtractCycleTime: '1.000000',
        mItemsPerCycle: '1',
        mAllowedResourceForms: '(RF_SOLID)',
      },
    ],
  },
  {
    NativeClass: "Class'/Script/FactoryGame.FGBuildableConveyorAttachment'",
    Classes: [
      { ClassName: 'Build_ConveyorAttachmentSplitter_C', mDisplayName: 'Conveyor Splitter' },
      { ClassName: 'Build_ConveyorAttachmentMerger_C', mDisplayName: 'Conveyor Merger' },
    ],
  },
  {
    NativeClass: "Class'/Script/FactoryGame.FGRecipe'",
    Classes: [
      {
        ClassName: 'Recipe_IngotIron_C',
        mDisplayName: 'Iron Ingot',
        mIngredients: itemAmounts([['Desc_OreIron_C', 1]]),
        mProduct: itemAmounts([['Desc_IronIngot_C', 1]]),
        mManufactoringDuration: '2.000000',
        mProducedIn: producedIn(['Build_SmelterMk1_C']),
      },
      {
        ClassName: 'Recipe_IronPlate_C',
        mDisplayName: 'Iron Plate',
        mIngredients: itemAmounts([['Desc_IronIngot_C', 3]]),
        mProduct: itemAmounts([['Desc_IronPlate_C', 2]]),
        mManufactoringDuration: '6.000000',
        mProducedIn: producedIn(['Build_ConstructorMk1_C']),
      },
      {
        ClassName: 'Recipe_IronRod_C',
        mDisplayName: 'Iron Rod',
        mIngredients: itemAmounts([['Desc_IronIngot_C', 1]]),
        mProduct: itemAmounts([['Desc_IronRod_C', 1]]),
        mManufactoringDuration: '4.000000',
        mProducedIn: producedIn(['Build_ConstructorMk1_C']),
      },
      {
        ClassName: 'Recipe_Screw_C',
        mDisplayName: 'Screw',
        mIngredients: itemAmounts([['Desc_IronRod_C', 1]]),
        mProduct: itemAmounts([['Desc_IronScrew_C', 4]]),
        mManufactoringDuration: '6.000000',
        mProducedIn: producedIn(['Build_ConstructorMk1_C']),
      },
      {
        ClassName: 'Recipe_IronPlateReinforced_C',
        mDisplayName: 'Reinforced Iron Plate',
        mIngredients: itemAmounts([
          ['Desc_IronPlate_C', 6],
          ['Desc_IronScrew_C', 12],
        ]),
        mProduct: itemAmounts([['Desc_IronPlateReinforced_C', 1]]),
        mManufactoringDuration: '12.000000',
        mProducedIn: producedIn(['Build_AssemblerMk1_C']),
      },
      {
        ClassName: 'Recipe_Alternate_BoltedIronPlate_C',
        mDisplayName: 'Alternate: Bolted Iron Plate',
        mIngredients: itemAmounts([
          ['Desc_IronPlate_C', 18],
          ['Desc_IronScrew_C', 50],
        ]),
        mProduct: itemAmounts([['Desc_IronPlateReinforced_C', 3]]),
        mManufactoringDuration: '12.000000',
        mProducedIn: producedIn(['Build_AssemblerMk1_C']),
      },
      {
        ClassName: 'Recipe_Plastic_C',
        mDisplayName: 'Plastic',
        mIngredients: itemAmounts([['Desc_LiquidOil_C', 3000]]),
        mProduct: itemAmounts([
          ['Desc_Plastic_C', 2],
          ['Desc_HeavyOilResidue_C', 1000],
        ]),
        mManufactoringDuration: '6.000000',
        mProducedIn: producedIn(['Build_OilRefinery_C']),
      },
      {
        ClassName: 'Recipe_PlutoniumPellet_C',
        mDisplayName: 'Plutonium Pellet',
        mIngredients: itemAmounts([['Desc_IronIngot_C', 1]]),
        mProduct: itemAmounts([['Desc_IronRod_C', 1]]),
        mManufactoringDuration: '60.000000',
        mProducedIn: producedIn(['Build_HadronCollider_C']),
        mVariablePowerConsumptionConstant: '250.000000',
        mVariablePowerConsumptionFactor: '500.000000',
      },
      {
        // Build-gun recipe: a build cost, NOT a production recipe.
        ClassName: 'Recipe_ConstructorMk1_C',
        mDisplayName: 'Constructor',
        mIngredients: itemAmounts([['Desc_IronPlateReinforced_C', 2]]),
        mProduct: itemAmounts([['Desc_ConstructorMk1_C', 1]]),
        mManufactoringDuration: '0.000000',
        mProducedIn: `(${BUILD_GUN})`,
      },
      {
        ClassName: 'Recipe_SmelterMk1_C',
        mDisplayName: 'Smelter',
        mIngredients: itemAmounts([['Desc_IronRod_C', 5]]),
        mProduct: itemAmounts([['Desc_SmelterMk1_C', 1]]),
        mManufactoringDuration: '0.000000',
        mProducedIn: `(${BUILD_GUN})`,
      },
      {
        ClassName: 'Recipe_AssemblerMk1_C',
        mDisplayName: 'Assembler',
        mIngredients: itemAmounts([['Desc_IronPlate_C', 8]]),
        mProduct: itemAmounts([['Desc_AssemblerMk1_C', 1]]),
        mManufactoringDuration: '0.000000',
        mProducedIn: `(${BUILD_GUN})`,
      },
      // Build-gun recipes for the logistics buildings (#66 costing).
      {
        ClassName: 'Recipe_MinerMk1_C',
        mDisplayName: 'Miner Mk.1',
        mIngredients: itemAmounts([['Desc_IronPlate_C', 10]]),
        mProduct: itemAmounts([['Desc_MinerMk1_C', 1]]),
        mManufactoringDuration: '0.000000',
        mProducedIn: `(${BUILD_GUN})`,
      },
      {
        ClassName: 'Recipe_ConveyorBeltMk1_C',
        mDisplayName: 'Conveyor Belt Mk.1',
        mIngredients: itemAmounts([['Desc_IronPlate_C', 1]]),
        mProduct: itemAmounts([['Desc_ConveyorBeltMk1_C', 1]]),
        mManufactoringDuration: '0.000000',
        mProducedIn: `(${BUILD_GUN})`,
      },
      {
        ClassName: 'Recipe_ConveyorAttachmentSplitter_C',
        mDisplayName: 'Conveyor Splitter',
        mIngredients: itemAmounts([['Desc_IronPlate_C', 2]]),
        mProduct: itemAmounts([['Desc_ConveyorAttachmentSplitter_C', 1]]),
        mManufactoringDuration: '0.000000',
        mProducedIn: `(${BUILD_GUN})`,
      },
      {
        ClassName: 'Recipe_ConveyorAttachmentMerger_C',
        mDisplayName: 'Conveyor Merger',
        mIngredients: itemAmounts([['Desc_IronPlate_C', 2]]),
        mProduct: itemAmounts([['Desc_ConveyorAttachmentMerger_C', 1]]),
        mManufactoringDuration: '0.000000',
        mProducedIn: `(${BUILD_GUN})`,
      },
      {
        // Malformed: must be skipped/handled without throwing.
        ClassName: 'Recipe_Broken_C',
        mDisplayName: 'Broken Recipe',
        mIngredients: 'totally not valid',
        mProduct: '',
        mManufactoringDuration: 'NaN',
        mProducedIn: '',
      },
    ],
  },
  {
    NativeClass: "Class'/Script/FactoryGame.FGSchematic'",
    Classes: [
      {
        ClassName: 'Schematic_Tier0_Plates_C',
        mDisplayName: 'Plate Production',
        mType: 'EST_Milestone',
        mTechTier: 0,
        mCost: itemAmounts([['Desc_IronRod_C', 10]]),
        mUnlocks: [
          {
            Class: 'BP_UnlockRecipe_C',
            mRecipes: `(${ref('Recipe_IronPlate_C')},${ref('Recipe_ConstructorMk1_C')})`,
          },
          { Class: 'BP_UnlockItemDescriptor_C', mItemDescriptors: `(${ref('Desc_IronPlate_C')})` },
        ],
      },
    ],
  },
  {
    // Unrecognised class — must be skipped with a warning, never thrown.
    NativeClass: "Class'/Script/FactoryGame.FGFooBar'",
    Classes: [{ ClassName: 'Foo_C', mDisplayName: 'Foo' }],
  },
];
