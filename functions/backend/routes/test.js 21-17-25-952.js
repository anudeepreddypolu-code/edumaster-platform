import express from 'express';
import Test from '../models/Test.js';

const router = express.Router();

// Get all tests
router.get('/', async (req, res) => {
  const tests = await Test.find();
  res.json(tests);
});

// Create test
router.post('/', async (req, res) => {
  try {
    const test = await Test.create(req.body);
    res.status(201).json(test);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
