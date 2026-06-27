/**
 * Resolves Unreal class/instance path strings to clean names. The save uses two
 * forms: type paths (`/Game/.../Recipe_IronPlate.Recipe_IronPlate_C`) and
 * instance names (`Persistent_Level:PersistentLevel.Char_Player_C_2146843713`).
 * `classNameFromPath` returns the final segment of either.
 */

/** The final `.`-segment of a type path or instance name. */
export function classNameFromPath(path: string): string {
  const afterColon = path.includes(':') ? path.slice(path.lastIndexOf(':') + 1) : path;
  return afterColon.includes('.') ? afterColon.slice(afterColon.lastIndexOf('.') + 1) : afterColon;
}

/**
 * A readable display name derived from a class name alone (no game-data lookup):
 * strips the Unreal prefixes/suffixes and splits camel case. e.g.
 * `Desc_IronPlate_C` → "Iron Plate", `Recipe_Alternate_Wire_1_C` → "Wire 1".
 */
export function humaniseClassName(className: string): string {
  let s = className;
  // Drop any `_UAID_…` instance suffix. Done with indexOf+slice rather than a
  // `/_UAID_.*$/` regex to keep it strictly linear on untrusted save input.
  const uaid = s.toUpperCase().indexOf('_UAID_');
  if (uaid !== -1) {
    s = s.slice(0, uaid);
  }
  s = s.replace(/_C(_\d+)?$/, '');
  s = s.replace(/^(Desc|Recipe|Build|BP|Schematic|GP|Char|Research)_/, '');
  s = s.replace(/^Alternate_/, '');
  s = s.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  s = s.replace(/_/g, ' ').trim();
  return s.length > 0 ? s : className;
}
