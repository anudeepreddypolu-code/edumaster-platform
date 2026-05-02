const mongoose = require('mongoose');
const QuizSchema = new mongoose.Schema({
  date: { type: Date, required: true },
  questions: { type: [Object], default: [] },
  leaderboard: { type: [Object], default: [] },
  created_at: { type: Date, default: Date.now }
});
module.exports = mongoose.model('Quiz', QuizSchema);
