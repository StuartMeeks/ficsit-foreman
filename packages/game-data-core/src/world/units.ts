/**
 * World-coordinate units for pioneer-facing answers. The save and the
 * world-locations dataset store positions in **centimetres** (Unreal units), but
 * the in-game HUD shows **metres** (cm ÷ 100, no axis change — verified against
 * real saves). Everything the foreman says to / hears from the pioneer is in
 * metres, so MCP tools convert at their boundary with these helpers.
 */

/**
 * Centimetres → metres. A pure unit change with NO rounding, so the position is
 * preserved exactly (e.g. 128784.40625 → 1287.8440625, which JSON prints as the
 * shortest exact decimal). The foreman rounds for readability when it speaks to
 * the pioneer; the tool data itself stays exact so coordinates round-trip between
 * tool calls losslessly.
 */
export function cmToMetres(cm: number): number {
  return cm / 100;
}

/** Metres (as the pioneer/foreman speak) → centimetres (internal/dataset units). */
export function metresToCm(metres: number): number {
  return metres * 100;
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/**
 * 8-point compass bearing from an origin to a target (both in the same units;
 * sign is all that matters). Satisfactory's world axes: **+X is East, +Y is
 * South** (so North is −Y) — matching the in-game map. Returns "N", "NE", … so
 * the foreman can say "≈166 m to the north-east".
 */
export function compassBearing(
  origin: { x: number; y: number },
  target: { x: number; y: number },
): string {
  const east = target.x - origin.x;
  const south = target.y - origin.y;
  // 0° = North, increasing clockwise: atan2(East, North) with North = −south.
  let degrees = (Math.atan2(east, -south) * 180) / Math.PI;
  if (degrees < 0) {
    degrees += 360;
  }
  return COMPASS[Math.round(degrees / 45) % 8] ?? 'N';
}
