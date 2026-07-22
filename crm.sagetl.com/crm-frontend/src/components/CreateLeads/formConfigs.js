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
      type: "select",
      options: "leadAssignedToOptions",
    },
  ],
  [
    { name: "bdm", label: "BDM", type: "select", options: "bdmOptions" },
    {
      name: "leadStatus",
      label: "Lead Status",
      type: "select",
      options: "leadStatusOptions",
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
      datePicker: { name: "dateField", label: "Date" },
    },
    {
      name: "leadUsable",
      label: "Lead Usable",
      type: "select",
      options: "leadUsableOptions",
    },
  ],
  [
    {
      name: "reason",
      label: "Reason",
      type: "select",
      options: "reasonOptions",
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
        name: "usingERP", // Changed from "Using ERP (y/n)" to "usingERP"
        label: "Using ERP (y/n)",
        type: "select",
        options: "usingERPOptions",
      },
      { name: "budget", label: "Budget", type: "text" }, // Changed from "Budget" to "budget"
      {
        name: "opportunityForUs1", // Changed from "Opportunity for us 1" to "opportunityForUs1"
        label: "Opportunity for us 1",
        type: "select",
        options: "opportunityOptions",
      },
    ],
    [
      {
        name: "ifYesWhichOne", // Changed from "If yes, which one" to "ifYesWhichOne"
        label: "If yes, which one",
        type: "select",
        options: "ERPTypeOptions",
      },
      { name: "authority", label: "Authority", type: "text" }, // Changed from "Authority" to "authority"
      {
        name: "opportunityValue1", // Changed from "Opportunity Value 1" to "opportunityValue1"
        label: "Opportunity Value 1",
        type: "text",
      },
    ],
    [
      {
        name: "ifNoWhy", // Changed from "If no, why" to "ifNoWhy"
        label: "If no, why",
        type: "select",
        options: "noWhyOptions",
      },
      { name: "need", label: "Need", type: "text" }, // Changed from "Need" to "need"
      {
        name: "timeframe", // Changed from "Timeframe" to "timeframe"
        label: "Timeframe",
        type: "select",
        options: "timeframeOptions",
      },
    ],
    [
      { name: "hardware", label: "Hardware", type: "text" }, // Changed from "Hardware" to "hardware"
      {
        name: "currentDatabase", // Changed from "Current Database" to "currentDatabase"
        label: "Current Database",
        type: "select",
        options: "currentDatabaseOptions",
      },
    ],
  ],
  SAPInstalledBase: [
    [
      {
        name: "opportunityForUs2", // Changed from "Opportunity for us 2" to "opportunityForUs2"
        label: "Opportunity for us 2",
        type: "select",
        options: "opportunityOptions",
      },
      {
        name: "yearOfImplementation", // Changed from "Year of Implementation" to "yearOfImplementation"
        label: "Year of Implementation",
        type: "text",
      },
      { name: "noOfUsers", label: "No. of Users", type: "number" }, // Changed from "No. of Users" to "noOfUsers"
    ],
    [
      {
        name: "opportunityValue2", // Changed from "Opportunity Value 2" to "opportunityValue2"
        label: "Opportunity Value 2",
        type: "text",
      },
      {
        name: "contractExpiry", // Changed from "Contract Expiry" to "contractExpiry"
        label: "Contract Expiry",
        type: "select",
        options: "expiryOptions",
      },
      {
        name: "supportPartner", // Changed from "" to "supportPartner"
        label: "Support Partner",
        type: "select",
        options: "partnerOptions",
      },
    ],
    [
      {
        name: "opportunityForUs3", // Changed from "Opportunity for us 3" to "opportunityForUs3"
        label: "Opportunity for us 3",
        type: "select",
        options: "opportunityOptions",
      },
      {
        name: "exactVersion", // Changed from "Exact Version" to "exactVersion"
        label: "Exact Version",
        type: "select",
        options: "versionOptions",
      },
      { name: "hardware", label: "Hardware", type: "text" }, // Remains unchanged
    ],
    [
      {
        name: "opportunityValue3", // Changed from "Opportunity Value 3" to "opportunityValue3"
        label: "Opportunity Value 3",
        type: "text",
      },
      { name: "noOfLicense", label: "No. of License", type: "number" }, // Changed from "No. of License" to "noOfLicense"
      { name: "licenseValue", label: "License Value", type: "text" }, // Changed from "License Value" to "licenseValue"
    ],
    [
      {
        name: "modulesImplemented", // Changed from "Modules Implemented" to "modulesImplemented"
        label: "Modules Implemented",
        type: "text",
      },
      {
        name: "implementationPartner", // Changed from "Implementation Partner" to "implementationPartner"
        label: "Implementation Partner",
        type: "text",
      },
      {
        name: "totalProjectCost", // Changed from "Total Project Cost" to "totalProjectCost"
        label: "Total Project Cost",
        type: "text",
      },
    ],
  ],
};
