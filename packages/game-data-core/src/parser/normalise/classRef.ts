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
 * when an item is referenced but not present in the parsed data. Strips the
 * common `Desc_`/`Recipe_`/`Build_` prefix and `_C` suffix and spaces out the
 * remaining camel case.
 */
export function humaniseClassName(className: string): string {
  const stripped = className
    .replace(/^(Desc|Recipe|Build|BP)_/, '')
    .replace(/_C$/, '')
    .replace(/_/g, ' ');
  return stripped.replace(/([a-z])([A-Z])/g, '$1 $2').trim();
}
