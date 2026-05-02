// Admin Controller
const {
  usersRepository,
  coursesRepository,
  testsRepository,
  adminRepository,
} = require('../lib/repositories.js');

const getUsers = async (req, res) => {
  try {
    res.json(await usersRepository.listSafe());
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getCourses = async (req, res) => {
  try {
    res.json(await coursesRepository.list());
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getTests = async (req, res) => {
  try {
    res.json(await testsRepository.list());
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getAnalytics = async (req, res) => {
  try {
    res.json(await adminRepository.getPlatformAnalytics());
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const seedSampleData = async (req, res) => {
  try {
    const result = await adminRepository.seedSampleData();
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const uploadQuestions = async (req, res) => {
  try {
    const result = await adminRepository.uploadQuestions(req.body || {});
    res.json({
      message: 'Questions uploaded',
      ...result,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  getUsers,
  getCourses,
  getTests,
  getAnalytics,
  seedSampleData,
  uploadQuestions
};
