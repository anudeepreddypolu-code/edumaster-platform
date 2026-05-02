const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { appConfig } = require('./config.js');

const privateVideosRoot = path.join(process.cwd(), 'private_uploads', 'videos');
const privateHlsRoot = path.join(process.cwd(), 'private_uploads', 'hls');

const ensurePrivateVideoRoot = () => {
  if (!fs.existsSync(privateVideosRoot)) {
    fs.mkdirSync(privateVideosRoot, { recursive: true });
  }

  if (!fs.existsSync(privateHlsRoot)) {
    fs.mkdirSync(privateHlsRoot, { recursive: true });
  }
};

const toBase64Url = (value) => Buffer.from(value).toString('base64url');
const fromBase64Url = (value) => Buffer.from(value, 'base64url').toString('utf8');
const getSigningSecret = () => appConfig.privateVideoTokenSecret || appConfig.jwtSecret;
const signEncodedPayload = (encodedPayload) => crypto
  .createHmac('sha256', getSigningSecret())
  .update(encodedPayload)
  .digest('base64url');

const createStorageFileName = (lessonId, originalName = '') => {
  const extension = path.extname(String(originalName || '')).slice(0, 12) || '.mp4';
  return `${lessonId}${extension}`;
};

const buildPrivateVideoStorageKey = ({ courseId, moduleId, lessonId, originalName }) => {
  const safeCourseId = String(courseId || 'course').replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeModuleId = String(moduleId || 'module').replace(/[^a-zA-Z0-9_-]/g, '_');
  const fileName = createStorageFileName(lessonId, originalName);
  return path.posix.join(safeCourseId, safeModuleId, fileName);
};

const buildPrivateVideoStoragePath = ({ courseId, moduleId, lessonId, originalName }) => {
  ensurePrivateVideoRoot();
  return path.join(privateVideosRoot, buildPrivateVideoStorageKey({
    courseId,
    moduleId,
    lessonId,
    originalName,
  }));
};

const buildPrivateHlsAssetKey = ({ courseId, moduleId, lessonId, assetName = 'master.m3u8' }) => {
  const safeCourseId = String(courseId || 'course').replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeModuleId = String(moduleId || 'module').replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeLessonId = String(lessonId || 'lesson').replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeAssetName = String(assetName || 'master.m3u8').replace(/[^a-zA-Z0-9._/-]/g, '_');
  return path.posix.join(safeCourseId, safeModuleId, safeLessonId, safeAssetName);
};

const resolvePrivateHlsPath = (assetPath) => {
  if (!assetPath) {
    return null;
  }

  const rawValue = String(assetPath);
  const candidate = path.isAbsolute(rawValue)
    ? rawValue
    : path.join(privateHlsRoot, rawValue);
  const resolved = path.resolve(candidate);
  const allowedRoot = path.resolve(privateHlsRoot);
  const normalizedRoot = `${allowedRoot}${path.sep}`;
  if (resolved !== allowedRoot && !resolved.startsWith(normalizedRoot)) {
    return null;
  }

  return resolved;
};

const ensureStorageDirectory = (filePath) => {
  const directory = path.dirname(filePath);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
};

const issuePlaybackToken = (payload) => {
  const expiresAt = Date.now() + (appConfig.privateVideoTokenTtlSeconds * 1000);
  const tokenPayload = {
    ...payload,
    exp: expiresAt,
  };
  const encodedPayload = toBase64Url(JSON.stringify(tokenPayload));
  const signature = signEncodedPayload(encodedPayload);

  return {
    token: `${encodedPayload}.${signature}`,
    expiresAt: new Date(expiresAt).toISOString(),
  };
};

const verifyPlaybackToken = (token) => {
  const [encodedPayload, providedSignature] = String(token || '').split('.');
  if (!encodedPayload || !providedSignature) {
    return null;
  }

  const expectedSignature = signEncodedPayload(encodedPayload);

  if (providedSignature.length !== expectedSignature.length) {
    return null;
  }

  const signaturesMatch = crypto.timingSafeEqual(
    Buffer.from(providedSignature),
    Buffer.from(expectedSignature),
  );

  if (!signaturesMatch) {
    return null;
  }

  try {
    const payload = JSON.parse(fromBase64Url(encodedPayload));
    if (!payload?.exp || Number(payload.exp) < Date.now()) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
};

const resolvePrivateVideoPath = (storagePath) => {
  if (!storagePath) {
    return null;
  }

  const rawValue = String(storagePath);
  const candidate = path.isAbsolute(rawValue)
    ? rawValue
    : path.join(privateVideosRoot, rawValue);
  const resolved = path.resolve(candidate);
  const allowedRoot = path.resolve(privateVideosRoot);
  const normalizedRoot = `${allowedRoot}${path.sep}`;
  if (resolved !== allowedRoot && !resolved.startsWith(normalizedRoot)) {
    return null;
  }

  return resolved;
};

module.exports = {
  privateVideosRoot,
  privateHlsRoot,
  ensurePrivateVideoRoot,
  buildPrivateVideoStorageKey,
  buildPrivateVideoStoragePath,
  buildPrivateHlsAssetKey,
  ensureStorageDirectory,
  issuePlaybackToken,
  verifyPlaybackToken,
  resolvePrivateVideoPath,
  resolvePrivateHlsPath,
};
