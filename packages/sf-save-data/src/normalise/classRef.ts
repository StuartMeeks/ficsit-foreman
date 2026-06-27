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
