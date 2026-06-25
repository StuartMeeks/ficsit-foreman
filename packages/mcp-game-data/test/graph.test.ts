import { beforeAll, describe, expect, it } from 'vitest';

import { parseGameData } from '@foreman/game-data-core';
import { GraphDB, initGraph } from '../src/graph/index.js';
import { FIXTURE_VERSION, rawDocs } from '../../game-data-core/test/fixtures/docs.js';

let graph: GraphDB;

beforeAll(async () => {
  const { gameData } = parseGameData(rawDocs, FIXTURE_VERSION);
  graph = await initGraph(gameData);
});

describe('ingredient_tree', () => {
  it('returns a flat, correct breakdown with machine counts for Reinforced Iron Plate @ 5/min', async () => {
    const tree = await graph.ingredientTree('Reinforced Iron Plate', 5);
    expect(tree?.recipe).toBe('Reinforced Iron Plate');
    expect(tree?.machine).toBe('Assembler');
    expect(tree?.machineCount).toBe(1);

    const find = (cn: string) => tree?.components.find((c) => c.itemClassName === cn);
    expect(find('Desc_IronIngot_C')).toMatchObject({
      perMinute: 60,
      machine: 'Smelter',
      machineCount: 2,
    });
    expect(find('Desc_IronPlate_C')).toMatchObject({ perMinute: 30, machineCount: 1.5 });
    expect(find('Desc_IronScrew_C')).toMatchObject({ perMinute: 60, machineCount: 1.5 });
    expect(find('Desc_OreIron_C')).toMatchObject({ perMinute: 60, isRaw: true });
  });

  it('honours a recipe choice override (Bolted Iron Plate)', async () => {
    const tree = await graph.ingredientTree('Reinforced Iron Plate', 15, {
      'Reinforced Iron Plate': 'Alternate: Bolted Iron Plate',
    });
    expect(tree?.recipe).toBe('Alternate: Bolted Iron Plate');
  });
});

describe('total_raw_inputs', () => {
  it('terminates at raw resource leaves for Reinforced Iron Plate', async () => {
    const result = await graph.totalRawInputs('Reinforced Iron Plate', 5);
    expect(result?.rawInputs).toEqual([
      { item: 'Iron Ore', itemClassName: 'Desc_OreIron_C', perMinute: 60, unit: 'items' },
    ]);
  });

  it('reports fluid raw inputs in m³ (Plastic → Crude Oil)', async () => {
    const result = await graph.totalRawInputs('Plastic', 20);
    expect(result?.rawInputs).toEqual([
      { item: 'Crude Oil', itemClassName: 'Desc_LiquidOil_C', perMinute: 30, unit: 'm³' },
    ]);
  });
});

describe('full_production_line', () => {
  it('costs production machines (exact), extraction, and estimated logistics', async () => {
    const line = await graph.fullProductionLine('Reinforced Iron Plate', 5);
    expect(line).toBeDefined();

    // Production machines: exact, every tier, whole-machine counts ≥ exact.
    const buildings = line!.productionMachines.map((m) => m.building);
    expect(buildings).toContain('Assembler');
    expect(buildings).toContain('Smelter');
    expect(buildings).toContain('Constructor');
    for (const m of line!.productionMachines) {
      expect(m.count).toBeGreaterThanOrEqual(Math.ceil(m.exactCount));
      expect(m.buildCost.length).toBeGreaterThan(0);
    }

    // Extraction: a miner for the iron ore leaf.
    const miner = line!.extraction.find((e) => e.resource === 'Iron Ore');
    expect(miner?.building).toBe('Miner Mk.1');
    expect(miner!.count).toBeGreaterThanOrEqual(1);

    // Logistics: estimated belts + splitters + mergers, all flagged.
    const kinds = new Set(line!.logistics.map((l) => l.kind));
    expect(kinds.has('belt')).toBe(true);
    expect(kinds.has('splitter')).toBe(true);
    expect(kinds.has('merger')).toBe(true);
    expect(line!.logistics.every((l) => l.estimated)).toBe(true);

    // One aggregated shopping list + the estimate caveat.
    expect(line!.totalBuildCost.length).toBeGreaterThan(0);
    expect(line!.assumptions).toMatchObject({ minerMark: 1, purity: 'normal' });
    expect(line!.warnings.some((w) => w.toLowerCase().includes('estimate'))).toBe(true);
  });

  it('honours an alt-recipe choice (changes the production set)', async () => {
    const line = await graph.fullProductionLine('Reinforced Iron Plate', 15, {
      'Reinforced Iron Plate': 'Alternate: Bolted Iron Plate',
    });
    expect(line?.recipe).toBe('Alternate: Bolted Iron Plate');
  });

  it('scales miners down on a pure node vs a normal one', async () => {
    const normal = await graph.fullProductionLine('Reinforced Iron Plate', 120, {});
    const pure = await graph.fullProductionLine(
      'Reinforced Iron Plate',
      120,
      {},
      { purity: 'pure' },
    );
    const minersOf = (r: typeof normal): number =>
      r!.extraction.find((e) => e.resource === 'Iron Ore')!.count;
    expect(minersOf(pure)).toBeLessThan(minersOf(normal));
  });
});

describe('recipes_for', () => {
  it('returns all producing recipes and flags the standard one', async () => {
    const result = await graph.recipesFor('Reinforced Iron Plate');
    expect(result?.recipes).toHaveLength(2);
    const standard = result?.recipes.find((r) => r.isStandard);
    expect(standard?.className).toBe('Recipe_IronPlateReinforced_C');
    expect(result?.recipes.some((r) => r.isAlternate)).toBe(true);
  });
});

describe('buildable_with', () => {
  it('returns the transitive closure from iron ore (excluding plastic, which needs oil)', async () => {
    const buildable = await graph.buildableWith(['Iron Ore']);
    const names = buildable.map((b) => b.item);
    expect(names).toEqual(
      expect.arrayContaining([
        'Iron Ingot',
        'Iron Plate',
        'Iron Rod',
        'Screw',
        'Reinforced Iron Plate',
      ]),
    );
    expect(names).not.toContain('Plastic');
  });
});

describe('get_recipe byproducts', () => {
  it('returns both products for a byproduct recipe', () => {
    const recipe = graph.getRecipe('Plastic');
    expect(recipe?.products).toHaveLength(2);
  });
});

describe('cypher_query guard', () => {
  it('rejects mutating queries', async () => {
    const result = await graph.cypherQuery('MATCH (i:Item) DELETE i');
    expect('error' in result).toBe(true);
  });

  it('runs read-only queries', async () => {
    const result = await graph.cypherQuery(
      'MATCH (i:Item) WHERE i.isResource = true RETURN count(i) AS n',
    );
    expect('rows' in result).toBe(true);
    if ('rows' in result) {
      expect(Number(result.rows[0]?.['n'])).toBe(3);
    }
  });
});

describe('version tagging', () => {
  it('exposes the parsed game version', () => {
    expect(graph.version).toBe(FIXTURE_VERSION);
  });
});
