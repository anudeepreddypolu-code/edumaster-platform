// User Controller
const { usersRepository, analyticsRepository } = require('../lib/repositories.js');

const getProfile = async (req, res) => {
  try {
    const user = await usersRepository.findSafeById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getProgress = async (req, res) => {
  try {
    const progress = await analyticsRepository.getProgress(req.user.id);
    res.json(progress);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getAnalytics = async (req, res) => {
  try {
    const analytics = await analyticsRepository.getUserAnalytics(req.user.id);
    res.json(analytics);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { getProfile, getProgress, getAnalytics };
