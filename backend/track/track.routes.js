const express = require('express');
const { requireAuth } = require('../middleware/auth.js');
const { trackHeartbeat } = require('./track.controller.js');

const router = express.Router();

router.post('/', requireAuth, trackHeartbeat);

module.exports = router;
