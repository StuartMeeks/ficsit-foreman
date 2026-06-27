/**
 * Resolves Unreal Engine class-reference strings to clean short class names.
 *
 * Two encodings appear in the docs file:
 *   1. `mProducedIn` — a tuple of bare quoted paths:
 *      `("/Game/…/Build_ConstructorMk1.Build_ConstructorMk1_C","/Script/…")`
 *   2. `mRecipes` / `mItemDescriptors` — a tuple of nested BlueprintGeneratedClass
 *      references: `("/Script/Engine.BlueprintGeneratedClass'/Game/…/Recipe_X.Recipe_X_C'")`
 *
 * Both reduce to "find the class-name tokens", so a single tolerant extractor
 * covers them: a class name is the final `.`-separated segment, and the real
 * tokens of interest end in `_C`.
 */

const CLASS_TOKEN = /\b([A-Za-z][A-Za-z0-9_]*_C)\b/g;

/**
 * Extracts every `*_C` class-name token from a raw class-reference string,
 * de-duplicated and order-preserving. Works for both encodings above.
 */
export function extractClassNames(raw: string): string[] {
  if (!raw) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of raw.matchAll(CLASS_TOKEN)) {
    const name = match[1];
    if (name !== undefined && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/**
 * Best-effort human-readable name for a class, used as a display-name fallback
 * when a class is referenced but has no authored game-data name. Strips the common
 * Unreal prefixes/suffixes (including save-instance forms — `_UAID_…`, `_C_<n>`,
 * and `Schematic`/`GP`/`Char`/`Research`/`Alternate` prefixes) and spaces out the
 * remaining camel case. Returns the original class name if nothing readable
 * remains. e.g. `Desc_IronPlate_C` → "Iron Plate", `Recipe_Alternate_Wire_1_C` →
 * "Wire 1", `Research_Caterium_C` → "Caterium".
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
