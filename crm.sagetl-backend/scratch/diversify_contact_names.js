// The bulk seed script only drew from 15 first names x 14 last names (210
// combinations) for every lead's IT contact, so searching a common name like
// "Sunita" surfaced the exact same person at dozens of unrelated companies —
// obviously fake. Reassigns every lead's IT contact name (and the email that
// has to match it) from a much larger pool, handed out WITHOUT repeats via a
// shuffle, so no two leads share the same contact name at all (as long as
// the lead count stays under the pool size). Local/test database only.
const { Pool } = require("pg");
const { randomInt } = require("node:crypto");
require("dotenv").config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const FIRST_NAMES = [
  "Rajesh", "Sanjay", "Amit", "Priya", "Neha", "Vikram", "Anil", "Sunita", "Ravi", "Pooja",
  "Suresh", "Kavita", "Manish", "Deepa", "Arjun", "Nikhil", "Shreya", "Rohit", "Meera", "Ajay",
  "Divya", "Karan", "Swati", "Vivek", "Anjali", "Rahul", "Nisha", "Sameer", "Preeti", "Gaurav",
  "Sonia", "Naveen", "Ritu", "Ashok", "Vandana", "Deepak", "Sneha", "Vinay", "Rekha", "Harish",
  "Pallavi", "Sandeep", "Anita", "Mukesh", "Jyoti", "Rakesh", "Kiran", "Alok", "Namrata", "Vishal",
  "Sunil", "Geeta", "Prakash", "Madhuri", "Yogesh", "Seema", "Tarun", "Bhavna", "Vijay", "Ekta",
];
const LAST_NAMES = [
  "Kumar", "Sharma", "Shah", "Patel", "Singh", "Gupta", "Rao", "Iyer", "Menon", "Reddy",
  "Joshi", "Nair", "Verma", "Desai", "Mehta", "Chopra", "Malhotra", "Kapoor", "Bhatt", "Trivedi",
  "Pillai", "Agarwal", "Bose", "Chatterjee", "Dutta", "Ghosh", "Kulkarni", "Naidu", "Pandey", "Rastogi",
  "Saxena", "Sinha", "Thakur", "Varma", "Yadav", "Bhattacharya", "Chauhan", "Dubey", "Khanna", "Mishra",
];

const rand = (arr) => arr[randomInt(arr.length)];

// Fisher-Yates, using the same crypto-backed randomInt as the rest of the
// seed scripts — nothing security-sensitive here, just no reason not to.
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function run() {
  console.log("Connecting to:", process.env.DATABASE_URL?.replace(/:[^:@]+@/, ":****@"));

  const leadsRes = await pool.query(
    `SELECT lead_number, company_info, contact_info FROM leads WHERE contact_info->'it'->>'name' IS NOT NULL`
  );
  const leads = leadsRes.rows;
  console.log(`${leads.length} leads with an IT contact to diversify.`);

  const combos = shuffle(
    FIRST_NAMES.flatMap((f) => LAST_NAMES.map((l) => [f, l]))
  );
  if (combos.length < leads.length) {
    console.warn(
      `Only ${combos.length} name combinations for ${leads.length} leads — some repeats are unavoidable, but far fewer than before.`
    );
  }

  const slug = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

  const client = await pool.connect();
  let updated = 0;
  try {
    await client.query("BEGIN");
    for (let i = 0; i < leads.length; i++) {
      const lead = leads[i];
      const [first, last] = combos[i % combos.length];
      const emailBase = slug(lead.company_info?.companyName).slice(0, 20) || "company";
      const it = lead.contact_info?.it || {};

      const nextIt = {
        ...it,
        name: `${first} ${last}`,
        email: `${first.toLowerCase()}.${last.toLowerCase()}@${emailBase}.com`,
      };

      await client.query(
        `UPDATE leads SET contact_info = jsonb_set(contact_info, '{it}', $1::jsonb) WHERE lead_number = $2`,
        [JSON.stringify(nextIt), lead.lead_number]
      );
      updated += 1;
      if (updated % 300 === 0) console.log(`  ${updated}/${leads.length}...`);
    }
    await client.query("COMMIT");
    console.log(`Done — renamed ${updated} IT contacts.`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Failed, rolled back:", err.message);
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
