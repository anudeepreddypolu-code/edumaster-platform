const express = require('express');
const { getNotifications, sendNotification } = require('./notifications.controller.js');
const router = express.Router();

router.get('/', getNotifications);
router.post('/send', sendNotification);

module.exports = router;
