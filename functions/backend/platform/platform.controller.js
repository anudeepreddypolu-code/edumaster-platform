const { platformRepository } = require('../lib/repositories.js');
const { generateAssessmentDraft } = require('../lib/ai-content.js');
const {
  ApiError,
  asyncHandler,
  ok,
  created,
  requireString,
  optionalString,
  requireNumber,
  requireBoolean,
} = require('../lib/http.js');

const getOverview = asyncHandler(async (req, res) => {
  const requestedUserId = req.query.userId || null;
  const userId = req.user?.role === 'admin'
    ? requestedUserId || req.user?.id || null
    : req.user?.id || null;
  const overview = await platformRepository.getOverview(userId);
  return ok(res, overview);
});

const seedPlatform = asyncHandler(async (_req, res) => {
  const seedStatus = await platformRepository.ensureSeeded();
  return ok(res, { message: 'Platform data initialized', status: seedStatus || 'ok' });
});

const enroll = asyncHandler(async (req, res) => {
  const userId = req.user?.id || null;
  const courseId = requireString(req.body?.courseId, 'courseId');
  if (!userId) {
    throw new ApiError(401, 'Authorization token required', { code: 'AUTH_REQUIRED' });
  }

  const enrollment = await platformRepository.enroll({
    userId,
    courseId,
    source: optionalString(req.body?.source, 'direct-access', { maxLength: 80 }),
    accessType: optionalString(req.body?.accessType, 'course', { maxLength: 40 }),
  });

  return created(res, enrollment);
});

const subscribe = asyncHandler(async (req, res) => {
  const userId = req.user?.id || null;
  const planId = requireString(req.body?.planId, 'planId');
  if (!userId) {
    throw new ApiError(401, 'Authorization token required', { code: 'AUTH_REQUIRED' });
  }

  const subscription = await platformRepository.subscribe({
    userId,
    planId,
    source: optionalString(req.body?.source, 'payment', { maxLength: 80 }),
  });

  if (!subscription) {
    throw new ApiError(404, 'Subscription plan not found', { code: 'PLAN_NOT_FOUND' });
  }

  return created(res, subscription);
});

const updateWatchProgress = asyncHandler(async (req, res) => {
  const userId = req.user?.id || null;
  const courseId = requireString(req.body?.courseId, 'courseId');
  const lessonId = requireString(req.body?.lessonId, 'lessonId');
  if (!userId) {
    throw new ApiError(401, 'Authorization token required', { code: 'AUTH_REQUIRED' });
  }

  const watchRecord = await platformRepository.updateWatchProgress({
    userId,
    courseId,
    lessonId,
    progressPercent: requireNumber(req.body?.progressPercent ?? 0, 'progressPercent', { min: 0, max: 100 }),
    progressSeconds: requireNumber(req.body?.progressSeconds ?? 0, 'progressSeconds', { min: 0 }),
    completed: requireBoolean(req.body?.completed ?? false, 'completed'),
  });

  return ok(res, watchRecord);
});

const askAi = asyncHandler(async (req, res) => {
  const userId = req.user?.id || 'guest';
  const message = requireString(req.body?.message, 'message', { maxLength: 2000 });
  const aiResponse = await platformRepository.askAi({ userId, message });
  return ok(res, aiResponse);
});

const generateAssessment = asyncHandler(async (req, res) => {
  if (req.user?.role !== 'admin') {
    throw new ApiError(403, 'Admin access required', { code: 'ADMIN_REQUIRED' });
  }

  const generated = await generateAssessmentDraft(req.body || {});
  return ok(res, generated);
});

module.exports = {
  getOverview,
  seedPlatform,
  enroll,
  subscribe,
  updateWatchProgress,
  askAi,
  generateAssessment,
};
