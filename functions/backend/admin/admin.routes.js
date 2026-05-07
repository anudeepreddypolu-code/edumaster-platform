const express = require('express');
const { getUsers, getCourses, getTests, getAnalytics, uploadQuestions } = require('./admin.controller.js');
const { requireAuth } = require('../middleware/auth.js');
const { requireAdmin } = require('../middleware/admin.js');
const router = express.Router();

router.use(requireAuth, requireAdmin);

router.get('/users', getUsers);
router.get('/courses', getCourses);
router.get('/tests', getTests);
router.get('/analytics', getAnalytics);
router.post('/upload-questions', uploadQuestions);

module.exports = router;
