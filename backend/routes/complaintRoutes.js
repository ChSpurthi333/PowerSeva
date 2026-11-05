const router = require('express').Router();
const c = require('../controllers/complaintController');
const { authenticate } = require('../middleware/authMiddleware');
const { authorize } = require('../middleware/roleMiddleware');
const upload = require('../middleware/uploadMiddleware');

router.use(authenticate);

router.get('/fault-types', c.faultTypes);
router.get('/areas', c.areas);
router.get('/alerts', c.alerts);
router.get('/notifications', c.notifications);
router.post('/notifications/read', c.markNotificationsRead);
router.get('/track/:number', c.track);
router.get('/receipt/:number', c.receipt);

// Citizen-only actions
router.get('/my', authorize('citizen'), c.myComplaints);
router.post('/assess', authorize('citizen'), c.assessComplaint);
router.post('/duplicates', authorize('citizen'), c.duplicates);
router.post('/:id/support', authorize('citizen'), c.support);
router.post('/', authorize('citizen'), upload.array('images', 5), c.create);
router.post('/:id/confirm', authorize('citizen'), c.confirm);

module.exports = router;
