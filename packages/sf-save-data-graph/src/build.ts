/**
 * Reconstructs the save's connection graph from the parsed `RawSave` in a single
 * pass: index objects, register building actors, then resolve conveyor/pipe links
 * and pre-grouped power circuits. Never throws — unresolved references are counted
 * and summarised in `warnings`, mirroring `normaliseSave`. The result feeds the
 * `SaveGraph` facade; both stay game-data-agnostic (raw `Build_*` class keys only).
 */
import {
  BUILDABLE_ACTOR,
  CIRCUIT_COMPONENTS_PROP,
  CIRCUIT_ID_PROP,
  CONNECTED_COMPONENT_PROP,
  FACTORY_CONNECTION_COMPONENT,
  PIPE_CONNECTION_COMPONENT,
  PIPE_NETWORK_ID_PROP,
  POWER_CIRCUIT,
  Warnings,
  arrayField,
  asString,
  classNameFromPath,
  dig,
  numberField,
  propMap,
  refField,
  translation,
  type RawObject,
  type RawSave,
} from '@foreman/sf-save-data';

import { SaveGraph } from './graph.js';
import type { ActorNode, ConnectionEdge, EdgeKind, PowerCircuit } from './types.js';

/** The owner actor's instance name of a component path — i.e. drop the trailing `.<connector>`. */
export function ownerOf(componentPath: string): string {
  const dot = componentPath.lastIndexOf('.');
  return dot < 0 ? componentPath : componentPath.slice(0, dot);
}

/** Builds the connection graph for a parsed save. */
export function buildSaveGraph(raw: RawSave): SaveGraph {
  const warnings = new Warnings();

  // 1. Walk every sublevel once; collect objects and index the building actors.
  const objects: RawObject[] = [];
  const actors = new Map<string, ActorNode>();
  for (const level of Object.values(raw.levels ?? {})) {
    for (const obj of level?.objects ?? []) {
      objects.push(obj);
      const instanceName = obj.instanceName;
      const typePath = obj.typePath;
      if (instanceName === undefined || typePath === undefined) {
        continue;
      }
      const classKey = classNameFromPath(typePath);
      if (BUILDABLE_ACTOR.test(classKey)) {
        actors.set(instanceName, { instanceName, classKey, location: translation(obj) });
      }
    }
  }

  // 2. Resolve conveyor + pipe links from their connection components.
  const edges: ConnectionEdge[] = [];
  const seen = new Set<string>();
  let unresolvedConveyor = 0;
  let unresolvedPipe = 0;

  for (const obj of objects) {
    const typePath = obj.typePath;
    const thisPath = obj.instanceName;
    if (typePath === undefined || thisPath === undefined) {
      continue;
    }
    const isConveyor = FACTORY_CONNECTION_COMPONENT.test(typePath);
    const isPipe = !isConveyor && PIPE_CONNECTION_COMPONENT.test(typePath);
    if (!isConveyor && !isPipe) {
      continue;
    }
    const bag = propMap(obj);
    const connectedPath = refField(bag, CONNECTED_COMPONENT_PROP);
    if (connectedPath === undefined) {
      continue; // An unconnected connector — common and not an error.
    }
    const kind: EdgeKind = isConveyor ? 'conveyor' : 'pipe';

    // Dedup the symmetric pair (each connector declares the same physical link).
    const key =
      thisPath < connectedPath ? `${thisPath}|${connectedPath}` : `${connectedPath}|${thisPath}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const fromOwner = ownerOf(thisPath);
    const toOwner = ownerOf(connectedPath);
    if (!actors.has(toOwner)) {
      if (isConveyor) {
        unresolvedConveyor++;
      } else {
        unresolvedPipe++;
      }
    }
    // Canonical ordering so `from`/`to` are stable regardless of which connector we saw first.
    const flip = thisPath > connectedPath;
    edges.push({
      kind,
      from: flip ? toOwner : fromOwner,
      to: flip ? fromOwner : toOwner,
      fromConnector: classNameFromPath(flip ? connectedPath : thisPath),
      toConnector: classNameFromPath(flip ? thisPath : connectedPath),
      ...(isPipe ? { networkId: numberField(bag, PIPE_NETWORK_ID_PROP) } : {}),
    });
  }

  // 3. Power circuits are pre-grouped by the game — read membership directly.
  const circuits: PowerCircuit[] = [];
  let unresolvedCircuitMembers = 0;
  for (const obj of objects) {
    if (obj.typePath === undefined || !POWER_CIRCUIT.test(obj.typePath)) {
      continue;
    }
    const bag = propMap(obj);
    const circuitId = numberField(bag, CIRCUIT_ID_PROP);
    if (circuitId === undefined) {
      continue;
    }
    const members = new Set<string>();
    for (const entry of arrayField(bag, CIRCUIT_COMPONENTS_PROP)) {
      const memberPath = asString(dig(entry, 'pathName'));
      if (memberPath === undefined) {
        continue;
      }
      const owner = ownerOf(memberPath);
      if (!actors.has(owner)) {
        unresolvedCircuitMembers++;
      }
      members.add(owner);
    }
    circuits.push({ circuitId, members: [...members] });
  }

  if (unresolvedConveyor > 0) {
    warnings.add(`${unresolvedConveyor} conveyor connection(s) referenced an unknown owner actor.`);
  }
  if (unresolvedPipe > 0) {
    warnings.add(`${unresolvedPipe} pipe connection(s) referenced an unknown owner actor.`);
  }
  if (unresolvedCircuitMembers > 0) {
    warnings.add(
      `${unresolvedCircuitMembers} power-circuit member(s) referenced an unknown owner actor.`,
    );
  }

  return new SaveGraph(actors, edges, circuits, warnings.all());
}
