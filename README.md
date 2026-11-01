# PowerSeva - Electricity Fault Reporting and Tracking System

A web application where citizens report electricity faults (with photos and location), the electricity department verifies and assigns them to technicians, technicians upload repair evidence, and citizens confirm the repair. Overdue complaints are escalated automatically. The whole site works in **English and Telugu** (with voice typing), so villagers can use it in their own language.

**Stack:** HTML, CSS, JavaScript (frontend) &middot; Node.js + Express (backend) &middot; MySQL (database) &middot; JWT authentication

## Roles

| Role | What they can do |
|------|------------------|
| Citizen | Register / sign in with Google, report faults with photos and map location, see emergency advice and estimated restoration time, get nearby outage alerts, download a PDF receipt, rate the technician |
| Admin | Dashboard, hotspot heatmap, fault prediction, outage/maintenance alerts, ranked technician suggestions + auto-assign, manage users, escalations, reports |
| Technician | Availability switch, see assigned jobs (emergencies first), post work updates with a time estimate, upload repair photos, see ratings and feedback |

## Features

| # | Feature | Where to find it |
|---|---------|------------------|
| 1 | Gmail-format logins + **Continue with Google** | Login / Register pages (see `docs/GOOGLE_LOGIN_SETUP.md`) |
| 2 | Name **PowerSeva** everywhere | All pages |
| 3 | Light, professional theme | All pages |
| 4 | **Telugu / English** switch for the whole site, including complaint forms and work updates, plus a **microphone** button on text fields (speech goes straight into the field) | Language buttons in the top bar; mic icon in each field |
| 5 | **Fault hotspot** heatmap + problem-prone area table | Admin -> Fault Hotspots |
| 6 | **Fault prediction** (statistical forecast from past complaints: risk score, expected faults in 30 days, likely fault type) | Admin -> Fault Prediction |
| 7 | **Emergency priority**: fallen poles, exposed/hanging wires, sparks, transformer blasts, etc. become *Critical*, due in 2 hours, trigger an admin alert and an area outage alert | Report a Fault (live warning with safety advice) |
| 8 | **Estimated restoration time** from severity, technician updates, queue and travel | Citizen complaint views, technician jobs |
| 9 | **Nearby outage alerts** (major faults and planned maintenance) by the citizen's area / map position | Citizen -> Outage Alerts, notifications; admins create them in Admin -> Outage Alerts |
| 10 | **Service rating and feedback** (service + technician stars) after repair | Citizen -> track complaint |
| 11 | **PDF receipt** (ID, location, date, description, resolution details) | "Download receipt" on any complaint |
| 12 | **Automatic technician assignment** by skill, distance, workload and availability | Happens on submission; admin can also use *Auto-assign* / *Auto-assign all* |

## Folder structure

```
Electricity-Fault-Reporting-System/
├── frontend/     HTML pages (citizen/, admin/, technician/), css/, js/, assets/
├── backend/      Express API (config, controllers, routes, middleware, services, utils, uploads)
├── database/     schema.sql, sample-data.sql, queries.sql
├── docs/         ProjectDocumentation.md, SRS.md, API_Documentation.md, ERDiagram.png
└── README.md
```

## Setup (about 5 minutes)

**Requirements:** Node.js 18+ and MySQL 8.0.16+ (MySQL service must be running)

1. **Set your MySQL password** - open `backend/.env` and change:
   ```
   DB_USER=root
   DB_PASSWORD=your_mysql_password      <- put your real MySQL password here
   JWT_SECRET=use_a_long_random_string
   ```

2. **Install, create the database, start** (works in PowerShell, CMD, macOS, Linux):
   ```bash
   cd backend
   npm install
   npm run setup-db      # creates electricity_fault_db, tables and demo data
   npm start             # or: npm run dev
   ```
   `npm run setup-db` drops and recreates `electricity_fault_db`, so run it only on a fresh setup.
   Use `npm run setup-db -- --empty` for tables only, without demo data.

   Optional settings in `backend/.env`: `GOOGLE_CLIENT_ID` (Google sign-in), `AUTO_ASSIGN=true|false`, `AUTO_ESCALATION=true|false`.

3. **Open the app** at <http://localhost:5000> (the backend also serves the frontend).

When the server starts it prints `Database connection OK`, or a `DATABASE PROBLEM` message that says how to fix it.
You can also check <http://localhost:5000/api/health/db>.

### Troubleshooting

| Message | Fix |
|---------|-----|
| `Cannot find module 'dotenv'` | Run `npm install` inside `backend/` |
| `Wrong MySQL username/password` | Fix `DB_PASSWORD` in `backend/.env`, no quotes |
| `Database does not exist` / `Tables are missing` | Run `npm run setup-db` |
| `MySQL is not running` | Start the MySQL service (Windows: Services -> MySQL80 -> Start) |
| `Internal server error` on register/login | Check the terminal for the DATABASE PROBLEM line |

## Demo accounts (from `sample-data.sql`)

| Role | Email | Password |
|------|-------|----------|
| Admin | admin.powerseva@gmail.com | Admin@123 |
| Technician | ravi.powerseva@gmail.com (Guntur) | Tech@123 |
| Technician | suresh.powerseva@gmail.com (Tenali) | Tech@123 |
| Technician | lakshmi.powerseva@gmail.com (Narasaraopet) | Tech@123 |
| Citizen | anita.powerseva@gmail.com (Guntur) | Citizen@123 |
| Citizen | kiran.powerseva@gmail.com (Guntur) | Citizen@123 |
| Citizen | madhavi.powerseva@gmail.com (Tenali) | Citizen@123 |

The demo data also contains about 90 past complaints in six towns so the heatmap and predictions have something to show.

**Change these passwords and the `JWT_SECRET` before any real use.**

## Typical workflow

1. Citizen registers (Gmail address or Google) and reports a fault &rarr; gets a number like `EFC-2026-000001`, a priority and an estimated restoration time. Dangerous faults are marked *Emergency* automatically.
2. The best technician is assigned automatically (or the admin assigns one from ranked suggestions)
3. Technician accepts the job, fixes it, uploads repair photos &rarr; status becomes *repaired*
4. Citizen confirms &rarr; *closed* (or says it is not fixed &rarr; *reopened*)
5. Complaints past their due time are escalated automatically every 30 minutes (or on demand from the admin dashboard)

## Notes

- Uploaded photos are saved in `backend/uploads/`.
- The sample repair photo path in `sample-data.sql` points to a file that does not exist; that image is simply hidden in the UI.
- Public registration only creates citizen accounts; admins create technician/admin accounts from **Manage Users**.
- **Google sign-in** needs your own Google Client ID - follow `docs/GOOGLE_LOGIN_SETUP.md`. Without it the button explains what is missing and email login keeps working.
- **Telugu:** translations were written by the developer assistant; please have a Telugu speaker review the wording before public use. The PDF receipt is in English.
- **Voice typing** uses the browser's speech recognition: use Chrome or Edge, allow the microphone, and be online.
- **Maps** use OpenStreetMap tiles, so the map pages need internet access.
- **Fault prediction** is a statistical forecast (recency-weighted counts and trend), not a deep-learning model; it becomes more useful as real complaints accumulate.
- Set `AUTO_ESCALATION=false` in `.env` to turn off the background escalation job.

More detail: `docs/ProjectDocumentation.md`, `docs/SRS.md`, `docs/API_Documentation.md`.
