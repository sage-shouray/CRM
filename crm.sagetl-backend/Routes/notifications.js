const express = require('express');
const router = express.Router();
const { triggerNotification } = require('../controllers/notificationController');

// POST endpoint to trigger notifications for a lead
router.post('/trigger', triggerNotification);

module.exports = router;
