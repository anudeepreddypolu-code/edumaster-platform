const { appConfig } = require('../lib/config.js');
const { incrementRedisCounter } = require('../lib/redis.js');

const requestBuckets = new Map();

const buildMediaPermissionsPolicy = () => {
  const allowedOrigins = [`https://${appConfig.jitsiMeetDomain}`];

  if (appConfig.livekitUrl) {
    try {
      const livekitUrl = new URL(appConfig.livekitUrl);
      if (livekitUrl.protocol === 'wss:') {
        livekitUrl.protocol = 'https:';
      } else if (livekitUrl.protocol === 'ws:') {
        livekitUrl.protocol = 'http:';
      }
      const livekitOrigin = livekitUrl.origin;
      if (livekitOrigin.startsWith('https://')) {
        allowedOrigins.push(livekitOrigin);
      }
    } catch {
      // Ignore malformed optional LiveKit URL.
    }
  }

  const originList = Array.from(new Set(allowedOrigins)).map((origin) => `"${origin}"`).join(' ');
  return [
    `camera=(self ${originList})`,
    `microphone=(self ${originList})`,
    `display-capture=(self ${originList})`,
    `speaker-selection=(self ${originList})`,
    `fullscreen=(self ${originList})`,
    `autoplay=(self ${originList})`,
    'geolocation=()',
  ].join(', ');
};

const securityHeaders = (_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader('Permissions-Policy', buildMediaPermissionsPolicy());
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  next();
};

const cleanupBuckets = (now) => {
  requestBuckets.forEach((bucket, key) => {
    if (now - bucket.windowStart > appConfig.rateLimitWindowMs * 2) {
      requestBuckets.delete(key);
    }
  });
};

const isProtectedMediaStreamRequest = (req) => {
  const requestPath = String(req.path || '');
  return requestPath.startsWith('/api/courses/stream/');
};

const buildRateLimitKey = (req) => `${req.ip || 'unknown'}:${req.method}:${req.path}`;

const applyHeadersAndCheckLimit = (res, count) => {
  res.setHeader('X-RateLimit-Limit', String(appConfig.rateLimitMax));
  res.setHeader('X-RateLimit-Remaining', String(Math.max(appConfig.rateLimitMax - count, 0)));

  if (count > appConfig.rateLimitMax) {
    return res.status(429).json({ message: 'Too many requests. Please retry shortly.' });
  }

  return null;
};

const basicRateLimit = async (req, res, next) => {
  if (isProtectedMediaStreamRequest(req)) {
    return next();
  }

  const now = Date.now();
  const key = buildRateLimitKey(req);

  try {
    const redisCount = await incrementRedisCounter(`ratelimit:${key}`, Math.ceil(appConfig.rateLimitWindowMs / 1000));
    if (redisCount !== null) {
      const limited = applyHeadersAndCheckLimit(res, redisCount);
      if (limited) {
        return limited;
      }

      return next();
    }
  } catch {
    // Fall back to in-memory limiting if Redis is unavailable.
  }

  const bucket = requestBuckets.get(key) || { count: 0, windowStart: now };
  if (now - bucket.windowStart > appConfig.rateLimitWindowMs) {
    bucket.count = 0;
    bucket.windowStart = now;
  }
  bucket.count += 1;
  requestBuckets.set(key, bucket);

  const limited = applyHeadersAndCheckLimit(res, bucket.count);
  if (limited) {
    return limited;
  }

  if (requestBuckets.size > 5000) {
    cleanupBuckets(now);
  }

  return next();
};

module.exports = {
  securityHeaders,
  basicRateLimit,
};
