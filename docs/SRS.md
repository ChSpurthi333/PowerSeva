# Software Requirements Specification (SRS)

**Project:** Electricity Fault Reporting and Tracking System
**Version:** 1.0

## 1. Introduction

### 1.1 Purpose
This document specifies the requirements of a web system that lets citizens report electricity faults, lets the electricity department manage and repair them, and keeps everyone informed until the fault is fixed and confirmed.

### 1.2 Scope
The system covers fault reporting with photos and location, verification and assignment, repair evidence, citizen confirmation, notifications, escalation of delayed complaints, and management reports. Billing, payments and smart-meter integration are out of scope.

### 1.3 Definitions
| Term | Meaning |
|------|---------|
| Complaint | A fault report submitted by a citizen |
| Technician | Department field staff who repair faults |
| Escalation | Automatic or manual raising of a delayed complaint to a senior officer |
| Due time | Report time plus the target hours of the fault type |

## 2. Overall description

### 2.1 Users
- **Citizen:** reports faults and tracks them.
- **Admin (department officer):** verifies complaints, assigns technicians, manages users, handles escalations, views reports.
- **Technician:** receives jobs, repairs, uploads evidence.

### 2.2 Environment
Modern web browser; Node.js 18+ server; MySQL 8.0.16+ database.

### 2.3 Assumptions
- Users have internet access and a phone or computer.
- Citizens may not have precise GPS; a typed address is always required.
- Technician and admin accounts are created by the department, not by public registration.

## 3. Functional requirements

### 3.1 Accounts and access
- FR-1 Citizens can register with name, email, phone and password.
- FR-2 Users log in with email and password and receive a time-limited token.
- FR-3 Each role can only see and use its own pages and APIs.
- FR-4 Admins can create technician/admin accounts and activate/deactivate users.

### 3.2 Reporting
- FR-5 A citizen can report a fault by choosing a fault type and giving title, description and location.
- FR-6 The citizen can add a landmark, GPS coordinates and up to five photos.
- FR-7 The system generates a unique complaint number (EFC-YYYY-NNNNNN).
- FR-8 Priority and due time are set from the fault type.
- FR-9 Admins are notified of every new complaint.

### 3.3 Tracking
- FR-10 Citizens can list their complaints and filter them by status.
- FR-11 Citizens can track a complaint and see a progress bar, details, photos, technician info and a status timeline.
- FR-12 Every status change is recorded with time, user and remarks.

### 3.4 Admin handling
- FR-13 Admins can search and filter all complaints by status, priority and text.
- FR-14 Admins can change a complaint's status with remarks, including rejecting it.
- FR-15 Admins can assign a technician with an optional visit time and instructions, and can reassign.
- FR-16 Admins can view dashboard statistics and reports, print them and export complaints as CSV.

### 3.5 Repair
- FR-17 Technicians see only their own jobs and can accept them.
- FR-18 Technicians submit repair evidence: description, materials and at least one photo.
- FR-19 Submitting evidence marks the complaint as repaired and asks the citizen to confirm.

### 3.6 Confirmation
- FR-20 The citizen can confirm the fix with a rating (1-5) and feedback, which closes the complaint.
- FR-21 If the citizen says it is not fixed, the complaint is reopened with a new due time and admins are notified.

### 3.7 Notifications
- FR-22 Citizens are notified on every status change; technicians when assigned; admins on new, reopened and escalated complaints.
- FR-23 Users can see unread counts and mark notifications as read.

### 3.8 Escalation
- FR-24 Unresolved complaints past their due time are escalated automatically every 30 minutes, and admins can trigger it manually.
- FR-25 A complaint has at most one open escalation; admins can mark escalations resolved.

### 3.9 PowerSeva extensions

- **FR-30 Gmail / Google login:** accounts use Gmail addresses; citizens may sign in with Google.
- **FR-31 Languages:** every screen, form label, message and notification is available in English and Telugu; text fields accept voice input.
- **FR-32 Hotspots:** admins see a heatmap and ranking of areas with frequent faults for a chosen period and fault type.
- **FR-33 Prediction:** the system forecasts the next 30 days per area from past complaints and flags high-risk areas.
- **FR-34 Emergency priority:** complaints that describe danger (fallen pole, exposed wire, sparks, transformer blast, ...) or use a hazardous fault type become critical, due in 2 hours, notify admins and raise an area alert.
- **FR-35 Estimated restoration:** each open complaint shows an estimated restoration time based on severity, queue, travel and technician updates.
- **FR-36 Outage alerts:** citizens are notified of major faults and scheduled maintenance in their area (matched by area name or by distance from their saved position).
- **FR-37 Rating:** after repair a citizen rates the service and the technician and may write feedback; technicians see their ratings.
- **FR-38 Receipt:** a PDF receipt with ID, location, date, description and resolution details can be downloaded.
- **FR-39 Auto-assignment:** technicians are scored 0-100 on expertise, distance, workload and availability; the best is assigned automatically, and admins can override.

## 4. Non-functional requirements

| ID | Requirement |
|----|-------------|
| NFR-1 Security | Passwords stored as bcrypt hashes; JWT authentication; role checks on every protected route; parameterised SQL queries; user text escaped before display |
| NFR-2 Data integrity | Foreign keys, transactions for multi-step changes, one confirmation per complaint |
| NFR-3 Usability | Responsive layout for phones and desktops; inline form validation; clear error messages |
| NFR-4 Performance | Indexes on status, priority, citizen and due date; typical pages respond in under 2 seconds |
| NFR-5 File uploads | Images only (JPG, PNG, WEBP, GIF), 5 MB each, maximum 5 per submission |
| NFR-6 Maintainability | Layered backend (routes, controllers, services) and shared frontend helpers |
| NFR-7 Auditability | Full status history kept for every complaint |

## 5. External interfaces
- **User interface:** HTML pages served by the Express server.
- **API:** REST over HTTP with JSON (see `API_Documentation.md`).
- **Database:** MySQL, 14 tables (see `ERDiagram.png`).

## 6. Future enhancements
SMS/email delivery of notifications, map view of faults, multi-department routing by area, mobile app, public outage map, password reset by email.
