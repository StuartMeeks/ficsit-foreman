# FICSIT Foreman — design breakdown

A reading of the north-star prototype (`Foreman_AI_Factory_Companion.html` +
`Screenshot.png`), captured for Phase 3. Layout and information architecture are
derived from the rendered screenshot and the bundle's embedded strings; exact
pixel proportions are approximate (the source is a compiled bundle). The palette
and type come from `design-tokens.css`.

**Aesthetic in one line:** a factory SCADA / mission-control terminal — dark,
dense, calm, monospace labels, with amber as the single accent that means *"pay
attention here."* Confident and deliberately un-templated.

---

## Layout

A three-column working surface under a thin global header, with a full-width
notes strip pinned at the bottom.

```
┌─ FOREMAN ▸ wordmark · nav ················· SESSION · ● ONLINE (pulse) ─┐  global header
├──────────────────┬─────────────────────────────────┬───────────────────┤
│ CHAT (~25%)       │ WORK ORDER (centre, ~45%)        │ RIGHT RAIL (~30%) │
│                   │ WO #041   [IN PROGRESS]   1 / 5  │ MATERIALS          │
│ foreman ⟩ message │ TURBOFUEL PRODUCTION LOOP        │  Iron Plate ✓ 80/80│
│ pioneer  ⟩ message│ objective paragraph (dimmed)     │  Concrete   ✗ 0/140│
│ …streaming reply  │                                  │                    │
│                   │ ── BUILD STEPS ──                │ REMAINING COST     │
│                   │  1  Route crude oil pipeline  ✓  │  Concrete    +140  │
│                   │ ▎3  Place 6× Fuel Refineries     │  …                 │
│                   │     "4 remaining · lay pads…"    │ EXPECTED OUTPUT    │
│ [input caret]     │  4  Configure recipes      2/6   │  Turbofuel  540/min│
│                   │  5  Install 4× Blenders          │  Net power  +1,000 │
├──────────────────┴─────────────────────────────────┴───────────────────┤
│ ⟩ FM NOTES   Leave 8m clearance east of the blenders for the conveyor…  │  notes strip
└──────────────────────────────────────────────────────────────────────────┘
```

- **Global header** — thin bar. Left: a small square logo glyph + `FOREMAN`
  wordmark (mono, tracked) and dim nav items. Right: `SESSION` indicator and an
  `ONLINE` status with a pulsing dot.
- **Chat column (left, ~25%)** — alternating foreman/pioneer messages with a
  leading speaker marker (`⟩`), amber for the foreman and dimmer for the pioneer;
  a blinking input caret at the bottom. This is the only column with streaming.
- **Work-order column (centre, widest, ~45%)** — the always-visible active order.
- **Right rail (~30%)** — materials ledger, remaining cost, expected output.
- **FM Notes strip (full-width, bottom)** — the foreman's standing commentary.

Separation between columns is by **hairline borders**, not fills — surfaces are
near-flat black-on-black.

---

## Components / regions

### Global header
- Logo glyph + `FOREMAN` wordmark (mono, wide tracking).
- Dim nav labels.
- `SESSION` label + `ONLINE` status with a **pulse dot** (the `pulse` keyframe).

### Work-order panel (centre)
- **WO header:** `WO #041` (small amber mono id), an `IN PROGRESS` **status chip**
  (amber outline), a step counter (`1 / 5`), and an **amber top accent** line.
- **Title:** the order name, very large, Barlow Condensed extrabold, in the
  brightest warm-white. The single biggest element on the screen.
- **Objective:** one dimmed paragraph beneath the title.
- **Build steps list:** numbered rows. Each row has a leading marker, the step
  text, and a right-aligned mono **progress fraction** (e.g. `2 / 6`).
  - *Completed* steps are dimmed with a ✓ and may show a sub-note ("Pipeline laid
    and pressurised").
  - The *current* step is the signature treatment (see Patterns).

### Right rail
- **MATERIALS** — a ✓/✗ ledger: item name · `have / need`, numerals right-aligned
  and mono. Met = check; shortfall = red ✗.
- **REMAINING COST** — outstanding amounts as deltas (`Concrete +140`).
- **EXPECTED OUTPUT** — `Turbofuel 540 /min`, `Generator output`, and a
  highlighted **Net power gain `+1,000`**.

### FM Notes strip
- `FM NOTES` label + a short paragraph of standing foreman guidance, full width
  along the bottom.

---

## Signature patterns

1. **Active-step focus.** The current build step sits in a slightly raised box
   with an **amber left edge** and an inline contextual note (e.g. "4 remaining ·
   lay concrete pads first, then snap to existing power poles at 3-unit spacing").
   It's the one place with elevation; everything else is flat. This is how the UI
   says "do this next."
2. **Materials as a ✓/✗ ledger.** `have / need` with met = check and shortfall =
   red ✗ — the emotional core of the screen (the chat is literally arguing about
   the Concrete `0 / 140` shortfall). Costs and outputs follow the same tight,
   right-aligned mono numeric column style.
3. **Sparse amber for signal.** Amber appears only on things that warrant
   attention: the active step, the wordmark accent, section ticks, the status
   chip, and headline numbers (Net power gain). Everything else is warm grey.
4. **Calm density.** A lot of information, but quiet — small mono caps with wide
   tracking, thin rules, generous right-alignment of numbers. Reads like a SCADA
   panel, not a dashboard.

---

## Colour roles

Grounded in the screenshot; see `design-tokens.css` for hex values and the
semantic layer that maps these roles to tokens.

| Role | Token | Notes |
|---|---|---|
| Page / column background | `--color-bg` | warm near-black |
| Panel surface | `--color-surface` | barely lighter than bg |
| Active-step surface | `--color-surface-raised` | the only real elevation |
| Hairline dividers / borders | `--color-border` | column separation |
| Signal accent | `--color-accent` | active step, chip, ticks, key numbers |
| Title / primary numerals | `--color-text-brightest` | warm near-white |
| Body / chat text | `--color-text` → `--color-text-secondary` | objective is dimmed |
| Material shortfall / ✗ | `--color-danger` | the one red |
| Online status (and possibly met ✓) | `--color-success` | confirm green-vs-amber for "met" |

> Open question: at screenshot resolution I can't be certain whether a *met*
> material check is green or amber. Confirm against the rendered prototype before
> finalising `--status-met`.

---

## Typography roles

| Use | Family | Treatment |
|---|---|---|
| Work-order title | Barlow Condensed, extrabold | very large, brightest |
| Labels, section headers, chips, ids, all numerals | IBM Plex Mono | uppercase, tracking `0.1–0.22em` |
| Chat messages, objective, notes | Barlow (sans) | regular/medium, comfortable |

The mono/sans split is the user-stated rule made concrete: **monospace for
anything labelled or numeric, sans for prose.**

---

## Motion

- **`fadeInUp`** — entrance animation (likely for messages / step rows).
- **`pulse`** — the live `ONLINE` status dot.

Restraint is the rule; motion is incidental, not decorative.

---

## Sample content (the prototype's seed data)

Useful for fixtures and for reading the foreman's register.

- **Active order:** `TURBOFUEL PRODUCTION LOOP` (WO #041).
- **History orders:** `INITIAL POWER SETUP`, `BIOMASS BURNER PHASE`, `IRON
  SMELTER EXPANSION`, `REINFORCED PLATE LINE`, `COAL POWER GRID`, `COPPER INGOT
  OVERFLOW`.
- **Build steps (voice sample):** "Route crude oil pipeline from Node 12",
  "Commission sulphur miners", "Place 6× Fuel Refineries", "Configure refinery
  recipes to Turbofuel", "Install 4× Turbofuel Blenders", "Connect blenders to
  heavy oil residue loop", "Route turbofuel output to generator manifold".
- **Materials:** Iron Plate, Copper Sheet, Heavy Modular Frame, Concrete, Rubber,
  AI Limiter, Circuit Board.
- **Foreman tone:** directive, terse, spatially specific — "Lay floor foundations
  before dropping blenders — awkward to retrofit", "Concrete is the problem.
  You're 180 short and there's no shortcut." Maps onto the persona in
  `SYSTEM_PROMPT.md`.

---

## Mapping to Phase 2 / Phase 3

- Centre + right rail are a live view of the **active work order** (Phase 2:
  `GET /api/sessions/:id/work-orders/active`) — title, objective, build steps,
  materials (`requiredItems`), expected output, remaining cost.
- The chat column is the **SSE chat stream** (Phase 2: `POST …/chat`).
- Step progress and material have/need imply per-step and per-item progress the
  current Phase 2 `WorkOrder` schema does not yet model — **flag for Phase 3**:
  the north star shows progress state (`2 / 6`, ✓/✗) that may need either client
  derivation or a schema addition. Not a blocker for layout; worth a decision.
- `FM NOTES` ≈ the work order's `notes`; history strip ≈ the work-order history
  list.
