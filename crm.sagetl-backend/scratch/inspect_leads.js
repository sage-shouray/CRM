const { Client } = require('pg');
require('dotenv').config({ path: '../.env' });

async function run() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  await client.connect();

  console.log("=== LEADS ===");
  const leadsRes = await client.query('SELECT id, lead_number, created_by, company_info FROM leads');
  for (const row of leadsRes.rows) {
    console.log(`Lead #${row.lead_number}: created_by=${row.created_by}, assignedTo=${row.company_info?.leadAssignedTo}`);
  }

  await client.end();
}

run().catch(console.error);
