const { Client } = require('pg');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '../.env' });

async function run() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  await client.connect();
  console.log("Connected to PostgreSQL database...");

  try {
    // 1. Get or create Super Admin
    let adminRes = await client.query('SELECT * FROM users WHERE email = $1', ['admin@sagetl.com']);
    let adminId;
    const salt = await bcrypt.genSalt(10);
    const hashedAdminPassword = await bcrypt.hash('Admin@1234', salt);

    if (adminRes.rowCount === 0) {
      const insertAdmin = await client.query(`
        INSERT INTO users (first_name, last_name, designation, email, mobile, password, role, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
      `, ['Admin', 'Super Admin', 'Super Admin', 'admin@sagetl.com', '9999999999', hashedAdminPassword, 'admin', 'active']);
      adminId = insertAdmin.rows[0].id;
      console.log(`Created Super Admin with ID: ${adminId}`);
    } else {
      adminId = adminRes.rows[0].id;
      await client.query(`
        UPDATE users SET password = $1, role = 'admin', status = 'active', first_name = 'Admin', last_name = 'Super Admin', designation = 'Super Admin'
        WHERE id = $2
      `, [hashedAdminPassword, adminId]);
      console.log(`Ensured Super Admin is active with ID: ${adminId}`);
    }

    // 2. Update leads created_by to Super Admin for any lead NOT created by Super Admin
    await client.query('UPDATE leads SET created_by = $1 WHERE created_by != $1', [adminId]);
    console.log("Updated all leads' created_by to Super Admin.");

    // Update leadAssignedTo in company_info jsonb block if it points to non-admin users
    // Let's just set leadAssignedTo in company_info to null for safety since we're deleting all other users
    const leadsRes = await client.query('SELECT id, company_info FROM leads');
    for (const lead of leadsRes.rows) {
      if (lead.company_info) {
        const info = typeof lead.company_info === 'string' ? JSON.parse(lead.company_info) : lead.company_info;
        if (info.leadAssignedTo) {
          info.leadAssignedTo = null;
          await client.query('UPDATE leads SET company_info = $1 WHERE id = $2', [JSON.stringify(info), lead.id]);
        }
      }
    }
    console.log("Cleared leadAssignedTo assignments in company_info.");

    // 3. Update chat_groups.created_by to Super Admin
    await client.query('UPDATE chat_groups SET created_by = $1', [adminId]);
    // For chat groups members array, reset it to just contain Super Admin [adminId] for now
    await client.query('UPDATE chat_groups SET members = $1', [JSON.stringify([adminId])]);
    console.log("Updated chat groups ownership and membership to Super Admin.");

    // 4. Update messages sender_id/recipient_id to Super Admin or null
    await client.query('UPDATE messages SET sender_id = $1 WHERE sender_id != $1', [adminId]);
    await client.query('UPDATE messages SET recipient_id = NULL WHERE recipient_id != $1', [adminId]);
    console.log("Updated chat messages senders and recipients.");

    // 5. Delete all users except Super Admin
    const deleteRes = await client.query('DELETE FROM users WHERE id != $1', [adminId]);
    console.log(`Deleted ${deleteRes.rowCount} other users from database.`);

    // 6. Load new users from Users.json
    const usersData = JSON.parse(fs.readFileSync(path.join(__dirname, "../Users.json"), "utf-8"));
    const emailToId = { 'admin@sagetl.com': adminId };

    for (const u of usersData) {
      if (u.email === 'admin@sagetl.com') continue; // Already handled

      const userSalt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(u.password, userSalt);
      const nameParts = u.name.split(' ');
      const firstName = nameParts[0];
      const lastName = nameParts.slice(1).join(' ') || 'User';
      const designation = u.designation || (u.role === 'admin' ? 'Super Admin' : (u.role === 'supervisor' ? 'Supervisor' : 'Subuser'));
      const mobile = '1234567890';

      const insertRes = await client.query(`
        INSERT INTO users (first_name, last_name, designation, email, mobile, password, role, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
      `, [firstName, lastName, designation, u.email, mobile, hashedPassword, u.role, 'active']);

      emailToId[u.email] = insertRes.rows[0].id;
      console.log(`Created user ${u.name} (${u.email}) with ID: ${insertRes.rows[0].id}`);
    }

    // 7. Assign supervisors
    for (const u of usersData) {
      if (u.email === 'admin@sagetl.com') continue;

      if (u.supervisorEmail) {
        const supervisorId = emailToId[u.supervisorEmail];
        if (supervisorId) {
          const subId = emailToId[u.email];
          await client.query('UPDATE users SET supervisor_id = $1 WHERE id = $2', [supervisorId, subId]);
          console.log(`Assigned supervisor ${u.supervisorEmail} to user ${u.email}`);
        }
      }
    }

    console.log("Database user migration successfully completed!");
  } catch (error) {
    console.error("Migration error:", error);
  } finally {
    await client.end();
  }
}

run().catch(console.error);
