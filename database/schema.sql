-- =====================================================
-- PowerSeva - Electricity Fault Reporting and Tracking System
-- MySQL 8.0+
-- =====================================================

DROP DATABASE IF EXISTS electricity_fault_db;
CREATE DATABASE electricity_fault_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE electricity_fault_db;

-- 1. DEPARTMENTS (created first because users reference it)
CREATE TABLE departments (
  department_id   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(150) NOT NULL,
  district        VARCHAR(100),
  address         VARCHAR(255),
  contact_email   VARCHAR(150),
  contact_phone   VARCHAR(20),
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 2. USERS (citizens, admins, technicians)
CREATE TABLE users (
  user_id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  department_id   INT UNSIGNED NULL,             -- for admins/technicians
  full_name       VARCHAR(120) NOT NULL,
  email           VARCHAR(150) NOT NULL UNIQUE,
  phone           VARCHAR(20)  NULL,       -- NULL for citizens who signed up with Google
  password_hash   VARCHAR(255) NOT NULL,
  google_id       VARCHAR(64)  NULL UNIQUE, -- set when the citizen uses Continue with Google
  role            ENUM('citizen','admin','technician') NOT NULL DEFAULT 'citizen',
  address         VARCHAR(255),
  area            VARCHAR(100) NULL,        -- village / locality (used for outage alerts and prediction)
  latitude        DECIMAL(10,7) NULL,       -- citizen home or technician base location
  longitude       DECIMAL(10,7) NULL,
  is_available    TINYINT(1) NOT NULL DEFAULT 1,  -- technicians: 1 = on duty, 0 = on leave
  is_active       TINYINT(1) NOT NULL DEFAULT 1,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_department
    FOREIGN KEY (department_id) REFERENCES departments(department_id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  INDEX idx_users_role (role),
  INDEX idx_users_phone (phone),
  INDEX idx_users_area (area)
) ENGINE=InnoDB;

-- 3. FAULT TYPES
CREATE TABLE fault_types (
  fault_type_id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name                    VARCHAR(100) NOT NULL UNIQUE,
  description             VARCHAR(255),
  default_priority        ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  expected_resolution_hrs INT UNSIGNED NOT NULL DEFAULT 24,
  is_hazardous            TINYINT(1) NOT NULL DEFAULT 0,  -- 1 = dangerous to life, always an emergency
  is_active               TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB;

-- 4. COMPLAINTS
CREATE TABLE complaints (
  complaint_id      INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  complaint_number  VARCHAR(30) NOT NULL UNIQUE,   -- e.g. EFC-2026-000001
  citizen_id        INT UNSIGNED NOT NULL,
  fault_type_id     INT UNSIGNED NOT NULL,
  department_id     INT UNSIGNED NULL,
  title             VARCHAR(150) NOT NULL,
  description       TEXT NOT NULL,
  location_address  VARCHAR(255) NOT NULL,
  landmark          VARCHAR(150),
  area              VARCHAR(100) NULL,       -- village / locality
  latitude          DECIMAL(10,7),
  longitude         DECIMAL(10,7),
  priority          ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  current_status    ENUM('submitted','verified','assigned','in_progress',
                         'repaired','closed','rejected','escalated','reopened')
                    NOT NULL DEFAULT 'submitted',
  reported_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  due_by            DATETIME NULL,
  resolved_at       DATETIME NULL,
  is_emergency      TINYINT(1) NOT NULL DEFAULT 0,
  priority_reason   VARCHAR(255) NULL,       -- why the system raised the priority
  estimated_restoration DATETIME NULL,       -- shown to the citizen
  eta_source        ENUM('system','technician') NOT NULL DEFAULT 'system',
  auto_assigned     TINYINT(1) NOT NULL DEFAULT 0,
  updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_complaints_citizen
    FOREIGN KEY (citizen_id) REFERENCES users(user_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_complaints_fault_type
    FOREIGN KEY (fault_type_id) REFERENCES fault_types(fault_type_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_complaints_department
    FOREIGN KEY (department_id) REFERENCES departments(department_id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  INDEX idx_complaints_status (current_status),
  INDEX idx_complaints_priority (priority),
  INDEX idx_complaints_citizen (citizen_id),
  INDEX idx_complaints_due (due_by),
  INDEX idx_complaints_area (area),
  INDEX idx_complaints_emergency (is_emergency)
) ENGINE=InnoDB;

-- 5. COMPLAINT IMAGES
CREATE TABLE complaint_images (
  image_id      INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  complaint_id  INT UNSIGNED NOT NULL,
  image_url     VARCHAR(255) NOT NULL,
  caption       VARCHAR(150),
  uploaded_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_cimg_complaint
    FOREIGN KEY (complaint_id) REFERENCES complaints(complaint_id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- 6. TECHNICIAN ASSIGNMENTS
CREATE TABLE technician_assignments (
  assignment_id    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  complaint_id     INT UNSIGNED NOT NULL,
  technician_id    INT UNSIGNED NOT NULL,
  assigned_by      INT UNSIGNED NOT NULL,          -- admin
  assigned_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  scheduled_visit  DATETIME NULL,
  accepted_at      DATETIME NULL,
  completed_at     DATETIME NULL,
  assignment_status ENUM('assigned','accepted','in_progress','completed','reassigned','declined')
                    NOT NULL DEFAULT 'assigned',
  remarks          VARCHAR(255),
  CONSTRAINT fk_ta_complaint
    FOREIGN KEY (complaint_id) REFERENCES complaints(complaint_id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_ta_technician
    FOREIGN KEY (technician_id) REFERENCES users(user_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_ta_assigned_by
    FOREIGN KEY (assigned_by) REFERENCES users(user_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  INDEX idx_ta_technician (technician_id, assignment_status)
) ENGINE=InnoDB;

-- 7. STATUS HISTORY
CREATE TABLE status_history (
  history_id    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  complaint_id  INT UNSIGNED NOT NULL,
  old_status    VARCHAR(20) NULL,
  new_status    VARCHAR(20) NOT NULL,
  changed_by    INT UNSIGNED NULL,
  remarks       VARCHAR(255),
  changed_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sh_complaint
    FOREIGN KEY (complaint_id) REFERENCES complaints(complaint_id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_sh_user
    FOREIGN KEY (changed_by) REFERENCES users(user_id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  INDEX idx_sh_complaint (complaint_id, changed_at)
) ENGINE=InnoDB;

-- 8. REPAIR EVIDENCE
CREATE TABLE repair_evidence (
  evidence_id        INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  assignment_id      INT UNSIGNED NOT NULL,
  complaint_id       INT UNSIGNED NOT NULL,
  image_url          VARCHAR(255) NOT NULL,
  work_description   TEXT,
  materials_used     VARCHAR(255),
  repair_completed_at DATETIME NULL,
  uploaded_by        INT UNSIGNED NOT NULL,
  uploaded_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_re_assignment
    FOREIGN KEY (assignment_id) REFERENCES technician_assignments(assignment_id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_re_complaint
    FOREIGN KEY (complaint_id) REFERENCES complaints(complaint_id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_re_user
    FOREIGN KEY (uploaded_by) REFERENCES users(user_id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

-- 9. NOTIFICATIONS
CREATE TABLE notifications (
  notification_id  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id          INT UNSIGNED NOT NULL,
  complaint_id     INT UNSIGNED NULL,
  title            VARCHAR(150) NOT NULL,
  message          VARCHAR(500) NOT NULL,
  channel          ENUM('in_app','sms','email') NOT NULL DEFAULT 'in_app',
  is_read          TINYINT(1) NOT NULL DEFAULT 0,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_n_user
    FOREIGN KEY (user_id) REFERENCES users(user_id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_n_complaint
    FOREIGN KEY (complaint_id) REFERENCES complaints(complaint_id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  INDEX idx_n_user_read (user_id, is_read)
) ENGINE=InnoDB;

-- 10. CITIZEN CONFIRMATIONS
CREATE TABLE citizen_confirmations (
  confirmation_id  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  complaint_id     INT UNSIGNED NOT NULL UNIQUE,   -- one confirmation per complaint
  citizen_id       INT UNSIGNED NOT NULL,
  is_resolved      TINYINT(1) NOT NULL,            -- 1 = fixed, 0 = not fixed
  rating           TINYINT UNSIGNED NULL,          -- overall service
  technician_id    INT UNSIGNED NULL,              -- technician who did the repair
  technician_rating TINYINT UNSIGNED NULL,         -- rating of that technician
  feedback         VARCHAR(500),
  confirmed_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_rating CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  CONSTRAINT chk_tech_rating CHECK (technician_rating IS NULL OR technician_rating BETWEEN 1 AND 5),
  CONSTRAINT fk_cc_complaint
    FOREIGN KEY (complaint_id) REFERENCES complaints(complaint_id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_cc_citizen
    FOREIGN KEY (citizen_id) REFERENCES users(user_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_cc_technician
    FOREIGN KEY (technician_id) REFERENCES users(user_id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;

-- 11. ESCALATIONS
CREATE TABLE escalations (
  escalation_id    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  complaint_id     INT UNSIGNED NOT NULL,
  escalated_by     INT UNSIGNED NULL,              -- NULL when system auto-escalates
  escalated_to     INT UNSIGNED NULL,
  escalation_level TINYINT UNSIGNED NOT NULL DEFAULT 1,
  reason           VARCHAR(255) NOT NULL,
  escalation_status ENUM('open','under_review','resolved') NOT NULL DEFAULT 'open',
  escalated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved_at      DATETIME NULL,
  resolution_note  VARCHAR(255),
  CONSTRAINT fk_e_complaint
    FOREIGN KEY (complaint_id) REFERENCES complaints(complaint_id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_e_by
    FOREIGN KEY (escalated_by) REFERENCES users(user_id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_e_to
    FOREIGN KEY (escalated_to) REFERENCES users(user_id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  INDEX idx_e_status (escalation_status)
) ENGINE=InnoDB;

-- 12. TECHNICIAN SKILLS (which fault types a technician is trained for)
CREATE TABLE technician_skills (
  technician_id  INT UNSIGNED NOT NULL,
  fault_type_id  INT UNSIGNED NOT NULL,
  PRIMARY KEY (technician_id, fault_type_id),
  CONSTRAINT fk_ts_technician
    FOREIGN KEY (technician_id) REFERENCES users(user_id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_ts_fault_type
    FOREIGN KEY (fault_type_id) REFERENCES fault_types(fault_type_id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- 13. WORK UPDATES (progress notes and time estimates posted by technicians)
CREATE TABLE work_updates (
  update_id      INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  complaint_id   INT UNSIGNED NOT NULL,
  technician_id  INT UNSIGNED NOT NULL,
  message        VARCHAR(500) NOT NULL,
  eta_minutes    INT UNSIGNED NULL,              -- "I need about this many more minutes"
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_wu_complaint
    FOREIGN KEY (complaint_id) REFERENCES complaints(complaint_id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_wu_technician
    FOREIGN KEY (technician_id) REFERENCES users(user_id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  INDEX idx_wu_complaint (complaint_id, created_at)
) ENGINE=InnoDB;

-- 14. OUTAGE ALERTS (major faults and planned maintenance shown to citizens nearby)
CREATE TABLE outage_alerts (
  alert_id     INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  alert_type   ENUM('fault','maintenance') NOT NULL,
  title        VARCHAR(150) NOT NULL,
  message      VARCHAR(500) NOT NULL,
  area         VARCHAR(100) NULL,
  latitude     DECIMAL(10,7) NULL,
  longitude    DECIMAL(10,7) NULL,
  radius_km    DECIMAL(5,1) NOT NULL DEFAULT 3.0,
  starts_at    DATETIME NOT NULL,
  ends_at      DATETIME NULL,
  is_active    TINYINT(1) NOT NULL DEFAULT 1,
  is_auto      TINYINT(1) NOT NULL DEFAULT 0,       -- 1 = created by the system from an emergency complaint
  complaint_id INT UNSIGNED NULL,
  created_by   INT UNSIGNED NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_oa_user
    FOREIGN KEY (created_by) REFERENCES users(user_id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_oa_complaint
    FOREIGN KEY (complaint_id) REFERENCES complaints(complaint_id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  INDEX idx_oa_active (is_active, ends_at),
  INDEX idx_oa_area (area)
) ENGINE=InnoDB;

-- ===== Added later: forgot password and duplicate complaints (the server also creates these on start) =====
ALTER TABLE complaints ADD COLUMN support_count INT UNSIGNED NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS password_resets (
  reset_id    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     INT UNSIGNED NOT NULL,
  token_hash  CHAR(64) NOT NULL UNIQUE,
  expires_at  DATETIME NOT NULL,
  used_at     DATETIME NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pr_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE ON UPDATE CASCADE,
  INDEX idx_pr_user (user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS complaint_supporters (
  complaint_id INT UNSIGNED NOT NULL,
  citizen_id   INT UNSIGNED NOT NULL,
  note         VARCHAR(255) NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (complaint_id, citizen_id),
  CONSTRAINT fk_cs_complaint FOREIGN KEY (complaint_id) REFERENCES complaints(complaint_id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_cs_citizen FOREIGN KEY (citizen_id) REFERENCES users(user_id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;
