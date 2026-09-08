// Strict-template Bulk Import: no fuzzy header guessing, no manual mapping.
// A file is only ever accepted if its header row matches the CRM Lead
// Data Entry Template's 58 columns exactly — same count, same headers, same
// order. Anything else is rejected outright, with the exact mismatch shown,
// before a single row is even looked at. This trades the earlier "handle
// any vendor format" flexibility for a much stronger guarantee: if it's
// accepted, every column landed exactly where it was meant to.

const { normalizeText, normalizePhone, normalizeEmail } = require("./bulkImportTransform");

// One entry per column, in the exact order the template defines them.
// `path` is where the value lands in the lead object; a column with no
// `path` (BDM, Next Action, Action Date, Lead Status) is preserved as
// informational text in the description instead of overwriting a real
// field — those tie into workflow state that a fresh Cold-pool import
// shouldn't set unilaterally.
const TEMPLATE_COLUMNS = [
  { header: "Company Name", path: ["companyInfo", "companyName"] },
  { header: "Lead Type [DROPDOWN]", path: ["companyInfo", "leadType"] },
  { header: "Vertical [DROPDOWN]", path: ["companyInfo", "vertical"] },
  { header: "Lead Assigned To (Name)", label: "Lead Assigned To" },
  { header: "BDM (Name)", label: "BDM" },
  { header: "Lead Status [DROPDOWN]", label: "Lead Status (source file)" },
  { header: "Lead Source [DROPDOWN]", path: ["companyInfo", "leadSource"] },
  { header: "Priority [DROPDOWN]", path: ["companyInfo", "priority"] },
  { header: "Next Action [DROPDOWN]", label: "Next Action" },
  { header: "Action Date (DD/MM/YYYY)", label: "Action Date" },
  { header: "Lead Usable [DROPDOWN]", path: ["companyInfo", "leadUsable"] },
  { header: "Reason (if Not Usable)", path: ["companyInfo", "reason"] },
  { header: "Address", path: ["companyInfo", "address"] },
  { header: "Country", path: ["companyInfo", "country"] },
  { header: "State", path: ["companyInfo", "state"] },
  { header: "City", path: ["companyInfo", "city"] },
  { header: "IT - Name", path: ["contactInfo", "it", "name"] },
  { header: "IT - Designation", path: ["contactInfo", "it", "designation"] },
  { header: "IT - Mobile No. 1", path: ["contactInfo", "it", "mobile"], kind: "phone" },
  { header: "IT - Mobile No. 2", label: "IT Mobile 2" },
  { header: "IT - Email", path: ["contactInfo", "it", "email"], kind: "email" },
  { header: "IT - Personal Email", path: ["contactInfo", "it", "personalEmail"], kind: "email" },
  { header: "Business - Name", path: ["contactInfo", "businessHead", "name"] },
  { header: "Business - Designation", path: ["contactInfo", "businessHead", "designation"] },
  { header: "Business - Mobile No. 1", path: ["contactInfo", "businessHead", "mobile"], kind: "phone" },
  { header: "Business - Mobile No. 2", label: "Business Mobile 2" },
  { header: "Business - Email", path: ["contactInfo", "businessHead", "email"], kind: "email" },
  { header: "Business - Personal Email", path: ["contactInfo", "businessHead", "personalEmail"], kind: "email" },
  { header: "Finance - Name", path: ["contactInfo", "finance", "name"] },
  { header: "Finance - Designation", path: ["contactInfo", "finance", "designation"] },
  { header: "Finance - Mobile No. 1", path: ["contactInfo", "finance", "mobile"], kind: "phone" },
  { header: "Finance - Mobile No. 2", label: "Finance Mobile 2" },
  { header: "Finance - Email", path: ["contactInfo", "finance", "email"], kind: "email" },
  { header: "Finance - Personal Email", path: ["contactInfo", "finance", "personalEmail"], kind: "email" },
  { header: "NN: Using ERP [DROPDOWN]", path: ["itLandscape", "netNew", "usingERP"] },
  { header: "NN: Budget", path: ["itLandscape", "netNew", "budget"] },
  { header: "NN: Opportunity [DROPDOWN]", path: ["itLandscape", "netNew", "opportunityForUs1"] },
  { header: "NN: If Yes - ERP [DROPDOWN]", path: ["itLandscape", "netNew", "ifYesWhichOne"] },
  { header: "NN: If No - Why [DROPDOWN]", path: ["itLandscape", "netNew", "ifNoWhy"] },
  { header: "NN: Authority", path: ["itLandscape", "netNew", "authority"] },
  { header: "NN: Opportunity Value (Num)", path: ["itLandscape", "netNew", "opportunityValue1"] },
  { header: "NN: Need", path: ["itLandscape", "netNew", "need"] },
  { header: "NN: Timeframe [DROPDOWN]", path: ["itLandscape", "netNew", "timeframe"] },
  { header: "SAP: Opportunity Available [DROPDOWN]", path: ["itLandscape", "SAPInstalledBase", "opportunityForUs2"] },
  { header: "SAP: Year of Implementation", path: ["itLandscape", "SAPInstalledBase", "yearOfImplementation"] },
  { header: "SAP: No. of Users (Num)", path: ["itLandscape", "SAPInstalledBase", "noOfUsers"] },
  { header: "SAP: Opportunity Value (Num)", path: ["itLandscape", "SAPInstalledBase", "opportunityValue2"] },
  { header: "SAP: Contract Expiry [DROPDOWN]", path: ["itLandscape", "SAPInstalledBase", "contractExpiry"] },
  { header: "SAP: Support Partner [DROPDOWN]", path: ["itLandscape", "SAPInstalledBase", "supportPartner"] },
  { header: "SAP: Opportunity For [DROPDOWN]", path: ["itLandscape", "SAPInstalledBase", "opportunityForUs3"] },
  { header: "SAP: Exact Version [DROPDOWN]", path: ["itLandscape", "SAPInstalledBase", "exactVersion"] },
  { header: "SAP: Hardware", path: ["itLandscape", "SAPInstalledBase", "hardware"] },
  { header: "SAP: No. of License (Num)", path: ["itLandscape", "SAPInstalledBase", "noOfLicense"] },
  { header: "SAP: License Value", path: ["itLandscape", "SAPInstalledBase", "licenseValue"] },
  { header: "SAP: Modules Implemented", path: ["itLandscape", "SAPInstalledBase", "modulesImplemented"] },
  { header: "SAP: Implementation Partner", path: ["itLandscape", "SAPInstalledBase", "implementationPartner"] },
  { header: "SAP: Total Project Cost", path: ["itLandscape", "SAPInstalledBase", "totalProjectCost"] },
  { header: "Description", path: ["description"] },
];

function setPath(obj, path, value) {
  let node = obj;
  for (let i = 0; i < path.length - 1; i++) {
    node[path[i]] = node[path[i]] || {};
    node = node[path[i]];
  }
  node[path[path.length - 1]] = value;
}

function normalizeByKind(kind, raw) {
  if (kind === "phone") return normalizePhone(raw);
  if (kind === "email") return normalizeEmail(raw);
  return normalizeText(raw);
}

// Strips the noise a real-world copy of the template accumulates — trailing
// spaces, curly-vs-straight punctuation, case — before comparing header text,
// so a harmless re-save in Excel doesn't fail the check on its own.
function normalizeHeaderForCompare(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const EXPECTED_NORMALIZED = TEMPLATE_COLUMNS.map((c) => normalizeHeaderForCompare(c.header));

// Compares the file's actual header row against the template column by
// column. Returns { valid, mismatches } — mismatches lists every position
// that's wrong (including "expected a column here, file has none" and "file
// has an extra column here") so the rejection message can be specific
// instead of just "doesn't match."
function validateAgainstTemplate(headers) {
  const actual = headers.map(normalizeHeaderForCompare);
  const maxLen = Math.max(actual.length, EXPECTED_NORMALIZED.length);
  const mismatches = [];

  for (let i = 0; i < maxLen; i++) {
    const expected = TEMPLATE_COLUMNS[i]?.header;
    const found = headers[i];
    if (actual[i] !== EXPECTED_NORMALIZED[i]) {
      mismatches.push({
        column: i + 1,
        expected: expected || "(no column expected here)",
        found: found || "(missing — file has no column here)",
      });
    }
  }

  return { valid: mismatches.length === 0, mismatches };
}

// Builds one lead object straight from a data row's cell positions — no
// header-name matching at all at this point, since validateAgainstTemplate
// already confirmed every position means exactly what TEMPLATE_COLUMNS says
// it means.
function buildLeadFromTemplateRow(row, meta) {
  const companyInfo = {};
  const contactInfo = { it: {}, finance: {}, businessHead: {}, additional: [] };
  const itLandscape = { netNew: {}, SAPInstalledBase: {} };
  const infoNotes = [];
  let description = "";

  TEMPLATE_COLUMNS.forEach((col, i) => {
    const raw = row[i];
    const value = normalizeByKind(col.kind, raw);
    if (!value) return;

    if (col.header === "Description") {
      description = value;
      return;
    }
    if (col.path) {
      const root = col.path[0] === "companyInfo" ? companyInfo
        : col.path[0] === "contactInfo" ? contactInfo
        : col.path[0] === "itLandscape" ? itLandscape
        : null;
      if (root) setPath(root, col.path.slice(1), value);
      return;
    }
    // No path — informational only (BDM, Next Action, Action Date, source
    // Lead Status, secondary mobiles): preserved as text, not written to a
    // real field.
    infoNotes.push(`${col.label || col.header}: ${value}`);
  });

  const missingFields = [];
  if (!contactInfo.it.name && !contactInfo.businessHead.name && !contactInfo.finance.name) {
    missingFields.push("A contact person's name");
  }
  const hasReach = [
    contactInfo.it.mobile, contactInfo.it.email,
    contactInfo.finance.mobile, contactInfo.finance.email,
    contactInfo.businessHead.mobile, contactInfo.businessHead.email,
  ].some(Boolean);
  if (!hasReach) missingFields.push("A phone number or email to reach them on");

  const descriptionParts = [
    description || `Bulk-imported from "${meta.originalFileName}" on ${new Date().toISOString().slice(0, 10)} — this lead needs a call to qualify.`,
  ];
  if (infoNotes.length) {
    descriptionParts.push(`Source file details: ${infoNotes.join("; ")}`);
  }

  companyInfo.leadStatus = "Cold (9+ months)";
  companyInfo.leadUsable = companyInfo.leadUsable || "Yes";
  companyInfo.importMeta = {
    source: "bulk_excel_template",
    originalFileName: meta.originalFileName,
    importedBy: meta.importedBy,
    importedAt: new Date().toISOString(),
    missingFields,
  };

  return {
    companyInfo,
    contactInfo,
    itLandscape,
    descriptions: [
      {
        description: descriptionParts.join(" "),
        type: "description",
        addedBy: meta.importedBy || null,
        createdAt: new Date().toISOString(),
      },
    ],
    createdBy: meta.importedBy || null,
  };
}

// Runs every data row through the strict template builder. A row is only
// ever skipped for a blank company name — same rule as before, just with no
// mapping ambiguity left to cause it.
function transformTemplateRows({ rows, headerRowIndex, originalFileName, importedBy }) {
  const dataRows = rows.slice(headerRowIndex + 1);
  const leadsData = [];
  const skipped = [];

  dataRows.forEach((row, i) => {
    const rowNumber = headerRowIndex + 2 + i;
    const isBlankRow = row.every((c) => normalizeText(c) === "");
    if (isBlankRow) return;

    const leadData = buildLeadFromTemplateRow(row, { originalFileName, importedBy });
    if (!leadData.companyInfo.companyName) {
      skipped.push({ row: rowNumber, reason: "Missing company name" });
      return;
    }
    leadsData.push(leadData);
  });

  return { leadsData, skipped };
}

module.exports = {
  TEMPLATE_COLUMNS,
  validateAgainstTemplate,
  transformTemplateRows,
};
