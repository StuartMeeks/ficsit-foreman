import type { GameData } from '../parser/types.js';

/**
 * Resolves a user-supplied name (display name, case-insensitive, or exact class
 * name) to a canonical class name. Built once from `GameData` so the foreman
 * never needs to know internal class names.
 */
export class Resolver {
  private readonly items = new Map<string, string>();
  private readonly recipes = new Map<string, string>();
  private readonly buildings = new Map<string, string>();
  private readonly schematics = new Map<string, string>();

  constructor(gameData: GameData) {
    for (const item of [...Object.values(gameData.items), ...Object.values(gameData.resources)]) {
      this.index(this.items, item.className, item.displayName);
    }
    for (const recipe of Object.values(gameData.recipes)) {
      this.index(this.recipes, recipe.className, recipe.displayName);
    }
    for (const building of Object.values(gameData.buildings)) {
      this.index(this.buildings, building.className, building.displayName);
    }
    for (const schematic of Object.values(gameData.schematics)) {
      this.index(this.schematics, schematic.className, schematic.displayName);
    }
  }

  private index(map: Map<string, string>, className: string, displayName: string): void {
    map.set(className.toLowerCase(), className);
    if (displayName !== '') {
      // Do not overwrite a display-name collision already mapped (first wins).
      const key = displayName.toLowerCase();
      if (!map.has(key)) {
        map.set(key, className);
      }
    }
  }

  public resolveItem(name: string): string | undefined {
    return this.items.get(name.toLowerCase());
  }

  public resolveRecipe(name: string): string | undefined {
    return this.recipes.get(name.toLowerCase());
  }

  public resolveBuilding(name: string): string | undefined {
    return this.buildings.get(name.toLowerCase());
  }

  public resolveSchematic(name: string): string | undefined {
    return this.schematics.get(name.toLowerCase());
  }
}
