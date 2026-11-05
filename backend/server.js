require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');

const pool = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const complaintRoutes = require('./routes/complaintRoutes');
const adminRoutes = require('./routes/adminRoutes');
const technicianRoutes = require('./routes/technicianRoutes');
const { ensureSchema } = require('./services/migrate');
const { notFound, errorHandler } = require('./middleware/errorMiddleware');
const { escalateOverdueComplaints } = require('./services/complaintService');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Uploaded fault / repair photos
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// REST API
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Database check: open http://localhost:5000/api/health/db
app.get('/api/health/db', async (req, res) => {
  try {
    const [[r]] = await pool.query('SELECT COUNT(*) AS users FROM users');
    res.json({ db: 'ok', users: r.users });
  } catch (e) {
    res.status(500).json({ db: 'FAILED', code: e.code, message: e.message });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/complaints', complaintRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/technician', technicianRoutes);
app.use('/api', notFound);

// The frontend is served by the same server -> open http://localhost:5000
app.use(express.static(path.join(__dirname, '..', 'frontend'), {
  setHeaders: (res, file) => {
    // The service worker and manifest must always be re-checked so app updates reach users
    if (/[\\/](sw\.js|manifest\.webmanifest)$/.test(file)) res.set('Cache-Control', 'no-cache');
  }
}));

app.use(errorHandler);

const PORT = process.env.PORT || 5000;

// Explains the most common database problems in plain words
function explainDbError(e) {
  const hints = {
    ER_ACCESS_DENIED_ERROR: 'Wrong MySQL username/password. Fix DB_USER and DB_PASSWORD in backend/.env',
    ER_BAD_DB_ERROR: 'Database does not exist yet. Run:  npm run setup-db',
    ER_NO_SUCH_TABLE: 'Tables are missing. Run:  npm run setup-db',
    ECONNREFUSED: 'MySQL is not running. Start the MySQL service, then restart this server.'
  };
  return hints[e.code] || e.message;
}

if (require.main === module) {
  app.listen(PORT, async () => {
    console.log(`Electricity Fault Reporting System running at http://localhost:${PORT}`);
    try {
      await pool.query('SELECT 1 FROM users LIMIT 1');
      console.log('Database connection OK');
      await ensureSchema();
    } catch (e) {
      console.error('\n*** DATABASE PROBLEM (' + (e.code || 'error') + ') ***');
      console.error(explainDbError(e) + '\n');
    }
  });

  // Check for overdue complaints every 30 minutes
  if (process.env.AUTO_ESCALATION !== 'false') {
    setInterval(() => {
      escalateOverdueComplaints().catch((e) => console.error('Auto-escalation failed:', e.message));
    }, 30 * 60 * 1000);
  }
}

module.exports = app;
