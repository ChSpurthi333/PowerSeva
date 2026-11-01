const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const pool = require('../config/db');
const { httpError, asyncHandler } = require('../middleware/errorMiddleware');
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

module.exports = { register, login, me, updateProfile, config, google };
