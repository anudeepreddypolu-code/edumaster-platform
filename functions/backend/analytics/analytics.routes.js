const express = require('express');
const { getUserAnalytics, getLeaderboard } = require('./analytics.controller.js');
const { attachAuthIfPresent } = require('../middleware/auth.js');
const router = express.Router();

router.get('/user', attachAuthIfPresent, getUserAnalytics);
router.get('/leaderboard', getLeaderboard);

module.exports = router;
