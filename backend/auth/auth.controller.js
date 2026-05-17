const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');
const { appConfig } = require('../lib/config.js');
const { usersRepository, sanitizeUser, sessionRepository, platformRepository } = require('../lib/repositories.js');
const {
  createOtpChallenge,
  verifyOtpChallenge,
  normalizeEmail,
  normalizeMobileNumber,
  OtpDeliveryError,
} = require('../lib/auth-otp.js');
const { verifyFirebaseIdToken } = require('../lib/auth-social.js');
const { ApiError, asyncHandler, ok, created, requireString, optionalString, requireBoolean } = require('../lib/http.js');

const validatePassword = (password) => {
  const normalized = requireString(password, 'password', { minLength: 8, maxLength: 128 });
  if (!/[A-Za-z]/.test(normalized) || !/\d/.test(normalized)) {
    throw new ApiError(400, 'password must include at least one letter and one number', { code: 'VALIDATION_ERROR' });
  }

  return normalized;
};

const resolveOtpChannel = ({ email, mobileNumber, requestedChannel }) => {
  const normalizedChannel = String(requestedChannel || '').trim().toLowerCase();
  if (normalizedChannel === 'sms') {
    if (!mobileNumber) {
      throw new ApiError(400, 'Mobile number is required for SMS OTP.', { code: 'MOBILE_REQUIRED' });
    }
    return 'sms';
  }
  if (normalizedChannel === 'email') {
    if (!email) {
      throw new ApiError(400, 'Email is required for email OTP.', { code: 'EMAIL_REQUIRED' });
    }
    return 'email';
  }
  if (email) {
    return 'email';
  }
  if (mobileNumber) {
    return 'sms';
  }
  throw new ApiError(400, 'Email or mobile number is required.', { code: 'IDENTIFIER_REQUIRED' });
};

const buildIdentifierDetails = (identifier) => {
  const normalized = String(identifier || '').trim();
  if (!normalized) {
    throw new ApiError(400, 'Email or mobile number is required.', { code: 'IDENTIFIER_REQUIRED' });
  }

  if (normalized.includes('@')) {
    return {
      type: 'email',
      email: normalizeEmail(normalized),
      mobileNumber: '',
    };
  }

  return {
    type: 'mobile',
    email: '',
    mobileNumber: normalizeMobileNumber(normalized),
  };
};

const createOtpChallengeOrThrow = async (params) => {
  try {
    return await createOtpChallenge(params);
  } catch (error) {
    if (error instanceof OtpDeliveryError) {
      const lowerMessage = String(error.message || '').toLowerCase();
      const isProviderSetupIssue = lowerMessage.includes('only send testing emails')
        || lowerMessage.includes('verify a domain')
        || lowerMessage.includes('not configured');
      throw new ApiError(
        isProviderSetupIssue ? 503 : Number(error.status || 503),
        isProviderSetupIssue
          ? 'OTP delivery is not ready yet. Please finish the email/SMS provider setup and try again.'
          : (error.message || 'Unable to deliver OTP right now. Please try again shortly.'),
        {
          code: error.code || 'OTP_DELIVERY_FAILED',
          details: error.details || undefined,
        },
      );
    }
    throw error;
  }
};

const issueAuthSession = async ({ user, device, forceLogoutOtherSessions = false }) => {
  const userId = String(user._id);
  const activeSessionId = await sessionRepository.getActiveSessionId(userId, user.session || null);
  if (activeSessionId && !forceLogoutOtherSessions) {
    const recentSessions = await sessionRepository.getRecentSessions(userId).catch(() => []);
    const activeSessions = recentSessions
      .filter((session) => session.status === 'active')
      .map((session) => ({
        sessionId: session.sessionId,
        device: session.device || 'Active device',
        lastSeenAt: session.lastSeenAt || session.createdAt || null,
      }));
    const primaryActiveSession = activeSessions.find((session) => session.sessionId === activeSessionId) || activeSessions[0] || null;
    throw new ApiError(409, 'This account is already active on another device.', {
      code: 'SESSION_ACTIVE',
      details: {
        activeDevice: primaryActiveSession?.device || user.device || 'another device',
        activeSessions,
        sessionLimit: 1,
      },
    });
  }

  if (activeSessionId) {
    await sessionRepository.recordLogout({
      userId,
      sessionId: activeSessionId,
      device: user.device || device || null,
      reason: 'replaced',
    });
  }

  const sessionId = Math.random().toString(36).substring(2);
  const updatedUser = await usersRepository.update(userId, {
    session: sessionId,
    device: device || null,
  });
  await sessionRepository.recordLogin({
    userId,
    sessionId,
    device: device || null,
  });

  const token = jwt.sign(
    { id: user._id, role: user.role, session: sessionId, email: user.email, name: user.name },
    appConfig.jwtSecret,
    { expiresIn: '7d' },
  );

  return { token, user: sanitizeUser(updatedUser || user) };
};

const upsertSocialUser = async ({ name, email, provider, providerUid }) => {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    throw new ApiError(400, `${provider} account did not provide a usable email address.`, { code: 'SOCIAL_EMAIL_REQUIRED' });
  }

  const existingUser = await usersRepository.findByEmail(normalizedEmail);
  if (existingUser) {
    const patch = {};
    if (!existingUser.name && name) {
      patch.name = name;
    }
    if (Object.keys(patch).length > 0) {
      return usersRepository.update(existingUser._id, patch);
    }
    return existingUser;
  }

  const generatedPassword = `social-${provider}-${providerUid}-${randomUUID()}`;
  const passwordHash = await bcrypt.hash(generatedPassword, 10);
  return usersRepository.create({
    name: name || `${provider.charAt(0).toUpperCase()}${provider.slice(1)} User`,
    email: normalizedEmail,
    password: passwordHash,
    role: 'student',
  });
};

const register = asyncHandler(async (req, res) => {
  const name = requireString(req.body?.name, 'name', { maxLength: 80 });
  const email = requireString(req.body?.email, 'email', { maxLength: 160 }).toLowerCase();
  const mobileNumber = optionalString(req.body?.mobileNumber, '', { maxLength: 20 });
  const password = validatePassword(req.body?.password);
  const channel = resolveOtpChannel({ email, mobileNumber, requestedChannel: req.body?.channel });

  if (req.body?.role && req.body.role !== 'student') {
    throw new ApiError(403, 'Self-service registration can only create student accounts', {
      code: 'ROLE_NOT_ALLOWED',
    });
  }

  const existingEmail = await usersRepository.findByEmail(email);
  if (existingEmail) {
    throw new ApiError(409, 'Email already exists', { code: 'EMAIL_EXISTS' });
  }

  if (mobileNumber) {
    const existingMobile = await usersRepository.findByMobileNumber(mobileNumber);
    if (existingMobile) {
      throw new ApiError(409, 'Mobile number already exists', { code: 'MOBILE_EXISTS' });
    }
  }

  const hashed = await bcrypt.hash(password, 10);
  const challenge = await createOtpChallengeOrThrow({
    type: 'register',
    channel,
    email,
    mobileNumber,
    metadata: {
      name,
      email,
      mobileNumber,
      passwordHash: hashed,
      role: 'student',
    },
  });

  return created(res, {
    verificationRequired: true,
    challenge,
  });
});

const verifyRegistrationOtp = asyncHandler(async (req, res) => {
  const challengeId = requireString(req.body?.challengeId, 'challengeId', { maxLength: 120 });
  const otp = requireString(req.body?.otp, 'otp', { minLength: 4, maxLength: 12 });
  const device = optionalString(req.body?.device, 'web-dashboard', { maxLength: 120 });

  const verification = await verifyOtpChallenge({ challengeId, otp, expectedType: 'register' });
  if (!verification.ok) {
    throw new ApiError(400, verification.reason, { code: 'OTP_INVALID' });
  }

  const payload = verification.challenge?.metadata || {};
  const email = normalizeEmail(payload.email || '');
  const mobileNumber = normalizeMobileNumber(payload.mobileNumber || '');
  const existingEmail = await usersRepository.findByEmail(email);
  if (existingEmail) {
    throw new ApiError(409, 'Email already exists', { code: 'EMAIL_EXISTS' });
  }
  if (mobileNumber) {
    const existingMobile = await usersRepository.findByMobileNumber(mobileNumber);
    if (existingMobile) {
      throw new ApiError(409, 'Mobile number already exists', { code: 'MOBILE_EXISTS' });
    }
  }

  const user = await usersRepository.create({
    name: payload.name,
    email,
    mobileNumber,
    password: payload.passwordHash,
    role: payload.role || 'student',
  });

  return ok(res, await issueAuthSession({ user, device }));
});

const login = asyncHandler(async (req, res) => {
  await platformRepository.ensureReady().catch(() => undefined);

  const identifier = requireString(req.body?.email ?? req.body?.identifier, 'email', { maxLength: 160 });
  const password = requireString(req.body?.password, 'password', { minLength: 1, maxLength: 128 });
  const device = optionalString(req.body?.device, 'web-dashboard', { maxLength: 120 });
  const forceLogoutOtherSessions = req.body?.forceLogoutOtherSessions === undefined
    ? false
    : requireBoolean(req.body.forceLogoutOtherSessions, 'forceLogoutOtherSessions');

  const user = await usersRepository.findByLoginIdentifier(identifier);
  if (!user) {
    throw new ApiError(401, 'Invalid credentials', { code: 'INVALID_CREDENTIALS' });
  }

  const match = await bcrypt.compare(password, user.password);
  if (!match) {
    throw new ApiError(401, 'Invalid credentials', { code: 'INVALID_CREDENTIALS' });
  }

  return ok(res, await issueAuthSession({ user, device, forceLogoutOtherSessions }));
});

const requestLoginOtp = asyncHandler(async (req, res) => {
  const identifier = requireString(req.body?.identifier ?? req.body?.email, 'identifier', { maxLength: 160 });
  const details = buildIdentifierDetails(identifier);
  const user = await usersRepository.findByLoginIdentifier(identifier);
  if (!user) {
    throw new ApiError(404, 'Account not found', { code: 'USER_NOT_FOUND' });
  }

  const channel = resolveOtpChannel({
    email: details.email || user.email,
    mobileNumber: details.mobileNumber || user.mobileNumber,
    requestedChannel: req.body?.channel,
  });

  const challenge = await createOtpChallengeOrThrow({
    type: 'login',
    channel,
    email: user.email,
    mobileNumber: user.mobileNumber,
    userId: user._id,
  });

  return ok(res, { challenge });
});

const loginWithOtp = asyncHandler(async (req, res) => {
  const challengeId = requireString(req.body?.challengeId, 'challengeId', { maxLength: 120 });
  const otp = requireString(req.body?.otp, 'otp', { minLength: 4, maxLength: 12 });
  const device = optionalString(req.body?.device, 'web-dashboard', { maxLength: 120 });
  const forceLogoutOtherSessions = req.body?.forceLogoutOtherSessions === undefined
    ? false
    : requireBoolean(req.body.forceLogoutOtherSessions, 'forceLogoutOtherSessions');

  const verification = await verifyOtpChallenge({ challengeId, otp, expectedType: 'login' });
  if (!verification.ok) {
    throw new ApiError(400, verification.reason, { code: 'OTP_INVALID' });
  }

  const user = await usersRepository.findById(verification.challenge.userId);
  if (!user) {
    throw new ApiError(404, 'User not found', { code: 'USER_NOT_FOUND' });
  }

  return ok(res, await issueAuthSession({ user, device, forceLogoutOtherSessions }));
});

const socialLogin = asyncHandler(async (req, res) => {
  await platformRepository.ensureReady().catch(() => undefined);

  const idToken = requireString(req.body?.idToken, 'idToken', { maxLength: 8_192 });
  const provider = requireString(req.body?.provider, 'provider', { maxLength: 40 }).toLowerCase();
  const device = optionalString(req.body?.device, 'web-dashboard', { maxLength: 120 });
  const forceLogoutOtherSessions = req.body?.forceLogoutOtherSessions === undefined
    ? false
    : requireBoolean(req.body.forceLogoutOtherSessions, 'forceLogoutOtherSessions');

  if (!['google', 'apple'].includes(provider)) {
    throw new ApiError(400, 'Unsupported social login provider.', { code: 'SOCIAL_PROVIDER_UNSUPPORTED' });
  }

  let firebasePayload;
  try {
    firebasePayload = await verifyFirebaseIdToken(idToken);
  } catch (error) {
    throw new ApiError(401, error instanceof Error ? error.message : 'Invalid social login token.', {
      code: 'SOCIAL_TOKEN_INVALID',
    });
  }

  const firebaseProvider = Array.isArray(firebasePayload.firebase?.sign_in_provider)
    ? firebasePayload.firebase.sign_in_provider[0]
    : firebasePayload.firebase?.sign_in_provider;
  if (provider === 'google' && firebaseProvider !== 'google.com') {
    throw new ApiError(401, 'Google login token did not come from Google provider.', { code: 'SOCIAL_PROVIDER_MISMATCH' });
  }
  if (provider === 'apple' && firebaseProvider !== 'apple.com') {
    throw new ApiError(401, 'Apple login token did not come from Apple provider.', { code: 'SOCIAL_PROVIDER_MISMATCH' });
  }

  const email = normalizeEmail(firebasePayload.email || '');
  const name = String(firebasePayload.name || '').trim();
  const user = await upsertSocialUser({
    name,
    email,
    provider,
    providerUid: firebasePayload.user_id || firebasePayload.sub,
  });

  return ok(res, await issueAuthSession({ user, device, forceLogoutOtherSessions }));
});

const requestPasswordResetOtp = asyncHandler(async (req, res) => {
  const identifier = requireString(req.body?.identifier ?? req.body?.email, 'identifier', { maxLength: 160 });
  const details = buildIdentifierDetails(identifier);
  const user = await usersRepository.findByLoginIdentifier(identifier);
  if (!user) {
    throw new ApiError(404, 'Account not found', { code: 'USER_NOT_FOUND' });
  }

  const channel = resolveOtpChannel({
    email: details.email || user.email,
    mobileNumber: details.mobileNumber || user.mobileNumber,
    requestedChannel: req.body?.channel,
  });

  const challenge = await createOtpChallengeOrThrow({
    type: 'reset-password',
    channel,
    email: user.email,
    mobileNumber: user.mobileNumber,
    userId: user._id,
  });

  return ok(res, { challenge });
});

const resetPasswordWithOtp = asyncHandler(async (req, res) => {
  const challengeId = requireString(req.body?.challengeId, 'challengeId', { maxLength: 120 });
  const otp = requireString(req.body?.otp, 'otp', { minLength: 4, maxLength: 12 });
  const newPassword = validatePassword(req.body?.password);
  const loginAfterReset = req.body?.loginAfterReset === undefined
    ? true
    : requireBoolean(req.body.loginAfterReset, 'loginAfterReset');
  const device = optionalString(req.body?.device, 'web-dashboard', { maxLength: 120 });

  const verification = await verifyOtpChallenge({ challengeId, otp, expectedType: 'reset-password' });
  if (!verification.ok) {
    throw new ApiError(400, verification.reason, { code: 'OTP_INVALID' });
  }

  const user = await usersRepository.findById(verification.challenge.userId);
  if (!user) {
    throw new ApiError(404, 'User not found', { code: 'USER_NOT_FOUND' });
  }

  const hashed = await bcrypt.hash(newPassword, 10);
  const updatedUser = await usersRepository.update(user._id, {
    password: hashed,
  });

  if (!loginAfterReset) {
    return ok(res, { message: 'Password updated successfully' });
  }

  return ok(res, await issueAuthSession({ user: updatedUser || user, device, forceLogoutOtherSessions: true }));
});

const getSession = asyncHandler(async (req, res) => {
  const user = await usersRepository.findSafeById(req.user.id);
  if (!user) {
    throw new ApiError(404, 'User not found', { code: 'USER_NOT_FOUND' });
  }

  return ok(res, { user });
});

const logout = asyncHandler(async (req, res) => {
  const currentUser = await usersRepository.findById(req.user.id);
  await usersRepository.update(req.user.id, {
    session: null,
    device: null,
  });
  await sessionRepository.recordLogout({
    userId: req.user.id,
    sessionId: req.user.session,
    device: currentUser?.device || null,
    reason: 'logout',
  });

  return ok(res, { message: 'Logged out successfully' });
});

module.exports = {
  register,
  verifyRegistrationOtp,
  login,
  requestLoginOtp,
  loginWithOtp,
  socialLogin,
  requestPasswordResetOtp,
  resetPasswordWithOtp,
  getSession,
  logout,
};
