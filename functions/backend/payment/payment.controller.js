// Payment Controller
const { paymentRepository } = require('../lib/repositories.js');
const { ApiError, asyncHandler, ok, requireNumber, requireString, optionalString } = require('../lib/http.js');

const checkout = asyncHandler(async (req, res) => {
  const payment = await paymentRepository.createCheckout({
    userId: req.user?.id,
    amount: requireNumber(req.body?.amount, 'amount', { min: 1 }),
    currency: optionalString(req.body?.currency, 'INR', { maxLength: 12 }),
    item: optionalString(req.body?.item, 'Course Purchase', { maxLength: 160 }),
  });
  return ok(res, payment);
});

const webhook = asyncHandler(async (req, res) => {
  const paymentId = requireString(req.body?.paymentId, 'paymentId');
  const status = requireString(req.body?.status, 'status');
  const webhookRecord = await paymentRepository.handleWebhook({
    ...req.body,
    paymentId,
    status,
    event: optionalString(req.body?.event, 'payment.updated', { maxLength: 120 }),
  });
  return ok(res, { message: 'Webhook received', webhook: webhookRecord });
});

const retryPayment = asyncHandler(async (req, res) => {
  const payment = await paymentRepository.retryPayment(requireString(req.params.paymentId, 'paymentId'), req.user?.id);
  if (payment === null) {
    throw new ApiError(404, 'Payment not found', { code: 'PAYMENT_NOT_FOUND' });
  }

  if (payment === false) {
    throw new ApiError(403, 'Cannot retry payment for another user', { code: 'PAYMENT_FORBIDDEN' });
  }

  return ok(res, payment);
});

module.exports = {
  checkout,
  webhook,
  retryPayment,
};
