# API Documentation

Base URL: `http://localhost:5000/api`

All responses are JSON. Errors look like `{ "message": "reason" }` with an HTTP status code (400 validation, 401 not logged in, 403 wrong role, 404 not found, 409 duplicate, 500 server error).

**Authentication:** send `Authorization: Bearer <token>` on every endpoint except register and login. The token is returned by login and expires after `JWT_EXPIRES_IN` (default 8h).

## Auth

| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| POST | `/auth/register` | `full_name, email (must be @gmail.com), phone, password, address?, area?` | Creates a **citizen** account |
| POST | `/auth/login` | `email, password` | Returns `{ token, user }` |
| POST | `/auth/google` | `credential` (Google ID token) | Signs in / creates a **citizen** account with Google. Needs `GOOGLE_CLIENT_ID` |
| GET | `/auth/config` | | `{ googleClientId }` so the page can show the Google button |
| GET | `/auth/me` | | Current user |
| PUT | `/auth/profile` | `phone?, area?, latitude?, longitude?, is_available?` (technicians only) | Saves the user's village/area, map position and availability |

## Complaints (any logged-in user unless noted)

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| GET | `/complaints/fault-types` | any | Active fault types with default priority, target hours and `is_hazardous` |
| GET | `/complaints/areas` | any | Known area names (for the area suggestions) |
| POST | `/complaints/assess` | citizen | Body `fault_type_id, description`. Returns `{ priority, is_emergency, reason, due_hours }` - used for the live emergency warning |
| GET | `/complaints/alerts` | any | Active outage / maintenance alerts near the user |
| GET | `/complaints/receipt/:number` | owner / admin / assigned technician | PDF receipt (`application/pdf`) |
| POST | `/complaints` | citizen | Report a fault. `multipart/form-data`: `fault_type_id, title, description, location_address, area?, landmark?, latitude?, longitude?, images[]` (max 5 images, 5 MB each). Returns `complaint_number, priority, is_emergency, priority_reason, auto_assigned, technician_name, estimated_restoration, eta_source` |
| GET | `/complaints/my` | citizen | The citizen's own complaints |
| GET | `/complaints/track/:number` | any | Full detail: complaint, images, status history, assignments, repair evidence, confirmation. Citizens can only open their own |
| POST | `/complaints/:id/confirm` | citizen | Body `is_resolved (bool), rating? (1-5, service), technician_rating? (1-5), feedback?`. Only when status is `repaired`. `true` closes, `false` reopens |
| GET | `/complaints/notifications` | any | Latest 50 notifications |
| POST | `/complaints/notifications/read` | any | Marks all as read |

## Admin (role: admin)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/stats` | Totals incl. open `emergencies`, `unassigned`, `active_alerts` |
| GET | `/admin/complaints?status=&priority=&emergency=&unassigned=&search=` | Complaint list (critical first), includes technician and overdue flag |
| PUT | `/admin/complaints/:id/status` | Body `status, remarks?`. Writes status history and notifies the citizen |
| GET | `/admin/technicians` | Active technicians with `skills`, `avg_rating`, `is_available`, `active_jobs`, area |
| GET | `/admin/complaints/:id/suggestions` | Technicians ranked 0-100 by expertise, distance, workload and availability, with reasons |
| POST | `/admin/complaints/:id/auto-assign` | Assigns the best-ranked technician |
| POST | `/admin/auto-assign-all` | Auto-assigns every open complaint without a technician |
| POST | `/admin/complaints/:id/assign` | Body `technician_id, scheduled_visit?, remarks?`. Previous active assignment becomes `reassigned` |
| GET | `/admin/users?role=` | List users |
| POST | `/admin/users` | Body `full_name, email (@gmail.com), phone, password, role (technician|admin), area?, latitude?, longitude?, fault_type_ids?` |
| PUT | `/admin/users/:id/technician` | Body `area?, latitude?, longitude?, is_available?, fault_type_ids?` - skills and base location |
| PUT | `/admin/users/:id/active` | Body `is_active (bool)` |
| GET | `/admin/hotspots?days=&fault_type_id=` | Heatmap points (`lat, lng, weight`) and per-area counts |
| GET | `/admin/predictions` | Per-area `risk_score`, `risk_level`, `forecast_30d`, `trend`, `likely_fault`, `weekly[12]`, reasons, recommendation |
| GET | `/admin/alerts` | All outage / maintenance alerts |
| POST | `/admin/alerts` | Body `alert_type (fault|maintenance), title, message, area, latitude?, longitude?, radius_km?, duration_hours` - notifies citizens nearby |
| PUT | `/admin/alerts/:id/cancel` | Ends an alert |
| POST | `/admin/escalations/run` | Escalates all overdue unresolved complaints now |
| GET | `/admin/escalations` | Escalation list |
| PUT | `/admin/escalations/:id/resolve` | Body `note?` |
| GET | `/admin/reports` | Counts by status/fault type/priority, average resolution hours, average rating, technician performance |

## Technician (role: technician)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/technician/stats` | Counts of jobs, `avg_rating`, `rating_count`, `is_available` |
| GET | `/technician/feedback` | Average rating and recent citizen feedback |
| GET | `/technician/assignments` | The technician's jobs with complaint and citizen details |
| PUT | `/technician/assignments/:id/accept` | Starts the job; complaint becomes `in_progress` |
| POST | `/technician/assignments/:id/update` | Body `message, eta_minutes? (5-2880)`. Notifies the citizen and refreshes the estimated restoration time |
| POST | `/technician/assignments/:id/repair` | `multipart/form-data`: `work_description, materials_used?, images[]` (at least 1 image). Complaint becomes `repaired` and the citizen is asked to confirm |

## Other

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | `{ "status": "ok" }` |
| GET | `/uploads/<file>` | Uploaded photos (static) |

## Complaint status flow

```
submitted -> verified -> assigned -> in_progress -> repaired -> closed
                                         ^              |
                                         |              v
                                      reopened <--- (citizen says not fixed)

any open status --(past due_by)--> escalated        any status --> rejected (admin)
```

## Example

```bash
# Login
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"anita.powerseva@gmail.com","password":"Citizen@123"}'

# Track a complaint
curl http://localhost:5000/api/complaints/track/EFC-2026-000001 \
  -H "Authorization: Bearer <token>"
```
