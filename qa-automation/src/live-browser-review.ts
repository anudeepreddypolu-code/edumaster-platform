import fs from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { config } from './config.js';
import { artifactPath, createRunContext, sleep, writeJson, writeText } from './utils.js';
import { CaptureRecord, FailureRecord } from './types.js';

const chromeExecutable = process.env.QA_CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const adminEmail = process.env.QA_ADMIN_EMAIL || 'admin@local.edumaster';
const adminPassword = process.env.QA_ADMIN_PASSWORD || 'AdminChangeMe_2026';
const studentEmail = process.env.QA_LOGIN_EMAIL || config.loginEmail || `qa.live.student+${Date.now()}@local.test`;
const studentPassword = process.env.QA_LOGIN_PASSWORD || config.loginPassword || 'Student@12345';
const chromeUserDataDir = process.env.QA_CHROME_USER_DATA_DIR || path.join('/tmp', `edumaster-live-qa-chrome-${Date.now()}`);

const desktopViewport = { width: 1536, height: 1024, deviceScaleFactor: 1 };
const tabletViewport = { width: 1024, height: 1366, deviceScaleFactor: 1 };
const mobileViewport = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const apiOrigin = (() => {
  const url = new URL(config.baseUrl);
  if (url.hostname === '10.0.2.2') {
    url.hostname = '127.0.0.1';
  }
  return url.origin;
})();

const timestampSuffix = () => new Date().toISOString().replace(/[:.]/g, '-');

const takeScreenshot = async (
  page: puppeteer.Page,
  ctx: Awaited<ReturnType<typeof createRunContext>>,
  stepId: string,
  label: string,
  options: { fullPage?: boolean } = {},
) => {
  const screenshotPath = artifactPath(ctx.screenshotDir, stepId, label, 'png');
  const sourcePath = artifactPath(ctx.sourceDir, stepId, label, 'html');
  await page.screenshot({ path: screenshotPath, fullPage: options.fullPage ?? true });
  await fs.writeFile(sourcePath, await page.content(), 'utf8');
  return { screenshotPath, sourcePath };
};

const recordCapture = async (
  page: puppeteer.Page,
  ctx: Awaited<ReturnType<typeof createRunContext>>,
  captures: CaptureRecord[],
  stepId: string,
  label: string,
  notes: string[] = [],
  options: { fullPage?: boolean } = {},
) => {
  const { screenshotPath, sourcePath } = await takeScreenshot(page, ctx, stepId, label, options);
  captures.push({
    stepId,
    label,
    state: 'ui',
    durationMs: 0,
    screenshotPath,
    sourcePath,
    timestamp: new Date().toISOString(),
    ...(notes.length ? { notes } : {}),
  });
  return screenshotPath;
};

const fail = (
  failures: FailureRecord[],
  stepId: string,
  title: string,
  description: string,
  screenshotPath?: string,
) => {
  failures.push({
    stepId,
    title,
    description,
    severity: 'critical',
    timestamp: new Date().toISOString(),
    screenshotPath,
  });
};

const waitForSelector = async (page: puppeteer.Page, selector: string, timeout = 30000) => {
  await page.waitForSelector(selector, { timeout });
};

const waitForEnabledSelector = async (page: puppeteer.Page, selector: string, timeout = 30000) => {
  await waitForSelector(page, selector, timeout);
  await page.waitForFunction(
    (targetSelector) => {
      const element = document.querySelector(targetSelector) as HTMLButtonElement | null;
      return Boolean(element && !element.disabled);
    },
    { timeout },
    selector,
  );
};

const waitForText = async (page: puppeteer.Page, text: string, timeout = 30000) => {
  await page.waitForFunction(
    (expected) => (document.body?.innerText || '').includes(String(expected)),
    { timeout },
    text,
  );
};

const waitForLiveSurface = async (page: puppeteer.Page, timeout = 20000) => {
  await page.waitForFunction(
    () => Boolean(
      document.querySelector('[data-testid="live-classes-page"]')
      || document.querySelector('[data-testid="live-class-detail-page"]')
      || document.querySelector('[data-testid="live-runtime-page"]'),
    ),
    { timeout },
  );
};

const waitForLiveListSurface = async (page: puppeteer.Page, timeout = 30000) => {
  await page.waitForFunction(
    () => Boolean(
      document.querySelector('[data-testid="live-classes-page"]')
      || document.querySelector('[data-testid="live-create-toggle"]')
      || document.querySelector('[data-testid="live-create-toggle-mobile"]')
      || document.querySelector('[data-testid^="live-card-"]'),
    ),
    { timeout },
  );
};

const ensureLiveSurface = async (page: puppeteer.Page) => {
  try {
    await waitForLiveSurface(page, 6000);
    return;
  } catch {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  }

  try {
    await waitForLiveSurface(page, 12000);
    return;
  } catch {
    await openLiveTab(page);
    await waitForLiveSurface(page, 20000);
  }
};

const click = async (page: puppeteer.Page, selector: string) => {
  try {
    await waitForSelector(page, selector);
    await page.locator(selector).click();
    return;
  } catch (error) {
    const exists = await page.evaluate((targetSelector) => Boolean(document.querySelector(targetSelector)), selector).catch(() => false);
    if (!exists) {
      throw error;
    }
  }
  const clicked = await page.evaluate((targetSelector) => {
    const node = document.querySelector(targetSelector) as HTMLElement | null;
    node?.click();
    return Boolean(node);
  }, selector);
  if (!clicked) {
    throw new Error(`Unable to click selector: ${selector}`);
  }
};

const clickByText = async (page: puppeteer.Page, text: string) => {
  const clicked = await page.evaluate((expected) => {
    const candidate = Array.from(document.querySelectorAll('button')).find((node) =>
      (node.textContent || '').replace(/\s+/g, ' ').includes(String(expected)),
    ) as HTMLButtonElement | undefined;
    candidate?.click();
    return Boolean(candidate);
  }, text);

  if (!clicked) {
    throw new Error(`Unable to find button with text: ${text}`);
  }
};

const clickVisibleMatchingSelector = async (page: puppeteer.Page, selector: string) => {
  const clicked = await page.evaluate((targetSelector) => {
    const node = Array.from(document.querySelectorAll(targetSelector))
      .find((candidate) => (candidate as HTMLElement).offsetParent !== null) as HTMLElement | undefined;
    node?.click();
    return Boolean(node);
  }, selector).catch(() => false);

  if (!clicked) {
    throw new Error(`Unable to click visible selector: ${selector}`);
  }
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
  } catch {
    return;
  }

  const options = ['Log out older device and continue', 'Log Out 1 Device to Continue', 'Log Out'];
  for (const option of options) {
    try {
      await clickByText(page, option);
      return;
    } catch {
      // Try the next visible label.
    }
  }
};

const type = async (page: puppeteer.Page, selector: string, value: string) => {
  await waitForSelector(page, selector);
  await page.locator(selector).fill(value);
};

const setInputValue = async (page: puppeteer.Page, selector: string, value: string) => {
  await waitForSelector(page, selector);
  const updated = await page.evaluate(
    ({ targetSelector, targetValue }) => {
      const input = document.querySelector(targetSelector) as HTMLInputElement | null;
      if (!input) {
        return false;
      }
      const prototype = Object.getPrototypeOf(input);
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
      descriptor?.set?.call(input, targetValue);
      input.focus();
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return input.value;
    },
    { targetSelector: selector, targetValue: value },
  );

  if (updated !== value) {
    throw new Error(`Unable to set ${selector} to ${value}. Actual value: ${String(updated)}`);
  }
};

const loginAndStoreSession = async (
  page: puppeteer.Page,
  email: string,
  password: string,
  device: string,
) => {
  const response = await fetch(new URL('/backend/api/auth/login', apiOrigin), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      device,
      forceLogoutOtherSessions: true,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.token) {
    throw new Error(payload?.error || payload?.message || `Unable to login as ${email}`);
  }

  await page.goto(config.baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate((token) => {
    window.localStorage.setItem('edumaster.jwt', token);
  }, payload.token as string);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
};

const loginThroughUi = async (
  page: puppeteer.Page,
  email: string,
  password: string,
  roleLabel: 'admin' | 'student',
) => {
  if (roleLabel === 'admin' || process.env.QA_LOGIN_EMAIL || config.loginEmail) {
    await loginAndStoreSession(
      page,
      email,
      password,
      roleLabel === 'admin' ? 'QA Live Admin Review' : 'QA Live Student Review',
    );
    try {
      await page.waitForFunction(
        () => Boolean(document.querySelector('[data-testid="nav-live"]'))
          || Boolean(document.querySelector('[data-testid="mobile-nav-live"]'))
          || (document.body?.innerText || '').includes('Live Classes'),
        { timeout: 45000 },
      );
      return;
    } catch (error) {
      const bodyText = await page.evaluate(() => (document.body?.innerText || '').trim());
      throw new Error(`Login shell did not load for ${roleLabel}. Visible text: ${bodyText.slice(0, 1200)}`);
    }
  }

  await page.goto(config.baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  try {
    await waitForText(page, 'Logged Out Successfully', 5000);
    await clickByText(page, 'Continue to Login');
  } catch {
    // No takeover success screen in front of the auth form.
  }

  await waitForSelector(page, '[data-testid="auth-login-email"]', 30000);

  if (roleLabel === 'admin') {
    const usedShortcut = await page.evaluate(() => {
      const button = Array.from(document.querySelectorAll('button')).find((node) =>
        (node.textContent || '').includes('Use admin login'),
      ) as HTMLButtonElement | undefined;
      button?.click();
      return Boolean(button);
    }).catch(() => false);

    if (usedShortcut) {
      await sleep(300);
    }
  }

  if (roleLabel === 'student' && !config.loginEmail && !process.env.QA_LOGIN_EMAIL) {
    await page.evaluate(() => {
      const registerButton = Array.from(document.querySelectorAll('button'))
        .find((node) => /create account|sign up/i.test(node.textContent || '')) as HTMLButtonElement | undefined;
      registerButton?.click();
    });
    await waitForSelector(page, '[data-testid="auth-register-name"]', 30000);
    await page.locator('[data-testid="auth-register-name"]').fill('QA Live Student');
    await page.locator('[data-testid="auth-register-email"]').fill(email);
    await page.locator('[data-testid="auth-register-password"]').fill(password);
    await page.locator('[data-testid="auth-register-confirm-password"]').fill(password);
    await page.locator('[aria-label="Accept terms and privacy policy"]').click();
    await page.locator('[data-testid="auth-register-submit"]').click();
    await page.waitForFunction(
      () => Boolean(document.querySelector('[data-testid="mobile-nav-live"]') || document.querySelector('[data-testid="nav-live"]')),
      { timeout: 45000 },
    );
    return;
  }
  await type(page, '[data-testid="auth-login-email"]', email);
  await type(page, '[data-testid="auth-login-password"]', password);
  await click(page, '[data-testid="auth-login-submit"]');
  await handleSessionConflictIfPresent(page);

  try {
    await page.waitForFunction(
      () => Boolean(document.querySelector('[data-testid="nav-live"]')) || (document.body?.innerText || '').includes('Live Classes'),
      { timeout: 45000 },
    );
  } catch (error) {
    const bodyText = await page.evaluate(() => (document.body?.innerText || '').trim());
    throw new Error(`Login shell did not load for ${roleLabel}. Visible text: ${bodyText.slice(0, 1200)}`);
  }

  if (roleLabel === 'admin') {
    try {
      await page.waitForFunction(
        () => Boolean(document.querySelector('[data-testid="nav-admin"]')) || (document.body?.innerText || '').includes('Admin'),
        { timeout: 45000 },
      );
    } catch {
      const bodyText = await page.evaluate(() => (document.body?.innerText || '').trim());
      throw new Error(`Admin navigation did not load. Visible text: ${bodyText.slice(0, 1200)}`);
    }
  }
};

const openLiveTab = async (page: puppeteer.Page) => {
  const backToListIfNeeded = async () => {
    const detailVisible = await page.evaluate(() => Boolean(document.querySelector('[data-testid="live-class-detail-page"]'))).catch(() => false);
    if (!detailVisible) {
      return false;
    }

    const backClicked = await page.evaluate(() => {
      const detailRoot = document.querySelector('[data-testid="live-class-detail-page"]');
      const buttons = Array.from(detailRoot?.querySelectorAll('button') || []) as HTMLButtonElement[];
      const backButton = buttons.find((button) => button.offsetParent !== null) || buttons[0] || null;
      backButton?.click();
      return Boolean(backButton);
    }).catch(() => false);

    if (backClicked) {
      await page.waitForFunction(
        () => Boolean(document.querySelector('[data-testid="live-classes-page"]')),
        { timeout: 15000 },
      );
      return true;
    }

    return false;
  };

  const navClicked = await page.evaluate(() => {
    const selectors = ['[data-testid="nav-live"]', '[data-testid="mobile-nav-live"]'];
    const button = selectors
      .map((selector) => document.querySelector(selector) as HTMLButtonElement | null)
      .find(Boolean);
    button?.click();
    return Boolean(button);
  }).catch(() => false);

  if (navClicked) {
    try {
      await page.waitForFunction(
      () => Boolean(
          document.querySelector('[data-testid="live-classes-page"]')
          || document.querySelector('[data-testid="live-class-detail-page"]'),
        ),
        { timeout: 15000 },
      );
      await backToListIfNeeded();
      return;
    } catch {
      // Fall through to direct URL navigation if the app shell did not switch tabs cleanly.
    }
  }

  const liveUrl = new URL(config.baseUrl);
  liveUrl.searchParams.set('tab', 'live');
  await page.goto(liveUrl.toString(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  try {
    await page.waitForFunction(
      () => Boolean(
        document.querySelector('[data-testid="live-classes-page"]')
        || document.querySelector('[data-testid="live-class-detail-page"]'),
      ),
      { timeout: 12000 },
    );
    await backToListIfNeeded();
    return;
  } catch {
    // Fall through to direct shell navigation click.
  }

  const secondaryNavClicked = await page.evaluate(() => {
    const button = (
      document.querySelector('[data-testid="nav-live"]')
      || document.querySelector('[data-testid="mobile-nav-live"]')
    ) as HTMLButtonElement | null;
    button?.click();
    return Boolean(button);
  }).catch(() => false);

  if (secondaryNavClicked) {
    try {
      await page.waitForFunction(
      () => Boolean(
          document.querySelector('[data-testid="live-classes-page"]')
          || document.querySelector('[data-testid="live-class-detail-page"]'),
        ),
        { timeout: 12000 },
      );
      await backToListIfNeeded();
      return;
    } catch {
      // If the app restores a previously-open live detail page, go back once.
    }
  }

  const detailBackClicked = await page.evaluate(() => {
    const detailRoot = document.querySelector('[data-testid="live-class-detail-page"]');
    const buttons = Array.from(detailRoot?.querySelectorAll('button') || []) as HTMLButtonElement[];
    const backButton = buttons.find((button) => button.offsetParent !== null) || buttons[0] || null;
    backButton?.click();
    return Boolean(backButton);
  }).catch(() => false);

  if (detailBackClicked) {
    await waitForLiveListSurface(page, 30000);
    return;
  }

  const bodyText = await page.evaluate(() => (document.body?.innerText || '').trim()).catch(() => '');
  throw new Error(`Live classes list page did not open. Visible text: ${bodyText.slice(0, 1200)}`);
};

const ensureLiveListPage = async (page: puppeteer.Page) => {
  const listVisible = await page.evaluate(() => Boolean(document.querySelector('[data-testid="live-classes-page"]'))).catch(() => false);
  if (listVisible) {
    return;
  }

  const backedOut = await page.evaluate(() => {
    const detailRoot = document.querySelector('[data-testid="live-class-detail-page"]');
    if (!detailRoot) {
      return false;
    }
    const buttons = Array.from(detailRoot.querySelectorAll('button')) as HTMLButtonElement[];
    const backButton = buttons.find((button) => button.offsetParent !== null) || buttons[0] || null;
    backButton?.click();
    return Boolean(backButton);
  }).catch(() => false);

  if (backedOut) {
    await waitForLiveListSurface(page, 30000);
    return;
  }

  await openLiveTab(page);
};

const createLiveClass = async (page: puppeteer.Page, title: string) => {
  await ensureLiveListPage(page);

  let hasCreateToggle = await page.evaluate(() => Boolean(
    document.querySelector('[data-testid="live-create-toggle"]')
    || document.querySelector('[data-testid="live-create-toggle-mobile"]'),
  )).catch(() => false);
  if (!hasCreateToggle) {
    await openLiveTab(page);
    hasCreateToggle = await page.evaluate(() => Boolean(
      document.querySelector('[data-testid="live-create-toggle"]')
      || document.querySelector('[data-testid="live-create-toggle-mobile"]'),
    )).catch(() => false);
  }

  if (!hasCreateToggle) {
    const detailBackClicked = await page.evaluate(() => {
      const detailRoot = document.querySelector('[data-testid="live-class-detail-page"]');
      const buttons = Array.from(detailRoot?.querySelectorAll('button') || []) as HTMLButtonElement[];
      const backButton = buttons.find((button) => button.offsetParent !== null) || buttons[0] || null;
      backButton?.click();
      return Boolean(backButton);
    }).catch(() => false);

    if (detailBackClicked) {
      await page.waitForFunction(
        () => Boolean(
          document.querySelector('[data-testid="live-create-toggle"]')
          || document.querySelector('[data-testid="live-create-toggle-mobile"]')
          || document.querySelector('[data-testid="live-classes-page"]'),
        ),
        { timeout: 30000 },
      );
      hasCreateToggle = await page.evaluate(() => Boolean(
        document.querySelector('[data-testid="live-create-toggle"]')
        || document.querySelector('[data-testid="live-create-toggle-mobile"]'),
      )).catch(() => false);
    }
  }

  if (!hasCreateToggle) {
    const bodyText = await page.evaluate(() => (document.body?.innerText || '').trim()).catch(() => '');
    throw new Error(`Admin create toggle is not visible on live classes screen. Visible text: ${bodyText.slice(0, 1200)}`);
  }

  try {
    const clickVisibleCreateToggle = async () => page.evaluate(() => {
      const selectors = ['[data-testid="live-create-toggle"]', '[data-testid="live-create-toggle-mobile"]'];
      const button = selectors
        .map((selector) => document.querySelector(selector) as HTMLButtonElement | null)
        .find((candidate) => candidate && candidate.offsetParent !== null);
      button?.click();
      return Boolean(button);
    }).catch(() => false);

    let createOpened = await clickVisibleCreateToggle();
    if (!createOpened) {
      await ensureLiveListPage(page);
      createOpened = await clickVisibleCreateToggle();
    }
    if (!createOpened) {
      throw new Error('Visible create toggle could not be clicked.');
    }

    await waitForSelector(page, '[data-testid="live-create-form"]', 20000);
    await setInputValue(page, '[data-testid="live-create-title"]', title);
    await setInputValue(page, '[data-testid="live-create-subject"]', 'Physics');
    await setInputValue(page, '[data-testid="live-create-instructor"]', 'QA Live Teacher');
    await click(page, '[data-testid="live-create-next"]');
    const scheduled = new Date(Date.now() + 5 * 60 * 1000);
    const localDateTime = new Date(scheduled.getTime() - scheduled.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    await page.evaluate((value) => {
      const input = document.querySelector('[data-testid="live-create-start-datetime"]') as HTMLInputElement | null;
      if (!input) {
        return false;
      }
      const prototype = Object.getPrototypeOf(input);
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
      descriptor?.set?.call(input, String(value));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, localDateTime);
    await setInputValue(page, '[data-testid="live-create-duration"]', '90');
    await click(page, '[data-testid="live-create-next"]');
    await click(page, '[data-testid="live-create-next"]');
    await click(page, '[data-testid="live-create-next"]');
    await click(page, '[data-testid="live-create-submit"]');

    const submitDeadline = Date.now() + 60000;
    while (Date.now() < submitDeadline) {
      try {
        const settled = await page.evaluate((expectedTitle) => {
          const detailVisible = Boolean(document.querySelector('[data-testid="live-class-detail-page"]'));
          const listVisible = Boolean(document.querySelector('[data-testid="live-classes-page"]'));
          const createFormVisible = Boolean(document.querySelector('[data-testid="live-create-form"]'));
          const createButtonBusy = Boolean((document.querySelector('[data-testid="live-create-submit"]') as HTMLButtonElement | null)?.disabled);
          const bodyText = document.body?.innerText || '';
          const titleVisible = bodyText.includes(String(expectedTitle));
          return ((detailVisible || listVisible || titleVisible) && !createFormVisible && !createButtonBusy)
            || bodyText.includes('Live class created')
            || bodyText.includes('Live class updated');
        }, title).catch(() => false);

        if (settled) {
          break;
        }
      } catch {
        // Ignore transient frame churn after submit and try again.
      }
      await sleep(800);
    }

    const detailId = await page.evaluate(() => (
      document.querySelector('[data-testid="live-class-detail-page"]')?.getAttribute('data-live-class-id')
      || ''
    )).catch(() => '');

    if (detailId) {
      return detailId;
    }

    const matchedCardId = await page.evaluate((expected) => {
      const card = Array.from(document.querySelectorAll('[data-testid^="live-card-"]'))
        .find((node) => (node.textContent || '').includes(String(expected)));
      return card?.getAttribute('data-testid')?.replace('live-card-', '') || '';
    }, title).catch(() => '');

    return matchedCardId;
  } catch (error) {
    const bodyText = await page.evaluate(() => (document.body?.innerText || '').trim()).catch(() => '');
    throw new Error(`Live class did not appear after create submit. ${error instanceof Error ? error.message : String(error)} Visible text: ${bodyText.slice(0, 1200)}`);
  }
};

const captureMobileCreateFlow = async (
  page: puppeteer.Page,
  ctx: Awaited<ReturnType<typeof createRunContext>>,
  captures: CaptureRecord[],
  title: string,
) => {
  const originalViewport = page.viewport();
  await page.setViewport(mobileViewport);
  await sleep(700);
  await ensureLiveListPage(page);
  await recordCapture(page, ctx, captures, 'live-list-mobile-admin', 'live-list-mobile-admin', [
    'Admin mobile live list baseline before opening create flow.',
  ], { fullPage: false });

  const openCreate = async () => {
    const clicked = await page.evaluate(() => {
      const button = (
        document.querySelector('[data-testid="live-create-toggle-mobile"]')
        || document.querySelector('[data-testid="live-create-toggle"]')
      ) as HTMLButtonElement | null;
      button?.click();
      return Boolean(button);
    }).catch(() => false);

    if (!clicked) {
      throw new Error('Unable to open mobile live create flow.');
    }
    await waitForSelector(page, '[data-testid="live-create-form"]', 20000);
  };

  try {
    await openCreate();
    await setInputValue(page, '[data-testid="live-create-title"]', title);
    await setInputValue(page, '[data-testid="live-create-subject"]', 'Physics');
    await setInputValue(page, '[data-testid="live-create-instructor"]', 'Rahul Sharma');
    await recordCapture(page, ctx, captures, 'live-create-mobile-step-1', 'live-create-mobile-step-1', [
      'Mobile create flow step 1: class information.',
    ], { fullPage: false });

    await click(page, '[data-testid="live-create-next"]');
    const scheduled = new Date(Date.now() + 5 * 60 * 1000);
    const localDateTime = new Date(scheduled.getTime() - scheduled.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    await page.evaluate((value) => {
      const input = document.querySelector('[data-testid="live-create-start-datetime"]') as HTMLInputElement | null;
      if (!input) {
        return false;
      }
      const prototype = Object.getPrototypeOf(input);
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
      descriptor?.set?.call(input, String(value));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, localDateTime);
    await setInputValue(page, '[data-testid="live-create-duration"]', '90');
    await recordCapture(page, ctx, captures, 'live-create-mobile-step-2', 'live-create-mobile-step-2', [
      'Mobile create flow step 2: schedule.',
    ], { fullPage: false });

    await click(page, '[data-testid="live-create-next"]');
    await page.evaluate(() => {
      const textareas = Array.from(document.querySelectorAll('textarea')) as HTMLTextAreaElement[];
      if (textareas[0]) {
        textareas[0].value = 'In this live class, we will cover the concept of electric field, flux, potential, and related numerical problems with clear explanations.';
        textareas[0].dispatchEvent(new Event('input', { bubbles: true }));
        textareas[0].dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (textareas[1]) {
        textareas[1].value = 'Understand electric field due to point charge and dipole\nLearn electric flux and Gauss law\nCalculate electric potential and capacitance\nSolve important numericals';
        textareas[1].dispatchEvent(new Event('input', { bubbles: true }));
        textareas[1].dispatchEvent(new Event('change', { bubbles: true }));
      }
      const inputs = Array.from(document.querySelectorAll('input')) as HTMLInputElement[];
      const roleInput = inputs.find((input) => input.placeholder === 'Physics Expert');
      const expInput = inputs.find((input) => input.placeholder === '8+ Years');
      if (roleInput) {
        roleInput.value = 'Physics Expert';
        roleInput.dispatchEvent(new Event('input', { bubbles: true }));
        roleInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (expInput) {
        expInput.value = '8+ Years';
        expInput.dispatchEvent(new Event('input', { bubbles: true }));
        expInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await recordCapture(page, ctx, captures, 'live-create-mobile-step-3', 'live-create-mobile-step-3', [
      'Mobile create flow step 3: class details.',
    ], { fullPage: false });

    await click(page, '[data-testid="live-create-next"]');
    await recordCapture(page, ctx, captures, 'live-create-mobile-step-4', 'live-create-mobile-step-4', [
      'Mobile create flow step 4: settings.',
    ], { fullPage: false });

    await click(page, '[data-testid="live-create-next"]');
    await waitForSelector(page, '[data-testid="live-create-submit"]', 10000);
    await recordCapture(page, ctx, captures, 'live-create-mobile-step-5', 'live-create-mobile-step-5', [
      'Mobile create flow step 5: review and publish.',
    ], { fullPage: false });

    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button')) as HTMLButtonElement[];
      const cancelButton = buttons.find((button) => (button.textContent || '').trim() === 'Cancel');
      cancelButton?.click();
      return Boolean(cancelButton);
    }).catch(() => false);
    await sleep(300);
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button')) as HTMLButtonElement[];
      const backButton = buttons.find((button) =>
        button.offsetParent !== null
        && (button.textContent || '').trim().length === 0,
      );
      backButton?.click();
      return Boolean(backButton);
    }).catch(() => false);
    await waitForLiveListSurface(page, 15000);
  } finally {
    await page.setViewport(originalViewport || desktopViewport);
    await sleep(700);
  }
};

const openLiveClassDetail = async (page: puppeteer.Page, title: string, liveClassId?: string) => {
  const timeoutAt = Date.now() + 60000;

  while (Date.now() < timeoutAt) {
    const detailAlreadyOpen = await page.evaluate(({ expected, targetId }) => {
      const detail = document.querySelector('[data-testid="live-class-detail-page"]');
      if (!detail) {
        return false;
      }
      if (targetId && detail.getAttribute('data-live-class-id') === String(targetId)) {
        return true;
      }
      const titleNode = document.querySelector('[data-testid="live-selected-title"]');
      const text = (titleNode?.textContent || detail.textContent || '').trim();
      return text.includes(String(expected));
    }, { expected: title, targetId: liveClassId || '' }).catch(() => false);

    if (detailAlreadyOpen) {
      return;
    }

    const returnedToList = await page.evaluate(() => {
      const detail = document.querySelector('[data-testid="live-class-detail-page"]');
      if (!detail) {
        return false;
      }
      const buttons = Array.from(detail.querySelectorAll('button')) as HTMLButtonElement[];
      const backButton = buttons.find((button) => {
        const text = (button.textContent || '').trim();
        return text.length === 0;
      }) || buttons[0];
      backButton?.click();
      return Boolean(backButton);
    }).catch(() => false);

    if (returnedToList) {
      try {
        await waitForLiveListSurface(page, 8000);
        await sleep(500);
      } catch {
        // Keep retrying card discovery below.
      }
    }

    const clicked = await page.evaluate(({ expected, targetId }) => {
      const card = Array.from(document.querySelectorAll('[data-testid^="live-card-"]'))
        .find((node) => {
          const testId = node.getAttribute('data-testid') || '';
          if (targetId && testId === `live-card-${String(targetId)}`) {
            return true;
          }
          return (node.textContent || '').includes(String(expected));
        }) as HTMLElement | undefined;
      if (card) {
        card.click();
        return true;
      }

      const featured = document.querySelector('[data-testid="live-featured-card"]') as HTMLElement | null;
      if (featured && (featured.textContent || '').includes(String(expected))) {
        featured.click();
        return true;
      }

      return false;
    }, { expected: title, targetId: liveClassId || '' }).catch(() => false);

    if (clicked) {
      try {
        await waitForSelector(page, '[data-testid="live-class-detail-page"]', 8000);
        if (liveClassId) {
          await page.waitForFunction(
            (targetId) => document.querySelector('[data-testid="live-class-detail-page"]')?.getAttribute('data-live-class-id') === String(targetId),
            { timeout: 8000 },
            liveClassId,
          );
        } else {
          await waitForText(page, title, 8000);
        }
        return;
      } catch {
        // Retry if the app re-rendered or navigation lagged.
      }
    }

    await sleep(800);
  }

  const bodyText = await page.evaluate(() => (document.body?.innerText || '').trim()).catch(() => '');
  throw new Error(`Unable to open live class detail for title: ${title}. Visible text: ${bodyText.slice(0, 1200)}`);
};

const waitForRoomLoaded = async (page: puppeteer.Page) => {
  await waitForSelector(page, '[data-testid="live-runtime-page"]', 60000);
  await page.waitForFunction(
    () => {
      const container = document.querySelector('[data-testid="live-jitsi-container"]');
      if (!container) {
        return false;
      }
      return container.getAttribute('data-room-loaded') === 'true';
    },
    { timeout: 120000 },
  );
};

const getRoomName = async (page: puppeteer.Page) =>
  page.$eval('[data-testid="live-jitsi-container"]', (node) => node.getAttribute('data-room-name') || '');

const waitForLiveMedia = async (page: puppeteer.Page) => {
  await page.waitForFunction(
    () => {
      const container = document.querySelector('[data-testid="live-jitsi-container"]');
      const root = document.querySelector('[data-testid="live-runtime-page"]');
      if (!container) {
        return false;
      }

      const stageSource = root?.getAttribute('data-stage-track-source') || 'none';
      const trackCount = Number(root?.getAttribute('data-livekit-track-count') || '0');
      const videos = Array.from(container.querySelectorAll('video')) as HTMLVideoElement[];
      const hasVisibleVideo = videos.some((video) => {
        const style = window.getComputedStyle(video);
        return style.display !== 'none' && style.visibility !== 'hidden' && video.clientWidth > 0 && video.clientHeight > 0;
      });
      return hasVisibleVideo || (trackCount > 0 && stageSource !== 'none');
    },
    { timeout: 120000 },
  );
};

const waitForLiveRoomShell = async (page: puppeteer.Page, timeout = 30000) => {
  await page.waitForFunction(
    () => Boolean(
      document.querySelector('[data-testid="live-runtime-page"][data-room-loaded="true"]')
      && document.querySelector('[data-testid="live-jitsi-container"]')
      && document.querySelector('[data-testid="live-chat-input"]')
      && document.querySelector('[data-testid="live-toggle-audio"]')
      && document.querySelector('[data-testid="live-toggle-video"]')
      && document.querySelector('[data-testid="live-raise-hand"]')
      && document.querySelector('[data-testid="live-leave-class"]'),
    ),
    { timeout },
  );
};

const getLiveRuntimeDebug = async (page: puppeteer.Page) =>
  page.evaluate(() => {
    const root = document.querySelector('[data-testid="live-runtime-page"]');
    const container = document.querySelector('[data-testid="live-jitsi-container"]');
    const videos = Array.from(container?.querySelectorAll('video') || []) as HTMLVideoElement[];
    const visibleVideoCount = videos.filter((video) => {
      const style = window.getComputedStyle(video);
      return style.display !== 'none' && style.visibility !== 'hidden' && video.clientWidth > 0 && video.clientHeight > 0;
    }).length;
    return {
      roomLoaded: root?.getAttribute('data-room-loaded') || 'missing',
      trackCount: root?.getAttribute('data-livekit-track-count') || 'missing',
      stageSource: root?.getAttribute('data-stage-track-source') || 'missing',
      stageOwner: root?.getAttribute('data-stage-track-owner') || 'missing',
      stageLocal: root?.getAttribute('data-stage-track-local') || 'missing',
      screenSharing: root?.getAttribute('data-screen-sharing') || 'missing',
      visibleVideoCount,
      totalVideoCount: videos.length,
      bodyText: (document.body?.innerText || '').slice(0, 800),
    };
  });

const captureResponsiveScreens = async (
  page: puppeteer.Page,
  ctx: Awaited<ReturnType<typeof createRunContext>>,
  captures: CaptureRecord[],
  stepId: string,
  label: string,
) => {
  const originalViewport = page.viewport();
  const responsiveViewports = [
    { suffix: 'desktop', viewport: desktopViewport },
    { suffix: 'tablet', viewport: tabletViewport },
    { suffix: 'mobile', viewport: mobileViewport },
  ] as const;

  for (const entry of responsiveViewports) {
    await page.setViewport(entry.viewport);
    await sleep(900);
    await openLiveTab(page);
    await waitForLiveListSurface(page, 30000);
    await recordCapture(page, ctx, captures, `${stepId}-${entry.suffix}`, `${label}-${entry.suffix}`, [
      `Responsive capture at ${entry.viewport.width}x${entry.viewport.height}.`,
    ], { fullPage: entry.suffix !== 'mobile' });
  }

  await page.setViewport(originalViewport || desktopViewport);
  await sleep(700);
  await openLiveTab(page);
  await waitForLiveListSurface(page, 30000);
};

const captureResponsiveDetailScreens = async (
  page: puppeteer.Page,
  ctx: Awaited<ReturnType<typeof createRunContext>>,
  captures: CaptureRecord[],
  label: string,
  classTitle: string,
  classId?: string,
) => {
  const originalViewport = page.viewport();
  const responsiveViewports = [
    { suffix: 'desktop', viewport: desktopViewport },
    { suffix: 'tablet', viewport: tabletViewport },
    { suffix: 'mobile', viewport: mobileViewport },
  ] as const;

  for (const entry of responsiveViewports) {
    await page.setViewport(entry.viewport);
    await sleep(700);
    await openLiveClassDetail(page, classTitle, classId);
    await waitForSelector(page, '[data-testid="live-class-detail-page"]', 15000);
    await sleep(500);
    await recordCapture(page, ctx, captures, `${label}-${entry.suffix}`, `${label}-${entry.suffix}`, [
      `Responsive detail capture at ${entry.viewport.width}x${entry.viewport.height}.`,
    ], { fullPage: entry.suffix !== 'mobile' });
  }

  await page.setViewport(originalViewport || desktopViewport);
  await sleep(600);
  await openLiveClassDetail(page, classTitle, classId);
  await waitForSelector(page, '[data-testid="live-class-detail-page"]', 15000);
};

const waitForRoomMediaState = async (page: puppeteer.Page, timeout = 45000) => {
  await page.waitForFunction(
    () => {
      const root = document.querySelector('[data-testid="live-runtime-page"]');
      if (!root) {
        return false;
      }
      return root.getAttribute('data-room-loaded') === 'true';
    },
    { timeout },
  );
};

const waitForParticipantState = async (
  page: puppeteer.Page,
  userId: string,
  attribute: string,
  value: string,
  timeout = 30000,
) => {
  await page.waitForFunction(
    ({ targetUserId, targetAttribute, expectedValue }) => {
      const node = document.querySelector(`[data-testid="live-participant-${targetUserId}"]`);
      return node?.getAttribute(targetAttribute) === expectedValue;
    },
    { timeout },
    { targetUserId: userId, targetAttribute: attribute, expectedValue: value },
  );
};

const waitForSelfState = async (
  page: puppeteer.Page,
  attribute: string,
  value: string,
  timeout = 30000,
) => {
  await page.waitForFunction(
    ({ targetAttribute, expectedValue }) =>
      document.querySelector('[data-testid="live-runtime-page"]')?.getAttribute(targetAttribute) === expectedValue,
    { timeout },
    { targetAttribute: attribute, expectedValue: value },
  );
};

const postChat = async (page: puppeteer.Page, message: string) => {
  await type(page, '[data-testid="live-chat-input"]', message);
  await click(page, '[data-testid="live-chat-send"]');
};

const waitForChatMessage = async (page: puppeteer.Page, message: string, timeout = 30000) => {
  await page.waitForFunction(
    (expected) => Array.from(document.querySelectorAll('[data-testid^="live-chat-message-"]')).some((node) => (node.textContent || '').includes(String(expected))),
    { timeout },
    message,
  );
};

const getCurrentUserId = async (page: puppeteer.Page) => {
  const token = await page.evaluate(() => window.localStorage.getItem('edumaster.jwt') || '');
  const payloadPart = token.split('.')[1];
  if (!payloadPart) {
    throw new Error('Unable to read auth token payload.');
  }
  const json = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as { id?: string };
  if (!json.id) {
    throw new Error('Auth token payload is missing user id.');
  }
  return json.id;
};

const postLiveClassStartFromPage = async (page: puppeteer.Page, liveClassId: string) => {
  const result = await page.evaluate(async ({ targetId, origin }) => {
    const token = window.localStorage.getItem('edumaster.jwt') || '';
    const response = await fetch(`${origin}/backend/api/live-classes/${targetId}/start`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
    });
    const payload = await response.json().catch(() => ({}));
    return {
      ok: response.ok,
      status: response.status,
      message: payload?.error || payload?.message || '',
    };
  }, { targetId: liveClassId, origin: apiOrigin });

  if (!result.ok) {
    throw new Error(`Unable to start live class through API (${result.status}): ${result.message}`);
  }
};

const waitForLiveBadge = async (page: puppeteer.Page, title: string) => {
  await page.waitForFunction(
    (expected) => Array.from(document.querySelectorAll('[data-testid^="live-card-"]')).some((node) => {
      const text = (node.textContent || '').toLowerCase();
      return text.includes(String(expected).toLowerCase()) && text.includes('live');
    }),
    { timeout: 30000 },
    title,
  );
};

export const runLiveReview = async () => {
  const ctx = await createRunContext();
  const captures: CaptureRecord[] = [];
  const failures: FailureRecord[] = [];
  const consoleIssues: string[] = [];
  const classTitle = `QA Live Automation ${timestampSuffix()}`;

  const browser = await puppeteer.launch({
    executablePath: chromeExecutable,
    userDataDir: chromeUserDataDir,
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
      '--allow-http-screen-capture',
      '--enable-usermedia-screen-capturing',
      '--auto-select-desktop-capture-source=Entire screen',
    ],
  });

  try {
    const adminContext = await browser.createBrowserContext();
    const studentContext = await browser.createBrowserContext();
    const adminPage = await adminContext.newPage();
    const studentPage = await studentContext.newPage();
    await adminPage.setViewport(desktopViewport);
    await studentPage.setViewport(mobileViewport);

    [adminPage, studentPage].forEach((page, index) => {
      const label = index === 0 ? 'admin' : 'student';
      page.on('console', (message) => {
        if (
          message.type() === 'error'
          && !message.text().includes('401')
          && !message.text().includes('status of 409 (Conflict)')
        ) {
          consoleIssues.push(`[${label}] ${message.text()}`);
        }
      });
      page.on('pageerror', (error) => {
        consoleIssues.push(`[${label}] ${error.message}`);
      });
    });

    console.log('Step 1: login admin');
    await loginThroughUi(adminPage, adminEmail, adminPassword, 'admin');
    await recordCapture(adminPage, ctx, captures, 'login-admin', 'login-admin', ['Admin login completed.']);

    console.log('Step 2: open live tab');
    await openLiveTab(adminPage);
    console.log('Step 3: create live class');
    await captureMobileCreateFlow(adminPage, ctx, captures, classTitle);
    const createdLiveClassId = await createLiveClass(adminPage, classTitle);
    const onDetailPageAfterCreate = await adminPage.evaluate(() =>
      Boolean(document.querySelector('[data-testid="live-class-detail-page"]')),
    ).catch(() => false);
    if (!onDetailPageAfterCreate) {
      await ensureLiveListPage(adminPage);
      await pageWaitForLiveClassText(adminPage, classTitle, 60000);
    }
    await recordCapture(adminPage, ctx, captures, 'class-created', 'class-created', ['Live class created from admin flow.']);
    try {
      await captureResponsiveScreens(adminPage, ctx, captures, 'live-list', 'live-list');
    } catch (error) {
      consoleIssues.push(`responsive-live-list-capture: ${error instanceof Error ? error.message : String(error)}`);
      await ensureLiveSurface(adminPage);
    }

    console.log('Step 4: login student');
    await loginThroughUi(studentPage, studentEmail, studentPassword, 'student');
    await recordCapture(studentPage, ctx, captures, 'student-login', 'student-login', ['Student login completed.']);

    console.log('Step 5: student open live list and detail');
    await openLiveTab(studentPage);
    await recordCapture(studentPage, ctx, captures, 'student-live-list-mobile', 'student-live-list-mobile', [
      'Student mobile live list before opening the selected class.',
    ], { fullPage: false });
    try {
      await waitForLiveBadge(studentPage, classTitle);
    } catch (error) {
      consoleIssues.push(`student-live-badge-delay: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      await clickVisibleMatchingSelector(studentPage, '[data-testid="live-featured-card"]');
      await waitForSelector(studentPage, '[data-testid="live-class-detail-page"]', 15000);
    } catch {
      await openLiveClassDetail(studentPage, classTitle);
    }
    await recordCapture(studentPage, ctx, captures, 'student-live-detail-mobile', 'student-live-detail-mobile', [
      'Student mobile live class detail before joining the room.',
    ], { fullPage: false });

    console.log('Step 6: open detail and start class');
    await openLiveClassDetail(adminPage, classTitle, createdLiveClassId || undefined);
    try {
      await captureResponsiveDetailScreens(adminPage, ctx, captures, 'live-detail', classTitle, createdLiveClassId || undefined);
    } catch (error) {
      consoleIssues.push(`responsive-live-detail-capture: ${error instanceof Error ? error.message : String(error)}`);
      await ensureLiveSurface(adminPage);
      await openLiveClassDetail(adminPage, classTitle, createdLiveClassId || undefined);
    }
    await adminPage.setViewport(desktopViewport);
    await sleep(700);
    await openLiveClassDetail(adminPage, classTitle, createdLiveClassId || undefined);
    await clickVisibleMatchingSelector(adminPage, '[data-testid="live-admin-start"]');
    try {
      await adminPage.waitForFunction(
        () => {
          if (document.querySelector('[data-testid="live-runtime-page"]')) {
            return 'runtime';
          }
          const joinButton = document.querySelector('[data-testid="live-details-join-button"]') as HTMLButtonElement | null;
          return joinButton && !joinButton.disabled ? 'join' : false;
        },
        { timeout: 45000 },
      );
    } catch (error) {
      const shot = await recordCapture(adminPage, ctx, captures, 'admin-start-transition-timeout', 'admin-start-transition-timeout', [
        error instanceof Error ? error.message : String(error),
      ]);
      consoleIssues.push(`admin-start-transition-timeout: ${shot}`);
      if (createdLiveClassId) {
        await postLiveClassStartFromPage(adminPage, createdLiveClassId);
        await adminPage.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
        await openLiveClassDetail(adminPage, classTitle, createdLiveClassId);
        await waitForEnabledSelector(adminPage, '[data-testid="live-details-join-button"]', 45000);
      } else {
        throw error;
      }
    }
    const shouldClickJoin = await adminPage.evaluate(() => {
      if (document.querySelector('[data-testid="live-runtime-page"]')) {
        return false;
      }
      const joinButton = document.querySelector('[data-testid="live-details-join-button"]') as HTMLButtonElement | null;
      return Boolean(joinButton && !joinButton.disabled);
    });
    if (shouldClickJoin) {
      await clickVisibleMatchingSelector(adminPage, '[data-testid="live-details-join-button"]');
    }
    await waitForRoomLoaded(adminPage);
    try {
      await waitForLiveMedia(adminPage);
    } catch (error) {
      const debug = await getLiveRuntimeDebug(adminPage);
      const shot = await recordCapture(adminPage, ctx, captures, 'admin-live-media-timeout', 'admin-live-media-timeout', [
        `debug=${JSON.stringify(debug)}`,
      ]);
      fail(failures, 'admin-live-media-timeout', 'Admin room loaded without active live media', JSON.stringify(debug, null, 2), shot);
      throw error;
    }
    await waitForRoomMediaState(adminPage);
    await recordCapture(adminPage, ctx, captures, 'class-started', 'class-started', ['Admin started the class and the room loaded.']);
    await recordCapture(adminPage, ctx, captures, 'admin-in-room', 'admin-in-room', ['Admin is inside the live classroom.']);

    const adminRoomName = await getRoomName(adminPage);
    const adminUserId = await getCurrentUserId(adminPage);

    console.log('Step 7: student open live and join');
    await openLiveTab(studentPage);
    try {
      await waitForLiveBadge(studentPage, classTitle);
    } catch (error) {
      consoleIssues.push(`student-live-badge-delay: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      await clickVisibleMatchingSelector(studentPage, '[data-testid="live-featured-card"]');
      await waitForSelector(studentPage, '[data-testid="live-class-detail-page"]', 15000);
    } catch {
      await openLiveClassDetail(studentPage, classTitle);
    }
    await waitForEnabledSelector(studentPage, '[data-testid="live-details-join-button"]', 45000);
    await clickVisibleMatchingSelector(studentPage, '[data-testid="live-details-join-button"]');
    try {
      await waitForRoomLoaded(studentPage);
    } catch (error) {
      const shot = await recordCapture(studentPage, ctx, captures, 'student-room-load-timeout', 'student-room-load-timeout');
      const bodyText = await studentPage.evaluate(() => (document.body?.innerText || '').slice(0, 1200)).catch(() => '');
      fail(failures, 'student-room-load-timeout', 'Student did not transition into the live room', bodyText, shot);
      throw error;
    }
    try {
      await waitForLiveMedia(studentPage);
    } catch (error) {
      const debug = await getLiveRuntimeDebug(studentPage);
      const shot = await recordCapture(studentPage, ctx, captures, 'student-live-media-timeout', 'student-live-media-timeout', [
        `debug=${JSON.stringify(debug)}`,
      ]);
      fail(failures, 'student-live-media-timeout', 'Student room loaded without active live media', JSON.stringify(debug, null, 2), shot);
      throw error;
    }
    await waitForRoomMediaState(studentPage);
    await recordCapture(studentPage, ctx, captures, 'student-join', 'student-join', ['Student joined the live classroom.']);

    const studentRoomName = await getRoomName(studentPage);
    if (!adminRoomName || adminRoomName !== studentRoomName) {
      const shot = await recordCapture(studentPage, ctx, captures, 'student-room-mismatch', 'student-room-mismatch');
      fail(failures, 'student-room-mismatch', 'Admin and student are not in the same live room', `Admin room: ${adminRoomName || 'missing'}, student room: ${studentRoomName || 'missing'}`, shot);
    }

    await recordCapture(adminPage, ctx, captures, 'both-inside-room-admin', 'both-inside-room-admin', ['Admin side of shared classroom.']);
    await recordCapture(studentPage, ctx, captures, 'both-inside-room-student', 'both-inside-room-student', ['Student side of shared classroom.']);

    const studentUserId = await getCurrentUserId(studentPage);

    console.log('Step 8: chat sync');
    await postChat(adminPage, 'Admin says hello from automation');
    await waitForChatMessage(studentPage, 'Admin says hello from automation');
    await postChat(studentPage, 'Student reply from automation');
    await waitForChatMessage(adminPage, 'Student reply from automation');
    await recordCapture(adminPage, ctx, captures, 'chat-interaction-admin', 'chat-interaction-admin', ['Admin view after real-time chat sync.']);
    await recordCapture(studentPage, ctx, captures, 'chat-interaction-student', 'chat-interaction-student', ['Student view after real-time chat sync.']);

    console.log('Step 9: raise hand reject approve');
    await click(studentPage, '[data-testid="live-raise-hand"]');
    await waitForParticipantState(adminPage, studentUserId, 'data-hand-status', 'pending');
    await recordCapture(adminPage, ctx, captures, 'raise-hand-flow-admin', 'raise-hand-flow-admin', ['Admin sees student raised hand.']);
    await recordCapture(studentPage, ctx, captures, 'raise-hand-flow-student', 'raise-hand-flow-student', ['Student raised hand state.']);

    await click(adminPage, `[data-testid="live-admin-reject-${studentUserId}"]`);
    await waitForSelfState(studentPage, 'data-self-hand-status', 'rejected');
    await recordCapture(adminPage, ctx, captures, 'admin-reject', 'admin-reject', ['Admin rejected raised hand.']);

    await click(studentPage, '[data-testid="live-raise-hand"]');
    await waitForParticipantState(adminPage, studentUserId, 'data-hand-status', 'pending');
    await click(adminPage, `[data-testid="live-admin-approve-${studentUserId}"]`);
    await waitForParticipantState(adminPage, studentUserId, 'data-can-speak', 'true');
    await waitForSelfState(studentPage, 'data-self-can-speak', 'true');
    await recordCapture(adminPage, ctx, captures, 'admin-approve', 'admin-approve', ['Admin approved student to speak.']);

    console.log('Step 10: mute and unmute');
    await click(adminPage, `[data-testid="live-admin-toggle-mute-${studentUserId}"]`);
    await waitForSelfState(studentPage, 'data-self-mic-muted', 'false');
    await recordCapture(adminPage, ctx, captures, 'admin-unmute', 'admin-unmute', ['Admin unmuted student.']);

    await click(adminPage, `[data-testid="live-admin-toggle-mute-${studentUserId}"]`);
    await waitForSelfState(studentPage, 'data-self-mic-muted', 'true');
    await recordCapture(adminPage, ctx, captures, 'admin-mute', 'admin-mute', ['Admin muted student again.']);

    console.log('Step 11: screen share');
    await click(adminPage, '[data-testid="live-toggle-screen-share"]');
    await waitForSelfState(adminPage, 'data-screen-sharing', 'true', 45000);
    await waitForParticipantState(studentPage, adminUserId, 'data-screen-sharing', 'true', 45000);
    await recordCapture(adminPage, ctx, captures, 'screen-share-admin', 'screen-share-admin', ['Admin started screen sharing.']);
    await recordCapture(studentPage, ctx, captures, 'screen-share-student', 'screen-share-student', ['Student sees admin screen-sharing state.']);

    console.log('Step 12: remove student');
    await click(adminPage, `[data-testid="live-admin-remove-${studentUserId}"]`);
    await waitForSelector(studentPage, '[data-testid="live-class-detail-page"]', 30000);
    await recordCapture(adminPage, ctx, captures, 'admin-remove-student', 'admin-remove-student', ['Admin removed student from room.']);
    await recordCapture(studentPage, ctx, captures, 'student-removed', 'student-removed', ['Student was returned out of the room after removal.']);

    console.log('Step 13: end class');
    await click(adminPage, '[data-testid="live-admin-end"]');
    await waitForSelector(adminPage, '[data-testid="live-class-detail-page"]', 30000);
    await waitForFunctionOnPageText(adminPage, 'ended');
    await recordCapture(adminPage, ctx, captures, 'class-end', 'class-end', ['Admin ended the live class.']);

    if (consoleIssues.length > 0) {
      fail(
        failures,
        'console-errors',
        'Console errors detected during live automation',
        consoleIssues.join('\n'),
        captures[captures.length - 1]?.screenshotPath,
      );
    }

    await writeJson(path.join(ctx.analysisDir, 'summary.json'), { captures, failures });
    await writeText(
      path.join(ctx.logDir, 'run.log'),
      `Run ${ctx.runId}\nClass title: ${classTitle}\nCaptures: ${captures.length}\nFailures: ${failures.length}\n`,
    );

    if (failures.length > 0) {
      throw new Error(failures.map((item) => `${item.title}: ${item.description}`).join('\n'));
    }

    return { captures, failures, ctx };
  } catch (error) {
    await Promise.allSettled([
      writeJson(path.join(ctx.analysisDir, 'summary.json'), { captures, failures, error: error instanceof Error ? error.message : String(error) }),
      writeText(path.join(ctx.logDir, 'run.log'), `Run ${ctx.runId}\nClass title: ${classTitle}\nCaptures: ${captures.length}\nFailures: ${failures.length}\nError: ${error instanceof Error ? error.stack || error.message : String(error)}\n`),
    ]);
    throw error;
  } finally {
    await browser.close();
  }
};

const waitForFunctionOnPageText = async (page: puppeteer.Page, text: string, timeout = 30000) => {
  await page.waitForFunction(
    (expected) => (document.body?.innerText || '').toLowerCase().includes(String(expected).toLowerCase()),
    { timeout },
    text,
  );
};

const pageWaitForLiveClassText = async (page: puppeteer.Page, text: string, timeout = 30000) => {
  const waitForCardText = async (remainingTimeout: number) => {
    await page.waitForFunction(
      (expected) => Array.from(document.querySelectorAll('[data-testid="live-featured-card"], [data-testid^="live-card-"]'))
        .some((node) => (node.textContent || '').includes(String(expected))),
      { timeout: remainingTimeout },
      text,
    );
  };

  try {
    await waitForCardText(Math.min(timeout, 10000));
    return;
  } catch {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await ensureLiveListPage(page);
    await waitForCardText(Math.max(timeout - 10000, 10000));
  }
};

if (import.meta.url === `file://${process.argv[1]}`) {
  runLiveReview()
    .then(async ({ ctx, failures }) => {
      console.log(`Live review complete: ${ctx.rootDir}`);
      if (failures.length === 0) {
        console.log('All live automation checks passed.');
      }
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
