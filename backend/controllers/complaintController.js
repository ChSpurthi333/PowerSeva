const pool = require('../config/db');
const { httpError, asyncHandler } = require('../middleware/errorMiddleware');
const generateComplaintId = require('../utils/generateComplaintId');
const { changeStatus } = require('../services/complaintService');
const { findNearby } = require('../services/duplicateService');
const { notify, notifyAdmins } = require('../services/notificationService');
const { PHONE_RE } = require('../utils/validators');
const { assess } = require('../services/priorityService');
const { refreshEta } = require('../services/etaService');
const { autoAssign } = require('../services/assignmentService');
const { autoAlertForEmergency, alertsForUser } = require('../services/alertService');
const { buildReceipt } = require('../services/receiptService');

const FAULT_TYPE_FIELDS = 'fault_type_id, name, description, default_priority, expected_resolution_hrs, is_hazardous';

const faultTypes = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(`SELECT ${FAULT_TYPE_FIELDS} FROM fault_types WHERE is_active = 1 ORDER BY name`);
  res.json(rows);
});

// Village / area names already used (suggestions while typing)
const areas = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT area FROM (
        SELECT area FROM complaints WHERE area IS NOT NULL AND area <> ''
        UNION SELECT area FROM users WHERE area IS NOT NULL AND area <> ''
     ) t ORDER BY area LIMIT 300`
  );
  res.json(rows.map((r) => r.area));
});

// Live check while the citizen types: is this an emergency?
const assessComplaint = asyncHandler(async (req, res) => {
  const { fault_type_id, title, description } = req.body;
  if (!fault_type_id) throw httpError(400, 'Select a fault type');
  const [types] = await pool.query(`SELECT ${FAULT_TYPE_FIELDS} FROM fault_types WHERE fault_type_id = ? AND is_active = 1`, [fault_type_id]);
  if (!types.length) throw httpError(400, 'Invalid fault type');
  res.json(assess(types[0], `${title || ''} ${description || ''}`));
});

// Citizen submits a new fault report (multipart: fields + up to 5 images named "images")
const create = asyncHandler(async (req, res) => {
  const { fault_type_id, title, description, location_address, landmark, latitude, longitude, phone, area } = req.body;
  if (!fault_type_id || !title || !description || !location_address) {
    throw httpError(400, 'Fault type, title, description and location are required');
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Citizens who signed up with Google have no phone yet: save it so technicians can call
    if (phone) {
      if (!PHONE_RE.test(phone)) throw httpError(400, 'Enter a valid phone number');
      await conn.query("UPDATE users SET phone = ? WHERE user_id = ? AND (phone IS NULL OR phone = '')",
        [phone.trim(), req.user.id]);
    }

    const [types] = await conn.query(`SELECT ${FAULT_TYPE_FIELDS} FROM fault_types WHERE fault_type_id = ? AND is_active = 1`, [fault_type_id]);
    if (!types.length) throw httpError(400, 'Invalid fault type');

    // Emergency priority system: read the words and the fault type
    const a = assess(types[0], `${title} ${description}`);

    const [depts] = await conn.query('SELECT department_id FROM departments ORDER BY department_id LIMIT 1');
    const departmentId = depts.length ? depts[0].department_id : null;

    const [[me]] = await conn.query('SELECT area FROM users WHERE user_id = ?', [req.user.id]);
    const cleanArea = (String(area || '').trim() || (me && me.area) || '').slice(0, 100) || null;
    const lat = latitude ? Number(latitude) : null;
    const lng = longitude ? Number(longitude) : null;
    if ((lat !== null && Number.isNaN(lat)) || (lng !== null && Number.isNaN(lng))) throw httpError(400, 'Invalid map position');

    const tempNumber = `TMP-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const [result] = await conn.query(
      `INSERT INTO complaints
        (complaint_number, citizen_id, fault_type_id, department_id, title, description,
         location_address, landmark, area, latitude, longitude, priority, is_emergency, priority_reason, due_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))`,
      [tempNumber, req.user.id, fault_type_id, departmentId, title.trim(), description.trim(),
        location_address.trim(), landmark || null, cleanArea, lat, lng,
        a.priority, a.is_emergency ? 1 : 0, a.reason, Math.round(a.due_hours * 60)]
    );
    const complaintId = result.insertId;
    const complaintNumber = generateComplaintId(complaintId);
    await conn.query('UPDATE complaints SET complaint_number = ? WHERE complaint_id = ?', [complaintNumber, complaintId]);

    if (cleanArea) {
      await conn.query("UPDATE users SET area = ? WHERE user_id = ? AND (area IS NULL OR area = '')", [cleanArea, req.user.id]);
    }

    for (const f of req.files || []) {
      await conn.query(
        'INSERT INTO complaint_images (complaint_id, image_url) VALUES (?, ?)',
        [complaintId, `/uploads/${f.filename}`]
      );
    }

    await conn.query(
      `INSERT INTO status_history (complaint_id, old_status, new_status, changed_by, remarks)
       VALUES (?, NULL, 'submitted', ?, 'Complaint submitted by citizen')`,
      [complaintId, req.user.id]
    );
    await notify(conn, req.user.id, complaintId, `Complaint ${complaintNumber} received`,
      `We received your report "${title.trim()}". Track it with number ${complaintNumber}.`);

    if (a.is_emergency) {
      await notifyAdmins(conn, complaintId, 'EMERGENCY complaint',
        `Emergency complaint ${complaintNumber}: ${title.trim()}. ${a.reason}`);
      await autoAlertForEmergency(conn, { complaint_id: complaintId, area: cleanArea, latitude: lat, longitude: lng });
    } else {
      await notifyAdmins(conn, complaintId, 'New fault reported',
        `New ${a.priority} priority complaint ${complaintNumber}: ${title.trim()}`);
    }

    // Automatic technician assignment (turn off with AUTO_ASSIGN=false in .env)
    let assigned = null;
    if (process.env.AUTO_ASSIGN !== 'false') {
      const r = await autoAssign(conn, complaintId);
      if (r.assigned) assigned = r.technician;
    }
    await refreshEta(conn, complaintId);

    const [[row]] = await conn.query(
      'SELECT estimated_restoration, eta_source FROM complaints WHERE complaint_id = ?', [complaintId]);

    await conn.commit();
    res.status(201).json({
      message: 'Complaint submitted',
      complaint_id: complaintId,
      complaint_number: complaintNumber,
      priority: a.priority,
      is_emergency: a.is_emergency,
      priority_reason: a.reason,
      auto_assigned: !!assigned,
      technician_name: assigned ? assigned.name : null,
      estimated_restoration: row.estimated_restoration,
      eta_source: row.eta_source
    });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

const myComplaints = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT c.complaint_id, c.complaint_number, c.title, c.priority, c.current_status, c.is_emergency, c.area,
            c.reported_at, c.due_by, c.resolved_at, c.estimated_restoration, c.eta_source, c.support_count,
            ft.name AS fault_type, (c.citizen_id <> ?) AS is_supporter
       FROM complaints c JOIN fault_types ft ON ft.fault_type_id = c.fault_type_id
      WHERE c.citizen_id = ?
         OR EXISTS (SELECT 1 FROM complaint_supporters s WHERE s.complaint_id = c.complaint_id AND s.citizen_id = ?)
      ORDER BY c.reported_at DESC`,
    [req.user.id, req.user.id, req.user.id]
  );
  res.json(rows);
});

// Everything about one complaint (used by the tracking page and the PDF receipt)
async function loadComplaint(number) {
  const [rows] = await pool.query(
    `SELECT c.*, ft.name AS fault_type, u.full_name AS citizen_name, u.phone AS citizen_phone,
            d.name AS department_name
       FROM complaints c
       JOIN fault_types ft ON ft.fault_type_id = c.fault_type_id
       JOIN users u ON u.user_id = c.citizen_id
       LEFT JOIN departments d ON d.department_id = c.department_id
      WHERE c.complaint_number = ?`,
    [number]
  );
  if (!rows.length) throw httpError(404, 'Complaint not found');
  const complaint = rows[0];
  const id = complaint.complaint_id;

  const [images] = await pool.query('SELECT image_id, image_url, uploaded_at FROM complaint_images WHERE complaint_id = ?', [id]);
  const [history] = await pool.query(
    `SELECT h.old_status, h.new_status, h.remarks, h.changed_at, u.full_name AS changed_by
       FROM status_history h LEFT JOIN users u ON u.user_id = h.changed_by
      WHERE h.complaint_id = ? ORDER BY h.changed_at, h.history_id`,
    [id]
  );
  const [assignments] = await pool.query(
    `SELECT a.assignment_id, a.assignment_status, a.assigned_at, a.scheduled_visit, a.completed_at,
            t.full_name AS technician_name, t.phone AS technician_phone
       FROM technician_assignments a JOIN users t ON t.user_id = a.technician_id
      WHERE a.complaint_id = ? ORDER BY a.assigned_at DESC, a.assignment_id DESC`,
    [id]
  );
  const [evidence] = await pool.query(
    'SELECT image_url, work_description, materials_used, repair_completed_at FROM repair_evidence WHERE complaint_id = ? ORDER BY uploaded_at DESC',
    [id]
  );
  const [updates] = await pool.query(
    `SELECT w.message, w.eta_minutes, w.created_at, t.full_name AS technician_name
       FROM work_updates w JOIN users t ON t.user_id = w.technician_id
      WHERE w.complaint_id = ? ORDER BY w.created_at, w.update_id`,
    [id]
  );
  const [confirmation] = await pool.query(
    'SELECT is_resolved, rating, technician_rating, feedback, confirmed_at FROM citizen_confirmations WHERE complaint_id = ?',
    [id]
  );
  return { complaint, images, history, assignments, evidence, updates, confirmation: confirmation[0] || null };
}

// Citizens may see their own complaints and the ones they joined ("same problem")
async function checkAccess(req, complaint) {
  if (req.user.role !== 'citizen' || complaint.citizen_id === req.user.id) return;
  const [rows] = await pool.query(
    'SELECT 1 FROM complaint_supporters WHERE complaint_id = ? AND citizen_id = ?',
    [complaint.complaint_id, req.user.id]
  );
  if (!rows.length) throw httpError(403, 'You can only track your own complaints');
}

// Full tracking details by complaint number
const track = asyncHandler(async (req, res) => {
  const data = await loadComplaint(req.params.number);
  await checkAccess(req, data.complaint);
  res.json(data);
});

// PDF receipt: complaint ID, location, reported date, description and resolution details
const receipt = asyncHandler(async (req, res) => {
  const data = await loadComplaint(req.params.number);
  await checkAccess(req, data.complaint);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="PowerSeva-Receipt-${data.complaint.complaint_number}.pdf"`);
  buildReceipt(res, data);
});

// Citizen confirms (or disputes) the repair and rates the service and the technician
const confirm = asyncHandler(async (req, res) => {
  const { is_resolved, rating, technician_rating, feedback } = req.body;
  if (typeof is_resolved === 'undefined') throw httpError(400, 'Please say whether the fault was fixed');
  for (const r of [rating, technician_rating]) {
    if (r && (Number(r) < 1 || Number(r) > 5)) throw httpError(400, 'Rating must be between 1 and 5');
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      'SELECT citizen_id, current_status, complaint_number FROM complaints WHERE complaint_id = ? FOR UPDATE',
      [req.params.id]
    );
    if (!rows.length) throw httpError(404, 'Complaint not found');
    if (rows[0].citizen_id !== req.user.id) throw httpError(403, 'Not your complaint');
    if (rows[0].current_status !== 'repaired') {
      throw httpError(400, 'Only complaints marked as repaired can be confirmed');
    }

    const [[tech]] = await conn.query(
      `SELECT technician_id FROM technician_assignments
        WHERE complaint_id = ? AND assignment_status = 'completed'
        ORDER BY completed_at DESC, assignment_id DESC LIMIT 1`,
      [req.params.id]
    );

    const resolved = is_resolved === true || is_resolved === 'true' || is_resolved === 1 || is_resolved === '1';
    await conn.query(
      `INSERT INTO citizen_confirmations (complaint_id, citizen_id, is_resolved, rating, technician_id, technician_rating, feedback)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.params.id, req.user.id, resolved ? 1 : 0, rating || null, tech ? tech.technician_id : null,
        technician_rating || null, feedback || null]
    );
    await changeStatus(conn, req.params.id, resolved ? 'closed' : 'reopened', req.user.id,
      resolved ? 'Citizen confirmed the repair' : 'Citizen reported the fault is not fixed');
    if (!resolved) {
      // allow a fresh confirmation after the next repair
      await conn.query('DELETE FROM citizen_confirmations WHERE complaint_id = ?', [req.params.id]);
      await conn.query(
        'UPDATE complaints SET due_by = DATE_ADD(NOW(), INTERVAL 24 HOUR) WHERE complaint_id = ?',
        [req.params.id]
      );
      await notifyAdmins(conn, Number(req.params.id), 'Complaint reopened',
        `Citizen reported that complaint ${rows[0].complaint_number} is not fixed.`);
    } else if (tech && technician_rating) {
      await notify(conn, tech.technician_id, Number(req.params.id), 'New rating received',
        `A citizen rated your work on complaint ${rows[0].complaint_number}: ${technician_rating} out of 5.`);
    }
    await conn.commit();
    res.json({ message: resolved ? 'Thank you! Complaint closed.' : 'Complaint reopened for further action.' });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

// Outage and maintenance alerts near the logged-in user
const alerts = asyncHandler(async (req, res) => {
  res.json(await alertsForUser(req.user.id));
});

const notifications = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT n.notification_id, n.title, n.message, n.is_read, n.created_at, c.complaint_number
       FROM notifications n LEFT JOIN complaints c ON c.complaint_id = n.complaint_id
      WHERE n.user_id = ? ORDER BY n.created_at DESC, n.notification_id DESC LIMIT 50`,
    [req.user.id]
  );
  res.json(rows);
});

const markNotificationsRead = asyncHandler(async (req, res) => {
  await pool.query('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [req.user.id]);
  res.json({ message: 'Notifications marked as read' });
});

// Duplicate check: open complaints of the same fault type reported nearby (never shows other people's details)
const duplicates = asyncHandler(async (req, res) => {
  res.json(await findNearby(pool, { ...req.body, userId: req.user.id }));
});

// "I have the same problem": the citizen joins an existing complaint instead of filing a new one
const support = asyncHandler(async (req, res) => {
  const note = String(req.body.note || '').trim().slice(0, 255) || null;
  const THRESHOLD = Number(process.env.DUP_BUMP_AT) || 3;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      'SELECT citizen_id, current_status, complaint_number, priority FROM complaints WHERE complaint_id = ? FOR UPDATE',
      [req.params.id]
    );
    if (!rows.length) throw httpError(404, 'Complaint not found');
    const c = rows[0];
    if (c.citizen_id === req.user.id) throw httpError(400, 'This is your own complaint');
    if (['closed', 'rejected', 'repaired'].includes(c.current_status)) throw httpError(400, 'This complaint is already resolved. Please submit a new complaint.');

    const [ins] = await conn.query('INSERT IGNORE INTO complaint_supporters (complaint_id, citizen_id, note) VALUES (?, ?, ?)',
      [req.params.id, req.user.id, note]);
    if (!ins.affectedRows) throw httpError(409, 'You have already joined this complaint');

    await conn.query('UPDATE complaints SET support_count = support_count + 1 WHERE complaint_id = ?', [req.params.id]);
    const [[{ support_count: n }]] = await conn.query('SELECT support_count FROM complaints WHERE complaint_id = ?', [req.params.id]);

    // Many citizens reporting the same fault means more people without power: raise a low / medium priority once
    if (n === THRESHOLD && ['low', 'medium'].includes(c.priority)) {
      await conn.query(
        `UPDATE complaints SET priority = IF(priority = 'low', 'medium', 'high'), priority_reason = ?,
                due_by = LEAST(COALESCE(due_by, DATE_ADD(NOW(), INTERVAL 24 HOUR)), DATE_ADD(NOW(), INTERVAL 12 HOUR))
          WHERE complaint_id = ?`,
        [`Reported by ${n + 1} citizens nearby`, req.params.id]);
      await notifyAdmins(conn, Number(req.params.id), 'Complaint priority raised',
        `${n + 1} citizens reported the same fault (${c.complaint_number}), so its priority was raised.`);
    }
    await notify(conn, c.citizen_id, Number(req.params.id), 'More people reported the same fault',
      `Another citizen reported the same fault as your complaint ${c.complaint_number}. ${n + 1} people are now affected.`);
    await notify(conn, req.user.id, Number(req.params.id), `You joined complaint ${c.complaint_number}`,
      `We will send you every update on complaint ${c.complaint_number}. Track it with this number.`);
    await conn.commit();
    res.status(201).json({ message: 'Thank you! You will get updates on the existing complaint.', complaint_number: c.complaint_number });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

module.exports = {
  faultTypes, areas, assessComplaint, create, myComplaints, track, receipt, confirm, alerts,
  notifications, markNotificationsRead, duplicates, support
};
