const pool = require('../config/db');

// Stores an in-app notification. Pass a transaction connection to keep it atomic.
async function notify(conn, userId, complaintId, title, message) {
  const db = conn || pool;
  await db.query(
    'INSERT INTO notifications (user_id, complaint_id, title, message) VALUES (?, ?, ?, ?)',
    [userId, complaintId || null, title, message]
  );
}

async function notifyAdmins(conn, complaintId, title, message) {
  const db = conn || pool;
  const [admins] = await db.query(
    "SELECT user_id FROM users WHERE role = 'admin' AND is_active = 1"
  );
  for (const a of admins) {
    await notify(conn, a.user_id, complaintId, title, message);
  }
}

module.exports = { notify, notifyAdmins };
