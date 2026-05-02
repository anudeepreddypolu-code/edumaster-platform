const mongoose = require('mongoose');
const TestSchema = new mongoose.Schema({
  title: { type: String, required: true, maxlength: 255 },
  description: { type: String },
  category: { type: String, default: 'SSC JE' },
  type: { type: String, default: 'full-length' },
  durationMinutes: { type: Number, default: 60 },
  totalMarks: { type: Number, default: 0 },
  negativeMarking: { type: Number, default: 0 },
  sectionBreakup: { type: [Object], default: [] },
  questions: { type: [Object], default: [] },
  course: { type: String },
  created_at: { type: Date, default: Date.now }
});
module.exports = mongoose.model('Test', TestSchema);
