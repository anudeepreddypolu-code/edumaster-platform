import fs from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const baseUrl = process.env.QA_BASE_URL || 'http://127.0.0.1:3300';
const chromeExecutable = process.env.QA_CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const studentEmail = process.env.QA_LOGIN_EMAIL || 'student@edumaster.local';
const studentPassword = process.env.QA_LOGIN_PASSWORD || 'Student@123';
const outputDir = path.resolve(process.cwd(), 'qa-automation', 'artifacts', 'live-current-captures');
const chromeUserDataDir = process.env.QA_CHROME_USER_DATA_DIR || path.join('/tmp', `edumaster-live-capture-${Date.now()}`);

const waitForVisible = async (page: puppeteer.Page, selector: string, timeout = 45000) => {
  await page.waitForSelector(selector, { visible: true, timeout });
};

const clickFirstButtonContaining = async (page: puppeteer.Page, text: string) => {
  const clicked = await page.evaluate((expected) => {
    const button = Array.from(document.querySelectorAll('button')).find((node) =>
      (node.textContent || '').includes(String(expected)),
    ) as HTMLButtonElement | undefined;
    button?.click();
    return Boolean(button);
  }, text);
  return clicked;
};

const handleSessionConflictIfPresent = async (page: puppeteer.Page) => {
  try {
    await page.waitForFunction(
      () => {
        const bodyText = document.body?.innerText || '';
        return bodyText.includes('Log out older device and continue')
          || bodyText.includes('Log Out 1 Device to Continue')
          || bodyText.includes('Device Limit Reached');
      },
      { timeout: 5000 },
    );
    const clicked = await clickFirstButtonContaining(page, 'Log out older device and continue')
      || await clickFirstButtonContaining(page, 'Log Out 1 Device to Continue')
      || await clickFirstButtonContaining(page, 'Log Out');
    if (!clicked) {
      throw new Error('Session conflict modal was visible, but no logout button could be clicked.');
    }
  } catch {
    // No conflict modal.
  }
};

const loginAsAdmin = async (page: puppeteer.Page) => {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await clickFirstButtonContaining(page, 'Use admin login');
  await waitForVisible(page, '[data-testid="auth-login-submit"]');
  await page.locator('[data-testid="auth-login-submit"]').click();
  await handleSessionConflictIfPresent(page);
  await page.waitForFunction(
    () => Boolean(document.querySelector('[data-testid="nav-live"]')),
    { timeout: 45000 },
  );
};

const loginAsStudent = async (page: puppeteer.Page) => {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitForVisible(page, '[data-testid="auth-login-email"]');
  await page.locator('[data-testid="auth-login-email"]').fill(studentEmail);
  await page.locator('[data-testid="auth-login-password"]').fill(studentPassword);
  await page.locator('[data-testid="auth-login-submit"]').click();
  await handleSessionConflictIfPresent(page);
  await page.waitForFunction(
    () => Boolean(document.querySelector('[data-testid="mobile-nav-live"]') || document.querySelector('[data-testid="nav-live"]')),
    { timeout: 45000 },
  );
};

const openLiveTab = async (page: puppeteer.Page) => {
  const clicked = await page.evaluate(() => {
    const target = (
      document.querySelector('[data-testid="mobile-nav-live"]')
      || document.querySelector('[data-testid="nav-live"]')
    ) as HTMLButtonElement | null;
    target?.click();
    return Boolean(target);
  });
  if (!clicked) {
    throw new Error('Unable to open live tab.');
  }
  await page.waitForFunction(
    () => Boolean(document.querySelector('[data-testid="live-classes-page"]')),
    { timeout: 30000 },
  );
};

const screenshot = async (page: puppeteer.Page, filename: string) => {
  await page.screenshot({
    path: path.join(outputDir, filename),
    fullPage: true,
  });
};

const captureAdmin = async (browser: puppeteer.Browser) => {
  const page = await browser.newPage();
  await page.setViewport({ width: 1536, height: 1024, deviceScaleFactor: 1 });
  await loginAsAdmin(page);
  await openLiveTab(page);
  await screenshot(page, 'admin-live-list-desktop.png');

  const createToggle = await page.$('[data-testid="live-create-toggle"]');
  if (createToggle) {
    await createToggle.click();
    await page.waitForFunction(
      () => Boolean(document.querySelector('[data-testid="live-create-form"]')),
      { timeout: 10000 },
    );
    await screenshot(page, 'admin-live-create-desktop.png');
  }

  const firstCard = await page.$('[data-testid^="live-card-"]');
  if (firstCard) {
    await firstCard.click();
    await page.waitForFunction(
      () => Boolean(document.querySelector('[data-testid="live-class-detail-page"]')),
      { timeout: 30000 },
    );
    await screenshot(page, 'admin-live-detail-desktop.png');
  }

  await page.close();
};

const captureStudent = async (browser: puppeteer.Browser) => {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await loginAsStudent(page);
  await openLiveTab(page);
  await screenshot(page, 'student-live-list-mobile.png');

  const featured = await page.$('[data-testid="live-featured-card"]') || await page.$('[data-testid^="live-card-"]');
  if (featured) {
    await featured.click();
    await page.waitForFunction(
      () => Boolean(document.querySelector('[data-testid="live-class-detail-page"]')),
      { timeout: 30000 },
    );
    await screenshot(page, 'student-live-detail-mobile.png');
  }

  await page.close();
};

const main = async () => {
  await fs.mkdir(outputDir, { recursive: true });
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: chromeExecutable,
    userDataDir: chromeUserDataDir,
    args: [
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--disable-crash-reporter',
      '--disable-breakpad',
      '--disable-features=Crashpad',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--allow-http-screen-capture',
      '--enable-usermedia-screen-capturing',
      '--auto-select-desktop-capture-source=Entire screen',
    ],
  });

  try {
    await captureAdmin(browser);
    await captureStudent(browser);
    console.log(outputDir);
  } finally {
    await browser.close();
  }
};

await main();
