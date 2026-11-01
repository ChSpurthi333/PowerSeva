-- =====================================================
-- Useful queries for the Electricity Fault Reporting System
-- =====================================================
USE electricity_fault_db;

-- 1. Dashboard counts by status
SELECT current_status, COUNT(*) AS total
FROM complaints
GROUP BY current_status;

-- 2. Overdue complaints that are still unresolved
SELECT complaint_number, title, priority, current_status, due_by
FROM complaints
WHERE current_status NOT IN ('closed','rejected','repaired')
  AND due_by < NOW()
ORDER BY due_by;

-- 3. Complete tracking timeline of one complaint
SELECT h.changed_at, h.old_status, h.new_status, u.full_name AS changed_by, h.remarks
FROM status_history h
LEFT JOIN users u ON u.user_id = h.changed_by
WHERE h.complaint_id = 1
ORDER BY h.changed_at, h.history_id;

-- 4. All complaints of one citizen
SELECT c.complaint_number, ft.name AS fault_type, c.title, c.current_status, c.reported_at
FROM complaints c
JOIN fault_types ft ON ft.fault_type_id = c.fault_type_id
WHERE c.citizen_id = 4
ORDER BY c.reported_at DESC;

-- 5. Current workload per technician
SELECT u.full_name, COUNT(a.assignment_id) AS active_jobs
FROM users u
LEFT JOIN technician_assignments a
       ON a.technician_id = u.user_id
      AND a.assignment_status IN ('assigned','accepted','in_progress')
WHERE u.role = 'technician'
GROUP BY u.user_id, u.full_name
ORDER BY active_jobs DESC;

-- 6. Average resolution time (hours) per fault type
SELECT ft.name AS fault_type,
       ROUND(AVG(TIMESTAMPDIFF(MINUTE, c.reported_at, c.resolved_at)) / 60, 1) AS avg_hours
FROM complaints c
JOIN fault_types ft ON ft.fault_type_id = c.fault_type_id
WHERE c.resolved_at IS NOT NULL
GROUP BY ft.name;

-- 7. Complaints per fault type
SELECT ft.name AS fault_type, COUNT(*) AS total
FROM complaints c
JOIN fault_types ft ON ft.fault_type_id = c.fault_type_id
GROUP BY ft.name
ORDER BY total DESC;

-- 8. Open escalations with complaint details
SELECT e.escalation_id, c.complaint_number, c.title, e.escalation_level, e.reason, e.escalated_at
FROM escalations e
JOIN complaints c ON c.complaint_id = e.complaint_id
WHERE e.escalation_status <> 'resolved'
ORDER BY e.escalated_at;

-- 9. Citizen satisfaction (average rating)
SELECT ROUND(AVG(rating), 2) AS avg_rating, COUNT(*) AS responses
FROM citizen_confirmations
WHERE rating IS NOT NULL;

-- 10. Repair evidence for a complaint
SELECT re.image_url, re.work_description, re.materials_used, re.repair_completed_at, u.full_name AS technician
FROM repair_evidence re
JOIN users u ON u.user_id = re.uploaded_by
WHERE re.complaint_id = 1;

-- 11. Unread notifications of a user
SELECT title, message, created_at
FROM notifications
WHERE user_id = 4 AND is_read = 0
ORDER BY created_at DESC;


-- 12. Hotspots: complaints per area in the last 90 days
SELECT area, COUNT(*) AS complaints, SUM(is_emergency) AS emergencies
FROM complaints
WHERE area IS NOT NULL AND reported_at >= NOW() - INTERVAL 5 YEAR
GROUP BY area
ORDER BY complaints DESC;

-- 13. Open emergencies, oldest first
SELECT complaint_number, title, area, priority_reason, due_by, estimated_restoration
FROM complaints
WHERE is_emergency = 1 AND current_status NOT IN ('closed','rejected')
ORDER BY reported_at;

-- 14. Technician ratings
SELECT u.full_name, ROUND(AVG(cc.technician_rating), 2) AS avg_rating, COUNT(cc.technician_rating) AS ratings
FROM citizen_confirmations cc
JOIN users u ON u.user_id = cc.technician_id
WHERE cc.technician_rating IS NOT NULL
GROUP BY u.user_id, u.full_name
ORDER BY avg_rating DESC;

-- 15. Technician workload and skills
SELECT u.full_name, u.area, u.is_available,
       (SELECT COUNT(*) FROM technician_assignments a
         WHERE a.technician_id = u.user_id AND a.assignment_status IN ('assigned','accepted','in_progress')) AS active_jobs,
       (SELECT GROUP_CONCAT(ft.name SEPARATOR ', ') FROM technician_skills s
         JOIN fault_types ft ON ft.fault_type_id = s.fault_type_id WHERE s.technician_id = u.user_id) AS skills
FROM users u
WHERE u.role = 'technician';

-- 16. Active outage alerts
SELECT alert_type, title, area, starts_at, ends_at
FROM outage_alerts
WHERE is_active = 1 AND ends_at > NOW()
ORDER BY starts_at DESC;

-- 17. Work updates posted for a complaint
SELECT w.message, w.eta_minutes, w.created_at, u.full_name AS technician
FROM work_updates w JOIN users u ON u.user_id = w.technician_id
WHERE w.complaint_id = 1
ORDER BY w.created_at;
