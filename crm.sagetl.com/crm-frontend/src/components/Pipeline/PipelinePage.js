import React, { useState } from "react";
import PipelineBoard from "./PipelineBoard";
import LeadDetails from "../Leads/LeadDetails";
import { useDashboard } from "../../context/DashboardContext";
import "./PipelinePage.css";

// The pipeline as a stage board. Leads come from the shared dashboard context,
// so this never refetches.
function PipelinePage() {
  const { leads, isLoading, refresh } = useDashboard();
  const [openLeadNumber, setOpenLeadNumber] = useState(null);

  return (
    <div className="pipeline-page">
      <header className="pipeline-page-head">
        <h1>Pipeline</h1>
        <p>
          Every lead by stage, with the actions already recorded against it.
          Stages are derived from each lead&apos;s next action and status — no
          separate stage field is stored.
        </p>
      </header>

      <PipelineBoard
        leads={leads}
        isLoading={isLoading}
        onOpenLead={setOpenLeadNumber}
      />

      {openLeadNumber && (
        <LeadDetails
          leadNumber={openLeadNumber}
          onClose={() => {
            setOpenLeadNumber(null);
            refresh();
          }}
          onUpdate={refresh}
        />
      )}
    </div>
  );
}

export default PipelinePage;
