const express = require('express');
const { checkout, webhook, retryPayment } = require('./payment.controller.js');
const { requireAuth } = require('../middleware/auth.js');
const router = express.Router();

router.post('/checkout', requireAuth, checkout);
router.post('/:paymentId/retry', requireAuth, retryPayment);
router.post('/webhook', webhook);

module.exports = router;
