import fs from 'node:fs/promises';
import path from 'node:path';
import puppeteer from '../qa-automation/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';

const baseUrl = process.env.QA_BASE_URL || 'http://127.0.0.1:3300';
const chromePath = process.env.QA_CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const loginAndSeedStorage = async (page) => {
  const response = await fetch(new URL('/backend/api/auth/login', baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: process.env.QA_LOGIN_EMAIL || 'student@edumaster.local',
      password: process.env.QA_LOGIN_PASSWORD || 'Student@123',
      device: 'QA All Courses Capture',
      forceLogoutOtherSessions: true,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.token) {
    throw new Error(payload?.error || payload?.message || 'Unable to login for all courses capture');
  }

  await page.evaluate((token) => {
    window.localStorage.setItem('edumaster.jwt', token);
  }, payload.token);
};

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  defaultViewport: { width: 1536, height: 1024 },
  args: [
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-sandbox',
    '--window-size=1536,1024',
  ],
});

const page = await browser.newPage();

try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await loginAndSeedStorage(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="overview-dashboard"]', { timeout: 30000 });
  await page.click('[data-testid="nav-courses"]');
  await page.waitForFunction(() => document.body?.innerText?.includes('Course catalog') || document.body?.innerText?.includes('Study room'), { timeout: 30000 });
  await page.evaluate(() => window.scrollTo(0, 0));

  const screenshotPath = path.resolve('tmp-nav-compare/all-courses-current.png');
  const sourcePath = path.resolve('tmp-nav-compare/all-courses-current.html');

  await page.screenshot({ path: screenshotPath, fullPage: true });
  await fs.writeFile(sourcePath, await page.content(), 'utf8');

  console.log(JSON.stringify({ screenshotPath, sourcePath }));
} finally {
  await browser.close().catch(() => undefined);
}
