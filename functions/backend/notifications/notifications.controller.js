// Notifications Controller
const { notificationsRepository } = require('../lib/repositories.js');

const getNotifications = async (req, res) => {
  try {
    const notifications = await notificationsRepository.list(req.query.userId);
    res.json(notifications);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const sendNotification = async (req, res) => {
  try {
    const {
      userId,
      title,
      message,
      type,
      entityId,
      actionUrl,
      actionLabel,
      payload,
    } = req.body || {};
    if (!userId) {
      return res.status(400).json({ message: 'userId is required' });
    }

    const notification = await notificationsRepository.create({
      userId,
      title,
      message,
      type,
      entityId,
      actionUrl,
      actionLabel,
      payload,
    });
    res.json({ message: 'Notification sent', notification });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  getNotifications,
  sendNotification
};
