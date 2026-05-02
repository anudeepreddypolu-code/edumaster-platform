import path from 'node:path';
import { remote } from 'webdriverio';
import { config } from './config.js';
import { captureStep } from './screenshot-manager.js';
import { selectors } from './selectors.js';
import { CaptureRecord, FailureRecord } from './types.js';
import { createRunContext, sleep, writeJson, writeText } from './utils.js';

const apiOrigin = (() => {
  const url = new URL(config.baseUrl);
  if (url.hostname === '10.0.2.2') {
    url.hostname = '127.0.0.1';
  }
  return url.origin;
})();

const postAuthJson = async (pathname: string, body: Record<string, unknown>) => {
  const response = await fetch(new URL(`/backend/api${pathname}`, apiOrigin), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  return {
    ok: response.ok,
    payload: await response.json().catch(() => ({})),
  };
};

const ensureAuthenticatedShell = async (driver: WebdriverIO.Browser, email: string, password: string) => {
  const shell = await driver.$(selectors.shellReady);
  if (await shell.isExisting()) {
    return;
  }

  const response = await postAuthJson('/auth/login', {
    email,
    password,
    device: 'QA Courses Regression',
    forceLogoutOtherSessions: true,
  });

  if (!response.ok || !response.payload?.token) {
    throw new Error(response.payload?.error || response.payload?.message || 'Unable to bootstrap authenticated shell');
  }

  await driver.execute((token) => {
    window.localStorage.setItem('edumaster.jwt', token);
  }, response.payload.token as string);
  await driver.refresh();
  await sleep(1500);
  await (await driver.$(selectors.shellReady)).waitForExist({ timeout: 30000 });
};

const clickFirstVisible = async (driver: WebdriverIO.Browser, selectorOptions: string[]) => {
  for (const selector of selectorOptions) {
    const element = await driver.$(selector);
    if (!(await element.isExisting())) {
      continue;
    }

    try {
      if (await element.isDisplayed()) {
        await driver.execute((targetSelector) => {
          const target = document.querySelector(targetSelector) as HTMLElement | null;
          if (!target) return;
          target.scrollIntoView({ block: 'center', inline: 'nearest' });
          window.scrollBy({ top: -96, behavior: 'auto' });
        }, selector);
        await sleep(250);
        await element.click();
        return;
      }
    } catch {
      continue;
    }
  }

  throw new Error(`No interactable selector found from: ${selectorOptions.join(', ')}`);
};

const collectCourseCards = async (driver: WebdriverIO.Browser) => driver.execute(() => {
  return Array.from(document.querySelectorAll('[data-testid^="course-card-"]')).map((element) => ({
    testId: (element as HTMLElement).dataset.testid || element.getAttribute('data-testid') || '',
    text: (element.textContent || '').replace(/\s+/g, ' ').trim(),
  }));
});

const returnToCourseListIfWorkspaceOpened = async (driver: WebdriverIO.Browser) => {
  const inWorkspace = await driver.execute(() => {
    return Array.from(document.querySelectorAll('button')).some((element) =>
      /back to courses/i.test((element.textContent || '').trim()));
  });

  if (!inWorkspace) {
    return false;
  }

  await driver.execute(() => {
    const target = Array.from(document.querySelectorAll('button')).find((element) =>
      /back to courses/i.test((element.textContent || '').trim())) as HTMLElement | undefined;
    if (!target) {
      return;
    }
    target.scrollIntoView({ block: 'center', inline: 'nearest' });
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  const started = Date.now();
  while (Date.now() - started < 5000) {
    const state = await driver.execute(() => {
      const hasBackButton = Array.from(document.querySelectorAll('button')).some((element) =>
        /back to courses/i.test((element.textContent || '').trim()));
      const courseCardCount = document.querySelectorAll('[data-testid^="course-card-"]').length;
      return { hasBackButton, courseCardCount };
    });

    if (!state.hasBackButton || state.courseCardCount > 0) {
      break;
    }

    await sleep(250);
  }

  return true;
};

const waitForPlayerContent = async (driver: WebdriverIO.Browser, timeoutMs = 20000) => {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const state = await driver.execute(() => {
      const shell = document.querySelector('[data-testid="course-player-shell"]');
      const hasVideo = Boolean(shell?.querySelector('video'));
      const hasIframe = Boolean(shell?.querySelector('iframe'));
      const shellText = (shell?.textContent || '').replace(/\s+/g, ' ').trim();
      const hasFailureCopy = /video will appear here|protected lesson unavailable|lesson locked/i.test(shellText);
      return {
        hasShell: Boolean(shell),
        hasVideo,
        hasIframe,
        shellText,
        hasFailureCopy,
      };
    });

    if (state.hasShell && (state.hasVideo || state.hasIframe)) {
      return state;
    }

    if (state.hasFailureCopy) {
      return state;
    }

    await sleep(500);
  }

  return driver.execute(() => {
    const shell = document.querySelector('[data-testid="course-player-shell"]');
    return {
      hasShell: Boolean(shell),
      hasVideo: Boolean(shell?.querySelector('video')),
      hasIframe: Boolean(shell?.querySelector('iframe')),
      shellText: (shell?.textContent || '').replace(/\s+/g, ' ').trim(),
      hasFailureCopy: /video will appear here|protected lesson unavailable|lesson locked/i.test((shell?.textContent || '')),
    };
  });
};

const run = async () => {
  const ctx = await createRunContext();
  const captures: CaptureRecord[] = [];
  const failures: FailureRecord[] = [];

  const driver = await remote({
    hostname: config.appiumHost,
    port: config.appiumPort,
    path: '/',
    capabilities: {
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
      'appium:deviceName': config.androidDeviceName,
      browserName: config.browserName,
      'appium:newCommandTimeout': 180,
      'appium:adbExecTimeout': 120000,
      'appium:uiautomator2ServerLaunchTimeout': 120000,
      'appium:disableWindowAnimation': true,
      'appium:skipLogcatCapture': true,
      'wdio:enforceWebDriverClassic': true,
    },
    logLevel: 'error',
  });

  try {
    await driver.url(config.baseUrl);
    await sleep(2500);
    captures.push(await captureStep(driver, ctx, {
      stepId: 'courses-launch',
      label: 'courses-launch',
      state: 'loading',
      durationMs: 2500,
    }));

    await ensureAuthenticatedShell(driver, config.loginEmail, config.loginPassword);
    await sleep(1200);
    await clickFirstVisible(driver, [selectors.mobileTabCourses, selectors.mobileNavCourses, selectors.navCourses]);
    await sleep(1500);
    const startedInWorkspace = await returnToCourseListIfWorkspaceOpened(driver);
    await sleep(800);

    captures.push(await captureStep(driver, ctx, {
      stepId: 'courses-list',
      label: 'courses-list',
      state: 'ui',
      durationMs: 0,
      notes: startedInWorkspace ? ['Courses opened directly into a workspace before returning to the course list.'] : undefined,
    }));

    const courseCards = await collectCourseCards(driver);
    if (courseCards.length < 2) {
      failures.push({
        stepId: 'courses-list',
        title: 'Insufficient enrolled courses for regression',
        description: `Expected at least 2 course cards in Courses, but found ${courseCards.length}.`,
        severity: 'critical',
        timestamp: new Date().toISOString(),
        screenshotPath: captures[captures.length - 1]?.screenshotPath,
      });
      throw new Error('Not enough course cards available to verify multi-course playback regression.');
    }

    const secondCourse = courseCards[1];
    await clickFirstVisible(driver, [`[data-testid="${secondCourse.testId}"]`]);
    await sleep(1200);
    await clickFirstVisible(driver, [selectors.courseWorkspaceSubjects]);
    await sleep(1000);
    await clickFirstVisible(driver, [selectors.firstCourseTopic, selectors.firstCourseLessonRail]);
    await sleep(1500);

    const playerState = await waitForPlayerContent(driver);
    captures.push(await captureStep(driver, ctx, {
      stepId: 'courses-player',
      label: 'courses-player',
      state: playerState.hasVideo || playerState.hasIframe ? 'success' : 'error',
      durationMs: 0,
      notes: [
        `Selected course card: ${secondCourse.testId}`,
        `Player shell text: ${playerState.shellText || '(empty)'}`,
      ],
    }));

    const playerCourseTitle = await driver.execute(() => {
      const element = document.querySelector('[data-testid="course-player-course-title"]');
      return (element?.textContent || '').trim();
    });

    if (!playerState.hasVideo && !playerState.hasIframe) {
      failures.push({
        stepId: 'courses-player',
        title: 'Course player did not load media',
        description: `No video or iframe was rendered after opening the lesson from Courses. Shell text: ${playerState.shellText || '(empty)'}`,
        severity: 'critical',
        timestamp: new Date().toISOString(),
        screenshotPath: captures[captures.length - 1]?.screenshotPath,
      });
    }

    if (!playerCourseTitle) {
      failures.push({
        stepId: 'courses-player',
        title: 'Selected course context missing in player',
        description: 'The player did not expose the active course title after switching courses.',
        severity: 'high',
        timestamp: new Date().toISOString(),
        screenshotPath: captures[captures.length - 1]?.screenshotPath,
      });
    }

    const summary = {
      captures,
      failures,
      meta: {
        selectedCourseCard: secondCourse,
        playerCourseTitle,
        playerState,
      },
    };

    await writeJson(path.join(ctx.analysisDir, 'summary.json'), summary);
    await writeText(
      path.join(ctx.analysisDir, 'courses-regression.md'),
      [
        '# Courses Regression',
        '',
        `- Selected second course card: ${secondCourse.testId}`,
        `- Player course title: ${playerCourseTitle || '(missing)'}`,
        `- Media rendered: ${playerState.hasVideo || playerState.hasIframe ? 'yes' : 'no'}`,
        `- Player text: ${playerState.shellText || '(empty)'}`,
        `- Failures: ${failures.length}`,
      ].join('\n'),
    );

    if (failures.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await driver.deleteSession().catch(() => undefined);
  }
};

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
