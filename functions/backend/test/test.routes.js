const express = require('express');
const { getTests, getTest, createTest, submitTest } = require('./test.controller.js');
const { requireAuth } = require('../middleware/auth.js');
const { requireAdmin } = require('../middleware/admin.js');
const router = express.Router();

router.get('/', getTests);
router.get('/:id', getTest);
router.post('/:id/submit', requireAuth, submitTest);
router.post('/', requireAuth, requireAdmin, createTest);

module.exports = router;
