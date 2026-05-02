// Quiz Controller
const { quizzesRepository } = require('../lib/repositories.js');

// Create daily quiz (admin)
exports.createQuiz = async (req, res) => {
  try {
    const { date, questions } = req.body;
    if (!date || !Array.isArray(questions)) {
      return res.status(400).json({ message: 'date and questions array are required' });
    }

    const quiz = await quizzesRepository.create({ date, questions });
    return res.status(201).json(quiz);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// Get today’s quiz
exports.getDailyQuiz = async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const quiz = await quizzesRepository.findByDate(today);
  if (!quiz) return res.status(404).json({ message: 'No quiz for today' });
  res.json({
    ...quiz,
    questions: (quiz.questions || []).map((question) => ({
      id: question.id,
      prompt: question.prompt,
      options: question.options,
      topic: question.topic,
    })),
  });
};

// Submit quiz attempt
exports.submitQuiz = async (req, res) => {
  const { quizId, answers } = req.body;
  if (!quizId || !Array.isArray(answers)) {
    return res.status(400).json({ message: 'quizId and answers array are required' });
  }

  const result = await quizzesRepository.submitAttempt({
    quizId,
    userId: req.user?.id,
    answers,
  });
  if (!result) {
    return res.status(404).json({ message: 'Quiz not found' });
  }

  res.json({
    score: result.score,
    total: result.total,
    review: result.review,
  });
};

// Get leaderboard
exports.getLeaderboard = async (req, res) => {
  const { quizId } = req.params;
  const leaderboard = await quizzesRepository.getLeaderboard(quizId);
  if (!leaderboard) return res.status(404).json({ message: 'Quiz not found' });
  res.json(leaderboard);
};
