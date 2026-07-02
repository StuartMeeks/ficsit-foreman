import { useEffect, useRef, useState } from 'react';

import { getAuditTrail, getRevisionDiff, getRevisions } from '../api/client.js';
import type {
  WorkOrder,
  WorkOrderAuditEvent,
  WorkOrderRevision,
  WorkOrderRevisionDiff,
} from '../api/types.js';
import type { WorkOrderActions } from '../useForeman.js';
import { STATE_LABEL, woLabel } from './workOrderLabels.js';
import { Collapsible } from './workorder/Collapsible.js';
import {
  BuildCostSection,
  BuildStepsSection,
  type BuildStepsExecution,
} from './workorder/BuildStepsSection.js';
import { ExpectedOutputsSection, NotesSection } from './workorder/ExpectedOutputsSection.js';
import { LocationSection, ResourceNodesSection } from './workorder/LocationSections.js';
import { OpportunitySections, RecipesSection } from './workorder/OpportunitySections.js';
import { PlanNarrative } from './workorder/PlanNarrative.js';
import { fmtDate, summarise } from './workorder/format.js';

interface WorkOrderPanelProps {
  playthroughId: string | null;
  current: WorkOrder | null;
  history: WorkOrder[];
  actions: WorkOrderActions;
  /** True when the displayed order is being viewed from history (read-only). */
  isViewingHistory: boolean;
  /** Return to the live active order. */
  onBackToActive: () => void;
}

/**
 * The active work-order cockpit (Work Orders v2). Laid out briefing-first:
 * goal/summary/action material at the top (header, banners, narrative,
 * expected output, FM notes, lifecycle controls), the work content after
 * (build steps → cost, location, recipes, opportunities, relations, history).
 * Plan sections are shared, plan-only components (components/workorder/) so
 * the revision-snapshot view can reuse them.
 */
export function WorkOrderPanel({
  playthroughId,
  current,
  history,
  actions,
  isViewingHistory,
  onBackToActive,
}: WorkOrderPanelProps): React.JSX.Element {
  const [revisions, setRevisions] = useState<WorkOrderRevision[]>([]);
  const [audit, setAudit] = useState<WorkOrderAuditEvent[]>([]);
  const [diff, setDiff] = useState<WorkOrderRevisionDiff | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forceWarn, setForceWarn] = useState(false);
  const [proposeDismissed, setProposeDismissed] = useState(false);
  const forceWarnRef = useRef<HTMLDivElement>(null);

  const id = current?.id ?? null;

  // Reset transient UI when the displayed order changes.
  useEffect(() => {
    setForceWarn(false);
    setProposeDismissed(false);
    setError(null);
  }, [id]);

  // Bring the force-complete confirmation into view when it opens.
  useEffect(() => {
    if (forceWarn) {
      forceWarnRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [forceWarn]);

  // Pull the audit trail, revisions, and (when unacknowledged) the field diff for
  // the current order. Re-runs whenever the order object changes (any mutation).
  useEffect(() => {
    if (playthroughId === null || current === null) {
      setRevisions([]);
      setAudit([]);
      setDiff(null);
      return;
    }
    const pid = playthroughId;
    const orderId = current.id;
    let cancelled = false;
    void (async () => {
      try {
        const [revs, events] = await Promise.all([
          getRevisions(pid, orderId),
          getAuditTrail(pid, orderId),
        ]);
        if (cancelled) {
          return;
        }
        setRevisions(revs);
        setAudit(events);
        if (current.hasUnacknowledgedRevision && current.currentRevision > 1) {
          const d = await getRevisionDiff(pid, orderId);
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
  }, [playthroughId, current]);

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
        </div>
      </section>
    );
  }

  const o = current;
  const terminal = o.state === 'completed' || o.state === 'cancelled' || o.state === 'superseded';
  // Viewing a past order from history is read-only too, even when it is not
  // terminal (e.g. a paused sibling) — only the live active order is editable.
  const readOnly = terminal || isViewingHistory;

  const incompleteSteps = o.buildSteps.filter((s) => !s.checked);
  const incompleteBuildables = o.buildSteps.flatMap((s) =>
    s.buildables.filter((b) => b.builtCount < b.requiredCount),
  );
  const isComplete = incompleteSteps.length === 0 && incompleteBuildables.length === 0;

  const lastEvent = audit[audit.length - 1];
  const proposed =
    o.state === 'active' && !proposeDismissed && lastEvent?.eventType === 'completion_proposed';

  // Live execution wiring for the shared (plan-only) build-steps renderer.
  const stepById = new Map(o.buildSteps.map((s) => [s.id, s]));
  const execution: BuildStepsExecution = {
    busy,
    readOnly,
    stepChecked: (stepId) => stepById.get(stepId)?.checked ?? false,
    builtCount: (stepId, buildableId) =>
      stepById.get(stepId)?.buildables.find((b) => b.id === buildableId)?.builtCount ?? 0,
    onToggleStep: (stepId, checked) => run(() => actions.setStep(o.id, stepId, checked)),
    onSetBuilt: (stepId, buildableId, count) =>
      run(() => actions.setBuildable(o.id, stepId, buildableId, count)),
  };

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
      incompleteBuildables.length > 0 ? `${incompleteBuildables.length} buildables short` : null,
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
        <span className="label">{readOnly ? 'Work Order' : 'Active Work Order'}</span>
        {o.hoursLogged !== undefined ? (
          <span className="label hours">{o.hoursLogged}h logged</span>
        ) : null}
      </div>

      <div className="wo">
        {isViewingHistory ? (
          <button type="button" className="ghost-btn back-active" onClick={onBackToActive}>
            ← Back to active order
          </button>
        ) : null}

        {/* ══ Briefing — goal, summary and actions ══════════════════ */}
        <div className="wo-top">
          <span className="wo-id">{woLabel(o.sequenceNumber)}</span>
          {o.tier !== undefined ? <span className="wo-tier">Tier {o.tier}</span> : null}
          <span className="spacer" />
          <span className={`chip state-${o.state}`}>{STATE_LABEL[o.state] ?? o.state}</span>
        </div>
        <h1 className="wo-title">{o.title}</h1>
        <p className="wo-meta">
          R{o.currentRevision} · game data {o.version} · created {fmtDate(o.createdAt)} · updated{' '}
          {fmtDate(o.updatedAt)}
        </p>

        {error !== null ? <div className="wo-error">{error}</div> : null}

        {/* Plan revised */}
        {o.hasUnacknowledgedRevision && !readOnly ? (
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

        {/* Blocked */}
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

        {/* Foreman suggests completion */}
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

        <PlanNarrative
          goal={o.goal}
          objective={o.objective}
          strategicSignificance={o.strategicSignificance}
          successCondition={o.successCondition}
        />

        <ExpectedOutputsSection outputs={o.expectedOutputs} />

        <NotesSection notes={o.notes} />

        {/* Completion summary (terminal) */}
        {terminal && o.completionSummary !== undefined ? (
          <div className="banner-card closed">
            <span className="label">{STATE_LABEL[o.state]}</span>
            <p className="banner-note">{o.completionSummary}</p>
          </div>
        ) : null}

        {/* Lifecycle controls */}
        {!readOnly ? (
          <div className="controls">
            {forceWarn ? (
              <div className="force-warn" ref={forceWarnRef}>
                <span className="label">Incomplete work order</span>
                <ul>
                  {incompleteSteps.length > 0 ? (
                    <li>{incompleteSteps.length} steps unchecked</li>
                  ) : null}
                  {incompleteBuildables.length > 0 ? (
                    <li>{incompleteBuildables.length} buildables short</li>
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

        {/* ══ Work content — the how ════════════════════════════════ */}
        <BuildStepsSection steps={o.buildSteps} execution={execution} />
        <BuildCostSection steps={o.buildSteps} liveSteps={o.buildSteps} />

        <LocationSection location={o.locationRecommendation} />
        <ResourceNodesSection nodes={o.resourceNodes} />
        <RecipesSection recipes={o.recipes} />
        <OpportunitySections opportunities={o.opportunities} />

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
                    {!readOnly && rev.revisionNumber < o.currentRevision ? (
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
      </div>
    </section>
  );
}
