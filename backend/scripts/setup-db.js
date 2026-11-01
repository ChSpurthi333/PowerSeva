/*
 * One-command database setup (works on Windows, macOS and Linux).
 *
 *   npm run setup-db            -> creates the database + tables + demo data
 *   npm run setup-db -- --empty -> creates the database + tables only
 *
 * WARNING: this DROPS and recreates electricity_fault_db.
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const dbDir = path.join(__dirname, '..', '..', 'database');
const files = ['schema.sql'];
if (!process.argv.includes('--empty')) files.push('sample-data.sql');

const hints = {
  ER_ACCESS_DENIED_ERROR: 'Wrong MySQL username/password. Set DB_USER and DB_PASSWORD in backend/.env',
  ECONNREFUSED: 'Cannot reach MySQL. Make sure the MySQL service is running (host: ' + (process.env.DB_HOST || 'localhost') + ').',
  ENOTFOUND: 'MySQL host not found. Check DB_HOST in backend/.env'
};

(async () => {
  let conn;
  try {
    conn = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      multipleStatements: true
    });
    console.log('Connected to MySQL.');

    for (const f of files) {
      const sql = fs.readFileSync(path.join(dbDir, f), 'utf8').replace(/^﻿/, '');
      await conn.query(sql);
      console.log('Ran ' + f);
    }
    const [[r]] = await conn.query('SELECT COUNT(*) AS users FROM electricity_fault_db.users');
    console.log(`\nDone. Database "electricity_fault_db" is ready (${r.users} user(s)).`);
    if (files.length > 1) {
      console.log('Demo logins: admin.powerseva@gmail.com / Admin@123, ravi.powerseva@gmail.com / Tech@123, anita.powerseva@gmail.com / Citizen@123');
    } else {
      console.log('No demo data loaded. Register a citizen on the site; create admin accounts directly in the database.');
    }
    await conn.end();
  } catch (e) {
    console.error('\nSETUP FAILED (' + (e.code || 'error') + '): ' + (hints[e.code] || e.message));
    if (conn) await conn.end().catch(() => {});
    process.exit(1);
  }
})();
