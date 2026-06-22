/**
 * Maps a `NativeClass` short name to an internal category.
 *
 * The docs file exposes no class hierarchy, so this mapping is maintained by
 * hand. Per PARSER.md the canonical table is small, but the real file contains
 * 100+ `FGBuildable*` subclasses (foundations, walls, pipes, …). Rather than
 * warn-and-skip each one, any `FGBuildable*` class is treated as a building —
 * a deliberate, documented extension of the PARSER.md table.
 *
 * Unrecognised classes return `undefined` and are skipped with a single
 * aggregated warning by the caller.
 */

export type Category = 'item' | 'resource' | 'recipe' | 'building' | 'schematic';

/**
 * Item descriptor classes. Beyond parts, the game models equipment, weapons,
 * ammo and vehicles as inventory items with their own `NativeClass` — all are
 * craftable recipe products, so they are treated as items.
 */
const ITEM_CLASSES: ReadonlySet<string> = new Set([
  'FGItemDescriptor',
  'FGItemDescriptorBiomass',
  'FGItemDescriptorNuclearFuel',
  'FGItemDescriptorPowerBoosterFuel',
  'FGConsumableDescriptor',
  'FGConsumableEquipment',
  'FGEquipmentDescriptor',
  'FGPowerShardDescriptor',
  'FGAmmoTypeProjectile',
  'FGAmmoTypeInstantHit',
  'FGAmmoTypeSpreadshot',
  'FGVehicleDescriptor',
  'FGWeapon',
  'FGChargedWeapon',
  'FGEquipmentStunSpear',
  'FGChainsaw',
  'FGGasMask',
  'FGSuitBase',
  'FGJetPack',
  'FGHoverPack',
  'FGParachute',
  'FGJumpingStilts',
  'FGEquipmentZipline',
  'FGObjectScanner',
  'FGPortableMinerDispenser',
  'FGGolfCartDispenser',
]);

/**
 * Extracts the short class name from a `NativeClass` string using the pattern
 * `\.(\w+)'$`, e.g. `Class'/Script/FactoryGame.FGRecipe'` → `FGRecipe`.
 */
export function shortNameFromNativeClass(nativeClass: string): string {
  const match = nativeClass.match(/\.(\w+)'$/);
  return match?.[1] ?? nativeClass;
}

export function categoryFor(shortName: string): Category | undefined {
  if (shortName === 'FGRecipe') {
    return 'recipe';
  }
  if (shortName === 'FGSchematic') {
    return 'schematic';
  }
  if (shortName === 'FGResourceDescriptor') {
    return 'resource';
  }
  if (ITEM_CLASSES.has(shortName)) {
    return 'item';
  }
  if (shortName.startsWith('FGBuildable') || shortName.startsWith('FGBuilding')) {
    // Includes FGBuildableManufacturer, …ResourceExtractor, …GeneratorFuel, etc.
    // FGBuildingDescriptor entries are building descriptors, not buildings, and
    // are filtered out by the buildings extractor (it only keeps Build_* classes).
    return 'building';
  }
  return undefined;
}
