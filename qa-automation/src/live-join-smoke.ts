import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { config } from './config.js';
import { artifactPath, createRunContext, sleep, writeJson, writeText } from './utils.js';

const chromeExecutable = process.env.QA_CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const adminEmail = process.env.QA_ADMIN_EMAIL || 'admin@local.edumaster';
const adminPassword = process.env.QA_ADMIN_PASSWORD || 'AdminChangeMe_2026';
const studentEmail = process.env.QA_LOGIN_EMAIL || `qa.live.student+${Date.now()}@local.test`;
const studentPassword = process.env.QA_LOGIN_PASSWORD || 'Student@12345';
const apiOrigin = new URL(config.baseUrl).origin;

const desktopViewport = { width: 1440, height: 1080, deviceScaleFactor: 1 };
const mobileViewport = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

type LiveClassPayload = {
  liveClass: {
    _id: string;
    title: string;
    ingestServerUrl?: string | null;
    ingestStreamKey?: string | null;
  };
};

const timestampSuffix = () => new Date().toISOString().replace(/[:.]/g, '-');

const takeScreenshot = async (page: puppeteer.Page, ctx: Awaited<ReturnType<typeof createRunContext>>, label: string) => {
  const screenshotPath = artifactPath(ctx.screenshotDir, 'live-join', label, 'png');
  const sourcePath = artifactPath(ctx.sourceDir, 'live-join', label, 'html');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await writeText(sourcePath, await page.content());
  return { screenshotPath, sourcePath };
};

const attachDiagnostics = (page: puppeteer.Page, errors: string[], label: string) => {
  const liveRequestSummaries: string[] = [];
  (page as puppeteer.Page & { __qaLiveNetworkLog?: string[] }).__qaLiveNetworkLog = liveRequestSummaries;
  const isLiveEventStream = (url: string) => /\/backend\/api\/live-classes\/.+\/events(\?|$)/.test(url);
  const isLiveStreamAsset = (url: string) => /\/backend\/api\/live-classes\/stream\//.test(url);

  page.on('console', (message) => {
    const text = message.text();
    if (/TypeError|Cannot read properties|Unhandled|Error:/i.test(text)) {
      errors.push(`[${label}:console:${message.type()}] ${text}`);
    }
  });

  page.on('pageerror', (error) => {
    errors.push(`[${label}:pageerror] ${error.message}`);
  });

  page.on('response', async (response) => {
    const url = response.url();
    if (/\/backend\/api\/live-classes\/.+\/(access|session|session\/join|session\/heartbeat|chat)/.test(url)) {
      liveRequestSummaries.push(`[${label}:response:${response.status()}] ${response.request().method()} ${url}`);
    }
    if (!/\/backend\/api\/live-classes\//.test(url) || response.ok() || response.status() === 304 || isLiveEventStream(url)) {
      return;
    }
    if (isLiveStreamAsset(url) && response.status() < 500) {
      return;
    }
    const body = await response.text().catch(() => '');
    errors.push(`[${label}:response:${response.status()}] ${url} ${body.slice(0, 500)}`);
  });

  page.on('requestfailed', (request) => {
    const url = request.url();
    if (!/\/backend\/api\/live-classes\//.test(url) || isLiveEventStream(url)) {
      return;
    }
    if (isLiveStreamAsset(url)) {
      return;
    }
    errors.push(`[${label}:requestfailed] ${url} ${request.failure()?.errorText || 'unknown request failure'}`);
  });

  page.on('request', (request) => {
    const url = request.url();
    if (/\/backend\/api\/live-classes\/.+\/(access|session|session\/join|session\/heartbeat|chat)/.test(url)) {
      liveRequestSummaries.push(`[${label}:request] ${request.method()} ${url}`);
    }
  });
};

const loginAndStoreSession = async (page: puppeteer.Page, email: string, password: string, device: string) => {
  const response = await fetch(new URL('/backend/api/auth/login', apiOrigin), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, device, forceLogoutOtherSessions: true }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.token) {
    throw new Error(payload?.error || payload?.message || `Unable to login as ${email}`);
  }

  await page.goto(config.baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate((token) => {
    window.localStorage.setItem('edumaster.jwt', token);
  }, String(payload.token));
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
};

const ensureStudentAccountAndLogin = async (page: puppeteer.Page, email: string, password: string, name: string) => {
  try {
    await loginAndStoreSession(page, email, password, 'QA Live Join Student');
    return;
  } catch {
    const registerResponse = await fetch(new URL('/backend/api/auth/register', apiOrigin), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name,
        email,
        password,
        mobileNumber: '',
      }),
    });

    if (!(registerResponse.ok || registerResponse.status === 409)) {
      const payload = await registerResponse.json().catch(() => ({}));
      throw new Error(payload?.error || payload?.message || 'Unable to register student account');
    }

    await loginAndStoreSession(page, email, password, 'QA Live Join Student');
  }
};

const createLiveClass = async (token: string, title: string, startTime: string) => {
  const response = await fetch(new URL('/backend/api/live-classes', apiOrigin), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
      body: JSON.stringify({
        title,
        startTime,
        durationMinutes: 90,
        maxAttendees: 2500,
        requiresEnrollment: false,
        chatEnabled: true,
        doubtSolving: true,
        replayAvailable: true,
        instructor: 'QA Live Teacher',
        subject: 'Physics',
    }),
  });

  const payload = await response.json().catch(() => ({})) as LiveClassPayload & { error?: string; message?: string };
  if (!response.ok) {
    throw new Error(payload?.error || payload?.message || 'Unable to create live class');
  }

  return payload.liveClass;
};

const startLiveClass = async (token: string, liveClassId: string) => {
  const response = await fetch(new URL(`/backend/api/live-classes/${liveClassId}/start`, apiOrigin), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
  });

  const payload = await response.json().catch(() => ({})) as { error?: string; message?: string };
  if (!response.ok) {
    throw new Error(payload?.error || payload?.message || 'Unable to start live class');
  }
};

const publishManagedHls = async (secret: string, streamName: string) => {
  const response = await fetch(new URL('/backend/api/live-classes/ingest/on-publish', apiOrigin), {
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
    throw new Error(payload?.error || payload?.message || `Unable to publish managed HLS stream (${response.status})`);
  }
};

const clickJoinButton = async (page: puppeteer.Page) => {
  try {
    await page.waitForFunction(
      () => Boolean(document.querySelector('[data-testid="live-details-join-button"]')),
      { timeout: 30000 },
    );
  } catch {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(
      () => Boolean(document.querySelector('[data-testid="live-details-join-button"]')),
      { timeout: 45000 },
    );
  }

  const clickResult = await page.evaluate(() => {
    const nextWindow = window as Window & {
      __qaLiveRequestLog?: Array<Record<string, unknown>>;
      __qaLiveClickLog?: Array<Record<string, unknown>>;
      __qaLiveFetchWrapped?: boolean;
    };
    nextWindow.__qaLiveRequestLog = [];
    nextWindow.__qaLiveClickLog = [];

    const button = document.querySelector('[data-testid="live-details-join-button"]') as HTMLButtonElement | null;
    if (!button) {
      return { found: false };
    }

    button.addEventListener('click', () => {
      nextWindow.__qaLiveClickLog?.push({
        text: button.innerText,
        disabled: button.disabled,
        ts: Date.now(),
      });
    }, { once: true });

    if (!nextWindow.__qaLiveFetchWrapped) {
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (...args) => {
        const input = args[0];
        const init = args[1];
        const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
        const method = init?.method || (input instanceof Request ? input.method : 'GET');
        const start = Date.now();
        try {
          const response = await originalFetch(...args);
          if (/\/backend\/api\/live-classes\//.test(url)) {
            nextWindow.__qaLiveRequestLog?.push({
              url,
              method,
              status: response.status,
              ok: response.ok,
              elapsedMs: Date.now() - start,
            });
          }
          return response;
        } catch (error) {
          if (/\/backend\/api\/live-classes\//.test(url)) {
            nextWindow.__qaLiveRequestLog?.push({
              url,
              method,
              error: error instanceof Error ? error.message : String(error),
              elapsedMs: Date.now() - start,
            });
          }
          throw error;
        }
      };
      nextWindow.__qaLiveFetchWrapped = true;
    }

    const disabledBefore = button.disabled;
    if (disabledBefore) {
      button.disabled = false;
    }
    button.click();
    return {
      found: true,
      disabledBefore,
      disabledAfter: button.disabled,
      text: button.innerText,
    };
  });

  if (!clickResult?.found) {
    throw new Error('Unable to locate Enter Live Class.');
  }
};

export const runLiveJoinSmoke = async () => {
  const ctx = await createRunContext();
  const browser = await puppeteer.launch({
    executablePath: chromeExecutable,
    headless: process.env.QA_HEADLESS === 'true',
    args: [
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--disable-crash-reporter',
      '--disable-breakpad',
      '--disable-features=Crashpad',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
    ],
  });

  const title = `QA Live Join Smoke ${timestampSuffix()}`;
  const errors: string[] = [];

  try {
    const adminContext = await browser.createBrowserContext();
    const studentContext = await browser.createBrowserContext();
    const adminPage = await adminContext.newPage();
    const studentPage = await studentContext.newPage();
    await adminPage.setViewport(desktopViewport);
    await studentPage.setViewport(mobileViewport);
    attachDiagnostics(adminPage, errors, 'admin');
    attachDiagnostics(studentPage, errors, 'student');

    console.log('Step 1: login admin');
    await loginAndStoreSession(adminPage, adminEmail, adminPassword, 'QA Live Join Admin');
    const adminToken = await adminPage.evaluate(() => window.localStorage.getItem('edumaster.jwt') || '');
    if (!adminToken) {
      throw new Error('Missing admin token after login.');
    }

    console.log('Step 2: create and start live class');
    const startTime = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const liveClass = await createLiveClass(adminToken, title, startTime);

    const adminLiveUrl = new URL(config.baseUrl);
    adminLiveUrl.searchParams.set('tab', 'live');
    adminLiveUrl.searchParams.set('liveClassId', liveClass._id);
    await adminPage.goto(adminLiveUrl.toString(), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(10000);
    await adminPage.evaluate(() => {
      const button = document.querySelector('[data-testid="live-admin-start"]') as HTMLButtonElement | null;
      button?.click();
      return Boolean(button);
    });

    const ingestKey = liveClass.ingestStreamKey || '';
    const streamName = ingestKey.split('?')[0] || liveClass._id;
    const ingestSecret = new URLSearchParams(ingestKey.split('?')[1] || '').get('secret') || process.env.QA_LIVE_INGEST_SECRET || '';
    if (!ingestSecret) {
      throw new Error('Missing live ingest secret. Set LIVE_INGEST_PUBLISHER_SECRET in production or QA_LIVE_INGEST_SECRET for the smoke test.');
    }

    await publishManagedHls(ingestSecret, streamName);
    await sleep(2000);

    console.log('Step 3: login student and open direct live detail');
    await ensureStudentAccountAndLogin(studentPage, studentEmail, studentPassword, 'QA Live Join Student');
    const studentLiveUrl = new URL(config.baseUrl);
    studentLiveUrl.searchParams.set('tab', 'live');
    studentLiveUrl.searchParams.set('liveClassId', liveClass._id);
    await studentPage.goto(studentLiveUrl.toString(), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(10000);

    console.log('Step 4: click enter live class');
    await clickJoinButton(studentPage);
    await sleep(15000);

    const selectors = await studentPage.evaluate(() => ({
      detail: Boolean(document.querySelector('[data-testid="live-class-detail-page"]')),
      runtime: Boolean(document.querySelector('[data-testid="live-runtime-page"]')),
      join: Boolean(document.querySelector('[data-testid="live-details-join-button"]')),
      stream: Boolean(document.querySelector('[data-testid="live-stream-container"]')),
      errorBoundary: (document.body?.innerText || '').includes('Something went wrong'),
      errorBanner: Array.from(document.querySelectorAll('*')).some((node) => String((node as HTMLElement).innerText || '').includes('Unable to join the live classroom')),
    }));
    const bodyText = await studentPage.evaluate(() => (document.body?.innerText || '').slice(0, 3000));
    const runtimeDebug = await studentPage.evaluate(() => {
      const nextWindow = window as Window & { __qaLiveRequestLog?: Array<Record<string, unknown>> };
      const runtime = document.querySelector('[data-testid="live-runtime-page"]') as HTMLElement | null;
      const errorText = Array.from(document.querySelectorAll('*'))
        .map((node) => String((node as HTMLElement).innerText || '').trim())
        .find((text) => /Unable to join|removed from this class|Something went wrong|Live media connection was lost/i.test(text));
      return {
        location: window.location.href,
        runtimeDataset: runtime ? { ...runtime.dataset } : null,
        errorText: errorText || null,
        liveRequests: nextWindow.__qaLiveRequestLog || [],
        liveClicks: nextWindow.__qaLiveClickLog || [],
        buttonState: (() => {
          const button = document.querySelector('[data-testid="live-details-join-button"]') as HTMLButtonElement | null;
          return button
            ? { disabled: button.disabled, text: button.innerText }
            : null;
        })(),
      };
    });
    const networkDebug = (studentPage as puppeteer.Page & { __qaLiveNetworkLog?: string[] }).__qaLiveNetworkLog || [];
    if (!selectors.stream) {
      throw new Error(`Live stream container did not appear. Selectors: ${JSON.stringify(selectors)}\nRuntime: ${JSON.stringify(runtimeDebug)}\nNetwork: ${JSON.stringify(networkDebug)}\nBody: ${bodyText}`);
    }

    if (/Something went wrong|Cannot read properties of null|Unhandled|TypeError/i.test(bodyText)) {
      errors.push(`Unexpected crash text visible after joining: ${bodyText}`);
    }

    await takeScreenshot(studentPage, ctx, 'student-joined-live-stream');
    await writeJson(path.join(ctx.analysisDir, 'summary.json'), { title, errors });
    await writeText(path.join(ctx.logDir, 'run.log'), `Live join smoke completed for ${title}\nErrors: ${errors.length}\n`);

    if (errors.length > 0) {
      throw new Error(errors.join('\n'));
    }

    return { title, ctx };
  } catch (error) {
    await writeJson(path.join(ctx.analysisDir, 'summary.json'), {
      title,
      error: error instanceof Error ? error.message : String(error),
      errors,
    });
    await writeText(path.join(ctx.logDir, 'run.log'), `Live join smoke failed for ${title}\n${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    throw error;
  } finally {
    await browser.close();
  }
};

if (import.meta.url === `file://${process.argv[1]}`) {
  runLiveJoinSmoke()
    .then(({ ctx }) => {
      console.log(`Live join smoke complete: ${ctx.rootDir}`);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
