# Flow solver — steady-state production reconciliation (#148 + #126)

> Status: **shipped** (#148 + #126 closed). The engine and `find_bottlenecks` are live, now
> **honouring smart/programmable splitter sort-rules** (item filters / any / overflow /
> any-undefined, via the verified `outputIndex = OutputN − 1` mapping and an sf-flow edge
> `deny` list). Remaining refinement: **fluid head-lift wiring** (the data shipped as
> `Building.headLiftMetres`; the geometry wiring per §"Prerequisite for full headlift" is
> still to do). Supersedes the separate framing of #148/#126 — they are one engine.

## Problem

`get_production` reports *configured* capacity (recipe rate × clock × boost) and `get_power`
reports per-circuit balance, but neither answers the real question: **is each machine
actually getting what it needs, and if not, why?** A machine is **starved** when an input is
delivered below its required rate (even 99% counts); **backed-up** when an output exceeds
what downstream can take. Both are *rate* judgements, with a caller-supplied **tolerance**
(default ±5%) so near-balance isn't flagged.

Answering this means reconciling the whole material-flow network at steady state:
sources (extractors/producers) feed belts/pipes through splitters and mergers into machine
inputs, contended by competing consumers and capped by belt/pipe throughput; a starved
machine produces less, which propagates to *its* consumers — a feedback loop requiring a
fixed-point solve.

## Scope & non-goals

- **Steady-state rates**, not tick-level belt simulation (round-robin phase, manifold fill
  transients are out — not useful and not faithfully simulable).
- Models: source output rates, machine input demands, **belt/pipe throughput caps** (by
  tier), **smart/programmable splitter sort-rules** (slice A), plain-splitter distribution,
  merger fan-in, **shared-supply contention**, and **throughput feedback** (under-fed →
  reduced output → propagated).
- Fluids: pipe flow capacity + headlift/pump direction (the data lands as part of this work,
  per old slice C); v1 may treat pipe headlift conservatively (note any simplification).

## Architecture & layering

Three pieces, keeping the neutral libs game-data-free:

1. **`@foreman/sf-flow` — new pure solver lib.** Operates on an *abstract* flow network:
   nodes (sources with per-item output rate; sinks with per-item demand; pass-through), edges
   (directed, per-item, with a throughput cap), splitter nodes (with sort-rules), mergers.
   Input is plain numbers — **no game data, no save types** — so it is unit-testable in
   isolation and reusable. Output: delivered rate per (node, item) + per-node throughput
   fraction, converged to a fixed point.
2. **`sf-save-data-graph` (pure) — the directed-flow substrate.** Already provides edge
   orientation, belt-chain propagation, `upstreamOf`/`downstreamOf`, `splitterRulesOf`.
   Stays game-data-free.
3. **`sf-mcp` — the adapter + tool.** Builds the abstract network from the graph + the
   **effective-game-data seam** (`getEffectiveGameData`: recipe in/out rates, belt/extractor
   rates; #172 later multiplies modifiers in here), runs the solver, and shapes the
   `find_bottlenecks` response.

## Algorithm (fixed-point iteration)

```
throughput[machine] = 1 for all machines            // assume full
repeat until max change < ε (or iteration cap):
  for each source: emit item X at rate = baseOutput[X] × throughput[source]
  propagate downstream over the directed graph:
    - belts/pipes: carry min(incoming, capacity)
    - splitters: distribute by sort-rules (filtered/any/overflow); plain = even split
                 across outputs that can accept, demand-weighted
    - mergers: sum inputs
  deliveredIn[machine][X] = flow arriving at that input
  throughput'[machine] = min(1, minₓ deliveredIn[X] / requiredIn[X])
converge → delivered rates + throughput per machine
```

- **Convergence:** monotone-ish; cap iterations (e.g. 100) and ε (e.g. 0.1%). Loops/ambiguous
  direction (from the substrate's `complete=false`) → mark those machines `unknown`, never a
  false verdict.
- **Contention:** a source feeding N consumers splits by demand share; if total demand >
  supply, all downstream scale down — captured naturally by the fixed point.

## Outputs / API

- **`sf-flow`**: `solve(network, { tolerance }) → { delivered, throughput, verdicts }`.
- **`find_bottlenecks` MCP tool** (`inputSchema: { tolerance?, item?, savePath }`): per
  machine, a compact verdict — `ok` / `starved` (which input, delivered vs required, and the
  **upstream cause**: missing source / out-filtered branch / belt cap / contention) /
  `backed-up` / `unpowered` (overloaded circuit, no battery buffer — slice B) / `idle` (no
  recipe) / `unknown` (unresolved direction). Aggregated and token-conscious — **never a
  graph dump**. `tolerance` default 0.05.

## Resolved decisions (sign-off)

1. **Solver home:** a new pure `@foreman/sf-flow` lib (abstract network in, delivered rates
   out) — game-data-free, unit-testable, reusable.
2. **Plain-splitter distribution:** demand-weighted (each branch drawn proportional to its
   downstream demand, capped by belt throughput).
3. **Fluids:** **full headlift + pump/valve modelling** (not capacity-only).

### Prerequisite for full headlift (data gap — must land first)

Headlift is **not in the current dataset** (`Building` has no headlift field; nothing
bundled). Modelling it requires, in order:

- **Extend the offline C# extractor** (`sf-game-data-extractor`) to read pump headlift
  (`mDesignHeadLift` / `mMaxHeadLift`) + pipe/junction data from the building CDOs, add it to
  the `Building` type, and **re-extract + re-bundle `sf-game-data.json`** (a channel bump).
  This builds/runs **only on the Windows host** (game install + CUE4Parse, interactive) — see
  CLAUDE.md and `windows-host-ssh`.
- **Extract per-instance pump/valve facts from saves** (the reinstated old slice C): valve
  `mDefaultFlowLimit`, pump direction (connectors) + position; actor `location.z` (already
  parsed) gives vertical lift. Confirmed shapes: valve `mDefaultFlowLimit` (Float),
  pump/valve `mFluidBox` (current content), pump `mIsProducing`.
- Solver fluid edges then carry a height delta + headlift budget; a leg whose lift exceeds
  available headlift is throughput-limited/blocked.

## Plan (incremental PRs, final one closes #148 **and** #126)

1. **Directed-flow substrate** — `upstreamOf`/`downstreamOf` in `sf-save-data-graph`.
   *(done on this branch; tested.)*
2. **`@foreman/sf-flow`** — the pure solver + a fixture test-suite (chains, splits, merges,
   contention, smart-filter, belt-cap, headlift-limited leg, loop→unknown). Solids-complete;
   fluid edges accept an optional headlift budget.
3. **effective-game-data seam** in `sf-mcp` (rates today; #172 modifiers later).
4. **Headlift data prerequisite** *(Windows-host, gates fluid accuracy)* — extend the C#
   extractor + re-extract; reinstated slice C pump/valve save extraction.
5. **adapter + `find_bottlenecks`** tool + real-save smoke tests. Closes #148 + #126.

Steps 2–3 (solids) don't depend on step 4 (headlift data) — the solver runs solids fully and
treats fluid headlift as unbounded until the data lands, so progress isn't host-blocked.

## Open questions for sign-off

1. **New `sf-flow` lib vs a module inside `sf-mcp`?** (Recommend the lib: pure, testable,
   and the abstract-network boundary is clean.)
2. **Plain-splitter distribution** at steady state — model as **demand-weighted** even split
   (recommended) rather than literal round-robin?
3. **Fluids in v1** — full pipe headlift/pump modelling, or capacity-only with a noted
   simplification (headlift deferred)?

Resolved: belt/pipe capacity is available (`Building.conveyorSpeedPerMin` / `pipeFlowPerMin`,
extractors via `extractionRatePerMin`) — used to cap edges.
