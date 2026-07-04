# Work-order quantity verification (#223)

> **Status:** Agreed design — the design of record for issue #223. Slice 1 (power
> output verification) is the first implementation; slice 2 (manufacturing advisory)
> is a tracked follow-up. Where this conflicts with older notes, this wins.

## Problem

[`docs/work-orders.md`](./work-orders.md) is the contract a work order fulfils; #220
and #222 made every game-data **name** in a plan accurate-by-construction (resolve or
reject at ingest — see [`SYSTEM_PROMPT.md`](../packages/ff-server/SYSTEM_PROMPT.md) for
the soft guidance those issues hardened). Neither touched the **quantitative** content:

- `buildSteps[].buildables[].requiredCount` — machine/buildable counts
- `recipes[].inputItems[]/outputItems[].perMinute` — per-minute rates
- `expectedOutputs[].megawatts` (kind=power) / `.perMinute` (kind=item)

These are computed by the model (ideally from `ingredient_tree` / `full_production_line` /
`list_power_generators`) and transcribed into `create_work_order`. The server never
recomputes or checks them, so a plan can name every building correctly and still be
quantitatively wrong.

**The bug that filed this issue.** A live *"1200 MW coal plant"* order shipped with **12
Coal-Powered Generators**: 12 × 75 MW = **900 MW**, not the claimed 1200 (16 are needed).
The foreman's chat reply then repeated the false 1200 MW figure. The system prompt only
*requests* tool-verified figures; nothing enforces it.

## Design decision: hybrid, confidence-scoped

Verification is split by how *certain* the ground truth is, because the two halves have
very different false-positive risk:

| Class | Ground truth | Certainty | Action |
|---|---|---|---|
| **Power output** (`megawatts` vs generators) | `Σ(requiredCount × powerProduction)` | **Deterministic** — generators can't be overclocked; `powerProduction` is fixed | **Hard reject** on under-provision |
| **Manufacturing** (machine counts, rates) | `ingredient_tree` / `full_production_line` | **Uncertain** — graph maths are 100% clock, no somersloop/modifiers; plans carry no clock info | **Advisory only** (non-blocking note) |

This is the "hybrid" of the options #223 raised: reject where we're certain, advise where
we're not. We explicitly reject **option 3 (server-computed fill)** — it fights legitimate
overclock/alt-recipe intent and is the largest change for the least clear benefit.

### Why manufacturing can't be hard-checked

`ingredientTree` / `fullProductionLine`
(`packages/sf-game-data-graph/src/graph/queries/production.ts`) compute every machine count
and rate at **100% clock speed with no somersloop and no save modifiers**. A work-order plan
carries no clock-speed field, and a pioneer legitimately overclocks (or somersloops) to
change counts. So a strict count/rate comparison would raise **false rejects** for any
non-100% plan. Alt-recipe choice *is* representable (via `recipeChoices`), but clock/
somersloop variance is not — so manufacturing figures can only ever be an advisory hint.

### Why the flow solver isn't the engine

`packages/sf-flow` (`find_bottlenecks`) reconciles steady-state flow over an **already-built
save topology** (belts, splitters, elevations; requires a `savePath`). It answers "is each
machine actually being fed", not "does this plan's stated count follow from the recipe". It
is the right tool for a *built factory*, wrong for *ingest-time plan* checking.

## Architecture

Verification is a sibling pass to `resolvePlanReferences`
(`packages/ff-server/src/tools/workOrderTools.ts`), called from `handleCreate`,
`handleRevise`, and `handleCreateChild` immediately **after** name resolution (buildables
already carry their resolved `buildingClass` by then) and **before** persist. ff-server
holds no in-process game data — all lookups go through `mcp.callTool`, exactly as #222 does.

The only channel back to the model is the tool-result `text` string (`chat.ts` pushes
`{ role: 'tool', content: outcome.text, isError }`); `WorkOrder` / `WorkOrderToolOutcome`
have no structured warnings field. Therefore:

- **Reject** = return `{ text: message, isError: true }` and do **not** persist (as
  `resolvePlanReferences` does).
- **Advisory** = persist normally, then append the discrepancy to the success `text`.

## Slice 1 — power output verification (hard reject)

`verifyPlanPower(plan, mcp)` returning `{ ok: true } | { ok: false; message }`:

1. `declaredMW` = Σ `megawatts` over `expectedOutputs` with `kind === 'power'`. None → skip.
2. One `list_power_generators` call → `className → powerProduction`, keeping only
   **fixed-output** generators (`powerProduction` set and not `variablePowerProduction`;
   Geothermal is variable and can't be count-verified).
3. `actualMW` = Σ over buildables whose resolved `buildingClass` is a fixed generator of
   `requiredCount × powerProduction`. No such buildables → **skip** (can't verify from the
   plan alone).
4. **Reject iff `actualMW + ε < declaredMW`** — the plant can't produce what it claims.
   Over-provisioning (headroom) passes. Deterministic, so `ε` is only a float guard.
5. Message is actionable (mirrors #222 rejections), e.g.:
   > Work order not created: it claims **1200 MW** but its **12× Coal-Powered Generator**
   > produce **900 MW** (75 MW each). For 1200 MW you need **16× Coal-Powered Generator**.
   > Adjust the count or the target and retry.

   For a single generator type, give the exact `ceil(declaredMW / powerProduction)`; for
   mixed types, report the gap and let the model rebalance.

**Partial-revise safety:** the check derives both sides from whatever the (patch) plan
contains; if it can't see *both* a power output and generator buildables it skips — so a
revise touching only the target, or only the buildables, is never falsely rejected.

## Slice 2 — manufacturing count/rate advisory (follow-up issue, non-blocking)

For each `expectedOutputs[kind=item]` target, recompute expected machine counts and input/
output rates via `ingredient_tree` / `full_production_line` (passing the plan's chosen
recipes as `recipeChoices`), compare to the plan's `requiredCount` / `perMinute`, and append
a **non-blocking advisory** to the success `text` when they diverge beyond a tolerance —
never reject. Filed separately after slice 1 ships.

## Out of scope

- Hard-rejecting manufacturing counts/rates (false-positive risk) — advisory only (slice 2).
- Modelling clock-speed/somersloop in the graph, or adding a plan field for it.
- Server-computed fill (option 3).
- Flow-solver / built-topology verification.
