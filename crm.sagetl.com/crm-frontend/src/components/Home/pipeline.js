// Pipeline model derived from fields the CRM actually stores.
//
// There is no dedicated "stage" column on a lead, so the funnel is read from
// `nextAction` (what the rep is doing next) plus `leadStatus` for the closed
// outcomes. Every number on the dashboard traces back to a real field — none
// of it is illustrative.

export const OPEN_STAGES = [
  {
    key: "prospecting",
    label: "Prospecting",
    // Includes leads with no next action set yet — they are untouched, which
    // is the top of the funnel by definition.
    actions: ["Call Back", "Follow-Up", ""],
  },
  {
    key: "qualification",
    label: "Qualification",
    actions: ["Online Meeting", "On-Site Meeting"],
  },
  { key: "proposal", label: "Proposal", actions: ["Proposal Submitted"] },
  { key: "negotiation", label: "Negotiation", actions: ["Negotiation"] },
];

// Statuses that take a lead out of the open pipeline entirely.
const WON = "WON";
const DEAD_STATUSES = ["LOST", "Junk", "Duplicate"];

const statusOf = (lead) => (lead?.companyInfo?.leadStatus || "").trim();
const actionOf = (lead) => (lead?.companyInfo?.nextAction || "").trim();

export const isWon = (lead) => statusOf(lead) === WON;
export const isDead = (lead) => DEAD_STATUSES.includes(statusOf(lead));
export const isOpen = (lead) => !isWon(lead) && !isDead(lead);

// Expected deal value in INR. Blank / non-numeric contributes nothing rather
// than silently counting as zero-with-confidence.
export const dealValue = (lead) => {
  const raw = lead?.companyInfo?.expectedDealValue;
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

const todayMidnight = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

// A lead is overdue when its next-action date has passed and it is still open.
export const isOverdue = (lead) => {
  if (!isOpen(lead)) return false;
  const raw = lead?.companyInfo?.dateField;
  if (!raw) return false;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return false;
  d.setHours(0, 0, 0, 0);
  return d < todayMidnight();
};

// Which stage a single lead sits in. Mirrors buildPipeline's grouping so the
// board and the counts can never disagree.
// Maps the stored stage label onto a column key.
const STAGE_BY_LABEL = {
  prospecting: "prospecting",
  qualification: "qualification",
  proposal: "proposal",
  negotiation: "negotiation",
  "closed-won": "won",
};

export const stageOf = (lead) => {
  if (isWon(lead)) return "won";
  if (isDead(lead)) return null;

  // An explicitly chosen stage always wins. Only leads created before the field
  // existed fall back to inferring one from the next action.
  const stored = (lead?.companyInfo?.pipelineStage || "").trim().toLowerCase();
  if (STAGE_BY_LABEL[stored]) return STAGE_BY_LABEL[stored];

  const action = actionOf(lead);
  const stage = OPEN_STAGES.find((s) => s.actions.includes(action));
  return stage ? stage.key : "prospecting";
};

// Counts, values and derived headline figures for a set of leads.
export function buildPipeline(leads = []) {
  const open = leads.filter(isOpen);
  const won = leads.filter(isWon);

  const stages = OPEN_STAGES.map((stage) => {
    const inStage = open.filter((l) => stage.actions.includes(actionOf(l)));
    const values = inStage.map(dealValue).filter((v) => v !== null);
    return {
      ...stage,
      count: inStage.length,
      value: values.reduce((a, b) => a + b, 0),
    };
  });

  const wonValues = won.map(dealValue).filter((v) => v !== null);
  const closedWon = {
    key: "won",
    label: "Closed-Won",
    count: won.length,
    value: wonValues.reduce((a, b) => a + b, 0),
  };

  const openValues = open.map(dealValue).filter((v) => v !== null);
  const totalValue = openValues.reduce((a, b) => a + b, 0);

  const overdue = open.filter(isOverdue).length;

  // Health = share of open leads that are not overdue on their next action.
  // Stated plainly in the UI so the number is not mistaken for a black box.
  const health = open.length === 0
    ? 100
    : Math.round(((open.length - overdue) / open.length) * 100);

  const decided = won.length + leads.filter((l) => statusOf(l) === "LOST").length;
  const winRate = decided === 0 ? null : Math.round((won.length / decided) * 100);

  return {
    stages,
    closedWon,
    openCount: open.length,
    totalValue,
    // Average over leads that actually carry a value, not over all leads.
    valuedCount: openValues.length,
    avgValue: openValues.length ? Math.round(totalValue / openValues.length) : 0,
    overdue,
    health,
    winRate,
  };
}

// Compact INR formatting — crore / lakh, matching how the rest of the app
// talks about money (turnover options are written as "10-50Cr").
export function formatINR(value) {
  if (!value) return "₹0";
  if (value >= 10000000) return `₹${(value / 10000000).toFixed(2)}Cr`;
  if (value >= 100000) return `₹${(value / 100000).toFixed(2)}L`;
  if (value >= 1000) return `₹${(value / 1000).toFixed(1)}K`;
  return `₹${value}`;
}
