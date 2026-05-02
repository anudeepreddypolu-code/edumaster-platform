const jwt = require('jsonwebtoken');
const { appConfig } = require('../lib/config.js');
const { usersRepository, sessionRepository } = require('../lib/repositories.js');

const getTokenFromHeader = (header) => {
  if (!header || !header.startsWith('Bearer ')) {
    return null;
  }

  return header.slice('Bearer '.length).trim();
};

const attachUserFromToken = async (req, token) => {
  try {
    if (!token) {
      return false;
    }

    const decoded = jwt.verify(token, appConfig.jwtSecret);
    const user = await usersRepository.findById(decoded.id);

    if (!user) {
      return false;
    }

    const activeSessionId = await sessionRepository.getActiveSessionId(user._id?.toString?.() || String(user._id), user.session || null);
    if (decoded.session && decoded.session !== (activeSessionId || null)) {
      return false;
    }

    req.user = {
      id: user._id?.toString?.() || String(user._id),
      role: user.role,
      session: user.session || null,
    };

    return true;
  } catch (error) {
    return false;
  }
};

const requireAuth = async (req, res, next) => {
  const token = getTokenFromHeader(req.headers.authorization || '');
  if (!token) {
    return res.status(401).json({ message: 'Authorization token required' });
  }

  const attached = await attachUserFromToken(req, token);
  if (!attached) {
    return res.status(401).json({ message: 'Invalid token' });
  }

  return next();
};

const attachAuthIfPresent = async (req, _res, next) => {
  const token = getTokenFromHeader(req.headers.authorization || '');
  await attachUserFromToken(req, token);
  return next();
};

module.exports = {
  requireAuth,
  attachAuthIfPresent,
};
