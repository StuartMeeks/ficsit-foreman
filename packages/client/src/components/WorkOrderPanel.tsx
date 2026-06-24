import { useEffect, useState } from 'react';

import { getAuditTrail, getRevisionDiff, getRevisions } from '../api/client.js';
import type {
  CollectibleKind,
  CollectibleOpportunity,
  ExpectedOutput,
  WorkOrder,
  WorkOrderAuditEvent,
  WorkOrderRevision,
  WorkOrderRevisionDiff,
} from '../api/types.js';
import type { WorkOrderActions } from '../useForeman.js';

interface WorkOrderPanelProps {
  sessionId: string | null;
  current: WorkOrder | null;
  history: WorkOrder[];
  actions: WorkOrderActions;
}

const woLabel = (n: number): string => `WO-${String(n).padStart(3, '0')}`;
const metres = (cm: number): string => `${Math.round(cm / 100)}m`;

const STATE_LABEL: Record<string, string> = {
  new: 'New',
  active: 'Active',
  paused: 'Paused',
  blocked: 'Blocked',
  completed: 'Completed',
  cancelled: 'Cancelled',
  superseded: 'Superseded',
};

const COLLECTIBLE_LABEL: Record<CollectibleKind, string> = {
  mercerSphere: 'Mercer Sphere',
  somersloop: 'Somersloop',
  powerSlugBlue: 'Power Slug (Blue)',
  powerSlugYellow: 'Power Slug (Yellow)',
  powerSlugPurple: 'Power Slug (Purple)',
  hardDrive: 'Hard Drive',
};

function outputLine(out: ExpectedOutput): { label: string; value: string } {
  switch (out.kind) {
    case 'item':
      return { label: out.item, value: `${out.perMinute} ${out.unit ?? '/min'}` };
    case 'power':
      return { label: 'Power', value: `${out.megawatts} MW` };
    case 'unlock':
      return { label: 'Unlock', value: out.schematic };
    case 'infrastructure':
      return { label: 'Infrastructure', value: out.description };
    default:
      return { label: '', value: '' };
  }
}

/**
 * The active work-order cockpit (Work Orders v2). Renders the order the foreman
 * has the pioneer focused on — its plan, the pioneer's execution checklists, and
 * the lifecycle controls — faithful to the design mockup. Plan revisions,
 * blocking, opportunities, and completion all flow through here.
 */
export function WorkOrderPanel({
  sessionId,
  current,
  history,
  actions,
}: WorkOrderPanelProps): React.JSX.Element {
  const [revisions, setRevisions] = useState<WorkOrderRevision[]>([]);
  const [audit, setAudit] = useState<WorkOrderAuditEvent[]>([]);
  const [diff, setDiff] = useState<WorkOrderRevisionDiff | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forceWarn, setForceWarn] = useState(false);
  const [proposeDismissed, setProposeDismissed] = useState(false);

  const id = current?.id ?? null;

  // Reset transient UI when the displayed order changes.
  useEffect(() => {
    setForceWarn(false);
    setProposeDismissed(false);
    setError(null);
  }, [id]);

  // Pull the audit trail, revisions, and (when unacknowledged) the field diff for
  // the current order. Re-runs whenever the order object changes (any mutation).
  useEffect(() => {
    if (sessionId === null || current === null) {
      setRevisions([]);
      setAudit([]);
      setDiff(null);
      return;
    }
    const sid = sessionId;
    const orderId = current.id;
    let cancelled = false;
    void (async () => {
      try {
        const [revs, events] = await Promise.all([
          getRevisions(sid, orderId),
          getAuditTrail(sid, orderId),
        ]);
        if (cancelled) {
          return;
        }
        setRevisions(revs);
        setAudit(events);
        if (current.hasUnacknowledgedRevision && current.currentRevision > 1) {
          const d = await getRevisionDiff(sid, orderId);
          if (!cancelled) {
            setDiff(d);
          }
        } else {
          setDiff(null);
        }
      } catch {
        /* aux data is best-effort; the core order still renders */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, current]);

  const run = (fn: () => Promise<void>): void => {
    setBusy(true);
    setError(null);
    void fn()
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Action failed.'))
      .finally(() => setBusy(false));
  };

  if (current === null) {
    return (
      <section className="pane work">
        <div className="pane-head">
          <span className="tick label">⟩</span>
          <span className="label">Active Work Order</span>
        </div>
        <div className="wo">
          <p className="empty">
            No active order. Ask the foreman what to build next, and it will issue one here.
          </p>
          <WorkHistory history={history} />
        </div>
      </section>
    );
  }

  const o = current;
  const terminal = o.state === 'completed' || o.state === 'cancelled' || o.state === 'superseded';
  const power = o.expectedOutputs.find((out) => out.kind === 'power');
  const otherOutputs = o.expectedOutputs.filter((out) => out.kind !== 'power');

  const incompleteSteps = o.buildSteps.filter((s) => !s.checked);
  const incompleteMaterials = o.buildMaterials.filter((m) => !m.checked);
  const incompleteMachines = o.machines.filter((m) => m.builtCount < m.requiredCount);
  const isComplete =
    incompleteSteps.length === 0 &&
    incompleteMaterials.length === 0 &&
    incompleteMachines.length === 0;

  const lastEvent = audit[audit.length - 1];
  const proposed =
    o.state === 'active' && !proposeDismissed && lastEvent?.eventType === 'completion_proposed';

  const onComplete = (): void => {
    if (isComplete) {
      run(() => actions.transition(o.id, 'Complete', { completionSummary: undefined }));
    } else {
      setForceWarn(true);
    }
  };

  const onForceComplete = (): void => {
    const summary = [
      incompleteSteps.length > 0 ? `${incompleteSteps.length} steps unchecked` : null,
      incompleteMaterials.length > 0 ? `${incompleteMaterials.length} materials unchecked` : null,
      incompleteMachines.length > 0 ? `${incompleteMachines.length} machine groups short` : null,
    ]
      .filter(Boolean)
      .join('; ');
    run(() =>
      actions.transition(o.id, 'ForceComplete', {
        forceCompletionReason: 'Completed by the pioneer with items outstanding.',
        incompleteItemSummary: summary,
      }),
    );
  };

  return (
    <section className="pane work">
      <div className="pane-head">
        <span className="tick label">⟩</span>
        <span className="label">{terminal ? 'Work Order' : 'Active Work Order'}</span>
        {o.hoursLogged !== undefined ? (
          <span className="label hours">{o.hoursLogged}h logged</span>
        ) : null}
      </div>

      <div className="wo">
        {/* ── Header ───────────────────────────────────────────────── */}
        <div className="wo-top">
          <span className="wo-id">{woLabel(o.sequenceNumber)}</span>
          {o.tier !== undefined ? <span className="wo-tier">Tier {o.tier}</span> : null}
          <span className="spacer" />
          <span className={`chip state-${o.state}`}>{STATE_LABEL[o.state] ?? o.state}</span>
        </div>
        <h1 className="wo-title">{o.title}</h1>

        {o.locationRecommendation !== undefined ? (
          <p className="wo-loc">
            <span className="loc-tag">LOC</span> {o.locationRecommendation.summary}
            {o.locationRecommendation.relativeToPlayer !== undefined
              ? ` — ${o.locationRecommendation.relativeToPlayer}`
              : ''}
          </p>
        ) : null}
        <p className="wo-objective">
          <span className="loc-tag">OBJ</span> {o.objective ?? o.goal}
        </p>

        {error !== null ? <div className="wo-error">{error}</div> : null}

        {/* ── Plan revised ─────────────────────────────────────────── */}
        {o.hasUnacknowledgedRevision && !terminal ? (
          <div className="banner-card revised">
            <div className="banner-card-head">
              <span className="label">Plan revised by Foreman · R{o.currentRevision}</span>
            </div>
            {diff !== null && diff.changes.length > 0 ? (
              <table className="diff">
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>Before (R{diff.fromRevision})</th>
                    <th>After (R{diff.toRevision})</th>
                  </tr>
                </thead>
                <tbody>
                  {diff.changes.map((c) => (
                    <tr key={c.field}>
                      <td className="diff-field">{c.field}</td>
                      <td className="diff-before">{summarise(c.before)}</td>
                      <td className="diff-after">{summarise(c.after)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="banner-note">The plan changed. Your progress is preserved.</p>
            )}
            <button
              type="button"
              className="ghost-btn"
              disabled={busy}
              onClick={() => run(() => actions.acknowledge(o.id))}
            >
              Acknowledge
            </button>
          </div>
        ) : null}

        {/* ── Blocked ──────────────────────────────────────────────── */}
        {o.state === 'blocked' ? (
          <div className="banner-card blocked">
            <span className="label">Blocked — cannot proceed</span>
            <p className="banner-note">{o.blockedReason}</p>
            {o.blockedResolutionHint !== undefined ? (
              <p className="banner-resolve">
                <span className="loc-tag">RESOLVE</span> {o.blockedResolutionHint}
              </p>
            ) : null}
          </div>
        ) : null}

        {/* ── Foreman suggests completion ──────────────────────────── */}
        {proposed ? (
          <div className="banner-card suggest">
            <p className="banner-note">
              Foreman suggests:{' '}
              {lastEvent?.note ?? 'this looks close to done — ready to close out?'}
            </p>
            <button type="button" className="ghost-btn" onClick={() => setProposeDismissed(true)}>
              Dismiss
            </button>
          </div>
        ) : null}

        {/* ── Build steps ──────────────────────────────────────────── */}
        {o.buildSteps.length > 0 ? (
          <div className="section">
            <span className="label">Build Steps</span>
            <ol className="checks">
              {[...o.buildSteps]
                .sort((a, b) => a.order - b.order)
                .map((step, i) => (
                  <li key={step.id} className={step.checked ? 'done' : ''}>
                    <input
                      type="checkbox"
                      checked={step.checked}
                      disabled={busy || terminal}
                      onChange={(e) => run(() => actions.setStep(o.id, step.id, e.target.checked))}
                    />
                    <span className="step-n">{String(i + 1).padStart(2, '0')}</span>
                    <span className="check-body">
                      {step.title}
                      {step.description !== undefined ? (
                        <span className="check-note">{step.description}</span>
                      ) : null}
                    </span>
                  </li>
                ))}
            </ol>
          </div>
        ) : null}

        {/* ── Materials ────────────────────────────────────────────── */}
        {o.buildMaterials.length > 0 ? (
          <div className="section">
            <span className="label">Materials</span>
            <div className="checks materials">
              {o.buildMaterials.map((mat) => (
                <label key={mat.id} className={`material ${mat.checked ? 'done' : ''}`}>
                  <input
                    type="checkbox"
                    checked={mat.checked}
                    disabled={busy || terminal}
                    onChange={(e) => run(() => actions.setMaterial(o.id, mat.id, e.target.checked))}
                  />
                  <span className="check-body">{mat.itemName}</span>
                  <span className="qty">{mat.requiredQuantity}</span>
                </label>
              ))}
            </div>
          </div>
        ) : null}

        {/* ── Machines built ───────────────────────────────────────── */}
        {o.machines.length > 0 ? (
          <div className="section">
            <span className="label">Machines Built</span>
            <div className="machines">
              {o.machines.map((m) => (
                <div key={m.id} className="machine">
                  <span className="check-body">
                    {m.machineName}
                    {m.recipeName !== undefined ? (
                      <span className="check-note">{m.recipeName}</span>
                    ) : null}
                  </span>
                  <div className="stepper">
                    <button
                      type="button"
                      disabled={busy || terminal || m.builtCount <= 0}
                      onClick={() =>
                        run(() => actions.setMachine(o.id, m.id, Math.max(0, m.builtCount - 1)))
                      }
                    >
                      −
                    </button>
                    <span className={`count ${m.builtCount >= m.requiredCount ? 'met' : ''}`}>
                      {m.builtCount}
                    </span>
                    <button
                      type="button"
                      disabled={busy || terminal || m.builtCount >= m.requiredCount}
                      onClick={() =>
                        run(() =>
                          actions.setMachine(
                            o.id,
                            m.id,
                            Math.min(m.requiredCount, m.builtCount + 1),
                          ),
                        )
                      }
                    >
                      +
                    </button>
                    <span className="req">/ {m.requiredCount}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* ── Expected output (power hero) ─────────────────────────── */}
        {o.expectedOutputs.length > 0 ? (
          <div className="section output">
            <span className="label">Expected Output</span>
            {power !== undefined && power.kind === 'power' ? (
              <div className="power-hero">
                <span className="power-num">{power.megawatts}</span>
                <span className="power-unit">MW</span>
                <span className="power-tag">⚡ NET</span>
              </div>
            ) : null}
            {otherOutputs.length > 0 ? (
              <div className="ledger">
                {otherOutputs.map((out, i) => {
                  const line = outputLine(out);
                  return (
                    <div className="row" key={i}>
                      <span>{line.label}</span>
                      <span className="qty">{line.value}</span>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* ── Collapsible secondary sections ───────────────────────── */}
        {o.recipes.length > 0 ? (
          <Collapsible label="Recipes">
            <div className="ledger">
              {o.recipes.map((r, i) => (
                <div className="row" key={r.id ?? i}>
                  <span>{r.machineName}</span>
                  <span className="qty muted">{r.recipeName}</span>
                </div>
              ))}
            </div>
          </Collapsible>
        ) : null}

        {o.resourceNodes !== undefined && o.resourceNodes.length > 0 ? (
          <Collapsible label="Resource Nodes">
            <div className="ledger">
              {o.resourceNodes.map((n, i) => (
                <div className="row" key={n.id ?? i}>
                  <span>
                    {n.resourceName}
                    {n.purity !== undefined ? <span className="purity"> {n.purity}</span> : null}
                  </span>
                  <span className="qty muted">
                    {n.distanceFromWorkOrderLocation !== undefined
                      ? metres(n.distanceFromWorkOrderLocation)
                      : ''}
                  </span>
                </div>
              ))}
            </div>
          </Collapsible>
        ) : null}

        {hasCollectibles(o) ? (
          <Collapsible label="Nearby Collectibles">
            <CollectibleGroup
              title="Near you"
              items={o.opportunities?.nearbyCollectiblesFromPlayer ?? []}
            />
            <CollectibleGroup
              title="Near work-order site"
              items={o.opportunities?.nearbyCollectiblesFromWorkOrderLocation ?? []}
            />
          </Collapsible>
        ) : null}

        {o.childWorkOrderIds.length > 0 ? (
          <Collapsible label={`Child Orders (${o.childWorkOrderIds.length})`}>
            <div className="ledger">
              {o.childWorkOrderIds.map((cid) => {
                const child = history.find((h) => h.id === cid);
                return (
                  <div className="row" key={cid}>
                    <span>{child !== undefined ? child.title : cid}</span>
                    <span className="qty muted">
                      {child !== undefined ? (STATE_LABEL[child.state] ?? child.state) : ''}
                    </span>
                  </div>
                );
              })}
            </div>
          </Collapsible>
        ) : null}

        {revisions.length > 1 ? (
          <Collapsible label="Revision History">
            <div className="ledger">
              {[...revisions]
                .sort((a, b) => b.revisionNumber - a.revisionNumber)
                .map((rev) => (
                  <div className="row revision" key={rev.id}>
                    <span className="rev-n">R{rev.revisionNumber}</span>
                    <span className="rev-summary">
                      {rev.changeSummary ?? rev.reason ?? `Revision ${rev.revisionNumber}`}
                      <span className="check-note">{rev.createdBy}</span>
                    </span>
                    {!terminal && rev.revisionNumber < o.currentRevision ? (
                      <button
                        type="button"
                        className="ghost-btn tiny"
                        disabled={busy}
                        onClick={() => run(() => actions.revert(o.id, rev.revisionNumber))}
                      >
                        Revert
                      </button>
                    ) : null}
                  </div>
                ))}
            </div>
          </Collapsible>
        ) : null}

        {o.notes !== undefined && o.notes.length > 0 ? (
          <div className="section notes">
            <span className="label">FM Notes</span>
            <ul className="fm-notes">
              {o.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* ── Completion summary (terminal) ────────────────────────── */}
        {terminal && o.completionSummary !== undefined ? (
          <div className="banner-card closed">
            <span className="label">{STATE_LABEL[o.state]}</span>
            <p className="banner-note">{o.completionSummary}</p>
          </div>
        ) : null}

        {/* ── Controls ─────────────────────────────────────────────── */}
        {!terminal ? (
          <div className="controls">
            {forceWarn ? (
              <div className="force-warn">
                <span className="label">Incomplete work order</span>
                <ul>
                  {incompleteSteps.length > 0 ? (
                    <li>{incompleteSteps.length} steps unchecked</li>
                  ) : null}
                  {incompleteMaterials.length > 0 ? (
                    <li>{incompleteMaterials.length} materials unchecked</li>
                  ) : null}
                  {incompleteMachines.length > 0 ? (
                    <li>{incompleteMachines.length} machine groups short</li>
                  ) : null}
                </ul>
                <div className="force-actions">
                  <button type="button" className="ghost-btn" onClick={() => setForceWarn(false)}>
                    Keep working
                  </button>
                  <button
                    type="button"
                    className="danger-btn"
                    disabled={busy}
                    onClick={onForceComplete}
                  >
                    Complete anyway
                  </button>
                </div>
              </div>
            ) : (
              <div className="control-row">
                {o.state === 'new' ? (
                  <button
                    type="button"
                    className="primary-btn"
                    disabled={busy}
                    onClick={() => run(() => actions.transition(o.id, 'Start'))}
                  >
                    Start work order
                  </button>
                ) : null}
                {o.state === 'active' ? (
                  <button
                    type="button"
                    className="ghost-btn"
                    disabled={busy}
                    onClick={() => run(() => actions.transition(o.id, 'Pause'))}
                  >
                    Pause
                  </button>
                ) : null}
                {o.state === 'paused' ? (
                  <button
                    type="button"
                    className="primary-btn"
                    disabled={busy}
                    onClick={() => run(() => actions.transition(o.id, 'Resume'))}
                  >
                    Resume
                  </button>
                ) : null}
                {o.state === 'active' ? (
                  <button
                    type="button"
                    className="complete-btn"
                    disabled={busy}
                    onClick={onComplete}
                  >
                    ⚡ Complete work order
                  </button>
                ) : null}
                {(o.state === 'paused' || o.state === 'blocked') && o.buildSteps.length > 0 ? (
                  <button
                    type="button"
                    className="ghost-btn"
                    disabled={busy}
                    onClick={() => setForceWarn(true)}
                  >
                    Force complete
                  </button>
                ) : null}
              </div>
            )}
          </div>
        ) : null}

        <WorkHistory history={history} currentId={o.id} />
      </div>
    </section>
  );
}

function Collapsible({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <details className="collapsible">
      <summary>
        <span className="label">{label}</span>
        <span className="chevron">▸</span>
      </summary>
      <div className="collapsible-body">{children}</div>
    </details>
  );
}

function CollectibleGroup({
  title,
  items,
}: {
  title: string;
  items: CollectibleOpportunity[];
}): React.JSX.Element | null {
  if (items.length === 0) {
    return null;
  }
  return (
    <div className="collectible-group">
      <span className="label sub">{title}</span>
      {items.map((c, i) => (
        <div className="collectible" key={c.id ?? i}>
          <span className="check-body">
            {COLLECTIBLE_LABEL[c.kind]}
            {c.reason !== undefined ? <span className="check-note">{c.reason}</span> : null}
          </span>
          <span className="qty muted">
            {c.distance !== undefined ? metres(c.distance) : ''}
            {c.optional ? <span className="optional"> optional</span> : null}
          </span>
        </div>
      ))}
    </div>
  );
}

function WorkHistory({
  history,
  currentId,
}: {
  history: WorkOrder[];
  currentId?: string;
}): React.JSX.Element | null {
  const past = history.filter((o) => o.id !== currentId);
  if (past.length === 0) {
    return null;
  }
  return (
    <div className="history">
      <span className="label">Work History</span>
      {[...past]
        .sort((a, b) => b.sequenceNumber - a.sequenceNumber)
        .map((order) => (
          <div className="row" key={order.id}>
            <span className="wo-n">{woLabel(order.sequenceNumber)}</span>
            <span>{order.title}</span>
            <span className={`chip state-${order.state}`}>
              {STATE_LABEL[order.state] ?? order.state}
            </span>
          </div>
        ))}
    </div>
  );
}

function hasCollectibles(o: WorkOrder): boolean {
  const opp = o.opportunities;
  return (
    opp !== undefined &&
    ((opp.nearbyCollectiblesFromPlayer?.length ?? 0) > 0 ||
      (opp.nearbyCollectiblesFromWorkOrderLocation?.length ?? 0) > 0)
  );
}

/** Renders a diff value compactly: scalars as-is, arrays/objects as a count/blurb. */
function summarise(value: unknown): string {
  if (value === null || value === undefined) {
    return '—';
  }
  if (Array.isArray(value)) {
    return `${value.length} item${value.length === 1 ? '' : 's'}`;
  }
  if (typeof value === 'object') {
    return 'changed';
  }
  return String(value);
}
