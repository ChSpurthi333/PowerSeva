const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { httpError, asyncHandler } = require('./errorMiddleware');

// Verifies the Bearer token and loads the current user into req.user
const authenticate = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw httpError(401, 'Authentication required');

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (e) {
    throw httpError(401, 'Invalid or expired token');
  }

  const [rows] = await pool.query(
    'SELECT user_id, full_name, email, role, department_id, is_active FROM users WHERE user_id = ?',
    [payload.id]
  );
  if (!rows.length || !rows[0].is_active) {
    throw httpError(401, 'Account not found or deactivated');
  }
  req.user = {
    id: rows[0].user_id,
    name: rows[0].full_name,
    email: rows[0].email,
    role: rows[0].role,
    department_id: rows[0].department_id
  };
  next();
});

module.exports = { authenticate };
