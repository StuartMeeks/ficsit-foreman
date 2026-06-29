import {
  GAME_STATE,
  NODE_PURITY_SETTINGS_PROP,
  NODE_RANDOMIZATION_PROP,
  POWER_CONSUMPTION_MULT_PROP,
  PURITY_OVERRIDE_PROP,
  RECIPE_COST_MULT_PROP,
  RESOURCE_CLASS_OVERRIDE_PROP,
  RESOURCE_NODE_ACTOR,
  SPACE_ELEVATOR_COST_MULT_PROP,
  WORLD_SEED_PROP,
} from '../constants.js';
import type { RawObject } from '../parser/types.js';
import { classNameFromPath } from './classRef.js';
import {
  DEFAULT_ADVANCED_GAME_SETTINGS,
  type AdvancedGameSettings,
  type NodePuritySetting,
  type NodeRandomizationMode,
  type ResourceNodeOverride,
  type ResourcePurity,
} from './types.js';
import { enumField, numberField, propMap, refField, translation, type Warnings } from './util.js';

export interface GameSettingsResult {
  advancedGameSettings: AdvancedGameSettings;
  resourceNodeOverrides: ResourceNodeOverride[];
}

const NODE_RANDOMIZATION_MODES = new Set<string>([
  'None',
  'Strict',
  'BasicReach',
  'AdvancedRich',
  'FossilFuelRich',
]);

const NODE_PURITY_SETTINGS = new Set<string>([
  'NoChange',
  'AllPure',
  'Increase',
  'AllNormal',
  'Decrease',
  'AllImpure',
  'AllRandom',
]);

/** `EResourcePurity` → our normalised purity (note the game's `RP_Inpure` spelling). */
const PURITY_BY_LITERAL: Record<string, ResourcePurity> = {
  RP_Inpure: 'impure',
  RP_Normal: 'normal',
  RP_Pure: 'pure',
};

/**
 * Parses the 1.2 **Game Modes** Advanced Game Settings from `BP_GameState_C` and the
 * resolved per-node overrides scattered across resource-node actors. Pure save facts;
 * the overlay onto canonical game-data is the edge's job. Each setting defaults
 * independently when its property is absent (the game omits defaults), so a pre-1.2 or
 * all-default save yields the canonical no-op state. See `docs/advanced-game-settings.md`.
 */
export function extractGameSettings(objects: RawObject[], warnings: Warnings): GameSettingsResult {
  return {
    advancedGameSettings: extractAdvancedGameSettings(objects, warnings),
    resourceNodeOverrides: extractResourceNodeOverrides(objects),
  };
}

function extractAdvancedGameSettings(
  objects: RawObject[],
  warnings: Warnings,
): AdvancedGameSettings {
  const gameState = objects.find((o) => GAME_STATE.test(o.typePath ?? ''));
  if (gameState === undefined) {
    return { ...DEFAULT_ADVANCED_GAME_SETTINGS };
  }
  const bag = propMap(gameState);
  return {
    worldSeed: numberField(bag, WORLD_SEED_PROP) ?? DEFAULT_ADVANCED_GAME_SETTINGS.worldSeed,
    spaceElevatorCostMultiplier:
      numberField(bag, SPACE_ELEVATOR_COST_MULT_PROP) ??
      DEFAULT_ADVANCED_GAME_SETTINGS.spaceElevatorCostMultiplier,
    recipeCostMultiplier:
      numberField(bag, RECIPE_COST_MULT_PROP) ??
      DEFAULT_ADVANCED_GAME_SETTINGS.recipeCostMultiplier,
    powerConsumptionMultiplier:
      numberField(bag, POWER_CONSUMPTION_MULT_PROP) ??
      DEFAULT_ADVANCED_GAME_SETTINGS.powerConsumptionMultiplier,
    nodeRandomization: readNodeRandomization(bag, warnings),
    nodePuritySettings: readNodePuritySettings(bag, warnings),
  };
}

/** Strips the `XXX_` enum prefix (`NRM_Strict` → `Strict`); undefined stays undefined. */
function stripPrefix(literal: string | undefined): string | undefined {
  if (literal === undefined) {
    return undefined;
  }
  const underscore = literal.indexOf('_');
  return underscore === -1 ? literal : literal.slice(underscore + 1);
}

function readNodeRandomization(
  bag: Record<string, unknown>,
  warnings: Warnings,
): NodeRandomizationMode {
  const value = stripPrefix(enumField(bag, NODE_RANDOMIZATION_PROP));
  if (value === undefined) {
    return DEFAULT_ADVANCED_GAME_SETTINGS.nodeRandomization;
  }
  if (!NODE_RANDOMIZATION_MODES.has(value)) {
    warnings.add(`Unknown ENodeRandomizationMode '${value}'; treating as default.`);
    return DEFAULT_ADVANCED_GAME_SETTINGS.nodeRandomization;
  }
  return value as NodeRandomizationMode;
}

function readNodePuritySettings(
  bag: Record<string, unknown>,
  warnings: Warnings,
): NodePuritySetting {
  const value = stripPrefix(enumField(bag, NODE_PURITY_SETTINGS_PROP));
  if (value === undefined) {
    return DEFAULT_ADVANCED_GAME_SETTINGS.nodePuritySettings;
  }
  if (!NODE_PURITY_SETTINGS.has(value)) {
    warnings.add(`Unknown ENodePuritySettings '${value}'; treating as default.`);
    return DEFAULT_ADVANCED_GAME_SETTINGS.nodePuritySettings;
  }
  return value as NodePuritySetting;
}

/**
 * The resolved type/purity each resource node carries under randomisation. Only nodes
 * that actually record an override are emitted (the properties are absent when
 * randomisation is off), so an unmodified world yields an empty list.
 */
function extractResourceNodeOverrides(objects: RawObject[]): ResourceNodeOverride[] {
  const overrides: ResourceNodeOverride[] = [];
  for (const obj of objects) {
    if (!RESOURCE_NODE_ACTOR.test(obj.typePath ?? '')) {
      continue;
    }
    const bag = propMap(obj);
    const classRef = refField(bag, RESOURCE_CLASS_OVERRIDE_PROP);
    const purityLiteral = enumField(bag, PURITY_OVERRIDE_PROP);
    if (classRef === undefined && purityLiteral === undefined) {
      continue;
    }
    overrides.push({
      position: translation(obj),
      resourceClass: classRef === undefined ? undefined : classNameFromPath(classRef),
      purity: purityLiteral === undefined ? undefined : PURITY_BY_LITERAL[purityLiteral],
    });
  }
  return overrides;
}
