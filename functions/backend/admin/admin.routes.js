const express = require('express');
const { getUsers, getCourses, getTests, getAnalytics, uploadQuestions, seedSampleData } = require('./admin.controller.js');
const { requireAuth } = require('../middleware/auth.js');
const { requireAdmin } = require('../middleware/admin.js');
const { appConfig } = require('../lib/config.js');
const router = express.Router();

router.use(requireAuth, requireAdmin);

router.get('/users', getUsers);
router.get('/courses', getCourses);
router.get('/tests', getTests);
router.get('/analytics', getAnalytics);
router.post('/upload-questions', uploadQuestions);

if (appConfig.enableDevSeedRoutes) {
  router.post('/seed-sample-data', seedSampleData);
}

module.exports = router;
