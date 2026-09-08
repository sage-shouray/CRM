// The bulk seeder wrote a placeholder "Seeded test lead." as every lead's own
// description, and — because it inserted rows directly instead of going
// through POST /api/leads — never tagged it type:"description". That let the
// placeholder leak into "last note" everywhere that reads a lead's most
// recent description (the Cold Lead Pool tooltip/report included), making it
// obvious the data was fake. Replaces it with the company blurb the seeder
// already generated (companyInfo.aboutTheCompany) and tags it correctly, so
// it behaves exactly like a lead created through the real form. Local/test
// database only.
const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  console.log("Connecting to:", process.env.DATABASE_URL?.replace(/:[^:@]+@/, ":****@"));

  const rows = (
    await pool.query(`
      SELECT lead_number, company_info->>'aboutTheCompany' AS about, descriptions
        FROM leads
       WHERE descriptions->0->>'description' = 'Seeded test lead.'
    `)
  ).rows;
  console.log(`${rows.length} leads with the placeholder description.`);

  const client = await pool.connect();
  let updated = 0;
  try {
    await client.query("BEGIN");
    for (const row of rows) {
      const descriptions = row.descriptions || [];
      const first = descriptions[0];
      if (!first) continue;
      const next = [
        { ...first, description: row.about || first.description, type: "description" },
        ...descriptions.slice(1),
      ];
      await client.query(
        `UPDATE leads SET descriptions = $1::jsonb WHERE lead_number = $2`,
        [JSON.stringify(next), row.lead_number]
      );
      updated += 1;
    }
    await client.query("COMMIT");
    console.log(`Updated ${updated} leads.`);
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
