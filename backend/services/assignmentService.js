/*
 * Automatic technician assignment.
 *
 * Every technician gets a score from 0 to 100 for a complaint:
 *   expertise    trained for this fault type (skills table)
 *   distance     how close the technician's base is to the fault (straight-line km, 50 km = 0 points)
 *   workload     fewer active jobs is better (5 active jobs = fully loaded)
 *   availability on duty (technicians on leave are never chosen)
 * Emergencies give distance more weight (the nearest skilled crew should go) and ignore the workload cap.
 */
const { haversineKm } = require('../utils/geo');
const { changeStatus } = require('./complaintService');
const { notify } = require('./notificationService');

const MAX_ACTIVE_JOBS = 5;
const WEIGHTS = {
  normal: { expertise: 0.35, distance: 0.25, workload: 0.25, availability: 0.15 },
  emergency: { expertise: 0.30, distance: 0.40, workload: 0.15, availability: 0.15 }
};

async function rankTechnicians(conn, complaintId) {
  const [[c]] = await conn.query(
    'SELECT complaint_id, fault_type_id, latitude, longitude, area, is_emergency FROM complaints WHERE complaint_id = ?',
    [complaintId]
  );
  if (!c) return [];
  const w = Number(c.is_emergency) ? WEIGHTS.emergency : WEIGHTS.normal;

  const [techs] = await conn.query(
    `SELECT u.user_id, u.full_name, u.phone, u.area, u.latitude, u.longitude, u.is_available,
            (SELECT COUNT(*) FROM technician_assignments a
              WHERE a.technician_id = u.user_id AND a.assignment_status IN ('assigned','accepted','in_progress')) AS active_jobs,
            (SELECT COUNT(*) FROM technician_skills s WHERE s.technician_id = u.user_id) AS skill_count,
            (SELECT COUNT(*) FROM technician_skills s WHERE s.technician_id = u.user_id AND s.fault_type_id = ?) AS has_skill,
            (SELECT ROUND(AVG(cc.technician_rating), 2) FROM citizen_confirmations cc
              WHERE cc.technician_id = u.user_id AND cc.technician_rating IS NOT NULL) AS avg_rating
       FROM users u WHERE u.role = 'technician' AND u.is_active = 1`,
    [c.fault_type_id]
  );

  const ranked = techs.map((t) => {
    const active = Number(t.active_jobs);
    const skilled = Number(t.has_skill) > 0;
    const expertise = skilled ? 1 : (Number(t.skill_count) === 0 ? 0.5 : 0.2);

    let distanceKm = haversineKm(c.latitude, c.longitude, t.latitude, t.longitude);
    let distance;
    if (distanceKm !== null) distance = Math.max(0, 1 - distanceKm / 50);
    else if (c.area && t.area && String(c.area).toLowerCase() === String(t.area).toLowerCase()) distance = 0.8;
    else distance = 0.4;

    const workload = Math.max(0, 1 - active / MAX_ACTIVE_JOBS);
    const availability = Number(t.is_available) ? 1 : 0;

    const score = Math.round(100 * (w.expertise * expertise + w.distance * distance + w.workload * workload + w.availability * availability));
    const eligible = !!availability && (active < MAX_ACTIVE_JOBS || !!Number(c.is_emergency));

    const reasons = [];
    reasons.push(skilled ? 'skilled in this fault type' : (Number(t.skill_count) === 0 ? 'general technician' : 'not trained for this fault type'));
    if (distanceKm !== null) reasons.push(distanceKm.toFixed(1) + ' km away');
    else if (distance === 0.8) reasons.push('same area');
    reasons.push(active === 0 ? 'no active jobs' : active + ' active job' + (active > 1 ? 's' : ''));
    reasons.push(availability ? 'on duty' : 'on leave');

    return {
      technician_id: t.user_id,
      name: t.full_name,
      phone: t.phone,
      score,
      eligible,
      active_jobs: active,
      distance_km: distanceKm === null ? null : Math.round(distanceKm * 10) / 10,
      skilled,
      is_available: !!availability,
      avg_rating: t.avg_rating === null ? null : Number(t.avg_rating),
      breakdown: {
        expertise: Math.round(expertise * 100),
        distance: Math.round(distance * 100),
        workload: Math.round(workload * 100),
        availability: Math.round(availability * 100)
      },
      reasons
    };
  });

  ranked.sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score || a.active_jobs - b.active_jobs);
  return ranked;
}

// Gives the complaint to a technician (previous active assignment becomes "reassigned")
async function assignTechnician(conn, complaintId, technicianId, assignedBy, opts = {}) {
  const [tech] = await conn.query(
    "SELECT user_id, full_name FROM users WHERE user_id = ? AND role = 'technician' AND is_active = 1",
    [technicianId]
  );
  if (!tech.length) { const e = new Error('Technician not found'); e.status = 400; throw e; }

  const [[comp]] = await conn.query('SELECT complaint_number FROM complaints WHERE complaint_id = ?', [complaintId]);

  await conn.query(
    `UPDATE technician_assignments SET assignment_status = 'reassigned'
      WHERE complaint_id = ? AND assignment_status IN ('assigned','accepted','in_progress')`,
    [complaintId]
  );
  await conn.query(
    `INSERT INTO technician_assignments (complaint_id, technician_id, assigned_by, scheduled_visit, remarks)
     VALUES (?, ?, ?, ?, ?)`,
    [complaintId, technicianId, assignedBy, opts.scheduled_visit || null, opts.remarks || null]
  );
  await conn.query('UPDATE complaints SET auto_assigned = ? WHERE complaint_id = ?', [opts.auto ? 1 : 0, complaintId]);
  await changeStatus(conn, complaintId, 'assigned', opts.auto ? null : assignedBy,
    (opts.auto ? 'Auto-assigned to ' : 'Assigned to ') + tech[0].full_name);
  await notify(conn, technicianId, Number(complaintId), 'New job assigned',
    `You have been assigned complaint ${comp.complaint_number}.`);
  return tech[0];
}

async function firstAdminId(conn) {
  const [rows] = await conn.query("SELECT user_id FROM users WHERE role = 'admin' AND is_active = 1 ORDER BY user_id LIMIT 1");
  return rows.length ? rows[0].user_id : null;
}

// Picks the best eligible technician and assigns. Returns { assigned, technician?, reason? }
async function autoAssign(conn, complaintId, actorId = null) {
  const [[c]] = await conn.query('SELECT current_status FROM complaints WHERE complaint_id = ?', [complaintId]);
  if (!c) return { assigned: false, reason: 'Complaint not found' };
  if (['closed', 'rejected', 'repaired'].includes(c.current_status)) return { assigned: false, reason: 'Complaint is already resolved' };

  const ranked = await rankTechnicians(conn, complaintId);
  const best = ranked.find((r) => r.eligible);
  if (!best) return { assigned: false, reason: 'No technician is available right now' };

  const by = actorId || (await firstAdminId(conn));
  if (!by) return { assigned: false, reason: 'No admin account exists' };

  const remarks = `Auto-assigned (score ${best.score}): ${best.reasons.slice(0, 3).join(', ')}`;
  await assignTechnician(conn, complaintId, best.technician_id, by, { auto: true, remarks });
  return { assigned: true, technician: best };
}

module.exports = { rankTechnicians, assignTechnician, autoAssign, MAX_ACTIVE_JOBS };
