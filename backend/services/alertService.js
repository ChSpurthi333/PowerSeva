/*
 * Nearby power outage alerts.
 * An alert reaches a citizen when the citizen's area has the same name as the alert's area,
 * or the citizen's saved home location is inside the alert's radius.
 */
const pool = require('../config/db');
const { notify } = require('./notificationService');

const FORMAT = '%Y-%m-%d %H:%i:%s';

// SQL: is this citizen (alias u) near the alert (4 values: area, lat, lng, radius)?
const CITIZEN_NEAR_SQL = `(LOWER(u.area) = LOWER(?) OR (u.latitude IS NOT NULL AND ? IS NOT NULL AND
  6371 * ACOS(LEAST(1, COS(RADIANS(?)) * COS(RADIANS(u.latitude)) * COS(RADIANS(u.longitude) - RADIANS(?)) +
  SIN(RADIANS(?)) * SIN(RADIANS(u.latitude)))) <= ?))`;

async function nowPlusHours(conn, hours) {
  const [[r]] = await conn.query(`SELECT DATE_FORMAT(DATE_ADD(NOW(), INTERVAL ? MINUTE), '${FORMAT}') AS t`, [Math.round(hours * 60)]);
  return r.t;
}

// Creates the alert and puts a notification in front of every citizen nearby
async function createAlert(conn, a) {
  const startsAt = a.starts_at || (await nowPlusHours(conn, 0));
  const endsAt = a.ends_at || (a.duration_hours ? await nowPlusHours(conn, a.duration_hours) : null);
  const radius = Number(a.radius_km) > 0 ? Number(a.radius_km) : 3;

  const [r] = await conn.query(
    `INSERT INTO outage_alerts
       (alert_type, title, message, area, latitude, longitude, radius_km, starts_at, ends_at, is_auto, complaint_id, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [a.alert_type, a.title, a.message, a.area || null, a.latitude || null, a.longitude || null, radius,
      startsAt, endsAt, a.is_auto ? 1 : 0, a.complaint_id || null, a.created_by || null]
  );

  const [citizens] = await conn.query(
    `SELECT u.user_id FROM users u WHERE u.role = 'citizen' AND u.is_active = 1 AND ${CITIZEN_NEAR_SQL}`,
    [a.area || null, a.latitude || null, a.latitude || null, a.longitude || null, a.latitude || null, radius]
  );
  for (const c of citizens) await notify(conn, c.user_id, null, a.title, a.message);

  return { alert_id: r.insertId, notified: citizens.length };
}

// Called when a new emergency complaint arrives: warn the neighbourhood (once every 6 hours per area)
async function autoAlertForEmergency(conn, c) {
  if (!c.area && !(c.latitude && c.longitude)) return null;
  if (c.area) {
    const [dup] = await conn.query(
      `SELECT alert_id FROM outage_alerts
        WHERE is_auto = 1 AND is_active = 1 AND LOWER(area) = LOWER(?) AND created_at >= DATE_SUB(NOW(), INTERVAL 6 HOUR) LIMIT 1`,
      [c.area]
    );
    if (dup.length) return null;
  }
  const where = c.area || 'your area';
  return createAlert(conn, {
    alert_type: 'fault',
    title: `Emergency repair near ${where}`,
    message: `A dangerous electrical fault was reported near ${where}. A crew has been alerted. Stay away from fallen poles and hanging wires, and keep children indoors.`,
    area: c.area, latitude: c.latitude, longitude: c.longitude, radius_km: 2,
    duration_hours: 4, is_auto: true, complaint_id: c.complaint_id, created_by: null
  });
}

// Alerts that are running or coming up for one citizen (or any user who has a saved area/location)
async function alertsForUser(userId) {
  const [[u]] = await pool.query('SELECT area, latitude, longitude FROM users WHERE user_id = ?', [userId]);
  if (!u) return [];
  const [rows] = await pool.query(
    `SELECT a.alert_id, a.alert_type, a.title, a.message, a.area, a.radius_km, a.starts_at, a.ends_at, a.is_auto,
            (a.starts_at > NOW()) AS is_upcoming
       FROM outage_alerts a
      WHERE a.is_active = 1 AND (a.ends_at IS NULL OR a.ends_at >= NOW())
        AND (LOWER(a.area) = LOWER(?) OR (a.latitude IS NOT NULL AND ? IS NOT NULL AND
             6371 * ACOS(LEAST(1, COS(RADIANS(?)) * COS(RADIANS(a.latitude)) * COS(RADIANS(a.longitude) - RADIANS(?)) +
             SIN(RADIANS(?)) * SIN(RADIANS(a.latitude)))) <= a.radius_km))
      ORDER BY is_upcoming, a.starts_at DESC`,
    [u.area || null, u.latitude, u.latitude, u.longitude, u.latitude]
  );
  return rows;
}

module.exports = { createAlert, autoAlertForEmergency, alertsForUser };
