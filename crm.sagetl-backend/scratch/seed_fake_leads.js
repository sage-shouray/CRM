const { Client } = require('pg');
require('dotenv').config({ path: '../.env' });

async function run() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  await client.connect();
  console.log("Connected to database...");

  // Delete existing leads for a clean testing slate
  await client.query('DELETE FROM leads');
  console.log("Cleared existing leads.");

  // Lead creator IDs: 9 (Anushka), 10 (Kanishka), 4 (Super Admin)
  // Assigned to IDs: 11 (Utkarsh), 12 (Vishal), 13 (Akash)
  
  const fakeLeads = [
    {
      companyInfo: {
        leadType: "Net New",
        genericEmail1: "info@tatamotors.com",
        vertical: "Auto / Auto Ancillary",
        companyName: "Tata Motors Ltd",
        genericEmail2: "purchase@tatamotors.com",
        leadAssignedTo: 11, // Utkarsh
        website: "www.tatamotors.com",
        genericPhone1: "022-66658282",
        bdm: "Utkarsh",
        address: "Bombay House, 24 Homi Mody Street",
        genericPhone2: "022-66657111",
        leadStatus: "Hot (0–3 months)",
        city: "Mumbai",
        leadSource: "Reference",
        priority: "High",
        state: "Maharashtra",
        totalNoOfOffices: 12,
        nextAction: "On-Site Meeting",
        country: "India",
        turnOverINR: "100Cr+",
        leadUsable: "Yes",
        employeeCount: "201+",
        totalNoOfManufUnits: 6,
        reason: "Planning ERP transition to cloud next month.",
        aboutTheCompany: "Tata Motors Limited is a leading global automobile manufacturer of cars, utility vehicles, buses, trucks, and defense vehicles.",
        dateField: "2026-07-24" // Today
      },
      contactInfo: {
        it: {
          name: "Rajesh Kumar",
          dlExt: "9876543210",
          designation: "Chief Information Officer",
          mobile: "9876543211",
          email: "rajesh.kumar@tatamotors.com",
          personalEmail: "rajesh.personal@gmail.com"
        },
        finance: {
          name: "Sanjay Shah",
          dlExt: "9876543212",
          designation: "VP Finance",
          mobile: "9876543213",
          email: "sanjay.shah@tatamotors.com",
          personalEmail: "sanjay.shah12@gmail.com"
        },
        businessHead: {
          name: "Girish Wagh",
          dlExt: "9876543214",
          designation: "Executive Director",
          mobile: "9876543215",
          email: "girish.wagh@tatamotors.com",
          personalEmail: "girish.wagh@yahoo.com"
        }
      },
      itLandscape: {
        netNew: {
          usingERP: "No",
          budget: "50 Lakhs",
          opportunityForUs1: "High",
          authority: "Board Approved",
          opportunityValue1: 4500000,
          need: "Core manufacturing ERP and supply chain visibility.",
          timeframe: "Immediate"
        },
        SAPInstalledBase: {}
      },
      descriptions: [
        {
          description: "Initial introductory call completed. Client is looking to implement a new cloud-based ERP to unify all Indian manufacturing hubs. Seeking proposal by end of week.",
          selectedOption: "Follow-Up",
          radioValue: "High",
          addedBy: 9 // Anushka
        }
      ],
      createdBy: 9 // Anushka
    },
    {
      companyInfo: {
        leadType: "SAP Installed Base",
        genericEmail1: "procurement@relianceretail.com",
        vertical: "Retail / Hypermart / Trading",
        companyName: "Reliance Retail Ltd",
        genericEmail2: "support@relianceretail.com",
        leadAssignedTo: 12, // Vishal
        website: "www.relianceretail.com",
        genericPhone1: "022-44770000",
        bdm: "Vishal",
        address: "Reliance Corporate Park, Ghansoli",
        genericPhone2: "022-44771111",
        leadStatus: "Hot (0–3 months)",
        city: "Navi Mumbai",
        leadSource: "Existing Database",
        priority: "High",
        state: "Maharashtra",
        totalNoOfOffices: 1500,
        nextAction: "Online Meeting",
        country: "India",
        turnOverINR: "100Cr+",
        leadUsable: "Yes",
        employeeCount: "201+",
        totalNoOfManufUnits: 0,
        reason: "Contracting AMS support partner change.",
        aboutTheCompany: "Reliance Retail is the retail initiative of Reliance Industries Limited and is central to the consumer-facing business.",
        dateField: "2026-07-25" // Tomorrow
      },
      contactInfo: {
        it: {
          name: "Milind Kapoor",
          dlExt: "9123456780",
          designation: "Head of IT Retail Systems",
          mobile: "9123456781",
          email: "milind.kapoor@relianceretail.com",
          personalEmail: "milind.k@gmail.com"
        },
        finance: {
          name: "Alok Kumar",
          dlExt: "9123456782",
          designation: "CFO - Retail Division",
          mobile: "9123456783",
          email: "alok.kumar@relianceretail.com",
          personalEmail: "alok.fin@yahoo.com"
        },
        businessHead: {
          name: "Isha Ambani",
          dlExt: "9123456784",
          designation: "Director",
          mobile: "9123456785",
          email: "isha.ambani@relianceretail.com",
          personalEmail: "isha.ambani@outlook.com"
        }
      },
      itLandscape: {
        netNew: {},
        SAPInstalledBase: {
          opportunityForUs2: "High",
          yearOfImplementation: "2019",
          noOfUsers: 850,
          opportunityValue2: 12000000,
          contractExpiry: "2027",
          supportPartner: "Partner A",
          opportunityForUs3: "AMS",
          exactVersion: "v2",
          hardware: "Azure Cloud Hosting",
          noOfLicense: 1000,
          licenseValue: "80 Lakhs",
          modulesImplemented: "FI, CO, MM, SD, WM, IS-Retail",
          implementationPartner: "Tech Mahindra",
          totalProjectCost: "15 Crore"
        }
      },
      descriptions: [
        {
          description: "Unhappy with current AMS support partner due to high SLA breach rates. Seeking a new certified support partner to handle critical level tickets.",
          selectedOption: "Negotiation",
          radioValue: "High",
          addedBy: 10 // Kanishka
        }
      ],
      createdBy: 10 // Kanishka
    },
    {
      companyInfo: {
        leadType: "Net New",
        genericEmail1: "contact@infosys.com",
        vertical: "Others",
        companyName: "Infosys Technologies",
        genericEmail2: "hr@infosys.com",
        leadAssignedTo: 13, // Akash
        website: "www.infosys.com",
        genericPhone1: "080-28520261",
        bdm: "Akash",
        address: "Electronics City, Hosur Road",
        genericPhone2: "080-28520262",
        leadStatus: "Warm (3–9 months)",
        city: "Bengaluru",
        leadSource: "Self Generated",
        priority: "Medium",
        state: "Karnataka",
        totalNoOfOffices: 80,
        nextAction: "Call Back",
        country: "India",
        turnOverINR: "100Cr+",
        leadUsable: "Yes",
        employeeCount: "201+",
        totalNoOfManufUnits: 0,
        reason: "Exploring niche ERP for software resource planning.",
        aboutTheCompany: "Infosys is a global leader in next-generation digital services and consulting.",
        dateField: "2026-07-26"
      },
      contactInfo: {
        it: {
          name: "Sudha Murty",
          dlExt: "9812345670",
          designation: "VP IT Infrastructure",
          mobile: "9812345671",
          email: "sudha.murty@infosys.com",
          personalEmail: "sudha.m@gmail.com"
        },
        finance: {
          name: "Jayesh Sanghrajka",
          dlExt: "9812345672",
          designation: "Chief Financial Officer",
          mobile: "9812345673",
          email: "jayesh.s@infosys.com",
          personalEmail: "jayesh.s@yahoo.com"
        },
        businessHead: {
          name: "Salil Parekh",
          dlExt: "9812345674",
          designation: "CEO & MD",
          mobile: "9812345675",
          email: "salil.parekh@infosys.com",
          personalEmail: "salil.p@outlook.com"
        }
      },
      itLandscape: {
        netNew: {
          usingERP: "Yes",
          budget: "30 Lakhs",
          opportunityForUs1: "Low",
          authority: "Manager Approved",
          opportunityValue1: 2500000,
          need: "Resource scheduling integration module.",
          timeframe: "3-6 months"
        },
        SAPInstalledBase: {}
      },
      descriptions: [
        {
          description: "Followed up regarding custom development. They have a massive internal ERP but need help with specialized mobile apps linked to their HR system.",
          selectedOption: "Call Back",
          radioValue: "Medium",
          addedBy: 4 // Super Admin
        }
      ],
      createdBy: 4
    },
    {
      companyInfo: {
        leadType: "SAP Installed Base",
        genericEmail1: "contact@sunpharma.com",
        vertical: "Pharma / Equip. (Surgical) / Healthcare / Device Manufacturing",
        companyName: "Sun Pharmaceutical Industries Ltd",
        genericEmail2: "info@sunpharma.com",
        leadAssignedTo: 11, // Utkarsh
        website: "www.sunpharma.com",
        genericPhone1: "022-43261234",
        bdm: "Utkarsh",
        address: "Sun House, Western Express Highway, Goregaon East",
        genericPhone2: "022-43261111",
        leadStatus: "Hot (0–3 months)",
        city: "Mumbai",
        leadSource: "Reference",
        priority: "High",
        state: "Maharashtra",
        totalNoOfOffices: 24,
        nextAction: "Proposal Submitted",
        country: "India",
        turnOverINR: "100Cr+",
        leadUsable: "Yes",
        employeeCount: "201+",
        totalNoOfManufUnits: 15,
        reason: "SAP ECC to S/4HANA migration project.",
        aboutTheCompany: "Sun Pharma is the fourth largest specialty generic pharmaceutical company in the world.",
        dateField: "2026-07-27"
      },
      contactInfo: {
        it: {
          name: "Abhay Gandhi",
          dlExt: "9004561230",
          designation: "Global CIO",
          mobile: "9004561231",
          email: "abhay.gandhi@sunpharma.com",
          personalEmail: "abhay.g@gmail.com"
        },
        finance: {
          name: "C. S. Muralidharan",
          dlExt: "9004561232",
          designation: "CFO",
          mobile: "9004561233",
          email: "muralidharan.cs@sunpharma.com",
          personalEmail: "cs.murali@yahoo.com"
        },
        businessHead: {
          name: "Dilip Shanghvi",
          dlExt: "9004561234",
          designation: "Managing Director",
          mobile: "9004561235",
          email: "dilip.s@sunpharma.com",
          personalEmail: "dilip.s@outlook.com"
        }
      },
      itLandscape: {
        netNew: {},
        SAPInstalledBase: {
          opportunityForUs2: "High",
          yearOfImplementation: "2015",
          noOfUsers: 2200,
          opportunityValue2: 35000000,
          contractExpiry: "2026",
          supportPartner: "Partner B",
          opportunityForUs3: "Hardware Migration (H/W) / Version Upgrade",
          exactVersion: "v1",
          hardware: "On-Premise Servers",
          noOfLicense: 2500,
          licenseValue: "3 Crore",
          modulesImplemented: "FI, CO, SD, MM, PP, QM, PM, PP-PI",
          implementationPartner: "IBM India",
          totalProjectCost: "40 Crore"
        }
      },
      descriptions: [
        {
          description: "Sun Pharma wants to migrate their legacy SAP ECC systems to S/4HANA Private Cloud. Request for proposal (RFP) has been submitted for review by the steering committee.",
          selectedOption: "Proposal Submitted",
          radioValue: "High",
          addedBy: 9 // Anushka
        }
      ],
      createdBy: 9
    },
    {
      companyInfo: {
        leadType: "Net New",
        genericEmail1: "info@hdfcbank.com",
        vertical: "BFSI",
        companyName: "HDFC Bank Ltd",
        genericEmail2: "support@hdfcbank.com",
        leadAssignedTo: 12, // Vishal
        website: "www.hdfcbank.com",
        genericPhone1: "022-61606161",
        bdm: "Vishal",
        address: "HDFC Bank House, Senapati Bapat Marg, Lower Parel",
        genericPhone2: "022-61606262",
        leadStatus: "Warm (3–9 months)",
        city: "Mumbai",
        leadSource: "Existing Database",
        priority: "Medium",
        state: "Maharashtra",
        totalNoOfOffices: 5400,
        nextAction: "Online Meeting",
        country: "India",
        turnOverINR: "100Cr+",
        leadUsable: "Yes",
        employeeCount: "201+",
        totalNoOfManufUnits: 0,
        reason: "Evaluating asset management software.",
        aboutTheCompany: "HDFC Bank is India's largest private sector bank by assets and the world's tenth largest bank by market capitalization.",
        dateField: "2026-07-28"
      },
      contactInfo: {
        it: {
          name: "Ramesh Lakshminarayanan",
          dlExt: "9898012340",
          designation: "Group IT Head & CIO",
          mobile: "9898012341",
          email: "ramesh.l@hdfcbank.com",
          personalEmail: "ramesh.lak@gmail.com"
        },
        finance: {
          name: "Srinivasan Vaidyanathan",
          dlExt: "9898012342",
          designation: "Chief Financial Officer",
          mobile: "9898012343",
          email: "srinivasan.v@hdfcbank.com",
          personalEmail: "srinivasan.v@yahoo.com"
        },
        businessHead: {
          name: "Sashidhar Jagdishan",
          dlExt: "9898012344",
          designation: "CEO & MD",
          mobile: "9898012345",
          email: "sashidhar.j@hdfcbank.com",
          personalEmail: "sashi.j@outlook.com"
        }
      },
      itLandscape: {
        netNew: {
          usingERP: "Yes",
          budget: "80 Lakhs",
          opportunityForUs1: "Medium",
          authority: "Management Approved",
          opportunityValue1: 6000000,
          need: "Asset tracking and real estate lease compliance software.",
          timeframe: "1-3 months"
        },
        SAPInstalledBase: {}
      },
      descriptions: [
        {
          description: "Online demo scheduled to demonstrate asset leasing modules. They are comparing SAP BYD with Microsoft Dynamics Finance.",
          selectedOption: "Online Meeting",
          radioValue: "Medium",
          addedBy: 10 // Kanishka
        }
      ],
      createdBy: 10
    },
    {
      companyInfo: {
        leadType: "SAP Installed Base",
        genericEmail1: "info@larsentoubro.com",
        vertical: "EPC",
        companyName: "Larsen & Toubro Ltd",
        genericEmail2: "procure@larsentoubro.com",
        leadAssignedTo: 13, // Akash
        website: "www.larsentoubro.com",
        genericPhone1: "022-67525656",
        bdm: "Akash",
        address: "L&T House, Ballard Estate",
        genericPhone2: "022-67521111",
        leadStatus: "Hot (0–3 months)",
        city: "Mumbai",
        leadSource: "Reference",
        priority: "High",
        state: "Maharashtra",
        totalNoOfOffices: 50,
        nextAction: "On-Site Meeting",
        country: "India",
        turnOverINR: "100Cr+",
        leadUsable: "Yes",
        employeeCount: "201+",
        totalNoOfManufUnits: 8,
        reason: "Need SAP rollout for new construction projects.",
        aboutTheCompany: "Larsen & Toubro Limited, commonly known as L&T, is an Indian multinational conglomerate company, with business interests in engineering, construction, manufacturing, technology and financial services.",
        dateField: "2026-07-29"
      },
      contactInfo: {
        it: {
          name: "S. N. Subrahmanyan",
          dlExt: "9773412560",
          designation: "VP & CIO",
          mobile: "9773412561",
          email: "sns@larsentoubro.com",
          personalEmail: "sns.subra@gmail.com"
        },
        finance: {
          name: "R. Shankar Raman",
          dlExt: "9773412562",
          designation: "CFO & Board Member",
          mobile: "9773412563",
          email: "rsr@larsentoubro.com",
          personalEmail: "rsr.finance@yahoo.com"
        },
        businessHead: {
          name: "Anil Parab",
          dlExt: "9773412564",
          designation: "Head of Heavy Engineering",
          mobile: "9773412565",
          email: "anil.parab@larsentoubro.com",
          personalEmail: "anil.parab@outlook.com"
        }
      },
      itLandscape: {
        netNew: {},
        SAPInstalledBase: {
          opportunityForUs2: "High",
          yearOfImplementation: "2012",
          noOfUsers: 5000,
          opportunityValue2: 8000000,
          contractExpiry: "2028",
          supportPartner: "Partner A",
          opportunityForUs3: "Rollouts",
          exactVersion: "v2",
          hardware: "AWS Cloud",
          noOfLicense: 6000,
          licenseValue: "5 Crore",
          modulesImplemented: "FI, CO, SD, MM, PS, HR, PP",
          implementationPartner: "LTI Mindtree",
          totalProjectCost: "70 Crore"
        }
      },
      descriptions: [
        {
          description: "Meeting scheduled at L&T Powai campus to discuss the SAP PS (Project System) rollout templates for 3 new infrastructure projects in Gujarat.",
          selectedOption: "On-Site Meeting",
          radioValue: "High",
          addedBy: 9 // Anushka
        }
      ],
      createdBy: 9
    },
    {
      companyInfo: {
        leadType: "SAP Installed Base",
        genericEmail1: "info@asianpaints.com",
        vertical: "Chemicals / Process / Fertilizers",
        companyName: "Asian Paints Ltd",
        genericEmail2: "procurement@asianpaints.com",
        leadAssignedTo: 11, // Utkarsh
        website: "www.asianpaints.com",
        genericPhone1: "022-62181000",
        bdm: "Utkarsh",
        address: "Shantinagar, Santacruz East",
        genericPhone2: "022-62181111",
        leadStatus: "Warm (3–9 months)",
        city: "Mumbai",
        leadSource: "Existing Database",
        priority: "Medium",
        state: "Maharashtra",
        totalNoOfOffices: 18,
        nextAction: "Call Back",
        country: "India",
        turnOverINR: "100Cr+",
        leadUsable: "Yes",
        employeeCount: "201+",
        totalNoOfManufUnits: 8,
        reason: "Need custom development for supply chain dashboard.",
        aboutTheCompany: "Asian Paints is an Indian multinational paint company, headquartered in Mumbai. The company is engaged in the business of manufacturing, selling and distribution of paints, coatings, products related to home decor, bath fittings and providing of related services.",
        dateField: "2026-07-30"
      },
      contactInfo: {
        it: {
          name: "Aashish Kshetry",
          dlExt: "9820011220",
          designation: "VP IT & CIO",
          mobile: "9820011221",
          email: "aashish.kshetry@asianpaints.com",
          personalEmail: "aashish.k@gmail.com"
        },
        finance: {
          name: "Amit Bagle",
          dlExt: "9820011222",
          designation: "Finance Controller",
          mobile: "9820011223",
          email: "amit.bagle@asianpaints.com",
          personalEmail: "amit.bagle@yahoo.com"
        },
        businessHead: {
          name: "Amit Syngle",
          dlExt: "9820011224",
          designation: "MD & CEO",
          mobile: "9820011225",
          email: "amit.syngle@asianpaints.com",
          personalEmail: "amit.syngle@outlook.com"
        }
      },
      itLandscape: {
        netNew: {},
        SAPInstalledBase: {
          opportunityForUs2: "Medium",
          yearOfImplementation: "2010",
          noOfUsers: 3100,
          opportunityValue2: 3000000,
          contractExpiry: "2027",
          supportPartner: "Partner B",
          opportunityForUs3: "Custom Developments",
          exactVersion: "v1",
          hardware: "Oracle Exadata On-Premise",
          noOfLicense: 3500,
          licenseValue: "2.5 Crore",
          modulesImplemented: "FI, CO, SD, MM, PP, QM, WM, APO",
          implementationPartner: "Accenture",
          totalProjectCost: "50 Crore"
        }
      },
      descriptions: [
        {
          description: "Follow up required in August. The CIO is currently busy with annual audits, but is interested in custom developments using SAP Fiori apps for plant operators.",
          selectedOption: "Call Back",
          radioValue: "Medium",
          addedBy: 10 // Kanishka
        }
      ],
      createdBy: 10
    },
    {
      companyInfo: {
        leadType: "Net New",
        genericEmail1: "gcmmf@amul.coop",
        vertical: "Dairy",
        companyName: "Amul (GCMMF)",
        genericEmail2: "purchase@amul.coop",
        leadAssignedTo: 12, // Vishal
        website: "www.amul.com",
        genericPhone1: "02692-258521",
        bdm: "Vishal",
        address: "Amul Dairy Road, Anand",
        genericPhone2: "02692-258522",
        leadStatus: "Hot (0–3 months)",
        city: "Anand",
        leadSource: "Self Generated",
        priority: "High",
        state: "Gujarat",
        totalNoOfOffices: 45,
        nextAction: "On-Site Meeting",
        country: "India",
        turnOverINR: "100Cr+",
        leadUsable: "Yes",
        employeeCount: "201+",
        totalNoOfManufUnits: 12,
        reason: "Implementing cold chain tracking ERP module.",
        aboutTheCompany: "Amul is an Indian dairy state government cooperative society, based at Anand in Gujarat.",
        dateField: "2026-07-24" // Today
      },
      contactInfo: {
        it: {
          name: "R. S. Sodhi",
          dlExt: "9909012340",
          designation: "Executive Director IT",
          mobile: "9909012341",
          email: "rs.sodhi@amul.coop",
          personalEmail: "rs.sodhi@gmail.com"
        },
        finance: {
          name: "K. M. Jhala",
          dlExt: "9909012342",
          designation: "General Manager Finance",
          mobile: "9909012343",
          email: "km.jhala@amul.coop",
          personalEmail: "km.jhala@yahoo.com"
        },
        businessHead: {
          name: "Jayen Mehta",
          dlExt: "9909012344",
          designation: "Managing Director",
          mobile: "9909012345",
          email: "jayen.mehta@amul.coop",
          personalEmail: "jayen.m@outlook.com"
        }
      },
      itLandscape: {
        netNew: {
          usingERP: "No",
          budget: "90 Lakhs",
          opportunityForUs1: "High",
          authority: "Board Approved",
          opportunityValue1: 8500000,
          need: "End-to-end dairy collection and temperature logistics tracking ERP.",
          timeframe: "Immediate"
        },
        SAPInstalledBase: {}
      },
      descriptions: [
        {
          description: "Amul is looking to implement a modern ERP system at their regional distribution centers. Presentation delivered today by Vishal BDM. Very positive feedback.",
          selectedOption: "On-Site Meeting",
          radioValue: "High",
          addedBy: 4 // Super Admin
        }
      ],
      createdBy: 4
    },
    {
      companyInfo: {
        leadType: "Net New",
        genericEmail1: "sales@dlf.in",
        vertical: "Real Estate / Construction",
        companyName: "DLF Limited",
        genericEmail2: "info@dlf.in",
        leadAssignedTo: 13, // Akash
        website: "www.dlf.in",
        genericPhone1: "011-49696969",
        bdm: "Akash",
        address: "DLF Shopping Mall, Arjun Marg, DLF Phase I",
        genericPhone2: "011-49697000",
        leadStatus: "Cold (9+ months)",
        city: "Gurugram",
        leadSource: "Existing Database",
        priority: "Low",
        state: "Haryana",
        totalNoOfOffices: 15,
        nextAction: "Call Back",
        country: "India",
        turnOverINR: "100Cr+",
        leadUsable: "Yes",
        employeeCount: "201+",
        totalNoOfManufUnits: 0,
        reason: "No active project right now, check back in next FY.",
        aboutTheCompany: "DLF Limited is the largest commercial real estate developer in India.",
        dateField: "2026-07-31"
      },
      contactInfo: {
        it: {
          name: "Mahendra Kumar",
          dlExt: "9818045670",
          designation: "Head of IT Applications",
          mobile: "9818045671",
          email: "mahendra.k@dlf.in",
          personalEmail: "mahendra.k@gmail.com"
        },
        finance: {
          name: "Vivek Anand",
          dlExt: "9818045672",
          designation: "Group CFO",
          mobile: "9818045673",
          email: "vivek.anand@dlf.in",
          personalEmail: "vivek.anand@yahoo.com"
        },
        businessHead: {
          name: "Rajiv Singh",
          dlExt: "9818045674",
          designation: "Chairman",
          mobile: "9818045675",
          email: "rajiv.singh@dlf.in",
          personalEmail: "rajiv.s@outlook.com"
        }
      },
      itLandscape: {
        netNew: {
          usingERP: "Yes",
          budget: "10 Lakhs",
          opportunityForUs1: "Low",
          authority: "Manager Approved",
          opportunityValue1: 800000,
          need: "Small upgrade to document management workflow.",
          timeframe: "Immediate"
        },
        SAPInstalledBase: {}
      },
      descriptions: [
        {
          description: "Spoke to IT Head. They recently upgraded their Oracle ERP. No plans for new systems for at least 12 months. Flagged as Cold.",
          selectedOption: "Call Back",
          radioValue: "Low",
          addedBy: 10 // Kanishka
        }
      ],
      createdBy: 10
    },
    {
      companyInfo: {
        leadType: "SAP Installed Base",
        genericEmail1: "feedback@britannia.co.in",
        vertical: "FMCG",
        companyName: "Britannia Industries Ltd",
        genericEmail2: "procurement@britannia.co.in",
        leadAssignedTo: 11, // Utkarsh
        website: "www.britannia.co.in",
        genericPhone1: "080-37687100",
        bdm: "Utkarsh",
        address: "Hungerford Street, Kolkata",
        genericPhone2: "080-37687200",
        leadStatus: "Warm (3–9 months)",
        city: "Bengaluru",
        leadSource: "Reference",
        priority: "Medium",
        state: "Karnataka",
        totalNoOfOffices: 8,
        nextAction: "Online Meeting",
        country: "India",
        turnOverINR: "100Cr+",
        leadUsable: "Yes",
        employeeCount: "201+",
        totalNoOfManufUnits: 5,
        reason: "Need upgrade of SAP Basis and database migration.",
        aboutTheCompany: "Britannia Industries Limited is an Indian multinational food products company, famous for its brand of biscuits, breads and dairy products.",
        dateField: "2026-07-24" // Today
      },
      contactInfo: {
        it: {
          name: "N. Venkataraman",
          dlExt: "9448012340",
          designation: "Chief Information Officer",
          mobile: "9448012341",
          email: "n.venkat@britannia.co.in",
          personalEmail: "venkat.n@gmail.com"
        },
        finance: {
          name: "Varun Berry",
          dlExt: "9448012342",
          designation: "Executive Vice Chairman",
          mobile: "9448012343",
          email: "varun.berry@britannia.co.in",
          personalEmail: "varun.berry@yahoo.com"
        },
        businessHead: {
          name: "Rajneet Kohli",
          dlExt: "9448012344",
          designation: "CEO & MD",
          mobile: "9448012345",
          email: "rajneet.k@britannia.co.in",
          personalEmail: "rajneet.k@outlook.com"
        }
      },
      itLandscape: {
        netNew: {},
        SAPInstalledBase: {
          opportunityForUs2: "Medium",
          yearOfImplementation: "2018",
          noOfUsers: 450,
          opportunityValue2: 2500000,
          contractExpiry: "2027",
          supportPartner: "Partner A",
          opportunityForUs3: "Basis / DMS",
          exactVersion: "v2",
          hardware: "Azure Infrastructure",
          noOfLicense: 500,
          licenseValue: "40 Lakhs",
          modulesImplemented: "FI, CO, SD, MM, PP, WM, QM",
          implementationPartner: "Wipro",
          totalProjectCost: "12 Crore"
        }
      },
      descriptions: [
        {
          description: "Requested online session to show our capability in SAP Basis administration and custom dashboards. Meeting scheduled for today.",
          selectedOption: "Online Meeting",
          radioValue: "Medium",
          addedBy: 9 // Anushka
        }
      ],
      createdBy: 9
    }
  ];

  try {
    for (const lead of fakeLeads) {
      // Stringify the JSON fields as PostgreSQL JSONB columns
      const companyInfoStr = JSON.stringify(lead.companyInfo);
      const contactInfoStr = JSON.stringify(lead.contactInfo);
      const itLandscapeStr = JSON.stringify(lead.itLandscape);
      const descriptionsStr = JSON.stringify(lead.descriptions);

      const res = await client.query(`
        INSERT INTO leads (created_by, company_info, contact_info, it_landscape, descriptions)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING lead_number
      `, [lead.createdBy, companyInfoStr, contactInfoStr, itLandscapeStr, descriptionsStr]);

      console.log(`Successfully seeded lead: ${lead.companyInfo.companyName} (Lead Number: ${res.rows[0].lead_number})`);
    }
    console.log("All 10 fake leads successfully seeded into the database!");
  } catch (err) {
    console.error("Error seeding fake leads:", err);
  } finally {
    await client.end();
  }
}

run().catch(console.error);
