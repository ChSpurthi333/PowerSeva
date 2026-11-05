const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const pool = require('../config/db');
const { httpError, asyncHandler } = require('../middleware/errorMiddleware');
const { sendMail } = require('../services/mailService');
const { GMAIL_RE, PHONE_RE, GMAIL_MESSAGE } = require('../utils/validators');

function signToken(user) {
  return jwt.sign({ id: user.user_id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '8h'
  });
}

function publicUser(u) {
  return {
    id: u.user_id, name: u.full_name, email: u.email, phone: u.phone, role: u.role, address: u.address,
    area: u.area || null,
    latitude: u.latitude === null || u.latitude === undefined ? null : Number(u.latitude),
    longitude: u.longitude === null || u.longitude === undefined ? null : Number(u.longitude),
    is_available: u.is_available === undefined ? true : !!u.is_available
  };
}

// Public registration always creates a citizen account, and only Gmail addresses are accepted
const register = asyncHandler(async (req, res) => {
  const { full_name, email, phone, password, address, area } = req.body;
  if (!full_name || !email || !phone || !password) {
    throw httpError(400, 'Name, email, phone and password are required');
  }
  if (!GMAIL_RE.test(email.trim())) throw httpError(400, GMAIL_MESSAGE);
  if (!PHONE_RE.test(phone)) throw httpError(400, 'Enter a valid phone number');
  if (password.length < 6) throw httpError(400, 'Password must be at least 6 characters');

  const hash = await bcrypt.hash(password, 10);
  const [result] = await pool.query(
    `INSERT INTO users (full_name, email, phone, password_hash, role, address, area)
     VALUES (?, ?, ?, ?, 'citizen', ?, ?)`,
    [full_name.trim(), email.trim().toLowerCase(), phone.trim(), hash, address || null, (area || '').trim().slice(0, 100) || null]
  );
  res.status(201).json({ message: 'Registration successful', user_id: result.insertId });
});

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) throw httpError(400, 'Email and password are required');
  if (!GMAIL_RE.test(email.trim())) throw httpError(400, GMAIL_MESSAGE);

  const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email.trim().toLowerCase()]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw httpError(401, 'Invalid email or password');
  }
  if (!user.is_active) throw httpError(403, 'This account has been deactivated');

  res.json({ token: signToken(user), user: publicUser(user) });
});

const me = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM users WHERE user_id = ?', [req.user.id]);
  res.json({ user: publicUser(rows[0]) });
});

// "My profile": phone, village / area and map position (used for outage alerts); technicians also set availability
const updateProfile = asyncHandler(async (req, res) => {
  const { phone, area, latitude, longitude, is_available } = req.body;
  if (phone !== undefined && phone !== '' && phone !== null && !PHONE_RE.test(String(phone))) {
    throw httpError(400, 'Enter a valid phone number');
  }
  const lat = latitude === undefined || latitude === null || latitude === '' ? null : Number(latitude);
  const lng = longitude === undefined || longitude === null || longitude === '' ? null : Number(longitude);
  if ((lat !== null && (Number.isNaN(lat) || lat < -90 || lat > 90)) || (lng !== null && (Number.isNaN(lng) || lng < -180 || lng > 180))) {
    throw httpError(400, 'Invalid map position');
  }

  const sets = ['area = ?', 'latitude = ?', 'longitude = ?'];
  const params = [(area || '').trim().slice(0, 100) || null, lat, lng];
  if (phone) { sets.push('phone = ?'); params.push(String(phone).trim()); }
  if (req.user.role === 'technician' && is_available !== undefined) {
    sets.push('is_available = ?');
    params.push(is_available === false || is_available === 0 || is_available === '0' || is_available === 'false' ? 0 : 1);
  }
  params.push(req.user.id);
  await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE user_id = ?`, params);

  const [rows] = await pool.query('SELECT * FROM users WHERE user_id = ?', [req.user.id]);
  res.json({ message: 'Profile saved', user: publicUser(rows[0]) });
});

// Tells the browser whether "Continue with Google" is configured
const config = (req, res) => {
  res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || null });
};

let googleClient = null;

// "Continue with Google": verifies the Google ID token, then signs the citizen in
// (creating the citizen account the first time). Admins and technicians keep using a password.
const google = asyncHandler(async (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw httpError(503, 'Google sign-in is not set up on this server');
  const { credential } = req.body;
  if (!credential) throw httpError(400, 'Missing Google credential');

  let payload;
  try {
    googleClient = googleClient || new OAuth2Client(clientId);
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: clientId });
    payload = ticket.getPayload();
  } catch (e) {
    throw httpError(401, 'Google sign-in failed. Please try again');
  }
  if (!payload || !payload.email || !payload.email_verified) {
    throw httpError(401, 'Your Google email is not verified');
  }
  const email = payload.email.toLowerCase();
  if (!GMAIL_RE.test(email)) throw httpError(400, 'Only Gmail accounts can be used');

  let [rows] = await pool.query('SELECT * FROM users WHERE google_id = ?', [payload.sub]);
  if (!rows.length) [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);

  let user = rows[0];
  if (user) {
    if (!user.is_active) throw httpError(403, 'This account has been deactivated');
    if (user.role !== 'citizen') {
      throw httpError(403, 'Admin and technician accounts must sign in with email and password');
    }
    if (!user.google_id) {
      await pool.query('UPDATE users SET google_id = ? WHERE user_id = ?', [payload.sub, user.user_id]);
    }
  } else {
    // Random password: this account can only be entered through Google
    const hash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10);
    const name = (payload.name || email.split('@')[0]).slice(0, 120);
    const [result] = await pool.query(
      `INSERT INTO users (full_name, email, phone, password_hash, role, google_id)
       VALUES (?, ?, NULL, ?, 'citizen', ?)`,
      [name, email, hash, payload.sub]
    );
    [rows] = await pool.query('SELECT * FROM users WHERE user_id = ?', [result.insertId]);
    user = rows[0];
  }

  res.json({ token: signToken(user), user: publicUser(user) });
});

const RESET_MINUTES = 30;
const hashToken = (tok) => crypto.createHash('sha256').update(tok).digest('hex');

// Forgot password, step 1: the user enters their Gmail. The reply is always the same, so the form cannot be
// used to find out which emails are registered.
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email || !GMAIL_RE.test(String(email).trim())) throw httpError(400, GMAIL_MESSAGE);
  const addr = String(email).trim().toLowerCase();

  const [rows] = await pool.query('SELECT user_id, full_name, is_active FROM users WHERE email = ?', [addr]);
  const user = rows[0];
  if (user && user.is_active) {
    const token = crypto.randomBytes(32).toString('hex');
    await pool.query('DELETE FROM password_resets WHERE user_id = ? OR expires_at < NOW()', [user.user_id]);
    await pool.query(
      'INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))',
      [user.user_id, hashToken(token), RESET_MINUTES]
    );
    const base = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    const link = `${base}/reset-password.html?token=${token}`;
    try {
      await sendMail({
        to: addr,
        subject: 'PowerSeva - reset your password',
        text: `Hello ${user.full_name},\n\nUse this link to choose a new password (valid for ${RESET_MINUTES} minutes):\n${link}\n\nIf you did not ask for this, you can ignore this email - your password will not change.`
      });
    } catch (e) {
      console.error('Could not send reset email:', e.message);
    }
  }
  res.json({ message: 'If this email is registered, a password reset link has been sent. It is valid for 30 minutes.' });
});

// Forgot password, step 2: the user opens the emailed link and sets a new password
const resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.body;
  if (!token || typeof token !== 'string') throw httpError(400, 'This reset link is invalid or has expired');
  if (!password || password.length < 6) throw httpError(400, 'Password must be at least 6 characters');

  const [rows] = await pool.query(
    'SELECT reset_id, user_id FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()',
    [hashToken(token)]
  );
  if (!rows.length) throw httpError(400, 'This reset link is invalid or has expired');

  const hash = await bcrypt.hash(password, 10);
  await pool.query('UPDATE users SET password_hash = ? WHERE user_id = ?', [hash, rows[0].user_id]);
  await pool.query('DELETE FROM password_resets WHERE user_id = ?', [rows[0].user_id]);
  res.json({ message: 'Password updated. You can now log in.' });
});

// Logged-in users change their own password (profile page)
const changePassword = asyncHandler(async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) throw httpError(400, 'Enter your current and new password');
  if (new_password.length < 6) throw httpError(400, 'Password must be at least 6 characters');
  const [rows] = await pool.query('SELECT password_hash FROM users WHERE user_id = ?', [req.user.id]);
  if (!rows.length || !(await bcrypt.compare(current_password, rows[0].password_hash))) {
    throw httpError(400, 'Current password is incorrect');
  }
  if (current_password === new_password) throw httpError(400, 'The new password must be different from the current one');
  await pool.query('UPDATE users SET password_hash = ? WHERE user_id = ?', [await bcrypt.hash(new_password, 10), req.user.id]);
  res.json({ message: 'Password changed' });
});

module.exports = { register, login, me, updateProfile, config, google, forgotPassword, resetPassword, changePassword };
