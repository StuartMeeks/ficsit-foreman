import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { parseDocsFile } from '@foreman/game-data-core';
import { GraphDB, initGraph } from '../src/graph/index.js';
import type { GeneratorFuel } from '@foreman/game-data-core';

/**
 * Power correctness is critical, so these assert against the committed bundled
 * stable data (real game numbers), not a fixture. Every figure is a known-good
 * in-game value — a future data update that breaks the maths will fail here.
 */
const dataPath = fileURLToPath(
  new URL('../../game-data-core/data/stable/en-US.json', import.meta.url),
);

let graph: GraphDB;

beforeAll(async () => {
  const { gameData } = parseDocsFile(dataPath);
  graph = await initGraph(gameData);
});

const fuelFor = (fuels: GeneratorFuel[] | undefined, itemClass: string): GeneratorFuel | undefined =>
  fuels?.find((f) => f.fuel.itemClassName === itemClass);

describe('get_building — power generators', () => {
  it('Coal-Powered Generator: 75 MW, 15 coal/min, 45 m³ water/min', () => {
    const coal = graph.getBuilding('Coal-Powered Generator');
    expect(coal?.powerProduction).toBe(75);
    const onCoal = fuelFor(coal?.fuels, 'Desc_Coal_C');
    expect(onCoal?.fuel.perMinute).toBe(15);
    expect(onCoal?.fuel.unit).toBe('items');
    expect(onCoal?.supplemental?.itemClassName).toBe('Desc_Water_C');
    expect(onCoal?.supplemental?.perMinute).toBe(45);
    expect(onCoal?.supplemental?.unit).toBe('m³');
    // Compacted Coal (630 MJ) burns slower.
    expect(fuelFor(coal?.fuels, 'Desc_CompactedCoal_C')?.fuel.perMinute).toBeCloseTo(7.1429, 3);
    expect(coal?.buildCost.length ?? 0).toBeGreaterThan(0);
  });

  it('Fuel-Powered Generator: 250 MW, 20 m³ fuel/min (7.5 turbofuel)', () => {
    const gen = graph.getBuilding('Fuel-Powered Generator');
    expect(gen?.powerProduction).toBe(250);
    const fuel = fuelFor(gen?.fuels, 'Desc_LiquidFuel_C');
    expect(fuel?.fuel.perMinute).toBe(20);
    expect(fuel?.fuel.unit).toBe('m³');
    expect(fuelFor(gen?.fuels, 'Desc_LiquidTurboFuel_C')?.fuel.perMinute).toBe(7.5);
  });

  it('Nuclear Power Plant: 2500 MW, 0.2 rod/min, 240 m³ water/min, 10 waste/min', () => {
    const nuke = graph.getBuilding('Nuclear Power Plant');
    expect(nuke?.powerProduction).toBe(2500);
    const rod = fuelFor(nuke?.fuels, 'Desc_NuclearFuelRod_C');
    expect(rod?.fuel.perMinute).toBe(0.2);
    expect(rod?.supplemental?.perMinute).toBe(240);
    expect(rod?.byproduct?.itemClassName).toBe('Desc_NuclearWaste_C');
    expect(rod?.byproduct?.perMinute).toBe(10);
  });

  it('Geothermal Generator: variable, geyser-dependent', () => {
    const geo = graph.getBuilding('Geothermal Generator');
    expect(geo?.variablePowerProduction).toBe(true);
    expect(geo?.powerProduction).toBeUndefined();
  });
});

describe('get_building — machine power draw', () => {
  it('reports constant draw for production machines', () => {
    expect(graph.getBuilding('Constructor')?.powerConsumption).toBe(4);
    expect(graph.getBuilding('Smelter')?.powerConsumption).toBe(4);
    expect(graph.getBuilding('Manufacturer')?.powerConsumption).toBe(55);
    expect(graph.getBuilding('Water Extractor')?.powerConsumption).toBe(20);
  });

  it('reports max draw for variable-power machines', () => {
    const pa = graph.getBuilding('Particle Accelerator');
    expect(pa?.powerConsumption).toBe(0);
    expect(pa?.maxPowerConsumption).toBe(1500);
    expect(graph.getBuilding('Quantum Encoder')?.maxPowerConsumption).toBe(2000);
  });

  it('returns undefined for an unknown building', () => {
    expect(graph.getBuilding('Dyson Sphere')).toBeUndefined();
  });
});

describe('list_power_generators', () => {
  it('lists every generator with output and fuels', () => {
    const generators = graph.listPowerGenerators();
    const names = generators.map((g) => g.displayName);
    expect(names).toContain('Coal-Powered Generator');
    expect(names).toContain('Fuel-Powered Generator');
    expect(names).toContain('Nuclear Power Plant');
    expect(names).toContain('Geothermal Generator');

    const nuke = generators.find((g) => g.displayName === 'Nuclear Power Plant');
    expect(nuke?.powerProduction).toBe(2500);
    expect((nuke?.fuels.length ?? 0)).toBeGreaterThan(0);
  });
});
