const { haversineKm } = require('../utils/geo');

const RADIUS_KM = Number(process.env.DUP_RADIUS_KM) || 0.3;     // "same place" = within 300 m
const WINDOW_HOURS = Number(process.env.DUP_WINDOW_HOURS) || 72; // only recent complaints count
const OPEN = "('submitted','verified','assigned','in_progress','escalated','reopened')";

// Open complaints of the same fault type reported close by (by map position, or by village / area when
// no position was given). Other citizens' names and phone numbers are never returned.
async function findNearby(db, { fault_type_id, latitude, longitude, area, userId }) {
  const lat = latitude === '' || latitude === null || latitude === undefined ? null : Number(latitude);
  const lng = longitude === '' || longitude === null || longitude === undefined ? null : Number(longitude);
  const hasPos = lat !== null && lng !== null && !Number.isNaN(lat) && !Number.isNaN(lng);
  const cleanArea = String(area || '').trim().toLowerCase();
  if (!fault_type_id || (!hasPos && !cleanArea)) return [];

  const where = [`c.fault_type_id = ?`, `c.current_status IN ${OPEN}`, `c.reported_at > DATE_SUB(NOW(), INTERVAL ? HOUR)`];
  const params = [fault_type_id, WINDOW_HOURS];
  if (hasPos) {
    const d = RADIUS_KM / 111 * 1.5; // rough bounding box in degrees, exact distance is checked below
    where.push('c.latitude BETWEEN ? AND ?', 'c.longitude BETWEEN ? AND ?');
    params.push(lat - d, lat + d, lng - d * 2, lng + d * 2);
  } else {
    where.push('LOWER(TRIM(c.area)) = ?');
    params.push(cleanArea);
  }
  const [rows] = await db.query(
    `SELECT c.complaint_id, c.complaint_number, c.title, c.current_status, c.reported_at, c.support_count,
            c.latitude, c.longitude, c.area, c.citizen_id,
            EXISTS (SELECT 1 FROM complaint_supporters s WHERE s.complaint_id = c.complaint_id AND s.citizen_id = ?) AS already_supported
       FROM complaints c WHERE ${where.join(' AND ')} ORDER BY c.reported_at DESC LIMIT 25`,
    [userId, ...params]
  );

  return rows
    .map((r) => {
      const dist = hasPos ? haversineKm(lat, lng, r.latitude, r.longitude) : null;
      return {
        complaint_id: r.complaint_id,
        complaint_number: r.complaint_number,
        title: r.title,
        current_status: r.current_status,
        reported_at: r.reported_at,
        support_count: r.support_count,
        area: r.area,
        distance_m: dist === null ? null : Math.round(dist * 1000),
        is_own: r.citizen_id === userId,
        already_supported: !!r.already_supported
      };
    })
    .filter((r) => !hasPos || (r.distance_m !== null && r.distance_m <= RADIUS_KM * 1000))
    .sort((a, b) => (a.distance_m ?? 0) - (b.distance_m ?? 0))
    .slice(0, 3);
}

module.exports = { findNearby, RADIUS_KM };
