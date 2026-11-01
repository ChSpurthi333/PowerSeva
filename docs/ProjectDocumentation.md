# Project Documentation

## 1. Overview

The Electricity Fault Reporting and Tracking System replaces phone-based fault reporting with a transparent online process. A citizen reports a fault, the department assigns a technician, the technician uploads proof of repair, and the citizen confirms. Everything is timestamped, so delays are visible and can be escalated.

## 2. Architecture

```
Browser (HTML / CSS / JS)  --->  Express REST API  --->  MySQL
        |                           |   routes -> controllers -> services
        |                           |   middleware: auth (JWT), roles, uploads, errors
        +--- static files <---------+   uploads/ folder for photos
```

- **Frontend:** plain HTML pages with shared CSS and JavaScript. `api.js` handles login tokens, API calls, the sidebar/topbar layout and notifications. Each role has its own pages and script.
- **Backend:** Express app. Routes map URLs to controllers, controllers handle requests, and services hold logic reused in several places (status changes, notifications, escalation).
- **Database:** MySQL with foreign keys and indexes. Multi-step actions run inside transactions.

## 3. Database design

Fourteen tables (diagram in `ERDiagram.png`):

| Table | Purpose |
|-------|---------|
| users | Citizens, admins and technicians (role column) |
| departments | Electricity department details |
| fault_types | Categories with default priority and target resolution hours |
| complaints | Fault reports; central table |
| complaint_images | Photos uploaded by the citizen |
| technician_assignments | Who was assigned, when, and the job's state |
| status_history | Every status change (timeline) |
| repair_evidence | Technician's repair photos and notes |
| notifications | In-app messages to users |
| citizen_confirmations | The citizen's verdict and rating (one per complaint) |
| escalations | Delayed complaints raised to senior officers |

Design choices:
- `complaints.current_status` holds the latest state for fast filtering; `status_history` keeps the full audit trail.
- Deleting a complaint removes its images, history, evidence and escalations. Users who own complaints cannot be deleted; they are deactivated instead.
- `due_by` is calculated when the complaint is created from the fault type's `expected_resolution_hrs`.

### 3.1 PowerSeva additions

New tables: `technician_skills` (which fault types a technician can handle), `work_updates` (progress notes with optional time estimate) and `outage_alerts` (major fault / maintenance notices). New columns include `complaints.area, is_emergency, priority_reason, estimated_restoration, eta_source, auto_assigned`, `users.area, latitude, longitude, is_available` and `citizen_confirmations.technician_rating`.

### 3.2 How the smart features work

- **Emergency priority** (`priorityService`): keyword rules in English and Telugu plus the fault type's `is_hazardous` flag. An emergency is critical, due in 2 hours, notifies admins, creates an area alert (once per 6 h per area) and is assigned immediately.
- **Estimated restoration** (`etaService`): technician's own estimate, else remaining repair time if in progress, else travel + repair if assigned, else queue wait + repair. Repair time is half the fault type's target hours (min 30 min).
- **Technician assignment** (`assignmentService`): score = expertise + distance (haversine, 50 km cap) + workload (max 5 open jobs) + availability; emergencies weight distance more. Set `AUTO_ASSIGN=false` to disable.
- **Prediction** (`predictionService`): recency-weighted risk (21-day half-life), exponentially smoothed weekly counts, trend slope and a 30-day forecast; score = 55% risk + 45% forecast. This is statistical forecasting, not deep learning.
- **Hotspots**: complaint coordinates weighted by priority, drawn with Leaflet + leaflet.heat (vendored in `frontend/assets/vendor`).
- **Language**: `t('English text')` everywhere; `js/lang-te.js` holds the Telugu dictionary and `js/i18n.js` translates dynamic server messages. Voice typing uses the browser Web Speech API (`te-IN` / `en-IN`).

## 4. Key workflows

**Reporting.** The citizen submits the form. The server inserts the complaint, creates the number `EFC-YYYY-NNNNNN` from its ID, stores photos, writes the first history row and notifies the citizen and admins, all in one transaction.

**Assignment.** The admin picks a technician. Earlier active assignments become `reassigned`, a new one is created, the complaint becomes `assigned`, and the technician and citizen are notified.

**Repair.** The technician accepts (`in_progress`), then submits photos and description. The assignment becomes `completed`, the complaint becomes `repaired`, and the citizen is asked to confirm.

**Confirmation.** "Fixed" closes the complaint. "Not fixed" reopens it, sets a new 24-hour due time and notifies admins.

**Escalation.** Every 30 minutes (and on demand) the server finds unresolved complaints past `due_by` without an open escalation, creates an escalation, marks the complaint `escalated` and notifies admins.

## 5. Security

- Passwords hashed with bcrypt; login returns a signed JWT.
- Every protected route checks the token and the user's role; deactivated users are rejected immediately.
- SQL uses parameter placeholders only.
- Dynamic text is HTML-escaped before it is shown.
- Uploads are limited to images, 5 MB each and 5 per request.
- Citizens can only open their own complaints.

## 6. Testing checklist

1. Register a citizen and log in.
2. Report a fault with photos; note the complaint number.
3. As admin, assign a technician; check the history and notifications.
4. As technician, accept the job and submit repair photos.
5. As the citizen, confirm "fixed" with a rating; the complaint closes.
6. Repeat and answer "not fixed"; the complaint reopens.
7. In the database set a complaint's `due_by` to a past time and click **Escalate overdue complaints**.
8. Open Reports and export the CSV.

## 7. Known limitations and ideas

- Notifications are in-app only (no SMS or email yet).
- Complaints go to the first department; area-based routing is a future addition.
- No password reset flow yet.
- Add HTTPS, rate limiting and restricted CORS before deploying publicly.
