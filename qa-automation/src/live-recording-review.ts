import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { config } from './config.js';
import { chromeHostResolverRule, qaFetch } from './network.js';
import { artifactPath, createRunContext, sleep, writeJson, writeText } from './utils.js';
import { maybeStartLiveTestPublisher } from './live-publisher.js';

const chromeExecutable = process.env.QA_CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const adminEmail = process.env.QA_ADMIN_EMAIL || 'admin@local.edumaster';
const adminPassword = process.env.QA_ADMIN_PASSWORD || 'AdminChangeMe_2026';
const studentEmail = process.env.QA_LOGIN_EMAIL || `qa.live.recording.student+${Date.now()}@local.test`;
const studentPassword = process.env.QA_LOGIN_PASSWORD || 'Student@12345';
const apiOrigin = new URL(config.baseUrl).origin;
const replayWaitMs = Math.max(30_000, Number(process.env.QA_RECORDING_REPLAY_WAIT_MS || 180_000));

type LiveClassPayload = {
  liveClass: {
    _id: string;
    title: string;
    ingestServerUrl?: string | null;
    ingestStreamKey?: string | null;
  };
};

type TokenManager = {
  get: () => string;
  refresh: () => Promise<string>;
};

const timestampSuffix = () => new Date().toISOString().replace(/[:.]/g, '-');

const takeScreenshot = async (page: puppeteer.Page, ctx: Awaited<ReturnType<typeof createRunContext>>, label: string) => {
  const screenshotPath = artifactPath(ctx.screenshotDir, 'live-recording', label, 'png');
  const sourcePath = artifactPath(ctx.sourceDir, 'live-recording', label, 'html');
  await page.screenshot({ path: screenshotPath, fullPage: false });
  try {
    await writeText(sourcePath, await page.content());
  } catch {
    await writeText(sourcePath, '<!-- page.content() capture skipped after protocol timeout -->');
  }
  return screenshotPath;
};

const isInvalidTokenError = (value: unknown) => {
  const message = value instanceof Error ? value.message : String(value || '');
  return /invalid token/i.test(message);
};

const apiJson = async (route: string, init: RequestInit = {}, attempts = 4) => {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await qaFetch(new URL(route, apiOrigin), init);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String((payload as Record<string, unknown>).error || (payload as Record<string, unknown>).message || `${response.status}`));
      }
      return payload as Record<string, unknown>;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const retryable = /fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(message);
      if (!retryable || attempt === attempts) {
        throw error;
      }
      await sleep(1500 * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError || 'apiJson failed'));
};

const login = async (email: string, password: string, device: string) => {
  const payload = await apiJson('/backend/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, device, forceLogoutOtherSessions: true }),
  });
  return String(payload.token || '');
};

const createTokenManager = (email: string, password: string, device: string): TokenManager => {
  let currentToken = '';
  return {
    get: () => currentToken,
    refresh: async () => {
      currentToken = await login(email, password, device);
      return currentToken;
    },
  };
};

const withTokenRetry = async <T>(manager: TokenManager, action: (token: string) => Promise<T>) => {
  try {
    return await action(manager.get());
  } catch (error) {
    if (!isInvalidTokenError(error)) {
      throw error;
    }
  }

  const freshToken = await manager.refresh();
  return action(freshToken);
};

const ensureStudentAccountAndGetToken = async (email: string, password: string, name: string, device: string) => {
  try {
    return await login(email, password, device);
  } catch {
    const response = await qaFetch(new URL('/backend/api/auth/register', apiOrigin), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, email, password, mobileNumber: '' }),
    });
    if (!(response.ok || response.status === 409)) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(String(payload?.error || payload?.message || 'Unable to register recording review student'));
    }
    return login(email, password, device);
  }
};

const createLiveClass = async (token: string, title: string, startTime: string) => {
  const payload = await apiJson('/backend/api/live-classes', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      title,
      startTime,
      durationMinutes: 45,
      maxAttendees: 2500,
      requiresEnrollment: false,
      chatEnabled: true,
      doubtSolving: true,
      replayAvailable: true,
      instructor: 'QA Replay Teacher',
      subject: 'Physics',
    }),
  }) as LiveClassPayload;

  return payload.liveClass;
};

const startLiveClass = async (token: string, liveClassId: string) => {
  await apiJson(`/backend/api/live-classes/${liveClassId}/start`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
  });
};

const endLiveClass = async (token: string, liveClassId: string) => {
  await apiJson(`/backend/api/live-classes/${liveClassId}/end`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
  });
};

const publishManagedHls = async (streamKey: string) => {
  const [streamName, queryString = ''] = String(streamKey || '').split('?');
  const query = new URLSearchParams(queryString);
  const secret = query.get('secret') || '';
  if (!streamName || !secret) {
    return false;
  }

  const response = await qaFetch(new URL('/backend/api/live-classes/ingest/on-publish', apiOrigin), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'publish',
      protocol: 'rtmp',
      name: streamName,
      secret,
    }),
  });

  if (!(response.status === 204 || response.ok)) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(String(payload?.error || payload?.message || `Unable to publish managed HLS stream (${response.status})`));
  }

  return true;
};

const getLiveClass = async (token: string, liveClassId: string) => {
  const payload = await apiJson('/backend/api/live-classes?view=all', {
    headers: {
      authorization: `Bearer ${token}`,
    },
  });
  const liveClasses = Array.isArray(payload.liveClasses) ? payload.liveClasses as Array<Record<string, unknown>> : [];
  return liveClasses.find((entry) => String(entry._id || '') === String(liveClassId)) || null;
};

const isReplayReady = (liveClass: Record<string, unknown> | null) => Boolean(
  liveClass
  && (
    liveClass.replayReady
    || liveClass.recordingUrl
    || liveClass.recordingStoragePath
    || (liveClass.replayCourseId && liveClass.replayLessonId)
    || liveClass.recordingState === 'published'
    || liveClass.replayState === 'replay_ready'
  )
);

const gotoLiveClass = async (page: puppeteer.Page, liveClassId: string, token: string) => {
  await page.goto(config.baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate((jwt) => {
    window.localStorage.setItem('edumaster.jwt', jwt);
  }, token);
  await page.goto(`${config.baseUrl}?tab=live&liveClassId=${encodeURIComponent(liveClassId)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
};

const main = async () => {
  const ctx = await createRunContext();
  const browser = await puppeteer.launch({
    executablePath: chromeExecutable,
    headless: process.env.QA_HEADLESS !== 'false',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      ...(chromeHostResolverRule(config.baseUrl) ? [`--host-resolver-rules=${chromeHostResolverRule(config.baseUrl)}`] : []),
    ],
    defaultViewport: null,
    protocolTimeout: Math.max(120_000, Number(process.env.QA_PROTOCOL_TIMEOUT_MS || 180_000)),
  });

  let exitCode = 0;
  let stopPublisher = async () => undefined;

  try {
    const adminTokenManager = createTokenManager(adminEmail, adminPassword, 'QA Live Recording Admin');
    await adminTokenManager.refresh();
    const studentToken = await ensureStudentAccountAndGetToken(
      studentEmail,
      studentPassword,
      'QA Recording Student',
      'QA Live Recording Student',
    );

    const liveClass = await withTokenRetry(
      adminTokenManager,
      (token) => createLiveClass(token, `QA Live Recording Review ${timestampSuffix()}`, new Date(Date.now() + 60_000).toISOString()),
    );
    await withTokenRetry(adminTokenManager, (token) => startLiveClass(token, liveClass._id));
    stopPublisher = await maybeStartLiveTestPublisher({
      ingestServerUrl: liveClass.ingestServerUrl || null,
      ingestStreamKey: liveClass.ingestStreamKey || null,
      envPrefix: 'QA',
      runId: ctx.runId,
    });
    const published = await publishManagedHls(liveClass.ingestStreamKey || '').catch(() => false);
    await sleep(3000);

    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1080, deviceScaleFactor: 1 });
    await gotoLiveClass(page, liveClass._id, studentToken);
    await takeScreenshot(page, ctx, 'before-end');

    await withTokenRetry(adminTokenManager, (token) => endLiveClass(token, liveClass._id));
    await stopPublisher().catch(() => undefined);
    stopPublisher = async () => undefined;
    await sleep(3000);
    await gotoLiveClass(page, liveClass._id, studentToken);
    const afterEndShot = await takeScreenshot(page, ctx, 'after-end');
    const lifecycleMessage = await page.$eval('[data-testid="live-status-message"]', (node) => node.textContent?.trim() || '').catch(() => '');

    const deadline = Date.now() + replayWaitMs;
    let replayLiveClass: Record<string, unknown> | null = null;
    while (Date.now() < deadline) {
      replayLiveClass = await withTokenRetry(adminTokenManager, (token) => getLiveClass(token, liveClass._id));
      if (isReplayReady(replayLiveClass)) {
        break;
      }
      await sleep(5000);
    }

    const summary = {
      baseUrl: config.baseUrl,
      liveClassId: liveClass._id,
      published,
      replayWaitMs,
      lifecycleMessage,
      recordingState: replayLiveClass?.recordingState || null,
      replayState: replayLiveClass?.replayState || null,
      replayReady: isReplayReady(replayLiveClass),
      replayLiveClass,
      screenshots: {
        afterEnd: afterEndShot,
      },
    };

    await writeJson(path.join(ctx.analysisDir, 'live-recording-review-summary.json'), summary);
    await writeText(path.join(ctx.analysisDir, 'live-recording-review-summary.md'), [
      '# Live Recording Review',
      '',
      `Base URL: ${config.baseUrl}`,
      `Live class: ${liveClass._id}`,
      `Managed HLS publish callback: ${published ? 'yes' : 'no'}`,
      `Replay wait window: ${replayWaitMs}ms`,
      `Lifecycle message after end: ${lifecycleMessage || 'n/a'}`,
      `Recording state: ${String(replayLiveClass?.recordingState || 'n/a')}`,
      `Replay state: ${String(replayLiveClass?.replayState || 'n/a')}`,
      `Replay ready: ${summary.replayReady ? 'yes' : 'no'}`,
      '',
      '## Notes',
      summary.replayReady
        ? '- Recording or replay metadata was visible after the class ended.'
        : '- Recording or replay metadata was not visible within the wait window. This is still a production blocker.',
    ].join('\n'));
  } catch (error) {
    exitCode = 1;
    await writeText(
      path.join(ctx.analysisDir, 'live-recording-review-error.txt'),
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  } finally {
    await stopPublisher().catch(() => undefined);
    await browser.close();
    process.exitCode = exitCode;
  }
};

void main();
