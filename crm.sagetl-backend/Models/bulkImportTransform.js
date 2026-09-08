// Turns an arbitrary, unpredictable vendor Excel file into an array of
// lead-shaped objects ready to insert as Cold leads. This is the
// "middleware" layer: it never assumes a fixed column layout — it works off
// whatever mapping the admin confirmed in the UI, with best-effort
// auto-detection to make that mapping step usually require little or no
// manual correction.

const ExcelJS = require("exceljs");
const { FIELD_CATALOG, REACH_FIELD_KEYS } = require("./bulkImportFields");

const FIELD_BY_KEY = new Map(FIELD_CATALOG.map((f) => [f.key, f]));

// --- Workbook reading ------------------------------------------------------

async function readWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook;
}

// Every row of a sheet as a plain array of cell text/values, blank rows kept
// (as all-empty arrays) so row numbers still line up with the original file
// for error reporting.
function sheetToRows(worksheet) {
  const rows = [];
  const maxCol = worksheet.columnCount || 0;
  worksheet.eachRow({ includeEmpty: true }, (row) => {
    const cells = [];
    for (let c = 1; c <= maxCol; c++) {
      cells.push(cellToValue(row.getCell(c)));
    }
    rows.push(cells);
  });
  return rows;
}

function cellToValue(cell) {
  const v = cell?.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    // Rich text / hyperlink / formula-result objects.
    if (v.text !== undefined) return String(v.text);
    if (v.result !== undefined) return v.result;
    if (v instanceof Date) return v;
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join("");
    return "";
  }
  return v;
}

// --- Header row auto-detection ---------------------------------------------

// Vendor files often have a title row, a logo row, or an instructions line
// before the real header. Scores the first N rows on how "header-like" they
// look (short, mostly-unique, mostly-text, mostly-filled) and returns the
// best one instead of blindly assuming row 0.
function detectHeaderRowIndex(rows, scanLimit = 10) {
  let bestIndex = 0;
  let bestScore = -Infinity;
  const limit = Math.min(scanLimit, rows.length);
  for (let i = 0; i < limit; i++) {
    const row = rows[i];
    const filled = row.filter((c) => String(c ?? "").trim() !== "");
    if (filled.length === 0) continue;
    const texts = filled.map((c) => String(c).trim());
    const unique = new Set(texts.map((t) => t.toLowerCase()));
    const numericCount = texts.filter((t) => /^-?\d+(\.\d+)?$/.test(t)).length;
    const avgLen = texts.reduce((s, t) => s + t.length, 0) / texts.length;
    let score = 0;
    score += filled.length; // more filled cells = more likely a real header
    score += (unique.size / texts.length) * 5; // headers rarely repeat
    score -= numericCount * 3; // a data row full of numbers isn't a header
    score -= Math.max(0, avgLen - 40) * 0.1; // a long sentence is a title/instructions row, not a header
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  return bestIndex;
}

// --- Fuzzy header -> canonical field suggestion -----------------------------

function normalizeHeaderText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Best-guess mapping: for each catalog field, find the source header whose
// normalized text matches one of its aliases exactly, or contains/​is
// contained by one. Each source header is used at most once.
function suggestMapping(headers, excludeHeaders) {
  const excluded = excludeHeaders instanceof Set ? excludeHeaders : new Set(excludeHeaders || []);
  const normalizedHeaders = headers.map((h) => normalizeHeaderText(h));

  // A generic alias like "name" matching by bare substring would greedily
  // grab "Comp Name" for the IT contact before Company Name — which has no
  // exact alias for that header — ever gets considered, if fields were
  // resolved one at a time in catalog order. Instead every (field, header)
  // pair is scored up front, then assigned globally best-match-first, so a
  // strong, specific match always wins over a weak, generic one regardless
  // of which field happens to come first in the catalog. Any header already
  // claimed as a combined/composite column (e.g. "Name | Mobile | Email")
  // is excluded entirely — mapping it whole to one field would dump raw
  // unsplit text into that field instead of letting the split-rule
  // detector break it apart properly.
  const candidates = [];
  FIELD_CATALOG.forEach((field) => {
    normalizedHeaders.forEach((h, headerIdx) => {
      if (!h || excluded.has(headers[headerIdx])) return;
      const rank = scoreAliasMatch(h, field.aliases);
      if (rank <= 0) return;
      const bestAliasLen = Math.max(...field.aliases.filter((a) => h.includes(a) || a === h).map((a) => a.length), 0);
      candidates.push({ field: field.key, headerIdx, rank, specificity: bestAliasLen });
    });
  });

  // Highest rank first; within the same rank, the longer (more specific)
  // alias wins — "company name" beats "name" for the same header.
  candidates.sort((a, b) => b.rank - a.rank || b.specificity - a.specificity);

  const usedHeaders = new Set();
  const usedFields = new Set();
  const mapping = {};
  for (const c of candidates) {
    if (usedHeaders.has(c.headerIdx) || usedFields.has(c.field)) continue;
    mapping[c.field] = headers[c.headerIdx];
    usedHeaders.add(c.headerIdx);
    usedFields.add(c.field);
  }
  return mapping;
}

// 3 = exact match after normalization. 2 = the alias appears as a whole
// word inside the header (word-boundary, not just a raw substring — "name"
// matching inside "surname" would be wrong). 1 = plain substring either
// direction, the weakest signal. 0 = no match.
function scoreAliasMatch(header, aliases) {
  if (aliases.includes(header)) return 3;
  const hasWholeWord = aliases.some((a) => new RegExp(`(^|\\s)${escapeRegExp(a)}(\\s|$)`).test(header));
  if (hasWholeWord) return 2;
  const hasSubstring = aliases.some((a) => header.includes(a) || a.includes(header));
  if (hasSubstring) return 1;
  return 0;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// --- Auto split-rule detection ------------------------------------------
// Fully automatic mode has no admin around to say "this column is really
// Name | Mobile | Email, split it" — so this looks for exactly that pattern
// on its own, in two phases:
//
//  1. detectCompositeHeaders — scans every header's real sample values for
//     a delimiter that consistently breaks it into 2+ parts, where at least
//     one part looks like a phone or email. This runs BEFORE suggestMapping
//     and its result is fed back in as an exclude list — otherwise a
//     generic alias (like "name") would grab the whole composite column for
//     one field before this ever got a look at it, and the column would be
//     saved as one unsplit blob instead of properly broken apart.
//  2. buildSplitRules — once suggestMapping has run on the *remaining*
//     headers, each composite header is assigned to the first still-open
//     contact bucket (IT, then Finance, then Business Head) that the final
//     mapping hasn't already claimed.

const DELIMITER_CANDIDATES = ["|", ";", "/", ","];

function classifyPart(value) {
  const v = normalizeText(value);
  if (!v) return null;
  if (/@/.test(v)) return "email";
  const digitCount = (v.match(/\d/g) || []).length;
  if (digitCount >= 7 && digitCount >= v.replace(/\s/g, "").length * 0.6) return "phone";
  return "name";
}

const CONTACT_BUCKETS = [
  { name: "itName", phone: "itMobile", email: "itEmail" },
  { name: "financeName", phone: "financeMobile", email: "financeEmail" },
  { name: "businessHeadName", phone: "businessHeadMobile", email: "businessHeadEmail" },
];

// Returns a Map<header, { delimiter, positionLabels }> for every header that
// looks like a combined contact column — independent of any field mapping.
function detectCompositeHeaders(headers, sampleValuesByHeader) {
  const composite = new Map();

  headers.forEach((header) => {
    const values = (sampleValuesByHeader[header] || []).map(normalizeText).filter(Boolean);
    if (values.length < 2) return;

    // Find a delimiter that actually splits most of this column's real
    // values into more than one piece — not just present once by accident.
    const delimiter = DELIMITER_CANDIDATES.find((d) => {
      const hitCount = values.filter((v) => v.split(d).length >= 2).length;
      return hitCount / values.length >= 0.6;
    });
    if (!delimiter) return;

    const splitSamples = values.map((v) => v.split(delimiter).map((p) => p.trim()));
    const partCount = mostCommon(splitSamples.map((parts) => parts.length));
    if (partCount < 2) return;

    // Classify each column position by what most of its values look like.
    const positionLabels = [];
    for (let i = 0; i < partCount; i++) {
      const partsAtPos = splitSamples.filter((parts) => parts.length === partCount).map((parts) => parts[i]);
      const labels = partsAtPos.map(classifyPart).filter(Boolean);
      positionLabels.push(mostCommon(labels) || "name");
    }
    // Require at least one recognizable phone or email — a plain word split
    // with no structure isn't confidently a contact-combo column, so it's
    // left alone rather than guessed wrong (and stays eligible for a normal
    // single-field mapping instead).
    if (!positionLabels.includes("phone") && !positionLabels.includes("email")) return;

    composite.set(header, { delimiter, positionLabels });
  });

  return composite;
}

// Assigns each composite header to the first contact bucket whose *specific
// slots this column actually needs* aren't already taken — e.g. a
// Name+Mobile-only composite column only needs a bucket's name and phone
// slots free, and shouldn't be turned away just because that bucket's email
// slot is already filled by some other, directly-mapped column.
function buildSplitRules(compositeInfo, mapping) {
  const usedFieldKeys = new Set(Object.keys(mapping || {}));
  const rules = [];

  compositeInfo.forEach(({ delimiter, positionLabels }, header) => {
    const neededLabels = new Set(positionLabels);
    const bucket = CONTACT_BUCKETS.find((b) =>
      [...neededLabels].every((label) => !usedFieldKeys.has(b[label] || b.name))
    );
    if (!bucket) return;

    const targets = positionLabels.map((label) => bucket[label] || bucket.name);
    targets.forEach((key) => usedFieldKeys.add(key));
    rules.push({ sourceHeader: header, delimiter, targets });
  });

  return rules;
}

// Convenience wrapper for callers that don't need the two phases split
// apart — runs composite detection, then suggestMapping excluding those
// headers, then builds the split rules against the resulting mapping.
function autoMapAndSplit(headers, sampleValuesByHeader) {
  const compositeInfo = detectCompositeHeaders(headers, sampleValuesByHeader);
  const mapping = suggestMapping(headers, new Set(compositeInfo.keys()));
  const splitRules = buildSplitRules(compositeInfo, mapping);
  return { mapping, splitRules };
}

function mostCommon(list) {
  if (!list.length) return undefined;
  const counts = new Map();
  list.forEach((v) => counts.set(v, (counts.get(v) || 0) + 1));
  let best = list[0];
  let bestCount = 0;
  counts.forEach((count, value) => {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  });
  return best;
}

// --- Value normalizers -------------------------------------------------

function normalizeText(raw) {
  if (raw === null || raw === undefined) return "";
  return String(raw).replace(/\s+/g, " ").trim();
}

function normalizePhone(raw) {
  const text = normalizeText(raw);
  if (!text) return "";
  const hadCountryCode = /^\+/.test(text.trim());
  let digits = text.replace(/\D/g, "");
  // A leading "91" is only actually India's country code when it was
  // explicitly written with a '+', or when the digit count is long enough
  // that it can't just be a bare 10-digit mobile number that happens to
  // start with 91 (e.g. 9123456789 is a real, valid number on its own —
  // stripping its first two digits as a "country code" would silently
  // corrupt it into an 8-digit number).
  if (digits.startsWith("91") && (hadCountryCode || digits.length > 10)) {
    digits = digits.slice(2);
  }
  digits = digits.replace(/^0+/, "");
  return digits;
}

function normalizeEmail(raw) {
  const text = normalizeText(raw).toLowerCase();
  if (!text) return "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? text : "";
}

function normalizeByKind(kind, raw) {
  if (kind === "phone") return normalizePhone(raw);
  if (kind === "email") return normalizeEmail(raw);
  return normalizeText(raw);
}

// A handful of fields worth flagging as "please fill this in" on the lead
// itself once someone pulls it and calls the contact — not the full catalog,
// just the ones that actually matter for working the lead day to day.
const CORE_FOLLOWUP_KEYS = ["vertical", "city", "itName"];

function isBlank(v) {
  return v === undefined || v === null || String(v).trim() === "";
}

// Builds one company/contact-shaped lead object out of a single data row,
// applying split rules first (one messy source column fanning out into
// several target fields), then the direct one-to-one column mapping for
// anything a split rule didn't already cover. Any source column that ended
// up unused is preserved as free text on the lead's description rather than
// silently dropped.
function buildRowFieldValues(row, headers, mapping, splitRules) {
  const valuesByHeader = {};
  headers.forEach((h, idx) => {
    valuesByHeader[h] = row[idx];
  });

  const fieldValues = {};
  const consumedHeaders = new Set();

  (splitRules || []).forEach((rule) => {
    if (!rule.sourceHeader || !Array.isArray(rule.targets) || !rule.targets.length) return;
    consumedHeaders.add(rule.sourceHeader);
    const raw = normalizeText(valuesByHeader[rule.sourceHeader]);
    if (!raw) return;
    const delimiter = rule.delimiter || ",";
    const parts = raw.split(delimiter).map((p) => p.trim());
    rule.targets.forEach((key, i) => {
      if (key && parts[i] && !fieldValues[key]) {
        const field = FIELD_BY_KEY.get(key);
        fieldValues[key] = normalizeByKind(field?.kind, parts[i]);
      }
    });
  });

  Object.entries(mapping || {}).forEach(([key, header]) => {
    if (!header || fieldValues[key]) return;
    consumedHeaders.add(header);
    const field = FIELD_BY_KEY.get(key);
    fieldValues[key] = normalizeByKind(field?.kind, valuesByHeader[header]);
  });

  const leftoverNotes = [];
  headers.forEach((h) => {
    if (consumedHeaders.has(h)) return;
    const raw = normalizeText(valuesByHeader[h]);
    if (raw) leftoverNotes.push(`${h}: ${raw}`);
  });

  return { fieldValues, leftoverNotes };
}

function buildLeadDataFromFields(fieldValues, leftoverNotes, meta) {
  const missingFields = CORE_FOLLOWUP_KEYS
    .filter((key) => isBlank(fieldValues[key]))
    .map((key) => FIELD_BY_KEY.get(key)?.label || key);

  const hasReach = REACH_FIELD_KEYS.some((key) => !isBlank(fieldValues[key]));
  if (!hasReach) missingFields.push("A phone number or email to reach them on");

  const descriptionParts = [
    `Bulk-imported from "${meta.originalFileName}" on ${new Date().toISOString().slice(0, 10)}.`,
    "This lead needs a call to qualify — fill in the missing details after speaking to the contact.",
  ];
  if (leftoverNotes.length) {
    descriptionParts.push(`Additional data from the source file: ${leftoverNotes.join("; ")}`);
  }

  return {
    companyInfo: {
      companyName: fieldValues.companyName,
      vertical: fieldValues.vertical,
      website: fieldValues.website,
      address: fieldValues.address,
      country: fieldValues.country,
      state: fieldValues.state,
      city: fieldValues.city,
      employeeCount: fieldValues.employeeCount,
      turnOverINR: fieldValues.turnOverINR,
      genericPhone1: fieldValues.genericPhone1,
      genericEmail1: fieldValues.genericEmail1,
      // Every bulk-imported row lands in the Cold pool — this is the entire
      // mechanism that puts it there; nothing else about the pool changes.
      leadStatus: "Cold (9+ months)",
      leadUsable: "Yes",
      // Free-text tag, not a structural field the rest of the app reads —
      // lets the Lead Details view show a "please complete" banner and lets
      // a future report tell bulk-imported leads apart from hand-entered
      // ones, without any DB schema change (company_info is already JSONB).
      importMeta: {
        source: "bulk_excel",
        originalFileName: meta.originalFileName,
        importedBy: meta.importedBy,
        importedAt: new Date().toISOString(),
        missingFields,
      },
    },
    contactInfo: {
      it: {
        name: fieldValues.itName,
        designation: fieldValues.itDesignation,
        mobile: fieldValues.itMobile,
        email: fieldValues.itEmail,
        personalEmail: fieldValues.itPersonalEmail,
      },
      finance: {
        name: fieldValues.financeName,
        designation: fieldValues.financeDesignation,
        mobile: fieldValues.financeMobile,
        email: fieldValues.financeEmail,
      },
      businessHead: {
        name: fieldValues.businessHeadName,
        designation: fieldValues.businessHeadDesignation,
        mobile: fieldValues.businessHeadMobile,
        email: fieldValues.businessHeadEmail,
      },
      additional: [],
    },
    itLandscape: { netNew: {}, SAPInstalledBase: {} },
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

// Runs every data row (everything after the header row) through the mapping
// and returns the leads ready to insert, plus a per-row report of anything
// skipped and why. A row is only ever skipped for missing a company name —
// every other field is allowed to be blank, since that's normal for a
// cold-outreach list and gets filled in later.
function transformRows({ rows, headerRowIndex, mapping, splitRules, originalFileName, importedBy }) {
  const headers = (rows[headerRowIndex] || []).map((h) => normalizeText(h));
  const dataRows = rows.slice(headerRowIndex + 1);

  const leadsData = [];
  const skipped = [];

  dataRows.forEach((row, i) => {
    const rowNumber = headerRowIndex + 2 + i; // 1-indexed, matches the spreadsheet's own row numbers
    const isBlankRow = row.every((c) => normalizeText(c) === "");
    if (isBlankRow) return;

    const { fieldValues, leftoverNotes } = buildRowFieldValues(row, headers, mapping, splitRules);
    if (isBlank(fieldValues.companyName)) {
      skipped.push({ row: rowNumber, reason: "Missing company name" });
      return;
    }

    leadsData.push(
      buildLeadDataFromFields(fieldValues, leftoverNotes, { originalFileName, importedBy })
    );
  });

  return { leadsData, skipped };
}

module.exports = {
  readWorkbook,
  sheetToRows,
  detectHeaderRowIndex,
  normalizeHeaderText,
  suggestMapping,
  autoMapAndSplit,
  normalizeText,
  normalizePhone,
  normalizeEmail,
  transformRows,
  FIELD_BY_KEY,
  REACH_FIELD_KEYS,
};
