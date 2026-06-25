# Playthroughs & Foremen — domain model

> **Status: slice 1 implemented (#86); slices 2–3 pending.** The domain model and
> data-preserving migration have landed — the schema now has `Foreman` and `Playthrough`
> (the former `Session`), and the server speaks "playthrough" with Foreman CRUD + a
> playthrough list (see [`packages/server/prisma/schema.prisma`](../packages/server/prisma/schema.prisma)).
> The playthrough switcher / foreman library UI (#61) and the save subsystem (#76) build on
> this. It supersedes the original framing of #61 and reshapes #76.

## Why

The unit the app is built around — today's `Session` — is really **"a playthrough of a
particular save, with a chosen foreman."** Three needs make that explicit:

- **Reusable foremen.** A pioneer should be able to define one or more foreman personas and reuse
  them across playthroughs, rather than re-describing a personality every time.
- **Named, switchable playthroughs.** A pioneer runs more than one factory/world over time and
  wants to switch between them, resuming each one's chat history *and* work orders.
- **A save per playthrough, re-uploaded over time.** A playthrough is tied to a Satisfactory save
  that is uploaded (optionally) when the playthrough is created and **re-uploaded as the pioneer
  progresses**; the save's metadata seeds the playthrough's default name and powers the save-game
  MCP's live answers.

## Entities

### Foreman *(new — reusable)*
The AI companion persona, owned by a user and attachable to many playthroughs.

| Field | Notes |
|---|---|
| `id` | |
| `userId` | owner (→ `User`) |
| `name` | e.g. "ADA", "Gruff Greg" |
| `personality` | the persona text injected into the system prompt as `{{PERSONALITY}}` |
| `createdAt` / `updatedAt` | |

The onboarding presets (the synthetic-AI/ADA option, gruff supervisor, etc.) become **starting
points** for creating a foreman rather than a per-session one-off.

### Playthrough *(rename of today's `Session`)*
One save's journey: a chosen foreman + the pioneer's play style + the conversation and its work.

| Field | Notes |
|---|---|
| `id` | |
| `userId` | owner (→ `User`) |
| `name` | freely editable; **default derived from the attached save** (else a sensible fallback) |
| `foremanId` | the attached foreman (→ `Foreman`); **one foreman per playthrough** |
| `pioneerProfile` | the pioneer's play style **for this run** — `{{PIONEER_PROFILE}}` |
| `summary` | rolling condensed record — `{{SESSION_SUMMARY}}` |
| `createdAt` / `updatedAt` | |
| relations | `messages[]`, `workOrders[]`, one current `Save` |

`pioneerProfile` lives **here, not on the user**, because play style varies per run (a relaxed
build vs a min-max sprint).

### Save *(new — mechanics owned by #76)*
The uploaded `.sav` for a playthrough.

| Field | Notes |
|---|---|
| `id` | |
| `playthroughId` | owning playthrough (→ `Playthrough`) |
| metadata | parsed world/save name, game version, uploaded-at |
| file reference | how/where the `.sav` is stored — **decided in #76** (data-volume path vs object store) |

**Latest state only** for v1: re-uploading replaces the current save (a multi-version history is
deferred). The model just defines that a playthrough *has* a current save; the upload pipeline and
storage are #76.

## Relationships

```
User ──1:*── Foreman ──1:*── Playthrough ──1:1── Save (current)
 └───1:*────────────────────┘                 └──1:* Message / WorkOrder
```

- User 1–* Foreman, User 1–* Playthrough
- Foreman 1–* Playthrough (a foreman is reused across playthroughs)
- Playthrough 1–1 current Save (re-uploaded over time); 1–* Message / WorkOrder

**Not affected:** `AuthSession` (the Better Auth login cookie) is unrelated to a play
*session*/Playthrough — keeping the two distinct is exactly why that table was renamed
(see [architecture.md → Accounts & identity](./architecture.md)).

## Lifecycle

- **New playthrough:** pick (or create) a foreman; optionally upload a save now — if supplied, the
  default name comes from the save; otherwise name it freely and add a save later. The foreman runs
  on game-data alone until a save is attached.
- **Switch:** selecting a playthrough resumes its chat history and work orders.
- **Re-upload save:** as the pioneer progresses, they upload a fresh `.sav`; it replaces the
  playthrough's current save and refreshes the save-game MCP's view.
- **Rename / delete:** playthroughs are freely renamed; deleting one removes its chat + work orders.
- **Manage foremen:** a small library to create/edit/choose reusable foremen.

## Migration (there is real data)

- Each existing `Session` → a `Playthrough` (carrying its `pioneerProfile`, `summary`, messages and
  work orders).
- Extract a `Foreman` per **distinct** `personality` string per user (dedup identical personas),
  and point each playthrough's `foremanId` at it.
- Rename the Prisma model `Session` → `Playthrough`, and the `sessionId` foreign keys on
  `Message` / `WorkOrder` / `WorkOrderRevision` / `WorkOrderAuditEvent` → `playthroughId`.
- Additive and data-preserving (SQLite table rebuilds via Prisma; Postgres-portable as before).

## Delivery slices

1. **Domain model + migration** *(foundational — do first).* Schema (Foreman, Playthrough rename,
   Save table), the data migration, and the server rename `session`→`playthrough` across
   services/routes, plus Foreman CRUD and the playthrough list endpoint.
2. **Playthrough switcher + foreman library + sectioned settings** *(reworked #61).* List / switch
   / new / rename / delete playthroughs (resuming chat **and** work orders); a foreman library; and
   the sectioned Settings dialog (Foreman / Pioneer / LLM / billing placeholder).
3. **Save upload + re-upload + name-from-save** *(refocused #76).* Optional upload at creation and
   re-upload later; storage; wiring into the save-game MCP.

## Decisions (settled)

- Design-first; this spec is signed off before implementation.
- `pioneerProfile` lives on the **Playthrough**.
- A save is **optional** to start a playthrough.
- Save is **latest-only** for v1; storage is a #76 detail.
- Foremen are seeded by **deduping** existing personalities on migration; new users get a foreman
  from their chosen onboarding preset.
