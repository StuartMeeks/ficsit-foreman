import { useEffect } from 'react';

import type { WorkOrder } from '../api/types.js';
import { buildHistoryGraph, type GraphCell } from './historyGraph.js';
import { STATE_LABEL, woLabel } from './workOrderLabels.js';

interface WorkHistoryDrawerProps {
  history: WorkOrder[];
  /** The live active order's id (selected when not viewing a past order). */
  currentId: string | null;
  /** The order being viewed from history, or null when on the active order. */
  viewingId: string | null;
  /** Open an order; the active order's id returns to the live view. */
  onSelect: (id: string) => void;
  onClose: () => void;
}

const DATE_FMT = new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short' });

function completionDate(order: WorkOrder): string {
  if (order.completedAt === undefined) {
    return '';
  }
  const when = new Date(order.completedAt);
  return Number.isNaN(when.getTime()) ? '' : DATE_FMT.format(when);
}

/** The gutter cell: directional line segments + an optional state-coloured node. */
function LaneCell({ cell, state }: { cell: GraphCell; state: string }): React.JSX.Element {
  return (
    <span className="lane">
      {cell.up ? <span className="ln ln-up" /> : null}
      {cell.down ? <span className="ln ln-down" /> : null}
      {cell.left ? <span className="ln ln-left" /> : null}
      {cell.right ? <span className="ln ln-right" /> : null}
      {cell.node ? <span className={`node state-${state}`} /> : null}
    </span>
  );
}

/**
 * The Work History drawer: a right-edge slide-over listing every order in the
 * playthrough as a single creation-ordered trunk (newest top, oldest bottom)
 * with a git-style branch gutter. Selecting a row opens it read-only in the
 * cockpit; the active order returns to the live view.
 */
export function WorkHistoryDrawer({
  history,
  currentId,
  viewingId,
  onSelect,
  onClose,
}: WorkHistoryDrawerProps): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const { rows, laneCount } = buildHistoryGraph(history);
  const selectedId = viewingId ?? currentId;

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="drawer"
        role="dialog"
        aria-label="Work history"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="drawer-head">
          <span className="label">Work History</span>
          <span className="label muted">{history.length}</span>
          <span className="spacer" />
          <button type="button" className="ghost-btn tiny" onClick={onClose}>
            Close
          </button>
        </div>

        {rows.length === 0 ? (
          <p className="empty">No work orders yet.</p>
        ) : (
          <div className="history">
            {rows.map(({ order, cells, relationshipLabel }) => {
              const selected = order.id === selectedId;
              return (
                <button
                  type="button"
                  key={order.id}
                  className={`history-row${selected ? ' selected' : ''}`}
                  aria-current={selected ? 'true' : undefined}
                  onClick={() => onSelect(order.id)}
                >
                  <span
                    className="wo-graph"
                    style={{ ['--lanes']: laneCount } as React.CSSProperties}
                  >
                    {cells.map((cell, l) => (
                      <LaneCell key={l} cell={cell} state={order.state} />
                    ))}
                  </span>
                  <span className="wo-n">{woLabel(order.sequenceNumber)}</span>
                  <span className="history-title">
                    {order.title}
                    {relationshipLabel !== undefined ? (
                      <span className="label sub">{relationshipLabel}</span>
                    ) : null}
                  </span>
                  <span className="history-meta">
                    <span className={`chip state-${order.state}`}>
                      {STATE_LABEL[order.state] ?? order.state}
                    </span>
                    {completionDate(order) !== '' ? (
                      <span className="qty muted">{completionDate(order)}</span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
