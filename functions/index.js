const express = require('express');
const { onRequest } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const Stripe = require('stripe');

const { app: backendApp } = require('./backend/server.cjs');
const { requireAuth } = require('./backend/middleware/auth.js');
const { paymentRepository, platformRepository, coursesRepository } = require('./backend/lib/repositories.js');

setGlobalOptions({
  region: process.env.FUNCTION_REGION || 'asia-south1',
  maxInstances: 1,
});

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

class RootApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const addRootSecurityHeaders = (_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
};

const requireString = (value, fieldName) => {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    throw new RootApiError(400, `${fieldName} is required.`);
  }

  return normalized;
};

const requirePositiveNumber = (value, fieldName) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new RootApiError(400, `${fieldName} must be a positive number.`);
  }

  return parsed;
};

const sendRootError = (res, error) => {
  const status = error instanceof RootApiError ? error.status : 500;
  const message = error instanceof Error ? error.message : 'Internal server error';

  if (status >= 500) {
    console.error(error);
  }

  return res.status(status).json({ error: message });
};

const resolveBaseUrl = (origin) => {
  let baseUrl = process.env.APP_URL || origin || 'http://localhost:3000';
  if (baseUrl.includes('ais-dev-')) {
    baseUrl = baseUrl.replace('ais-dev-', 'ais-pre-');
  }
  return baseUrl;
};

const paymentSuccessHtml = ({ accessType, courseId, paymentId, planId, sessionId }) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Successful | EduMaster</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; background-color: #f3f4f6; color: #111827; }
    .card { background: white; padding: 2.5rem; border-radius: 1.5rem; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04); text-align: center; max-width: 450px; width: 90%; }
    .icon { width: 64px; height: 64px; background-color: #d1fae5; color: #059669; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 1.5rem; }
    h1 { font-size: 1.875rem; font-weight: 800; margin-bottom: 1rem; color: #111827; }
    p { color: #4b5563; line-height: 1.625; margin-bottom: 2rem; }
    .btn { display: inline-block; padding: 0.875rem 2rem; background-color: #2563eb; color: white; border-radius: 0.75rem; text-decoration: none; font-weight: 700; transition: background-color 0.2s; border: none; cursor: pointer; font-size: 1rem; }
    .btn:hover { background-color: #1d4ed8; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">
      <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
    </div>
    <h1>Payment Successful!</h1>
    <p>Thank you for your enrollment. Your access is active now. You can close this tab and return to EduMaster.</p>
    <button onclick="window.close()" class="btn">Close This Tab</button>
  </div>
  <script>
    if (window.opener) {
      window.opener.postMessage({
        type: 'STRIPE_PAYMENT_SUCCESS',
        accessType: '${accessType}',
        courseId: '${courseId}',
        planId: '${planId}',
        sessionId: '${sessionId}',
        paymentId: '${paymentId}'
      }, '*');
    }
  </script>
</body>
</html>`;

const paymentCancelHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Cancelled | EduMaster</title>
  <style>
    body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f9fafb; }
    .card { background: white; padding: 2rem; border-radius: 1rem; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); text-align: center; max-width: 400px; }
    h1 { color: #ef4444; margin-bottom: 1rem; }
    p { color: #4b5563; margin-bottom: 2rem; }
    .btn { padding: 0.75rem 1.5rem; background: #374151; color: white; border-radius: 0.5rem; text-decoration: none; font-weight: bold; border: none; cursor: pointer; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Payment Cancelled</h1>
    <p>The payment process was cancelled. You can close this tab and try again from the app.</p>
    <button onclick="window.close()" class="btn">Close Tab</button>
  </div>
</body>
</html>`;

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json());
app.use(addRootSecurityHeaders);
app.use('/backend', backendApp);

app.get('/healthz', async (_req, res) => {
  res.json({
    status: 'ok',
    app: 'firebase-functions',
    timestamp: new Date().toISOString(),
  });
});

app.post('/api/stripe/course-checkout', requireAuth, async (req, res) => {
  try {
    if (!stripe) {
      throw new RootApiError(503, 'Stripe is not configured on this environment.');
    }

    const courseId = requireString(req.body?.courseId, 'courseId');
    const origin = typeof req.body?.origin === 'string' ? req.body.origin : undefined;
    const course = await coursesRepository.findById(courseId);

    if (!course) {
      throw new RootApiError(404, 'Course not found.');
    }

    const price = requirePositiveNumber(course.price, 'price');
    const courseTitle = requireString(course.title, 'courseTitle');
    const userId = req.user?.id;
    const payment = await paymentRepository.createCheckout({
      userId,
      amount: price,
      currency: 'INR',
      item: courseTitle,
    });
    const baseUrl = resolveBaseUrl(origin);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'inr',
            product_data: {
              name: courseTitle,
              description: `Enrollment for ${courseTitle}`,
            },
            unit_amount: price * 100,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${baseUrl}/payment-success?session_id={CHECKOUT_SESSION_ID}&course_id=${courseId}&payment_id=${payment._id}`,
      cancel_url: `${baseUrl}/payment-cancel`,
      metadata: {
        courseId,
        userId,
        paymentId: payment._id,
        accessType: 'course',
      },
    });

    return res.json({ url: session.url, sessionId: session.id, paymentId: payment._id });
  } catch (error) {
    return sendRootError(res, error);
  }
});

app.post('/api/stripe/confirm-course-payment', requireAuth, async (req, res) => {
  try {
    if (!stripe) {
      throw new RootApiError(503, 'Stripe is not configured on this environment.');
    }

    const sessionId = requireString(req.body?.sessionId, 'sessionId');
    const courseId = requireString(req.body?.courseId, 'courseId');
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const metadata = session.metadata || {};

    if (session.payment_status !== 'paid') {
      throw new RootApiError(409, `Payment is ${session.payment_status || 'not completed'}.`);
    }

    if (metadata.userId !== req.user?.id || metadata.courseId !== courseId) {
      throw new RootApiError(403, 'Stripe session does not belong to this student/course.');
    }

    if (!metadata.paymentId) {
      throw new RootApiError(400, 'Stripe session is missing payment metadata.');
    }

    await paymentRepository.handleWebhook({
      event: 'payment.completed',
      paymentId: metadata.paymentId,
      status: 'paid',
      provider: 'stripe',
      sessionId,
    });

    const enrollment = await platformRepository.enroll({
      userId: req.user.id,
      courseId,
      source: 'stripe',
      accessType: 'course',
    });

    return res.json({
      status: 'paid',
      enrollment,
      courseId,
      paymentId: metadata.paymentId,
    });
  } catch (error) {
    return sendRootError(res, error);
  }
});

app.post('/api/stripe/subscription-checkout', requireAuth, async (req, res) => {
  try {
    if (!stripe) {
      throw new RootApiError(503, 'Stripe is not configured on this environment.');
    }

    const planId = requireString(req.body?.planId, 'planId');
    const origin = typeof req.body?.origin === 'string' ? req.body.origin : undefined;
    const overview = await platformRepository.getOverview(req.user?.id || null);
    const plan = (overview.subscriptions || []).find((entry) => entry._id === planId);

    if (!plan) {
      throw new RootApiError(404, 'Subscription plan not found.');
    }

    const price = requirePositiveNumber(plan.price, 'price');
    const planTitle = requireString(plan.title, 'planTitle');
    const billingCycle = String(plan.billingCycle || 'subscription');
    const userId = req.user?.id;
    const payment = await paymentRepository.createCheckout({
      userId,
      amount: price,
      currency: 'INR',
      item: `${planTitle} subscription`,
    });
    const baseUrl = resolveBaseUrl(origin);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'inr',
            product_data: {
              name: planTitle,
              description: `${billingCycle} access for ${planTitle}`,
            },
            unit_amount: price * 100,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${baseUrl}/payment-success?session_id={CHECKOUT_SESSION_ID}&plan_id=${planId}&payment_id=${payment._id}&access_type=subscription`,
      cancel_url: `${baseUrl}/payment-cancel`,
      metadata: {
        planId,
        userId,
        paymentId: payment._id,
        accessType: 'subscription',
      },
    });

    return res.json({ url: session.url, sessionId: session.id, paymentId: payment._id });
  } catch (error) {
    return sendRootError(res, error);
  }
});

app.post('/api/stripe/confirm-subscription-payment', requireAuth, async (req, res) => {
  try {
    if (!stripe) {
      throw new RootApiError(503, 'Stripe is not configured on this environment.');
    }

    const sessionId = requireString(req.body?.sessionId, 'sessionId');
    const planId = requireString(req.body?.planId, 'planId');
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const metadata = session.metadata || {};

    if (session.payment_status !== 'paid') {
      throw new RootApiError(409, `Payment is ${session.payment_status || 'not completed'}.`);
    }

    if (metadata.userId !== req.user?.id || metadata.planId !== planId) {
      throw new RootApiError(403, 'Stripe session does not belong to this student/plan.');
    }

    if (!metadata.paymentId) {
      throw new RootApiError(400, 'Stripe session is missing payment metadata.');
    }

    await paymentRepository.handleWebhook({
      event: 'payment.completed',
      paymentId: metadata.paymentId,
      status: 'paid',
      provider: 'stripe',
      sessionId,
    });

    const subscription = await platformRepository.subscribe({
      userId: req.user.id,
      planId,
      source: 'stripe',
    });

    return res.json({
      status: 'paid',
      subscription,
      planId,
      paymentId: metadata.paymentId,
    });
  } catch (error) {
    return sendRootError(res, error);
  }
});

app.get('/payment-success', (req, res) => {
  const courseId = String(req.query.course_id || '');
  const planId = String(req.query.plan_id || '');
  const sessionId = String(req.query.session_id || '');
  const paymentId = String(req.query.payment_id || '');
  const accessType = String(req.query.access_type || (planId ? 'subscription' : 'course'));

  res.status(200).send(paymentSuccessHtml({
    accessType,
    courseId,
    paymentId,
    planId,
    sessionId,
  }));
});

app.get('/payment-cancel', (_req, res) => {
  res.status(200).send(paymentCancelHtml);
});

exports.api = onRequest(
  {
    memory: '1GiB',
    timeoutSeconds: 120,
    cors: true,
    concurrency: 1,
  },
  app,
);
