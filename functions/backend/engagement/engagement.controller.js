// Engagement Controller
const { engagementRepository } = require('../lib/repositories.js');

const getGamification = async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) {
      return res.status(400).json({ message: 'userId query param is required' });
    }

    res.json(await engagementRepository.getGamification(userId));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const addReferral = async (req, res) => {
  try {
    const { referrerUserId, referredEmail } = req.body || {};
    if (!referrerUserId || !referredEmail) {
      return res.status(400).json({ message: 'referrerUserId and referredEmail are required' });
    }

    const referral = await engagementRepository.addReferral({ referrerUserId, referredEmail });
    res.json({ message: 'Referral added', referral });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  getGamification,
  addReferral
};
