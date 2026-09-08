// Bulk-generates ~1500 test leads directly into whatever DATABASE_URL points
// at. Meant for the local crm_test_base database only — never run this
// against a database that might be production.
const { Pool } = require("pg");
const { randomInt } = require("node:crypto");
require("dotenv").config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const COUNT = 1500;

const industries = [
  "Auto / Auto Ancillary", "Textile / Spinning / Garments / Footwear / Leather",
  "Real Estate / Construction", "EPC",
  "Pharma / Equip. (Surgical) / Healthcare / Device Manufacturing",
  "Chemicals / Process / Fertilizers", "BFSI", "Solar / Renewable / Power",
  "Mobiles / Electronics", "PSU's / QUASSI", "E-commerce", "FMCG", "Dairy",
  "Sugar / Ethanol / Distillery", "Manufacturing / Discrete",
  "Diversified / Conglomerate", "Education", "Logistics",
  "Retail / Hypermart / Trading", "Others",
];

const cities = [
  ["Mumbai", "Maharashtra"], ["Pune", "Maharashtra"], ["Nagpur", "Maharashtra"],
  ["Delhi", "Delhi"], ["Bengaluru", "Karnataka"], ["Chennai", "Tamil Nadu"],
  ["Hyderabad", "Telangana"], ["Ahmedabad", "Gujarat"], ["Surat", "Gujarat"],
  ["Kolkata", "West Bengal"], ["Jaipur", "Rajasthan"], ["Lucknow", "Uttar Pradesh"],
  ["Indore", "Madhya Pradesh"], ["Chandigarh", "Chandigarh"], ["Kochi", "Kerala"],
  ["Coimbatore", "Tamil Nadu"], ["Nashik", "Maharashtra"], ["Bhopal", "Madhya Pradesh"],
];

// Weighted so the Cold pool has plenty of real volume to browse/filter/pull.
const statusWeights = [
  ["Hot (0–3 months)", 12], ["Warm (3–9 months)", 20], ["Cold (9+ months)", 45],
  ["Duplicate", 3], ["Junk", 5], ["WON", 8], ["LOST", 7],
];

const leadSources = ["Reference", "Self Generated", "Existing Database"];
const leadTypes = ["Net New", "SAP Installed Base", "PSU's"];
const priorities = ["High", "Medium", "Low"];
const nextActions = ["Call Back", "Online Meeting", "On-Site Meeting", "Proposal Submitted", "Negotiation", "Follow-Up"];
const turnovers = ["<10Cr", "10-50Cr", "50-100Cr", "100Cr+"];
const employeeCounts = ["1-10", "11-50", "51-200", "201+"];

const companyPrefixes = [
  "Shree", "National", "Bharat", "Modern", "United", "Prime", "Global", "Sunrise",
  "Krishna", "Metro", "Elite", "Apex", "Vishwa", "Sahyadri", "Coastal", "Deccan",
  "Sagar", "Om", "Silverline", "Vertex", "Horizon", "Falcon", "Pinnacle", "Everest",
];
const companySuffixes = [
  "Industries", "Enterprises", "Textiles", "Motors", "Pharma", "Steel", "Logistics",
  "Foods", "Chemicals", "Electronics", "Infra", "Realty", "Retail", "Traders",
  "Manufacturing", "Solutions", "Systems", "Exports", "Agro", "Power",
];
const companyForms = ["Pvt Ltd", "Ltd", "Industries Ltd", "Group", "& Co", "LLP"];

// A wide pool — a small one meant every search for a common name (e.g.
// "Sunita") surfaced the same exact person at dozens of unrelated companies.
const firstNames = [
  "Rajesh", "Sanjay", "Amit", "Priya", "Neha", "Vikram", "Anil", "Sunita", "Ravi", "Pooja",
  "Suresh", "Kavita", "Manish", "Deepa", "Arjun", "Nikhil", "Shreya", "Rohit", "Meera", "Ajay",
  "Divya", "Karan", "Swati", "Vivek", "Anjali", "Rahul", "Nisha", "Sameer", "Preeti", "Gaurav",
  "Sonia", "Naveen", "Ritu", "Ashok", "Vandana", "Deepak", "Sneha", "Vinay", "Rekha", "Harish",
  "Pallavi", "Sandeep", "Anita", "Mukesh", "Jyoti", "Rakesh", "Kiran", "Alok", "Namrata", "Vishal",
  "Sunil", "Geeta", "Prakash", "Madhuri", "Yogesh", "Seema", "Tarun", "Bhavna", "Vijay", "Ekta",
];
const lastNames = [
  "Kumar", "Sharma", "Shah", "Patel", "Singh", "Gupta", "Rao", "Iyer", "Menon", "Reddy",
  "Joshi", "Nair", "Verma", "Desai", "Mehta", "Chopra", "Malhotra", "Kapoor", "Bhatt", "Trivedi",
  "Pillai", "Agarwal", "Bose", "Chatterjee", "Dutta", "Ghosh", "Kulkarni", "Naidu", "Pandey", "Rastogi",
  "Saxena", "Sinha", "Thakur", "Varma", "Yadav", "Bhattacharya", "Chauhan", "Dubey", "Khanna", "Mishra",
];

const rand = (arr) => arr[randomInt(arr.length)];
const randInt = (min, max) => randomInt(min, max + 1);
const weightedRand = (pairs) => {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = randomInt(total);
  for (const [value, w] of pairs) {
    if (r < w) return value;
    r -= w;
  }
  return pairs[0][0];
};
const slug = (s) => s.toLowerCase().replaceAll(/[^a-z0-9]+/g, "");

async function run() {
  console.log("Connecting to:", process.env.DATABASE_URL?.replace(/:[^:@]+@/, ":****@"));

  const usersRes = await pool.query(`SELECT id, first_name, role FROM users WHERE status = 'active'`);
  const users = usersRes.rows;
  if (users.length === 0) {
    console.error("No active users found - cannot assign createdBy/leadAssignedTo. Aborting.");
    process.exit(1);
  }
  const bdmNames = ["Utkarsh", "Vishal", "Akash"];

  console.log(`Generating ${COUNT} test leads...`);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (let i = 0; i < COUNT; i++) {
      const [city, state] = rand(cities);
      const companyName = `${rand(companyPrefixes)} ${rand(companySuffixes)} ${rand(companyForms)}`;
      const status = weightedRand(statusWeights);
      const isHot = status === "Hot (0–3 months)";
      const creator = rand(users);
      const assignee = rand(users);
      const bdm = [rand(bdmNames)];
      const emailBase = slug(companyName).slice(0, 20);
      const contactFirst = rand(firstNames);
      const contactLast = rand(lastNames);

      const companyInfo = {
        leadType: rand(leadTypes),
        vertical: rand(industries),
        companyName,
        leadStatus: status,
        priority: rand(priorities),
        leadSource: rand(leadSources),
        city,
        state,
        country: "India",
        leadUsable: "Yes",
        leadAssignedTo: assignee.id,
        bdm,
        nextAction: rand(nextActions),
        dateField: new Date(Date.now() + randInt(-30, 60) * 86400000).toISOString().slice(0, 10),
        turnOverINR: rand(turnovers),
        employeeCount: rand(employeeCounts),
        expectedDealValue: isHot ? randInt(5, 500) * 100000 : 0,
        genericEmail1: `info@${emailBase}.com`,
        genericPhone1: `0${randInt(11, 44)}-${randInt(20000000, 99999999)}`,
        address: `${randInt(1, 999)}, Industrial Area, ${city}`,
        totalNoOfOffices: randInt(1, 15),
        totalNoOfManufUnits: randInt(0, 8),
        aboutTheCompany: `${companyName} is a growing player in the ${rand(industries).split(" / ")[0]} sector.`,
        reason: status === "LOST" ? "Went with a competitor" : "",
      };

      const contactInfo = {
        it: {
          name: `${contactFirst} ${contactLast}`,
          designation: "IT Manager",
          mobile: `9${randInt(100000000, 999999999)}`,
          email: `${contactFirst.toLowerCase()}.${contactLast.toLowerCase()}@${emailBase}.com`,
        },
        finance: {}, businessHead: {},
      };

      await client.query(
        `INSERT INTO leads (created_by, company_info, contact_info, it_landscape, descriptions)
         VALUES ($1, $2, $3, '{}'::jsonb, $4)`,
        [
          creator.id,
          JSON.stringify(companyInfo),
          JSON.stringify(contactInfo),
          JSON.stringify([{ description: "Seeded test lead.", addedBy: creator.id, createdAt: new Date().toISOString() }]),
        ]
      );

      if ((i + 1) % 200 === 0) console.log(`  ${i + 1}/${COUNT}...`);
    }

    await client.query("COMMIT");
    console.log(`Done - inserted ${COUNT} test leads.`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Seed failed, rolled back:", err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
