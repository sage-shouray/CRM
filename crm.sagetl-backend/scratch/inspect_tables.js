const { Client } = require('pg');
require('dotenv').config({ path: '../.env' });

async function run() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  await client.connect();

  console.log("=== CHAT GROUPS ===");
  const chatGroupsRes = await client.query('SELECT * FROM chat_groups');
  console.log(chatGroupsRes.rows);

  console.log("=== MESSAGES ===");
  const messagesRes = await client.query('SELECT * FROM messages');
  console.log(messagesRes.rows);

  await client.end();
}

run().catch(console.error);
