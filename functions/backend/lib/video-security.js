const crypto = require('crypto');
const { appConfig } = require('./config.js');

const algorithm = 'aes-256-gcm';

const buildKey = () => crypto.createHash('sha256').update(String(appConfig.jwtSecret || 'edumaster-video-key')).digest();

const normalizeYouTubeVideoId = (value) => {
  const raw = String(value || '').trim();
  if (!raw) {
    return null;
  }

  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) {
    return raw;
  }

  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();

    if (host === 'youtu.be') {
      const candidate = url.pathname.split('/').filter(Boolean).pop();
      return candidate && /^[A-Za-z0-9_-]{11}$/.test(candidate) ? candidate : null;
    }

    if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
      const direct = url.searchParams.get('v');
      if (direct && /^[A-Za-z0-9_-]{11}$/.test(direct)) {
        return direct;
      }

      const candidate = url.pathname.split('/').filter(Boolean).pop();
      return candidate && /^[A-Za-z0-9_-]{11}$/.test(candidate) ? candidate : null;
    }
  } catch {
    return null;
  }

  return null;
};

const encryptVideoId = (videoId) => {
  const normalized = normalizeYouTubeVideoId(videoId);
  if (!normalized) {
    throw new Error('Invalid YouTube video ID');
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(algorithm, buildKey(), iv);
  const encrypted = Buffer.concat([cipher.update(normalized, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
};

const decryptVideoId = (ciphertext) => {
  if (!ciphertext) {
    return null;
  }

  const [ivEncoded, tagEncoded, payloadEncoded] = String(ciphertext).split('.');
  if (!ivEncoded || !tagEncoded || !payloadEncoded) {
    return null;
  }

  try {
    const decipher = crypto.createDecipheriv(
      algorithm,
      buildKey(),
      Buffer.from(ivEncoded, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagEncoded, 'base64url'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(payloadEncoded, 'base64url')),
      decipher.final(),
    ]).toString('utf8');

    return normalizeYouTubeVideoId(decrypted);
  } catch {
    return null;
  }
};

const buildSecureYouTubeEmbedUrl = (videoId, options = {}) => {
  const normalized = normalizeYouTubeVideoId(videoId);
  if (!normalized) {
    return null;
  }

  const url = new URL(`https://www.youtube-nocookie.com/embed/${normalized}`);
  url.searchParams.set('rel', '0');
  url.searchParams.set('modestbranding', '1');
  url.searchParams.set('playsinline', '1');
  url.searchParams.set('iv_load_policy', '3');
  url.searchParams.set('disablekb', '1');
  url.searchParams.set('fs', '0');
  url.searchParams.set('controls', '1');
  url.searchParams.set('enablejsapi', '1');
  url.searchParams.set('origin', appConfig.appUrl);

  if (options.startSeconds && Number(options.startSeconds) > 0) {
    url.searchParams.set('start', String(Math.max(Math.floor(Number(options.startSeconds)), 0)));
  }

  return url.toString();
};

module.exports = {
  normalizeYouTubeVideoId,
  encryptVideoId,
  decryptVideoId,
  buildSecureYouTubeEmbedUrl,
};
