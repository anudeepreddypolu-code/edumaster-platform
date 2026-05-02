// Course Controller
const fs = require('fs');
const path = require('path');
const { coursesRepository, sessionRepository } = require('../lib/repositories.js');
const {
  ApiError,
  asyncHandler,
  ok,
  created,
  requireString,
  optionalString,
  optionalNumber,
} = require('../lib/http.js');
const { issuePlaybackToken, verifyPlaybackToken, resolvePrivateVideoPath, resolvePrivateHlsPath } = require('../lib/private-video.js');
const {
  getSignedPrivateVideoUrl,
  getPrivateStorageObjectBuffer,
  isS3Provider,
} = require('../lib/private-video-storage.js');
const {
  getHlsAssetMimeType,
  rewriteHlsManifestUris,
} = require('../lib/hls-manifest.js');
const { appConfig } = require('../lib/config.js');

const defaultCourseValidityDays = appConfig.courseDefaultValidityDays || 183;

const buildHlsAssetUrl = (payload, assetPath, mimeType) => {
  const issued = issuePlaybackToken({
    userId: payload.userId,
    sessionId: payload.sessionId,
    courseId: payload.courseId,
    lessonId: payload.lessonId,
    storageProvider: payload.storageProvider || 'local',
    storagePath: assetPath,
    mimeType,
    assetKind: 'hls',
  });
  return `/backend/api/courses/stream/${issued.token}`;
};

const rewriteHlsManifest = (manifestText, payload) => rewriteHlsManifestUris(manifestText, (assetReference) => {
  const resolvedAssetPath = path.posix.join(path.posix.dirname(payload.storagePath), assetReference);
  const mimeType = getHlsAssetMimeType(resolvedAssetPath);
  return buildHlsAssetUrl(
    {
      ...payload,
      storagePath: resolvedAssetPath,
    },
    resolvedAssetPath,
    mimeType,
  );
});

const getCourses = asyncHandler(async (req, res) => {
  const courses = await coursesRepository.listForViewer(req.user?.id || null);
  return ok(res, courses);
});

const getCourse = asyncHandler(async (req, res) => {
  const courseId = requireString(req.params.id, 'course id');
  const course = await coursesRepository.findVisibleById(courseId, req.user?.id || null);
  if (!course) {
    throw new ApiError(404, 'Course not found', { code: 'COURSE_NOT_FOUND' });
  }

  return ok(res, course);
});

const getCourseLessons = asyncHandler(async (req, res) => {
  const courseId = requireString(req.params.id, 'course id');
  const lessons = await coursesRepository.listLessons(courseId, req.user?.id || null);
  return ok(res, lessons);
});

const getProtectedLessonPlayer = asyncHandler(async (req, res) => {
  const courseId = requireString(req.params.id, 'course id');
  const lessonId = requireString(req.params.lessonId, 'lesson id');
  const player = await coursesRepository.getProtectedLessonPlayback({
    userId: req.user?.id || null,
    courseId,
    lessonId,
  });
  return ok(res, player);
});

const streamProtectedLesson = asyncHandler(async (req, res) => {
  const token = requireString(req.params.token, 'playback token');
  const payload = verifyPlaybackToken(token);

  if (!payload) {
    throw new ApiError(401, 'Playback token is invalid or expired', { code: 'PLAYBACK_TOKEN_INVALID' });
  }

  const activeSessionId = payload.userId
    ? await sessionRepository.getActiveSessionId(String(payload.userId), payload.sessionId || null)
    : null;
  if (payload.sessionId && activeSessionId !== payload.sessionId) {
    throw new ApiError(401, 'Playback session is no longer active', { code: 'PLAYBACK_SESSION_INVALID' });
  }

  if (isS3Provider(payload.storageProvider) && payload.assetKind === 'hls') {
    const extension = path.extname(String(payload.storagePath || '')).toLowerCase();
    if (extension === '.m3u8') {
      const manifestBuffer = await getPrivateStorageObjectBuffer({
        storageProvider: payload.storageProvider,
        storagePath: payload.storagePath,
      });

      if (!manifestBuffer) {
        throw new ApiError(404, 'Protected HLS manifest could not be delivered', { code: 'PRIVATE_HLS_MANIFEST_UNAVAILABLE' });
      }

      res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.send(rewriteHlsManifest(manifestBuffer.toString('utf8'), payload));
      return;
    }

    const signedUrl = await getSignedPrivateVideoUrl({
      storagePath: payload.storagePath,
      mimeType: payload.mimeType,
    });

    if (!signedUrl) {
      throw new ApiError(404, 'Protected HLS asset could not be delivered', { code: 'PRIVATE_HLS_URL_UNAVAILABLE' });
    }

    res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
    res.redirect(307, signedUrl);
    return;
  }

  if (isS3Provider(payload.storageProvider)) {
    const signedUrl = await getSignedPrivateVideoUrl({
      storagePath: payload.storagePath,
      mimeType: payload.mimeType,
    });

    if (!signedUrl) {
      throw new ApiError(404, 'Protected video could not be delivered', { code: 'PRIVATE_VIDEO_URL_UNAVAILABLE' });
    }

    res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
    res.redirect(307, signedUrl);
    return;
  }

  if (payload.assetKind === 'hls') {
    const assetPath = resolvePrivateHlsPath(payload.storagePath);
    if (!assetPath || !fs.existsSync(assetPath)) {
      throw new ApiError(404, 'Protected HLS asset not found', { code: 'PRIVATE_HLS_NOT_FOUND' });
    }

    const extension = path.extname(assetPath).toLowerCase();
    const mimeType = getHlsAssetMimeType(assetPath, payload.mimeType || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', mimeType);

    if (extension === '.m3u8') {
      const rawManifest = fs.readFileSync(assetPath, 'utf8');
      const rewritten = rewriteHlsManifest(rawManifest, payload, assetPath);
      res.send(rewritten);
      return;
    }

    res.sendFile(assetPath);
    return;
  }

  const filePath = resolvePrivateVideoPath(payload.storagePath);
  if (!filePath || !fs.existsSync(filePath)) {
    throw new ApiError(404, 'Protected video file not found', { code: 'PRIVATE_VIDEO_NOT_FOUND' });
  }

  const stat = fs.statSync(filePath);
  const mimeType = payload.mimeType || 'video/mp4';
  const range = req.headers.range;

  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (!range) {
    res.setHeader('Content-Length', stat.size);
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  const [startText, endText] = String(range).replace(/bytes=/, '').split('-');
  const start = Number(startText || 0);
  const end = endText ? Number(endText) : stat.size - 1;

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end >= stat.size || start > end) {
    res.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end();
    return;
  }

  res.status(206);
  res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
  res.setHeader('Content-Length', end - start + 1);
  fs.createReadStream(filePath, { start, end }).pipe(res);
});

const createCourse = asyncHandler(async (req, res) => {
  const title = requireString(req.body?.title, 'title', { maxLength: 160 });
  const description = optionalString(req.body?.description, '', { maxLength: 3000 });
  const category = optionalString(req.body?.category, 'SSC JE', { maxLength: 80 });
  const exam = optionalString(req.body?.exam, category, { maxLength: 80 });
  const subject = optionalString(req.body?.subject, 'General', { maxLength: 120 });
  const instructor = optionalString(req.body?.instructor, 'VARONENGLISH Faculty', { maxLength: 120 });
  const officialChannelUrl = optionalString(req.body?.officialChannelUrl, '', { maxLength: 500 }) || null;
  const level = optionalString(req.body?.level, 'Full Course', { maxLength: 80 });
  const thumbnailUrl = optionalString(req.body?.thumbnailUrl, '', { maxLength: 500 });
  const price = optionalNumber(req.body?.price, 0, { min: 0 });
  const validityDays = optionalNumber(req.body?.validityDays, defaultCourseValidityDays, { min: 1, max: 3650, integer: true });
  const modules = Array.isArray(req.body?.modules) ? req.body.modules : [];

  const course = await coursesRepository.create({
    title,
    description,
    category,
    exam,
    subject,
    instructor,
    officialChannelUrl,
    level,
    thumbnailUrl,
    price,
    validityDays,
    modules,
    createdBy: req.user?.id || req.body?.createdBy || null,
  });
  return created(res, course);
});

module.exports = { getCourses, getCourse, getCourseLessons, getProtectedLessonPlayer, streamProtectedLesson, createCourse };
