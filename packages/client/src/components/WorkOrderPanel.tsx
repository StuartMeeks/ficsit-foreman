import type { WorkOrder } from '../api/types.js';

interface WorkOrderPanelProps {
  active: WorkOrder | null;
  history: WorkOrder[];
}

const woLabel = (n: number): string => `WO-${String(n).padStart(3, '0')}`;

/**
 * Boilerplate work-order view. Renders the active order if the foreman has
 * issued one, plus a minimal history list. The layout here is intentionally
 * provisional — it will be reworked in a later pass.
 */
export function WorkOrderPanel({ active, history }: WorkOrderPanelProps): React.JSX.Element {
  return (
    <section className="pane work">
      <div className="pane-head">
        <span className="tick label">⟩</span>
        <span className="label">Active Work Order</span>
      </div>

      <div className="wo">
        {active === null ? (
          <p className="empty">
            No active order. Ask the foreman what to build next, and it will issue one here.
          </p>
        ) : (
          <>
            <div className="wo-top">
              <span className="wo-id">{woLabel(active.sequenceNumber)}</span>
              <span className={`chip ${active.status}`}>{active.status.replace('_', ' ')}</span>
            </div>
            <h1 className="wo-title">{active.title}</h1>
            <p className="wo-objective">{active.objective}</p>

            {active.buildSteps.length > 0 ? (
              <div className="section">
                <span className="label">Build Steps</span>
                <ol className="steps">
                  {active.buildSteps.map((step, i) => (
                    <li key={i}>
                      <span className="step-n">{String(i + 1).padStart(2, '0')}</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}

            {active.requiredItems.length > 0 ? (
              <div className="section">
                <span className="label">Materials</span>
                <div className="ledger">
                  {active.requiredItems.map((item, i) => (
                    <div className="row" key={i}>
                      <span>{item.item}</span>
                      <span className="qty">
                        {item.quantity} {item.unit}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {active.expectedOutput.length > 0 ? (
              <div className="section">
                <span className="label">Expected Output</span>
                <div className="ledger">
                  {active.expectedOutput.map((out, i) => (
                    <div className="row" key={i}>
                      <span>{out.item}</span>
                      <span className="qty">{out.perMinute} /min</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {active.notes !== undefined && active.notes.length > 0 ? (
              <div className="notes">
                <span className="label">FM Notes</span>
                <p>{active.notes}</p>
              </div>
            ) : null}
          </>
        )}

        {history.length > 0 ? (
          <div className="history">
            <span className="label">Work History</span>
            {history
              .slice()
              .reverse()
              .map((order) => (
                <div className="row" key={order.id}>
                  <span className="wo-n">{woLabel(order.sequenceNumber)}</span>
                  <span>{order.title}</span>
                  <span className={`chip ${order.status}`}>{order.status}</span>
                </div>
              ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
