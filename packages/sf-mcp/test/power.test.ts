import type { Building } from '@foreman/sf-game-data';
import { normaliseSave } from '@foreman/sf-save-data';
import { buildSaveGraph } from '@foreman/sf-save-data-graph';
import { describe, expect, it } from 'vitest';

import type { GameDataIndex } from '../src/gameData.js';
import { powerView } from '../src/query/selectors.js';
import {
  floatProp,
  makeSave,
  obj,
  objectProp,
  refArrayProp,
  vec3,
} from '../../sf-save-data/test/fixtures/save.js';

const LVL = 'Persistent_Level:PersistentLevel';

const T_FUEL_GEN =
  '/Game/FactoryGame/Buildable/Factory/GeneratorFuel/Build_GeneratorFuel.Build_GeneratorFuel_C';
const T_COAL_GEN =
  '/Game/FactoryGame/Buildable/Factory/GeneratorCoal/Build_GeneratorCoal.Build_GeneratorCoal_C';
const T_GEO_GEN =
  '/Game/FactoryGame/Buildable/Factory/GeneratorGeoThermal/Build_GeneratorGeoThermal.Build_GeneratorGeoThermal_C';
const T_CONSTRUCTOR =
  '/Game/FactoryGame/Buildable/Factory/ConstructorMk1/Build_ConstructorMk1.Build_ConstructorMk1_C';
const DESC_COAL = '/Game/FactoryGame/Resource/RawResources/Coal/Desc_Coal.Desc_Coal_C';
const DESC_FUEL = '/Game/FactoryGame/Resource/Parts/LiquidFuel/Desc_LiquidFuel.Desc_LiquidFuel_C';

const GEN_FUEL = `${LVL}.GenFuel_1`;
const GEN_COAL = `${LVL}.GenCoal_1`;
const GEN_GEO = `${LVL}.GenGeo_1`;
const CON = `${LVL}.Con_1`;

// One circuit: a fuel generator (250 MW), a coal generator overclocked to 200% (75 ×
// 2 = 150 MW, exercising the LINEAR clock scaling), a geothermal (variable), and one
// constructor consumer (4 MW). All wired onto power circuit 7.
const POWER_SAVE = makeSave({
  objects: [
    obj(T_FUEL_GEN, { mCurrentFuelClass: objectProp(DESC_FUEL) }, { instanceName: GEN_FUEL }),
    obj(
      T_COAL_GEN,
      { mCurrentPotential: floatProp(2.0), mCurrentFuelClass: objectProp(DESC_COAL) },
      { instanceName: GEN_COAL },
    ),
    obj(T_GEO_GEN, {}, { instanceName: GEN_GEO }),
    obj(T_CONSTRUCTOR, {}, { instanceName: CON, transform: vec3(100, 0, 0) }),
    obj(
      '/Script/FactoryGame.FGPowerCircuit',
      {
        mCircuitID: { type: 'IntProperty', value: 7 },
        mComponents: refArrayProp([
          `${GEN_FUEL}.PowerConnection`,
          `${GEN_COAL}.PowerConnection`,
          `${GEN_GEO}.PowerConnection`,
          `${CON}.PowerConnection`,
        ]),
      },
      { instanceName: `${LVL}.CircuitSubsystem.FGPowerCircuit_1` },
    ),
  ],
});

const GAME: GameDataIndex = {
  displayNames: new Map([
    ['Build_GeneratorFuel_C', 'Fuel Generator'],
    ['Build_GeneratorCoal_C', 'Coal Generator'],
    ['Build_GeneratorGeoThermal_C', 'Geothermal Generator'],
    ['Build_ConstructorMk1_C', 'Constructor'],
    ['Desc_Coal_C', 'Coal'],
    ['Desc_LiquidFuel_C', 'Fuel'],
  ]),
  recipes: {},
  buildings: {
    Build_GeneratorFuel_C: {
      className: 'Build_GeneratorFuel_C',
      displayName: 'Fuel Generator',
      description: '',
      category: 'power',
      powerConsumption: 0,
      powerProduction: 250,
      buildCost: [],
    } satisfies Building,
    Build_GeneratorCoal_C: {
      className: 'Build_GeneratorCoal_C',
      displayName: 'Coal Generator',
      description: '',
      category: 'power',
      powerConsumption: 0,
      powerProduction: 75,
      buildCost: [],
    } satisfies Building,
    Build_GeneratorGeoThermal_C: {
      className: 'Build_GeneratorGeoThermal_C',
      displayName: 'Geothermal Generator',
      description: '',
      category: 'power',
      powerConsumption: 0,
      variablePowerProduction: true,
      buildCost: [],
    } satisfies Building,
    Build_ConstructorMk1_C: {
      className: 'Build_ConstructorMk1_C',
      displayName: 'Constructor',
      description: '',
      category: 'production',
      powerConsumption: 4,
      buildCost: [],
    } satisfies Building,
  },
};

const { state } = normaliseSave(POWER_SAVE, '2026-01-01T00:00:00.000Z');
const graph = buildSaveGraph(state);
const view = powerView(state, graph, GAME);

describe('powerView (#68)', () => {
  it('sums one circuit: fixed capacity vs estimated draw, with a balance and status', () => {
    expect(view.circuits).toHaveLength(1);
    expect(view.circuits[0]).toMatchObject({
      circuitId: 7,
      generatorCount: 3,
      capacityMW: 400, // 250 (fuel) + 150 (coal @200%, LINEAR) — geothermal excluded
      hasVariableGenerators: true,
      consumerCount: 1,
      consumptionMW: 4, // constructor at 100% (4 MW)
      balanceMW: 396,
      status: 'ok',
    });
  });

  it('scales generator output linearly with clock (coal @200% = 150, not the consumer exponent)', () => {
    const coal = view.generators.find((g) => g.buildingClass === 'Build_GeneratorCoal_C');
    expect(coal?.capacityMW).toBe(150);
  });

  it('rolls up generators by type with their loaded fuel; geothermal is variable', () => {
    const geo = view.generators.find((g) => g.buildingClass === 'Build_GeneratorGeoThermal_C');
    expect(geo).toMatchObject({ count: 1, capacityMW: 0, variableOutput: true, fuels: [] });
    const fuel = view.generators.find((g) => g.buildingClass === 'Build_GeneratorFuel_C');
    expect(fuel).toMatchObject({ count: 1, capacityMW: 250, fuels: ['Fuel'] });
    const coal = view.generators.find((g) => g.buildingClass === 'Build_GeneratorCoal_C');
    expect(coal?.fuels).toEqual(['Coal']);
  });

  it('reports factory-wide totals', () => {
    expect(view.generatorCount).toBe(3);
    expect(view.totalCapacityMW).toBe(400);
    expect(view.totalConsumptionMW).toBe(4);
  });

  it('flags an overloaded grid when draw exceeds fixed capacity', () => {
    // A circuit with only the constructor (4 MW) and no generation.
    const drained = makeSave({
      objects: [
        obj(T_CONSTRUCTOR, {}, { instanceName: CON, transform: vec3(0, 0, 0) }),
        obj(
          '/Script/FactoryGame.FGPowerCircuit',
          {
            mCircuitID: { type: 'IntProperty', value: 9 },
            mComponents: refArrayProp([`${CON}.PowerConnection`]),
          },
          { instanceName: `${LVL}.CircuitSubsystem.FGPowerCircuit_2` },
        ),
      ],
    });
    const ds = normaliseSave(drained, '2026-01-01T00:00:00.000Z').state;
    const dv = powerView(ds, buildSaveGraph(ds), GAME);
    expect(dv.circuits[0]).toMatchObject({ capacityMW: 0, consumptionMW: 4, status: 'overloaded' });
  });
});
