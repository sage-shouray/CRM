// Replaces the small set of repeated canned notes on Cold Lead Pool test data
// with varied, personalized ones — mentioning the actual contact by name where
// one exists, the company, and a believable specific detail (a day, a reason,
// a next step) — so scrolling through them doesn't read as the same handful
// of sentences over and over. Local/test database only.
const { Pool } = require("pg");
const { randomInt } = require("node:crypto");
require("dotenv").config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const rand = (arr) => arr[randomInt(arr.length)];
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

// Each contact role's name, if the lead has one recorded — falls back to a
// role-shaped description when it doesn't, same as a rep would write it.
function contactLabel(contactInfo) {
  const roles = [
    { data: contactInfo?.it, fallback: "the IT contact" },
    { data: contactInfo?.finance, fallback: "someone in finance" },
    { data: contactInfo?.businessHead, fallback: "the business head" },
  ];
  const withName = roles.filter((r) => r.data?.name);
  if (withName.length > 0) {
    const pick = rand(withName);
    return { name: pick.data.name, designation: pick.data.designation || null };
  }
  const pick = rand(roles);
  return { name: null, fallback: pick.fallback };
}

// Templates take {who, company, city, day, weeks} — each one reads like an
// actual line a BDM would type after a call, not a report summary.
const TEMPLATES = [
  ({ who, day }) => `Called ${who} on ${day}, no pickup. Tried again in the afternoon — same.`,
  ({ who }) => `Got through to ${who}. Said budgets are frozen till next quarter, asked to check back then.`,
  ({ who, company }) => `${who} said ${company} already has a vendor for this — worth revisiting once the contract's up.`,
  ({ who }) => `Spoke to ${who} briefly, asked us to send details over email instead of calling again.`,
  ({ who, day }) => `Tried ${who} on ${day} — number rang out. Will try their alternate line next week.`,
  ({ who }) => `${who} wasn't available, left a message with the front desk to call back.`,
  ({ who }) => `${who} picked up but said they're mid-audit right now, asked us to try again in a couple of weeks.`,
  ({ who, weeks }) => `Emailed ${who} the brochure after the call — no response yet, will follow up in ${weeks} weeks if quiet.`,
  ({ who }) => `${who} said this isn't their call — procurement handles vendor decisions, asked for a contact there.`,
  ({ company }) => `Sent a LinkedIn message to ${company}'s decision maker, connection still pending.`,
  ({ who, day }) => `${who} asked us to call back after ${day} — said they're travelling this week.`,
  ({ who }) => `Reached ${who}, seemed interested but wants a formal proposal before discussing further.`,
  ({ who }) => `${who} mentioned pricing is the main concern — asked if we have anything more competitive.`,
  ({ company, weeks }) => `No answer from ${company} on the last two attempts — parking this for ${weeks} weeks.`,
  ({ who }) => `${who} said they're happy with their current setup for now, worth a check-in later this year.`,
  ({ who }) => `${who} answered but the line was breaking up badly — couldn't get much across, will retry.`,
  ({ who }) => `Left a voicemail for ${who}, no callback yet.`,
  ({ who }) => `${who} said to WhatsApp the details instead — sent it right after the call.`,
  ({ who, day }) => `${who} was out of office, back on ${day} per the front desk.`,
  ({ company }) => `Requested a callback through ${company}'s website contact form — nothing yet.`,
];

function makeNote(companyInfo, contactInfo) {
  const company = companyInfo?.companyName || "the company";
  const contact = contactLabel(contactInfo || {});
  let who;
  if (contact.name) {
    const designationSuffix = contact.designation ? ` (${contact.designation})` : "";
    who = `${contact.name}${designationSuffix}`;
  } else {
    who = contact.fallback;
  }
  const day = rand(DAYS);
  const weeks = rand([2, 3, 4, 6]);
  return rand(TEMPLATES)({ who, company, day, weeks });
}

async function run() {
  console.log("Connecting to:", process.env.DATABASE_URL?.replace(/:[^:@]+@/, ":****@"));

  const pullsRes = await pool.query(`
    SELECT p.id, p.lead_number, p.return_note, p.returned_at,
           l.company_info, l.contact_info
      FROM cold_lead_pulls p
      JOIN leads l ON l.lead_number = p.lead_number
     WHERE p.return_note IS NOT NULL AND p.return_note <> ''
  `);
  console.log(`${pullsRes.rows.length} noted pulls to rewrite.`);

  const client = await pool.connect();
  let updated = 0;
  let unmatched = 0;
  try {
    await client.query("BEGIN");

    for (const row of pullsRes.rows) {
      const newNote = makeNote(row.company_info, row.contact_info);

      await client.query(
        `UPDATE cold_lead_pulls SET return_note = $1 WHERE id = $2`,
        [newNote, row.id]
      );

      // The matching entry in leads.descriptions was written with the exact
      // same text and the exact same timestamp (returned_at) at creation
      // time — that pairing is how the right array element is found.
      const descRes = await client.query(
        `SELECT descriptions FROM leads WHERE lead_number = $1`,
        [row.lead_number]
      );
      const descriptions = descRes.rows[0]?.descriptions || [];
      const returnedAtIso = new Date(row.returned_at).toISOString();
      let matched = false;
      const next = descriptions.map((d) => {
        if (matched) return d;
        const sameText = d.description === row.return_note;
        const sameTime =
          d.createdAt && Math.abs(new Date(d.createdAt).getTime() - new Date(returnedAtIso).getTime()) < 2000;
        if (sameText && sameTime) {
          matched = true;
          return { ...d, description: newNote };
        }
        return d;
      });

      if (matched) {
        await client.query(
          `UPDATE leads SET descriptions = $1::jsonb WHERE lead_number = $2`,
          [JSON.stringify(next), row.lead_number]
        );
        updated += 1;
      } else {
        unmatched += 1;
      }
    }

    await client.query("COMMIT");
    console.log(`Rewrote ${updated} notes (both cold_lead_pulls and the lead's own activity log).`);
    if (unmatched > 0) {
      console.log(`${unmatched} pull(s) had no matching activity entry to update (cold_lead_pulls row updated anyway).`);
    }
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
