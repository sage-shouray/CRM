const { Client } = require('pg');
require('dotenv').config({ path: '../.env' });

async function run() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  await client.connect();

  console.log("=== USERS ===");
  const usersRes = await client.query('SELECT id, first_name, last_name, email, role, designation, supervisor_id, status FROM users');
  console.log(usersRes.rows);

  console.log("=== LEADS COUNT ===");
  const leadsRes = await client.query('SELECT COUNT(*) FROM leads');
  console.log(leadsRes.rows[0]);

  console.log("=== LEADS CREATORS ===");
  const creatorsRes = await client.query('SELECT DISTINCT created_by FROM leads');
  console.log(creatorsRes.rows);

  await client.end();
}

run().catch(console.error);
