export const companyFormConfig = [
  [
    {
      name: "companyName",
      label: "Company Name",
      type: "text",
      required: true,
      isPrimary: true,
    },
  ],
  [
    {
      name: "leadType",
      label: "Lead Type",
      type: "select",
      options: "leadTypeOptions",
      required: true,
    },
    {
      name: "vertical",
      label: "Vertical",
      type: "select",
      options: "verticalOptions",
      required: true,
    },
    {
      name: "leadAssignedTo",
      label: "Lead Assigned to",
      type: "multiselect",
      options: "leadAssignedToOptions",
    },
  ],
  [
    { name: "bdm", label: "BDM", type: "multiselect", options: "bdmOptions" },
    {
      name: "leadStatus",
      label: "Lead Status",
      type: "select",
      options: "leadStatusOptions",
      required: true,
    },
    {
      name: "leadSource",
      label: "Lead Source",
      type: "select",
      options: "leadSourceOptions",
    },
  ],
  [
    {
      name: "priority",
      label: "Priority",
      type: "select",
      options: "priorityOptions",
      required: true,
    },
    {
      name: "nextAction",
      label: "Next Action",
      type: "select",
      options: "nextActionOptions",
      required: true,
      datePicker: { name: "dateField", label: "Date" },
    },
    {
      name: "leadUsable",
      label: "Lead Usable",
      type: "select",
      options: "leadUsableOptions",
      required: true,
    },
  ],
  [
    {
      // Read by the pipeline for deal values. It had no input anywhere, which
      // is why every money figure in the app read zero.
      name: "expectedDealValue",
      label: "Expected Deal Value (INR)",
      type: "number",
      required: true,
    },
    {
      // The pipeline used to infer the stage from nextAction, so scheduling a
      // call silently moved a lead between columns. Stored explicitly now, with
      // the old inference kept as a fallback for records that predate this.
      name: "pipelineStage",
      label: "Pipeline Stage",
      type: "select",
      options: "pipelineStageOptions",
    },
  ],
  [
    {
      name: "reason",
      label: "Reason",
      type: "text",
    },
    { name: "address", label: "Address", type: "text" },
  ],
  [
    {
      name: "country",
      label: "Country",
      type: "select",
      isCascadingCountry: true,
    },
    {
      name: "state",
      label: "State",
      type: "select",
      isCascadingState: true,
    },
    {
      name: "city",
      label: "City",
      type: "select",
      isCascadingCity: true,
    },
  ],
];

export const contactFormConfig = [
  {
    role: "IT",
    fields: [
      { name: "itName", label: "Name", type: "text" },
      { name: "itDlExt", label: "Mobile No. 1", type: "tel" },
      { name: "itDesignation", label: "Designation", type: "text" },
      { name: "itMobile", label: "Mobile No. 2", type: "tel" },
      { name: "itEmail", label: "Email", type: "email" },
      { name: "itPersonalEmail", label: "Personal Email", type: "email" },
    ],
  },
  {
    role: "Finance",
    fields: [
      { name: "financeName", label: "Name", type: "text" },
      { name: "financeDlExt", label: "Mobile No. 1", type: "tel" },
      { name: "financeDesignation", label: "Designation", type: "text" },
      { name: "financeMobile", label: "Mobile No. 2", type: "tel" },
      { name: "financeEmail", label: "Email", type: "email" },
      { name: "financePersonalEmail", label: "Personal Email", type: "email" },
    ],
  },
  {
    role: "Business Head",
    fields: [
      { name: "businessHeadName", label: "Name", type: "text" },
      { name: "businessHeadDlExt", label: "Mobile No. 1", type: "tel" },
      { name: "businessHeadDesignation", label: "Designation", type: "text" },
      { name: "businessHeadMobile", label: "Mobile No. 2", type: "tel" },
      {
        name: "businessHeadEmail",
        label: "Email",
        type: "email",
      },
      {
        name: "businessHeadPersonalEmail",
        label: "Personal Email",
        type: "email",
      },
    ],
  },
];

export const itLandscapeConfig = {
  netNew: [
    [
      {
        name: "usingERP",
        label: "Using ERP",
        type: "select",
        options: "usingERPOptions",
        required: true,
      },
      { name: "budget", label: "Budget", type: "text" },
      {
        name: "opportunityForUs1",
        label: "Opportunity",
        type: "select",
        options: "opportunityOptions",
        required: true,
      },
    ],
    [
      // Mirrors the conditional pair in CreateLeads: only one of these is ever
      // relevant, driven by the Using ERP answer.
      {
        name: "ifYesWhichOne",
        label: "If yes, which ERP",
        type: "select",
        options: "ERPTypeOptions",
        showIf: { field: "usingERP", equals: "Yes" },
      },
      {
        name: "ifNoWhy",
        label: "If no, why",
        type: "select",
        options: "noWhyOptions",
        showIf: { field: "usingERP", equals: "No" },
      },
    ],
    [
      { name: "authority", label: "Authority", type: "text" },
      {
        name: "opportunityValue1",
        label: "Opportunity Value",
        type: "number",
      },
      { name: "need", label: "Need", type: "text" },
    ],
    [
      {
        name: "timeframe",
        label: "Timeframe",
        type: "select",
        options: "timeframeOptions",
      },
    ],
  ],
  SAPInstalledBase: [
    [
      {
        name: "opportunityForUs2",
        label: "Opportunity for us available",
        type: "select",
        options: "opportunityOptions",
        required: true,
      },
      {
        name: "yearOfImplementation",
        label: "Year of Implementation",
        type: "text",
      },
      { name: "noOfUsers", label: "No. of Users", type: "number" },
    ],
    [
      {
        name: "opportunityValue2",
        label: "Opportunity Value",
        type: "number",
      },
      {
        name: "contractExpiry",
        label: "Contract Expiry",
        // A real date, not a year: the monthly "expiring in the next three
        // months" report cannot be computed from a year alone.
        type: "date",
      },
      {
        name: "supportPartner",
        label: "Support Partner",
        type: "select",
        options: "partnerOptions",
      },
    ],
    [
      {
        name: "opportunityForUs3",
        label: "Opportunity for",
        type: "select",
        options: "opportunityForUs3Options",
        required: true,
      },
      {
        name: "exactVersion",
        label: "Exact Version",
        type: "select",
        options: "versionOptions",
      },
      { name: "hardware", label: "Hardware", type: "text" },
    ],
    [
      { name: "noOfLicense", label: "No. of License", type: "number" },
      { name: "licenseValue", label: "License Value", type: "text" },
    ],
    [
      {
        name: "modulesImplemented",
        label: "Modules Implemented",
        type: "text",
      },
      {
        name: "implementationPartner",
        label: "Implementation Partner",
        type: "text",
      },
      {
        name: "totalProjectCost",
        label: "Total Project Cost",
        type: "text",
      },
    ],
  ],
};
