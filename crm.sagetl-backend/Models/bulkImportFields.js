// The canonical set of lead fields a bulk-imported Excel row can be mapped
// into, and the keyword aliases used to auto-guess a mapping from whatever
// header text a vendor's file happens to use. This is the single source of
// truth for both the mapping UI (frontend fetches it) and the transform
// engine (backend applies it) — one list, not two copies that can drift.
//
// `required: true` marks the only field the system actually enforces
// (Company Name). Everything else is expected to arrive blank for a lot of
// rows — that's normal for a cold-outreach list — and gets filled in later
// by whoever pulls the lead and calls the contact.

const FIELD_CATALOG = [
  // --- Company -----------------------------------------------------------
  { key: "companyName", label: "Company Name", group: "Company", kind: "text", required: true,
    aliases: ["company", "company name", "companyname", "comp name", "comp", "co name", "firm", "firm name", "organisation", "organization", "org name", "account name", "account", "business name"] },
  { key: "vertical", label: "Vertical", group: "Company", kind: "text",
    aliases: ["vertical", "industry", "sector", "segment"] },
  { key: "website", label: "Website", group: "Company", kind: "text",
    aliases: ["website", "web site", "url", "domain"] },
  { key: "address", label: "Address", group: "Company", kind: "text",
    aliases: ["address", "location", "street address"] },
  { key: "country", label: "Country", group: "Company", kind: "text",
    aliases: ["country"] },
  { key: "state", label: "State", group: "Company", kind: "text",
    aliases: ["state", "province", "region"] },
  { key: "city", label: "City", group: "Company", kind: "text",
    aliases: ["city", "town"] },
  { key: "employeeCount", label: "Employee Count", group: "Company", kind: "text",
    aliases: ["employee count", "employees", "no of employees", "headcount", "staff strength"] },
  { key: "turnOverINR", label: "Turnover (INR)", group: "Company", kind: "text",
    aliases: ["turnover", "revenue", "annual turnover", "turn over"] },
  { key: "genericPhone1", label: "Company Phone", group: "Company", kind: "phone",
    aliases: ["company phone", "office phone", "landline", "phone", "contact number"] },
  { key: "genericEmail1", label: "Company Email", group: "Company", kind: "email",
    aliases: ["company email", "office email", "generic email", "info email"] },

  // --- IT contact ----------------------------------------------------------
  { key: "itName", label: "IT — Name", group: "IT Contact", kind: "text",
    aliases: ["it name", "it contact", "it person", "cto", "it head", "contact name", "contact person", "name"] },
  { key: "itDesignation", label: "IT — Designation", group: "IT Contact", kind: "text",
    aliases: ["it designation", "designation", "title", "job title"] },
  { key: "itMobile", label: "IT — Mobile", group: "IT Contact", kind: "phone",
    aliases: ["it mobile", "mobile", "mobile no", "mobile number", "phone number", "cell", "contact no"] },
  { key: "itEmail", label: "IT — Email", group: "IT Contact", kind: "email",
    aliases: ["it email", "email", "email id", "email address", "e-mail"] },
  { key: "itPersonalEmail", label: "IT — Personal Email", group: "IT Contact", kind: "email",
    aliases: ["personal email", "alt email", "secondary email"] },

  // --- Finance contact -------------------------------------------------
  { key: "financeName", label: "Finance — Name", group: "Finance Contact", kind: "text",
    aliases: ["finance name", "cfo", "finance head", "finance contact"] },
  { key: "financeDesignation", label: "Finance — Designation", group: "Finance Contact", kind: "text",
    aliases: ["finance designation"] },
  { key: "financeMobile", label: "Finance — Mobile", group: "Finance Contact", kind: "phone",
    aliases: ["finance mobile", "finance phone", "finance contact no"] },
  { key: "financeEmail", label: "Finance — Email", group: "Finance Contact", kind: "email",
    aliases: ["finance email"] },

  // --- Business Head contact ---------------------------------------------
  { key: "businessHeadName", label: "Business Head — Name", group: "Business Head Contact", kind: "text",
    aliases: ["business head", "ceo", "md", "director", "owner", "promoter"] },
  { key: "businessHeadDesignation", label: "Business Head — Designation", group: "Business Head Contact", kind: "text",
    aliases: ["business head designation"] },
  { key: "businessHeadMobile", label: "Business Head — Mobile", group: "Business Head Contact", kind: "phone",
    aliases: ["business head mobile", "ceo mobile", "md mobile"] },
  { key: "businessHeadEmail", label: "Business Head — Email", group: "Business Head Contact", kind: "email",
    aliases: ["business head email", "ceo email", "md email"] },
];

// Field keys that make up one lead's set of usable "reach" details — used
// only to decide whether an imported row has enough to be worth keeping,
// same rule the manual creation form uses.
const REACH_FIELD_KEYS = [
  "itMobile", "itEmail", "itPersonalEmail",
  "financeMobile", "financeEmail",
  "businessHeadMobile", "businessHeadEmail",
  "genericPhone1", "genericEmail1",
];

module.exports = { FIELD_CATALOG, REACH_FIELD_KEYS };
