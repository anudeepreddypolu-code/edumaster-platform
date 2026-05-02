// Analytics Controller
const { analyticsRepository } = require('../lib/repositories.js');

const getUserAnalytics = async (req, res) => {
  try {
    const requestedUserId = req.query.userId || null;
    const userId = req.user?.role === 'admin'
      ? requestedUserId || req.user?.id
      : req.user?.id || null;
    if (!userId) {
      return res.status(401).json({ message: 'Authorization required' });
    }

    const analytics = await analyticsRepository.getUserAnalytics(userId);
    res.json(analytics);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getLeaderboard = async (req, res) => {
  try {
    const leaderboard = await analyticsRepository.getLeaderboard();
    res.json(leaderboard);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  getUserAnalytics,
  getLeaderboard
};
