# @foreman/sf-save-data-graph

The **save-game connection graph** for *Satisfactory*. Reconstructs a factory's
connectivity — conveyor and pipe links, plus pre-grouped power circuits — from a
parsed `.sav` into an in-memory, **game-data-agnostic** graph. It is the substrate
every *relational* save question is answered over:

- **Power** (#68) — circuits are pre-grouped by the game, so this is mostly aggregation.
- **Production feed-tracing & real bottlenecks** (#126) — directed traversal over belts/pipes.
- Logistics and map adjacency.

It sits in the same domain layer as `@foreman/sf-save-data` and mirrors the
`@foreman/sf-game-data` → `@foreman/sf-game-data-graph` split. Strictly downward:
it depends on the parser package only — **no game data, no app concerns**. Resolving
raw class names to display names is a cross-domain join that lives at the edge
(`sf-mcp`), keeping this package agnostic. See
[`docs/component-architecture.md`](../../docs/component-architecture.md).

## Usage

```ts
import { parseSaveFile } from '@foreman/sf-save-data';
import { buildSaveGraph } from '@foreman/sf-save-data-graph';

const graph = buildSaveGraph(parseSaveFile(savePath, 'my-save'));

graph.getActor(instanceName);            // → ActorNode (raw Build_* class key + location)
graph.neighbours(instanceName, 'conveyor'); // → directly connected actors
graph.traverse(start, { kind: 'conveyor' }); // → BFS reachable set (the feed-trace primitive)
graph.powerCircuitOf(instanceName);      // → the actor's pre-grouped power circuit
graph.edges('pipe');                     // → all pipe links (each carries its networkId)
graph.stats();                           // → counts for diagnostics
graph.warnings;                          // → non-fatal build issues (never throws)
```

### Model

- **Actors** are the buildings (`Build_*`). Belts, lifts, splitters and mergers are
  themselves actor nodes, so a real chain is `Machine → Belt → Splitter → … → Machine`.
- **Edges** are `conveyor` or `pipe`, resolved from the connection components that
  declare them (`mConnectedComponent`), deduped to one per physical link. They are
  **undirected** as stored — `from`/`to` are canonically ordered, not a flow direction.
  The connector-name tails (`Output0`/`Input0`/`ConveyorAny0`) are retained so
  consumers can infer flow; belt connectors are deliberately ambiguous in the save.
- **Power circuits** are read directly from `FGPowerCircuit` (`mCircuitID` +
  `mComponents`) — the game pre-groups them, so no traversal is needed.

Direction inference and belt-chain collapsing are **consumer** concerns (#126); the
foundation records connectivity faithfully and leaves interpretation to the edge.

## Backend & the in-memory-vs-Kùzu spike

The graph is backed by **in-memory adjacency maps**. The issue (#122) called for a
spike between this and a Kùzu-per-save database. Measured on a real mid save
(`~/saves/sam-good-12.sav`, 51,523 objects):

| step | cost |
|---|---|
| parse (already paid by the save store) | ~5,300 ms |
| **build the graph** (14k actors, ~5.2k conveyor + ~0.8k pipe edges, 5 circuits) | **~150 ms** |

In-memory adds ~3% to a parse already paid. Kùzu-per-save would add multi-second
row-by-row ingestion *and* hold a native DB per cache slot, and would pull the native
`kuzu` addon into this otherwise zero-native-dep package. **Decision: in-memory.**
The `SaveGraph` facade is the stable surface — swapping in an embedded graph DB later
(should recursive queries ever demand it) is an implementation change, not an API one.

Reproduce the numbers:

```sh
npm run inspect -w @foreman/sf-save-data-graph -- ~/saves/sam-good-12.sav
```

## Caching

Building is cheap but not free, so callers cache per save. `@foreman/sf-mcp`'s
`SaveStore` parses once and memoises both the `SaveState` and the graph, rebuilding
only when the `.sav` mtime changes (`store.getGraph()`).
