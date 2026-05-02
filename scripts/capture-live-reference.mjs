import fs from 'node:fs/promises';
import path from 'node:path';
import puppeteer from '../qa-automation/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';

const chromeExecutable = process.env.QA_CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const baseUrl = process.env.QA_BASE_URL || 'http://127.0.0.1:3300';
const adminEmail = process.env.QA_ADMIN_EMAIL || 'admin@local.edumaster';
const adminPassword = process.env.QA_ADMIN_PASSWORD || 'AdminChangeMe_2026';
const userDataDir = process.env.QA_CHROME_USER_DATA_DIR || '/tmp/edumaster-live-qa-chrome';

const desktopViewport = { width: 1536, height: 1024, deviceScaleFactor: 1 };
const mobileViewport = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

const runId = new Date().toISOString().replace(/[:.]/g, '-');
const artifactRoot = path.resolve('qa-automation/qa-automation/artifacts', `manual-live-${runId}`);
const screenshotDir = path.join(artifactRoot, 'screenshots');
const sourceDir = path.join(artifactRoot, 'sources');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ensureDir = async (dir) => fs.mkdir(dir, { recursive: true });

const saveState = async (page, name) => {
  await ensureDir(screenshotDir);
  await ensureDir(sourceDir);
  await page.screenshot({ path: path.join(screenshotDir, `${name}.png`), fullPage: true });
  await fs.writeFile(path.join(sourceDir, `${name}.html`), await page.content(), 'utf8');
};

const waitForSelector = async (page, selector, timeout = 30000) => {
  await page.waitForSelector(selector, { timeout });
};

const click = async (page, selector) => {
  await waitForSelector(page, selector);
  await page.locator(selector).click();
};

const loginAdmin = async (page) => {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  let shellReady = await page.evaluate(() => Boolean(document.querySelector('[data-testid="nav-live"]'))).catch(() => false);
  if (shellReady) {
    return;
  }
  try {
    await page.waitForFunction(
      () => Boolean(document.querySelector('[data-testid="nav-live"]')) || Boolean(document.querySelector('[data-testid="auth-login-email"]')),
      { timeout: 10000 },
    );
  } catch {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  }
  shellReady = await page.evaluate(() => Boolean(document.querySelector('[data-testid="nav-live"]'))).catch(() => false);
  if (shellReady) {
    return;
  }
  await waitForSelector(page, '[data-testid="auth-login-email"]');
  await page.locator('[data-testid="auth-login-email"]').fill(adminEmail);
  await page.locator('[data-testid="auth-login-password"]').fill(adminPassword);
  await click(page, '[data-testid="auth-login-submit"]');
  try {
    await page.waitForFunction(
      () => (document.body?.innerText || '').includes('Log out older device and continue'),
      { timeout: 4000 },
    );
    await page.evaluate(() => {
      const button = Array.from(document.querySelectorAll('button')).find((node) =>
        (node.textContent || '').includes('Log out older device and continue'),
      );
      button?.click();
    });
  } catch {}
  await page.waitForFunction(
    () => Boolean(document.querySelector('[data-testid="nav-live"]')),
    { timeout: 45000 },
  );
};

const openLiveList = async (page) => {
  const liveUrl = new URL(baseUrl);
  liveUrl.searchParams.set('tab', 'live');
  await page.goto(liveUrl.toString(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitForSelector(page, '[data-testid="live-classes-page"]', 30000);
};

const openPreferredDetail = async (page, preferLive = false) => {
  const opened = await page.evaluate((shouldPreferLive) => {
    const cards = Array.from(document.querySelectorAll('[data-testid="live-featured-card"], [data-testid^="live-card-"]'));
    const liveCandidate = cards.find((node) => (node.textContent || '').toLowerCase().includes('live'));
    const button = (shouldPreferLive ? liveCandidate : cards[0]) || liveCandidate || cards[0];
    button?.click();
    return Boolean(button);
  }, preferLive);
  if (!opened) {
    throw new Error('Unable to open a live class detail.');
  }
  await waitForSelector(page, '[data-testid="live-class-detail-page"]', 30000);
};

const enterRoomIfPossible = async (page) => {
  await page.waitForFunction(
    () => {
      const button = document.querySelector('[data-testid="live-details-join-button"]');
      return Boolean(button && !button.disabled);
    },
    { timeout: 30000 },
  );

  const clicked = await page.evaluate(() => {
    const button = document.querySelector('[data-testid="live-details-join-button"]');
    if (!button || button.disabled) {
      return false;
    }
    button.click();
    return true;
  });
  if (!clicked) {
    throw new Error('Live details join button is not available.');
  }
  await waitForSelector(page, '[data-testid="live-runtime-page"]', 45000);
  await sleep(5000);
};

const captureSurface = async (page, name, openFn) => {
  await page.setViewport(desktopViewport);
  await openFn();
  await page.waitForSelector(
    name.includes('room')
      ? '[data-testid="live-runtime-page"]'
      : name.includes('detail')
        ? '[data-testid="live-class-detail-page"]'
        : '[data-testid="live-classes-page"]',
    { timeout: 30000 },
  );
  await sleep(1200);
  await saveState(page, `${name}-desktop`);

  await page.setViewport(mobileViewport);
  await page.waitForSelector(
    name.includes('room')
      ? '[data-testid="live-runtime-page"]'
      : name.includes('detail')
        ? '[data-testid="live-class-detail-page"]'
        : '[data-testid="live-classes-page"]',
    { timeout: 30000 },
  );
  await sleep(1200);
  await saveState(page, `${name}-mobile`);
};

const browser = await puppeteer.launch({
  executablePath: chromeExecutable,
  userDataDir,
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

try {
  const page = await browser.newPage();
  await page.setViewport(desktopViewport);
  await loginAdmin(page);

  await captureSurface(page, 'live-list', async () => {
    await openLiveList(page);
  });

  await captureSurface(page, 'live-detail', async () => {
    await openLiveList(page);
    await openPreferredDetail(page, false);
  });

  await captureSurface(page, 'live-room', async () => {
    await openLiveList(page);
    await openPreferredDetail(page, true);
    await enterRoomIfPossible(page);
  });

  await fs.writeFile(
    path.join(artifactRoot, 'README.txt'),
    `Manual live capture completed.\nArtifact root: ${artifactRoot}\n`,
    'utf8',
  );

  console.log(artifactRoot);
} finally {
  await browser.close();
}
