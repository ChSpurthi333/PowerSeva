const pool = require('../config/db');
const { httpError, asyncHandler } = require('../middleware/errorMiddleware');
const { changeStatus } = require('../services/complaintService');
const { refreshEta } = require('../services/etaService');
const { notify } = require('../services/notificationService');

const stats = asyncHandler(async (req, res) => {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS total,
            SUM(assignment_status = 'assigned') AS new_jobs,
            SUM(assignment_status IN ('accepted','in_progress')) AS in_progress,
            SUM(assignment_status = 'completed') AS completed
       FROM technician_assignments WHERE technician_id = ? AND assignment_status <> 'reassigned'`,
    [req.user.id]
  );
  const [[rating]] = await pool.query(
    `SELECT ROUND(AVG(technician_rating), 2) AS avg_rating, COUNT(technician_rating) AS rating_count
       FROM citizen_confirmations WHERE technician_id = ?`,
    [req.user.id]
  );
  const [[me]] = await pool.query('SELECT is_available, area FROM users WHERE user_id = ?', [req.user.id]);
  res.json({ ...row, ...rating, is_available: !!me.is_available, area: me.area });
});

const assignments = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT a.assignment_id, a.assignment_status, a.assigned_at, a.scheduled_visit, a.remarks,
            c.complaint_id, c.complaint_number, c.title, c.description, c.location_address, c.landmark, c.area,
            c.latitude, c.longitude, c.priority, c.current_status, c.due_by, c.is_emergency, c.priority_reason,
            c.estimated_restoration, c.eta_source,
            ft.name AS fault_type, u.full_name AS citizen_name, u.phone AS citizen_phone,
            (SELECT w.message FROM work_updates w WHERE w.complaint_id = c.complaint_id
              ORDER BY w.created_at DESC, w.update_id DESC LIMIT 1) AS last_update
       FROM technician_assignments a
       JOIN complaints c ON c.complaint_id = a.complaint_id
       JOIN fault_types ft ON ft.fault_type_id = c.fault_type_id
       JOIN users u ON u.user_id = c.citizen_id
      WHERE a.technician_id = ? AND a.assignment_status <> 'reassigned'
      ORDER BY a.assignment_status = 'completed', c.is_emergency DESC, FIELD(c.priority,'critical','high','medium','low'), a.assigned_at DESC`,
    [req.user.id]
  );
  res.json(rows);
});

async function ownAssignment(conn, assignmentId, technicianId) {
  const [rows] = await conn.query(
    'SELECT * FROM technician_assignments WHERE assignment_id = ? AND technician_id = ? FOR UPDATE',
    [assignmentId, technicianId]
  );
  if (!rows.length) throw httpError(404, 'Assignment not found');
  return rows[0];
}

// Technician accepts the job and starts work
const accept = asyncHandler(async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const a = await ownAssignment(conn, req.params.id, req.user.id);
    if (a.assignment_status !== 'assigned') throw httpError(400, 'This job has already been accepted or closed');

    await conn.query(
      "UPDATE technician_assignments SET assignment_status = 'in_progress', accepted_at = NOW() WHERE assignment_id = ?",
      [a.assignment_id]
    );
    await changeStatus(conn, a.complaint_id, 'in_progress', req.user.id, 'Technician started work');
    await conn.commit();
    res.json({ message: 'Job accepted - status set to in progress' });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

// Progress note for the citizen, with an optional "about N more minutes" estimate
const postUpdate = asyncHandler(async (req, res) => {
  const message = String(req.body.message || '').trim();
  if (message.length < 3) throw httpError(400, 'Write a short update for the citizen');
  let eta = null;
  if (req.body.eta_minutes !== undefined && req.body.eta_minutes !== null && req.body.eta_minutes !== '') {
    eta = Math.round(Number(req.body.eta_minutes));
    if (!(eta >= 5 && eta <= 2880)) throw httpError(400, 'Estimated time must be between 5 minutes and 48 hours');
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const a = await ownAssignment(conn, req.params.id, req.user.id);
    if (!['assigned', 'accepted', 'in_progress'].includes(a.assignment_status)) {
      throw httpError(400, 'This job is already completed or reassigned');
    }
    await conn.query(
      'INSERT INTO work_updates (complaint_id, technician_id, message, eta_minutes) VALUES (?, ?, ?, ?)',
      [a.complaint_id, req.user.id, message.slice(0, 500), eta]
    );
    const [[c]] = await conn.query('SELECT citizen_id, complaint_number FROM complaints WHERE complaint_id = ?', [a.complaint_id]);
    await notify(conn, c.citizen_id, a.complaint_id, `Work update on ${c.complaint_number}`,
      message.slice(0, 300) + (eta ? ` (about ${eta} more minutes)` : ''));
    await refreshEta(conn, a.complaint_id);
    await conn.commit();
    res.json({ message: 'Update sent to the citizen' });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

// Technician uploads repair photo + details; complaint moves to "repaired"
const submitRepair = asyncHandler(async (req, res) => {
  const { work_description, materials_used } = req.body;
  if (!work_description) throw httpError(400, 'Describe the work done');
  if (!req.files || !req.files.length) throw httpError(400, 'Upload at least one repair photo');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const a = await ownAssignment(conn, req.params.id, req.user.id);
    if (!['assigned', 'accepted', 'in_progress'].includes(a.assignment_status)) {
      throw httpError(400, 'This job is already completed or reassigned');
    }

    for (const f of req.files) {
      await conn.query(
        `INSERT INTO repair_evidence
           (assignment_id, complaint_id, image_url, work_description, materials_used, repair_completed_at, uploaded_by)
         VALUES (?, ?, ?, ?, ?, NOW(), ?)`,
        [a.assignment_id, a.complaint_id, `/uploads/${f.filename}`, work_description.trim(), materials_used || null, req.user.id]
      );
    }
    await conn.query(
      "UPDATE technician_assignments SET assignment_status = 'completed', completed_at = NOW() WHERE assignment_id = ?",
      [a.assignment_id]
    );
    await changeStatus(conn, a.complaint_id, 'repaired', req.user.id, work_description.trim());

    const [[c]] = await conn.query('SELECT citizen_id, complaint_number FROM complaints WHERE complaint_id = ?', [a.complaint_id]);
    await notify(conn, c.citizen_id, a.complaint_id, 'Please confirm the repair',
      `Complaint ${c.complaint_number} was repaired. Open it and confirm whether the fault is fixed.`);

    await conn.commit();
    res.json({ message: 'Repair submitted. Waiting for citizen confirmation.' });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

// Ratings and feedback citizens gave this technician
const feedback = asyncHandler(async (req, res) => {
  const [[sum]] = await pool.query(
    `SELECT ROUND(AVG(technician_rating), 2) AS avg_rating, COUNT(technician_rating) AS rating_count
       FROM citizen_confirmations WHERE technician_id = ?`,
    [req.user.id]
  );
  const [items] = await pool.query(
    `SELECT c.complaint_number, c.title, cc.technician_rating, cc.rating, cc.feedback, cc.confirmed_at
       FROM citizen_confirmations cc JOIN complaints c ON c.complaint_id = cc.complaint_id
      WHERE cc.technician_id = ? AND (cc.technician_rating IS NOT NULL OR cc.feedback IS NOT NULL)
      ORDER BY cc.confirmed_at DESC LIMIT 20`,
    [req.user.id]
  );
  res.json({ ...sum, items });
});

module.exports = { stats, assignments, accept, postUpdate, submitRepair, feedback };
