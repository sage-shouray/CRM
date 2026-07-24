require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/crm';
const pool = new Pool({ connectionString });

// Helper to convert MongoDB-style queries to PostgreSQL WHERE clauses
function buildWhereClause(query, startParamIndex = 1) {
  const conditions = [];
  const values = [];
  let paramIndex = startParamIndex;

  for (const [key, value] of Object.entries(query)) {
    if (key === '$or') {
      const orConditions = [];
      for (const subQuery of value) {
        const sub = buildWhereClause(subQuery, paramIndex);
        if (sub.where) {
          orConditions.push(sub.where.replace('WHERE ', ''));
          values.push(...sub.values);
          paramIndex += sub.values.length;
        }
      }
      if (orConditions.length > 0) {
        conditions.push('(' + orConditions.join(' OR ') + ')');
      }
      continue;
    }

    let col = key;
    if (key === '_id' || key === 'id') {
      col = 'id';
    } else if (key.includes('.')) {
      const parts = key.split('.');
      const topCol = parts[0];
      let mappedCol = '';
      if (topCol === 'companyInfo') mappedCol = 'company_info';
      else if (topCol === 'contactInfo') mappedCol = 'contact_info';
      else if (topCol === 'itLandscape') mappedCol = 'it_landscape';
      else mappedCol = topCol;
      
      let jsonPath = mappedCol;
      for (let i = 1; i < parts.length; i++) {
        const isLast = i === parts.length - 1;
        if (isLast) {
          jsonPath += `->>'${parts[i]}'`;
        } else {
          jsonPath += `->'${parts[i]}'`;
        }
      }
      col = jsonPath;
    } else {
      if (col === 'firstName') col = 'first_name';
      else if (col === 'lastName') col = 'last_name';
      else if (col === 'supervisor') col = 'supervisor_id';
      else if (col === 'createdBy') col = 'created_by';
    }

    if (value === null || value === undefined) {
      conditions.push(`${col} IS NULL`);
    } else if (typeof value === 'object' && value !== null && !(value instanceof Date)) {
      if (value.$in) {
        if (value.$in.length === 0) {
          conditions.push('1 = 0');
        } else {
          const placeholders = value.$in.map(() => `$${paramIndex++}`);
          conditions.push(`${col} IN (${placeholders.join(', ')})`);
          values.push(...value.$in.map(v => (v && v._id) ? v._id : v));
        }
      } else if (value.$nin) {
        if (value.$nin.length === 0) {
          conditions.push('1 = 1');
        } else {
          const placeholders = value.$nin.map(() => `$${paramIndex++}`);
          conditions.push(`${col} NOT IN (${placeholders.join(', ')})`);
          values.push(...value.$nin.map(v => (v && v._id) ? v._id : v));
        }
      } else if (value.$ne) {
        conditions.push(`${col} != $${paramIndex++}`);
        values.push((value.$ne && value.$ne._id) ? value.$ne._id : value.$ne);
      } else if (value.$regex) {
        conditions.push(`${col} ~* $${paramIndex++}`);
        values.push(value.$regex);
      }
    } else {
      const finalVal = (value && typeof value === 'object' && value._id) ? value._id : value;
      conditions.push(`${col} = $${paramIndex++}`);
      values.push(finalVal);
    }
  }

  return {
    where: conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '',
    values
  };
}

// Map database User row to CamelCase object
function mapUser(row) {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    designation: row.designation,
    email: row.email,
    mobile: row.mobile,
    password: row.password,
    role: row.role,
    supervisor: row.supervisor_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// Map CamelCase User object to database columns
function mapUserToDb(data) {
  const fields = {};
  if (data.firstName !== undefined) fields.first_name = data.firstName;
  if (data.lastName !== undefined) fields.last_name = data.lastName;
  if (data.designation !== undefined) fields.designation = data.designation;
  if (data.email !== undefined) fields.email = data.email;
  if (data.mobile !== undefined) fields.mobile = data.mobile;
  if (data.password !== undefined) fields.password = data.password;
  if (data.role !== undefined) fields.role = data.role;
  if (data.supervisor !== undefined) fields.supervisor_id = data.supervisor === '' || data.supervisor === null ? null : Number(data.supervisor);
  if (data.status !== undefined) fields.status = data.status;
  return fields;
}

// Map database Lead row to CamelCase object
function mapLead(row) {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    leadNumber: row.lead_number,
    createdBy: row.created_by,
    companyInfo: row.company_info || {},
    contactInfo: row.contact_info || {},
    itLandscape: row.it_landscape || {},
    descriptions: row.descriptions || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// Map CamelCase Lead object to database columns
function mapLeadToDb(data) {
  const fields = {};
  if (data.createdBy !== undefined) fields.created_by = data.createdBy === '' || data.createdBy === null ? null : Number(data.createdBy);
  if (data.companyInfo !== undefined) fields.company_info = typeof data.companyInfo === 'string' ? data.companyInfo : JSON.stringify(data.companyInfo);
  if (data.contactInfo !== undefined) fields.contact_info = typeof data.contactInfo === 'string' ? data.contactInfo : JSON.stringify(data.contactInfo);
  if (data.itLandscape !== undefined) fields.it_landscape = typeof data.itLandscape === 'string' ? data.itLandscape : JSON.stringify(data.itLandscape);
  if (data.descriptions !== undefined) fields.descriptions = typeof data.descriptions === 'string' ? data.descriptions : JSON.stringify(data.descriptions);
  return fields;
}

// Instance representing a single User record (for .save())
class UserModelInstance {
  constructor(data) {
    Object.assign(this, data);
  }
  
  async save() {
    const dbFields = mapUserToDb(this);
    const keys = Object.keys(dbFields);
    const values = Object.values(dbFields);
    
    if (this.id) {
      const setClause = keys.map((k, idx) => `"${k}" = $${idx + 1}`).join(', ');
      const query = `UPDATE users SET ${setClause} WHERE id = $${keys.length + 1} RETURNING *`;
      const res = await pool.query(query, [...values, this.id]);
      Object.assign(this, mapUser(res.rows[0]));
      return this;
    } else {
      const placeholders = keys.map((_, idx) => `$${idx + 1}`).join(', ');
      const query = `INSERT INTO users (${keys.map(k => `"${k}"`).join(', ')}) VALUES (${placeholders}) RETURNING *`;
      const res = await pool.query(query, values);
      Object.assign(this, mapUser(res.rows[0]));
      return this;
    }
  }
}

// Instance representing a single Lead record (for .save() and .populate())
class LeadModelInstance {
  constructor(data) {
    Object.assign(this, data);
  }
  
  async save() {
    const dbFields = mapLeadToDb(this);
    const keys = Object.keys(dbFields);
    const values = Object.values(dbFields);
    
    if (this.id) {
      const setClause = keys.map((k, idx) => `"${k}" = $${idx + 1}`).join(', ');
      const query = `UPDATE leads SET ${setClause} WHERE id = $${keys.length + 1} RETURNING *`;
      const res = await pool.query(query, [...values, this.id]);
      Object.assign(this, mapLead(res.rows[0]));
      return this;
    } else {
      const placeholders = keys.map((_, idx) => `$${idx + 1}`).join(', ');
      const query = `INSERT INTO leads (${keys.map(k => `"${k}"`).join(', ')}) VALUES (${placeholders}) RETURNING *`;
      const res = await pool.query(query, values);
      Object.assign(this, mapLead(res.rows[0]));
      return this;
    }
  }

  async populate(path, select) {
    if (path === 'descriptions.addedBy' && this.descriptions) {
      const userIds = [...new Set(this.descriptions.map(d => d.addedBy).filter(Boolean))];
      if (userIds.length > 0) {
        const uRes = await pool.query(`SELECT * FROM users WHERE id IN (${userIds.join(',')})`);
        const uMap = {};
        uRes.rows.map(mapUser).forEach(u => {
          uMap[u.id] = u;
        });
        this.descriptions.forEach(d => {
          if (d.addedBy && uMap[d.addedBy]) {
            d.addedBy = uMap[d.addedBy];
          }
        });
      }
    }
    return this;
  }
}

// Instance representing options record
class OptionsModelInstance {
  constructor(data) {
    this.data = data;
  }
  toJSON() {
    return this.data;
  }
  async save() {
    const countRes = await pool.query('SELECT COUNT(*) FROM options');
    if (parseInt(countRes.rows[0].count, 10) > 0) {
      const res = await pool.query('UPDATE options SET data = $1 RETURNING *', [this.data]);
      this.data = res.rows[0].data;
      return this;
    } else {
      const res = await pool.query('INSERT INTO options (data) VALUES ($1) RETURNING *', [this.data]);
      this.data = res.rows[0].data;
      return this;
    }
  }
}

// User Model query helpers
const User = {
  find: function(query, projection) {
    let queryBuilder = {
      populate: function(path, select) {
        this._populates.push({ path, select });
        return this;
      },
      select: function(fields) {
        return this;
      },
      sort: function(options) {
        this._sort = options;
        return this;
      },
      limit: function(num) {
        this._limit = num;
        return this;
      },
      _populates: [],
      then: async function(resolve, reject) {
        try {
          const res = await this.exec();
          resolve(res);
        } catch (e) {
          reject(e);
        }
      },
      exec: async function() {
        const { where, values } = buildWhereClause(query || {});
        let sql = `SELECT * FROM users ${where}`;
        if (this._sort) {
          sql += ` ORDER BY id DESC`; 
        }
        if (this._limit) {
          sql += ` LIMIT ${this._limit}`;
        }
        const res = await pool.query(sql, values);
        let items = res.rows.map(mapUser).map(u => {
          const inst = new UserModelInstance(u);
          if (projection === '-password' || (projection && (projection.password === 0 || projection.password === false))) {
            delete inst.password;
          }
          return inst;
        });
        
        for (const pop of this._populates) {
          if (pop.path === 'supervisor') {
            const supervisorIds = [...new Set(items.map(u => u.supervisor).filter(Boolean))];
            if (supervisorIds.length > 0) {
              const supRes = await pool.query(`SELECT * FROM users WHERE id IN (${supervisorIds.join(',')})`);
              const supMap = {};
              supRes.rows.map(mapUser).forEach(s => {
                supMap[s.id] = s;
              });
              items.forEach(u => {
                if (u.supervisor) {
                  u.supervisor = supMap[u.supervisor] || null;
                }
              });
            }
          }
        }
        return items;
      }
    };
    queryBuilder.then = queryBuilder.then.bind(queryBuilder);
    return queryBuilder;
  },
  
  findOne: async function(query) {
    const { where, values } = buildWhereClause(query || {});
    const sql = `SELECT * FROM users ${where} LIMIT 1`;
    const res = await pool.query(sql, values);
    if (res.rowCount === 0) return null;
    return new UserModelInstance(mapUser(res.rows[0]));
  },
  
  findById: async function(id) {
    if (!id) return null;
    const res = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    if (res.rowCount === 0) return null;
    return new UserModelInstance(mapUser(res.rows[0]));
  },
  
  findByIdAndUpdate: async function(id, update, options) {
    const dbFields = mapUserToDb(update);
    const keys = Object.keys(dbFields);
    const values = Object.values(dbFields);
    if (keys.length === 0) return this.findById(id);
    const setClause = keys.map((k, idx) => `"${k}" = $${idx + 1}`).join(', ');
    const sql = `UPDATE users SET ${setClause} WHERE id = $${keys.length + 1} RETURNING *`;
    const res = await pool.query(sql, [...values, id]);
    if (res.rowCount === 0) return null;
    return new UserModelInstance(mapUser(res.rows[0]));
  },
  
  countDocuments: async function(query) {
    const { where, values } = buildWhereClause(query || {});
    const sql = `SELECT COUNT(*) FROM users ${where}`;
    const res = await pool.query(sql, values);
    return parseInt(res.rows[0].count, 10);
  }
};

// Lead Model query helpers
const Lead = {
  find: function(query) {
    let queryBuilder = {
      populate: function(path, select) {
        this._populates.push({ path, select });
        return this;
      },
      sort: function(options) {
        this._sort = options;
        return this;
      },
      limit: function(num) {
        this._limit = num;
        return this;
      },
      _populates: [],
      then: async function(resolve, reject) {
        try {
          const res = await this.exec();
          resolve(res);
        } catch (e) {
          reject(e);
        }
      },
      exec: async function() {
        const { where, values } = buildWhereClause(query || {});
        let sql = `SELECT * FROM leads ${where}`;
        if (this._sort) {
          sql += ` ORDER BY id DESC`;
        }
        if (this._limit && this._limit > 0) {
          sql += ` LIMIT ${this._limit}`;
        }
        const res = await pool.query(sql, values);
        let items = res.rows.map(mapLead).map(l => new LeadModelInstance(l));
        
        for (const pop of this._populates) {
          if (pop.path === 'createdBy') {
            const userIds = [...new Set(items.map(l => l.createdBy).filter(Boolean))];
            if (userIds.length > 0) {
              const uRes = await pool.query(`SELECT * FROM users WHERE id IN (${userIds.join(',')})`);
              const uMap = {};
              uRes.rows.map(mapUser).forEach(u => {
                uMap[u.id] = u;
              });
              items.forEach(l => {
                if (l.createdBy) {
                  l.createdBy = uMap[l.createdBy] || null;
                }
              });
            }
          } else if (pop.path === 'companyInfo.leadAssignedTo') {
            const userIds = [...new Set(items.map(l => l.companyInfo.leadAssignedTo).filter(id => id && !isNaN(id)))];
            if (userIds.length > 0) {
              const uRes = await pool.query(`SELECT * FROM users WHERE id IN (${userIds.join(',')})`);
              const uMap = {};
              uRes.rows.map(mapUser).forEach(u => {
                uMap[u.id] = u;
              });
              items.forEach(l => {
                const assignedId = l.companyInfo.leadAssignedTo;
                if (assignedId && uMap[assignedId]) {
                  l.companyInfo.leadAssignedTo = uMap[assignedId];
                }
              });
            }
          } else if (pop.path === 'descriptions.addedBy') {
            const userIds = [];
            items.forEach(l => {
              if (l.descriptions) {
                l.descriptions.forEach(d => {
                  if (d.addedBy) userIds.push(d.addedBy);
                });
              }
            });
            const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
            if (uniqueUserIds.length > 0) {
              const uRes = await pool.query(`SELECT * FROM users WHERE id IN (${uniqueUserIds.join(',')})`);
              const uMap = {};
              uRes.rows.map(mapUser).forEach(u => {
                uMap[u.id] = u;
              });
              items.forEach(l => {
                if (l.descriptions) {
                  l.descriptions.forEach(d => {
                    if (d.addedBy && uMap[d.addedBy]) {
                      d.addedBy = uMap[d.addedBy];
                    }
                  });
                }
              });
            }
          }
        }
        return items;
      }
    };
    queryBuilder.then = queryBuilder.then.bind(queryBuilder);
    return queryBuilder;
  },
  
  findOne: function(query) {
    let queryBuilder = {
      populate: function(path, select) {
        this._populates.push({ path, select });
        return this;
      },
      _populates: [],
      then: async function(resolve, reject) {
        try {
          const res = await this.exec();
          resolve(res);
        } catch (e) {
          reject(e);
        }
      },
      exec: async function() {
        const { where, values } = buildWhereClause(query || {});
        const sql = `SELECT * FROM leads ${where} LIMIT 1`;
        const res = await pool.query(sql, values);
        if (res.rowCount === 0) return null;
        let item = new LeadModelInstance(mapLead(res.rows[0]));
        
        for (const pop of this._populates) {
          if (pop.path === 'createdBy' && item.createdBy) {
            const uRes = await pool.query('SELECT * FROM users WHERE id = $1', [item.createdBy]);
            if (uRes.rowCount > 0) item.createdBy = mapUser(uRes.rows[0]);
          } else if (pop.path === 'descriptions.addedBy' && item.descriptions) {
            const userIds = [...new Set(item.descriptions.map(d => d.addedBy).filter(Boolean))];
            if (userIds.length > 0) {
              const uRes = await pool.query(`SELECT * FROM users WHERE id IN (${userIds.join(',')})`);
              const uMap = {};
              uRes.rows.map(mapUser).forEach(u => {
                uMap[u.id] = u;
              });
              item.descriptions.forEach(d => {
                if (d.addedBy && uMap[d.addedBy]) {
                  d.addedBy = uMap[d.addedBy];
                }
              });
            }
          }
        }
        return item;
      }
    };
    queryBuilder.then = queryBuilder.then.bind(queryBuilder);
    return queryBuilder;
  },
  
  findById: async function(id) {
    if (!id) return null;
    const res = await pool.query('SELECT * FROM leads WHERE id = $1', [id]);
    if (res.rowCount === 0) return null;
    return new LeadModelInstance(mapLead(res.rows[0]));
  },
  
  findByIdAndUpdate: async function(id, update, options) {
    const dbFields = mapLeadToDb(update);
    const keys = Object.keys(dbFields);
    const values = Object.values(dbFields);
    if (keys.length === 0) return this.findById(id);
    const setClause = keys.map((k, idx) => `"${k}" = $${idx + 1}`).join(', ');
    const sql = `UPDATE leads SET ${setClause} WHERE id = $${keys.length + 1} RETURNING *`;
    const res = await pool.query(sql, [...values, id]);
    if (res.rowCount === 0) return null;
    return new LeadModelInstance(mapLead(res.rows[0]));
  }
};

// Task Model Instance
class TaskModelInstance {
  constructor(data) {
    Object.assign(this, data);
  }
  
  async save() {
    const dbFields = {
      task_id: this.taskId,
      title: this.title,
      associated_lead: this.associatedLead,
      description: this.description,
      original_due_date: this.originalDueDate,
      due_date: this.dueDate,
      priority: this.priority,
      status: this.status,
      category: this.category,
      user_id: this.userId ? Number(this.userId) : null
    };
    const keys = Object.keys(dbFields);
    const values = Object.values(dbFields);
    
    if (this.id) {
      const setClause = keys.map((k, idx) => `"${k}" = $${idx + 1}`).join(', ');
      const query = `UPDATE tasks SET ${setClause} WHERE id = $${keys.length + 1} RETURNING *`;
      const res = await pool.query(query, [...values, this.id]);
      Object.assign(this, mapTask(res.rows[0]));
      return this;
    } else {
      const placeholders = keys.map((_, idx) => `$${idx + 1}`).join(', ');
      const query = `INSERT INTO tasks (${keys.map(k => `"${k}"`).join(', ')}) VALUES (${placeholders}) RETURNING *`;
      const res = await pool.query(query, values);
      Object.assign(this, mapTask(res.rows[0]));
      return this;
    }
  }
}

function mapTask(row) {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    taskId: row.task_id,
    title: row.title,
    associatedLead: row.associated_lead,
    description: row.description,
    originalDueDate: row.original_due_date,
    dueDate: row.due_date,
    priority: row.priority,
    status: row.status,
    category: row.category,
    userId: row.user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const Task = {
  find: function(query) {
    let queryBuilder = {
      then: async function(resolve, reject) {
        try {
          const res = await this.exec();
          resolve(res);
        } catch (e) {
          reject(e);
        }
      },
      exec: async function() {
        let conditions = [];
        let values = [];
        let pIndex = 1;
        if (query && query.user_id) {
          if (query.user_id.$in) {
            conditions.push(`user_id IN (${query.user_id.$in.map(() => `$${pIndex++}`).join(', ')})`);
            values.push(...query.user_id.$in);
          } else {
            conditions.push(`user_id = $${pIndex++}`);
            values.push(query.user_id);
          }
        }
        let where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
        let sql = `SELECT * FROM tasks ${where} ORDER BY id DESC`;
        const res = await pool.query(sql, values);
        return res.rows.map(mapTask).map(t => new TaskModelInstance(t));
      }
    };
    queryBuilder.then = queryBuilder.then.bind(queryBuilder);
    return queryBuilder;
  },
  findOne: async function(query) {
    let conditions = [];
    let values = [];
    let pIndex = 1;
    if (query && query.taskId) {
      conditions.push(`task_id = $${pIndex++}`);
      values.push(query.taskId);
    }
    if (query && query.id) {
      conditions.push(`id = $${pIndex++}`);
      values.push(Number(query.id));
    }
    let where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    const res = await pool.query(`SELECT * FROM tasks ${where} LIMIT 1`, values);
    if (res.rowCount === 0) return null;
    return new TaskModelInstance(mapTask(res.rows[0]));
  },
  create: async function(data) {
    const inst = new TaskModelInstance(data);
    return await inst.save();
  }
};

// Options Model query helpers
const OptionsModel = {
  findOne: async function() {
    const res = await pool.query('SELECT * FROM options LIMIT 1');
    if (res.rowCount === 0) return null;
    return new OptionsModelInstance(res.rows[0].data);
  },
  deleteMany: async function() {
    await pool.query('DELETE FROM options');
  },
  create: async function(optionsData) {
    const res = await pool.query('INSERT INTO options (data) VALUES ($1) RETURNING *', [optionsData]);
    return new OptionsModelInstance(res.rows[0].data);
  }
};

// Startup table creation & user seeding
async function initializeDB() {
  const baseUri = connectionString.replace(/\/([^/]+)$/, '/postgres');
  const dbName = connectionString.match(/\/([^/]+)$/)?.[1] || 'crm';
  
  console.log(`Checking if database '${dbName}' exists...`);
  const setupPool = new Pool({ connectionString: baseUri });
  try {
    const res = await setupPool.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [dbName]);
    if (res.rowCount === 0) {
      console.log(`Database '${dbName}' does not exist. Creating...`);
      await setupPool.query(`CREATE DATABASE "${dbName}"`);
      console.log(`Database '${dbName}' created.`);
    } else {
      console.log(`Database '${dbName}' already exists.`);
    }
  } catch (err) {
    console.error("Failed to verify/create database (ignoring and trying direct connection):", err.message);
  } finally {
    await setupPool.end();
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        designation VARCHAR(100) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        mobile VARCHAR(20) NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL,
        supervisor_id INT REFERENCES users(id) ON DELETE SET NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS leads (
        id SERIAL PRIMARY KEY,
        lead_number SERIAL UNIQUE,
        created_by INT REFERENCES users(id) ON DELETE RESTRICT,
        company_info JSONB DEFAULT '{}'::jsonb,
        contact_info JSONB DEFAULT '{}'::jsonb,
        it_landscape JSONB DEFAULT '{}'::jsonb,
        descriptions JSONB DEFAULT '[]'::jsonb,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS options (
        id SERIAL PRIMARY KEY,
        data JSONB DEFAULT '{}'::jsonb
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_groups (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        created_by INT REFERENCES users(id) ON DELETE CASCADE,
        members JSONB DEFAULT '[]'::jsonb,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        sender_id INT REFERENCES users(id) ON DELETE CASCADE,
        recipient_id INT REFERENCES users(id) ON DELETE SET NULL,
        group_id INT REFERENCES chat_groups(id) ON DELETE CASCADE,
        is_global BOOLEAN DEFAULT FALSE,
        content TEXT NOT NULL,
        read_by JSONB DEFAULT '[]'::jsonb,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        task_id VARCHAR(50) UNIQUE NOT NULL,
        title TEXT NOT NULL,
        associated_lead VARCHAR(255),
        description TEXT,
        original_due_date VARCHAR(20),
        due_date VARCHAR(20),
        priority VARCHAR(20),
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        category VARCHAR(50),
        user_id INT REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log("PostgreSQL schema initialized successfully.");

    const usersCount = await pool.query('SELECT COUNT(*) FROM users');
    if (parseInt(usersCount.rows[0].count, 10) === 0) {
      console.log("Seeding default users...");
      const usersData = JSON.parse(fs.readFileSync(path.join(__dirname, "../Users.json"), "utf-8"));
      const emailToId = {};
      
      for (const u of usersData) {
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(u.password, salt);
        const nameParts = u.name.split(' ');
        const firstName = nameParts[0];
        const lastName = nameParts.slice(1).join(' ') || 'User';
        const designation = u.designation || (u.role === 'admin' ? 'Super Admin' : (u.role === 'supervisor' ? 'Supervisor' : 'Subuser'));
        const mobile = '1234567890';
        
        const insertRes = await pool.query(`
          INSERT INTO users (first_name, last_name, designation, email, mobile, password, role, status)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING id
        `, [firstName, lastName, designation, u.email, mobile, hashedPassword, u.role, 'active']);
        
        emailToId[u.email] = insertRes.rows[0].id;
      }

      for (const u of usersData) {
        if (u.supervisorEmail) {
          const supervisorId = emailToId[u.supervisorEmail];
          if (supervisorId) {
            const subId = emailToId[u.email];
            await pool.query('UPDATE users SET supervisor_id = $1 WHERE id = $2', [supervisorId, subId]);
          }
        }
      }
      console.log("User seeding complete.");
    }

    // Ensure Super Admin admin@sagetl.com exists with requested password Admin@1234
    const adminCheck = await pool.query('SELECT * FROM users WHERE email = $1', ['admin@sagetl.com']);
    const salt = await bcrypt.genSalt(10);
    const hashedAdminPassword = await bcrypt.hash('Admin@1234', salt);
    if (adminCheck.rowCount === 0) {
      await pool.query(`
        INSERT INTO users (first_name, last_name, designation, email, mobile, password, role, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, ['Admin', 'Super Admin', 'Super Admin', 'admin@sagetl.com', '9999999999', hashedAdminPassword, 'admin', 'active']);
      console.log("Super Admin user 'admin@sagetl.com' created successfully.");
    } else {
      await pool.query(`
        UPDATE users SET password = $1, role = 'admin', status = 'active' WHERE email = $2
      `, [hashedAdminPassword, 'admin@sagetl.com']);
      console.log("Super Admin user 'admin@sagetl.com' password & role updated successfully.");
    }

    const defaultOptions = {
      leadTypeOptions: ["Hot", "Warm", "Cold"],
      verticalOptions: [
        "Auto / Auto Ancillary",
        "Textile / Spinning / Garments / Footwear / Leather",
        "Real Estate / Construction",
        "EPC",
        "Pharma / Equip. (Surgical) / Healthcare / Device Manufacturing",
        "Chemicals / Process / Fertilizers",
        "BFSI",
        "Solar / Renewable / Power",
        "Mobiles / Electronics",
        "PSU's / QUASSI",
        "E-commerce",
        "FMCG",
        "Dairy",
        "Sugar / Ethanol / Distillery",
        "Manufacturing / Discrete",
        "Diversified / Conglomerate",
        "Education",
        "Logistics",
        "Retail / Hypermart / Trading",
        "Others"
      ],
      leadStatusOptions: [
        "Cold (9+ months)",
        "Warm (3–9 months)",
        "Hot (0–3 months)",
        "Duplicate",
        "Junk",
        "WON",
        "LOST"
      ],
      priorityOptions: ["High", "Medium", "Low"],
      leadSourceOptions: ["Reference", "Self Generated", "Existing Database"],
      stateOptions: ["Maharashtra", "Delhi", "Karnataka"],
      countryOptions: ["India", "USA", "UK"],
      leadUsableOptions: ["Yes", "No"],
      nextActionOptions: [
        "Call Back",
        "Online Meeting",
        "On-Site Meeting",
        "Proposal Submitted",
        "Negotiation",
        "Follow-Up"
      ],
      employeeCountOptions: ["1-10", "11-50", "51-200", "201+"],
      reasonOptions: ["Interested", "Not interested"],
      turnOverOptions: ["<10Cr", "10-50Cr", "50-100Cr", "100Cr+"],
      usingERPOptions: ["Yes", "No"],
      ERPTypeOptions: ["Microsoft", "Oracle", "Infor", "Epicor", "SAP B1", "SAP BYD", "Tally", "Industry Specific", "Other ERP"],
      opportunityForUs3Options: [
        "IMPL / RE-IMPL",
        "AMS",
        "Hardware Migration (H/W) / Version Upgrade",
        "Rollouts",
        "Resourcing",
        "System Audit / DPR",
        "SAP Licences",
        "Basis / DMS",
        "Custom Developments",
        "Others"
      ],
      noWhyOptions: ["No budget", "Not needed"],
      opportunityOptions: ["High", "Low"],
      timeframeOptions: ["Immediate", "1-3 months", "3-6 months"],
      currentDatabaseOptions: ["Oracle", "SQL Server", "MySQL", "PostgreSQL"],
      expiryOptions: ["2026", "2027", "2028"],
      versionOptions: ["v1", "v2"],
      partnerOptions: ["Partner A", "Partner B"],
      conversationLevelOptions: ["C-level", "Manager-level"]
    };

    const optionsCount = await pool.query('SELECT COUNT(*) FROM options');
    if (parseInt(optionsCount.rows[0].count, 10) === 0) {
      console.log("Seeding default option values...");
      await pool.query('INSERT INTO options (data) VALUES ($1)', [defaultOptions]);
      console.log("Option values seeded.");
    } else {
      console.log("Updating option values to ensure vertical options are fresh...");
      await pool.query('UPDATE options SET data = $1', [defaultOptions]);
      console.log("Option values updated.");
    }
  } catch (err) {
    console.error("Database initialization error:", err);
  }
}

initializeDB();

function UserConstructor(data) {
  return new UserModelInstance(data);
}
Object.assign(UserConstructor, User);

function LeadConstructor(data) {
  return new LeadModelInstance(data);
}
Object.assign(LeadConstructor, Lead);

function TaskConstructor(data) {
  return new TaskModelInstance(data);
}
Object.assign(TaskConstructor, Task);

module.exports = {
  connect: async () => {},
  connection: {
    close: async () => {}
  },
  Types: {
    ObjectId: function(id) {
      return id;
    }
  },
  isValidObjectId: function(id) {
    return typeof id === 'number' || (typeof id === 'string' && id.length > 0 && !isNaN(Number(id)));
  },
  User: UserConstructor,
  Lead: LeadConstructor,
  Task: TaskConstructor,
  OptionsModel,
  pool,
  query: (text, params) => pool.query(text, params)
};