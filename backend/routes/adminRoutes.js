const router = require('express').Router();
const a = require('../controllers/adminController');
const { authenticate } = require('../middleware/authMiddleware');
const { authorize } = require('../middleware/roleMiddleware');

router.use(authenticate, authorize('admin'));

router.get('/stats', a.stats);
router.get('/reports', a.reports);

router.get('/complaints', a.listComplaints);
router.put('/complaints/:id/status', a.updateStatus);
router.get('/complaints/:id/suggestions', a.suggestions);
router.post('/complaints/:id/assign', a.assign);
router.post('/complaints/:id/auto-assign', a.autoAssignOne);
router.post('/auto-assign-all', a.autoAssignAll);

router.get('/technicians', a.technicians);

router.get('/users', a.listUsers);
router.post('/users', a.createUser);
router.put('/users/:id/active', a.setUserActive);
router.put('/users/:id/technician', a.updateTechnician);

router.post('/escalations/run', a.runEscalation);
router.get('/escalations', a.listEscalations);
router.put('/escalations/:id/resolve', a.resolveEscalation);

router.get('/hotspots', a.hotspotData);
router.get('/predictions', a.predictions);

router.get('/alerts', a.listAlerts);
router.post('/alerts', a.newAlert);
router.put('/alerts/:id/cancel', a.cancelAlert);

module.exports = router;
