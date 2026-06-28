import type { ProducerLine, SaveState } from '@foreman/sf-save-data';

import type { GameDataIndex } from '../gameData.js';

/**
 * The **effective game data** seam — the single place save-specific modifiers are (or will
 * be) applied to the canonical game data before any rate reasoning. Today it is a 1:1 view
 * over {@link GameDataIndex} (recipe in/out rates, belt/pipe throughput); #172 (Advanced
 * Game Settings) will multiply its modifiers — recipe-cost ×, power ×, node purity — in
 * here, behind this same interface, so consumers never change. Consumers (the flow-network
 * builder, `find_bottlenecks`) read rates through this accessor, **never the raw index**.
 *
 * Until #172 lands, verdicts on a 1.2 save with non-default multipliers use unmultiplied
 * numbers (vanilla saves are exact) — a localised gap this seam closes, not a rework.
 */
export interface EffectiveGameData {
  /** A producer's recipe inputs, per minute, scaled by clock (inputs do not scale with somersloop). */
  requiredInputs(producer: ProducerLine): Record<string, number>;
  /** A producer's recipe outputs, per minute, scaled by clock × somersloop boost. */
  producerOutputs(producer: ProducerLine): Record<string, number>;
  /** Conveyor throughput cap (items/min) for a buildable class, or `Infinity` if not a belt. */
  conveyorCapacity(classKey: string): number;
  /** Pipe throughput cap (m³/min) for a buildable class, or `Infinity` if not a pipe. */
  pipeCapacity(classKey: string): number;
  /** Escape hatch for name resolution etc. */
  readonly raw: GameDataIndex;
}

/**
 * Builds the effective-game-data view for a save. `state` is accepted now (and reserved
 * for #172's Advanced-Game-Settings modifiers, read from `state`); for #148/#126 the view
 * is a faithful pass-through of `game`.
 */
export function getEffectiveGameData(_state: SaveState, game: GameDataIndex): EffectiveGameData {
  return {
    requiredInputs(producer) {
      const recipe =
        producer.recipeClass === undefined ? undefined : game.recipes[producer.recipeClass];
      const out: Record<string, number> = {};
      for (const ingredient of recipe?.ingredients ?? []) {
        out[ingredient.itemClassName] = ingredient.perMinute * producer.clockSpeed;
      }
      return out;
    },
    producerOutputs(producer) {
      const recipe =
        producer.recipeClass === undefined ? undefined : game.recipes[producer.recipeClass];
      const scale = producer.clockSpeed * producer.productionBoost;
      const out: Record<string, number> = {};
      for (const product of recipe?.products ?? []) {
        out[product.itemClassName] = product.perMinute * scale;
      }
      return out;
    },
    conveyorCapacity(classKey) {
      return game.buildings[classKey]?.conveyorSpeedPerMin ?? Infinity;
    },
    pipeCapacity(classKey) {
      return game.buildings[classKey]?.pipeFlowPerMin ?? Infinity;
    },
    raw: game,
  };
}
