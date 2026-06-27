import { describe, expect, it } from 'vitest';

import { extractClassNames } from '../src/classRef.js';

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
