import { describe, expect, it } from 'vitest';

import { parseItemAmountList } from '../src/parser/normalise/ingredients.js';
import { extractClassNames, humaniseClassName } from '@foreman/sf-core';
import { perMinute, toDisplayAmount } from '../src/parser/normalise/fluids.js';

const single =
  '((ItemClass="/Script/Engine.BlueprintGeneratedClass\'/Game/FactoryGame/X/Desc_IronIngot.Desc_IronIngot_C\'",Amount=3))';
const byproduct =
  '((ItemClass="/Script/Engine.BlueprintGeneratedClass\'/Game/X/Desc_Plastic.Desc_Plastic_C\'",Amount=2),(ItemClass="/Script/Engine.BlueprintGeneratedClass\'/Game/X/Desc_HeavyOilResidue.Desc_HeavyOilResidue_C\'",Amount=1000))';

describe('parseItemAmountList', () => {
  it('parses a single item/amount entry', () => {
    expect(parseItemAmountList(single)).toEqual([{ className: 'Desc_IronIngot_C', amount: 3 }]);
  });

  it('parses multiple entries (byproducts)', () => {
    expect(parseItemAmountList(byproduct)).toEqual([
      { className: 'Desc_Plastic_C', amount: 2 },
      { className: 'Desc_HeavyOilResidue_C', amount: 1000 },
    ]);
  });

  it('returns [] for empty or malformed input', () => {
    expect(parseItemAmountList('')).toEqual([]);
    expect(parseItemAmountList('garbage')).toEqual([]);
    expect(parseItemAmountList('(())')).toEqual([]);
  });
});

describe('extractClassNames', () => {
  it('extracts building classes from a mProducedIn tuple', () => {
    const raw =
      '("/Game/FactoryGame/Buildable/Build_ConstructorMk1.Build_ConstructorMk1_C","/Game/X/BP_WorkBenchComponent.BP_WorkBenchComponent_C","/Script/FactoryGame.FGBuildableAutomatedWorkBench")';
    expect(extractClassNames(raw)).toEqual(['Build_ConstructorMk1_C', 'BP_WorkBenchComponent_C']);
  });

  it('extracts recipe classes from a nested mRecipes tuple, de-duplicated', () => {
    const raw =
      '("/Script/Engine.BlueprintGeneratedClass\'/Game/X/Recipe_IronPlate.Recipe_IronPlate_C\'","/Script/Engine.BlueprintGeneratedClass\'/Game/X/Recipe_IronRod.Recipe_IronRod_C\'")';
    expect(extractClassNames(raw)).toEqual(['Recipe_IronPlate_C', 'Recipe_IronRod_C']);
  });

  it('returns [] for empty input', () => {
    expect(extractClassNames('')).toEqual([]);
  });
});

describe('humaniseClassName', () => {
  it('strips prefixes/suffixes and spaces camel case', () => {
    expect(humaniseClassName('Desc_IronPlateReinforced_C')).toBe('Iron Plate Reinforced');
    expect(humaniseClassName('Build_ConstructorMk1_C')).toBe('Constructor Mk1');
  });
});

describe('fluids', () => {
  it('converts fluid amounts to m³ and leaves solids as items', () => {
    expect(toDisplayAmount(3000, 'liquid')).toEqual({ amount: 3, unit: 'm³' });
    expect(toDisplayAmount(100, 'gas')).toEqual({ amount: 0.1, unit: 'm³' });
    expect(toDisplayAmount(2, 'solid')).toEqual({ amount: 2, unit: 'items' });
  });

  it('computes per-minute rates and guards against zero duration', () => {
    expect(perMinute(2, 6)).toBe(20);
    expect(perMinute(3, 6)).toBe(30);
    expect(perMinute(5, 0)).toBe(0);
  });
});
