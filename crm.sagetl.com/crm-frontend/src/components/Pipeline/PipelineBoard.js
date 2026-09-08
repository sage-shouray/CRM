import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faClock } from "@fortawesome/free-solid-svg-icons";
import { OPEN_STAGES, stageOf, isOverdue } from "../Home/pipeline";
import { formatDayMonth as fmtDate } from "../../dateFormat";

// Stage columns, plus Closed-Won at the end. The accent is used only on the
// column header — cards stay neutral so a wall of them reads calmly.
const COLUMNS = [
  ...OPEN_STAGES.map((s, i) => ({ ...s, accent: `stage-${i + 1}` })),
  { key: "won", label: "Closed-Won", accent: "stage-won" },
];

const latestAction = (lead) => {
  const notes = (lead.descriptions || []).filter((d) => d && d.description);
  if (notes.length === 0) return null;
  const sorted = [...notes].sort(
    (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
  );
  return { entry: sorted[0], count: notes.length };
};

const priorityKey = (p) => {
  const v = (p || "").toLowerCase();
  return ["high", "medium", "low"].includes(v) ? v : null;
};

function LeadCard({ lead, onOpenLead }) {
  const info = lead.companyInfo || {};
  const last = latestAction(lead);
  const overdue = isOverdue(lead);
  const prio = priorityKey(info.priority);

  return (
    <button
      type="button"
      className="pb-card"
      onClick={() => onOpenLead(lead.leadNumber)}
      title="Open this lead"
    >
      <div className="pb-card-row">
        <h4>{info.companyName || `Lead #${lead.leadNumber}`}</h4>
        {prio && <span className={`pb-dot is-${prio}`} title={info.priority} />}
      </div>

      <p className="pb-card-sub">
        {[info.vertical, info.city].filter(Boolean).join(" · ") ||
          `Lead #${lead.leadNumber}`}
      </p>

      {info.nextAction && (
        <p className={`pb-next ${overdue ? "is-overdue" : ""}`}>
          <FontAwesomeIcon icon={faClock} />
          {info.nextAction}
          {info.dateField && <span> · {fmtDate(info.dateField)}</span>}
        </p>
      )}

      <div className="pb-last">
        {last ? (
          <>
            <p className="pb-last-text">{last.entry.description}</p>
            <span className="pb-last-meta">
              {fmtDate(last.entry.createdAt) || "no date"}
              {last.count > 1 && ` · ${last.count} actions`}
            </span>
          </>
        ) : (
          <span className="pb-last-meta is-muted">No actions recorded</span>
        )}
      </div>
    </button>
  );
}

// The pipeline as a board of stages. No money anywhere: each card carries the
// lead's latest recorded action, with the full history one click away.
function PipelineBoard({ leads = [], isLoading, onOpenLead }) {
  const byStage = COLUMNS.map((col) => ({
    ...col,
    leads: leads.filter((lead) => stageOf(lead) === col.key),
  }));

  const total = byStage.reduce((n, c) => n + c.leads.length, 0);

  if (isLoading) return <p className="pb-empty">Loading pipeline…</p>;

  return (
    <div className="pipeline-board">
      {byStage.map((col) => (
        <section className={`pb-column ${col.accent}`} key={col.key}>
          <header className="pb-column-head">
            <span className="pb-column-title">
              <span className="pb-column-dot" />
              {col.label}
            </span>
            <span className="pb-count">{col.leads.length}</span>
          </header>

          {/* Share of the pipeline sitting in this stage. */}
          <div className="pb-share">
            <span
              style={{
                width: total ? `${(col.leads.length / total) * 100}%` : "0%",
              }}
            />
          </div>

          <div className="pb-column-body">
            {col.leads.length === 0 ? (
              <p className="pb-empty">Empty</p>
            ) : (
              col.leads.map((lead) => (
                <LeadCard
                  key={lead.leadNumber}
                  lead={lead}
                  onOpenLead={onOpenLead}
                />
              ))
            )}
          </div>
        </section>
      ))}

      {total === 0 && (
        <p className="pb-empty pb-empty-all">
          No open leads in the pipeline yet.
        </p>
      )}
    </div>
  );
}

export default PipelineBoard;
