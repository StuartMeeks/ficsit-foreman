import { describe, expect, it } from 'vitest';

import { buildingFromRaw } from '../src/parser/extractors/buildings.js';
import { parseGameData } from '../src/parser/index.js';
import type { RawClass } from '../src/parser/types.js';
import { FIXTURE_VERSION, rawDocs } from './fixtures/docs.js';

const { gameData, parseWarnings } = parseGameData(rawDocs, FIXTURE_VERSION);

describe('item extraction', () => {
  it('resolves stack size from mCachedStackSize and the SS_ enum', () => {
    expect(gameData.items['Desc_IronPlate_C']?.stackSize).toBe(200); // cached
    expect(gameData.items['Desc_IronRod_C']?.stackSize).toBe(200); // SS_BIG enum
    expect(gameData.resources['Desc_Water_C']?.stackSize).toBe(0); // SS_FLUID
  });

  it('maps form and sink points, and flags resources', () => {
    expect(gameData.items['Desc_IronPlate_C']?.form).toBe('solid');
    expect(gameData.items['Desc_IronPlate_C']?.sinkPoints).toBe(6);
    expect(gameData.resources['Desc_Water_C']?.form).toBe('liquid');
    expect(gameData.resources['Desc_OreIron_C']?.isResource).toBe(true);
    expect(gameData.items['Desc_IronPlate_C']?.isResource).toBe(false);
  });
});

describe('recipe extraction', () => {
  const rip = gameData.recipes['Recipe_IronPlateReinforced_C'];
  const bolted = gameData.recipes['Recipe_Alternate_BoltedIronPlate_C'];

  it('extracts ingredients, products, machine and per-minute rates', () => {
    expect(rip?.producedIn).toEqual(['Assembler']);
    expect(rip?.craftTime).toBe(12);
    const plate = rip?.ingredients.find((i) => i.itemClassName === 'Desc_IronPlate_C');
    expect(plate?.amount).toBe(6);
    expect(plate?.perMinute).toBe(30);
    const product = rip?.products[0];
    expect(product?.itemClassName).toBe('Desc_IronPlateReinforced_C');
    expect(product?.perMinute).toBe(5);
  });

  it('detects alternate recipes', () => {
    expect(rip?.isAlternate).toBe(false);
    expect(bolted?.isAlternate).toBe(true);
  });

  it('converts fluids to m³ and preserves byproducts', () => {
    const plastic = gameData.recipes['Recipe_Plastic_C'];
    const crude = plastic?.ingredients[0];
    expect(crude?.unit).toBe('m³');
    expect(crude?.amount).toBe(3);
    expect(crude?.perMinute).toBe(30);
    expect(plastic?.products).toHaveLength(2); // Plastic + Heavy Oil Residue byproduct
    const residue = plastic?.products.find((p) => p.itemClassName === 'Desc_HeavyOilResidue_C');
    expect(residue?.unit).toBe('m³');
    expect(residue?.amount).toBe(1);
  });

  it('captures variable power and excludes it for normal recipes', () => {
    expect(gameData.recipes['Recipe_PlutoniumPellet_C']?.variablePower).toEqual({
      min: 250,
      max: 750,
    });
    expect(rip?.variablePower).toBeUndefined();
  });

  it('keeps build-gun recipes out of production recipes', () => {
    expect(gameData.recipes['Recipe_ConstructorMk1_C']).toBeUndefined();
  });
});

describe('build costs', () => {
  it('attaches build cost to the building via the Desc_→Build_ heuristic', () => {
    expect(gameData.buildings['Build_ConstructorMk1_C']?.buildCost).toEqual([
      { itemClassName: 'Desc_IronPlateReinforced_C', amount: 2 },
    ]);
  });
});

describe('logistics throughput (#66)', () => {
  const noItems = new Map();
  const build = (raw: RawClass, shortName: string) => buildingFromRaw(raw, shortName, noItems);

  it('derives conveyor speed (items/min = mSpeed / 2)', () => {
    expect(
      build(
        { ClassName: 'Build_ConveyorBeltMk1_C', mSpeed: '120.000000' },
        'FGBuildableConveyorBelt',
      ).conveyorSpeedPerMin,
    ).toBe(60);
    expect(
      build(
        { ClassName: 'Build_ConveyorBeltMk3_C', mSpeed: '540.000000' },
        'FGBuildableConveyorBelt',
      ).conveyorSpeedPerMin,
    ).toBe(270);
  });

  it('derives pipe flow (m³/min = mFlowLimit * 60)', () => {
    expect(
      build({ ClassName: 'Build_Pipeline_C', mFlowLimit: '5.000000' }, 'FGBuildablePipeline')
        .pipeFlowPerMin,
    ).toBe(300);
  });

  it('derives miner extraction rate (items/min) for solids', () => {
    const miner = build(
      {
        ClassName: 'Build_MinerMk1_C',
        mExtractCycleTime: '1.000000',
        mItemsPerCycle: '1',
        mAllowedResourceForms: '(RF_SOLID)',
      },
      'FGBuildableResourceExtractor',
    );
    expect(miner.extractionRatePerMin).toBe(60);
  });

  it('derives fluid extractor rate in m³/min (÷1000 for liquids)', () => {
    const pump = build(
      {
        ClassName: 'Build_WaterPump_C',
        mExtractCycleTime: '1.000000',
        mItemsPerCycle: '2000',
        mAllowedResourceForms: '(RF_LIQUID)',
      },
      'FGBuildableWaterPump',
    );
    expect(pump.extractionRatePerMin).toBe(120);
  });

  it('leaves the fields undefined for non-logistics buildings', () => {
    const b = build(
      { ClassName: 'Build_AssemblerMk1_C', mPowerConsumption: '15' },
      'FGBuildableManufacturer',
    );
    expect(b.conveyorSpeedPerMin).toBeUndefined();
    expect(b.pipeFlowPerMin).toBeUndefined();
    expect(b.extractionRatePerMin).toBeUndefined();
  });
});

describe('schematic extraction', () => {
  const schematic = gameData.schematics['Schematic_Tier0_Plates_C'];

  it('maps type and tier and parses cost', () => {
    expect(schematic?.type).toBe('milestone');
    expect(schematic?.tier).toBe(0);
    expect(schematic?.cost).toEqual([
      expect.objectContaining({ itemClassName: 'Desc_IronRod_C', amount: 10 }),
    ]);
  });

  it('splits unlocks into recipes, buildings and items', () => {
    expect(schematic?.unlocksRecipes).toContain('Recipe_IronPlate_C');
    expect(schematic?.unlocksBuildings).toContain('Build_ConstructorMk1_C'); // via build recipe
    expect(schematic?.unlocksItems).toContain('Desc_IronPlate_C');
  });
});

describe('error handling', () => {
  it('collects warnings without throwing on bad entries or unknown classes', () => {
    expect(parseWarnings.some((w) => w.includes('FGFooBar'))).toBe(true);
    // The malformed recipe is retained but yields no ingredients/products.
    expect(gameData.recipes['Recipe_Broken_C']?.ingredients).toEqual([]);
  });
});
