/**
 * One-off import of the "Net new" sheet into the CRM as leads.
 *
 * Goes through POST /api/leads rather than writing to the table directly, so
 * the import gets the same duplicate-name check, lead-number sequence, audit
 * entry and live-update broadcast as a lead typed into the form.
 *
 * Fields absent from the spreadsheet are left empty rather than invented.
 *
 * Usage:  node scratch/import_net_new.js <path-to-net_new.json> [--dry-run]
 */
require("dotenv").config();
const fs = require("fs");
const jwt = require("jsonwebtoken");

const SRC = process.argv[2];
const DRY = process.argv.includes("--dry-run");
const API = `http://localhost:${(process.env.PORT || "4100").trim()}`;
const IMPORTER_ID = 4; // admin@sagetl.com — recorded as the creator

if (!SRC || !fs.existsSync(SRC)) {
  console.error("Usage: node scratch/import_net_new.js <net_new.json> [--dry-run]");
  process.exit(1);
}

// --- mapping helpers -------------------------------------------------------

// Spreadsheet industry text -> the CRM's fixed vertical list. Anything without
// a confident match is left blank; a wrong vertical is worse than no vertical.
const VERTICAL_RULES = [
  [/real estate|realty|infrastructure|construction|builder|housing|develop/i, "Real Estate / Construction"],
  [/\bepc\b/i, "EPC"],
  [/solar|renewable|power|energy/i, "Solar / Renewable / Power"],
  [/pharma|healthcare|surgical|device|nutraceutical|life science|diagnos|medical/i, "Pharma / Equip. (Surgical) / Healthcare / Device Manufacturing"],
  [/chemical|fertilizer|process/i, "Chemicals / Process / Fertilizers"],
  [/auto|automotive|vehicle/i, "Auto / Auto Ancillary"],
  [/textile|garment|spinning|footwear|leather|apparel/i, "Textile / Spinning / Garments / Footwear / Leather"],
  [/electronic|mobile|semiconductor/i, "Mobiles / Electronics"],
  [/fmcg|beverage|food|grocery|beauty|skincare/i, "FMCG"],
  [/e-?commerce|online|marketplace|travel agency/i, "E-commerce"],
  [/bank|financial|insurance|bfsi/i, "BFSI"],
  [/railway|psu/i, "PSU's / QUASSI"],
];

function toVertical(industry) {
  if (!industry) return "";
  for (const [re, value] of VERTICAL_RULES) if (re.test(industry)) return value;
  return "";
}

// "1,060 Crore" / "675 Cr" / "2,500+ Cr" -> one of the CRM's turnover bands.
function toTurnoverBand(text) {
  if (!text) return "";
  const m = String(text).replace(/,/g, "").match(/([\d.]+)/);
  if (!m) return "";
  const cr = parseFloat(m[1]);
  if (!isFinite(cr)) return "";
  if (cr < 10) return "<10Cr";
  if (cr < 50) return "10-50Cr";
  if (cr < 100) return "50-100Cr";
  return "100Cr+";
}

const ERP_OPTIONS = ["Microsoft", "Oracle", "Infor", "Epicor", "SAP B1", "SAP BYD", "Tally"];
function toErpOption(text) {
  if (!text) return "";
  for (const opt of ERP_OPTIONS) {
    if (new RegExp(opt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(text)) return opt;
  }
  return "Other ERP";
}

// "Thane (West), Maharashtra" -> { city, state }. Only splits on the last
// comma; a single-part value is treated as the city.
const KNOWN_STATES = [
  "Maharashtra","Delhi","Karnataka","Haryana","Uttar Pradesh","Tamil Nadu","Gujarat",
  "Rajasthan","West Bengal","Punjab","Telangana","Madhya Pradesh","Chhattisgarh",
  "Kerala","Bihar","Odisha","Jammu","Daman","UP",
];
function splitLocation(loc) {
  if (!loc) return { city: "", state: "" };
  const parts = loc.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return { city: "", state: "" };
  const last = parts[parts.length - 1];
  const state = KNOWN_STATES.find((s) => s.toLowerCase() === last.toLowerCase());
  if (state && parts.length > 1) {
    return { city: parts.slice(0, -1).join(", "), state: state === "UP" ? "Uttar Pradesh" : state };
  }
  const asState = KNOWN_STATES.find((s) => s.toLowerCase() === parts[0].toLowerCase());
  if (asState && parts.length === 1) return { city: "", state: asState };
  return { city: parts.join(", "), state: "" };
}

// The sheet has three undifferentiated contacts; the CRM has three labelled
// slots. Route by job title, and put anyone left over in the first free slot
// rather than dropping them.
function routeContacts(contacts) {
  const slots = { it: null, finance: null, businessHead: null };
  const leftovers = [];

  for (const c of contacts) {
    const d = (c.desig || "").toLowerCase();
    let slot = null;
    if (/\b(it|cio|cto|tech|system|erp|digital|infra)\b/.test(d)) slot = "it";
    else if (/\b(cfo|financ|account|f&a|audit)\b/.test(d)) slot = "finance";
    else if (/\b(ceo|md|director|vp|president|head|owner|chairman|coo)\b/.test(d)) slot = "businessHead";

    if (slot && !slots[slot]) slots[slot] = c;
    else leftovers.push(c);
  }
  for (const c of leftovers) {
    const free = ["businessHead", "it", "finance"].find((k) => !slots[k]);
    if (free) slots[free] = c;
  }

  const shape = (c) => ({
    name: c?.name || "",
    designation: c?.desig || "",
    mobile: c?.phone || "",
    email: c?.email || "",
    dlExt: "",
    personalEmail: "",
  });
  return {
    itName: shape(slots.it).name, itDesignation: shape(slots.it).designation,
    itMobile: shape(slots.it).mobile, itEmail: shape(slots.it).email,
    financeName: shape(slots.finance).name, financeDesignation: shape(slots.finance).designation,
    financeMobile: shape(slots.finance).mobile, financeEmail: shape(slots.finance).email,
    businessHeadName: shape(slots.businessHead).name,
    businessHeadDesignation: shape(slots.businessHead).designation,
    businessHeadMobile: shape(slots.businessHead).mobile,
    businessHeadEmail: shape(slots.businessHead).email,
  };
}

// --- run -------------------------------------------------------------------

(async () => {
  const records = JSON.parse(fs.readFileSync(SRC, "utf-8"));
  const token = jwt.sign(
    { email: "admin@sagetl.com", _id: IMPORTER_ID, role: "admin" },
    process.env.JWT_SECRET,
    { expiresIn: "60m" }
  );

  let created = 0, skipped = 0, failed = 0;
  const problems = [];

  for (const [i, r] of records.entries()) {
    const name = (r.companyName || "").trim();
    if (!name) { skipped++; problems.push(`row ${i + 1}: no company name`); continue; }

    const { city, state } = splitLocation(r.location);
    const contacts = routeContacts(r.contacts || []);

    // Anything the CRM has no column for is preserved here rather than lost.
    const notes = [
      "Imported from the 'Net new' spreadsheet.",
      r.industry ? `Industry (as listed): ${r.industry}` : "",
      r.turnover ? `Turnover (as listed): ${r.turnover}` : "",
      r.erp ? `Existing ERP: ${r.erp}` : "",
      r.location ? `Location (as listed): ${r.location}` : "",
    ].filter(Boolean).join("\n");

    const payload = {
      company: {
        companyName: name,
        vertical: toVertical(r.industry),
        city, state,
        country: city || state ? "India" : "",
        turnOverINR: toTurnoverBand(r.turnover),
        leadSource: "Existing Database",
        // Left empty on purpose — the sheet says nothing about these:
        leadType: "", leadStatus: "", priority: "", leadAssignedTo: null,
        website: "", address: "", genericEmail1: "", genericEmail2: "",
        genericPhone1: "", genericPhone2: "", bdm: "", nextAction: "",
        leadUsable: "", employeeCount: "", reason: "", expectedDealValue: "",
        pipelineStage: "", dateField: "",
        aboutTheCompany: r.industry || "",
      },
      contact: contacts,
      itLandscape: {
        netNew: r.erp ? { currentERP: toErpOption(r.erp), currentERPRaw: r.erp } : {},
        SAPInstalledBase: {},
      },
      description: notes,
      selectedOption: "",
      radioValue: "",
      createdBy: IMPORTER_ID,
    };

    if (DRY) {
      if (i < 3) console.log(JSON.stringify(payload.company, null, 1));
      created++;
      continue;
    }

    const form = new FormData();
    form.append("data", JSON.stringify(payload));

    try {
      const res = await fetch(`${API}/api/leads`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 201) {
        created++;
        console.log(`  ok   #${body.leadNumber}  ${name}`);
      } else if (res.status === 409) {
        skipped++;
        problems.push(`${name}: duplicate — ${body.error || "already exists"}`);
      } else {
        failed++;
        problems.push(`${name}: HTTP ${res.status} — ${body.error || JSON.stringify(body)}`);
      }
    } catch (err) {
      failed++;
      problems.push(`${name}: ${err.message}`);
    }
  }

  console.log("\n==============================");
  console.log(DRY ? "DRY RUN — nothing written" : "IMPORT COMPLETE");
  console.log(`created: ${created}   skipped: ${skipped}   failed: ${failed}`);
  if (problems.length) {
    console.log("\nnot imported:");
    problems.forEach((p) => console.log("  - " + p));
  }
  process.exit(0);
})();
