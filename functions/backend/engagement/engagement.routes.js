const express = require('express');
const { getGamification, addReferral } = require('./engagement.controller.js');
const router = express.Router();

router.get('/gamification', getGamification);
router.post('/referral', addReferral);

module.exports = router;
