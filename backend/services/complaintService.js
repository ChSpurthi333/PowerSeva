const pool = require('../config/db');
const { httpError } = require('../middleware/errorMiddleware');
const { notify, notifyAdmins } = require('./notificationService');
const { refreshEta } = require('./etaService');

const STATUSES = [
  'submitted', 'verified', 'assigned', 'in_progress',
  'repaired', 'closed', 'rejected', 'escalated', 'reopened'
];

const STATUS_LABELS = {
  submitted: 'has been submitted',
  verified: 'has been verified by the department',
  assigned: 'has been assigned to a technician',
  in_progress: 'is being worked on',
  repaired: 'has been marked repaired - please confirm the repair',
  closed: 'has been closed',
  rejected: 'was rejected',
  escalated: 'has been escalated to a senior officer',
  reopened: 'has been reopened'
};

// Changes a complaint's status, writes status_history, refreshes the restoration estimate
// and notifies the citizen. Must be called with a connection that is inside a transaction.
async function changeStatus(conn, complaintId, newStatus, userId, remarks) {
  if (!STATUSES.includes(newStatus)) throw httpError(400, 'Invalid status');

  const [rows] = await conn.query(
    'SELECT current_status, citizen_id, complaint_number FROM complaints WHERE complaint_id = ? FOR UPDATE',
    [complaintId]
  );
  if (!rows.length) throw httpError(404, 'Complaint not found');

  const { current_status: oldStatus, citizen_id: citizenId, complaint_number: number } = rows[0];

  let extra = '';
  if (newStatus === 'repaired' || newStatus === 'closed') extra = ', resolved_at = COALESCE(resolved_at, NOW())';
  if (newStatus === 'reopened') extra = ', resolved_at = NULL';

  await conn.query(
    `UPDATE complaints SET current_status = ? ${extra} WHERE complaint_id = ?`,
    [newStatus, complaintId]
  );
  await conn.query(
    `INSERT INTO status_history (complaint_id, old_status, new_status, changed_by, remarks)
     VALUES (?, ?, ?, ?, ?)`,
    [complaintId, oldStatus, newStatus, userId || null, remarks || null]
  );
  await notify(conn, citizenId, complaintId,
    `Complaint ${number} update`,
    `Your complaint ${number} ${STATUS_LABELS[newStatus]}.`);
  // Citizens who joined this complaint ("I have the same problem") get the same updates
  const [supporters] = await conn.query('SELECT citizen_id FROM complaint_supporters WHERE complaint_id = ?', [complaintId]);
  for (const sp of supporters) {
    await notify(conn, sp.citizen_id, complaintId,
      `Complaint ${number} update`,
      `The complaint ${number} you joined ${STATUS_LABELS[newStatus]}.`);
  }
  await refreshEta(conn, complaintId);

  return { oldStatus, newStatus };
}

// Escalates every unresolved complaint that is past its due time and has no open escalation.
async function escalateOverdueComplaints(escalatedBy = null) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [overdue] = await conn.query(
      `SELECT c.complaint_id, c.complaint_number, c.current_status, c.priority
         FROM complaints c
        WHERE c.current_status NOT IN ('closed','rejected','repaired')
          AND c.due_by IS NOT NULL AND c.due_by < NOW()
          AND NOT EXISTS (SELECT 1 FROM escalations e
                           WHERE e.complaint_id = c.complaint_id
                             AND e.escalation_status <> 'resolved')`
    );

    const [admins] = await conn.query(
      "SELECT user_id FROM users WHERE role = 'admin' AND is_active = 1 ORDER BY user_id LIMIT 1"
    );
    const escalatedTo = admins.length ? admins[0].user_id : null;

    for (const c of overdue) {
      const [[{ lvl }]] = await conn.query(
        'SELECT COUNT(*) + 1 AS lvl FROM escalations WHERE complaint_id = ?',
        [c.complaint_id]
      );
      await conn.query(
        `INSERT INTO escalations (complaint_id, escalated_by, escalated_to, escalation_level, reason)
         VALUES (?, ?, ?, ?, ?)`,
        [c.complaint_id, escalatedBy, escalatedTo, lvl, 'Complaint not resolved within the expected time']
      );
      if (c.current_status !== 'escalated') {
        await changeStatus(conn, c.complaint_id, 'escalated', escalatedBy, 'Auto-escalated: resolution time exceeded');
      }
      await notifyAdmins(conn, c.complaint_id, 'Complaint escalated',
        `Complaint ${c.complaint_number} (${c.priority} priority) is overdue and has been escalated.`);
    }

    await conn.commit();
    return overdue.length;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { STATUSES, changeStatus, escalateOverdueComplaints };
