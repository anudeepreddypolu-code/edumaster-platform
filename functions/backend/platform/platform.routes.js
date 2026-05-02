const express = require('express');
const controller = require('./platform.controller.js');
const { requireAuth, attachAuthIfPresent } = require('../middleware/auth.js');
const { appConfig } = require('../lib/config.js');

const router = express.Router();

router.get('/overview', attachAuthIfPresent, controller.getOverview);

if (appConfig.enableDevSeedRoutes) {
  router.post('/seed', controller.seedPlatform);
}

router.post('/enroll', requireAuth, controller.enroll);
router.post('/subscribe', requireAuth, controller.subscribe);
router.post('/watch-progress', requireAuth, controller.updateWatchProgress);
router.post('/ai/ask', requireAuth, controller.askAi);
router.post('/ai/generate-assessment', requireAuth, controller.generateAssessment);

module.exports = router;
