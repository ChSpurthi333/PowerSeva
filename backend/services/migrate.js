const pool = require('../config/db');

// Adds the tables / column used by "forgot password" and "duplicate complaints" when the server starts.
// Safe to run every time; existing data is never touched, so `npm run setup-db` is NOT needed.
async function ensureSchema() {
  await pool.query(`CREATE TABLE IF NOT EXISTS password_resets (
    reset_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id INT UNSIGNED NOT NULL,
    token_hash CHAR(64) NOT NULL UNIQUE,
    expires_at DATETIME NOT NULL,
    used_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_pr_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE ON UPDATE CASCADE,
    INDEX idx_pr_user (user_id)
  ) ENGINE=InnoDB`);

  const [[col]] = await pool.query(
    "SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'complaints' AND COLUMN_NAME = 'support_count'");
  if (!col.n) await pool.query('ALTER TABLE complaints ADD COLUMN support_count INT UNSIGNED NOT NULL DEFAULT 0');

  await pool.query(`CREATE TABLE IF NOT EXISTS complaint_supporters (
    complaint_id INT UNSIGNED NOT NULL,
    citizen_id INT UNSIGNED NOT NULL,
    note VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (complaint_id, citizen_id),
    CONSTRAINT fk_cs_complaint FOREIGN KEY (complaint_id) REFERENCES complaints(complaint_id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_cs_citizen FOREIGN KEY (citizen_id) REFERENCES users(user_id) ON DELETE CASCADE ON UPDATE CASCADE
  ) ENGINE=InnoDB`);
}

module.exports = { ensureSchema };
