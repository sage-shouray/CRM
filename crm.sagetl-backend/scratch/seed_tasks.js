const { Client } = require('pg');
require('dotenv').config({ path: '../.env' });

async function run() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  await client.connect();
  console.log("Connected to database...");

  // Delete existing tasks for clean seeding
  await client.query('DELETE FROM tasks');
  console.log("Cleared existing tasks.");

  const todayStr = new Date().toISOString().split("T")[0];

  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayStr = yesterdayDate.toISOString().split("T")[0];

  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 3);
  const tomorrowStr = tomorrowDate.toISOString().split("T")[0];

  const initialTasks = [
    {
      taskId: "task-1",
      title: "Follow up with SAP ERP Lead #1002 (Call Back for Proposal)",
      associatedLead: "SAP Enterprise Solutions (TechCorp)",
      description: "Client requested updated SLA uptime guarantees and 256-bit encryption compliance documentation before contract signing.",
      originalDueDate: yesterdayStr,
      dueDate: yesterdayStr,
      priority: "High",
      status: "not_done",
      category: "Follow-up",
      userId: 9 // Anushka
    },
    {
      taskId: "task-2",
      title: "Review daily unassigned lead queue and assign to team subusers",
      associatedLead: "Global Logistics & Supply Chain",
      description: "Verify incoming lead form entries, check phone numbers, and assign high-turnover accounts to Vaidehi and Tejal.",
      originalDueDate: todayStr,
      dueDate: todayStr,
      priority: "Medium",
      status: "pending",
      category: "Management",
      userId: 4 // Super Admin
    },
    {
      taskId: "task-3",
      title: "Prepare weekly CRM pipeline summary report for Admin review",
      associatedLead: "General / Management",
      description: "Compile total conversion statistics, supervisor follow-up completion rates, and weekly lead acquisition counts.",
      originalDueDate: todayStr,
      dueDate: todayStr,
      priority: "Low",
      status: "done",
      category: "Report",
      userId: 4 // Super Admin
    },
    {
      taskId: "task-4",
      title: "Cloud Matrix Infrastructure SLA demonstration meeting",
      associatedLead: "Cloud Matrix IT Infrastructure",
      description: "Rescheduled live demonstration of CRM features and profile password provisions.",
      originalDueDate: todayStr,
      dueDate: tomorrowStr,
      priority: "High",
      status: "postponed",
      category: "Meeting",
      userId: 10 // Kanishka
    }
  ];

  try {
    for (const task of initialTasks) {
      await client.query(`
        INSERT INTO tasks (task_id, title, associated_lead, description, original_due_date, due_date, priority, status, category, user_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [
        task.taskId,
        task.title,
        task.associatedLead,
        task.description,
        task.originalDueDate,
        task.dueDate,
        task.priority,
        task.status,
        task.category,
        task.userId
      ]);
      console.log(`Seeded task: ${task.title}`);
    }
    console.log("All tasks seeded successfully!");
  } catch (err) {
    console.error("Error seeding tasks:", err);
  } finally {
    await client.end();
  }
}

run().catch(console.error);
