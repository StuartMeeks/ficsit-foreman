import { describe, expect, it } from 'vitest';

import { extractClassNames, humaniseClassName } from '../src/classRef.js';

describe('extractClassNames', () => {
  it('pulls de-duplicated, order-preserving *_C tokens from a class-ref string', () => {
    const raw =
      '("/Game/FactoryGame/Buildable/Factory/ConstructorMk1/Build_ConstructorMk1.Build_ConstructorMk1_C","/Script/Engine.BlueprintGeneratedClass\'/Game/.../Recipe_IronPlate.Recipe_IronPlate_C\'")';
    expect(extractClassNames(raw)).toEqual(['Build_ConstructorMk1_C', 'Recipe_IronPlate_C']);
  });

  it('returns an empty array for empty input', () => {
    expect(extractClassNames('')).toEqual([]);
  });
});

describe('humaniseClassName', () => {
  it('strips the prefix/suffix and spaces out camel case', () => {
    expect(humaniseClassName('Desc_IronPlate_C')).toBe('Iron Plate');
    expect(humaniseClassName('Build_ConstructorMk1_C')).toBe('Constructor Mk1');
  });

  it('handles save-instance and schematic/research forms', () => {
    expect(humaniseClassName('Recipe_Alternate_Wire_1_C')).toBe('Wire 1');
    expect(humaniseClassName('Schematic_3-2_C')).toBe('3-2');
    expect(humaniseClassName('Research_Caterium_C')).toBe('Caterium');
    expect(humaniseClassName('Char_Player_C_2146843713')).toBe('Player');
    expect(humaniseClassName('Build_StorageContainer_C_UAID_ABC123_99')).toBe('Storage Container');
    // Falls back to the original class name when nothing readable remains.
    expect(humaniseClassName('_C')).toBe('_C');
  });
});
