const express = require('express');
const controller = require('./quiz.controller');
const { requireAuth } = require('../middleware/auth.js');
const { requireAdmin } = require('../middleware/admin.js');
const router = express.Router();

// Admin: create daily quiz
router.post('/create', requireAuth, requireAdmin, controller.createQuiz);
// Get today’s quiz
router.get('/daily', controller.getDailyQuiz);
// Submit quiz
router.post('/submit', requireAuth, controller.submitQuiz);
// Get leaderboard
router.get('/:quizId/leaderboard', controller.getLeaderboard);

module.exports = router;
