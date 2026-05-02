import puppeteer from '../qa-automation/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';

const baseUrl = process.env.QA_BASE_URL || 'http://127.0.0.1:3300';
const chromeExecutable = process.env.QA_CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chromeUserDataDir = process.env.QA_CHROME_USER_DATA_DIR || '/tmp/edumaster-live-debug-chrome';
const email = process.env.QA_ADMIN_EMAIL || 'admin@local.edumaster';
const password = process.env.QA_ADMIN_PASSWORD || 'AdminChangeMe_2026';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const clickButtonByText = async (page, text) => page.evaluate((expected) => {
  const candidate = Array.from(document.querySelectorAll('button')).find((node) =>
    (node.textContent || '').replace(/\s+/g, ' ').includes(String(expected)),
  );
  candidate?.click();
  return Boolean(candidate);
}, text);

const main = async () => {
  const browser = await puppeteer.launch({
    executablePath: chromeExecutable,
    headless: true,
    userDataDir: chromeUserDataDir,
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
    const page = await browser.newPage();
    page.on('console', (message) => console.log(`[console:${message.type()}] ${message.text()}`));
    page.on('pageerror', (error) => console.log(`[pageerror] ${error.message}`));
    page.on('requestfailed', (request) => console.log(`[requestfailed] ${request.url()} ${request.failure()?.errorText || ''}`));

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('[data-testid="auth-login-email"]', { timeout: 30000 });
    await page.locator('[data-testid="auth-login-email"]').fill(email);
    await page.locator('[data-testid="auth-login-password"]').fill(password);
    await page.click('[data-testid="auth-login-submit"]');

    try {
      await page.waitForFunction(
        () => (document.body?.innerText || '').includes('Log out older device and continue'),
        { timeout: 4000 },
      );
      await clickButtonByText(page, 'Log out older device and continue');
    } catch {
      // No takeover prompt.
    }

    await page.waitForSelector('[data-testid="nav-live"]', { timeout: 45000 });
    await page.click('[data-testid="nav-live"]');
    await page.waitForSelector('[data-testid="live-classes-page"]', { timeout: 30000 });
    await page.evaluate(() => {
      const card = Array.from(document.querySelectorAll('[data-testid^="live-card-"]')).find((node) =>
        (node.textContent || '').toLowerCase().includes('live'),
      );
      card?.click();
    });

    await page.waitForSelector('[data-testid="live-class-detail-page"]', { timeout: 30000 });
    const joinDisabled = await page.$eval('[data-testid="live-details-join-button"]', (node) => node.hasAttribute('disabled'));
    if (!joinDisabled) {
      await page.click('[data-testid="live-details-join-button"]');
      await page.waitForSelector('[data-testid="live-runtime-page"]', { timeout: 30000 });
    }

    await sleep(12000);

    const snapshot = await page.evaluate(() => {
      const container = document.querySelector('[data-testid="live-jitsi-container"]');
      const iframe = container?.querySelector('iframe');
      const runtime = document.querySelector('[data-testid="live-runtime-page"]');

      return {
        runtimeRoomLoaded: runtime?.getAttribute('data-room-loaded') || null,
        containerRoomLoaded: container?.getAttribute('data-room-loaded') || null,
        containerChildCount: container?.childElementCount || 0,
        iframePresent: Boolean(iframe),
        iframeSrc: iframe?.getAttribute('src') || null,
        iframeAllow: iframe?.getAttribute('allow') || null,
        iframeWidth: iframe?.getAttribute('width') || null,
        iframeHeight: iframe?.getAttribute('height') || null,
        iframeStyle: iframe?.getAttribute('style') || null,
        containerHtml: container?.innerHTML?.slice(0, 1200) || '',
        pageText: (document.body?.innerText || '').slice(0, 1600),
      };
    });

    console.log(JSON.stringify(snapshot, null, 2));
    console.log(JSON.stringify(page.frames().map((frame) => frame.url()), null, 2));
  } finally {
    await browser.close();
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
