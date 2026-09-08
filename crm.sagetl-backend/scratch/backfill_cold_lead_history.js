// Gives every currently-untouched Cold lead one realistic piece of history —
// who pulled it before, when, and what note they left — purely so the pool
// table's "Last Pulled By" column and hover tooltip have something to show
// when browsing test data. Local/test database only.
const { Pool } = require("pg");
const { randomInt } = require("node:crypto");
require("dotenv").config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const notes = [
  "Called twice, no answer. Left a voicemail.",
  "Spoke to the front desk, decision maker unavailable. Will retry.",
  "Emailed a follow-up with our brochure, no response yet.",
  "Reached the IT contact — said budget freeze until next quarter.",
  "Left a message with the receptionist to call back.",
  "Company said they already have a vendor, revisit in 6 months.",
  "Number was unreachable, will try an alternate contact.",
  "Sent a LinkedIn connection request to the CIO, no reply yet.",
  "Spoke briefly — asked to send more info over email.",
  "No response after 3 attempts, marking for a longer follow-up cycle.",
  "Contact said they're evaluating options, check back in Q2.",
  "Line was busy every time this week, will retry next week.",
  "Got through to finance, they said IT handles vendor decisions.",
  "Requested a callback via their website contact form.",
  "Spoke to the office manager, forwarded our proposal internally.",
];

// Only shuffles fake demo data (which sample note / which test user / which
// day) — nothing security- or auth-related — but crypto.randomInt is used
// anyway since it's free here and keeps static analysis quiet everywhere.
const rand = (arr) => arr[randomInt(arr.length)];
const randInt = (min, max) => randomInt(min, max + 1);

async function run() {
  console.log("Connecting to:", process.env.DATABASE_URL?.replace(/:[^:@]+@/, ":****@"));

  const usersRes = await pool.query(`SELECT id FROM users WHERE status = 'active'`);
  const userIds = usersRes.rows.map((r) => r.id);
  if (userIds.length === 0) {
    console.error("No active users found. Aborting.");
    process.exit(1);
  }

  const leadsRes = await pool.query(`
    SELECT l.lead_number
      FROM leads l
     WHERE l.company_info->>'leadStatus' = 'Cold (9+ months)'
       AND NOT EXISTS (SELECT 1 FROM cold_lead_pulls p WHERE p.lead_number = l.lead_number)
  `);
  const leadNumbers = leadsRes.rows.map((r) => r.lead_number);
  console.log(`Backfilling history for ${leadNumbers.length} never-pulled Cold leads...`);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let count = 0;
    for (const leadNumber of leadNumbers) {
      const userId = rand(userIds);
      const note = rand(notes);
      const daysAgoPulled = randInt(3, 120);
      const hoursToReturn = randInt(1, 72);

      // Historical pull: batch_id left NULL on purpose, so this never counts
      // as anyone's "current batch" and can't affect the pull-gating logic —
      // it's pure history for display, not a live obligation.
      await client.query(
        `INSERT INTO cold_lead_pulls (lead_number, user_id, pulled_at, returned_at, return_note, batch_id)
         VALUES ($1, $2, NOW() - ($3 || ' days')::interval,
                          NOW() - ($3 || ' days')::interval + ($4 || ' hours')::interval,
                          $5, NULL)`,
        [leadNumber, userId, daysAgoPulled, hoursToReturn, note]
      );

      const noteEntry = JSON.stringify([
        {
          description: note,
          addedBy: userId,
          createdAt: new Date(Date.now() - (daysAgoPulled * 86400000) + (hoursToReturn * 3600000)).toISOString(),
        },
      ]);
      await client.query(
        `UPDATE leads SET descriptions = descriptions || $1::jsonb WHERE lead_number = $2`,
        [noteEntry, leadNumber]
      );

      count += 1;
      if (count % 100 === 0) console.log(`  ${count}/${leadNumbers.length}...`);
    }

    await client.query("COMMIT");
    console.log(`Done — backfilled ${count} leads with pull history + notes.`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Backfill failed, rolled back:", err.message);
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
