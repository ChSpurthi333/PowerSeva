/*
 * Estimated restoration time.
 *
 * Shown to citizens and refreshed every time something changes (new complaint, assignment,
 * work started, technician update, status change). How it is worked out:
 *   1. If the technician posted "about N more minutes", that is used (source = technician).
 *   2. Work started: repair time of the fault type, minus time already spent.
 *   3. Assigned, not started: travel time (or time until the scheduled visit) + repair time.
 *   4. Not assigned yet: waiting time for the priority + a queue allowance for complaints
 *      ahead of it + repair time.
 * Repair time is half of the fault type's target hours (rounded to 15 minutes, at least 30).
 * Severity matters twice: critical complaints wait the least, long repairs (transformers) take longer.
 */
const QUEUE_HOURS = { critical: 0.5, high: 1, medium: 2, low: 4 };
const TRAVEL_MIN = 30;

async function computeEta(conn, complaintId) {
  const [[c]] = await conn.query(
    `SELECT c.complaint_id, c.current_status, c.priority, c.reported_at, ft.expected_resolution_hrs AS hrs
       FROM complaints c JOIN fault_types ft ON ft.fault_type_id = c.fault_type_id
      WHERE c.complaint_id = ?`,
    [complaintId]
  );
  if (!c) return null;
  if (['repaired', 'closed', 'rejected'].includes(c.current_status)) return { minutes: null, source: 'system' };

  const repairMin = Math.max(30, Math.round((Number(c.hrs) * 60 * 0.5) / 15) * 15);

  const [[a]] = await conn.query(
    `SELECT assignment_status,
            TIMESTAMPDIFF(MINUTE, assigned_at, NOW()) AS since_assigned,
            TIMESTAMPDIFF(MINUTE, accepted_at, NOW()) AS since_accepted,
            TIMESTAMPDIFF(MINUTE, NOW(), scheduled_visit) AS mins_to_visit
       FROM technician_assignments
      WHERE complaint_id = ? AND assignment_status IN ('assigned','accepted','in_progress')
      ORDER BY assigned_at DESC, assignment_id DESC LIMIT 1`,
    [complaintId]
  );

  if (a) {
    const [[u]] = await conn.query(
      `SELECT eta_minutes, TIMESTAMPDIFF(MINUTE, created_at, NOW()) AS age
         FROM work_updates WHERE complaint_id = ? AND eta_minutes IS NOT NULL
        ORDER BY created_at DESC, update_id DESC LIMIT 1`,
      [complaintId]
    );
    if (u) return { minutes: Math.max(15, Number(u.eta_minutes) - Number(u.age || 0)), source: 'technician' };

    if (a.assignment_status === 'in_progress' || a.assignment_status === 'accepted') {
      return { minutes: Math.max(30, repairMin - Number(a.since_accepted || 0)), source: 'system' };
    }
    const toVisit = Number(a.mins_to_visit);
    if (a.mins_to_visit !== null && toVisit > 0) return { minutes: toVisit + repairMin, source: 'system' };
    return { minutes: Math.max(30, TRAVEL_MIN + repairMin - Math.min(Number(a.since_assigned || 0), TRAVEL_MIN)), source: 'system' };
  }

  // Waiting for a technician: count unassigned complaints of the same or higher priority that came first
  const [[q]] = await conn.query(
    `SELECT COUNT(*) AS ahead
       FROM complaints x
      WHERE x.complaint_id <> ?
        AND x.current_status IN ('submitted','verified','reopened','escalated')
        AND x.reported_at <= ?
        AND FIELD(x.priority,'low','medium','high','critical') >= FIELD(?,'low','medium','high','critical')
        AND NOT EXISTS (SELECT 1 FROM technician_assignments t
                         WHERE t.complaint_id = x.complaint_id AND t.assignment_status IN ('assigned','accepted','in_progress'))`,
    [complaintId, c.reported_at, c.priority]
  );
  const wait = (QUEUE_HOURS[c.priority] || 2) * 60 + 15 * Math.min(Number(q.ahead), 16);
  return { minutes: Math.round((wait + repairMin) / 5) * 5, source: 'system' };
}

// Recalculates and stores the estimate. Safe to call inside a transaction.
async function refreshEta(conn, complaintId) {
  const eta = await computeEta(conn, complaintId);
  if (!eta) return null;
  if (eta.minutes === null) {
    await conn.query('UPDATE complaints SET estimated_restoration = NULL, eta_source = ? WHERE complaint_id = ?', ['system', complaintId]);
  } else {
    await conn.query(
      'UPDATE complaints SET estimated_restoration = DATE_ADD(NOW(), INTERVAL ? MINUTE), eta_source = ? WHERE complaint_id = ?',
      [eta.minutes, eta.source, complaintId]
    );
  }
  return eta;
}

module.exports = { computeEta, refreshEta };
