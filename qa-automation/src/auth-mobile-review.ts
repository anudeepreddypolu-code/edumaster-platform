import fs from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { config } from './config.js';
import { artifactPath, createRunContext, writeJson, writeText } from './utils.js';

const chromeExecutable = process.env.QA_CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chromeUserDataDir = process.env.QA_CHROME_USER_DATA_DIR || path.join('/tmp', `edumaster-auth-qa-chrome-${Date.now()}`);
const authEmail = process.env.QA_LOGIN_EMAIL || config.loginEmail || `qa.auth.student+${Date.now()}@local.test`;
const authPassword = process.env.QA_LOGIN_PASSWORD || config.loginPassword || 'Student@12345';
const baseUrl = process.env.QA_BASE_URL || 'http://127.0.0.1:3300';
const mobileViewport = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const takeScreenshot = async (
  page: puppeteer.Page,
  root: Awaited<ReturnType<typeof createRunContext>>,
  stepId: string,
  label: string,
) => {
  const screenshotPath = artifactPath(root.screenshotDir, stepId, label, 'png');
  const sourcePath = artifactPath(root.sourceDir, stepId, label, 'html');
  await page.screenshot({ path: screenshotPath, fullPage: false });
  await fs.writeFile(sourcePath, await page.content(), 'utf8');
  return { screenshotPath, sourcePath };
};

const waitForVisible = async (page: puppeteer.Page, selector: string, timeout = 45000) => {
  await page.waitForSelector(selector, { visible: true, timeout });
};

const safeGoto = async (page: puppeteer.Page, url: string) => {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('Navigation timeout')) {
      throw error;
    }
  }
};

const clickButtonContaining = async (page: puppeteer.Page, text: string) => {
  const clicked = await page.evaluate((expected) => {
    const button = Array.from(document.querySelectorAll('button')).find((node) =>
      (node.textContent || '').replace(/\s+/g, ' ').includes(String(expected)),
    ) as HTMLButtonElement | undefined;
    button?.click();
    return Boolean(button);
  }, text);
  return clicked;
};

const waitForBodyText = async (page: puppeteer.Page, text: string, timeout = 15000) => {
  await page.waitForFunction(
    (expected) => (document.body?.innerText || '').includes(String(expected)),
    { timeout },
    text,
  );
};

const waitForShell = async (page: puppeteer.Page, timeout = 45000) => {
  await page.waitForFunction(
    () => Boolean(
      document.querySelector('[data-testid="shell-ready"]')
      || document.querySelector('[data-testid="mobile-nav-overview"]')
      || document.querySelector('[data-testid="nav-overview"]'),
    ),
    { timeout },
  );
};

const waitForAuthOrShell = async (page: puppeteer.Page, timeout = 45000) => {
  await page.waitForFunction(
    () => Boolean(
      document.querySelector('[data-testid="auth-login-email"]')
      || document.querySelector('[data-testid="shell-ready"]')
      || document.querySelector('[data-testid="mobile-nav-overview"]')
      || document.querySelector('[data-testid="nav-overview"]'),
    ),
    { timeout },
  );
};

const ensureSignedOut = async (page: puppeteer.Page) => {
  await safeGoto(page, baseUrl);
  await waitForAuthOrShell(page, 45000);

  const hasShell = await page.evaluate(() => Boolean(
    document.querySelector('[data-testid="shell-ready"]')
    || document.querySelector('[data-testid="mobile-nav-overview"]')
    || document.querySelector('[data-testid="nav-overview"]'),
  )).catch(() => false);

  if (!hasShell) {
    await waitForVisible(page, '[data-testid="auth-login-email"]');
    return;
  }

  const openedProfile = await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('button'));
    const profile = candidates.find((node) => {
      const text = (node.textContent || '').trim();
      return text === 'A' || text === 'EA' || text === 'Admin' || text === 'Profile';
    }) as HTMLButtonElement | undefined;
    profile?.click();
    return Boolean(profile);
  }).catch(() => false);

  if (openedProfile) {
    await sleep(400);
  }

  try {
    await clickButtonContaining(page, 'Logout');
  } catch {
    // Already signed out or menu unavailable.
  }
  await safeGoto(page, baseUrl);
  await waitForVisible(page, '[data-testid="auth-login-email"]');
};

const openRegister = async (page: puppeteer.Page) => {
  const clicked = await clickButtonContaining(page, 'Create account')
    || await clickButtonContaining(page, 'Sign Up');
  if (!clicked) {
    throw new Error('Unable to open the register screen.');
  }
  await waitForVisible(page, '[data-testid="auth-register-name"]');
};

const registerIfNeeded = async (page: puppeteer.Page, email: string, password: string) => {
  await safeGoto(page, baseUrl);
  await waitForVisible(page, '[data-testid="auth-login-email"]');
  await openRegister(page);
  await page.locator('[data-testid="auth-register-name"]').fill('QA Auth Student');
  await page.locator('[data-testid="auth-register-email"]').fill(email);
  await page.locator('[data-testid="auth-register-password"]').fill(password);
  await page.locator('input[placeholder="Confirm your password"]').fill(password);
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const checkbox = buttons.find((node) => {
      const parent = node.parentElement;
      return parent?.textContent?.includes('Terms & Conditions');
    }) as HTMLButtonElement | undefined;
    checkbox?.click();
  });
  await page.locator('[data-testid="auth-register-submit"]').click();
  try {
    await waitForShell(page, 45000);
    return;
  } catch {
    const bodyText = await page.evaluate(() => document.body?.innerText || '');
    if (bodyText.includes('already') || bodyText.includes('exists')) {
      await login(page, email, password);
      return;
    }
    throw new Error(`Unable to register or login test student. Screen text: ${bodyText.slice(0, 300)}`);
  }
};

const login = async (page: puppeteer.Page, email: string, password: string) => {
  await safeGoto(page, baseUrl);
  await waitForVisible(page, '[data-testid="auth-login-email"]');
  await page.locator('[data-testid="auth-login-email"]').fill(email);
  await page.locator('[data-testid="auth-login-password"]').fill(password);
  await page.locator('[data-testid="auth-login-submit"]').click();
};

const captureBaselineNotes = () => [
  'Current auth layout is a light web card, not the dark full-screen native mobile frame shown in Figma.',
  'Login screen is missing remember-me row, forgot-password link styling, and branded Google/Apple social buttons from Figma.',
  'Signup screen is missing back button, mobile-number field, confirm-password field, terms consent row, and password-strength indicator.',
  'Device-limit screen exists, but its content hierarchy, spacing, and action layout do not match the Figma mobile design.',
  'Logged-out-success screen does not exist yet; after takeover the app goes straight into the shell.',
];

const main = async () => {
  const ctx = await createRunContext();
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
    ],
  });

  const captures: Array<Record<string, string>> = [];

  try {
    const loginPage = await browser.newPage();
    await loginPage.setViewport(mobileViewport);
    await ensureSignedOut(loginPage);
    await sleep(500);
    const loginCapture = await takeScreenshot(loginPage, ctx, 'auth-mobile-login', 'current-login');
    captures.push({ stepId: 'auth-mobile-login', screenshotPath: loginCapture.screenshotPath, sourcePath: loginCapture.sourcePath });

    await openRegister(loginPage);
    await sleep(300);
    const registerCapture = await takeScreenshot(loginPage, ctx, 'auth-mobile-register', 'current-register');
    captures.push({ stepId: 'auth-mobile-register', screenshotPath: registerCapture.screenshotPath, sourcePath: registerCapture.sourcePath });
    await loginPage.close();

    const primarySession = await browser.createBrowserContext();
    const conflictSession = await browser.createBrowserContext();

    const primaryPage = await primarySession.newPage();
    await primaryPage.setViewport(mobileViewport);
    await registerIfNeeded(primaryPage, authEmail, authPassword);
    await waitForShell(primaryPage, 45000);

    const conflictPage = await conflictSession.newPage();
    await conflictPage.setViewport(mobileViewport);
    await login(conflictPage, authEmail, authPassword);
    await waitForBodyText(conflictPage, 'Device Limit Reached', 20000);
    await sleep(700);
    const conflictCapture = await takeScreenshot(conflictPage, ctx, 'auth-mobile-device-limit', 'device-limit-pending');
    captures.push({ stepId: 'auth-mobile-device-limit', screenshotPath: conflictCapture.screenshotPath, sourcePath: conflictCapture.sourcePath });

    const clickedLogout = await clickButtonContaining(conflictPage, 'Log out older device and continue')
      || await clickButtonContaining(conflictPage, 'Log Out 1 Device to Continue')
      || await clickButtonContaining(conflictPage, 'Log Out');

    if (clickedLogout) {
      await sleep(1800);
      const hasSuccessText = await conflictPage.evaluate(() => (document.body?.innerText || '').includes('Logged Out Successfully'));
      await sleep(500);
      const postLabel = hasSuccessText ? 'logged-out-success' : 'post-takeover-current';
      const postCapture = await takeScreenshot(conflictPage, ctx, 'auth-mobile-post-takeover', postLabel);
      captures.push({ stepId: 'auth-mobile-post-takeover', screenshotPath: postCapture.screenshotPath, sourcePath: postCapture.sourcePath });
    }

    await primarySession.close();
    await conflictSession.close();

    await writeJson(path.join(ctx.analysisDir, 'summary.json'), {
      runId: ctx.runId,
      type: 'auth-mobile-review',
      baseUrl,
      captures,
      notes: captureBaselineNotes(),
    });

    await writeText(
      path.join(ctx.analysisDir, 'gap-notes.md'),
      `# Mobile Auth Baseline Notes\n\n${captureBaselineNotes().map((note) => `- ${note}`).join('\n')}\n`,
    );

    console.log(ctx.rootDir);
  } finally {
    await browser.close();
  }
};

await main();
