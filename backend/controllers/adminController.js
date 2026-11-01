const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { httpError, asyncHandler } = require('../middleware/errorMiddleware');
const { STATUSES, changeStatus, escalateOverdueComplaints } = require('../services/complaintService');
const { rankTechnicians, assignTechnician, autoAssign } = require('../services/assignmentService');
const { createAlert } = require('../services/alertService');
const { predictFaults, hotspots } = require('../services/predictionService');
const { GMAIL_RE, PHONE_RE, GMAIL_MESSAGE } = require('../utils/validators');

// Runs fn(connection) inside a transaction
async function withTx(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

const NO_ACTIVE_ASSIGNMENT = `NOT EXISTS (SELECT 1 FROM technician_assignments t
   WHERE t.complaint_id = c.complaint_id AND t.assignment_status IN ('assigned','accepted','in_progress'))`;

const stats = asyncHandler(async (req, res) => {
  const [[totals]] = await pool.query(
    `SELECT COUNT(*) AS total,
            SUM(current_status IN ('submitted','verified')) AS pending,
            SUM(current_status IN ('assigned','in_progress','reopened')) AS in_progress,
            SUM(current_status = 'escalated') AS escalated,
            SUM(current_status IN ('repaired','closed')) AS resolved,
            SUM(current_status NOT IN ('closed','rejected','repaired') AND due_by < NOW()) AS overdue,
            SUM(is_emergency = 1 AND current_status NOT IN ('closed','rejected','repaired')) AS emergencies
       FROM complaints`
  );
  const [[unassigned]] = await pool.query(
    `SELECT COUNT(*) AS unassigned FROM complaints c
      WHERE c.current_status NOT IN ('closed','rejected','repaired') AND ${NO_ACTIVE_ASSIGNMENT}`
  );
  const [[users]] = await pool.query(
    `SELECT SUM(role='citizen') AS citizens, SUM(role='technician') AS technicians FROM users`
  );
  const [[al]] = await pool.query(
    'SELECT COUNT(*) AS active_alerts FROM outage_alerts WHERE is_active = 1 AND (ends_at IS NULL OR ends_at >= NOW())'
  );
  res.json({ ...totals, ...unassigned, ...users, ...al });
});

const listComplaints = asyncHandler(async (req, res) => {
  const where = [];
  const params = [];
  if (req.query.status) { where.push('c.current_status = ?'); params.push(req.query.status); }
  if (req.query.priority) { where.push('c.priority = ?'); params.push(req.query.priority); }
  if (req.query.emergency === '1') where.push('c.is_emergency = 1');
  if (req.query.unassigned === '1') {
    where.push("c.current_status NOT IN ('closed','rejected','repaired')");
    where.push(NO_ACTIVE_ASSIGNMENT);
  }
  if (req.query.search) {
    where.push('(c.complaint_number LIKE ? OR c.title LIKE ? OR c.location_address LIKE ? OR c.area LIKE ?)');
    const s = `%${req.query.search}%`;
    params.push(s, s, s, s);
  }
  const [rows] = await pool.query(
    `SELECT c.complaint_id, c.complaint_number, c.title, c.location_address, c.area, c.priority, c.current_status,
            c.is_emergency, c.auto_assigned, c.estimated_restoration, c.eta_source,
            c.reported_at, c.due_by, (c.due_by < NOW() AND c.current_status NOT IN ('closed','rejected','repaired')) AS is_overdue,
            ft.name AS fault_type, u.full_name AS citizen_name, u.phone AS citizen_phone,
            (SELECT t.full_name FROM technician_assignments a JOIN users t ON t.user_id = a.technician_id
              WHERE a.complaint_id = c.complaint_id AND a.assignment_status NOT IN ('reassigned','declined')
              ORDER BY a.assigned_at DESC, a.assignment_id DESC LIMIT 1) AS technician_name
       FROM complaints c
       JOIN fault_types ft ON ft.fault_type_id = c.fault_type_id
       JOIN users u ON u.user_id = c.citizen_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY (c.current_status IN ('closed','rejected')), c.is_emergency DESC,
               FIELD(c.priority,'critical','high','medium','low'), c.reported_at DESC
      LIMIT 500`,
    params
  );
  res.json(rows);
});

const updateStatus = asyncHandler(async (req, res) => {
  const { status, remarks } = req.body;
  if (!STATUSES.includes(status)) throw httpError(400, 'Invalid status');
  await withTx((conn) => changeStatus(conn, req.params.id, status, req.user.id, remarks));
  res.json({ message: 'Status updated' });
});

const technicians = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT u.user_id, u.full_name, u.phone, u.area, u.latitude, u.longitude, u.is_available, u.is_active,
            (SELECT COUNT(*) FROM technician_assignments a
              WHERE a.technician_id = u.user_id AND a.assignment_status IN ('assigned','accepted','in_progress')) AS active_jobs,
            (SELECT ROUND(AVG(cc.technician_rating), 2) FROM citizen_confirmations cc
              WHERE cc.technician_id = u.user_id AND cc.technician_rating IS NOT NULL) AS avg_rating,
            (SELECT GROUP_CONCAT(s.fault_type_id) FROM technician_skills s WHERE s.technician_id = u.user_id) AS skills
       FROM users u WHERE u.role = 'technician' AND u.is_active = 1 ORDER BY u.full_name`
  );
  res.json(rows.map((r) => ({ ...r, skills: r.skills ? String(r.skills).split(',').map(Number) : [] })));
});

// Ranked list of technicians for one complaint, with the reasons behind each score
const suggestions = asyncHandler(async (req, res) => {
  const list = await withTx((conn) => rankTechnicians(conn, req.params.id));
  res.json(list);
});

const assign = asyncHandler(async (req, res) => {
  const { technician_id, scheduled_visit, remarks } = req.body;
  if (!technician_id) throw httpError(400, 'Select a technician');
  const tech = await withTx(async (conn) => {
    const [comp] = await conn.query('SELECT current_status FROM complaints WHERE complaint_id = ?', [req.params.id]);
    if (!comp.length) throw httpError(404, 'Complaint not found');
    if (['closed', 'rejected'].includes(comp[0].current_status)) {
      throw httpError(400, 'Closed or rejected complaints cannot be assigned');
    }
    return assignTechnician(conn, req.params.id, technician_id, req.user.id, { scheduled_visit, remarks });
  });
  res.json({ message: `Assigned to ${tech.full_name}` });
});

const autoAssignOne = asyncHandler(async (req, res) => {
  const r = await withTx((conn) => autoAssign(conn, req.params.id, req.user.id));
  if (!r.assigned) throw httpError(409, r.reason);
  res.json({ message: `Auto-assigned to ${r.technician.name}`, technician: r.technician });
});

// Assigns every open complaint that has no technician yet (emergencies first)
const autoAssignAll = asyncHandler(async (req, res) => {
  const [open] = await pool.query(
    `SELECT c.complaint_id FROM complaints c
      WHERE c.current_status NOT IN ('closed','rejected','repaired') AND ${NO_ACTIVE_ASSIGNMENT}
      ORDER BY c.is_emergency DESC, FIELD(c.priority,'critical','high','medium','low'), c.reported_at`
  );
  let assigned = 0;
  for (const c of open) {
    const r = await withTx((conn) => autoAssign(conn, c.complaint_id, req.user.id));
    if (r.assigned) assigned += 1;
  }
  res.json({
    message: `Auto-assigned ${assigned} of ${open.length} complaint(s)`,
    assigned, waiting: open.length - assigned
  });
});

const listUsers = asyncHandler(async (req, res) => {
  const params = [];
  let where = '';
  if (req.query.role) { where = 'WHERE u.role = ?'; params.push(req.query.role); }
  const [rows] = await pool.query(
    `SELECT u.user_id, u.full_name, u.email, u.phone, u.role, u.area, u.latitude, u.longitude, u.is_available,
            u.is_active, u.created_at, d.name AS department,
            (SELECT GROUP_CONCAT(s.fault_type_id) FROM technician_skills s WHERE s.technician_id = u.user_id) AS skills,
            (SELECT ROUND(AVG(cc.technician_rating), 2) FROM citizen_confirmations cc
              WHERE cc.technician_id = u.user_id AND cc.technician_rating IS NOT NULL) AS avg_rating
       FROM users u LEFT JOIN departments d ON d.department_id = u.department_id
       ${where} ORDER BY u.created_at DESC`,
    params
  );
  res.json(rows.map((r) => ({ ...r, skills: r.skills ? String(r.skills).split(',').map(Number) : [] })));
});

async function saveSkills(conn, technicianId, ids) {
  await conn.query('DELETE FROM technician_skills WHERE technician_id = ?', [technicianId]);
  const clean = Array.from(new Set((ids || []).map(Number).filter((n) => n > 0)));
  for (const id of clean) {
    await conn.query('INSERT IGNORE INTO technician_skills (technician_id, fault_type_id) VALUES (?, ?)', [technicianId, id]);
  }
}

// Admin creates technician or admin accounts (Gmail address required)
const createUser = asyncHandler(async (req, res) => {
  const { full_name, email, phone, password, role, area, latitude, longitude, fault_type_ids } = req.body;
  if (!full_name || !email || !phone || !password) throw httpError(400, 'All fields are required');
  if (!['technician', 'admin'].includes(role)) throw httpError(400, 'Role must be technician or admin');
  if (!GMAIL_RE.test(String(email).trim())) throw httpError(400, GMAIL_MESSAGE);
  if (!PHONE_RE.test(String(phone))) throw httpError(400, 'Enter a valid phone number');
  if (password.length < 6) throw httpError(400, 'Password must be at least 6 characters');

  const [depts] = await pool.query('SELECT department_id FROM departments ORDER BY department_id LIMIT 1');
  const hash = await bcrypt.hash(password, 10);
  const id = await withTx(async (conn) => {
    const [result] = await conn.query(
      `INSERT INTO users (department_id, full_name, email, phone, password_hash, role, area, latitude, longitude)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [depts.length ? depts[0].department_id : null, full_name.trim(), email.trim().toLowerCase(), phone.trim(), hash, role,
        (area || '').trim() || null, latitude || null, longitude || null]
    );
    if (role === 'technician' && Array.isArray(fault_type_ids)) await saveSkills(conn, result.insertId, fault_type_ids);
    return result.insertId;
  });
  res.status(201).json({ message: `${role} account created`, user_id: id });
});

// Technician profile as the department sees it: base location, availability and skills
const updateTechnician = asyncHandler(async (req, res) => {
  const { area, latitude, longitude, is_available, fault_type_ids } = req.body;
  await withTx(async (conn) => {
    const [u] = await conn.query("SELECT user_id FROM users WHERE user_id = ? AND role = 'technician'", [req.params.id]);
    if (!u.length) throw httpError(404, 'Technician not found');
    await conn.query(
      'UPDATE users SET area = ?, latitude = ?, longitude = ?, is_available = ? WHERE user_id = ?',
      [(area || '').trim() || null, latitude || null, longitude || null, is_available === false || is_available === 0 ? 0 : 1, req.params.id]
    );
    if (Array.isArray(fault_type_ids)) await saveSkills(conn, req.params.id, fault_type_ids);
  });
  res.json({ message: 'Technician updated' });
});

const setUserActive = asyncHandler(async (req, res) => {
  if (Number(req.params.id) === req.user.id) throw httpError(400, 'You cannot deactivate your own account');
  const active = req.body.is_active ? 1 : 0;
  const [r] = await pool.query('UPDATE users SET is_active = ? WHERE user_id = ?', [active, req.params.id]);
  if (!r.affectedRows) throw httpError(404, 'User not found');
  res.json({ message: active ? 'User activated' : 'User deactivated' });
});

const runEscalation = asyncHandler(async (req, res) => {
  const count = await escalateOverdueComplaints(req.user.id);
  res.json({ message: `${count} overdue complaint(s) escalated`, escalated: count });
});

const listEscalations = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT e.escalation_id, e.escalation_level, e.reason, e.escalation_status, e.escalated_at, e.resolved_at,
            c.complaint_number, c.title, c.priority
       FROM escalations e JOIN complaints c ON c.complaint_id = e.complaint_id
      ORDER BY e.escalated_at DESC LIMIT 200`
  );
  res.json(rows);
});

const resolveEscalation = asyncHandler(async (req, res) => {
  const [r] = await pool.query(
    `UPDATE escalations SET escalation_status = 'resolved', resolved_at = NOW(), resolution_note = ?
      WHERE escalation_id = ?`,
    [req.body.note || null, req.params.id]
  );
  if (!r.affectedRows) throw httpError(404, 'Escalation not found');
  res.json({ message: 'Escalation marked as resolved' });
});

/* ----- Hotspots, prediction ----- */
const hotspotData = asyncHandler(async (req, res) => {
  res.json(await hotspots(pool, { days: Number(req.query.days) || 90, faultTypeId: req.query.fault_type_id || null }));
});

const predictions = asyncHandler(async (req, res) => {
  res.json(await predictFaults(pool));
});

/* ----- Nearby outage alerts ----- */
function toSqlDate(v) {
  if (!v) return null;
  const s = String(v).replace('T', ' ');
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(s)) throw httpError(400, 'Enter a valid date and time');
  return s.length === 16 ? s + ':00' : s;
}

const listAlerts = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT a.alert_id, a.alert_type, a.title, a.message, a.area, a.radius_km, a.starts_at, a.ends_at, a.is_active, a.is_auto,
            (a.is_active = 1 AND a.starts_at <= NOW() AND (a.ends_at IS NULL OR a.ends_at >= NOW())) AS is_running,
            (a.is_active = 1 AND a.starts_at > NOW()) AS is_upcoming
       FROM outage_alerts a ORDER BY a.created_at DESC, a.alert_id DESC LIMIT 100`
  );
  res.json(rows);
});

const newAlert = asyncHandler(async (req, res) => {
  const { alert_type, title, message, area, latitude, longitude, radius_km, starts_at, ends_at } = req.body;
  if (!['fault', 'maintenance'].includes(alert_type)) throw httpError(400, 'Choose major fault or scheduled maintenance');
  if (!title || !message) throw httpError(400, 'Title and message are required');
  if (!String(area || '').trim() && !(latitude && longitude)) throw httpError(400, 'Enter the affected area');
  const start = toSqlDate(starts_at);
  const end = toSqlDate(ends_at);
  if (start && end && end <= start) throw httpError(400, 'The end time must be after the start time');

  const out = await withTx((conn) => createAlert(conn, {
    alert_type, title: String(title).trim().slice(0, 150), message: String(message).trim().slice(0, 500),
    area: String(area || '').trim() || null, latitude, longitude, radius_km,
    starts_at: start, ends_at: end, created_by: req.user.id
  }));
  res.status(201).json({ message: `Alert sent to ${out.notified} citizen(s)`, ...out });
});

const cancelAlert = asyncHandler(async (req, res) => {
  const [r] = await pool.query('UPDATE outage_alerts SET is_active = 0 WHERE alert_id = ?', [req.params.id]);
  if (!r.affectedRows) throw httpError(404, 'Alert not found');
  res.json({ message: 'Alert cancelled' });
});

const reports = asyncHandler(async (req, res) => {
  const [byStatus] = await pool.query(
    'SELECT current_status AS label, COUNT(*) AS count FROM complaints GROUP BY current_status ORDER BY count DESC'
  );
  const [byFaultType] = await pool.query(
    `SELECT ft.name AS label, COUNT(*) AS count
       FROM complaints c JOIN fault_types ft ON ft.fault_type_id = c.fault_type_id
      GROUP BY ft.name ORDER BY count DESC`
  );
  const [byPriority] = await pool.query(
    'SELECT priority AS label, COUNT(*) AS count FROM complaints GROUP BY priority'
  );
  const [byArea] = await pool.query(
    `SELECT COALESCE(NULLIF(TRIM(area), ''), 'Unknown') AS label, COUNT(*) AS count
       FROM complaints GROUP BY label ORDER BY count DESC LIMIT 8`
  );
  const [[summary]] = await pool.query(
    `SELECT ROUND(AVG(TIMESTAMPDIFF(MINUTE, reported_at, resolved_at)) / 60, 1) AS avg_resolution_hours,
            (SELECT ROUND(AVG(rating), 2) FROM citizen_confirmations WHERE rating IS NOT NULL) AS avg_rating,
            (SELECT ROUND(AVG(technician_rating), 2) FROM citizen_confirmations WHERE technician_rating IS NOT NULL) AS avg_technician_rating,
            (SELECT COUNT(*) FROM escalations) AS total_escalations,
            (SELECT COUNT(*) FROM complaints WHERE is_emergency = 1) AS total_emergencies,
            (SELECT COUNT(*) FROM complaints WHERE auto_assigned = 1) AS auto_assigned
       FROM complaints WHERE resolved_at IS NOT NULL`
  );
  const [technicianPerformance] = await pool.query(
    `SELECT u.full_name AS label,
            COUNT(DISTINCT CASE WHEN a.assignment_status = 'completed' THEN a.assignment_id END) AS completed,
            COUNT(DISTINCT CASE WHEN a.assignment_status IN ('assigned','accepted','in_progress') THEN a.assignment_id END) AS active,
            (SELECT ROUND(AVG(cc.technician_rating), 2) FROM citizen_confirmations cc
              WHERE cc.technician_id = u.user_id AND cc.technician_rating IS NOT NULL) AS avg_rating,
            (SELECT COUNT(*) FROM citizen_confirmations cc
              WHERE cc.technician_id = u.user_id AND cc.technician_rating IS NOT NULL) AS rating_count
       FROM users u LEFT JOIN technician_assignments a ON a.technician_id = u.user_id
      WHERE u.role = 'technician' GROUP BY u.user_id, u.full_name ORDER BY completed DESC`
  );
  res.json({ byStatus, byFaultType, byPriority, byArea, summary, technicianPerformance });
});

module.exports = {
  stats, listComplaints, updateStatus, technicians, suggestions, assign, autoAssignOne, autoAssignAll,
  listUsers, createUser, updateTechnician, setUserActive, runEscalation, listEscalations, resolveEscalation,
  hotspotData, predictions, listAlerts, newAlert, cancelAlert, reports
};
