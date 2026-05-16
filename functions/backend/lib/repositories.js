const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');
const User = require('../models/User.js');
const Course = require('../models/Course.js');
const Test = require('../models/Test.js');
const { ApiError } = require('./http.js');
const { getDatabaseMode } = require('./database.js');
const { initializePostgres, isPostgresReady, queryPostgres, runInTransaction } = require('./postgres.js');
const {
  getRedisValue,
  setRedisValue,
  deleteRedisKey,
  getRedisJson,
  setRedisJson,
} = require('./redis.js');
const { state, clone, nextId, nowIso } = require('./store.js');
const { decryptVideoId, normalizeYouTubeVideoId, buildSecureYouTubeEmbedUrl } = require('./video-security.js');
const { issuePlaybackToken } = require('./private-video.js');
const { appConfig } = require('./config.js');
const { getAiGenerationProviders } = require('./ai-content.js');

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();
const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const asArray = (value) => (Array.isArray(value) ? clone(value) : []);
const asObject = (value) => (value && typeof value === 'object' ? clone(value) : {});
const createPersistentId = (prefix) => `${prefix}_${randomUUID().replace(/-/g, '')}`;
const createId = (prefix) => (isPostgresReady() ? createPersistentId(prefix) : nextId(prefix));
const cacheKey = (name, suffix) => `edumaster:${name}:${suffix}`;
const courseDefaultValidityDays = Math.max(1, Number(appConfig.courseDefaultValidityDays || 183));
const replayRetentionDays = Math.max(1, Number(appConfig.videoReplayRetentionDays || 183));
const replayViewLimitEnabled = Boolean(appConfig.videoReplayViewLimitEnabled);
const replayMaxViews = Math.max(0, Number(appConfig.videoReplayMaxViews || 0));
const replayRetentionMs = replayRetentionDays * 24 * 60 * 60 * 1000;
const liveReplayRetentionDays = replayRetentionDays;
const liveReplayMaxViews = replayMaxViews;
const liveReplayRetentionMs = liveReplayRetentionDays * 24 * 60 * 60 * 1000;
const activeEnrollmentSql = '(expires_at IS NULL OR expires_at > now())';
const addDaysIso = (days, baseMs = Date.now()) => new Date(baseMs + Math.max(1, Number(days || courseDefaultValidityDays)) * 24 * 60 * 60 * 1000).toISOString();
const isEnrollmentActive = (enrollment) => {
  if (!enrollment) {
    return false;
  }

  if (!enrollment.expiresAt) {
    return true;
  }

  const expiresAt = Date.parse(enrollment.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
};
const filterActiveEnrollments = (enrollments) => (enrollments || []).filter(isEnrollmentActive);
const hasReplayViewLimit = () => replayViewLimitEnabled && replayMaxViews > 0;
const toIso = (value) => {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value.toISOString === 'function') {
    return value.toISOString();
  }

  return String(value);
};

const isMongoMode = () => getDatabaseMode() === 'mongodb';
const isPostgresMode = () => isPostgresReady();
const getDefaultLivePlaybackType = () => 'jitsi';
const getEffectiveLivePlaybackType = (liveClass) => {
  const explicitType = String(liveClass?.livePlaybackType || '').trim().toLowerCase();

  if (!explicitType) {
    return getDefaultLivePlaybackType();
  }

  return explicitType;
};

const getReplayExpiresAtIso = (baseMs = Date.now()) => new Date(baseMs + replayRetentionMs).toISOString();
const getLiveReplayExpiresAtIso = (baseMs = Date.now()) => new Date(baseMs + liveReplayRetentionMs).toISOString();
const isReplayGrantExpired = (grant) => {
  if (!grant?.expiresAt) {
    return true;
  }

  const expiresAt = Date.parse(grant.expiresAt);
  return !Number.isFinite(expiresAt) || expiresAt <= Date.now();
};

const isLiveReplayGrantExpired = (grant) => isReplayGrantExpired(grant);

const ensurePersistentDatabaseAvailability = async () => {
  if (appConfig.postgresUrl && !isPostgresReady()) {
    await initializePostgres();
  }

  if (isPostgresMode() || isMongoMode()) {
    return;
  }

  if (!appConfig.allowMemoryFallback && (appConfig.postgresUrl || appConfig.mongoUri)) {
    throw new ApiError(
      503,
      'Persistent database is unavailable. Start Postgres or MongoDB to use saved admin content.',
      { code: 'PERSISTENT_DATABASE_UNAVAILABLE' },
    );
  }
};

const sanitizeUser = (user) => {
  if (!user) {
    return null;
  }

  const plainUser = typeof user.toObject === 'function' ? user.toObject() : clone(user);
  const { password, ...safeUser } = plainUser;
  return safeUser;
};

const pushIfMissing = (collection, item, idField = '_id') => {
  if (!collection.some((entry) => entry[idField] === item[idField])) {
    collection.push(clone(item));
  }
};

const ensureDefaultAdminUser = async () => {
  const email = normalizeEmail(appConfig.adminEmail);
  const name = String(appConfig.adminName || 'Platform Admin').trim() || 'Platform Admin';
  const password = String(appConfig.adminPassword || '');
  if (!email || !password) {
    return null;
  }
  const passwordHash = await bcrypt.hash(password, 10);

  if (isPostgresMode()) {
    const existing = await pgOne('SELECT * FROM users WHERE email = $1', [email], mapUserRow);
    if (existing) {
      return upsertPgUser({
        ...existing,
        name,
        email,
        password: passwordHash,
        role: 'admin',
        updated_at: nowIso(),
      });
    }

    return upsertPgUser({
      name,
      email,
        password: passwordHash,
        role: 'admin',
        device: null,
        session: null,
        badges: [],
        streak: 0,
        points: 0,
        referral_code: null,
        created_at: nowIso(),
        updated_at: nowIso(),
      });
  }

  if (isMongoMode()) {
    const existing = await User.findOne({ email });
    if (existing) {
      existing.name = name;
      existing.role = 'admin';
      existing.password = passwordHash;
      await existing.save();
      return existing.toObject();
    }

    const createdUser = await User.create({
      name,
      email,
      password: passwordHash,
      role: 'admin',
    });
    return createdUser.toObject();
  }

  const existing = state.users.find((user) => user.email === email) || null;
  if (existing) {
    existing.name = name;
    existing.role = 'admin';
    existing.password = passwordHash;
    existing.updated_at = nowIso();
    return clone(existing);
  }

  const createdUser = {
    _id: nextId('user'),
    name,
    email,
    password: passwordHash,
    role: 'admin',
    device: null,
    session: null,
    streak: 0,
    points: 0,
    badges: [],
    referral_code: null,
    created_at: nowIso(),
    updated_at: nowIso(),
  };

  state.users.push(createdUser);
  return clone(createdUser);
};

const getModuleLessons = (module) => Array.isArray(module?.lessons) ? module.lessons : [];
const getModuleChapters = (module) => Array.isArray(module?.chapters) ? module.chapters : [];
const getChapterLessons = (chapter) => Array.isArray(chapter?.lessons) ? chapter.lessons : [];

const lessonListFromCourse = (course) =>
  (course.modules || []).flatMap((module) => ([
    ...getModuleLessons(module).map((lesson) => ({
      ...clone(lesson),
      moduleId: module.id,
      moduleTitle: module.title,
      chapterId: null,
      chapterTitle: null,
      courseId: course._id,
    })),
    ...getModuleChapters(module).flatMap((chapter) =>
      getChapterLessons(chapter).map((lesson) => ({
        ...clone(lesson),
        moduleId: module.id,
        moduleTitle: module.title,
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        courseId: course._id,
      }))),
  ]));

const lessonProgressMapForCourse = (data, userId, courseId) =>
  new Map(
    data.watchHistory
      .filter((entry) => entry.userId === String(userId) && entry.courseId === String(courseId))
      .map((entry) => [entry.lessonId, entry]),
  );

const isLessonSequentiallyUnlocked = (course, userId, lessonId, data) => {
  const lessons = lessonListFromCourse(course);
  const lessonIndex = lessons.findIndex((lesson) => lesson.id === String(lessonId));

  if (lessonIndex <= 0) {
    return true;
  }

  const progressMap = lessonProgressMapForCourse(data, userId, course._id);
  const currentProgress = progressMap.get(String(lessonId));
  if (currentProgress?.completed) {
    return true;
  }

  const previousLesson = lessons[lessonIndex - 1];
  const previousProgress = progressMap.get(previousLesson.id);
  return Boolean(previousProgress?.completed || Number(previousProgress?.progressPercent || 0) >= 90);
};

const sanitizeLessonForViewer = (lesson, hasFullAccess) => {
  const isLocked = Boolean(lesson.premium) && !hasFullAccess;
  const isProtectedYoutube = lesson.type === 'youtube';
  const isPrivateVideo = lesson.type === 'private-video';

  return {
    ...clone(lesson),
    videoUrl: isLocked || isProtectedYoutube || isPrivateVideo ? null : lesson.videoUrl,
    youtubeVideoIdCiphertext: undefined,
    storagePath: undefined,
    storageProvider: undefined,
    hlsManifestPath: undefined,
    hlsPlaybackPath: undefined,
    locked: isLocked,
    requiresSecurePlayback: isProtectedYoutube || isPrivateVideo,
  };
};

const deriveLiveClassStatus = (liveClass) => {
  const explicitStatus = String(liveClass?.status || '').trim().toLowerCase();
  if (['live', 'ended', 'cancelled'].includes(explicitStatus)) {
    return explicitStatus;
  }

  const startTime = Date.parse(String(liveClass?.startTime || ''));
  const durationMinutes = Math.max(Number(liveClass?.durationMinutes || 0), 0);
  const endTime = Number.isFinite(startTime)
    ? startTime + (durationMinutes * 60 * 1000)
    : Number.NaN;
  const now = Date.now();

  if (Number.isFinite(startTime) && now < startTime) {
    return 'scheduled';
  }

  if (Number.isFinite(endTime) && now <= endTime) {
    return 'live';
  }

  return explicitStatus || 'ended';
};

const sanitizeLiveClassForViewer = (liveClass) => {
  const status = deriveLiveClassStatus(liveClass);
  const effectivePlaybackType = getEffectiveLivePlaybackType(liveClass);
  const recordingExpired = Boolean(
    liveClass?.recordingExpiresAt
    && Number.isFinite(Date.parse(liveClass.recordingExpiresAt))
    && Date.parse(liveClass.recordingExpiresAt) <= Date.now(),
  );
  const replayReady = Boolean(
    liveClass?.replayAvailable
    && !recordingExpired
    && (liveClass?.recordingUrl || liveClass?.recordingStoragePath || (liveClass?.replayCourseId && liveClass?.replayLessonId)),
  );

  return {
    ...clone(liveClass),
    status,
    livePlaybackType: effectivePlaybackType,
    livePlaybackUrl: undefined,
    embedUrl: undefined,
    roomUrl: undefined,
    recordingUrl: undefined,
    recordingStorageProvider: undefined,
    recordingStoragePath: undefined,
    recordingPublishedAt: undefined,
    recordingExpiresAt: undefined,
    recordingDurationMinutes: undefined,
    replayCourseId: undefined,
    replayLessonId: undefined,
    joinEnabled: status === 'live' && Boolean(
      liveClass?.livePlaybackUrl
      || liveClass?.embedUrl
      || liveClass?.roomUrl
    ),
    replayReady,
  };
};

const findLessonInCourse = (course, lessonId) =>
  lessonListFromCourse(course).find((lesson) => lesson.id === String(lessonId)) || null;

const updateLessonInModules = (modules, lessonId, updater) => {
  let updatedLesson = null;
  const nextModules = (modules || []).map((module) => {
    const nextModule = clone(module);

    if (Array.isArray(nextModule.lessons)) {
      nextModule.lessons = nextModule.lessons.map((lesson) => {
        if (lesson.id !== String(lessonId)) {
          return lesson;
        }
        updatedLesson = updater(clone(lesson));
        return updatedLesson;
      });
    }

    if (Array.isArray(nextModule.chapters)) {
      nextModule.chapters = nextModule.chapters.map((chapter) => {
        const nextChapter = clone(chapter);
        if (Array.isArray(nextChapter.lessons)) {
          nextChapter.lessons = nextChapter.lessons.map((lesson) => {
            if (lesson.id !== String(lessonId)) {
              return lesson;
            }
            updatedLesson = updater(clone(lesson));
            return updatedLesson;
          });
        }
        return nextChapter;
      });
    }

    return nextModule;
  });

  return { modules: nextModules, updatedLesson };
};

const redactCourseForViewer = (course, hasFullAccess) => ({
  ...clone(course),
  modules: (course.modules || []).map((module) => ({
    ...clone(module),
    lessons: getModuleLessons(module).map((lesson) => ({
      ...sanitizeLessonForViewer(lesson, hasFullAccess),
      notesUrl: Boolean(lesson.premium) && !hasFullAccess ? null : lesson.notesUrl,
    })),
    chapters: getModuleChapters(module).map((chapter) => ({
      ...clone(chapter),
      lessons: getChapterLessons(chapter).map((lesson) => ({
        ...sanitizeLessonForViewer(lesson, hasFullAccess),
        notesUrl: Boolean(lesson.premium) && !hasFullAccess ? null : lesson.notesUrl,
      })),
    })),
  })),
});

const redactQuizForAttempt = (quiz) => ({
  ...clone(quiz),
  questions: (quiz.questions || []).map((question) => ({
    id: question.id,
    prompt: question.prompt,
    options: clone(question.options || []),
    topic: question.topic || 'General Practice',
  })),
});

const redactTestForAttempt = (test) => ({
  ...clone(test),
  questions: (test.questions || []).map((question) => ({
    id: question.id,
    questionText: question.questionText,
    options: clone(question.options || []),
    marks: Number(question.marks || 1),
    topic: question.topic || 'General Practice',
  })),
});

const sortRecentFirst = (left, right, field) => new Date(right[field] || 0) - new Date(left[field] || 0);
const sortOldestFirst = (left, right, field) => new Date(left[field] || 0) - new Date(right[field] || 0);
const sortNewestFirst = (left, right, field) => new Date(right[field] || 0) - new Date(left[field] || 0);

const computeCourseProgress = (data, userId, course) => {
  const lessons = lessonListFromCourse(course);
  if (lessons.length === 0) {
    return { progressPercent: 0, continueLesson: null, continueProgressSeconds: 0, watchHistory: [] };
  }

  const history = data.watchHistory
    .filter((entry) => entry.userId === String(userId) && entry.courseId === course._id)
    .sort((left, right) => sortRecentFirst(left, right, 'updatedAt'));

  const progressPercent = Math.round(
    history.reduce((sum, item) => sum + Number(item.progressPercent || 0), 0) / Math.max(lessons.length, 1),
  );

  const continueItem = history[0] || null;
  const continueLesson = continueItem
    ? lessons.find((lesson) => lesson.id === continueItem.lessonId) || null
    : lessons[0] || null;

  return {
    progressPercent,
    continueLesson,
    continueProgressSeconds: Number(continueItem?.progressSeconds || 0),
    watchHistory: clone(history),
  };
};

const computeQuizInsights = (data, userId) => {
  const entries = data.quizzes.flatMap((quiz) =>
    (quiz.leaderboard || [])
      .filter((entry) => entry.userId === String(userId))
      .map((entry) => ({
        quizId: quiz._id,
        date: quiz.date,
        ...clone(entry),
      })),
  );

  const totalQuestions = entries.reduce((sum, entry) => sum + Number(entry.total || 0), 0);
  const totalCorrect = entries.reduce((sum, entry) => sum + Number(entry.score || 0), 0);

  return {
    attempts: entries.length,
    totalQuestions,
    totalCorrect,
    accuracy: totalQuestions === 0 ? 0 : Number(((totalCorrect / totalQuestions) * 100).toFixed(2)),
  };
};

const computeTestInsights = (data, userId) => {
  const attempts = data.testAttempts
    .filter((attempt) => attempt.userId === String(userId))
    .sort((left, right) => sortRecentFirst(left, right, 'completedAt'));

  const latestAttempt = attempts[0] || null;
  const averageScore = attempts.length === 0
    ? 0
    : Number((attempts.reduce((sum, attempt) => sum + Number(attempt.score || 0), 0) / attempts.length).toFixed(2));

  const totalMarks = attempts.reduce((sum, attempt) => sum + Number(attempt.totalMarks || 0), 0);
  const obtainedMarks = attempts.reduce((sum, attempt) => sum + Number(attempt.score || 0), 0);

  return {
    attempts,
    latestAttempt,
    averageScore,
    accuracy: totalMarks === 0 ? 0 : Number(((obtainedMarks / totalMarks) * 100).toFixed(2)),
  };
};

const computeAdaptivePlan = ({ accuracy, attempts }) => {
  if (attempts === 0) {
    return {
      nextTestType: 'topic-wise',
      difficulty: 'foundation',
      reason: 'Start with topic-wise fundamentals before graduating to sectional and full mocks.',
    };
  }

  if (accuracy < 60) {
    return {
      nextTestType: 'topic-wise',
      difficulty: 'easy',
      reason: 'Accuracy is still unstable, so adaptive flow recommends another topic-wise test.',
    };
  }

  if (accuracy < 80) {
    return {
      nextTestType: 'sectional',
      difficulty: 'medium',
      reason: 'You are ready for sectional pressure before the next full-length mock.',
    };
  }

  return {
    nextTestType: 'full-length',
    difficulty: 'hard',
    reason: 'Strong accuracy trend detected. Move to exam-mode full mocks to improve percentile.',
  };
};

const buildAnalyticsTrend = (data, userId) => {
  const testPoints = data.testAttempts
    .filter((attempt) => attempt.userId === String(userId))
    .slice(-4)
    .map((attempt, index) => ({
      label: `Mock ${index + 1}`,
      score: Number(attempt.score || 0),
      accuracy: attempt.totalMarks
        ? Number((((Number(attempt.score || 0) / Number(attempt.totalMarks || 1)) * 100)).toFixed(2))
        : 0,
    }));

  const quizPoints = data.quizzes
    .flatMap((quiz) =>
      (quiz.leaderboard || [])
        .filter((entry) => entry.userId === String(userId))
        .map((entry) => ({
          label: `Quiz ${quiz.date.slice(5)}`,
          score: Number(entry.score || 0),
          accuracy: entry.total ? Number((((entry.score / entry.total) * 100)).toFixed(2)) : 0,
        })),
    )
    .slice(-4);

  return [...testPoints, ...quizPoints];
};

const buildAiRecommendation = (analytics) => {
  const weakTopic = (analytics.weakTopics || [])[0];
  if (weakTopic) {
    return `Focus more on ${weakTopic}. Use revision before attempting the next test.`;
  }

  if (analytics.attempts > 0 && analytics.accuracy < 70) {
    return 'Your concept retention is improving. Spend the next revision block on weak topics before attempting another full test.';
  }

  if (analytics.attempts > 0) {
    return 'You are on a strong trend. Keep alternating full mocks with topic-wise revision to protect your percentile.';
  }

  return '';
};

const normalizeQuizLeaderboard = (entries) =>
  clone(entries || []).sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    return sortOldestFirst(left, right, 'submittedAt');
  });

const redisJsonTtl = 60;

const mapUserRow = (row) => {
  if (!row) {
    return null;
  }

  return {
    _id: row.id,
    name: row.full_name,
    email: row.email,
    password: row.password_hash,
    role: row.role,
    device: row.device || null,
    session: row.active_session_id || null,
    streak: Number(row.streak_days || 0),
    points: Number(row.reward_points || 0),
    badges: asArray(row.badges),
    referral_code: row.referral_code || null,
    created_at: toIso(row.created_at) || nowIso(),
    updated_at: toIso(row.updated_at) || nowIso(),
  };
};

const mapCourseRow = (row) => {
  if (!row) {
    return null;
  }

  return {
    _id: row.id,
    title: row.title,
    description: row.description || '',
    category: row.category || 'SSC JE',
    exam: row.exam || row.category || 'SSC JE',
    subject: row.subject || 'General',
    level: row.level || 'Full Course',
    price: toNumber(row.price_inr),
    validityDays: Number(row.validity_days || 365),
    thumbnailUrl: row.thumbnail_url || null,
    instructor: row.instructor_name || 'VARONENGLISH Faculty',
    officialChannelUrl: row.official_channel_url || null,
    modules: asArray(row.modules),
    createdBy: row.created_by || null,
    created_at: toIso(row.created_at) || nowIso(),
  };
};

const mapTestRow = (row) => {
  if (!row) {
    return null;
  }

  return {
    _id: row.id,
    title: row.title,
    description: row.description || '',
    category: row.category || 'SSC JE',
    type: row.test_type || 'full-length',
    durationMinutes: Number(row.duration_minutes || 60),
    totalMarks: toNumber(row.total_marks),
    negativeMarking: toNumber(row.negative_marking),
    course: row.course_id || null,
    sectionBreakup: asArray(row.section_breakup),
    questions: asArray(row.questions),
    created_at: toIso(row.created_at) || nowIso(),
  };
};

const mapTestAttemptRow = (row) => {
  if (!row) {
    return null;
  }

  return {
    _id: row.id,
    userId: row.user_id,
    testId: row.test_id,
    score: toNumber(row.score),
    totalMarks: toNumber(row.total_marks),
    correctCount: Number(row.correct_count || 0),
    incorrectCount: Number(row.incorrect_count || 0),
    unattemptedCount: Number(row.unattempted_count || 0),
    percentile: toNumber(row.percentile),
    rank: Number(row.all_india_rank || 0),
    answers: asObject(row.answers),
    weakTopics: asArray(row.weak_topics),
    strongTopics: asArray(row.strong_topics),
    solutions: asArray(row.solutions),
    startedAt: toIso(row.started_at) || nowIso(),
    completedAt: toIso(row.completed_at) || nowIso(),
  };
};

const mapQuizRow = (row) => ({
  _id: row.id,
  date: typeof row.quiz_date === 'string' ? row.quiz_date.slice(0, 10) : toIso(row.quiz_date).slice(0, 10),
  title: row.title || 'Daily Quiz',
  questions: asArray(row.questions),
  createdAt: toIso(row.created_at) || nowIso(),
});

const mapQuizAttemptRow = (row) => ({
  _id: row.id,
  quizId: row.daily_quiz_id,
  userId: row.user_id,
  score: Number(row.score || 0),
  total: Number(row.total || 0),
  submittedAt: toIso(row.submitted_at) || nowIso(),
  name: row.full_name || undefined,
});

const mapLiveClassRow = (row) => ({
  _id: row.id,
  linkageType: row.linkage_type || 'standalone',
  courseId: row.course_id || null,
  moduleId: row.module_id || null,
  moduleTitle: row.module_title || null,
  chapterId: row.chapter_id || null,
  chapterTitle: row.chapter_title || null,
  mockTestId: row.mock_test_id || null,
  mockTestTitle: row.mock_test_title || null,
  title: row.title,
  instructor: row.instructor_name || 'VARONENGLISH Faculty',
  startTime: toIso(row.scheduled_start_at) || nowIso(),
  durationMinutes: Number(row.duration_minutes || 60),
  provider: row.provider || 'Jitsi Meet',
  mode: row.mode || 'live',
  status: row.status || 'scheduled',
  livePlaybackUrl: row.live_playback_url || null,
  livePlaybackType: row.live_playback_type || getDefaultLivePlaybackType(),
  embedUrl: row.embed_url || null,
  roomUrl: row.room_url || null,
  recordingUrl: row.recording_url || null,
  replayCourseId: row.replay_course_id || null,
  replayLessonId: row.replay_lesson_id || null,
  chatEnabled: Boolean(row.chat_enabled),
  doubtSolving: Boolean(row.doubt_solving),
  replayAvailable: Boolean(row.replay_available),
  attendees: Number(row.attendee_count || 0),
  maxAttendees: Number(row.max_attendees || 2500),
  requiresEnrollment: row.requires_enrollment !== false,
  recordingStorageProvider: row.recording_storage_provider || null,
  recordingStoragePath: row.recording_storage_path || null,
  recordingPublishedAt: toIso(row.recording_published_at),
  recordingExpiresAt: toIso(row.recording_expires_at),
  recordingDurationMinutes: row.recording_duration_minutes === null || row.recording_duration_minutes === undefined
    ? null
    : Number(row.recording_duration_minutes || 0),
  posterUrl: row.poster_url || null,
  description: row.class_description || null,
  teacherProfile: asObject(row.teacher_profile),
  sessionNotes: asArray(row.session_notes),
  resources: asArray(row.resource_items),
  activePoll: asObject(row.active_poll),
  topicTags: asArray(row.topic_tags),
  createdAt: toIso(row.created_at) || nowIso(),
});

const mapLiveChatRow = (row) => ({
  _id: row.id,
  liveClassId: row.live_class_id,
  userId: row.user_id,
  userName: row.user_name,
  kind: row.kind || 'chat',
  message: row.message,
  createdAt: toIso(row.created_at) || nowIso(),
});

const mapPlanRow = (row) => ({
  _id: row.id,
  title: row.title,
  description: row.description || '',
  price: toNumber(row.price_inr),
  billingCycle: row.billing_cycle || 'monthly',
  accessType: row.access_type || 'subscription',
  features: asArray(row.feature_list),
  createdAt: toIso(row.created_at) || nowIso(),
});

const mapSubscriptionRow = (row) => ({
  _id: row.id,
  userId: row.user_id,
  planId: row.plan_id,
  status: row.status || 'active',
  source: row.source || 'payment',
  startedAt: toIso(row.started_at) || nowIso(),
  expiresAt: toIso(row.expires_at),
});

const mapNotificationRow = (row) => ({
  _id: row.id,
  userId: row.user_id,
  title: row.title,
  message: row.message,
  type: row.notification_type || 'general',
  entityId: row.entity_id || null,
  actionUrl: row.action_url || null,
  actionLabel: row.action_label || null,
  payload: asObject(row.payload),
  createdAt: toIso(row.created_at) || nowIso(),
});

const mapReferralRow = (row) => ({
  _id: row.id,
  referrerUserId: row.referrer_user_id,
  referredEmail: row.referred_email,
  rewardPoints: Number(row.reward_points || 0),
  createdAt: toIso(row.created_at) || nowIso(),
});

const mapEnrollmentRow = (row) => ({
  _id: row.id,
  userId: row.user_id,
  courseId: row.course_id,
  accessType: row.access_type || 'course',
  source: row.source || 'payment',
  enrolledAt: toIso(row.enrolled_at) || nowIso(),
  expiresAt: toIso(row.expires_at),
  viewCount: Number(row.view_count || 0),
});

const mapVideoAccessGrantRow = (row) => ({
  _id: row.id,
  userId: row.user_id,
  courseId: row.course_id,
  lessonId: row.lesson_id,
  accessType: row.access_type || 'replay',
  expiresAt: toIso(row.expires_at) || null,
  maxViews: Number(row.max_views || replayMaxViews),
  usedViews: Number(row.used_views || 0),
  activeSessionId: row.active_session_id || null,
  lastStartedAt: toIso(row.last_started_at),
  lastCompletedAt: toIso(row.last_completed_at),
  createdAt: toIso(row.created_at) || nowIso(),
  updatedAt: toIso(row.updated_at) || nowIso(),
});

const mapLiveReplayGrantRow = (row) => ({
  _id: row.id,
  userId: row.user_id,
  liveClassId: row.live_class_id,
  accessType: row.access_type || 'live-replay',
  expiresAt: toIso(row.expires_at) || null,
  maxViews: Number(row.max_views || replayMaxViews),
  usedViews: Number(row.used_views || 0),
  activeSessionId: row.active_session_id || null,
  lastStartedAt: toIso(row.last_started_at),
  lastCompletedAt: toIso(row.last_completed_at),
  createdAt: toIso(row.created_at) || nowIso(),
  updatedAt: toIso(row.updated_at) || nowIso(),
});

const mapWatchHistoryRow = (row) => ({
  _id: row.id,
  userId: row.user_id,
  courseId: row.course_id,
  lessonId: row.lesson_id,
  progressPercent: toNumber(row.progress_percent),
  progressSeconds: Number(row.progress_seconds || 0),
  completed: Boolean(row.completed),
  updatedAt: toIso(row.updated_at) || nowIso(),
});

const mapPaymentRow = (row) => ({
  _id: row.id,
  userId: row.user_id,
  amount: toNumber(row.amount_inr),
  currency: row.currency || 'INR',
  item: row.item || 'Course Purchase',
  status: row.status || 'pending',
  attemptCount: Number(row.attempt_count || 1),
  retryable: Boolean(row.retryable),
  lastError: row.last_error || null,
  createdAt: toIso(row.created_at) || nowIso(),
  updatedAt: toIso(row.updated_at) || null,
});

const mapUploadRow = (row) => ({
  _id: row.id,
  title: row.title,
  course: row.course_id || null,
  questionCount: Number(row.question_count || 0),
  createdAt: toIso(row.created_at) || nowIso(),
});

const mapWebhookRow = (row) => ({
  _id: row.id,
  event: row.event,
  paymentId: row.payment_id || null,
  status: row.status,
  receivedAt: toIso(row.received_at) || nowIso(),
  payload: asObject(row.payload),
});

const mapAiMessageRow = (row) => ({
  _id: row.id,
  userId: row.user_id,
  message: row.message,
  answer: row.answer,
  createdAt: toIso(row.created_at) || nowIso(),
});

const mapSessionRow = (row) => ({
  _id: row.id,
  userId: row.user_id,
  sessionId: row.jwt_session_id,
  device: row.device || null,
  status: row.status || 'active',
  reason: row.reason || null,
  createdAt: toIso(row.created_at) || nowIso(),
  lastSeenAt: toIso(row.last_seen_at) || nowIso(),
  endedAt: toIso(row.ended_at),
});

const mapDeviceActivityRow = (row) => ({
  _id: row.id,
  userId: row.user_id,
  sessionId: row.session_id || null,
  device: row.device || null,
  eventType: row.event_type,
  meta: asObject(row.event_meta),
  createdAt: toIso(row.created_at) || nowIso(),
});

const pgMany = async (sql, params = [], mapper = (row) => row, client = null) => {
  const result = await queryPostgres(sql, params, client);
  return result.rows.map((row) => mapper(row));
};

const pgOne = async (sql, params = [], mapper = (row) => row, client = null) => {
  const result = await queryPostgres(sql, params, client);
  return result.rows[0] ? mapper(result.rows[0]) : null;
};

const pgExec = async (sql, params = [], client = null) => queryPostgres(sql, params, client);

const upsertPgUser = async (payload, client = null) => {
  const user = {
    _id: payload._id || createPersistentId('user'),
    name: payload.name,
    email: normalizeEmail(payload.email),
    password: payload.password,
    role: payload.role || 'student',
    device: payload.device || null,
    session: payload.session || null,
    streak: payload.streak ?? 0,
    points: payload.points ?? 0,
    badges: asArray(payload.badges),
    referral_code: payload.referral_code || null,
    created_at: payload.created_at || nowIso(),
    updated_at: payload.updated_at || nowIso(),
  };

  await pgExec(
    `
      INSERT INTO users (
        id, full_name, email, password_hash, role, device, active_session_id,
        streak_days, reward_points, badges, referral_code, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10::jsonb, $11, $12, $13)
      ON CONFLICT (id) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        email = EXCLUDED.email,
        password_hash = EXCLUDED.password_hash,
        role = EXCLUDED.role,
        device = EXCLUDED.device,
        active_session_id = EXCLUDED.active_session_id,
        streak_days = EXCLUDED.streak_days,
        reward_points = EXCLUDED.reward_points,
        badges = EXCLUDED.badges,
        referral_code = EXCLUDED.referral_code,
        updated_at = EXCLUDED.updated_at
    `,
    [
      user._id,
      user.name,
      user.email,
      user.password,
      user.role,
      JSON.stringify(user.device),
      user.session,
      Number(user.streak || 0),
      Number(user.points || 0),
      JSON.stringify(user.badges || []),
      user.referral_code,
      user.created_at,
      user.updated_at,
    ],
    client,
  );

  return user;
};

const upsertPgCourse = async (payload, client = null) => {
  const course = {
    _id: payload._id || createPersistentId('course'),
    title: payload.title,
    description: payload.description || '',
    category: payload.category || 'SSC JE',
    exam: payload.exam || payload.category || 'SSC JE',
    subject: payload.subject || 'General',
    level: payload.level || 'Full Course',
    price: Number(payload.price || 0),
    validityDays: Number(payload.validityDays || courseDefaultValidityDays),
    thumbnailUrl: payload.thumbnailUrl || null,
    instructor: payload.instructor || 'VARONENGLISH Faculty',
    officialChannelUrl: payload.officialChannelUrl || null,
    modules: asArray(payload.modules),
    createdBy: payload.createdBy || null,
    created_at: payload.created_at || nowIso(),
  };

  await pgExec(
    `
      INSERT INTO courses (
        id, title, description, category, exam, subject, level, price_inr,
        validity_days, thumbnail_url, instructor_name, official_channel_url,
        modules, created_by, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15)
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        exam = EXCLUDED.exam,
        subject = EXCLUDED.subject,
        level = EXCLUDED.level,
        price_inr = EXCLUDED.price_inr,
        validity_days = EXCLUDED.validity_days,
        thumbnail_url = EXCLUDED.thumbnail_url,
        instructor_name = EXCLUDED.instructor_name,
        official_channel_url = EXCLUDED.official_channel_url,
        modules = EXCLUDED.modules,
        created_by = EXCLUDED.created_by
    `,
    [
      course._id,
      course.title,
      course.description,
      course.category,
      course.exam,
      course.subject,
      course.level,
      course.price,
      course.validityDays,
      course.thumbnailUrl,
      course.instructor,
      course.officialChannelUrl,
      JSON.stringify(course.modules || []),
      course.createdBy,
      course.created_at,
    ],
    client,
  );

  return course;
};

const upsertPgTest = async (payload, client = null) => {
  const questions = Array.isArray(payload.questions)
    ? payload.questions.map((question, index) => ({
        id: question.id || createPersistentId(`question_${index + 1}`),
        answer: question.answer ?? question.correctOption,
        correctOption: question.correctOption ?? question.answer,
        explanation: question.explanation || '',
        marks: Number(question.marks || 1),
        topic: question.topic || 'General Practice',
        ...clone(question),
      }))
    : [];

  const test = {
    _id: payload._id || createPersistentId('test'),
    title: payload.title,
    description: payload.description || '',
    category: payload.category || 'SSC JE',
    type: payload.type || 'full-length',
    durationMinutes: Number(payload.durationMinutes || 60),
    totalMarks: Number(payload.totalMarks || questions.reduce((sum, question) => sum + Number(question.marks || 1), 0)),
    negativeMarking: Number(payload.negativeMarking || 0),
    sectionBreakup: asArray(payload.sectionBreakup),
    course: payload.course || null,
    questions,
    created_at: payload.created_at || nowIso(),
  };

  await pgExec(
    `
      INSERT INTO tests (
        id, title, description, category, test_type, duration_minutes, total_marks,
        negative_marking, course_id, section_breakup, questions, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12)
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        test_type = EXCLUDED.test_type,
        duration_minutes = EXCLUDED.duration_minutes,
        total_marks = EXCLUDED.total_marks,
        negative_marking = EXCLUDED.negative_marking,
        course_id = EXCLUDED.course_id,
        section_breakup = EXCLUDED.section_breakup,
        questions = EXCLUDED.questions
    `,
    [
      test._id,
      test.title,
      test.description,
      test.category,
      test.type,
      test.durationMinutes,
      test.totalMarks,
      test.negativeMarking,
      test.course,
      JSON.stringify(test.sectionBreakup || []),
      JSON.stringify(test.questions || []),
      test.created_at,
    ],
    client,
  );

  return test;
};

const upsertPgQuiz = async (payload, client = null) => {
  const quizDate = String(payload.date || '').slice(0, 10);
  const existing = await pgOne(
    'SELECT * FROM daily_quizzes WHERE quiz_date = $1',
    [quizDate],
    mapQuizRow,
    client,
  );

  const quiz = {
    _id: existing?._id || payload._id || createPersistentId('quiz'),
    date: quizDate,
    title: payload.title || existing?.title || 'Daily Quiz',
    questions: asArray(payload.questions),
    createdAt: payload.createdAt || existing?.createdAt || nowIso(),
  };

  await pgExec(
    `
      INSERT INTO daily_quizzes (id, quiz_date, title, questions, created_at)
      VALUES ($1, $2, $3, $4::jsonb, $5)
      ON CONFLICT (id) DO UPDATE SET
        quiz_date = EXCLUDED.quiz_date,
        title = EXCLUDED.title,
        questions = EXCLUDED.questions
    `,
    [quiz._id, quiz.date, quiz.title, JSON.stringify(quiz.questions || []), quiz.createdAt],
    client,
  );

  await deleteRedisKey(cacheKey('quiz-leaderboard', quiz._id));
  await deleteRedisKey(cacheKey('quiz-weekly', 'all'));
  return quiz;
};

const insertPgNotification = async (payload, client = null) => {
  const notification = {
    _id: payload._id || createPersistentId('notification'),
    userId: String(payload.userId),
    title: payload.title || 'Notification',
    message: payload.message || '',
    type: payload.type || 'general',
    entityId: payload.entityId ? String(payload.entityId) : null,
    actionUrl: payload.actionUrl || null,
    actionLabel: payload.actionLabel || null,
    payload: asObject(payload.payload),
    createdAt: payload.createdAt || nowIso(),
  };

  await pgExec(
    `
      INSERT INTO notifications (
        id, user_id, title, message, notification_type, entity_id, action_url, action_label, payload, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        message = EXCLUDED.message,
        notification_type = EXCLUDED.notification_type,
        entity_id = EXCLUDED.entity_id,
        action_url = EXCLUDED.action_url,
        action_label = EXCLUDED.action_label,
        payload = EXCLUDED.payload
    `,
    [
      notification._id,
      notification.userId,
      notification.title,
      notification.message,
      notification.type,
      notification.entityId,
      notification.actionUrl,
      notification.actionLabel,
      JSON.stringify(notification.payload),
      notification.createdAt,
    ],
    client,
  );

  return notification;
};

const insertPgEnrollment = async (payload, client = null) => {
  const existing = await pgOne(
    'SELECT * FROM enrollments WHERE user_id = $1 AND course_id = $2',
    [String(payload.userId), String(payload.courseId)],
    mapEnrollmentRow,
    client,
  );

  if (existing) {
    return existing;
  }

  const enrollment = {
    _id: payload._id || createPersistentId('enrollment'),
    userId: String(payload.userId),
    courseId: String(payload.courseId),
    accessType: payload.accessType || 'course',
    source: payload.source || 'payment',
    enrolledAt: payload.enrolledAt || nowIso(),
    expiresAt: payload.expiresAt || addDaysIso(payload.validityDays),
    viewCount: Number(payload.viewCount || 0),
  };

  await pgExec(
    `
      INSERT INTO enrollments (id, user_id, course_id, access_type, source, enrolled_at, expires_at, view_count)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
    [
      enrollment._id,
      enrollment.userId,
      enrollment.courseId,
      enrollment.accessType,
      enrollment.source,
      enrollment.enrolledAt,
      enrollment.expiresAt,
      enrollment.viewCount,
    ],
    client,
  );

  return enrollment;
};

const resolveReplayGrantExpiryIso = ({ enrollment = null, currentGrant = null } = {}) => {
  const candidates = [Date.now() + replayRetentionMs];

  if (enrollment?.expiresAt) {
    const enrollmentExpiry = Date.parse(enrollment.expiresAt);
    if (Number.isFinite(enrollmentExpiry)) {
      candidates.push(enrollmentExpiry);
    }
  }

  if (currentGrant?.expiresAt) {
    const currentExpiry = Date.parse(currentGrant.expiresAt);
    if (Number.isFinite(currentExpiry)) {
      candidates.push(currentExpiry);
    }
  }

  return new Date(Math.min(...candidates)).toISOString();
};

const resolveLiveReplayGrantExpiryIso = ({ liveClass = null, currentGrant = null } = {}) => {
  const candidates = [Date.now() + liveReplayRetentionMs];

  if (liveClass?.recordingExpiresAt) {
    const recordingExpiry = Date.parse(liveClass.recordingExpiresAt);
    if (Number.isFinite(recordingExpiry)) {
      candidates.push(recordingExpiry);
    }
  }

  if (liveClass?.recordingPublishedAt) {
    const publishedAt = Date.parse(liveClass.recordingPublishedAt);
    if (Number.isFinite(publishedAt)) {
      candidates.push(publishedAt + liveReplayRetentionMs);
    }
  }

  if (currentGrant?.expiresAt) {
    const currentExpiry = Date.parse(currentGrant.expiresAt);
    if (Number.isFinite(currentExpiry)) {
      candidates.push(currentExpiry);
    }
  }

  return new Date(Math.min(...candidates)).toISOString();
};

const mapReplayGrantForResponse = (grant) => ({
  _id: grant._id,
  userId: grant.userId,
  courseId: grant.courseId,
  lessonId: grant.lessonId,
  accessType: grant.accessType || 'replay',
  expiresAt: grant.expiresAt,
  maxViews: Number(grant.maxViews || replayMaxViews),
  usedViews: Number(grant.usedViews || 0),
  remainingViews: Math.max(Number(grant.maxViews || replayMaxViews) - Number(grant.usedViews || 0), 0),
  activeSessionId: grant.activeSessionId || null,
  lastStartedAt: grant.lastStartedAt || null,
  lastCompletedAt: grant.lastCompletedAt || null,
  createdAt: grant.createdAt || nowIso(),
  updatedAt: grant.updatedAt || nowIso(),
});

const mapLiveReplayGrantForResponse = (grant) => ({
  _id: grant._id,
  userId: grant.userId,
  liveClassId: grant.liveClassId,
  accessType: grant.accessType || 'live-replay',
  expiresAt: grant.expiresAt,
  maxViews: Number(grant.maxViews || liveReplayMaxViews),
  usedViews: Number(grant.usedViews || 0),
  remainingViews: Math.max(Number(grant.maxViews || liveReplayMaxViews) - Number(grant.usedViews || 0), 0),
  activeSessionId: grant.activeSessionId || null,
  lastStartedAt: grant.lastStartedAt || null,
  lastCompletedAt: grant.lastCompletedAt || null,
  createdAt: grant.createdAt || nowIso(),
  updatedAt: grant.updatedAt || nowIso(),
});

const upsertPgReplayGrant = async ({
  userId,
  courseId,
  lessonId,
  sessionId,
  enrollment = null,
  client = null,
}) => {
  const existing = await pgOne(
    'SELECT * FROM video_access_grants WHERE user_id = $1 AND course_id = $2 AND lesson_id = $3 FOR UPDATE',
    [String(userId), String(courseId), String(lessonId)],
    mapVideoAccessGrantRow,
    client,
  );

  const now = Date.now();
  const expiresAt = existing?.expiresAt || resolveReplayGrantExpiryIso({ enrollment });

  if (existing) {
    if (isReplayGrantExpired(existing)) {
      throw new ApiError(403, 'Replay access has expired', { code: 'REPLAY_ACCESS_EXPIRED' });
    }

    const samePlaybackSession = existing.activeSessionId
      && String(existing.activeSessionId) === String(sessionId || '')
      && existing.lastStartedAt
      && Number.isFinite(Date.parse(existing.lastStartedAt))
      && (now - Date.parse(existing.lastStartedAt)) < (30 * 60 * 1000);

    if (samePlaybackSession) {
      return existing;
    }

    if (hasReplayViewLimit() && Number(existing.usedViews || 0) >= Number(existing.maxViews || replayMaxViews)) {
      throw new ApiError(403, 'Replay access limit reached', { code: 'REPLAY_VIEW_LIMIT_REACHED' });
    }

    await pgExec(
      `
        UPDATE video_access_grants
        SET used_views = COALESCE(used_views, 0) + $3,
            active_session_id = $2,
            last_started_at = now(),
            updated_at = now()
        WHERE id = $1
      `,
      [existing._id, sessionId || null, hasReplayViewLimit() ? 1 : 0],
      client,
    );

    const updated = await pgOne(
      'SELECT * FROM video_access_grants WHERE id = $1',
      [existing._id],
      mapVideoAccessGrantRow,
      client,
    );
    return updated || existing;
  }

  const grant = {
    _id: createPersistentId('video_grant'),
    userId: String(userId),
    courseId: String(courseId),
    lessonId: String(lessonId),
    accessType: 'replay',
    expiresAt,
    maxViews: replayMaxViews,
    usedViews: 0,
    activeSessionId: null,
    lastStartedAt: null,
    lastCompletedAt: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  await pgExec(
    `
      INSERT INTO video_access_grants (
        id, user_id, course_id, lesson_id, access_type, expires_at, max_views, used_views,
        active_session_id, last_started_at, last_completed_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `,
    [
      grant._id,
      grant.userId,
      grant.courseId,
      grant.lessonId,
      grant.accessType,
      grant.expiresAt,
      grant.maxViews,
      grant.usedViews,
      grant.activeSessionId,
      grant.lastStartedAt,
      grant.lastCompletedAt,
      grant.createdAt,
      grant.updatedAt,
    ],
    client,
  );

  await pgExec(
    `
      UPDATE video_access_grants
      SET used_views = used_views + $3,
          active_session_id = $2,
          last_started_at = now(),
          updated_at = now()
      WHERE id = $1
    `,
    [grant._id, sessionId || null, hasReplayViewLimit() ? 1 : 0],
    client,
  );

  const created = await pgOne(
    'SELECT * FROM video_access_grants WHERE id = $1',
    [grant._id],
    mapVideoAccessGrantRow,
    client,
  );
  return created || grant;
};

const upsertPgLiveReplayGrant = async ({
  userId,
  liveClassId,
  sessionId,
  liveClass = null,
  client = null,
}) => {
  const existing = await pgOne(
    'SELECT * FROM live_replay_access_grants WHERE user_id = $1 AND live_class_id = $2 FOR UPDATE',
    [String(userId), String(liveClassId)],
    mapLiveReplayGrantRow,
    client,
  );

  const now = Date.now();
  const expiresAt = existing?.expiresAt || resolveLiveReplayGrantExpiryIso({ liveClass });

  if (existing) {
    if (isLiveReplayGrantExpired(existing)) {
      throw new ApiError(403, 'Replay access has expired', { code: 'REPLAY_ACCESS_EXPIRED' });
    }

    const samePlaybackSession = existing.activeSessionId
      && String(existing.activeSessionId) === String(sessionId || '')
      && existing.lastStartedAt
      && Number.isFinite(Date.parse(existing.lastStartedAt))
      && (now - Date.parse(existing.lastStartedAt)) < (30 * 60 * 1000);

    if (samePlaybackSession) {
      return existing;
    }

    if (hasReplayViewLimit() && Number(existing.usedViews || 0) >= Number(existing.maxViews || liveReplayMaxViews)) {
      throw new ApiError(403, 'Replay access limit reached', { code: 'REPLAY_VIEW_LIMIT_REACHED' });
    }

    await pgExec(
      `
        UPDATE live_replay_access_grants
        SET used_views = COALESCE(used_views, 0) + $3,
            active_session_id = $2,
            last_started_at = now(),
            updated_at = now()
        WHERE id = $1
      `,
      [existing._id, sessionId || null, hasReplayViewLimit() ? 1 : 0],
      client,
    );

    const updated = await pgOne(
      'SELECT * FROM live_replay_access_grants WHERE id = $1',
      [existing._id],
      mapLiveReplayGrantRow,
      client,
    );
    return updated || existing;
  }

  const grant = {
    _id: createPersistentId('live_replay_grant'),
    userId: String(userId),
    liveClassId: String(liveClassId),
    accessType: 'live-replay',
    expiresAt,
    maxViews: liveReplayMaxViews,
    usedViews: 0,
    activeSessionId: null,
    lastStartedAt: null,
    lastCompletedAt: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  await pgExec(
    `
      INSERT INTO live_replay_access_grants (
        id, user_id, live_class_id, access_type, expires_at, max_views, used_views,
        active_session_id, last_started_at, last_completed_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `,
    [
      grant._id,
      grant.userId,
      grant.liveClassId,
      grant.accessType,
      grant.expiresAt,
      grant.maxViews,
      grant.usedViews,
      grant.activeSessionId,
      grant.lastStartedAt,
      grant.lastCompletedAt,
      grant.createdAt,
      grant.updatedAt,
    ],
    client,
  );

  await pgExec(
    `
      UPDATE live_replay_access_grants
      SET used_views = used_views + $3,
          active_session_id = $2,
          last_started_at = now(),
          updated_at = now()
      WHERE id = $1
    `,
    [grant._id, sessionId || null, hasReplayViewLimit() ? 1 : 0],
    client,
  );

  const created = await pgOne(
    'SELECT * FROM live_replay_access_grants WHERE id = $1',
    [grant._id],
    mapLiveReplayGrantRow,
    client,
  );
  return created || grant;
};

const consumeMemoryReplayGrant = ({
  userId,
  courseId,
  lessonId,
  sessionId,
  enrollment = null,
}) => {
  const grantKey = {
    userId: String(userId),
    courseId: String(courseId),
    lessonId: String(lessonId),
  };
  let grant = state.videoAccessGrants.find(
    (entry) =>
      entry.userId === grantKey.userId
      && entry.courseId === grantKey.courseId
      && entry.lessonId === grantKey.lessonId,
  ) || null;

  if (grant && isReplayGrantExpired(grant)) {
    throw new ApiError(403, 'Replay access has expired', { code: 'REPLAY_ACCESS_EXPIRED' });
  }

  if (!grant) {
    grant = {
      _id: nextId('video_grant'),
      userId: grantKey.userId,
      courseId: grantKey.courseId,
      lessonId: grantKey.lessonId,
      accessType: 'replay',
      expiresAt: resolveReplayGrantExpiryIso({ enrollment }),
      maxViews: replayMaxViews,
      usedViews: 0,
      activeSessionId: null,
      lastStartedAt: null,
      lastCompletedAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    state.videoAccessGrants.push(grant);
  }

  const samePlaybackSession = grant.activeSessionId
    && String(grant.activeSessionId) === String(sessionId || '')
    && grant.lastStartedAt
    && Number.isFinite(Date.parse(grant.lastStartedAt))
    && (Date.now() - Date.parse(grant.lastStartedAt)) < (30 * 60 * 1000);

  if (samePlaybackSession) {
    return clone(grant);
  }

  if (hasReplayViewLimit() && Number(grant.usedViews || 0) >= Number(grant.maxViews || replayMaxViews)) {
    throw new ApiError(403, 'Replay access limit reached', { code: 'REPLAY_VIEW_LIMIT_REACHED' });
  }

  grant.usedViews = Number(grant.usedViews || 0) + (hasReplayViewLimit() ? 1 : 0);
  grant.activeSessionId = sessionId || null;
  grant.lastStartedAt = nowIso();
  grant.updatedAt = nowIso();

  return clone(grant);
};

const consumeMemoryLiveReplayGrant = ({
  userId,
  liveClassId,
  sessionId,
  liveClass = null,
}) => {
  const grantKey = {
    userId: String(userId),
    liveClassId: String(liveClassId),
  };
  let grant = state.liveReplayAccessGrants.find(
    (entry) => entry.userId === grantKey.userId && entry.liveClassId === grantKey.liveClassId,
  ) || null;

  if (grant && isLiveReplayGrantExpired(grant)) {
    throw new ApiError(403, 'Replay access has expired', { code: 'REPLAY_ACCESS_EXPIRED' });
  }

  if (!grant) {
    grant = {
      _id: nextId('live_replay_grant'),
      userId: grantKey.userId,
      liveClassId: grantKey.liveClassId,
      accessType: 'live-replay',
      expiresAt: resolveLiveReplayGrantExpiryIso({ liveClass }),
      maxViews: liveReplayMaxViews,
      usedViews: 0,
      activeSessionId: null,
      lastStartedAt: null,
      lastCompletedAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    state.liveReplayAccessGrants.push(grant);
  }

  const samePlaybackSession = grant.activeSessionId
    && String(grant.activeSessionId) === String(sessionId || '')
    && grant.lastStartedAt
    && Number.isFinite(Date.parse(grant.lastStartedAt))
    && (Date.now() - Date.parse(grant.lastStartedAt)) < (30 * 60 * 1000);

  if (samePlaybackSession) {
    return clone(grant);
  }

  if (hasReplayViewLimit() && Number(grant.usedViews || 0) >= Number(grant.maxViews || liveReplayMaxViews)) {
    throw new ApiError(403, 'Replay access limit reached', { code: 'REPLAY_VIEW_LIMIT_REACHED' });
  }

  grant.usedViews = Number(grant.usedViews || 0) + (hasReplayViewLimit() ? 1 : 0);
  grant.activeSessionId = sessionId || null;
  grant.lastStartedAt = nowIso();
  grant.updatedAt = nowIso();

  return clone(grant);
};

const consumeLiveReplayGrant = async ({
  userId,
  liveClassId,
  sessionId,
}) => {
  const liveClass = await findStoredLiveClassById(liveClassId);
  if (!liveClass) {
    throw new ApiError(404, 'Live class not found', { code: 'LIVE_CLASS_NOT_FOUND' });
  }

  const derivedLiveReplayExpiry = Date.parse(
    liveClass.recordingExpiresAt
    || resolveLiveReplayGrantExpiryIso({ liveClass }),
  );
  if (Number.isFinite(derivedLiveReplayExpiry) && derivedLiveReplayExpiry <= Date.now()) {
    throw new ApiError(403, 'Replay access has expired', { code: 'REPLAY_ACCESS_EXPIRED' });
  }

  const user = await usersRepository.findSafeById(userId);
  if (!user) {
    throw new ApiError(401, 'Authorization token required', { code: 'AUTH_REQUIRED' });
  }

  const accessSessionId = sessionId || user.session || null;

  if (isPostgresMode()) {
    return {
      liveClass,
      user,
      grant: await runInTransaction(async (client) => upsertPgLiveReplayGrant({
        userId,
        liveClassId,
        sessionId: accessSessionId,
        liveClass,
        client,
      })),
    };
  }

  return {
    liveClass,
    user,
    grant: consumeMemoryLiveReplayGrant({
      userId,
      liveClassId,
      sessionId: accessSessionId,
      liveClass,
    }),
  };
};

const consumeReplayGrant = async ({
  userId,
  courseId,
  lessonId,
  sessionId,
  enforceEnrollment = true,
  enforceSequentialUnlock = true,
}) => {
  await ensurePlatformReady();

  const user = await usersRepository.findSafeById(userId);
  if (!user) {
    throw new ApiError(401, 'Authorization token required', { code: 'AUTH_REQUIRED' });
  }
  const playbackSessionId = sessionId || user.session || null;

  const course = await coursesRepository.findById(courseId);
  if (!course) {
    throw new ApiError(404, 'Course not found', { code: 'COURSE_NOT_FOUND' });
  }

  const isAdmin = user.role === 'admin';
  let enrollment = null;

  if (enforceEnrollment && !isAdmin) {
    if (isPostgresMode()) {
      enrollment = await pgOne(
        `SELECT * FROM enrollments WHERE user_id = $1 AND course_id = $2 AND ${activeEnrollmentSql}`,
        [String(userId), String(courseId)],
        mapEnrollmentRow,
      );
    } else {
      enrollment = state.enrollments.find(
        (entry) => entry.userId === String(userId) && entry.courseId === String(courseId) && isEnrollmentActive(entry),
      ) || null;
    }

    if (!enrollment) {
      throw new ApiError(403, 'Course enrollment is required to access this lesson', { code: 'COURSE_ACCESS_REQUIRED' });
    }
  }

  const lesson = findLessonInCourse(course, lessonId);
  if (!lesson) {
    throw new ApiError(404, 'Lesson not found', { code: 'LESSON_NOT_FOUND' });
  }

  if (enforceSequentialUnlock && !isAdmin && !isLessonSequentiallyUnlocked(course, userId, lessonId, await loadPlatformData())) {
    throw new ApiError(403, 'Finish the previous topic to unlock this lesson', { code: 'SEQUENTIAL_LOCKED' });
  }

  if (isPostgresMode()) {
    return runInTransaction(async (client) => {
      const grant = await upsertPgReplayGrant({
        userId,
        courseId,
        lessonId,
        sessionId: playbackSessionId,
        enrollment,
        client,
      });
      return {
        user,
        course,
        lesson,
        enrollment,
        grant,
      };
    });
  }

  const grant = consumeMemoryReplayGrant({
    userId,
    courseId,
    lessonId,
    sessionId: playbackSessionId,
    enrollment,
  });

  return {
    user,
    course,
    lesson,
    enrollment,
    grant,
  };
};

const upsertPgWatchHistory = async (payload, client = null) => {
  const existing = await pgOne(
    'SELECT * FROM watch_history WHERE user_id = $1 AND lesson_id = $2',
    [String(payload.userId), String(payload.lessonId)],
    mapWatchHistoryRow,
    client,
  );

  const record = {
    _id: existing?._id || payload._id || createPersistentId('watch'),
    userId: String(payload.userId),
    courseId: String(payload.courseId),
    lessonId: String(payload.lessonId),
    progressPercent: Number(payload.progressPercent || 0),
    progressSeconds: Number(payload.progressSeconds || 0),
    completed: Boolean(payload.completed),
    updatedAt: payload.updatedAt || nowIso(),
  };

  await pgExec(
    `
      INSERT INTO watch_history (
        id, user_id, course_id, lesson_id, progress_percent, progress_seconds, completed, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (user_id, lesson_id) DO UPDATE SET
        course_id = EXCLUDED.course_id,
        progress_percent = EXCLUDED.progress_percent,
        progress_seconds = EXCLUDED.progress_seconds,
        completed = EXCLUDED.completed,
        updated_at = EXCLUDED.updated_at
    `,
    [
      record._id,
      record.userId,
      record.courseId,
      record.lessonId,
      record.progressPercent,
      record.progressSeconds,
      record.completed,
      record.updatedAt,
    ],
    client,
  );

  return record;
};

const insertPgLiveClass = async (payload, client = null) => {
  const liveClass = {
    _id: payload._id || createPersistentId('live_class'),
    linkageType: payload.linkageType || (payload.mockTestId ? 'mock-test' : payload.courseId ? 'course' : 'standalone'),
    courseId: payload.courseId || null,
    moduleId: payload.moduleId || null,
    moduleTitle: payload.moduleTitle || null,
    chapterId: payload.chapterId || null,
    chapterTitle: payload.chapterTitle || null,
    mockTestId: payload.mockTestId || null,
    mockTestTitle: payload.mockTestTitle || null,
    title: payload.title,
    instructor: payload.instructor || 'VARONENGLISH Faculty',
    startTime: payload.startTime || nowIso(),
    durationMinutes: Number(payload.durationMinutes || 60),
    provider: payload.provider || 'Jitsi Meet',
    mode: payload.mode || 'live',
    status: payload.status || 'scheduled',
    livePlaybackUrl: payload.livePlaybackUrl || null,
    livePlaybackType: payload.livePlaybackType || getDefaultLivePlaybackType(),
    embedUrl: payload.embedUrl || null,
    roomUrl: payload.roomUrl || null,
    recordingUrl: payload.recordingUrl || null,
    replayCourseId: payload.replayCourseId || null,
    replayLessonId: payload.replayLessonId || null,
    chatEnabled: payload.chatEnabled !== false,
    doubtSolving: payload.doubtSolving !== false,
    replayAvailable: payload.replayAvailable !== false,
    attendees: Number(payload.attendees || 0),
    maxAttendees: Number(payload.maxAttendees || 2500),
    requiresEnrollment: payload.requiresEnrollment !== false,
    recordingStorageProvider: payload.recordingStorageProvider || null,
    recordingStoragePath: payload.recordingStoragePath || null,
    recordingPublishedAt: payload.recordingPublishedAt || null,
    recordingExpiresAt: payload.recordingExpiresAt || null,
    recordingDurationMinutes: payload.recordingDurationMinutes === undefined ? null : Number(payload.recordingDurationMinutes || 0),
    posterUrl: payload.posterUrl || null,
    description: payload.description || null,
    teacherProfile: asObject(payload.teacherProfile),
    sessionNotes: asArray(payload.sessionNotes),
    resources: asArray(payload.resources),
    activePoll: payload.activePoll ? asObject(payload.activePoll) : null,
    topicTags: asArray(payload.topicTags),
  };

  await pgExec(
    `
      INSERT INTO live_classes (
        id, linkage_type, course_id, module_id, module_title, chapter_id, chapter_title, mock_test_id, mock_test_title, title, instructor_name, scheduled_start_at, duration_minutes, provider,
        mode, status, live_playback_url, live_playback_type, embed_url, room_url, recording_url,
        replay_course_id, replay_lesson_id, chat_enabled, doubt_solving, replay_available,
        attendee_count, max_attendees, requires_enrollment, recording_storage_provider, recording_storage_path,
        recording_published_at, recording_expires_at, recording_duration_minutes, poster_url, class_description,
        teacher_profile, session_notes, resource_items, active_poll, topic_tags
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
        $15, $16, $17, $18, $19, $20, $21,
        $22, $23, $24, $25, $26,
        $27, $28, $29, $30, $31,
        $32, $33, $34, $35, $36,
        $37::jsonb, $38::jsonb, $39::jsonb, $40::jsonb, $41::jsonb
      )
      ON CONFLICT (id) DO UPDATE SET
        linkage_type = EXCLUDED.linkage_type,
        course_id = EXCLUDED.course_id,
        module_id = EXCLUDED.module_id,
        module_title = EXCLUDED.module_title,
        chapter_id = EXCLUDED.chapter_id,
        chapter_title = EXCLUDED.chapter_title,
        mock_test_id = EXCLUDED.mock_test_id,
        mock_test_title = EXCLUDED.mock_test_title,
        title = EXCLUDED.title,
        instructor_name = EXCLUDED.instructor_name,
        scheduled_start_at = EXCLUDED.scheduled_start_at,
        duration_minutes = EXCLUDED.duration_minutes,
        provider = EXCLUDED.provider,
        mode = EXCLUDED.mode,
        status = EXCLUDED.status,
        live_playback_url = EXCLUDED.live_playback_url,
        live_playback_type = EXCLUDED.live_playback_type,
        embed_url = EXCLUDED.embed_url,
        room_url = EXCLUDED.room_url,
        recording_url = EXCLUDED.recording_url,
        replay_course_id = EXCLUDED.replay_course_id,
        replay_lesson_id = EXCLUDED.replay_lesson_id,
        chat_enabled = EXCLUDED.chat_enabled,
        doubt_solving = EXCLUDED.doubt_solving,
        replay_available = EXCLUDED.replay_available,
        attendee_count = EXCLUDED.attendee_count,
        max_attendees = EXCLUDED.max_attendees,
        requires_enrollment = EXCLUDED.requires_enrollment,
        recording_storage_provider = EXCLUDED.recording_storage_provider,
        recording_storage_path = EXCLUDED.recording_storage_path,
        recording_published_at = EXCLUDED.recording_published_at,
        recording_expires_at = EXCLUDED.recording_expires_at,
        recording_duration_minutes = EXCLUDED.recording_duration_minutes,
        poster_url = EXCLUDED.poster_url,
        class_description = EXCLUDED.class_description,
        teacher_profile = EXCLUDED.teacher_profile,
        session_notes = EXCLUDED.session_notes,
        resource_items = EXCLUDED.resource_items,
        active_poll = EXCLUDED.active_poll,
        topic_tags = EXCLUDED.topic_tags
    `,
    [
      liveClass._id,
      liveClass.linkageType,
      liveClass.courseId,
      liveClass.moduleId,
      liveClass.moduleTitle,
      liveClass.chapterId,
      liveClass.chapterTitle,
      liveClass.mockTestId,
      liveClass.mockTestTitle,
      liveClass.title,
      liveClass.instructor,
      liveClass.startTime,
      liveClass.durationMinutes,
      liveClass.provider,
      liveClass.mode,
      liveClass.status,
      liveClass.livePlaybackUrl,
      liveClass.livePlaybackType,
      liveClass.embedUrl,
      liveClass.roomUrl,
      liveClass.recordingUrl,
      liveClass.replayCourseId,
      liveClass.replayLessonId,
      liveClass.chatEnabled,
      liveClass.doubtSolving,
      liveClass.replayAvailable,
      liveClass.attendees,
      liveClass.maxAttendees,
      liveClass.requiresEnrollment,
      liveClass.recordingStorageProvider,
      liveClass.recordingStoragePath,
      liveClass.recordingPublishedAt,
      liveClass.recordingExpiresAt,
      liveClass.recordingDurationMinutes,
      liveClass.posterUrl,
      liveClass.description,
      JSON.stringify(liveClass.teacherProfile || {}),
      JSON.stringify(liveClass.sessionNotes || []),
      JSON.stringify(liveClass.resources || []),
      JSON.stringify(liveClass.activePoll || null),
      JSON.stringify(liveClass.topicTags || []),
    ],
    client,
  );

  return liveClass;
};

const insertPgLiveChatMessage = async (payload, client = null) => {
  const message = {
    _id: payload._id || createPersistentId('live_chat'),
    liveClassId: String(payload.liveClassId),
    userId: String(payload.userId),
    userName: payload.userName,
    kind: payload.kind === 'doubt' ? 'doubt' : 'chat',
    message: String(payload.message || ''),
    createdAt: payload.createdAt || nowIso(),
  };

  await pgExec(
    `
      INSERT INTO live_chat_messages (id, live_class_id, user_id, user_name, kind, message, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      message._id,
      message.liveClassId,
      message.userId,
      message.userName,
      message.kind,
      message.message,
      message.createdAt,
    ],
    client,
  );

  return message;
};

const upsertPgSubscriptionPlan = async (payload, client = null) => {
  const plan = {
    _id: payload._id || createPersistentId('plan'),
    title: payload.title,
    description: payload.description || '',
    price: Number(payload.price || 0),
    billingCycle: payload.billingCycle || 'monthly',
    accessType: payload.accessType || 'subscription',
    features: asArray(payload.features),
    createdAt: payload.createdAt || nowIso(),
  };

  await pgExec(
    `
      INSERT INTO subscription_plans (
        id, title, description, price_inr, billing_cycle, access_type, feature_list, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        price_inr = EXCLUDED.price_inr,
        billing_cycle = EXCLUDED.billing_cycle,
        access_type = EXCLUDED.access_type,
        feature_list = EXCLUDED.feature_list
    `,
    [
      plan._id,
      plan.title,
      plan.description,
      plan.price,
      plan.billingCycle,
      plan.accessType,
      JSON.stringify(plan.features || []),
      plan.createdAt,
    ],
    client,
  );

  return plan;
};

const insertPgSubscription = async (payload, client = null) => {
  const subscription = {
    _id: payload._id || createPersistentId('subscription'),
    userId: String(payload.userId),
    planId: String(payload.planId),
    status: payload.status || 'active',
    source: payload.source || 'payment',
    startedAt: payload.startedAt || nowIso(),
    expiresAt: payload.expiresAt || null,
  };

  await pgExec(
    `
      INSERT INTO subscriptions (id, user_id, plan_id, status, source, started_at, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        source = EXCLUDED.source,
        started_at = EXCLUDED.started_at,
        expires_at = EXCLUDED.expires_at
    `,
    [
      subscription._id,
      subscription.userId,
      subscription.planId,
      subscription.status,
      subscription.source,
      subscription.startedAt,
      subscription.expiresAt,
    ],
    client,
  );

  return subscription;
};

const insertPgTestAttempt = async (payload, client = null) => {
  const attempt = {
    _id: payload._id || createPersistentId('attempt'),
    userId: String(payload.userId),
    testId: String(payload.testId),
    score: Number(payload.score || 0),
    totalMarks: Number(payload.totalMarks || 0),
    correctCount: Number(payload.correctCount || 0),
    incorrectCount: Number(payload.incorrectCount || 0),
    unattemptedCount: Number(payload.unattemptedCount || 0),
    percentile: Number(payload.percentile || 0),
    rank: Number(payload.rank || 0),
    answers: asObject(payload.answers),
    weakTopics: asArray(payload.weakTopics),
    strongTopics: asArray(payload.strongTopics),
    solutions: asArray(payload.solutions),
    startedAt: payload.startedAt || nowIso(),
    completedAt: payload.completedAt || nowIso(),
  };

  await pgExec(
    `
      INSERT INTO test_attempts (
        id, user_id, test_id, score, total_marks, correct_count, incorrect_count, unattempted_count,
        percentile, all_india_rank, answers, weak_topics, strong_topics, solutions, started_at, completed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb, $15, $16)
    `,
    [
      attempt._id,
      attempt.userId,
      attempt.testId,
      attempt.score,
      attempt.totalMarks,
      attempt.correctCount,
      attempt.incorrectCount,
      attempt.unattemptedCount,
      attempt.percentile,
      attempt.rank,
      JSON.stringify(attempt.answers || {}),
      JSON.stringify(attempt.weakTopics || []),
      JSON.stringify(attempt.strongTopics || []),
      JSON.stringify(attempt.solutions || []),
      attempt.startedAt,
      attempt.completedAt,
    ],
    client,
  );

  return attempt;
};

const upsertPgQuizAttempt = async (payload, client = null) => {
  const existing = await pgOne(
    'SELECT * FROM daily_quiz_attempts WHERE user_id = $1 AND daily_quiz_id = $2',
    [String(payload.userId), String(payload.quizId)],
    mapQuizAttemptRow,
    client,
  );

  const attempt = {
    _id: existing?._id || payload._id || createPersistentId('quiz_attempt'),
    userId: String(payload.userId),
    quizId: String(payload.quizId),
    score: Number(payload.score || 0),
    total: Number(payload.total || 0),
    submittedAt: payload.submittedAt || nowIso(),
  };

  await pgExec(
    `
      INSERT INTO daily_quiz_attempts (id, user_id, daily_quiz_id, score, total, submitted_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (user_id, daily_quiz_id) DO UPDATE SET
        score = EXCLUDED.score,
        total = EXCLUDED.total,
        submitted_at = EXCLUDED.submitted_at
    `,
    [attempt._id, attempt.userId, attempt.quizId, attempt.score, attempt.total, attempt.submittedAt],
    client,
  );

  await deleteRedisKey(cacheKey('quiz-leaderboard', attempt.quizId));
  await deleteRedisKey(cacheKey('quiz-weekly', 'all'));
  return { attempt, existing };
};

const insertPgReferral = async (payload, client = null) => {
  const referral = {
    _id: payload._id || createPersistentId('referral'),
    referrerUserId: String(payload.referrerUserId),
    referredEmail: normalizeEmail(payload.referredEmail),
    rewardPoints: Number(payload.rewardPoints || 25),
    createdAt: payload.createdAt || nowIso(),
  };

  await pgExec(
    `
      INSERT INTO referrals (id, referrer_user_id, referred_email, reward_points, created_at)
      VALUES ($1, $2, $3, $4, $5)
    `,
    [referral._id, referral.referrerUserId, referral.referredEmail, referral.rewardPoints, referral.createdAt],
    client,
  );

  return referral;
};

const insertPgPayment = async (payload, client = null) => {
  const payment = {
    _id: payload._id || createPersistentId('payment'),
    userId: String(payload.userId || ''),
    amount: Number(payload.amount || 0),
    currency: payload.currency || 'INR',
    item: payload.item || 'Course Purchase',
    status: payload.status || 'pending',
    attemptCount: Number(payload.attemptCount || 1),
    retryable: payload.retryable !== false,
    lastError: payload.lastError || null,
    createdAt: payload.createdAt || nowIso(),
    updatedAt: payload.updatedAt || nowIso(),
  };

  await pgExec(
    `
      INSERT INTO payments (
        id, user_id, amount_inr, currency, item, status,
        attempt_count, retryable, last_error, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (id) DO UPDATE SET
        amount_inr = EXCLUDED.amount_inr,
        currency = EXCLUDED.currency,
        item = EXCLUDED.item,
        status = EXCLUDED.status,
        attempt_count = EXCLUDED.attempt_count,
        retryable = EXCLUDED.retryable,
        last_error = EXCLUDED.last_error,
        updated_at = EXCLUDED.updated_at
    `,
    [
      payment._id,
      payment.userId,
      payment.amount,
      payment.currency,
      payment.item,
      payment.status,
      payment.attemptCount,
      payment.retryable,
      payment.lastError,
      payment.createdAt,
      payment.updatedAt,
    ],
    client,
  );

  return payment;
};

const insertPgWebhook = async (payload, client = null) => {
  const webhook = {
    _id: payload._id || createPersistentId('webhook'),
    event: payload.event || 'payment.updated',
    paymentId: payload.paymentId || null,
    status: payload.status || 'received',
    receivedAt: payload.receivedAt || nowIso(),
    payload: asObject(payload.payload ?? payload),
  };

  await pgExec(
    `
      INSERT INTO payment_webhooks (id, event, payment_id, status, received_at, payload)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
    `,
    [webhook._id, webhook.event, webhook.paymentId, webhook.status, webhook.receivedAt, JSON.stringify(webhook.payload)],
    client,
  );

  return webhook;
};

const insertPgUpload = async (payload, client = null) => {
  const upload = {
    _id: payload._id || createPersistentId('upload'),
    title: payload.title || 'Bulk Upload',
    course: payload.course || null,
    questionCount: Array.isArray(payload.questions) ? payload.questions.length : Number(payload.questionCount || 0),
    createdAt: payload.createdAt || nowIso(),
  };

  await pgExec(
    `
      INSERT INTO admin_uploads (id, title, course_id, question_count, created_at)
      VALUES ($1, $2, $3, $4, $5)
    `,
    [upload._id, upload.title, upload.course, upload.questionCount, upload.createdAt],
    client,
  );

  return upload;
};

const insertPgAiMessage = async (payload, client = null) => {
  const message = {
    _id: payload._id || createPersistentId('ai_message'),
    userId: String(payload.userId),
    message: String(payload.message || ''),
    answer: String(payload.answer || ''),
    createdAt: payload.createdAt || nowIso(),
  };

  await pgExec(
    'INSERT INTO ai_messages (id, user_id, message, answer, created_at) VALUES ($1, $2, $3, $4, $5)',
    [message._id, message.userId, message.message, message.answer, message.createdAt],
    client,
  );

  return message;
};

const insertPgSession = async (payload, client = null) => {
  const session = {
    _id: payload._id || createPersistentId('session'),
    userId: String(payload.userId),
    sessionId: String(payload.sessionId),
    device: payload.device || null,
    status: payload.status || 'active',
    reason: payload.reason || null,
    createdAt: payload.createdAt || nowIso(),
    lastSeenAt: payload.lastSeenAt || nowIso(),
    endedAt: payload.endedAt || (payload.status === 'active' ? null : nowIso()),
  };

  await pgExec(
    `
      INSERT INTO user_sessions (
        id, user_id, jwt_session_id, device, status, reason, created_at, last_seen_at, ended_at
      ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9)
    `,
    [
      session._id,
      session.userId,
      session.sessionId,
      JSON.stringify(session.device),
      session.status,
      session.reason,
      session.createdAt,
      session.lastSeenAt,
      session.endedAt,
    ],
    client,
  );

  return session;
};

const closePgSession = async ({ userId, sessionId, reason = 'logout' }, client = null) => {
  const updated = await pgOne(
    `
      UPDATE user_sessions
      SET status = 'ended', reason = $3, ended_at = now(), last_seen_at = now()
      WHERE user_id = $1 AND jwt_session_id = $2 AND status = 'active'
      RETURNING *
    `,
    [String(userId), String(sessionId), reason],
    mapSessionRow,
    client,
  );

  return updated;
};

const insertPgDeviceActivity = async ({ userId, sessionId = null, device = null, eventType, meta = {} }, client = null) => {
  if (!userId || !eventType) {
    return null;
  }

  const activity = {
    _id: createPersistentId('activity'),
    userId: String(userId),
    sessionId: sessionId ? String(sessionId) : null,
    device: device || null,
    eventType: String(eventType),
    meta: asObject(meta),
    createdAt: nowIso(),
  };

  await pgExec(
    `
      INSERT INTO device_activity (id, user_id, session_id, device, event_type, event_meta, created_at)
      VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb, $7)
    `,
    [
      activity._id,
      activity.userId,
      activity.sessionId,
      JSON.stringify(activity.device),
      activity.eventType,
      JSON.stringify(activity.meta),
      activity.createdAt,
    ],
    client,
  );

  return activity;
};

const getPgUsers = async (client = null) => pgMany('SELECT * FROM users ORDER BY created_at ASC', [], mapUserRow, client);
const getPgCourses = async (client = null) => pgMany('SELECT * FROM courses ORDER BY created_at ASC', [], mapCourseRow, client);
const getPgTests = async (client = null) => pgMany('SELECT * FROM tests ORDER BY created_at ASC', [], mapTestRow, client);
const getPgAttempts = async (client = null) => pgMany('SELECT * FROM test_attempts ORDER BY completed_at ASC', [], mapTestAttemptRow, client);
const getPgQuizzes = async (client = null) => {
  const quizzes = await pgMany('SELECT * FROM daily_quizzes ORDER BY quiz_date ASC', [], mapQuizRow, client);
  const attempts = await pgMany('SELECT * FROM daily_quiz_attempts ORDER BY submitted_at ASC', [], mapQuizAttemptRow, client);
  const attemptMap = attempts.reduce((accumulator, attempt) => {
    if (!accumulator.has(attempt.quizId)) {
      accumulator.set(attempt.quizId, []);
    }
    accumulator.get(attempt.quizId).push({
      userId: attempt.userId,
      score: attempt.score,
      total: attempt.total,
      submittedAt: attempt.submittedAt,
    });
    return accumulator;
  }, new Map());

  return quizzes.map((quiz) => ({
    ...quiz,
    leaderboard: normalizeQuizLeaderboard(attemptMap.get(quiz._id) || []),
  }));
};
const getPgEnrollments = async (client = null) => pgMany('SELECT * FROM enrollments ORDER BY enrolled_at ASC', [], mapEnrollmentRow, client);
const getPgWatchHistory = async (client = null) => pgMany('SELECT * FROM watch_history ORDER BY updated_at DESC', [], mapWatchHistoryRow, client);
const getPgLiveClasses = async (client = null) => pgMany('SELECT * FROM live_classes ORDER BY scheduled_start_at ASC', [], mapLiveClassRow, client);
const getPgLiveChatMessages = async (client = null) => pgMany('SELECT * FROM live_chat_messages ORDER BY created_at ASC', [], mapLiveChatRow, client);
const getPgPlans = async (client = null) => pgMany('SELECT * FROM subscription_plans ORDER BY created_at ASC', [], mapPlanRow, client);
const getPgUserSubscriptions = async (client = null) => pgMany('SELECT * FROM subscriptions ORDER BY started_at DESC', [], mapSubscriptionRow, client);
const getPgAiMessages = async (client = null) => pgMany('SELECT * FROM ai_messages ORDER BY created_at DESC', [], mapAiMessageRow, client);
const getPgSessions = async (client = null) => pgMany('SELECT * FROM user_sessions ORDER BY created_at DESC', [], mapSessionRow, client);
const getPgDeviceActivities = async (client = null) => pgMany('SELECT * FROM device_activity ORDER BY created_at DESC', [], mapDeviceActivityRow, client);
const getPgNotifications = async (client = null) => pgMany('SELECT * FROM notifications ORDER BY created_at DESC', [], mapNotificationRow, client);
const getPgReferrals = async (client = null) => pgMany('SELECT * FROM referrals ORDER BY created_at DESC', [], mapReferralRow, client);
const getPgUploads = async (client = null) => pgMany('SELECT * FROM admin_uploads ORDER BY created_at DESC', [], mapUploadRow, client);
const getPgPayments = async (client = null) => pgMany('SELECT * FROM payments ORDER BY created_at DESC', [], mapPaymentRow, client);
const getPgWebhooks = async (client = null) => pgMany('SELECT * FROM payment_webhooks ORDER BY received_at DESC', [], mapWebhookRow, client);

const loadPlatformData = async () => {
  await ensurePlatformReady();

  if (isPostgresMode()) {
    const [
      users,
      courses,
      tests,
      testAttempts,
      quizzes,
      enrollments,
      watchHistory,
      liveClasses,
      liveChatMessages,
      subscriptions,
      userSubscriptions,
      aiMessages,
      loginSessions,
      deviceActivities,
      notifications,
      referrals,
      uploads,
      payments,
      webhooks,
    ] = await Promise.all([
      getPgUsers(),
      getPgCourses(),
      getPgTests(),
      getPgAttempts(),
      getPgQuizzes(),
      getPgEnrollments(),
      getPgWatchHistory(),
      getPgLiveClasses(),
      getPgLiveChatMessages(),
      getPgPlans(),
      getPgUserSubscriptions(),
      getPgAiMessages(),
      getPgSessions(),
      getPgDeviceActivities(),
      getPgNotifications(),
      getPgReferrals(),
      getPgUploads(),
      getPgPayments(),
      getPgWebhooks(),
    ]);

    return {
      users,
      courses,
      tests,
      testAttempts,
      quizzes,
      enrollments,
      watchHistory,
      liveClasses,
      liveChatMessages,
      subscriptions,
      userSubscriptions,
      aiMessages,
      loginSessions,
      deviceActivities,
      notifications,
      referrals,
      uploads,
      payments,
      webhooks,
    };
  }

  return state;
};

const ensurePlatformReady = async () => {
  await ensurePersistentDatabaseAvailability();
  await ensureDefaultAdminUser();
  return 'ready';
};

const getRecentSessions = (data, userId) =>
  data.loginSessions
    .filter((entry) => !userId || entry.userId === String(userId))
    .slice(0, 8)
    .map((entry) => clone(entry));

const getRecentDeviceActivity = (data, userId) =>
  data.deviceActivities
    .filter((entry) => !userId || entry.userId === String(userId))
    .slice(0, 8)
    .map((entry) => clone(entry));

const getUserByIdFromData = (data, userId) => data.users.find((user) => user._id === String(userId)) || null;

const sessionRepository = {
  async getActiveSessionId(userId, fallback = null) {
    const cached = await getRedisValue(cacheKey('user-session', String(userId)));
    if (cached) {
      return cached;
    }

    if (isPostgresMode()) {
      const user = await pgOne('SELECT active_session_id FROM users WHERE id = $1', [String(userId)], (row) => row);
      return user?.active_session_id || fallback || null;
    }

    return fallback || null;
  },

  async setActiveSession({ userId, sessionId }) {
    await setRedisValue(cacheKey('user-session', String(userId)), String(sessionId), { ttlSeconds: 7 * 24 * 60 * 60 });
  },

  async clearActiveSession(userId) {
    await deleteRedisKey(cacheKey('user-session', String(userId)));
  },

  async recordLogin({ userId, sessionId, device }) {
    if (isPostgresMode()) {
      await runInTransaction(async (client) => {
        await pgExec(
          'UPDATE user_sessions SET status = $2, reason = $3, ended_at = now(), last_seen_at = now() WHERE user_id = $1 AND status = $4',
          [String(userId), 'ended', 'replaced', 'active'],
          client,
        );
        await insertPgSession({ userId, sessionId, device, status: 'active' }, client);
        await insertPgDeviceActivity({
          userId,
          sessionId,
          device,
          eventType: 'login',
          meta: {},
        }, client);
      });
      await sessionRepository.setActiveSession({ userId, sessionId });
      return;
    }

    const session = {
      _id: nextId('session'),
      userId: String(userId),
      sessionId: String(sessionId),
      device: device || null,
      status: 'active',
      reason: null,
      createdAt: nowIso(),
      lastSeenAt: nowIso(),
      endedAt: null,
    };

    state.loginSessions.unshift(session);
    state.loginSessions = state.loginSessions.slice(0, 200);
    state.deviceActivities.unshift({
      _id: nextId('activity'),
      userId: String(userId),
      sessionId: String(sessionId),
      device: device || null,
      eventType: 'login',
      meta: {},
      createdAt: nowIso(),
    });
    state.deviceActivities = state.deviceActivities.slice(0, 200);
    await sessionRepository.setActiveSession({ userId, sessionId });
  },

  async recordLogout({ userId, sessionId, device, reason = 'logout' }) {
    if (isPostgresMode()) {
      await runInTransaction(async (client) => {
        await closePgSession({ userId, sessionId, reason }, client);
        await insertPgDeviceActivity({
          userId,
          sessionId,
          device,
          eventType: 'logout',
          meta: { reason },
        }, client);
      });
      await sessionRepository.clearActiveSession(userId);
      return;
    }

    const sessionIndex = state.loginSessions.findIndex(
      (entry) => entry.userId === String(userId) && entry.sessionId === String(sessionId) && entry.status === 'active',
    );
    if (sessionIndex >= 0) {
      state.loginSessions[sessionIndex] = {
        ...state.loginSessions[sessionIndex],
        status: 'ended',
        reason,
        endedAt: nowIso(),
        lastSeenAt: nowIso(),
      };
    }

    state.deviceActivities.unshift({
      _id: nextId('activity'),
      userId: String(userId),
      sessionId: String(sessionId),
      device: device || null,
      eventType: 'logout',
      meta: { reason },
      createdAt: nowIso(),
    });
    state.deviceActivities = state.deviceActivities.slice(0, 200);
    await sessionRepository.clearActiveSession(userId);
  },

  async replaceActiveSession({ userId, sessionId, device }) {
    await sessionRepository.recordLogin({ userId, sessionId, device });
  },

  async getRecentSessions(userId) {
    const data = await loadPlatformData();
    return getRecentSessions(data, userId);
  },

  async getRecentDeviceActivity(userId) {
    const data = await loadPlatformData();
    return getRecentDeviceActivity(data, userId);
  },
};

const usersRepository = {
  async listSafe() {
    await ensurePlatformReady();

    if (isPostgresMode()) {
      return pgMany('SELECT * FROM users ORDER BY created_at ASC', [], (row) => sanitizeUser(mapUserRow(row)));
    }

    if (isMongoMode()) {
      return User.find().select('-password').lean();
    }

    return state.users.map((user) => sanitizeUser(user));
  },

  async findByEmail(email) {
    await ensurePlatformReady();

    if (isPostgresMode()) {
      return pgOne('SELECT * FROM users WHERE email = $1', [normalizeEmail(email)], mapUserRow);
    }

    if (isMongoMode()) {
      return User.findOne({ email: normalizeEmail(email) });
    }

    return state.users.find((user) => user.email === normalizeEmail(email)) || null;
  },

  async findById(id) {
    await ensurePlatformReady();

    if (isPostgresMode()) {
      return pgOne('SELECT * FROM users WHERE id = $1', [String(id)], mapUserRow);
    }

    if (isMongoMode()) {
      return User.findById(id);
    }

    return state.users.find((user) => user._id === String(id)) || null;
  },

  async findSafeById(id) {
    const user = await usersRepository.findById(id);
    return sanitizeUser(user);
  },

  async create(payload) {
    if (isPostgresMode()) {
      const createdUser = await upsertPgUser({
        ...payload,
        _id: payload._id || createPersistentId('user'),
        email: normalizeEmail(payload.email),
      });
      return clone(createdUser);
    }

    if (isMongoMode()) {
      const createdUser = await User.create({
        ...payload,
        email: normalizeEmail(payload.email),
      });
      return createdUser.toObject();
    }

    const createdUser = {
      _id: payload._id || nextId('user'),
      name: payload.name,
      email: normalizeEmail(payload.email),
      password: payload.password,
      role: payload.role || 'student',
      device: payload.device || null,
      session: payload.session || null,
      streak: payload.streak ?? 0,
      points: payload.points ?? 0,
      badges: Array.isArray(payload.badges) ? clone(payload.badges) : [],
      referral_code: payload.referral_code || null,
      created_at: payload.created_at || nowIso(),
      updated_at: payload.updated_at || nowIso(),
    };

    state.users.push(createdUser);
    return clone(createdUser);
  },

  async update(id, patch) {
    if (isPostgresMode()) {
      const current = await usersRepository.findById(id);
      if (!current) {
        return null;
      }

      const merged = {
        ...current,
        ...clone(patch),
        updated_at: nowIso(),
      };
      await upsertPgUser(merged);
      return clone(merged);
    }

    if (isMongoMode()) {
      const updatedUser = await User.findByIdAndUpdate(id, patch, { new: true });
      return updatedUser ? updatedUser.toObject() : null;
    }

    const userIndex = state.users.findIndex((user) => user._id === String(id));
    if (userIndex === -1) {
      return null;
    }

    state.users[userIndex] = {
      ...state.users[userIndex],
      ...clone(patch),
      updated_at: nowIso(),
    };

    return clone(state.users[userIndex]);
  },
};

const coursesRepository = {
  async list() {
    await ensurePlatformReady();

    const cacheKeyCourses = cacheKey('courses', 'list');
    const courseCacheTtlMs = Math.max(1000, Number(appConfig.courseCacheTtlMs || platformDataCacheTtlMs));

    try {
      const cached = await getRedisJson(cacheKeyCourses);
      if (cached) {
        return cached;
      }
    } catch (e) {
      // ignore
    }

    let courses;
    if (isPostgresMode()) {
      courses = await getPgCourses();
    } else if (isMongoMode()) {
      courses = await Course.find().lean();
    } else {
      courses = state.courses.map((course) => clone(course));
    }

    try {
      await setRedisJson(cacheKeyCourses, courses, { ttlSeconds: Math.ceil(courseCacheTtlMs / 1000) });
    } catch (e) {}

    return courses;
  },

  async listForViewer(userId) {
    const courses = await coursesRepository.list();
    let enrollments = [];
    let isAdmin = false;

    if (userId) {
      const user = await usersRepository.findSafeById(userId);
      isAdmin = user?.role === 'admin';

      if (isPostgresMode()) {
        enrollments = await pgMany(
        `SELECT * FROM enrollments WHERE user_id = $1 AND ${activeEnrollmentSql}`,
          [String(userId)],
          mapEnrollmentRow,
        );
      } else {
        enrollments = filterActiveEnrollments(state.enrollments.filter((entry) => entry.userId === String(userId)));
      }
    }

    const enrolledCourseIds = new Set(enrollments.map((entry) => entry.courseId));
    return courses.map((course) => redactCourseForViewer(course, isAdmin || enrolledCourseIds.has(course._id)));
  },

  async findById(id) {
    await ensurePlatformReady();

    if (isPostgresMode()) {
      return pgOne('SELECT * FROM courses WHERE id = $1', [String(id)], mapCourseRow);
    }

    if (isMongoMode()) {
      return Course.findById(id).lean();
    }

    return clone(state.courses.find((course) => course._id === String(id)) || null);
  },

  async findVisibleById(id, userId) {
    const course = await coursesRepository.findById(id);
    if (!course) {
      return null;
    }

    let isEnrolled = false;
    let isAdmin = false;
    if (userId) {
      const user = await usersRepository.findSafeById(userId);
      isAdmin = user?.role === 'admin';

      if (isPostgresMode()) {
        const row = await pgOne(
          `SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2 AND ${activeEnrollmentSql}`,
          [String(userId), String(id)],
          (entry) => entry,
        );
        isEnrolled = Boolean(row);
      } else {
        isEnrolled = state.enrollments.some((entry) => entry.userId === String(userId) && entry.courseId === String(id) && isEnrollmentActive(entry));
      }
    }

    return redactCourseForViewer(course, isAdmin || isEnrolled);
  },

  async create(payload) {
    if (isPostgresMode()) {
      const course = await upsertPgCourse(payload);
      return clone(course);
    }

    if (isMongoMode()) {
      const createdCourse = await Course.create(payload);
      return createdCourse.toObject();
    }

    const createdCourse = {
      _id: payload._id || nextId('course'),
      title: payload.title,
      description: payload.description || '',
      category: payload.category || 'SSC JE',
      exam: payload.exam || payload.category || 'SSC JE',
      subject: payload.subject || 'General',
      level: payload.level || 'Full Course',
      price: Number(payload.price || 0),
      validityDays: Number(payload.validityDays || courseDefaultValidityDays),
      thumbnailUrl: payload.thumbnailUrl || '',
      instructor: payload.instructor || 'VARONENGLISH Faculty',
      officialChannelUrl: payload.officialChannelUrl || null,
      modules: Array.isArray(payload.modules) ? clone(payload.modules) : [],
      createdBy: payload.createdBy || null,
      created_at: payload.created_at || nowIso(),
    };

    state.courses.push(createdCourse);
    return clone(createdCourse);
  },

  async listLessons(courseId, userId) {
    const course = await coursesRepository.findById(courseId);
    if (!course) {
      return [];
    }

    let isEnrolled = false;
    let isAdmin = false;
    if (userId) {
      const user = await usersRepository.findSafeById(userId);
      isAdmin = user?.role === 'admin';

      if (isPostgresMode()) {
        const row = await pgOne(
          `SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2 AND ${activeEnrollmentSql}`,
          [String(userId), String(courseId)],
          (entry) => entry,
        );
        isEnrolled = Boolean(row);
      } else {
        isEnrolled = state.enrollments.some((entry) => entry.userId === String(userId) && entry.courseId === String(courseId) && isEnrollmentActive(entry));
      }
    }

    return lessonListFromCourse(redactCourseForViewer(course, isAdmin || isEnrolled));
  },

  async updateCourseModule(courseId, updatedCourse) {
    if (isPostgresMode()) {
      await upsertPgCourse({
        _id: courseId,
        ...updatedCourse,
      });
      return updatedCourse;
    }

    if (isMongoMode()) {
      const updated = await Course.findByIdAndUpdate(
        courseId,
        {
          title: updatedCourse.title,
          description: updatedCourse.description,
          category: updatedCourse.category,
          exam: updatedCourse.exam,
          subject: updatedCourse.subject,
          level: updatedCourse.level,
          price: Number(updatedCourse.price || 0),
          validityDays: Number(updatedCourse.validityDays || 365),
          thumbnailUrl: updatedCourse.thumbnailUrl,
          instructor: updatedCourse.instructor,
          officialChannelUrl: updatedCourse.officialChannelUrl,
          modules: updatedCourse.modules,
          createdBy: updatedCourse.createdBy || null,
          created_at: updatedCourse.created_at,
          updated_at: updatedCourse.updated_at || nowIso(),
        },
        { new: true },
      );
      return updated?.toObject?.() || updatedCourse;
    }

    const courseIndex = state.courses.findIndex((course) => course._id === String(courseId));
    if (courseIndex === -1) {
      return null;
    }

    state.courses[courseIndex] = {
      ...state.courses[courseIndex],
      ...clone(updatedCourse),
      _id: state.courses[courseIndex]._id,
      modules: clone(updatedCourse.modules || []),
      updated_at: nowIso(),
    };

    return clone(state.courses[courseIndex]);
  },

  async updateLesson(courseId, lessonId, updater) {
    const course = await coursesRepository.findById(courseId);
    if (!course) {
      return null;
    }

    const { modules, updatedLesson } = updateLessonInModules(course.modules || [], lessonId, updater);
    if (!updatedLesson) {
      return null;
    }

    course.modules = modules;
    course.updated_at = nowIso();
    await coursesRepository.updateCourseModule(courseId, course);
    return clone(updatedLesson);
  },

  async getProtectedLessonPlayback({
    userId,
    courseId,
    lessonId,
    enforceEnrollment = true,
    enforceSequentialUnlock = true,
  }) {
    const course = await coursesRepository.findById(courseId);
    if (!course) {
      throw new ApiError(404, 'Course not found', { code: 'COURSE_NOT_FOUND' });
    }

    const user = await usersRepository.findSafeById(userId);
    if (!user) {
      throw new ApiError(401, 'Authorization token required', { code: 'AUTH_REQUIRED' });
    }

    const isAdmin = user.role === 'admin';
    let isEnrolled = isAdmin || !enforceEnrollment;

    if (!isEnrolled) {
      if (isPostgresMode()) {
        const row = await pgOne(
          `SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2 AND ${activeEnrollmentSql}`,
          [String(userId), String(courseId)],
          (entry) => entry,
        );
        isEnrolled = Boolean(row);
      } else {
        const data = await loadPlatformData();
        isEnrolled = data.enrollments.some((entry) => entry.userId === String(userId) && entry.courseId === String(courseId) && isEnrollmentActive(entry));
      }
    }

    if (!isEnrolled) {
      throw new ApiError(403, 'Course enrollment is required to access this lesson', { code: 'COURSE_ACCESS_REQUIRED' });
    }

    const lesson = findLessonInCourse(course, lessonId);
    if (!lesson) {
      throw new ApiError(404, 'Lesson not found', { code: 'LESSON_NOT_FOUND' });
    }

    const data = await loadPlatformData();
    if (enforceSequentialUnlock && !isAdmin && !isLessonSequentiallyUnlocked(course, userId, lessonId, data)) {
      throw new ApiError(403, 'Finish the previous topic to unlock this lesson', { code: 'SEQUENTIAL_LOCKED' });
    }

    const lessonProgress = lessonProgressMapForCourse(data, userId, courseId).get(String(lessonId));

    if (lesson.type === 'youtube') {
      const decryptedId = decryptVideoId(lesson.youtubeVideoIdCiphertext) || normalizeYouTubeVideoId(lesson.videoUrl);
      const embedUrl = buildSecureYouTubeEmbedUrl(decryptedId, {
        startSeconds: lessonProgress?.progressSeconds || 0,
      });

      if (!embedUrl) {
        throw new ApiError(500, 'Protected lesson could not be prepared for playback', { code: 'EMBED_BUILD_FAILED' });
      }

      return {
        playerType: 'youtube',
        embedUrl,
        streamUrl: null,
        watermarkText: `${user.email} • ${user._id}`,
        resumeSeconds: Number(lessonProgress?.progressSeconds || 0),
        completed: Boolean(lessonProgress?.completed),
        tokenExpiresAt: null,
        drmEnabled: false,
      };
    }

    if (lesson.type === 'private-video') {
      const hlsReady = lesson.deliveryStrategy === 'hls'
        && lesson.hlsProcessingStatus === 'ready'
        && lesson.hlsPlaybackPath;
      if (!hlsReady && !lesson.storagePath) {
        throw new ApiError(500, 'Private video storage path is missing', { code: 'PRIVATE_VIDEO_PATH_MISSING' });
      }
      const grant = await consumeReplayGrant({
        userId,
        courseId,
        lessonId,
        sessionId: user.session || null,
        enforceEnrollment,
        enforceSequentialUnlock,
      });
      const playbackPath = hlsReady ? String(lesson.hlsPlaybackPath) : String(lesson.storagePath);
      const playbackMimeType = hlsReady ? 'application/vnd.apple.mpegurl' : (lesson.mimeType || 'video/mp4');
      const playbackProvider = hlsReady
        ? (lesson.hlsStorageProvider || lesson.storageProvider || 'local')
        : (lesson.storageProvider || 'local');

      const issuedToken = issuePlaybackToken({
        userId: String(userId),
        sessionId: user.session || null,
        courseId: String(courseId),
        lessonId: String(lessonId),
        storageProvider: playbackProvider,
        storagePath: playbackPath,
        mimeType: playbackMimeType,
        assetKind: hlsReady ? 'hls' : 'source',
      });

      return {
        playerType: 'private-video',
        embedUrl: null,
        streamUrl: `/backend/api/courses/stream/${issuedToken.token}`,
        streamFormat: hlsReady ? 'hls' : 'source',
        playbackStatus: hlsReady ? 'ready' : (lesson.hlsProcessingStatus || 'ready'),
        deliveryProfile: lesson.deliveryProfile || 'private-source',
        availableQualities: Array.isArray(lesson.targetQualities) ? lesson.targetQualities : [],
        statusMessage: hlsReady
          ? 'Adaptive stream ready.'
          : lesson.hlsProcessingStatus === 'processing' || lesson.hlsProcessingStatus === 'queued'
            ? 'Adaptive HLS processing is running. Protected source playback is available now.'
            : lesson.hlsProcessingError
              ? 'Adaptive HLS processing failed. Protected source playback is available.'
              : 'Protected source playback is available.',
        watermarkText: `${user.email} • ${user._id}`,
        resumeSeconds: Number(lessonProgress?.progressSeconds || 0),
        completed: Boolean(lessonProgress?.completed),
        tokenExpiresAt: issuedToken.expiresAt,
        drmEnabled: Boolean(appConfig.privateVideoDrmEnabled),
        playbackGrantExpiresAt: grant.expiresAt || null,
        playbackGrantRemainingViews: hasReplayViewLimit()
          ? Number(grant.maxViews || replayMaxViews) - Number(grant.usedViews || 0)
          : null,
      };
    }

    throw new ApiError(400, 'Secure playback is only available for protected lessons', { code: 'UNSUPPORTED_LESSON_TYPE' });
  },
};

const testsRepository = {
  async list() {
    await ensurePlatformReady();

    if (isPostgresMode()) {
      return getPgTests();
    }

    if (isMongoMode()) {
      return Test.find().lean();
    }

    return state.tests.map((test) => clone(test));
  },

  async listForAttempt() {
    const tests = await testsRepository.list();
    return tests.map((test) => redactTestForAttempt(test));
  },

  async findById(id) {
    await ensurePlatformReady();

    if (isPostgresMode()) {
      return pgOne('SELECT * FROM tests WHERE id = $1', [String(id)], mapTestRow);
    }

    if (isMongoMode()) {
      return Test.findById(id).lean();
    }

    return clone(state.tests.find((test) => test._id === String(id)) || null);
  },

  async findAttemptById(id) {
    const test = await testsRepository.findById(id);
    return test ? redactTestForAttempt(test) : null;
  },

  async create(payload) {
    if (isPostgresMode()) {
      const test = await upsertPgTest(payload);
      return clone(test);
    }

    if (isMongoMode()) {
      const createdTest = await Test.create(payload);
      return createdTest.toObject();
    }

    const questions = Array.isArray(payload.questions)
      ? payload.questions.map((question, index) => ({
          id: question.id || nextId(`question_${index + 1}`),
          answer: question.answer ?? question.correctOption,
          correctOption: question.correctOption ?? question.answer,
          explanation: question.explanation || '',
          marks: Number(question.marks || 1),
          topic: question.topic || 'General Practice',
          ...clone(question),
        }))
      : [];

    const createdTest = {
      _id: payload._id || nextId('test'),
      title: payload.title,
      description: payload.description || '',
      category: payload.category || 'SSC JE',
      type: payload.type || 'full-length',
      durationMinutes: Number(payload.durationMinutes || 60),
      totalMarks: Number(payload.totalMarks || questions.reduce((sum, question) => sum + Number(question.marks || 1), 0)),
      negativeMarking: Number(payload.negativeMarking || 0),
      sectionBreakup: Array.isArray(payload.sectionBreakup) ? clone(payload.sectionBreakup) : [],
      course: payload.course || null,
      questions,
      created_at: payload.created_at || nowIso(),
    };

    state.tests.push(createdTest);
    return clone(createdTest);
  },

  async update(testId, payload) {
    await ensurePlatformReady();
    const current = await testsRepository.findById(testId);
    if (!current) {
      return null;
    }

    const nextPayload = {
      ...current,
      ...clone(payload || {}),
      _id: current._id,
      created_at: current.created_at || nowIso(),
    };

    if (isPostgresMode()) {
      return upsertPgTest(nextPayload);
    }

    if (isMongoMode()) {
      const updatedTest = await Test.findByIdAndUpdate(
        testId,
        nextPayload,
        { new: true, overwrite: true },
      );
      return updatedTest ? updatedTest.toObject() : null;
    }

    const index = state.tests.findIndex((test) => test._id === String(testId));
    if (index === -1) {
      return null;
    }

    const questions = Array.isArray(nextPayload.questions)
      ? nextPayload.questions.map((question, questionIndex) => ({
          id: question.id || nextId(`question_${questionIndex + 1}`),
          answer: question.answer ?? question.correctOption,
          correctOption: question.correctOption ?? question.answer,
          explanation: question.explanation || '',
          marks: Number(question.marks || 1),
          topic: question.topic || 'General Practice',
          ...clone(question),
        }))
      : [];

    const updatedTest = {
      _id: current._id,
      title: nextPayload.title,
      description: nextPayload.description || '',
      category: nextPayload.category || 'SSC JE',
      type: nextPayload.type || 'full-length',
      durationMinutes: Number(nextPayload.durationMinutes || 60),
      totalMarks: Number(nextPayload.totalMarks || questions.reduce((sum, question) => sum + Number(question.marks || 1), 0)),
      negativeMarking: Number(nextPayload.negativeMarking || 0),
      sectionBreakup: Array.isArray(nextPayload.sectionBreakup) ? clone(nextPayload.sectionBreakup) : [],
      course: nextPayload.course || null,
      questions,
      created_at: current.created_at || nowIso(),
    };

    state.tests[index] = updatedTest;
    return clone(updatedTest);
  },

  async delete(testId) {
    await ensurePlatformReady();

    if (isPostgresMode()) {
      await pgExec('DELETE FROM tests WHERE id = $1', [String(testId)]);
      return true;
    }

    if (isMongoMode()) {
      await Test.findByIdAndDelete(testId);
      return true;
    }

    const index = state.tests.findIndex((test) => test._id === String(testId));
    if (index === -1) {
      return false;
    }

    state.tests.splice(index, 1);
    state.testAttempts = state.testAttempts.filter((attempt) => attempt.testId !== String(testId));
    return true;
  },

  async submit(testId, payload) {
    await ensurePlatformReady();
    const test = await testsRepository.findById(testId);
    if (!test) {
      return null;
    }

    const answers = payload.answers || {};
    let score = 0;
    let correctCount = 0;
    let incorrectCount = 0;
    let unattemptedCount = 0;
    const topicStats = new Map();

    test.questions.forEach((question) => {
      const submittedAnswer = answers[question.id];
      const topic = question.topic || 'General Practice';
      const currentStats = topicStats.get(topic) || { correct: 0, incorrect: 0 };

      if (submittedAnswer === undefined || submittedAnswer === null) {
        unattemptedCount += 1;
      } else if (Number(submittedAnswer) === Number(question.correctOption ?? question.answer)) {
        correctCount += 1;
        score += Number(question.marks || 1);
        currentStats.correct += 1;
      } else {
        incorrectCount += 1;
        score -= Number(test.negativeMarking || 0);
        currentStats.incorrect += 1;
      }

      topicStats.set(topic, currentStats);
    });

    const solutions = test.questions.map((question) => ({
      questionId: question.id,
      questionText: question.questionText,
      selectedOption: answers[question.id] ?? null,
      correctOption: Number(question.correctOption ?? question.answer),
      explanation: question.explanation || '',
      topic: question.topic || 'General Practice',
    }));

    const weakTopics = [];
    const strongTopics = [];
    topicStats.forEach((stats, topic) => {
      if (stats.incorrect > stats.correct) {
        weakTopics.push(topic);
      } else if (stats.correct > 0) {
        strongTopics.push(topic);
      }
    });

    if (isPostgresMode()) {
      return runInTransaction(async (client) => {
        const existingScores = await pgMany('SELECT score FROM test_attempts', [], (row) => Number(row.score || 0), client);
        const rankedAttempts = [...existingScores, score].sort((left, right) => right - left);
        const rank = rankedAttempts.findIndex((attemptScore) => Number(attemptScore) === score) + 1;
        const percentile = rankedAttempts.length === 0
          ? 0
          : Number((((rankedAttempts.length - rank) / rankedAttempts.length) * 100).toFixed(2));

        const attempt = await insertPgTestAttempt({
          userId: payload.userId,
          testId: test._id,
          score: Number(score.toFixed(2)),
          totalMarks: Number(test.totalMarks || 0),
          correctCount,
          incorrectCount,
          unattemptedCount,
          percentile,
          rank,
          answers,
          weakTopics,
          strongTopics,
          solutions,
          startedAt: payload.startedAt || nowIso(),
          completedAt: nowIso(),
        }, client);

        const user = await pgOne('SELECT * FROM users WHERE id = $1', [String(payload.userId)], mapUserRow, client);
        if (user) {
          await upsertPgUser({
            ...user,
            points: Number(user.points || 0) + Math.max(Math.round(score), 0),
          }, client);

          await insertPgDeviceActivity({
            userId: user._id,
            sessionId: user.session,
            device: user.device,
            eventType: 'mock_test_submitted',
            meta: {
              testId: test._id,
              score: attempt.score,
              percentile: attempt.percentile,
            },
          }, client);
        }

        return attempt;
      });
    }

    const rankedAttempts = [...state.testAttempts, { score }].sort((left, right) => Number(right.score) - Number(left.score));
    const rank = rankedAttempts.findIndex((attempt) => Number(attempt.score) === score) + 1;
    const percentile = rankedAttempts.length === 0
      ? 0
      : Number((((rankedAttempts.length - rank) / rankedAttempts.length) * 100).toFixed(2));

    const attempt = {
      _id: nextId('attempt'),
      userId: String(payload.userId),
      testId: test._id,
      score: Number(score.toFixed(2)),
      totalMarks: Number(test.totalMarks || 0),
      correctCount,
      incorrectCount,
      unattemptedCount,
      percentile,
      rank,
      answers: clone(answers),
      weakTopics,
      strongTopics,
      solutions,
      startedAt: payload.startedAt || nowIso(),
      completedAt: nowIso(),
    };

    state.testAttempts.push(attempt);

    const user = state.users.find((item) => item._id === String(payload.userId));
    if (user) {
      user.points += Math.max(Math.round(score), 0);
      state.deviceActivities.unshift({
        _id: nextId('activity'),
        userId: user._id,
        sessionId: user.session,
        device: user.device,
        eventType: 'mock_test_submitted',
        meta: {
          testId: test._id,
          score: attempt.score,
          percentile: attempt.percentile,
        },
        createdAt: nowIso(),
      });
      state.deviceActivities = state.deviceActivities.slice(0, 200);
    }

    return clone(attempt);
  },

  async listAttempts(userId) {
    await ensurePlatformReady();

    if (isPostgresMode()) {
      return pgMany(
        'SELECT * FROM test_attempts WHERE user_id = $1 ORDER BY completed_at DESC',
        [String(userId)],
        mapTestAttemptRow,
      );
    }

    return state.testAttempts
      .filter((attempt) => attempt.userId === String(userId))
      .sort((left, right) => sortRecentFirst(left, right, 'completedAt'))
      .map((attempt) => clone(attempt));
  },
};

const quizzesRepository = {
  async create(payload) {
    await ensurePlatformReady();

    if (isPostgresMode()) {
      return upsertPgQuiz(payload);
    }

    const quizDate = String(payload.date || '').slice(0, 10);
    const existingQuizIndex = state.quizzes.findIndex((quiz) => quiz.date === quizDate);

    const createdQuiz = {
      _id: existingQuizIndex >= 0 ? state.quizzes[existingQuizIndex]._id : payload._id || nextId('quiz'),
      date: quizDate,
      questions: Array.isArray(payload.questions) ? clone(payload.questions) : [],
      leaderboard: existingQuizIndex >= 0 ? state.quizzes[existingQuizIndex].leaderboard : [],
      createdAt: payload.createdAt || nowIso(),
    };

    if (existingQuizIndex >= 0) {
      state.quizzes[existingQuizIndex] = createdQuiz;
    } else {
      state.quizzes.push(createdQuiz);
    }

    return clone(createdQuiz);
  },

  async findByDate(date) {
    await ensurePlatformReady();
    const dateKey = String(date).slice(0, 10);
    const cacheKeyQuizDate = cacheKey('quiz', `date:${dateKey}`);
    const quizCacheTtlMs = Math.max(500, Number(appConfig.quizCacheTtlMs || 3000));

    try {
      const cached = await getRedisJson(cacheKeyQuizDate);
      if (cached) return cached;
    } catch (e) {}

    if (isPostgresMode()) {
      const quiz = await pgOne(
        'SELECT * FROM daily_quizzes WHERE quiz_date = $1',
        [String(date).slice(0, 10)],
        mapQuizRow,
      );
      if (!quiz) {
        return null;
      }

      const leaderboard = await quizzesRepository.getLeaderboard(quiz._id);
      return {
        ...quiz,
        leaderboard: leaderboard ? normalizeQuizLeaderboard(leaderboard) : [],
      };
    }

    const result = clone(state.quizzes.find((quiz) => quiz.date === String(date).slice(0, 10)) || null);
    try { await setRedisJson(cacheKeyQuizDate, result, { ttlSeconds: Math.ceil(quizCacheTtlMs / 1000) }); } catch (e) {}
    return result;
  },

  async findById(id) {
    await ensurePlatformReady();

    if (isPostgresMode()) {
      const quiz = await pgOne('SELECT * FROM daily_quizzes WHERE id = $1', [String(id)], mapQuizRow);
      if (!quiz) {
        return null;
      }

      const leaderboard = await quizzesRepository.getLeaderboard(quiz._id);
      return {
        ...quiz,
        leaderboard: leaderboard ? normalizeQuizLeaderboard(leaderboard) : [],
      };
    }

    return clone(state.quizzes.find((quiz) => quiz._id === String(id)) || null);
  },

  async submitAttempt({ quizId, userId, answers }) {
    await ensurePlatformReady();
    const quiz = await quizzesRepository.findById(quizId);
    if (!quiz) {
      return null;
    }

    const submittedAnswers = Array.isArray(answers) ? answers : [];
    const score = quiz.questions.reduce((total, question, index) => (
      submittedAnswers[index] === question.answer ? total + 1 : total
    ), 0);

    const review = quiz.questions.map((question, index) => ({
      questionId: question.id,
      prompt: question.prompt,
      selectedAnswer: submittedAnswers[index] || '',
      correctAnswer: question.answer,
      explanation: question.explanation || '',
      topic: question.topic || 'General Practice',
    }));

    if (isPostgresMode()) {
      return runInTransaction(async (client) => {
        const { attempt, existing } = await upsertPgQuizAttempt({
          quizId,
          userId,
          score,
          total: quiz.questions.length,
          submittedAt: nowIso(),
        }, client);

        const user = await pgOne('SELECT * FROM users WHERE id = $1', [String(userId)], mapUserRow, client);
        if (user) {
          const priorScore = existing ? Number(existing.score || 0) : 0;
          const pointsDelta = Math.max(score - priorScore, 0) * 10;
          const nextPoints = Number(user.points || 0) + pointsDelta;
          const nextStreak = Number(user.streak || 0) + (existing ? 0 : 1);
          const nextBadges = asArray(user.badges);
          if (nextPoints >= 50 && !nextBadges.some((badge) => badge.code === 'quiz_starter')) {
            nextBadges.push({ code: 'quiz_starter', label: 'Quiz Starter' });
          }

          await upsertPgUser({
            ...user,
            points: nextPoints,
            streak: nextStreak,
            badges: nextBadges,
          }, client);

          await insertPgDeviceActivity({
            userId: user._id,
            sessionId: user.session,
            device: user.device,
            eventType: 'daily_quiz_submitted',
            meta: {
              quizId: quiz._id,
              score,
              total: quiz.questions.length,
            },
          }, client);
        }

        return {
          score,
          total: quiz.questions.length,
          leaderboardEntry: {
            userId: String(userId),
            score,
            total: quiz.questions.length,
            submittedAt: attempt.submittedAt,
          },
          review,
        };
      });
    }

    const quizIndex = state.quizzes.findIndex((item) => item._id === String(quizId));
    const entry = {
      userId: String(userId),
      score,
      total: quiz.questions.length,
      submittedAt: nowIso(),
    };

    state.quizzes[quizIndex].leaderboard.push(entry);

    const user = state.users.find((item) => item._id === String(userId));
    if (user) {
      user.points += score * 10;
      user.streak += 1;
      if (user.points >= 50 && !user.badges.some((badge) => badge.code === 'quiz_starter')) {
        user.badges.push({ code: 'quiz_starter', label: 'Quiz Starter' });
      }

      state.deviceActivities.unshift({
        _id: nextId('activity'),
        userId: user._id,
        sessionId: user.session,
        device: user.device,
        eventType: 'daily_quiz_submitted',
        meta: {
          quizId: quiz._id,
          score,
          total: quiz.questions.length,
        },
        createdAt: nowIso(),
      });
      state.deviceActivities = state.deviceActivities.slice(0, 200);
    }

    return {
      score,
      total: quiz.questions.length,
      leaderboardEntry: clone(entry),
      review,
    };
  },

  async getLeaderboard(quizId) {
    await ensurePlatformReady();

    if (isPostgresMode()) {
      const cached = await getRedisJson(cacheKey('quiz-leaderboard', String(quizId)));
      if (cached) {
        return cached;
      }

      const leaderboard = await pgMany(
        `
          SELECT a.*, u.full_name
          FROM daily_quiz_attempts a
          JOIN users u ON u.id = a.user_id
          WHERE a.daily_quiz_id = $1
          ORDER BY a.score DESC, a.submitted_at ASC
        `,
        [String(quizId)],
        (row) => ({
          userId: row.user_id,
          score: Number(row.score || 0),
          total: Number(row.total || 0),
          submittedAt: toIso(row.submitted_at) || nowIso(),
          name: row.full_name,
        }),
      );

      if (leaderboard.length > 0) {
        await setRedisJson(cacheKey('quiz-leaderboard', String(quizId)), leaderboard, { ttlSeconds: redisJsonTtl });
      }

      return leaderboard;
    }

    const quiz = state.quizzes.find((item) => item._id === String(quizId));
    if (!quiz) {
      return null;
    }

    return normalizeQuizLeaderboard(quiz.leaderboard);
  },

  async getWeeklyLeaderboard() {
    await ensurePlatformReady();

    if (isPostgresMode()) {
      const cached = await getRedisJson(cacheKey('quiz-weekly', 'all'));
      if (cached) {
        return cached;
      }

      const weeklyLeaderboard = await pgMany(
        `
          SELECT
            a.user_id,
            u.full_name,
            SUM(a.score)::int AS score,
            SUM(a.total)::int AS total,
            COUNT(*)::int AS attempts,
            MIN(a.submitted_at) AS submitted_at
          FROM daily_quiz_attempts a
          JOIN daily_quizzes q ON q.id = a.daily_quiz_id
          JOIN users u ON u.id = a.user_id
          WHERE q.quiz_date >= CURRENT_DATE - INTERVAL '6 days'
          GROUP BY a.user_id, u.full_name
          ORDER BY SUM(a.score) DESC, MIN(a.submitted_at) ASC
        `,
        [],
        (row) => ({
          userId: row.user_id,
          name: row.full_name,
          score: Number(row.score || 0),
          total: Number(row.total || 0),
          attempts: Number(row.attempts || 0),
          submittedAt: toIso(row.submitted_at) || nowIso(),
        }),
      );

      await setRedisJson(cacheKey('quiz-weekly', 'all'), weeklyLeaderboard, { ttlSeconds: redisJsonTtl });
      return weeklyLeaderboard;
    }

    const weekStart = new Date();
    weekStart.setUTCDate(weekStart.getUTCDate() - 6);
    weekStart.setUTCHours(0, 0, 0, 0);

    const aggregated = new Map();

    state.quizzes.forEach((quiz) => {
      const quizDate = new Date(`${quiz.date}T00:00:00.000Z`);
      if (Number.isNaN(quizDate.getTime()) || quizDate < weekStart) {
        return;
      }

      quiz.leaderboard.forEach((entry) => {
        const current = aggregated.get(entry.userId) || {
          userId: entry.userId,
          score: 0,
          total: 0,
          attempts: 0,
          submittedAt: entry.submittedAt,
        };

        current.score += Number(entry.score || 0);
        current.total += Number(entry.total || 0);
        current.attempts += 1;
        if (new Date(entry.submittedAt) < new Date(current.submittedAt)) {
          current.submittedAt = entry.submittedAt;
        }

        aggregated.set(entry.userId, current);
      });
    });

    return Array.from(aggregated.values()).sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return sortOldestFirst(left, right, 'submittedAt');
    });
  },

  async listLeaderboardEntries() {
    await ensurePlatformReady();

    if (isPostgresMode()) {
      return pgMany(
        `
          SELECT a.id, a.daily_quiz_id, a.user_id, a.score, a.total, a.submitted_at, q.quiz_date
          FROM daily_quiz_attempts a
          JOIN daily_quizzes q ON q.id = a.daily_quiz_id
          ORDER BY a.submitted_at DESC
        `,
        [],
        (row) => ({
          quizId: row.daily_quiz_id,
          date: typeof row.quiz_date === 'string' ? row.quiz_date.slice(0, 10) : toIso(row.quiz_date).slice(0, 10),
          userId: row.user_id,
          score: Number(row.score || 0),
          total: Number(row.total || 0),
          submittedAt: toIso(row.submitted_at) || nowIso(),
        }),
      );
    }

    return state.quizzes.flatMap((quiz) =>
      quiz.leaderboard.map((entry) => ({
        quizId: quiz._id,
        date: quiz.date,
        ...clone(entry),
      })),
    );
  },
};

const notificationsRepository = {
  async list(userId) {
    await ensurePlatformReady();

    const cacheKeyNotifications = userId ? cacheKey('notifications', `user:${userId}`) : cacheKey('notifications', 'list');
    const notificationsCacheTtlMs = Math.max(500, Number(appConfig.notificationsCacheTtlMs || 2000));

    try {
      const cached = await getRedisJson(cacheKeyNotifications);
      if (cached) return cached;
    } catch (e) {}

    if (isPostgresMode()) {
      if (userId) {
        const rows = await pgMany(
          'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC',
          [String(userId)],
          mapNotificationRow,
        );
        try { await setRedisJson(cacheKeyNotifications, rows, { ttlSeconds: Math.ceil(notificationsCacheTtlMs / 1000) }); } catch (e) {}
        return rows;
      }

      const all = await getPgNotifications();
      try { await setRedisJson(cacheKeyNotifications, all, { ttlSeconds: Math.ceil(notificationsCacheTtlMs / 1000) }); } catch (e) {}
      return all;
    }

    const items = userId
      ? state.notifications.filter((notification) => notification.userId === String(userId))
      : state.notifications;

    const result = items
      .slice()
      .sort((left, right) => sortNewestFirst(left, right, 'createdAt'))
      .map((item) => clone(item));

    try { await setRedisJson(cacheKeyNotifications, result, { ttlSeconds: Math.ceil(notificationsCacheTtlMs / 1000) }); } catch (e) {}
    return result;
  },

  async create(payload) {
    if (isPostgresMode()) {
      return insertPgNotification(payload);
    }

    const notification = {
      _id: nextId('notification'),
      userId: String(payload.userId),
      title: payload.title || 'Notification',
      message: payload.message || '',
      type: payload.type || 'general',
      entityId: payload.entityId ? String(payload.entityId) : null,
      actionUrl: payload.actionUrl || null,
      actionLabel: payload.actionLabel || null,
      payload: asObject(payload.payload),
      createdAt: nowIso(),
    };

    state.notifications.push(notification);
    return clone(notification);
  },

  async notifyLiveClassStarted(liveClass) {
    if (!liveClass?._id) {
      return [];
    }

    let audienceUserIds = [];

    if (liveClass.requiresEnrollment !== false && liveClass.courseId) {
      if (isPostgresMode()) {
        audienceUserIds = await pgMany(
          `SELECT DISTINCT user_id FROM enrollments WHERE course_id = $1 AND ${activeEnrollmentSql}`,
          [String(liveClass.courseId)],
          (row) => String(row.user_id),
        );
      } else {
        audienceUserIds = state.enrollments
          .filter((entry) => entry.courseId === String(liveClass.courseId) && isEnrollmentActive(entry))
          .map((entry) => String(entry.userId));
      }
    } else {
      audienceUserIds = (await usersRepository.listSafe())
        .filter((user) => user.role !== 'admin')
        .map((user) => String(user._id));
    }

    const appBaseUrl = String(appConfig.appUrl || '').replace(/\/$/, '');
    const actionUrl = `${appBaseUrl || ''}/?tab=live&liveClassId=${encodeURIComponent(liveClass._id)}`;
    const uniqueAudience = Array.from(new Set(audienceUserIds.filter(Boolean)));

    return Promise.all(uniqueAudience.map((userId) =>
      notificationsRepository.create({
        userId,
        title: `${liveClass.title} is live now`,
        message: 'Tap to open the protected class inside VARONENGLISH and join with your enrolled account.',
        type: 'live-class-started',
        entityId: liveClass._id,
        actionUrl,
        actionLabel: 'Join now',
        payload: {
          liveClassId: liveClass._id,
          courseId: liveClass.courseId || null,
          provider: liveClass.provider || 'Jitsi Meet',
        },
      })));
  },
};

const engagementRepository = {
  async addReferral(payload) {
    await ensurePlatformReady();

    if (isPostgresMode()) {
      return runInTransaction(async (client) => {
        const referral = await insertPgReferral(payload, client);
        const user = await pgOne('SELECT * FROM users WHERE id = $1', [String(payload.referrerUserId)], mapUserRow, client);
        if (user) {
          const nextBadges = asArray(user.badges);
          if (!nextBadges.some((badge) => badge.code === 'community_builder')) {
            nextBadges.push({ code: 'community_builder', label: 'Community Builder' });
          }

          await upsertPgUser({
            ...user,
            points: Number(user.points || 0) + 25,
            badges: nextBadges,
          }, client);
        }

        return referral;
      });
    }

    const referral = {
      _id: nextId('referral'),
      referrerUserId: String(payload.referrerUserId),
      referredEmail: normalizeEmail(payload.referredEmail),
      createdAt: nowIso(),
    };

    state.referrals.push(referral);

    const user = state.users.find((item) => item._id === referral.referrerUserId);
    if (user) {
      user.points += 25;
      if (!user.badges.some((badge) => badge.code === 'community_builder')) {
        user.badges.push({ code: 'community_builder', label: 'Community Builder' });
      }
    }

    return clone(referral);
  },

  async getGamification(userId) {
    await ensurePlatformReady();

    if (isPostgresMode()) {
      const user = await usersRepository.findById(userId);
      const referralCount = await pgOne(
        'SELECT COUNT(*)::int AS count FROM referrals WHERE referrer_user_id = $1',
        [String(userId)],
        (row) => Number(row.count || 0),
      );

      return {
        points: user?.points || 0,
        badges: clone(user?.badges || []),
        streak: user?.streak || 0,
        referrals: referralCount || 0,
      };
    }

    const user = state.users.find((item) => item._id === String(userId));

    return {
      points: user?.points || 0,
      badges: clone(user?.badges || []),
      streak: user?.streak || 0,
      referrals: state.referrals.filter((referral) => referral.referrerUserId === String(userId)).length,
    };
  },
};

const listStoredLiveClasses = async () => {
  await ensurePlatformReady();

  if (isPostgresMode()) {
    return getPgLiveClasses();
  }

  return clone(state.liveClasses).sort((left, right) => sortOldestFirst(left, right, 'startTime'));
};

const findStoredLiveClassById = async (liveClassId) => {
  await ensurePlatformReady();

  if (isPostgresMode()) {
    return pgOne('SELECT * FROM live_classes WHERE id = $1', [String(liveClassId)], mapLiveClassRow);
  }

  return clone(state.liveClasses.find((item) => item._id === String(liveClassId)) || null);
};

const canUserAccessLiveClass = async ({ liveClass, userId, allowAdmin = true }) => {
  const user = await usersRepository.findById(userId);
  if (!user) {
    throw new ApiError(404, 'User not found', { code: 'USER_NOT_FOUND' });
  }

  if (allowAdmin && user.role === 'admin') {
    return { user, hasAccess: true };
  }

  if (!liveClass.requiresEnrollment || !liveClass.courseId) {
    return { user, hasAccess: true };
  }

  let hasAccess = false;
  if (isPostgresMode()) {
    const enrollment = await pgOne(
      `SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2 AND ${activeEnrollmentSql}`,
      [String(userId), String(liveClass.courseId)],
      (row) => row,
    );
    hasAccess = Boolean(enrollment);
  } else {
    hasAccess = state.enrollments.some(
      (entry) => entry.userId === String(userId) && entry.courseId === String(liveClass.courseId) && isEnrollmentActive(entry),
    );
  }

  if (!hasAccess) {
    throw new ApiError(403, 'Course enrollment is required to access this live class', { code: 'LIVE_CLASS_ACCESS_REQUIRED' });
  }

  return { user, hasAccess };
};

const isLegacyRealtimeBroadcastClass = (liveClass) => {
  const playbackUrl = String(liveClass?.livePlaybackUrl || '').trim();
  if (!playbackUrl) {
    return false;
  }

  try {
    const url = new URL(playbackUrl, appConfig.appUrl);
    return (
      url.hostname === 'live.example.com'
      && (String(liveClass?.provider || '').toLowerCase().includes('broadcast')
        || String(liveClass?.provider || '').toLowerCase().includes('live'))
      && String(liveClass?.livePlaybackType || '').toLowerCase() === 'hls'
      && appConfig.nodeEnv !== 'production'
    );
  } catch {
    return false;
  }
};

const extractJitsiRoomName = (value) => {
  const rawValue = String(value || '').trim();
  if (!rawValue) {
    return null;
  }

  try {
    const url = new URL(rawValue, appConfig.appUrl);
    return url.pathname.replace(/^\/+/, '').split('/')[0] || null;
  } catch {
    return rawValue
      .replace(/^https?:\/\/[^/]+\//i, '')
      .replace(/[?#].*$/, '')
      .replace(/^\/+/, '') || null;
  }
};

const liveClassesRepository = {
  async list() {
    const liveClasses = await listStoredLiveClasses();
    return liveClasses.map((item) => sanitizeLiveClassForViewer(item));
  },

  async listAdmin() {
    return listStoredLiveClasses();
  },

  async findById(liveClassId) {
    const liveClass = await findStoredLiveClassById(liveClassId);
    return liveClass ? sanitizeLiveClassForViewer(liveClass) : null;
  },

  async findRawById(liveClassId) {
    return findStoredLiveClassById(liveClassId);
  },

  async create(payload) {
    await ensurePlatformReady();

    if (isPostgresMode()) {
      return insertPgLiveClass(payload);
    }

    const liveClass = {
      _id: nextId('live_class'),
      linkageType: payload.linkageType || (payload.mockTestId ? 'mock-test' : payload.courseId ? 'course' : 'standalone'),
      courseId: payload.courseId || null,
      moduleId: payload.moduleId || null,
      moduleTitle: payload.moduleTitle || null,
      chapterId: payload.chapterId || null,
      chapterTitle: payload.chapterTitle || null,
      mockTestId: payload.mockTestId || null,
      mockTestTitle: payload.mockTestTitle || null,
      title: payload.title,
      instructor: payload.instructor || 'VARONENGLISH Faculty',
      startTime: payload.startTime || nowIso(),
      durationMinutes: Number(payload.durationMinutes || 60),
      provider: payload.provider || 'Jitsi Meet',
      mode: payload.mode || 'live',
      status: payload.status || 'scheduled',
      livePlaybackUrl: payload.livePlaybackUrl || null,
      livePlaybackType: payload.livePlaybackType || getDefaultLivePlaybackType(),
      embedUrl: payload.embedUrl || null,
      roomUrl: payload.roomUrl || null,
      recordingUrl: payload.recordingUrl || null,
      replayCourseId: payload.replayCourseId || null,
      replayLessonId: payload.replayLessonId || null,
      chatEnabled: payload.chatEnabled !== false,
      doubtSolving: payload.doubtSolving !== false,
    replayAvailable: payload.replayAvailable !== false,
    attendees: Number(payload.attendees || 0),
    maxAttendees: Number(payload.maxAttendees || 2500),
    requiresEnrollment: payload.requiresEnrollment !== false,
    recordingStorageProvider: payload.recordingStorageProvider || null,
      recordingStoragePath: payload.recordingStoragePath || null,
      recordingPublishedAt: payload.recordingPublishedAt || null,
      recordingExpiresAt: payload.recordingExpiresAt || null,
      recordingDurationMinutes: payload.recordingDurationMinutes === undefined ? null : Number(payload.recordingDurationMinutes || 0),
      posterUrl: payload.posterUrl || null,
      description: payload.description || null,
      teacherProfile: asObject(payload.teacherProfile),
      sessionNotes: asArray(payload.sessionNotes),
      resources: asArray(payload.resources),
      activePoll: payload.activePoll ? asObject(payload.activePoll) : null,
      topicTags: asArray(payload.topicTags),
      createdAt: nowIso(),
  };

    state.liveClasses.push(liveClass);
    return clone(liveClass);
  },

  async update(liveClassId, payload) {
    await ensurePlatformReady();
    const current = await findStoredLiveClassById(liveClassId);
    if (!current) {
      return null;
    }

    const nextLiveClass = {
      ...current,
      ...clone(payload),
      _id: current._id,
    };

    if (isPostgresMode()) {
      return insertPgLiveClass(nextLiveClass);
    }

    const index = state.liveClasses.findIndex((item) => item._id === String(liveClassId));
    state.liveClasses[index] = nextLiveClass;
    return clone(nextLiveClass);
  },

  async delete(liveClassId) {
    await ensurePlatformReady();

    if (isPostgresMode()) {
      const deleted = await pgOne(
        'DELETE FROM live_classes WHERE id = $1 RETURNING *',
        [String(liveClassId)],
        mapLiveClassRow,
      );
      return deleted;
    }

    const index = state.liveClasses.findIndex((item) => item._id === String(liveClassId));
    if (index < 0) {
      return null;
    }

    const [deleted] = state.liveClasses.splice(index, 1);
    state.liveChatMessages = state.liveChatMessages.filter((item) => item.liveClassId !== String(liveClassId));
    return clone(deleted);
  },

  async getAccess({ liveClassId, userId }) {
    const liveClass = await findStoredLiveClassById(liveClassId);
    if (!liveClass) {
      throw new ApiError(404, 'Live class not found', { code: 'LIVE_CLASS_NOT_FOUND' });
    }

    const { user } = await canUserAccessLiveClass({ liveClass, userId });
    const status = deriveLiveClassStatus(liveClass);
    const livePlaybackType = String(getEffectiveLivePlaybackType(liveClass) || '').toLowerCase();
    const hasLivePlayback = Boolean(
      liveClass.livePlaybackUrl
      || liveClass.embedUrl
      || liveClass.roomUrl,
    );
    const hasReplayLesson = Boolean(liveClass.replayCourseId && liveClass.replayLessonId);
    const hasReplayLink = Boolean(liveClass.recordingUrl || liveClass.recordingStoragePath);

  if (status === 'live' && livePlaybackType === 'livekit') {
    return {
      liveClassId: liveClass._id,
      title: liveClass.title,
      provider: liveClass.provider,
      mode: liveClass.mode,
      status,
      accessType: 'livekit-room',
      streamUrl: null,
      streamFormat: null,
      embedUrl: null,
      roomUrl: null,
      liveRoomName: `${appConfig.livekitRoomPrefix}-${String(liveClass._id)}`,
      liveKitUrl: appConfig.livekitUrl || null,
      replayPlayback: null,
      replayExternalUrl: null,
      replayCourseId: liveClass.replayCourseId || null,
      replayLessonId: liveClass.replayLessonId || null,
      tokenExpiresAt: null,
      watermarkText: `${user.email} • ${user._id}`,
      statusMessage: appConfig.hasLiveKit
        ? 'Live class is running inside the in-app classroom.'
        : 'LiveKit is not configured on the server yet. Set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET.',
    };
  }

  if (status === 'live' && livePlaybackType === 'webrtc') {
    return {
      liveClassId: liveClass._id,
      title: liveClass.title,
      provider: liveClass.provider,
      mode: liveClass.mode,
      status,
      accessType: 'webrtc-live',
      streamUrl: null,
      streamFormat: null,
      embedUrl: null,
      roomUrl: null,
      liveKitUrl: null,
      replayPlayback: null,
      replayExternalUrl: null,
      replayCourseId: liveClass.replayCourseId || null,
      replayLessonId: liveClass.replayLessonId || null,
      tokenExpiresAt: null,
      watermarkText: `${user.email} • ${user._id}`,
      statusMessage: 'Live class is running in the realtime classroom.',
    };
  }

  if (status === 'live' && hasLivePlayback) {
    const looksLikeJitsi = livePlaybackType === 'jitsi'
      || /meet\.jit\.si|jitsi/i.test(String(liveClass.roomUrl || ''))
      || /meet\.jit\.si|jitsi/i.test(String(liveClass.embedUrl || ''));

    if (looksLikeJitsi) {
      const liveRoomName = extractJitsiRoomName(liveClass.roomUrl || liveClass.embedUrl)
        || `VARONENGLISH-${String(liveClass._id)}`
          .replace(/[^A-Za-z0-9]+/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');
      const roomUrl = liveClass.roomUrl || `https://${appConfig.jitsiMeetDomain}/${liveRoomName}`;
      const embedUrl = liveClass.embedUrl || `${roomUrl}#config.prejoinPageEnabled=false&config.requireDisplayName=false&config.disableDeepLinking=true&config.startWithAudioMuted=false&config.startWithVideoMuted=false&interfaceConfig.DISABLE_JOIN_LEAVE_NOTIFICATIONS=true`;
      return {
        liveClassId: liveClass._id,
        title: liveClass.title,
        provider: liveClass.provider,
        mode: liveClass.mode,
        status,
        accessType: 'jitsi-room',
        streamUrl: null,
        streamFormat: null,
        embedUrl,
        roomUrl,
        liveRoomName,
        liveKitUrl: null,
        replayPlayback: null,
        replayExternalUrl: null,
        replayCourseId: liveClass.replayCourseId || null,
        replayLessonId: liveClass.replayLessonId || null,
        tokenExpiresAt: null,
        watermarkText: `${user.email} • ${user._id}`,
        statusMessage: 'Live class is running inside a Jitsi Meet classroom.',
      };
    }

    if (liveClass.livePlaybackType === 'iframe' || liveClass.embedUrl) {
      return {
        liveClassId: liveClass._id,
        title: liveClass.title,
          provider: liveClass.provider,
          mode: liveClass.mode,
          status,
          accessType: 'embedded-room',
          streamUrl: null,
          streamFormat: null,
          embedUrl: liveClass.embedUrl || liveClass.roomUrl || liveClass.livePlaybackUrl,
          roomUrl: null,
          replayPlayback: null,
          replayExternalUrl: null,
        replayCourseId: liveClass.replayCourseId || null,
        replayLessonId: liveClass.replayLessonId || null,
        tokenExpiresAt: null,
        watermarkText: `${user.email} • ${user._id}`,
        statusMessage: 'Live class is running inside the embedded room now.',
      };
    }

      const extension = String(liveClass.livePlaybackUrl).toLowerCase().includes('.m3u8') ? '.m3u8' : '.mp4';
      const mimeType = extension === '.m3u8' ? 'application/vnd.apple.mpegurl' : 'video/mp4';
      const issuedToken = issuePlaybackToken({
        userId: String(user._id),
        sessionId: user.session || null,
        liveClassId: String(liveClass._id),
        upstreamUrl: String(liveClass.livePlaybackUrl),
        mimeType,
        assetKind: extension === '.m3u8' ? 'live-hls' : 'live-source',
      });

      return {
        liveClassId: liveClass._id,
        title: liveClass.title,
        provider: liveClass.provider,
        mode: liveClass.mode,
        status,
        accessType: 'live-stream',
        streamUrl: `/backend/api/live-classes/stream/${issuedToken.token}`,
        streamFormat: extension === '.m3u8' ? 'hls' : 'source',
        embedUrl: null,
        roomUrl: null,
        replayPlayback: null,
        replayExternalUrl: null,
        replayCourseId: liveClass.replayCourseId || null,
        replayLessonId: liveClass.replayLessonId || null,
        tokenExpiresAt: issuedToken.expiresAt,
        watermarkText: `${user.email} • ${user._id}`,
        statusMessage: 'Live class is running with protected in-app playback.',
      };
    }

    if (hasReplayLesson) {
      const replayPlayback = await coursesRepository.getProtectedLessonPlayback({
        userId: String(user._id),
        courseId: String(liveClass.replayCourseId),
        lessonId: String(liveClass.replayLessonId),
        enforceEnrollment: false,
        enforceSequentialUnlock: false,
      });

      return {
        liveClassId: liveClass._id,
        title: liveClass.title,
        provider: liveClass.provider,
        mode: 'replay',
        status,
        accessType: 'replay-lesson',
        streamUrl: null,
        streamFormat: null,
        embedUrl: null,
        roomUrl: null,
        replayPlayback,
        replayExternalUrl: null,
        replayCourseId: liveClass.replayCourseId,
        replayLessonId: liveClass.replayLessonId,
        tokenExpiresAt: replayPlayback.tokenExpiresAt || null,
        watermarkText: `${user.email} • ${user._id}`,
        statusMessage: 'Replay is protected and available inside the app.',
      };
    }

    if (hasReplayLink) {
      const access = await consumeLiveReplayGrant({
        userId: String(user._id),
        liveClassId: String(liveClass._id),
        sessionId: user.session || null,
      });

      const storagePath = liveClass.recordingStoragePath || liveClass.recordingUrl;
      const storageProvider = liveClass.recordingStorageProvider || 'local';
      const extension = String(storagePath || '').toLowerCase().includes('.m3u8') ? '.m3u8' : '.mp4';
      const mimeType = extension === '.m3u8' ? 'application/vnd.apple.mpegurl' : 'video/mp4';
      const playbackTokenPayload = liveClass.recordingStoragePath
        ? {
          userId: String(user._id),
          sessionId: user.session || null,
          liveClassId: String(liveClass._id),
          storageProvider,
          storagePath,
          mimeType,
          assetKind: extension === '.m3u8' ? 'hls' : 'source',
        }
        : {
          userId: String(user._id),
          sessionId: user.session || null,
          liveClassId: String(liveClass._id),
          upstreamUrl: String(liveClass.recordingUrl),
          mimeType,
          assetKind: extension === '.m3u8' ? 'live-hls' : 'live-source',
        };
      const issuedToken = issuePlaybackToken(playbackTokenPayload);

      return {
        liveClassId: liveClass._id,
        title: liveClass.title,
        provider: liveClass.provider,
        mode: 'replay',
        status,
        accessType: 'recording-link',
        streamUrl: `/backend/api/live-classes/stream/${issuedToken.token}`,
        streamFormat: extension === '.m3u8' ? 'hls' : 'source',
        embedUrl: null,
        roomUrl: null,
        replayPlayback: null,
        replayExternalUrl: null,
        replayCourseId: null,
        replayLessonId: null,
        tokenExpiresAt: issuedToken.expiresAt,
        watermarkText: `${user.email} • ${user._id}`,
        statusMessage: access.grant
          ? hasReplayViewLimit()
            ? `Replay is protected. Remaining views: ${Math.max(Number(access.grant.maxViews || liveReplayMaxViews) - Number(access.grant.usedViews || 0), 0)}`
            : 'Replay is protected for the full course validity period.'
          : 'Replay recording is ready inside the app.',
        playbackGrantRemainingViews: access.grant
          ? hasReplayViewLimit()
            ? Math.max(Number(access.grant.maxViews || liveReplayMaxViews) - Number(access.grant.usedViews || 0), 0)
            : null
          : null,
        recordingExpiresAt: liveClass.recordingExpiresAt || null,
      };
    }

    return {
      liveClassId: liveClass._id,
      title: liveClass.title,
      provider: liveClass.provider,
      mode: liveClass.mode,
      status,
      accessType: 'upcoming',
      streamUrl: null,
      streamFormat: null,
      embedUrl: null,
      roomUrl: null,
      replayPlayback: null,
      replayExternalUrl: null,
      replayCourseId: liveClass.replayCourseId || null,
      replayLessonId: liveClass.replayLessonId || null,
      tokenExpiresAt: null,
      watermarkText: `${user.email} • ${user._id}`,
      statusMessage: status === 'cancelled'
        ? 'This live class has been cancelled.'
        : status === 'ended'
          ? 'Replay is processing or will appear here after the recording is uploaded.'
        : 'Live playback becomes available when the class starts.',
    };
  },

  async getChat(liveClassId) {
    await ensurePlatformReady();

    if (isPostgresMode()) {
      return pgMany(
        'SELECT * FROM live_chat_messages WHERE live_class_id = $1 ORDER BY created_at ASC',
        [String(liveClassId)],
        mapLiveChatRow,
      );
    }

    return state.liveChatMessages
      .filter((item) => item.liveClassId === String(liveClassId))
      .sort((left, right) => sortOldestFirst(left, right, 'createdAt'))
      .map((item) => clone(item));
  },

  async postChat({ liveClassId, userId, message, kind = 'chat' }) {
    await ensurePlatformReady();
    const liveClass = await findStoredLiveClassById(liveClassId);
    if (!liveClass) {
      return null;
    }

    const { user } = await canUserAccessLiveClass({ liveClass, userId });

    if (isPostgresMode()) {
      return runInTransaction(async (client) => {
        const chatMessage = await insertPgLiveChatMessage({
          liveClassId,
          userId,
          userName: user.name,
          kind,
          message,
        }, client);

        await insertPgDeviceActivity({
          userId: user._id,
          sessionId: user.session,
          device: user.device,
          eventType: kind === 'doubt' ? 'live_class_doubt_posted' : 'live_class_chat_posted',
          meta: {
            liveClassId: String(liveClassId),
          },
        }, client);

        return chatMessage;
      });
    }

    const chatMessage = {
      _id: nextId('live_chat'),
      liveClassId: String(liveClassId),
      userId: String(userId),
      userName: user.name,
      kind: kind === 'doubt' ? 'doubt' : 'chat',
      message: String(message || ''),
      createdAt: nowIso(),
    };

    state.liveChatMessages.push(chatMessage);
    state.deviceActivities.unshift({
      _id: nextId('activity'),
      userId: user._id,
      sessionId: user.session,
      device: user.device,
      eventType: chatMessage.kind === 'doubt' ? 'live_class_doubt_posted' : 'live_class_chat_posted',
      meta: {
        liveClassId: String(liveClassId),
      },
      createdAt: nowIso(),
    });
    state.deviceActivities = state.deviceActivities.slice(0, 200);

    return clone(chatMessage);
  },
};

const adminRepository = {
  async uploadQuestions(payload) {
    if (isPostgresMode()) {
      return runInTransaction(async (client) => {
        const upload = await insertPgUpload(payload, client);
        let createdTest = null;
        if (Array.isArray(payload.questions) && payload.questions.length > 0) {
          createdTest = await upsertPgTest({
            title: payload.title || 'Uploaded Test',
            category: payload.category || 'SSC JE',
            type: payload.type || 'topic-wise',
            course: payload.course || null,
            questions: payload.questions,
            totalMarks: payload.questions.reduce((sum, question) => sum + Number(question.marks || 1), 0),
          }, client);
        }

        return {
          upload,
          test: createdTest,
        };
      });
    }

    const uploadRecord = {
      _id: nextId('upload'),
      title: payload.title || 'Bulk Upload',
      course: payload.course || null,
      questionCount: Array.isArray(payload.questions) ? payload.questions.length : 0,
      createdAt: nowIso(),
    };

    state.uploads.push(uploadRecord);

    let createdTest = null;
    if (Array.isArray(payload.questions) && payload.questions.length > 0) {
      createdTest = await testsRepository.create({
        title: payload.title || 'Uploaded Test',
        category: payload.category || 'SSC JE',
        type: payload.type || 'topic-wise',
        course: payload.course || null,
        questions: payload.questions,
        totalMarks: payload.questions.reduce((sum, question) => sum + Number(question.marks || 1), 0),
      });
    }

    return {
      upload: clone(uploadRecord),
      test: createdTest,
    };
  },

  async getPlatformAnalytics() {
    const cacheKeyPlatformAnalytics = cacheKey('analytics', 'platform');
    const analyticsCacheTtlMs = Math.max(1000, Number(appConfig.analyticsCacheTtlMs || 5_000));

    try {
      const cached = await getRedisJson(cacheKeyPlatformAnalytics);
      if (cached) {
        return cached;
      }
    } catch (e) {}

    const data = await loadPlatformData();
    const leaderboardEntries = await quizzesRepository.listLeaderboardEntries();

    const result = {
      activeUsers: data.users.length,
      activeSessions: data.users.filter((user) => Boolean(user.session)).length,
      totalCourses: data.courses.length,
      totalTests: data.tests.length,
      liveClasses: data.liveClasses.filter((item) => item.mode === 'live').length,
      notificationsSent: data.notifications.length,
      referralCount: data.referrals.length,
      paymentCount: data.payments.length,
      testParticipation: data.testAttempts.length + leaderboardEntries.length,
      revenue: data.payments
        .filter((payment) => payment.status === 'paid')
        .reduce((total, payment) => total + Number(payment.amount || 0), 0),
      concurrentCapacityTarget: '',
      recentDeviceActivity: getRecentDeviceActivity(data),
    };

    try {
      await setRedisJson(cacheKeyPlatformAnalytics, result, { ttlSeconds: Math.ceil(analyticsCacheTtlMs / 1000) });
    } catch (e) {}

    return result;
  },

};

const analyticsRepository = {
  async getUserAnalytics(userId) {
    const cacheKeyUserAnalytics = cacheKey('analytics', `user:${userId}`);
    const userAnalyticsCacheTtlMs = Math.max(500, Number(appConfig.userAnalyticsCacheTtlMs || 2_000));

    try {
      const cached = await getRedisJson(cacheKeyUserAnalytics);
      if (cached) return cached;
    } catch (e) {}

    const data = await loadPlatformData();
    const quizInsights = computeQuizInsights(data, userId);
    const testInsights = computeTestInsights(data, userId);
    const weakTopics = new Set(testInsights.latestAttempt?.weakTopics || []);
    const strongTopics = new Set(testInsights.latestAttempt?.strongTopics || []);

    const accuracyValues = [quizInsights.accuracy, testInsights.accuracy].filter((value) => value > 0);
    const accuracy = accuracyValues.length === 0
      ? 0
      : Number((accuracyValues.reduce((sum, value) => sum + value, 0) / accuracyValues.length).toFixed(2));

    const speed = testInsights.attempts.length === 0
      ? quizInsights.attempts === 0 ? 0 : 1.1
      : Number((testInsights.attempts.length / Math.max(testInsights.attempts.length, 1)).toFixed(2));

    const attempts = quizInsights.attempts + testInsights.attempts.length;

    const result = {
      accuracy,
      speed,
      attempts,
      weakTopics: Array.from(weakTopics),
      strongTopics: Array.from(strongTopics),
      suggestions: [buildAiRecommendation({ accuracy, weakTopics: Array.from(weakTopics), attempts })].filter(Boolean),
      trend: buildAnalyticsTrend(data, userId),
      adaptivePlan: computeAdaptivePlan({ accuracy, attempts }),
    };

    try {
      await setRedisJson(cacheKeyUserAnalytics, result, { ttlSeconds: Math.ceil(userAnalyticsCacheTtlMs / 1000) });
    } catch (e) {}

    return result;
  },

  async getLeaderboard() {
    const data = await loadPlatformData();
    const userScores = new Map();

    data.testAttempts.forEach((attempt) => {
      const current = userScores.get(attempt.userId) || 0;
      if (Number(attempt.score) > current) {
        userScores.set(attempt.userId, Number(attempt.score));
      }
    });

    (await quizzesRepository.listLeaderboardEntries()).forEach((entry) => {
      const current = userScores.get(entry.userId) || 0;
      if (entry.score > current) {
        userScores.set(entry.userId, entry.score);
      }
    });

    return Array.from(userScores.entries())
      .map(([userId, score]) => {
        const user = data.users.find((item) => item._id === userId);
        return {
          userId,
          name: user?.name || 'Unknown User',
          score,
        };
      })
      .sort((left, right) => right.score - left.score);
  },

  async getProgress(userId) {
    const data = await loadPlatformData();
    const testInsights = computeTestInsights(data, userId);
    const enrollments = filterActiveEnrollments(data.enrollments.filter((entry) => entry.userId === String(userId)));
    const coursesInProgress = enrollments
      .map((enrollment) => data.courses.find((course) => course._id === enrollment.courseId))
      .filter(Boolean)
      .map((course) => ({
        courseId: course._id,
        title: course.title,
        progressPercent: computeCourseProgress(data, userId, course).progressPercent,
      }));

    return {
      testsTaken: testInsights.attempts.length,
      quizzesTaken: computeQuizInsights(data, userId).attempts,
      coursesAvailable: data.courses.length,
      coursesInProgress,
      averageScore: testInsights.averageScore,
    };
  },
};

const paymentRepository = {
  async createCheckout(payload) {
    await ensurePlatformReady();

    if (isPostgresMode()) {
      return runInTransaction(async (client) => {
        const user = await pgOne('SELECT * FROM users WHERE id = $1', [String(payload.userId || '')], mapUserRow, client);
        const payment = await insertPgPayment(payload, client);

        if (user) {
          await insertPgDeviceActivity({
            userId: user._id,
            sessionId: user.session,
            device: user.device,
            eventType: 'payment_checkout_started',
            meta: {
              paymentId: payment._id,
              item: payment.item,
              amount: payment.amount,
            },
          }, client);
        }

        return {
          ...clone(payment),
          paymentUrl: `https://payment-gateway.com/checkout/${payment._id}`,
        };
      });
    }

    const user = state.users.find((item) => item._id === String(payload.userId || ''));

    const payment = {
      _id: nextId('payment'),
      userId: String(payload.userId || ''),
      amount: Number(payload.amount || 0),
      currency: payload.currency || 'INR',
      item: payload.item || 'Course Purchase',
      status: 'pending',
      attemptCount: 1,
      retryable: true,
      lastError: null,
      createdAt: nowIso(),
    };

    state.payments.push(payment);

    if (user) {
      state.deviceActivities.unshift({
        _id: nextId('activity'),
        userId: user._id,
        sessionId: user.session,
        device: user.device,
        eventType: 'payment_checkout_started',
        meta: {
          paymentId: payment._id,
          item: payment.item,
          amount: payment.amount,
        },
        createdAt: nowIso(),
      });
      state.deviceActivities = state.deviceActivities.slice(0, 200);
    }

    return {
      ...clone(payment),
      paymentUrl: `https://payment-gateway.com/checkout/${payment._id}`,
    };
  },

  async handleWebhook(payload) {
    await ensurePlatformReady();

    if (isPostgresMode()) {
      return runInTransaction(async (client) => {
        const webhookRecord = await insertPgWebhook(payload, client);
        const payment = await pgOne('SELECT * FROM payments WHERE id = $1', [String(webhookRecord.paymentId || '')], mapPaymentRow, client);
        if (payment) {
          const updatedPayment = {
            ...payment,
            status: webhookRecord.status,
            retryable: webhookRecord.status !== 'paid',
            lastError: webhookRecord.status === 'failed'
              ? payload.errorMessage || 'Payment failed. Retry is available.'
              : null,
            updatedAt: nowIso(),
          };
          await insertPgPayment(updatedPayment, client);

          const user = await pgOne('SELECT * FROM users WHERE id = $1', [payment.userId], mapUserRow, client);
          if (user) {
            await insertPgDeviceActivity({
              userId: user._id,
              sessionId: user.session,
              device: user.device,
              eventType: webhookRecord.status === 'paid' ? 'payment_completed' : 'payment_failed',
              meta: {
                paymentId: payment._id,
                item: payment.item,
                amount: payment.amount,
                status: webhookRecord.status,
              },
            }, client);
          }
        }

        return webhookRecord;
      });
    }

    const webhookRecord = {
      _id: nextId('webhook'),
      event: payload.event || 'payment.updated',
      paymentId: String(payload.paymentId || ''),
      status: payload.status || 'received',
      receivedAt: nowIso(),
      payload: clone(payload),
    };

    state.webhooks.push(webhookRecord);

    const payment = state.payments.find((item) => item._id === webhookRecord.paymentId);
    if (payment) {
      payment.status = webhookRecord.status;
      payment.retryable = webhookRecord.status !== 'paid';
      payment.lastError = webhookRecord.status === 'failed'
        ? payload.errorMessage || 'Payment failed. Retry is available.'
        : null;

      const user = state.users.find((item) => item._id === payment.userId);
      if (user) {
        state.deviceActivities.unshift({
          _id: nextId('activity'),
          userId: user._id,
          sessionId: user.session,
          device: user.device,
          eventType: webhookRecord.status === 'paid' ? 'payment_completed' : 'payment_failed',
          meta: {
            paymentId: payment._id,
            item: payment.item,
            amount: payment.amount,
            status: webhookRecord.status,
          },
          createdAt: nowIso(),
        });
        state.deviceActivities = state.deviceActivities.slice(0, 200);
      }
    }

    return clone(webhookRecord);
  },

  async retryPayment(paymentId, userId) {
    await ensurePlatformReady();

    if (isPostgresMode()) {
      return runInTransaction(async (client) => {
        const payment = await pgOne('SELECT * FROM payments WHERE id = $1', [String(paymentId)], mapPaymentRow, client);
        if (!payment) {
          return null;
        }

        if (payment.userId !== String(userId)) {
          return false;
        }

        const updatedPayment = {
          ...payment,
          status: 'pending',
          retryable: true,
          attemptCount: Number(payment.attemptCount || 1) + 1,
          lastError: null,
          updatedAt: nowIso(),
        };
        await insertPgPayment(updatedPayment, client);

        const user = await pgOne('SELECT * FROM users WHERE id = $1', [String(userId)], mapUserRow, client);
        if (user) {
          await insertPgDeviceActivity({
            userId: user._id,
            sessionId: user.session,
            device: user.device,
            eventType: 'payment_retry_requested',
            meta: {
              paymentId: String(paymentId),
              attempts: updatedPayment.attemptCount,
            },
          }, client);
        }

        return {
          ...clone(updatedPayment),
          paymentUrl: `https://payment-gateway.com/checkout/${paymentId}?retry=${updatedPayment.attemptCount}`,
        };
      });
    }

    const paymentIndex = state.payments.findIndex((item) => item._id === String(paymentId));
    if (paymentIndex === -1) {
      return null;
    }

    const payment = state.payments[paymentIndex];
    if (payment.userId !== String(userId)) {
      return false;
    }

    state.payments[paymentIndex] = {
      ...payment,
      status: 'pending',
      retryable: true,
      attemptCount: Number(payment.attemptCount || 1) + 1,
      lastError: null,
      updatedAt: nowIso(),
    };

    const user = state.users.find((item) => item._id === String(userId));
    if (user) {
      state.deviceActivities.unshift({
        _id: nextId('activity'),
        userId: user._id,
        sessionId: user.session,
        device: user.device,
        eventType: 'payment_retry_requested',
        meta: {
          paymentId: String(paymentId),
          attempts: state.payments[paymentIndex].attemptCount,
        },
        createdAt: nowIso(),
      });
      state.deviceActivities = state.deviceActivities.slice(0, 200);
    }

    return {
      ...clone(state.payments[paymentIndex]),
      paymentUrl: `https://payment-gateway.com/checkout/${paymentId}?retry=${state.payments[paymentIndex].attemptCount}`,
    };
  },
};

const platformRepository = {
  async ensureReady() {
    return ensurePlatformReady();
  },

  async getOverview(userId) {
    const data = await loadPlatformData();
    const safeUser = userId ? await usersRepository.findSafeById(userId) : null;
    const analytics = userId ? await analyticsRepository.getUserAnalytics(userId) : {
      accuracy: 0,
      speed: 0,
      attempts: 0,
      weakTopics: [],
      strongTopics: [],
      suggestions: [],
      trend: buildAnalyticsTrend(data, 'guest'),
      adaptivePlan: computeAdaptivePlan({ accuracy: 0, attempts: 0 }),
    };

    const dailyQuiz = await quizzesRepository.findByDate(new Date().toISOString().slice(0, 10));
    const leaderboard = dailyQuiz ? await quizzesRepository.getLeaderboard(dailyQuiz._id) : [];
    const weeklyLeaderboard = await quizzesRepository.getWeeklyLeaderboard();
    const gamification = userId ? await engagementRepository.getGamification(userId) : { points: 0, badges: [], streak: 0, referrals: 0 };
    const courses = await coursesRepository.list();
    const tests = await testsRepository.listForAttempt();
    const enrollments = userId
      ? filterActiveEnrollments(data.enrollments.filter((entry) => entry.userId === String(userId)))
      : [];
    const enrolledCourseIds = new Set(enrollments.map((entry) => entry.courseId));
    const decorateLeaderboard = (entries) =>
      entries.map((entry) => ({
        ...clone(entry),
        name: data.users.find((user) => user._id === entry.userId)?.name || entry.name || entry.userId,
      }));

    const courseCards = courses.map((course) => {
      const isEnrolled = enrolledCourseIds.has(course._id);
      const hasFullCourseAccess = safeUser?.role === 'admin' || isEnrolled;
      const progress = userId ? computeCourseProgress(data, userId, course) : { progressPercent: 0, continueLesson: null, continueProgressSeconds: 0 };
      const visibleCourse = redactCourseForViewer(course, hasFullCourseAccess);
      return {
        ...visibleCourse,
        enrolled: hasFullCourseAccess,
        progressPercent: progress.progressPercent,
        continueLesson: progress.continueLesson,
        continueProgressSeconds: progress.continueProgressSeconds,
        lessonCount: lessonListFromCourse(course).length,
        lessonProgress: progress.watchHistory || [],
      };
    });

    const liveClasses = clone(data.liveClasses)
      .sort((left, right) => sortOldestFirst(left, right, 'startTime'))
      .map((item) => sanitizeLiveClassForViewer(item));
    const notifications = userId ? await notificationsRepository.list(userId) : [];
    const adminOverview = safeUser?.role === 'admin' ? await adminRepository.getPlatformAnalytics() : null;
    const testInsights = userId ? computeTestInsights(data, userId) : { latestAttempt: null, attempts: [] };
    const activePlanIds = new Set(
      userId
        ? data.userSubscriptions
            .filter((subscription) => subscription.userId === String(userId) && subscription.status === 'active')
            .map((subscription) => subscription.planId)
        : [],
    );

    return {
      user: safeUser,
      highlights: {
        concurrencyTarget: adminOverview?.concurrentCapacityTarget || '',
        deploymentProfile: '',
        modules: [],
      },
      dashboard: {
        streak: gamification.streak,
        points: gamification.points,
        accuracy: analytics.accuracy,
        speed: analytics.speed,
        weakTopics: analytics.weakTopics,
        strongTopics: analytics.strongTopics,
        continueLearning: courseCards.filter((course) => course.enrolled && course.continueLesson).slice(0, 3),
        latestMockTest: testInsights.latestAttempt,
      },
      dailyQuiz: dailyQuiz
        ? {
            quiz: redactQuizForAttempt(dailyQuiz),
            leaderboard: decorateLeaderboard((leaderboard || []).slice(0, 5)),
            weeklyLeaderboard: decorateLeaderboard((weeklyLeaderboard || []).slice(0, 5)),
            streak: gamification.streak,
          }
        : null,
      courses: courseCards,
      testSeries: tests,
      liveClasses,
      subscriptions: clone(data.subscriptions).map((plan) => ({
        ...plan,
        active: activePlanIds.has(plan._id),
      })),
      notifications,
      analytics,
      ai: {
        headline: buildAiRecommendation({ accuracy: analytics.accuracy, weakTopics: analytics.weakTopics, attempts: analytics.attempts }),
        prompts: (analytics.weakTopics || []).slice(0, 3).map((topic) => `How should I revise ${topic}?`),
        generation: getAiGenerationProviders(),
      },
      sessionActivity: userId ? {
        activeSessions: safeUser?.session ? 1 : 0,
        recentSessions: getRecentSessions(data, userId),
        recentDeviceActivity: getRecentDeviceActivity(data, userId),
      } : null,
      adminOverview,
    };
  },

  async enroll({ userId, courseId, source = 'payment', accessType = 'course' }) {
    await ensurePlatformReady();

    const course = await coursesRepository.findById(courseId);
    if (!course) {
      throw new ApiError(404, 'Course not found', { code: 'COURSE_NOT_FOUND' });
    }

    const normalizedSource = String(source || 'payment');
    if (Number(course.price || 0) > 0 && ['direct-access', 'free', 'self-serve'].includes(normalizedSource)) {
      throw new ApiError(403, 'Paid course access requires a verified payment', { code: 'PAYMENT_REQUIRED' });
    }

    if (isPostgresMode()) {
      return runInTransaction(async (client) => {
        const enrollment = await insertPgEnrollment({
          userId,
          courseId,
          source: normalizedSource,
          accessType,
          validityDays: course.validityDays || courseDefaultValidityDays,
          expiresAt: addDaysIso(course.validityDays || courseDefaultValidityDays),
        }, client);
        const user = await pgOne('SELECT * FROM users WHERE id = $1', [String(userId)], mapUserRow, client);
        if (user) {
          await insertPgDeviceActivity({
            userId: user._id,
            sessionId: user.session,
            device: user.device,
            eventType: 'course_enrolled',
            meta: {
              courseId: String(courseId),
              source: normalizedSource,
              accessType,
            },
          }, client);
        }

        return enrollment;
      });
    }

    const existingEnrollment = state.enrollments.find(
      (entry) => entry.userId === String(userId) && entry.courseId === String(courseId),
    );
    if (existingEnrollment) {
      return clone(existingEnrollment);
    }

    const enrollment = {
      _id: nextId('enrollment'),
      userId: String(userId),
      courseId: String(courseId),
      accessType,
      source: normalizedSource,
      enrolledAt: nowIso(),
      expiresAt: addDaysIso(course.validityDays || courseDefaultValidityDays),
      viewCount: 0,
    };

    state.enrollments.push(enrollment);
    const user = state.users.find((item) => item._id === String(userId));
    if (user) {
      state.deviceActivities.unshift({
        _id: nextId('activity'),
        userId: user._id,
        sessionId: user.session,
        device: user.device,
        eventType: 'course_enrolled',
        meta: {
          courseId: String(courseId),
          source: normalizedSource,
          accessType,
        },
        createdAt: nowIso(),
      });
      state.deviceActivities = state.deviceActivities.slice(0, 200);
    }

    return clone(enrollment);
  },

  async subscribe({ userId, planId, source = 'payment' }) {
    await ensurePlatformReady();

    if (isPostgresMode()) {
      return runInTransaction(async (client) => {
        const existing = await pgOne(
          'SELECT * FROM subscriptions WHERE user_id = $1 AND plan_id = $2 AND status = $3',
          [String(userId), String(planId), 'active'],
          mapSubscriptionRow,
          client,
        );
        if (existing) {
          return existing;
        }

        const plan = await pgOne('SELECT * FROM subscription_plans WHERE id = $1', [String(planId)], mapPlanRow, client);
        if (!plan) {
          return null;
        }

        const durationDays = plan.billingCycle === 'yearly' ? 365 : 30;
        const subscription = await insertPgSubscription({
          userId,
          planId,
          status: 'active',
          source,
          startedAt: nowIso(),
          expiresAt: new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString(),
        }, client);

        const user = await pgOne('SELECT * FROM users WHERE id = $1', [String(userId)], mapUserRow, client);
        if (user) {
          await insertPgDeviceActivity({
            userId: user._id,
            sessionId: user.session,
            device: user.device,
            eventType: 'subscription_activated',
            meta: {
              planId: String(planId),
            },
          }, client);
        }

        await insertPgNotification({
          userId,
          title: `${plan.title} activated`,
          message: 'Your subscription is active and premium access is available immediately.',
          type: 'subscription',
        }, client);

        return subscription;
      });
    }

    const existing = state.userSubscriptions.find(
      (entry) => entry.userId === String(userId) && entry.planId === String(planId) && entry.status === 'active',
    );
    if (existing) {
      return clone(existing);
    }

    const plan = state.subscriptions.find((item) => item._id === String(planId));
    if (!plan) {
      return null;
    }

    const durationDays = plan.billingCycle === 'yearly' ? 365 : 30;
    const subscription = {
      _id: nextId('user_subscription'),
      userId: String(userId),
      planId: String(planId),
      status: 'active',
      source,
      startedAt: nowIso(),
      expiresAt: new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString(),
    };

    state.userSubscriptions.push(subscription);

    const user = state.users.find((item) => item._id === String(userId));
    if (user) {
      state.deviceActivities.unshift({
        _id: nextId('activity'),
        userId: user._id,
        sessionId: user.session,
        device: user.device,
        eventType: 'subscription_activated',
        meta: {
          planId: String(planId),
        },
        createdAt: nowIso(),
      });
      state.deviceActivities = state.deviceActivities.slice(0, 200);
    }

    await notificationsRepository.create({
      userId,
      title: `${plan.title} activated`,
      message: 'Your subscription is active and premium access is available immediately.',
      type: 'subscription',
    });

    return clone(subscription);
  },

  async updateWatchProgress({ userId, courseId, lessonId, progressPercent, progressSeconds, completed }) {
    await ensurePlatformReady();

    const course = await coursesRepository.findById(courseId);
    if (!course) {
      throw new ApiError(404, 'Course not found', { code: 'COURSE_NOT_FOUND' });
    }

    const lesson = findLessonInCourse(course, lessonId);
    if (!lesson) {
      throw new ApiError(404, 'Lesson not found in this course', { code: 'LESSON_NOT_FOUND' });
    }

    let hasAccess = Number(course.price || 0) === 0;
    if (!hasAccess) {
      if (isPostgresMode()) {
        const enrollment = await pgOne(
          `SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2 AND ${activeEnrollmentSql}`,
          [String(userId), String(courseId)],
          (entry) => entry,
        );
        hasAccess = Boolean(enrollment);
      } else {
        hasAccess = state.enrollments.some(
          (entry) => entry.userId === String(userId) && entry.courseId === String(courseId) && isEnrollmentActive(entry),
        );
      }
    }

    if (!hasAccess) {
      throw new ApiError(403, 'Enroll in the course before saving progress', { code: 'COURSE_ACCESS_REQUIRED' });
    }

    if (isPostgresMode()) {
      return runInTransaction(async (client) => {
        const record = await upsertPgWatchHistory({
          userId,
          courseId,
          lessonId,
          progressPercent,
          progressSeconds,
          completed,
        }, client);

        const user = await pgOne('SELECT * FROM users WHERE id = $1', [String(userId)], mapUserRow, client);
        if (user) {
          await insertPgDeviceActivity({
            userId: user._id,
            sessionId: user.session,
            device: user.device,
            eventType: completed ? 'lesson_completed' : 'lesson_progress_updated',
            meta: {
              courseId: String(courseId),
              lessonId: String(lessonId),
              progressPercent: Number(progressPercent || 0),
            },
          }, client);
        }

        return record;
      });
    }

    const existingIndex = state.watchHistory.findIndex(
      (entry) =>
        entry.userId === String(userId)
        && entry.courseId === String(courseId)
        && entry.lessonId === String(lessonId),
    );

    const record = {
      _id: existingIndex >= 0 ? state.watchHistory[existingIndex]._id : nextId('watch'),
      userId: String(userId),
      courseId: String(courseId),
      lessonId: String(lessonId),
      progressPercent: Number(progressPercent || 0),
      progressSeconds: Number(progressSeconds || 0),
      completed: Boolean(completed),
      updatedAt: nowIso(),
    };

    if (existingIndex >= 0) {
      state.watchHistory[existingIndex] = record;
    } else {
      state.watchHistory.push(record);
    }

    const user = state.users.find((item) => item._id === String(userId));
    if (user) {
      state.deviceActivities.unshift({
        _id: nextId('activity'),
        userId: user._id,
        sessionId: user.session,
        device: user.device,
        eventType: completed ? 'lesson_completed' : 'lesson_progress_updated',
        meta: {
          courseId: String(courseId),
          lessonId: String(lessonId),
          progressPercent: Number(progressPercent || 0),
        },
        createdAt: nowIso(),
      });
      state.deviceActivities = state.deviceActivities.slice(0, 200);
    }

    return clone(record);
  },

  async incrementEnrollmentViewCount({ userId, courseId }) {
    await ensurePlatformReady();

    if (isPostgresMode()) {
      return runInTransaction(async (client) => {
        await pgExec(
          `
            UPDATE enrollments
            SET view_count = COALESCE(view_count, 0) + 1
            WHERE user_id = $1 AND course_id = $2
          `,
          [String(userId), String(courseId)],
          client,
        );

        const enrollment = await pgOne(
          'SELECT * FROM enrollments WHERE user_id = $1 AND course_id = $2',
          [String(userId), String(courseId)],
          mapEnrollmentRow,
          client,
        );
        return enrollment;
      });
    }

    const enrollment = state.enrollments.find(
      (entry) => entry.userId === String(userId) && entry.courseId === String(courseId),
    );

    if (enrollment) {
      enrollment.viewCount = Number(enrollment.viewCount || 0) + 1;
      return clone(enrollment);
    }

    return null;
  },

  async askAi({ userId, message }) {
    await ensurePlatformReady();

    const normalizedMessage = String(message || '').toLowerCase();
    let answer = 'Focus on high-yield revision blocks, solve one mock test, and review every incorrect answer with the explanation.';

    if (normalizedMessage.includes('network')) {
      answer = 'Start with the fundamentals for the topic, solve a focused problem set, and revise incorrect answers before the next mock.';
    } else if (normalizedMessage.includes('7-day') || normalizedMessage.includes('plan')) {
      answer = 'Use a 7-day cycle: 3 days concept revision, 2 days sectional tests, 1 full-length mock, and 1 day for analytics review plus live class replay.';
    } else if (normalizedMessage.includes('mock')) {
      answer = 'Attempt a sectional test first if your accuracy is below 75%. Once accuracy stabilizes, move to a full-length mock with timer and negative marking enabled.';
    }

    if (isPostgresMode()) {
      return runInTransaction(async (client) => {
        const thread = await insertPgAiMessage({
          userId: userId || 'guest',
          message,
          answer,
        }, client);

        const user = await pgOne('SELECT * FROM users WHERE id = $1', [String(userId || '')], mapUserRow, client);
        if (user) {
          await insertPgDeviceActivity({
            userId: user._id,
            sessionId: user.session,
            device: user.device,
            eventType: 'ai_doubt_asked',
            meta: {
              message: String(message || '').slice(0, 120),
            },
          }, client);
        }

        return thread;
      });
    }

    const thread = {
      _id: nextId('ai_message'),
      userId: String(userId || 'guest'),
      message: String(message || ''),
      answer,
      createdAt: nowIso(),
    };

    state.aiMessages.push(thread);

    const user = state.users.find((item) => item._id === String(userId));
    if (user) {
      state.deviceActivities.unshift({
        _id: nextId('activity'),
        userId: user._id,
        sessionId: user.session,
        device: user.device,
        eventType: 'ai_doubt_asked',
        meta: {
          message: String(message || '').slice(0, 120),
        },
        createdAt: nowIso(),
      });
      state.deviceActivities = state.deviceActivities.slice(0, 200);
    }

    return clone(thread);
  },
};

module.exports = {
  usersRepository,
  coursesRepository,
  testsRepository,
  quizzesRepository,
  notificationsRepository,
  engagementRepository,
  liveClassesRepository,
  adminRepository,
  analyticsRepository,
  paymentRepository,
  platformRepository,
  sessionRepository,
  sanitizeUser,
};
