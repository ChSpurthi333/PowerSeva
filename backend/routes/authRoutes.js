const router = require('express').Router();

// Small in-memory limiter for the password endpoints: 20 requests per 15 minutes per IP
const hits = new Map();
function rateLimit(req, res, next) {
  const now = Date.now();
  const rec = (hits.get(req.ip) || []).filter((t) => now - t < 15 * 60 * 1000);
  if (rec.length >= 20) return res.status(429).json({ message: 'Too many attempts. Please try again later.' });
  rec.push(now);
  hits.set(req.ip, rec);
  next();
}
const { register, login, me, updateProfile, config, google, forgotPassword, resetPassword, changePassword } = require('../controllers/authController');
const { authenticate } = require('../middleware/authMiddleware');

router.get('/config', config);
router.post('/register', register);
router.post('/login', login);
router.post('/google', google);
router.get('/me', authenticate, me);
router.put('/profile', authenticate, updateProfile);
router.post('/forgot-password', rateLimit, forgotPassword);
router.post('/reset-password', rateLimit, resetPassword);
router.put('/change-password', authenticate, rateLimit, changePassword);

module.exports = router;
