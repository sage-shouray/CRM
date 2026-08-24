require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { ROLE_LABELS, ROLES } = require('../Middleware/roles');

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/crm';
const pool = new Pool({ connectionString });

// Build a parameter placeholder list ($1, $2, ...) for a values array,
// so IN (...) clauses are always parameterized instead of string-interpolated.
function inPlaceholders(arr, startIndex = 1) {
  return arr.map((_, i) => `$${startIndex + i}`).join(', ');
}

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
    // A parallel jsonb-typed (not text-cast) path for dotted keys, needed by
    // $arrayContains: containment only works against actual jsonb, and
    // ->>'key' text-extraction would compare against the string "[1,2]".
    let jsonbCol = null;
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
      let jsonbPath = mappedCol;
      for (let i = 1; i < parts.length; i++) {
        const isLast = i === parts.length - 1;
        jsonbPath += `->'${parts[i]}'`;
        if (isLast) {
          jsonPath += `->>'${parts[i]}'`;
        } else {
          jsonPath += `->'${parts[i]}'`;
        }
      }
      col = jsonPath;
      jsonbCol = jsonbPath;
    } else if (col === 'supervisor') {
      // The only column whose name is not just the snake_case of the field.
      col = 'supervisor_id';
    } else {
      // Every other column is the snake_case form of the model field
      // (leadNumber -> lead_number, createdBy -> created_by, ...). Doing this
      // generically means a field is never passed through as-is and silently
      // sent to Postgres as an unquoted identifier it will fold to lowercase
      // and fail to resolve.
      col = col.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
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
      } else if (value.$arrayContains !== undefined) {
        // Matches whether the stored value is a bare scalar (legacy leads
        // assigned to one person) or a JSON array (multi-BDM assignment):
        // jsonb @> treats a scalar right-hand side as "does this array
        // contain it, or equal it" either way.
        const ids = Array.isArray(value.$arrayContains)
          ? value.$arrayContains
          : [value.$arrayContains];
        if (ids.length === 0) {
          conditions.push('1 = 0');
        } else {
          const parts = ids.map((id) => {
            const idx = paramIndex++;
            values.push(Number(id));
            return `COALESCE(${jsonbCol || col}, 'null'::jsonb) @> to_jsonb($${idx}::int)`;
          });
          conditions.push('(' + parts.join(' OR ') + ')');
        }
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

// A user as it may be embedded in another record via .populate(). Populated
// relations are serialised straight into API responses, so the password hash
// must never travel with them.
function mapPublicUser(row) {
  const user = mapUser(row);
  if (!user) return null;
  delete user.password;
  return user;
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

// Which JSONB column each nested lead field lives in.
const LEAD_JSON_COLUMNS = {
  companyInfo: 'company_info',
  contactInfo: 'contact_info',
  itLandscape: 'it_landscape',
  descriptions: 'descriptions',
};

// Turn an update object into SQL SET fragments plus their bound values.
//
// Handles both whole-column updates ({ companyInfo: {...} }) and the dotted
// paths callers naturally write for a single nested field
// ({ "companyInfo.leadAssignedTo": 7 }). The dotted form used to be dropped
// silently: mapLeadToDb did not recognise the key, the UPDATE was skipped, and
// the caller was handed back an unchanged record as if the write had worked.
function buildLeadUpdate(update) {
  const sets = [];
  const values = [];

  for (const [column, value] of Object.entries(mapLeadToDb(update || {}))) {
    values.push(value);
    sets.push(`"${column}" = $${values.length}`);
  }

  for (const [key, value] of Object.entries(update || {})) {
    if (!key.includes('.')) continue;
    const [root, ...rest] = key.split('.');
    const column = LEAD_JSON_COLUMNS[root];
    // Path segments are interpolated into SQL, so accept only plain
    // identifiers — these come from server code, never from a request body.
    if (!column || rest.length === 0) continue;
    if (!rest.every((part) => /^[A-Za-z0-9_]+$/.test(part))) continue;

    values.push(JSON.stringify(value === undefined ? null : value));
    sets.push(
      `"${column}" = jsonb_set(COALESCE("${column}", '{}'::jsonb), ` +
      `'{${rest.join(',')}}', $${values.length}::jsonb, true)`
    );
  }

  return { sets, values };
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
      const query = `UPDATE leads SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = $${keys.length + 1} RETURNING *`;
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
        const uRes = await pool.query(`SELECT * FROM users WHERE id IN (${inPlaceholders(userIds)})`, userIds);
        const uMap = {};
        uRes.rows.map(mapPublicUser).forEach(u => {
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
          // Exclude the password hash unless a caller explicitly asks for it.
          // An inclusion projection like { firstName: 1, role: 1 } previously
          // fell through this check and shipped the hash to the browser.
          const wantsPassword =
            projection && (projection.password === 1 || projection.password === true);
          if (!wantsPassword) {
            delete inst.password;
          }
          return inst;
        });
        
        for (const pop of this._populates) {
          if (pop.path === 'supervisor') {
            const supervisorIds = [...new Set(items.map(u => u.supervisor).filter(Boolean))];
            if (supervisorIds.length > 0) {
              const supRes = await pool.query(`SELECT * FROM users WHERE id IN (${inPlaceholders(supervisorIds)})`, supervisorIds);
              const supMap = {};
              supRes.rows.map(mapPublicUser).forEach(s => {
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
              const uRes = await pool.query(`SELECT * FROM users WHERE id IN (${inPlaceholders(userIds)})`, userIds);
              const uMap = {};
              uRes.rows.map(mapPublicUser).forEach(u => {
                uMap[u.id] = u;
              });
              items.forEach(l => {
                if (l.createdBy) {
                  l.createdBy = uMap[l.createdBy] || null;
                }
              });
            }
          } else if (pop.path === 'companyInfo.leadAssignedTo') {
            // A lead may be assigned to one BDM (legacy: a bare id) or several
            // (an array of ids). Either shape is normalised to an id list here
            // and written back in the same shape it was read in.
            const asIdList = (v) => (Array.isArray(v) ? v : v !== null && v !== undefined ? [v] : []);
            const userIds = [...new Set(
              items.flatMap(l => asIdList(l.companyInfo.leadAssignedTo)).filter(id => id && !isNaN(id))
            )];
            if (userIds.length > 0) {
              const uRes = await pool.query(`SELECT * FROM users WHERE id IN (${inPlaceholders(userIds)})`, userIds);
              const uMap = {};
              uRes.rows.map(mapPublicUser).forEach(u => {
                uMap[u.id] = u;
              });
              items.forEach(l => {
                const raw = l.companyInfo.leadAssignedTo;
                if (Array.isArray(raw)) {
                  l.companyInfo.leadAssignedTo = raw.map(id => uMap[id]).filter(Boolean);
                } else if (raw && uMap[raw]) {
                  l.companyInfo.leadAssignedTo = uMap[raw];
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
              const uRes = await pool.query(`SELECT * FROM users WHERE id IN (${inPlaceholders(uniqueUserIds)})`, uniqueUserIds);
              const uMap = {};
              uRes.rows.map(mapPublicUser).forEach(u => {
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
            if (uRes.rowCount > 0) item.createdBy = mapPublicUser(uRes.rows[0]);
          } else if (pop.path === 'descriptions.addedBy' && item.descriptions) {
            const userIds = [...new Set(item.descriptions.map(d => d.addedBy).filter(Boolean))];
            if (userIds.length > 0) {
              const uRes = await pool.query(`SELECT * FROM users WHERE id IN (${inPlaceholders(userIds)})`, userIds);
              const uMap = {};
              uRes.rows.map(mapPublicUser).forEach(u => {
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
    const { sets, values } = buildLeadUpdate(update);
    // No recognised field: return the record untouched rather than issuing an
    // UPDATE with an empty SET.
    if (sets.length === 0) return this.findById(id);
    values.push(id);
    const sql =
      `UPDATE leads SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP ` +
      `WHERE id = $${values.length} RETURNING *`;
    const res = await pool.query(sql, values);
    if (res.rowCount === 0) return null;
    return new LeadModelInstance(mapLead(res.rows[0]));
  },

  // Bulk equivalent of findByIdAndUpdate. Callers reached for this expecting
  // Mongoose's updateMany; without it the call threw a TypeError that the
  // route's catch reported as a generic 500.
  updateMany: async function(filter, update) {
    const ids = (filter?._id?.$in || filter?.id?.$in || [])
      .map(Number)
      .filter((n) => Number.isFinite(n));
    if (ids.length === 0) return { matchedCount: 0, modifiedCount: 0 };

    const { sets, values } = buildLeadUpdate(update);
    if (sets.length === 0) return { matchedCount: 0, modifiedCount: 0 };

    values.push(ids);
    const sql =
      `UPDATE leads SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP ` +
      `WHERE id = ANY($${values.length}::int[])`;
    const res = await pool.query(sql, values);
    return { matchedCount: res.rowCount, modifiedCount: res.rowCount };
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
      user_id: this.userId ? Number(this.userId) : null,
      assigned_by: this.assignedBy ? Number(this.assignedBy) : null
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
    assignedBy: row.assigned_by ?? null,
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

// Resolve a password for first-run seeding.
//
// Seed credentials must never be committed. The value comes from the named
// environment variable; when that is unset a random one is generated and
// printed once so a fresh install still works without shipping a known
// password in the repository.
function resolveSeedPassword(envVar) {
  const fromEnv = process.env[envVar];
  if (fromEnv && fromEnv.trim()) {
    return { password: fromEnv.trim(), generated: false };
  }
  // 18 bytes -> 24 base64url chars.
  const password = crypto.randomBytes(18).toString('base64url');
  return { password, generated: true };
}

// Every user id at or below `userId` in the reporting tree: the user, the
// people whose supervisor is them, the people below those, and so on.
//
// This is what scopes an Admin to its own BDMs and their Business Leads, and a
// BDM to its own Business Leads. UNION (not UNION ALL) so a mis-configured
// cycle in supervisor_id terminates instead of spinning forever.
async function getDescendantUserIds(userId) {
  const id = Number(userId);
  if (!id || Number.isNaN(id)) return [];
  const res = await pool.query(
    `WITH RECURSIVE subtree AS (
       SELECT id FROM users WHERE id = $1
       UNION
       SELECT u.id FROM users u JOIN subtree s ON u.supervisor_id = s.id
     )
     SELECT id FROM subtree`,
    [id]
  );
  return res.rows.map((r) => r.id);
}

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

    // Personal scratchpad notes, one row per note, private to their author.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notes (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_notes_user_id ON notes(user_id);`);

    // Presence samples: one row per heartbeat from an open tab. "active" means
    // the browser saw real mouse/keyboard input recently, which is what
    // separates someone working from a tab left open on an empty desk.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_activity (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        state VARCHAR(10) NOT NULL DEFAULT 'active',
        page VARCHAR(160)
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_activity_user_at ON user_activity(user_id, at DESC);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_activity_at ON user_activity(at DESC);`);

    // The daily worklog every non-Admin fills in: what they actually did that
    // day, in their own words.
    //
    // work_date is a DATE and carries a UNIQUE constraint per user, so the
    // "one entry per person per day, today only" rule is enforced by the
    // database and not merely by the route that happens to write it.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS daily_worklog (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        work_date DATE NOT NULL,
        body TEXT NOT NULL,
        hours NUMERIC(4,1),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT daily_worklog_one_per_day UNIQUE (user_id, work_date)
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_daily_worklog_date ON daily_worklog(work_date DESC);`);

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

    // Generated report files. The PDF itself is stored as bytes so a report
    // survives a redeploy without needing a shared filesystem or bucket.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS reports (
        id SERIAL PRIMARY KEY,
        file_name VARCHAR(255) NOT NULL,
        report_type VARCHAR(60),
        mime_type VARCHAR(100) NOT NULL DEFAULT 'application/pdf',
        size_bytes INT,
        content BYTEA,
        generated_by INT REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Applied-migration ledger, so one-shot data changes stay one-shot.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        key VARCHAR(100) PRIMARY KEY,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Three-tier roles (admin / supervisor / subuser) -> four-tier
    // (superadmin / admin / bdm / businesslead).
    //
    // This MUST run exactly once. The old top tier was called "admin", and
    // that name still exists as the new second tier, so re-running it would
    // promote every Admin to Super Admin. The ledger check is the guard.
    const rolesMigrated = await pool.query(
      'SELECT 1 FROM schema_migrations WHERE key = $1',
      ['roles_v2_four_tier']
    );
    if (rolesMigrated.rowCount === 0) {
      // Order matters: retire the old "admin" meaning before anything else.
      const promoted = await pool.query(
        `UPDATE users SET role = 'superadmin' WHERE role = 'admin'`
      );
      const bdms = await pool.query(
        `UPDATE users SET role = 'bdm' WHERE role = 'supervisor'`
      );
      const leads = await pool.query(
        `UPDATE users SET role = 'businesslead' WHERE role = 'subuser'`
      );
      await pool.query(
        'INSERT INTO schema_migrations (key) VALUES ($1)',
        ['roles_v2_four_tier']
      );
      console.log(
        `Role migration applied: ${promoted.rowCount} -> superadmin, ` +
        `${bdms.rowCount} -> bdm, ${leads.rowCount} -> businesslead.`
      );
    }

    // Four tiers -> three (admin / manager / executive).
    //
    // Super Admin is folded into Admin: the product has one top tier that sees
    // everything. "bdm" and "businesslead" are renamed to the words the
    // business actually uses. Runs once, guarded by the ledger.
    const rolesV3 = await pool.query(
      'SELECT 1 FROM schema_migrations WHERE key = $1',
      ['roles_v3_three_tier']
    );
    if (rolesV3.rowCount === 0) {
      // The CHECK constraint from the previous migration only allows the old
      // names, so it has to come off before the values change.
      await pool.query(
        `ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_valid`
      );
      const admins = await pool.query(
        `UPDATE users SET role = 'admin' WHERE role = 'superadmin'`
      );
      const managers = await pool.query(
        `UPDATE users SET role = 'manager' WHERE role = 'bdm'`
      );
      const executives = await pool.query(
        `UPDATE users SET role = 'executive' WHERE role = 'businesslead'`
      );
      await pool.query(
        'INSERT INTO schema_migrations (key) VALUES ($1)',
        ['roles_v3_three_tier']
      );
      console.log(
        `Role migration v3 applied: ${admins.rowCount} superadmin -> admin, ` +
        `${managers.rowCount} -> manager, ${executives.rowCount} -> executive.`
      );
    }

    // Which Executives a Manager may see beyond its own direct reports. The
    // reporting tree stays the default; this table is the Admin's override.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS manager_access (
        id SERIAL PRIMARY KEY,
        manager_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        executive_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        granted_by INT REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (manager_id, executive_id)
      );
    `);
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_manager_access_manager ON manager_access(manager_id);`
    );

    // Reject unknown roles at the database level. Kept in its own try/catch so
    // an unexpected legacy value cannot abort the rest of startup.
    try {
      await pool.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'users_role_valid'
          ) THEN
            ALTER TABLE users ADD CONSTRAINT users_role_valid
              CHECK (role IN ('admin', 'manager', 'executive'));
          END IF;
        END $$;
      `);
    } catch (constraintErr) {
      console.error(
        "Could not add users_role_valid constraint (unexpected role values?):",
        constraintErr.message
      );
    }

    // Lead numbers must be 5 digits. lead_number is a SERIAL, so uniqueness is
    // already the sequence's job — all this does is push the sequence past
    // 10000 and pin its floor there, so every number handed out from now on is
    // 10000..99999. Existing rows keep the numbers they were given (tasks
    // reference leads by number as free text, so renumbering would orphan them).
    await pool.query(`
      DO $$
      DECLARE
        seq TEXT := pg_get_serial_sequence('leads', 'lead_number');
        max_used BIGINT;
      BEGIN
        IF seq IS NULL THEN
          RETURN;
        END IF;
        SELECT COALESCE(MAX(lead_number), 0) INTO max_used FROM leads;
        -- Move the current value into range before raising the floor, so the
        -- sequence is never left sitting below its own MINVALUE.
        IF max_used < 10000 THEN
          PERFORM setval(seq, 10000, false);
        ELSE
          PERFORM setval(seq, max_used, true);
        END IF;
        -- START must move too: Postgres rejects a MINVALUE above the sequence's
        -- START value, which is still 1 from the original SERIAL.
        EXECUTE format(
          'ALTER SEQUENCE %s MINVALUE 10000 MAXVALUE 99999 START 10000 NO CYCLE',
          seq
        );
      END $$;
    `);

    // Indexes on hot query paths (idempotent).
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_supervisor_id ON users(supervisor_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_leads_created_by ON leads(created_by);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_leads_assigned_to ON leads((company_info->>'leadAssignedTo'));`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);`);

    // Who handed the task out, when it was assigned rather than self-created.
    // Idempotent so it is safe on every boot.
    await pool.query(`
      ALTER TABLE tasks
        ADD COLUMN IF NOT EXISTS assigned_by INT REFERENCES users(id) ON DELETE SET NULL;
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_messages_recipient_id ON messages(recipient_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_messages_group_id ON messages(group_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages(sender_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_reports_generated_by ON reports(generated_by);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports(created_at DESC);`);

    console.log("PostgreSQL schema initialized successfully.");

    const usersCount = await pool.query('SELECT COUNT(*) FROM users');
    if (parseInt(usersCount.rows[0].count, 10) === 0) {
      console.log("Seeding default users...");
      const usersData = JSON.parse(fs.readFileSync(path.join(__dirname, "../Users.json"), "utf-8"));
      const emailToId = {};

      // Users.json carries no passwords — it is committed, so anything in it is
      // public. Every seeded account gets the SEED_DEFAULT_PASSWORD, or its own
      // random password printed once below.
      const seeded = [];

      for (const u of usersData) {
        const { password, generated } = resolveSeedPassword('SEED_DEFAULT_PASSWORD');
        seeded.push({ email: u.email, password, generated });
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const nameParts = u.name.split(' ');
        const firstName = nameParts[0];
        const lastName = nameParts.slice(1).join(' ') || 'User';
        const designation = u.designation || ROLE_LABELS[u.role] || 'Business Lead';
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
      // Printed once, at first run only. Distribute these out of band and have
      // each person change their password on first sign-in.
      const generatedOnes = seeded.filter((s) => s.generated);
      if (generatedOnes.length > 0) {
        console.log("One-time generated passwords (shown once — store securely):");
        generatedOnes.forEach((s) => console.log(`  ${s.email.padEnd(26)} ${s.password}`));
        console.log("Set SEED_DEFAULT_PASSWORD to seed with a known password instead.");
      }
      console.log("User seeding complete.");
    }

    // Ensure the Super Admin account exists.
    //
    // This used to reset the password to a hardcoded value on EVERY startup,
    // which meant the account could never actually be rotated — any change was
    // reverted by the next restart. An existing user's password is now left
    // strictly alone; only a missing account is created.
    const superAdminEmail = process.env.SUPER_ADMIN_EMAIL || 'admin@sagetl.com';
    const adminCheck = await pool.query('SELECT id FROM users WHERE email = $1', [superAdminEmail]);
    if (adminCheck.rowCount === 0) {
      const { password, generated } = resolveSeedPassword('SUPER_ADMIN_PASSWORD');
      const salt = await bcrypt.genSalt(10);
      const hashedAdminPassword = await bcrypt.hash(password, salt);
      await pool.query(`
        INSERT INTO users (first_name, last_name, designation, email, mobile, password, role, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, ['Admin', 'Super Admin', 'Super Admin', superAdminEmail, '9999999999', hashedAdminPassword, ROLES.ADMIN, 'active']);
      console.log(`Super Admin '${superAdminEmail}' created.`);
      if (generated) {
        console.log(
          `  One-time generated password: ${password}\n` +
          `  Sign in and change it now. Set SUPER_ADMIN_PASSWORD to choose your own.`
        );
      }
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
      // Explicit funnel stages, so a lead's position is stored rather than
      // guessed from whatever its next action happens to be.
      pipelineStageOptions: [
        "Prospecting",
        "Qualification",
        "Proposal",
        "Negotiation",
        "Closed-Won",
      ],
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
      noWhyOptions: [
        "No budget",
        "Not needed",
        "Using other ERP",
        "Low turnover",
        "Decision from global"
      ],
      opportunityOptions: ["Low", "Medium", "High"],
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
  getDescendantUserIds,
  pool,
  query: (text, params) => pool.query(text, params)
};