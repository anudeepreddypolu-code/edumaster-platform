const express = require('express');
const { getTests, getTest, createTest, updateTest, deleteTest, submitTest } = require('./test.controller.js');
const { requireAuth } = require('../middleware/auth.js');
const { requireAdmin } = require('../middleware/admin.js');
const router = express.Router();

router.get('/', getTests);
router.get('/:id', getTest);
router.post('/:id/submit', requireAuth, submitTest);
router.post('/', requireAuth, requireAdmin, createTest);
router.put('/:id', requireAuth, requireAdmin, updateTest);
router.delete('/:id', requireAuth, requireAdmin, deleteTest);

module.exports = router;
