const router = require('express').Router();
const { register, login, me, updateProfile, config, google } = require('../controllers/authController');
const { authenticate } = require('../middleware/authMiddleware');

router.get('/config', config);
router.post('/register', register);
router.post('/login', login);
router.post('/google', google);
router.get('/me', authenticate, me);
router.put('/profile', authenticate, updateProfile);

module.exports = router;
