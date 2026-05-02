import puppeteer from '../qa-automation/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';

const baseUrl = process.env.QA_BASE_URL || 'http://127.0.0.1:3300';
const chromeExecutable = process.env.QA_CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = process.env.QA_CHROME_USER_DATA_DIR || `/private/tmp/edumaster-live-mobile-student-capture-${Date.now()}`;
const email = process.env.QA_LOGIN_EMAIL || 'student@edumaster.local';
const password = process.env.QA_LOGIN_PASSWORD || 'Student@123';
const emailSelector = '[data-testid="auth-login-email"], input[type="email"], input[name="email"]';
const passwordSelector = '[data-testid="auth-login-password"], input[type="password"], input[name="password"]';
const submitSelector = '[data-testid="auth-login-submit"], button[type="submit"]';
const mobileViewport = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const liveReferenceUrl = `${baseUrl}/?tab=live&liveReferenceMode=figma`;
const tokenStorageKey = 'edumaster.jwt';

const log = (...args) => console.log(new Date().toISOString(), ...args);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const loginByApi = async () => {
  const response = await fetch(`${baseUrl}/backend/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      device: 'Chrome on automation',
      forceLogoutOtherSessions: true,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Automation login failed: ${response.status} ${text}`);
  }

  const payload = await response.json();
  return payload?.token || null;
};

const pageHasSelector = async (page, selector) =>
  page.evaluate((target) => Boolean(document.querySelector(target)), selector).catch(() => false);

const pageHasText = async (page, expectedText) =>
  page.evaluate((text) => (document.body?.innerText || '').includes(text), expectedText).catch(() => false);

const clickButtonByText = async (page, expectedTexts) =>
  page.evaluate((texts) => {
    const button = Array.from(document.querySelectorAll('button')).find((node) => {
      const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
      return texts.some((expected) => text.includes(expected));
    });
    button?.click();
    return Boolean(button);
  }, expectedTexts);

const clickButtonByExactText = async (page, expectedText) =>
  page.evaluate((text) => {
    const normalizedTarget = text.replace(/\s+/g, ' ').trim();
    const button = Array.from(document.querySelectorAll('button')).find((node) => (
      (node.textContent || '').replace(/\s+/g, ' ').trim() === normalizedTarget
    ));
    button?.scrollIntoView({ block: 'center', inline: 'center' });
    button?.click();
    return Boolean(button);
  }, expectedText);

const clearDeviceLimitGate = async (page) => {
  const hasGate = await pageHasText(page, 'Device Limit Reached')
    || await pageHasText(page, 'Log Out 1 Device to Continue')
    || await pageHasText(page, 'Log Out 2 Devices to Continue');

  if (!hasGate) {
    return false;
  }

  await clickButtonByExactText(page, 'Log Out');
  await sleep(1200);
  try {
    await page.waitForFunction(
      () => {
        const text = document.body?.innerText || '';
        return !text.includes('Device Limit Reached')
          && !text.includes('Log Out 1 Device to Continue')
          && !text.includes('Log Out 2 Devices to Continue');
      },
      { timeout: 12000 },
    );
  } catch {}
  await sleep(3200);
  return true;
};

const clickSelector = async (page, selector) =>
  page.evaluate((target) => {
    const button = document.querySelector(target);
    if (!(button instanceof HTMLElement)) {
      return false;
    }
    button.scrollIntoView({ block: 'center', inline: 'center' });
    button.click();
    return true;
  }, selector);

const getSelectorText = async (page, selector) =>
  page.evaluate((target) => (document.querySelector(target)?.textContent || '').replace(/\s+/g, ' ').trim(), selector).catch(() => '');

const submitLogin = async (page) => {
  await page.waitForSelector(emailSelector, { timeout: 20000 });
  await page.locator(emailSelector).fill(email);
  await page.locator(passwordSelector).fill(password);
  await page.locator(submitSelector).click();

  try {
    await page.waitForFunction(
      () => (document.body?.innerText || '').includes('Log out older device and continue'),
      { timeout: 7000 },
    );
    await clickButtonByText(page, ['Log out older device and continue']);
  } catch {}

  await clearDeviceLimitGate(page);
  await sleep(1800);
};

const clearStoredAuth = async (page) => {
  await page.evaluate(() => {
    window.localStorage.removeItem('edumaster.jwt');
    window.sessionStorage.removeItem('edumaster.jwt');
  }).catch(() => undefined);
};

const applyTokenToPage = async (page, token) => {
  if (!token) {
    return;
  }

  await page.evaluate((nextToken, storageKey) => {
    window.localStorage.setItem(storageKey, nextToken);
    window.sessionStorage.removeItem(storageKey);
  }, token, tokenStorageKey);
};

const warmAuthenticatedOrigin = async (page, token) => {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(900);
  await applyTokenToPage(page, token);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(1400);
};

const detectEntryState = async (page) =>
  page.evaluate((selector) => {
    const bodyText = document.body?.innerText || '';
    if (document.querySelector('[data-testid="live-classes-page"]')) {
      return 'live';
    }
    if (document.querySelector('[data-testid="nav-live"]')) {
      return 'nav';
    }
    if (
      document.querySelector(selector)
      || bodyText.includes('Login or sign up to continue')
      || bodyText.includes('Continue your preparation')
    ) {
      return 'auth';
    }
    return 'unknown';
  }, emailSelector).catch(() => 'unknown');

const waitForEntryState = async (page, timeoutMs = 30000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await detectEntryState(page);
    if (state !== 'unknown') {
      return state;
    }
    await sleep(900);
  }
  return detectEntryState(page);
};

const waitForLiveShell = async (page) => {
  await page.waitForFunction(
    () => {
      const bodyText = document.body?.innerText || '';
      return Boolean(document.querySelector('[data-testid="live-classes-page"]'))
        || Boolean(document.querySelector('[data-testid="nav-live"]'))
        || (!bodyText.includes('Login or sign up to continue') && !bodyText.includes('Continue your preparation'));
    },
    { timeout: 30000 },
  );
};

const ensureLogin = async (page) => {
  const entryState = await waitForEntryState(page, 18000);
  const needsLogin = entryState === 'auth';
  log('needs login', needsLogin);
  if (!needsLogin) {
    return;
  }

  await submitLogin(page);
  await clearDeviceLimitGate(page);
  await page.goto(liveReferenceUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitForLiveShell(page);
  await sleep(1600);
};

const openLiveList = async (page, seededToken) => {
  log('open live list');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await warmAuthenticatedOrigin(page, seededToken);
    await page.goto(liveReferenceUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await ensureLogin(page);

    for (let settleAttempt = 0; settleAttempt < 3; settleAttempt += 1) {
      const entryState = await waitForEntryState(page, 12000);
      if (entryState === 'live' || entryState === 'nav') {
        break;
      }
      if (entryState === 'auth') {
        log('delayed auth shell detected, logging in');
        await ensureLogin(page);
        continue;
      }
    }

    const authTextVisible = await pageHasText(page, 'Login or sign up to continue')
      || await pageHasText(page, 'Continue your preparation');
    if (authTextVisible) {
      await clearStoredAuth(page);
      await page.goto(liveReferenceUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await sleep(1600);
      await ensureLogin(page);
    }

    let liveVisible = await pageHasSelector(page, '[data-testid="live-classes-page"]');
    if (!liveVisible) {
      try {
        await waitForLiveShell(page);
      } catch {
        const bodyText = await page.evaluate(() => (document.body?.innerText || '').slice(0, 2000));
        log('shell not ready after login wait', bodyText);
        if (bodyText.includes('Login or sign up to continue') || bodyText.includes('Continue your preparation')) {
          log('retrying login after delayed auth shell');
          await ensureLogin(page);
        }
      }
      liveVisible = await pageHasSelector(page, '[data-testid="live-classes-page"]');
    }

    if (!liveVisible && (await pageHasSelector(page, '[data-testid="nav-live"]'))) {
      log('click nav live fallback');
      await page.locator('[data-testid="nav-live"]').click();
      await sleep(1200);
    }

    try {
      await page.waitForSelector('[data-testid="live-classes-page"]', { timeout: 30000 });
      await sleep(2200);
      return;
    } catch (error) {
      const bodyText = await page.evaluate(() => (document.body?.innerText || '').slice(0, 2000));
      log(`live list attempt ${attempt + 1} failed`, bodyText);
      if (attempt === 2) {
        throw new Error(`Live classes page did not load. ${error instanceof Error ? error.message : String(error)} Visible text: ${bodyText}`);
      }
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
      await sleep(1800);
    }
  }
};

const openLiveDetail = async (page) => {
  const opened = await clickButtonByText(page, ['View Details', 'View Class Details']);
  const fallbackOpened = opened || await page.evaluate(() => {
    const candidate = document.querySelector('[data-testid="live-featured-card"], [data-testid^="live-card-"]');
    candidate?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return Boolean(candidate);
  });
  if (!fallbackOpened) {
    const bodyText = await page.evaluate(() => (document.body?.innerText || '').slice(0, 1200));
    throw new Error(`No detail button found. Visible text: ${bodyText}`);
  }
  await page.waitForSelector('[data-testid="live-class-detail-page"]', { timeout: 60000 });
  await sleep(1600);
};

const openLiveRoom = async (page) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const opened = await clickSelector(page, '[data-testid="live-details-join-button"]');
    if (!opened) {
      const bodyText = await page.evaluate(() => (document.body?.innerText || '').slice(0, 1200));
      throw new Error(`Join button not found. Visible text: ${bodyText}`);
    }

    try {
      await page.waitForFunction(
        () => {
          const roomPage = document.querySelector('[data-testid="live-room-reference-page"]');
          const runtimePage = document.querySelector('[data-testid="live-runtime-page"]');
          const leaveButton = document.querySelector('[data-testid="live-leave-class"]');
          const roomTab = document.querySelector('[data-testid="live-room-tab-chat"]');
          return Boolean((roomPage || runtimePage) && leaveButton && roomTab);
        },
        { timeout: 60000 },
      );
      await sleep(1600);
      return;
    } catch (error) {
      const bodyText = await page.evaluate(() => (document.body?.innerText || '').slice(0, 1600));
      log(`room open attempt ${attempt + 1} failed`, bodyText);
      if (attempt === 2) {
        throw new Error(`Room did not open. ${error instanceof Error ? error.message : String(error)} Visible text: ${bodyText}`);
      }
      await sleep(1200);
    }
  }
};

const prepareFullPageScreenshot = async (page) => {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.documentElement.style.background = '#ffffff';
    document.body.style.background = '#ffffff';
    const liveNav = document.querySelector('[data-testid="mobile-nav-live"]');
    let navShell = liveNav?.parentElement?.parentElement;
    let current = liveNav?.parentElement || null;
    while (current) {
      const style = window.getComputedStyle(current);
      if (style.position === 'fixed') {
        navShell = current;
        break;
      }
      current = current.parentElement;
    }
    if (!navShell) {
      navShell = Array.from(document.querySelectorAll('div')).find((node) => {
        const style = window.getComputedStyle(node);
        const text = (node.textContent || '').replace(/\s+/g, ' ');
        return style.position === 'fixed' && text.includes('Home') && text.includes('Courses') && text.includes('Live') && text.includes('Tests') && text.includes('Profile');
      }) || null;
    }
    if (navShell) {
      navShell.style.position = 'absolute';
      navShell.style.top = 'auto';
      navShell.style.bottom = '0';
      navShell.style.left = '0';
      navShell.style.right = '0';
      navShell.style.transform = 'none';
    }
  });
  await sleep(400);
};

const captureCurrentPage = async (page, path) => {
  await prepareFullPageScreenshot(page);
  const pageHeight = await page.evaluate(() => Math.max(
    document.documentElement.scrollHeight,
    document.body?.scrollHeight || 0,
  ));
  await page.setViewport({ ...mobileViewport, height: Math.min(Math.max(Math.ceil(pageHeight), mobileViewport.height), 4096) });
  await sleep(500);
  await page.screenshot({ path });
  await page.setViewport(mobileViewport);
  await sleep(250);
};

const browser = await puppeteer.launch({
  executablePath: chromeExecutable,
  headless: true,
  userDataDir,
  args: [
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-sandbox',
    '--disable-crash-reporter',
    '--disable-breakpad',
    '--disable-features=Crashpad',
  ],
});

try {
  const seededToken = await loginByApi();
  const page = await browser.newPage();
  await page.setViewport(mobileViewport);
  await page.evaluateOnNewDocument((token, storageKey) => {
    window.localStorage.removeItem(storageKey);
    window.sessionStorage.removeItem(storageKey);
    if (token) {
      window.localStorage.setItem(storageKey, token);
    }
  }, seededToken, tokenStorageKey);
  page.on('pageerror', (error) => log('pageerror', error.message));
  page.on('requestfailed', (request) => log('requestfailed', request.url(), request.failure()?.errorText || ''));

  await openLiveList(page, seededToken);
  const listPath = '/private/tmp/live-mobile-list-current.png';
  const detailPath = '/private/tmp/live-mobile-detail-current.png';
  const roomPath = '/private/tmp/live-mobile-room-current.png';
  const reminderLabelAtLoad = await getSelectorText(page, '[data-testid="live-reminders-toggle"]');
  if (reminderLabelAtLoad.includes('Enabled')) {
    await clickSelector(page, '[data-testid="live-reminders-toggle"]');
    await sleep(250);
  }
  await captureCurrentPage(page, listPath);
  log('saved list', listPath);

  const stateAfterOpen = await page.evaluate(() => ({
    listVisibleAfterOpen: Boolean(document.querySelector('[data-testid="live-classes-page"]')),
    detailVisibleAfterOpen: Boolean(document.querySelector('[data-testid="live-class-detail-page"]')),
  }));

  await openLiveDetail(page);
  await captureCurrentPage(page, detailPath);
  log('saved detail', detailPath);

  const stateAfterClick = await page.evaluate(() => ({
    detailVisibleAfterClick: Boolean(document.querySelector('[data-testid="live-class-detail-page"]')),
  }));

  await openLiveRoom(page);
  await captureCurrentPage(page, roomPath);
  log('saved room', roomPath);

  const roomVisible = await pageHasSelector(page, '[data-testid="live-room-reference-page"], [data-testid="live-runtime-page"]');
  await clickSelector(page, '[data-testid="live-room-tab-notes"]');
  await sleep(250);
  const roomNotesVisible = await pageHasText(page, 'Session Notes');
  await clickSelector(page, '[data-testid="live-room-tab-polls"]');
  await sleep(250);
  const roomPollsVisible = await pageHasText(page, 'Quick Poll');
  await clickSelector(page, '[data-testid="live-room-tab-resources"]');
  await sleep(250);
  const roomResourcesVisible = await pageHasText(page, 'Download All');
  await clickSelector(page, '[data-testid="live-room-tab-chat"]');
  await sleep(250);
  const roomChatVisible = await pageHasText(page, 'Live Chat');

  await clickSelector(page, '[data-testid="live-room-back"]');
  await page.waitForSelector('[data-testid="live-class-detail-page"]', { timeout: 60000 });
  await sleep(500);

  const overviewVisible = await pageHasText(page, 'About this class');

  await clickSelector(page, '[data-testid="live-detail-tab-chat"]');
  await sleep(250);
  const chatVisible = await pageHasSelector(page, '[data-testid="live-chat-input-inline"]');

  await clickSelector(page, '[data-testid="live-detail-tab-notes"]');
  await sleep(250);
  const notesVisible = await pageHasText(page, 'Session Notes');

  await clickSelector(page, '[data-testid="live-detail-tab-polls"]');
  await sleep(250);
  const pollsVisible = await pageHasText(page, 'Quick Poll');

  await clickSelector(page, '[data-testid="live-detail-tab-resources"]');
  await sleep(250);
  const resourcesTabVisible = await pageHasText(page, 'Download All');

  await clickSelector(page, '[data-testid="live-detail-tab-overview"]');
  await sleep(250);
  const overviewRestoredVisible = await pageHasText(page, 'About this class');

  await clickSelector(page, '[data-testid="live-detail-view-profile"]');
  const teacherPanelVisible = await pageHasText(page, 'Teacher Profile');

  await clickSelector(page, '[data-testid="live-detail-get-help"]');
  const supportPanelVisible = await pageHasText(page, 'Run audio and video check');
  if (supportPanelVisible) {
    await clickButtonByText(page, ['Open notes and resources']);
  }
  const resourcesVisible = await pageHasText(page, 'Download All');

  console.log(JSON.stringify({
    listPath,
    detailPath,
    roomPath,
    teacherPanelVisible,
    chatVisible,
    notesVisible,
    pollsVisible,
    resourcesTabVisible,
    overviewVisible,
    overviewRestoredVisible,
    supportPanelVisible,
    resourcesVisible,
    roomVisible,
    roomNotesVisible,
    roomPollsVisible,
    roomResourcesVisible,
    roomChatVisible,
    ...stateAfterOpen,
    ...stateAfterClick,
  }));
} finally {
  await browser.close();
}
