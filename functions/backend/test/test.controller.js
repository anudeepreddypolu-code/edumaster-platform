// Test Controller
const { testsRepository } = require('../lib/repositories.js');

const getTests = async (req, res) => {
  try {
    const tests = await testsRepository.listForAttempt();
    res.json(tests);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getTest = async (req, res) => {
  try {
    const test = await testsRepository.findAttemptById(req.params.id);
    if (!test) return res.status(404).json({ message: 'Test not found' });
    res.json(test);
  } catch (err) {
    res.status(400).json({ message: 'Invalid test id' });
  }
};

const createTest = async (req, res) => {
  try {
    if (!req.body?.title) {
      return res.status(400).json({ message: 'title is required' });
    }

    const test = await testsRepository.create({
      ...req.body,
      createdBy: req.user?.id || req.body?.createdBy || null,
    });
    res.status(201).json(test);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const submitTest = async (req, res) => {
  try {
    const { answers, startedAt } = req.body || {};
    if (!answers || typeof answers !== 'object') {
      return res.status(400).json({ message: 'answers object is required' });
    }

    const attempt = await testsRepository.submit(req.params.id, {
      userId: req.user?.id,
      answers,
      startedAt,
    });

    if (!attempt) {
      return res.status(404).json({ message: 'Test not found' });
    }

    return res.json(attempt);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = { getTests, getTest, createTest, submitTest };
