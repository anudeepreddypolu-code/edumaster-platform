import fs from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { config } from './config.js';
import { selectors } from './selectors.js';
import { CaptureRecord, FailureRecord, StepDefinition } from './types.js';
import { artifactPath, createRunContext, writeJson, writeText } from './utils.js';

const apiOrigin = (() => {
  const url = new URL(config.baseUrl);
  if (url.hostname === '10.0.2.2') {
    url.hostname = '127.0.0.1';
  }
  return url.origin;
})();

const step: StepDefinition = {
  id: 'overview-dashboard',
  label: 'overview-dashboard',
  requiredSelectors: [
    selectors.overviewDashboard,
    selectors.overviewTopbar,
    selectors.overviewHero,
    selectors.overviewActionQueue,
    selectors.overviewActiveCourses,
    selectors.overviewSignals,
    selectors.overviewStreak,
    selectors.overviewRecommendation,
    selectors.overviewScoreSummary,
    selectors.overviewScoreCard,
    selectors.overviewUpcomingClasses,
    selectors.overviewUpcomingTests,
  ],
  expectedTexts: [
    'Welcome back',
    'Continue Learning',
    'Active Courses',
    'Performance Overview',
    'Keep the Streak On',
    "Today's Schedule",
    'Upcoming Tests',
    'Your Progress',
    'Stay Consistent',
    'Quick Revision',
    'Recommended Track',
    'Circuits & Network Reduction',
    'Network Theory',
    'General Awareness',
  ],
};

const loginAndSeedStorage = async (page: puppeteer.Page, email: string, password: string) => {
  const response = await fetch(new URL('/backend/api/auth/login', apiOrigin), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      device: 'QA Overview Review',
      forceLogoutOtherSessions: true,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.token) {
    throw new Error(payload?.error || payload?.message || 'Unable to login for overview review');
  }

  await page.evaluate((token) => {
    window.localStorage.setItem('edumaster.jwt', token);
  }, payload.token as string);
};

const takeScreenshot = async (page: puppeteer.Page, ctx: Awaited<ReturnType<typeof createRunContext>>, label: string) => {
  const screenshotPath = artifactPath(ctx.screenshotDir, step.id, label, 'png');
  const sourcePath = artifactPath(ctx.sourceDir, step.id, label, 'html');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await fs.writeFile(sourcePath, await page.content(), 'utf8');
  return { screenshotPath, sourcePath };
};

const clickFirstVisible = async (page: puppeteer.Page, selectorOptions: string[]) => {
  for (const selector of selectorOptions) {
    const element = await page.$(selector);
    if (!element) {
      continue;
    }

    try {
      await element.click();
      return selector;
    } catch {
      const clicked = await page.evaluate((targetSelector) => {
        const target = document.querySelector(targetSelector) as HTMLElement | null;
        if (!target) {
          return false;
        }

        target.scrollIntoView({ block: 'center', inline: 'nearest' });
        target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        return true;
      }, selector);

      if (clicked) {
        return selector;
      }
    }
  }

  throw new Error(`No interactable selector found from: ${selectorOptions.join(', ')}`);
};

const waitForOverviewAppReady = async (page: puppeteer.Page) => {
  await page.waitForFunction(
    (selectorMap) => Boolean(
      document.querySelector(selectorMap.shellReady)
      || document.querySelector(selectorMap.overviewDashboard)
      || document.querySelector(selectorMap.navOverview)
      || document.querySelector(selectorMap.mobileNavOverview),
    ),
    { timeout: 30000 },
    {
      shellReady: selectors.shellReady,
      overviewDashboard: selectors.overviewDashboard,
      navOverview: selectors.navOverview,
      mobileNavOverview: selectors.mobileNavOverview,
    },
  );
};

export const runOverviewReview = async (): Promise<{ captures: CaptureRecord[]; failures: FailureRecord[] }> => {
  const ctx = await createRunContext();
  const captures: CaptureRecord[] = [];
  const failures: FailureRecord[] = [];

  const browser = await puppeteer.launch({
    executablePath: process.env.QA_CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
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
    await page.goto(config.baseUrl, { waitUntil: 'domcontentloaded' });

    const email = process.env.QA_LOGIN_EMAIL || config.loginEmail;
    const password = process.env.QA_LOGIN_PASSWORD || config.loginPassword;
    await loginAndSeedStorage(page, email, password);
    await page.reload({ waitUntil: 'networkidle2' });
    await waitForOverviewAppReady(page);

    const variants = [
      {
        label: 'overview-dashboard-desktop',
        viewport: { width: 1536, height: 1024, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
        extraSelectors: [] as string[],
      },
      {
        label: 'overview-dashboard-mobile',
        viewport: { width: 430, height: 932, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
        extraSelectors: [
          selectors.mobileNavOverview,
          selectors.mobileNavCourses,
          selectors.mobileNavLive,
          selectors.mobileNavTests,
        ] as string[],
      },
    ] as const;

    for (const variant of variants) {
      await page.setViewport(variant.viewport);
      await page.goto(config.baseUrl, { waitUntil: 'networkidle2' });
      await waitForOverviewAppReady(page);
      if (!await page.$(selectors.overviewDashboard)) {
        await clickFirstVisible(
          page,
          variant.label.endsWith('mobile')
            ? [selectors.mobileNavOverview, selectors.mobileTabOverview, selectors.navOverview]
            : [selectors.navOverview, selectors.mobileNavOverview],
        );
      }
      await page.waitForSelector(selectors.overviewDashboard, { timeout: 30000 });
      await page.evaluate(() => window.scrollTo(0, 0));

      const { screenshotPath, sourcePath } = await takeScreenshot(page, ctx, variant.label);
      const pageText = await page.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' ').trim());
      const now = new Date().toISOString();

      captures.push({
        stepId: step.id,
        label: variant.label,
        state: 'ui',
        durationMs: 0,
        screenshotPath,
        sourcePath,
        timestamp: now,
      });

      for (const selector of [...(step.requiredSelectors || []), ...variant.extraSelectors]) {
        const element = await page.$(selector);
        if (!element) {
          failures.push({
            stepId: step.id,
            title: 'Missing required UI element',
            description: `Required selector not found: ${selector}`,
            severity: 'high',
            timestamp: now,
            screenshotPath,
          });
        }
      }

      for (const text of step.expectedTexts || []) {
        if (!pageText.includes(text)) {
          failures.push({
            stepId: step.id,
            title: 'Expected content missing',
            description: `Expected text was not found on the page: "${text}"`,
            severity: 'medium',
            timestamp: now,
            screenshotPath,
          });
        }
      }

      const activeCourseCount = await page.$$eval('[data-testid^="overview-active-course-card-"]', (items) => items.length);
      if (activeCourseCount < 1) {
        failures.push({
          stepId: step.id,
          title: 'Missing active course cards',
          description: 'Overview dashboard should surface at least one active course card.',
          severity: 'high',
          timestamp: now,
          screenshotPath,
        });
      }
    }

    await writeJson(path.join(ctx.analysisDir, 'summary.json'), { captures, failures });
    await writeText(
      path.join(ctx.logDir, 'run.log'),
      `Run ${ctx.runId}\nCaptures: ${captures.length}\nFailures: ${failures.length}\nScreenshot: ${captures[captures.length - 1]?.screenshotPath || 'n/a'}\n`,
    );

    if (failures.length > 0) {
      throw new Error(failures.map((failure) => `${failure.title}: ${failure.description}`).join('\n'));
    }

    return { captures, failures };
  } finally {
    await browser.close().catch(() => undefined);
  }
};

if (process.argv[1]?.endsWith('overview-figma-review.ts')) {
  runOverviewReview()
    .then((summary) => {
      console.log(`Overview review complete: ${summary.captures.length} captures, ${summary.failures.length} failures.`);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
