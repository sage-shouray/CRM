import React, { useEffect, useState } from "react";
import axios from "axios";
import { API_BASE_URL } from "../../config";
import { useLiveUpdates } from "../../liveUpdates";
import "./PipelineFunnel.css";

const authHeaders = () => ({
  headers: { Authorization: `Bearer ${sessionStorage.getItem("token")}` },
});

// Cumulative stage-reached funnel + stage-to-stage conversion + average time
// spent in each stage, all derived server-side from data already stored (the
// lead's own pipelineStage and the audit trail of past changes to it) — see
// GET /api/reports/pipeline-funnel.
function PipelineFunnel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const fetchFunnel = () => {
    axios
      .get(`${API_BASE_URL}/api/reports/pipeline-funnel`, authHeaders())
      .then((res) => setData(res.data))
      .catch((err) => {
        console.error("Error loading pipeline funnel:", err);
        setError("Could not load the funnel report.");
      });
  };

  useEffect(fetchFunnel, []);
  useLiveUpdates(["leads"], fetchFunnel);

  if (error) return <p className="pf-error">{error}</p>;
  if (!data) return null;

  const { funnel, dead, totalLeads } = data;
  const maxCount = Math.max(1, ...funnel.map((f) => f.count));

  return (
    <section className="pipeline-funnel">
      <header className="pf-head">
        <h2>Stage Funnel</h2>
        <p>
          Of {totalLeads} companies in the system, here's how far each open
          lead has actually reached — and how long they tend to sit at each
          step along the way.
        </p>
      </header>

      <div className="pf-stages">
        {funnel.map((stage, i) => (
          <div className="pf-stage" key={stage.stage}>
            <div className="pf-stage-bar-track">
              <div
                className={`pf-stage-bar is-${stage.stage}`}
                style={{ width: `${(stage.count / maxCount) * 100}%` }}
              />
            </div>
            <div className="pf-stage-info">
              <span className="pf-stage-label">{stage.label}</span>
              <span className="pf-stage-count">{stage.count}</span>
              {i > 0 && stage.conversionFromPrev !== null && (
                <span className="pf-stage-conv">
                  {stage.conversionFromPrev}% from {funnel[i - 1].label}
                </span>
              )}
              <span className="pf-stage-dwell">
                {stage.avgDaysInStage !== null
                  ? `~${stage.avgDaysInStage}d avg in stage`
                  : "no dwell data yet"}
              </span>
            </div>
          </div>
        ))}
      </div>

      {dead.total > 0 && (
        <p className="pf-dead-note">
          Not counted above — {dead.total} dropped out of the pipeline:{" "}
          {Object.entries(dead.byStatus)
            .filter(([, n]) => n > 0)
            .map(([status, n]) => `${n} ${status}`)
            .join(", ")}
          .
        </p>
      )}
    </section>
  );
}

export default PipelineFunnel;
