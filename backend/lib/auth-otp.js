const { createHash, randomInt, randomUUID } = require('crypto');
const { appConfig } = require('./config.js');
const { getRedisJson, setRedisJson, deleteRedisKey } = require('./redis.js');

const memoryChallenges = new Map();
const CHALLENGE_PREFIX = 'auth-otp:challenge';
const LATEST_PREFIX = 'auth-otp:latest';
const OTP_TTL_SECONDS = Math.max(60, Number(appConfig.authOtpTtlSeconds || 600));
const OTP_MAX_ATTEMPTS = Math.max(1, Number(appConfig.authOtpMaxAttempts || 5));
const DELIVERY_TIMEOUT_MS = Math.max(1_000, Number(appConfig.authOtpDeliveryTimeoutMs || 10_000));

class OtpDeliveryError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'OtpDeliveryError';
    this.code = details.code || 'OTP_DELIVERY_FAILED';
    this.status = details.status || 503;
    this.details = details;
  }
}

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const normalizeMobileNumber = (value) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return '';
  }
  const normalized = trimmed.replace(/[^\d+]/g, '');
  if (!normalized) {
    return '';
  }
  if (normalized.startsWith('+')) {
    return `+${normalized.slice(1).replace(/\D/g, '')}`;
  }
  return normalized.replace(/\D/g, '');
};

const maskEmail = (email) => {
  const normalized = normalizeEmail(email);
  const [localPart, domain] = normalized.split('@');
  if (!localPart || !domain) {
    return normalized;
  }
  const visible = localPart.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(localPart.length - 2, 1))}@${domain}`;
};

const maskMobile = (mobileNumber) => {
  const normalized = normalizeMobileNumber(mobileNumber);
  if (!normalized) {
    return '';
  }
  const visible = normalized.slice(-4);
  return `${'*'.repeat(Math.max(normalized.length - 4, 4))}${visible}`;
};

const destinationMask = (channel, value) => (channel === 'sms' ? maskMobile(value) : maskEmail(value));
const getChallengeKey = (challengeId) => `${CHALLENGE_PREFIX}:${challengeId}`;
const getLatestKey = (type, identifier) => `${LATEST_PREFIX}:${type}:${identifier}`;

const hashOtp = (otp) => createHash('sha256')
  .update(`${String(otp || '')}:${String(appConfig.jwtSecret || '')}`)
  .digest('hex');

const loadChallenge = async (challengeId) => {
  const key = getChallengeKey(challengeId);
  const redisValue = await getRedisJson(key).catch(() => null);
  if (redisValue) {
    return redisValue;
  }

  const memoryValue = memoryChallenges.get(key) || null;
  if (!memoryValue) {
    return null;
  }
  if (Number(memoryValue.expiresAt || 0) <= Date.now()) {
    memoryChallenges.delete(key);
    return null;
  }
  return memoryValue;
};

const persistChallenge = async (challenge) => {
  const key = getChallengeKey(challenge.challengeId);
  await setRedisJson(key, challenge, { ttlSeconds: OTP_TTL_SECONDS }).catch(() => undefined);
  memoryChallenges.set(key, challenge);
};

const clearChallenge = async (challenge) => {
  if (!challenge?.challengeId) {
    return;
  }
  const key = getChallengeKey(challenge.challengeId);
  const latestIdentifier = challenge.channel === 'sms'
    ? normalizeMobileNumber(challenge.mobileNumber || '')
    : normalizeEmail(challenge.email || '');
  memoryChallenges.delete(key);
  await deleteRedisKey(key).catch(() => undefined);
  if (latestIdentifier) {
    await deleteRedisKey(getLatestKey(challenge.type, latestIdentifier)).catch(() => undefined);
  }
};

const postJson = async (url, payload, headers = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Delivery provider failed with ${response.status}${body ? `: ${body}` : ''}`);
    }
  } finally {
    clearTimeout(timeout);
  }
};

const postForm = async (url, formBody, headers = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        ...headers,
      },
      body: formBody,
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Delivery provider failed with ${response.status}${body ? `: ${body}` : ''}`);
    }
  } finally {
    clearTimeout(timeout);
  }
};

const buildOtpSubject = (type) => {
  if (type === 'reset-password') {
    return 'Reset your VaronEnglish password';
  }
  if (type === 'login') {
    return 'Your VaronEnglish login OTP';
  }
  return 'Verify your VaronEnglish account';
};

const buildOtpText = (challenge, otp) => {
  const action = challenge.type === 'reset-password'
    ? 'reset your password'
    : challenge.type === 'login'
      ? 'sign in'
      : 'verify your account';
  return `Your VaronEnglish OTP is ${otp}. Use this code to ${action}. It expires in ${Math.round(OTP_TTL_SECONDS / 60)} minutes.`;
};

const sendViaWebhook = async (url, payload) => {
  await postJson(url, payload);
};

const sendViaResend = async (challenge, otp) => {
  if (!appConfig.authOtpEmailApiKey || !appConfig.authOtpEmailFromAddress) {
    throw new Error('Resend email delivery is not fully configured');
  }

  await postJson(
    'https://api.resend.com/emails',
    {
      from: appConfig.authOtpEmailFromAddress,
      to: [challenge.email],
      reply_to: appConfig.authOtpEmailReplyTo || undefined,
      subject: buildOtpSubject(challenge.type),
      text: buildOtpText(challenge, otp),
    },
    {
      authorization: `Bearer ${appConfig.authOtpEmailApiKey}`,
    },
  );
};

const sendViaTwilio = async (challenge, otp) => {
  if (!appConfig.authOtpSmsAccountSid || !appConfig.authOtpSmsAuthToken) {
    throw new Error('Twilio SMS delivery is not fully configured');
  }

  const params = new URLSearchParams();
  params.set('To', challenge.mobileNumber);
  params.set('Body', buildOtpText(challenge, otp));
  if (appConfig.authOtpSmsMessagingServiceSid) {
    params.set('MessagingServiceSid', appConfig.authOtpSmsMessagingServiceSid);
  } else if (appConfig.authOtpSmsFromNumber) {
    params.set('From', appConfig.authOtpSmsFromNumber);
  } else {
    throw new Error('Twilio SMS sender is not configured');
  }

  const basicAuth = Buffer.from(`${appConfig.authOtpSmsAccountSid}:${appConfig.authOtpSmsAuthToken}`).toString('base64');
  await postForm(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(appConfig.authOtpSmsAccountSid)}/Messages.json`,
    params.toString(),
    {
      authorization: `Basic ${basicAuth}`,
    },
  );
};

const deliverOtp = async (challenge, otp) => {
  const sender = appConfig.authOtpSenderName || 'Edumaster';

  if (challenge.channel === 'email') {
    if (appConfig.authOtpEmailWebhookUrl) {
      await sendViaWebhook(appConfig.authOtpEmailWebhookUrl, {
        sender,
        to: challenge.email,
        otp,
        purpose: challenge.type,
        challengeId: challenge.challengeId,
        expiresInSeconds: OTP_TTL_SECONDS,
      });
      return;
    }

    if (String(appConfig.authOtpEmailProvider || '').toLowerCase() === 'resend') {
      await sendViaResend(challenge, otp);
      return;
    }
  }

  if (challenge.channel === 'sms') {
    if (appConfig.authOtpSmsWebhookUrl) {
      await sendViaWebhook(appConfig.authOtpSmsWebhookUrl, {
        sender,
        to: challenge.mobileNumber,
        otp,
        purpose: challenge.type,
        challengeId: challenge.challengeId,
        expiresInSeconds: OTP_TTL_SECONDS,
      });
      return;
    }

    if (String(appConfig.authOtpSmsProvider || '').toLowerCase() === 'twilio') {
      await sendViaTwilio(challenge, otp);
      return;
    }
  }

  throw new OtpDeliveryError(`OTP ${challenge.channel} delivery is not configured`, {
    code: 'OTP_DELIVERY_NOT_CONFIGURED',
    channel: challenge.channel,
  });
};

const createOtpChallenge = async ({
  type,
  channel,
  email = '',
  mobileNumber = '',
  userId = null,
  metadata = {},
}) => {
  const normalizedEmail = normalizeEmail(email);
  const normalizedMobileNumber = normalizeMobileNumber(mobileNumber);
  const challengeId = `otp_${randomUUID().replace(/-/g, '')}`;
  const otp = String(randomInt(100000, 1000000));
  const expiresAt = Date.now() + (OTP_TTL_SECONDS * 1000);
  const challenge = {
    challengeId,
    type,
    channel,
    email: normalizedEmail || null,
    mobileNumber: normalizedMobileNumber || null,
    userId: userId ? String(userId) : null,
    otpHash: hashOtp(otp),
    attempts: 0,
    createdAt: new Date().toISOString(),
    expiresAt,
    metadata,
  };

  await persistChallenge(challenge);
  const latestIdentifier = channel === 'sms' ? normalizedMobileNumber : normalizedEmail;
  if (latestIdentifier) {
    await setRedisJson(getLatestKey(type, latestIdentifier), { challengeId }, { ttlSeconds: OTP_TTL_SECONDS }).catch(() => undefined);
  }
  try {
    await deliverOtp(challenge, otp);
  } catch (error) {
    await clearChallenge(challenge).catch(() => undefined);
    if (error instanceof OtpDeliveryError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : 'OTP delivery failed';
    throw new OtpDeliveryError(message, {
      channel,
      provider: channel === 'email'
        ? String(appConfig.authOtpEmailProvider || '').toLowerCase() || (appConfig.authOtpEmailWebhookUrl ? 'webhook' : '')
        : String(appConfig.authOtpSmsProvider || '').toLowerCase() || (appConfig.authOtpSmsWebhookUrl ? 'webhook' : ''),
    });
  }

  return {
    challengeId,
    channel,
    expiresInSeconds: OTP_TTL_SECONDS,
    destination: destinationMask(channel, channel === 'sms' ? normalizedMobileNumber : normalizedEmail),
  };
};

const verifyOtpChallenge = async ({ challengeId, otp, expectedType }) => {
  const challenge = await loadChallenge(challengeId);
  if (!challenge) {
    return { ok: false, reason: 'OTP expired or invalid.' };
  }
  if (expectedType && challenge.type !== expectedType) {
    return { ok: false, reason: 'OTP challenge type mismatch.' };
  }
  if (Number(challenge.expiresAt || 0) <= Date.now()) {
    await clearChallenge(challenge);
    return { ok: false, reason: 'OTP expired. Request a new code.' };
  }
  if (Number(challenge.attempts || 0) >= OTP_MAX_ATTEMPTS) {
    await clearChallenge(challenge);
    return { ok: false, reason: 'Too many invalid OTP attempts. Request a new code.' };
  }

  if (challenge.otpHash !== hashOtp(otp)) {
    challenge.attempts = Number(challenge.attempts || 0) + 1;
    await persistChallenge(challenge);
    return { ok: false, reason: 'Invalid OTP. Please try again.' };
  }

  await clearChallenge(challenge);
  return { ok: true, challenge };
};

module.exports = {
  createOtpChallenge,
  verifyOtpChallenge,
  normalizeEmail,
  normalizeMobileNumber,
  OtpDeliveryError,
};
