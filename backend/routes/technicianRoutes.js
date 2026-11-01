const router = require('express').Router();
const t = require('../controllers/technicianController');
const { authenticate } = require('../middleware/authMiddleware');
const { authorize } = require('../middleware/roleMiddleware');
const upload = require('../middleware/uploadMiddleware');

router.use(authenticate, authorize('technician'));

router.get('/stats', t.stats);
router.get('/feedback', t.feedback);
router.get('/assignments', t.assignments);
router.put('/assignments/:id/accept', t.accept);
router.post('/assignments/:id/update', t.postUpdate);
router.post('/assignments/:id/repair', upload.array('images', 5), t.submitRepair);

module.exports = router;
