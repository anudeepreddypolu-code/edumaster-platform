const express = require('express');
const { register, login, getSession, logout } = require('./auth.controller.js');
const { requireAuth } = require('../middleware/auth.js');
const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.get('/session', requireAuth, getSession);
router.post('/logout', requireAuth, logout);

module.exports = router;
