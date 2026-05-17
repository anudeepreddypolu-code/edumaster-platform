const express = require('express');
const {
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
} = require('./auth.controller.js');
const { requireAuth } = require('../middleware/auth.js');
const router = express.Router();

router.post('/register', register);
router.post('/register/verify-otp', verifyRegistrationOtp);
router.post('/login', login);
router.post('/login/request-otp', requestLoginOtp);
router.post('/login/verify-otp', loginWithOtp);
router.post('/social', socialLogin);
router.post('/forgot-password/request-otp', requestPasswordResetOtp);
router.post('/forgot-password/reset', resetPasswordWithOtp);
router.get('/session', requireAuth, getSession);
router.post('/logout', requireAuth, logout);

module.exports = router;
