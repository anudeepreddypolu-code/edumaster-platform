const express = require('express');
const { getProfile, getProgress, getAnalytics } = require('./user.controller.js');
const { requireAuth } = require('../middleware/auth.js');
const router = express.Router();

router.get('/profile', requireAuth, getProfile);
router.get('/progress', requireAuth, getProgress);
router.get('/analytics', requireAuth, getAnalytics);

module.exports = router;
