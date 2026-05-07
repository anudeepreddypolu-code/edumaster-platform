import path from 'node:path';
import { remote } from 'webdriverio';
import { config } from './config.js';
import { detectFailuresForStep } from './failure-detector.js';
import { writeFlutterFile } from './flutter-generator.js';
import { captureStep } from './screenshot-manager.js';
import { selectors } from './selectors.js';
import { AuditSummary, CaptureRecord, FailureRecord, StepDefinition } from './types.js';
import { analyzeUx, findingsToMarkdown } from './ux-analyzer.js';
import { createRunContext, sleep, writeJson, writeText } from './utils.js';

const steps: StepDefinition[] = [
  { id: 'launch', label: 'App launch', expectedTexts: ['VARONENGLISH'] },
  { id: 'login-error', label: 'Invalid login error state', expectedTexts: [] },
  { id: 'login-success', label: 'Login success', requiredSelectors: [selectors.navOverview, selectors.navCourses], expectedTexts: ['prep operating system'] },
  { id: 'dashboard', label: 'Dashboard success', requiredSelectors: [selectors.navOverview], expectedTexts: ['Continue learning'] },
  { id: 'courses', label: 'Courses screen', requiredSelectors: [selectors.navCourses], expectedTexts: ['course'] },
  { id: 'tests', label: 'Mock tests screen', requiredSelectors: [selectors.navTests], expectedTexts: ['mock'] },
  { id: 'live', label: 'Live classes screen', requiredSelectors: [selectors.navLive], expectedTexts: ['Live classes'] },
  { id: 'revision', label: 'Revision screen', requiredSelectors: [selectors.navRevision], expectedTexts: ['revision'] },
];

const stateForLabel = (label: string) => {
  if (/error/i.test(label)) return 'error' as const;
  if (/launch/i.test(label)) return 'loading' as const;
  if (/success|dashboard|screen|area/i.test(label)) return 'ui' as const;
  return 'success' as const;
};

const clickFirstVisible = async (driver: WebdriverIO.Browser, selectorOptions: string[]) => {
  for (const selector of selectorOptions) {
    const element = await driver.$(selector);
    if (await element.isExisting()) {
      try {
        if (await element.isDisplayed()) {
          await driver.execute((fallbackSelector) => {
            const target = document.querySelector(fallbackSelector) as HTMLElement | null;
            if (!target) return;
            target.scrollIntoView({ block: 'center', inline: 'nearest' });
            window.scrollBy({ top: -96, behavior: 'auto' });
          }, selector);
          await sleep(250);
          try {
            await element.click();
          } catch {
            await driver.execute((fallbackSelector) => {
              const target = document.querySelector(fallbackSelector) as HTMLElement | null;
              if (!target) return;
              target.scrollIntoView({ block: 'center', inline: 'nearest' });
              window.scrollBy({ top: -96, behavior: 'auto' });
              target?.click();
            }, selector);
          }
          return;
        }
      } catch {
        continue;
      }
    }
  }

  throw new Error(`No interactable selector found from: ${selectorOptions.join(', ')}`);
};

const clearAndType = async (driver: WebdriverIO.Browser, selector: string, value: string) => {
  const element = await driver.$(selector);
  await element.waitForDisplayed({ timeout: 10000 });
  await element.click();
  try {
    await element.clearValue();
  } catch {
    // Ignore if the driver/browser does not support clearValue reliably.
  }
  await element.setValue(value);
};

type QaCredentials = {
  email: string;
  password: string;
  name: string;
};

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

const ensureQaCredentials = async (
  email: string,
  password: string,
): Promise<QaCredentials> => {
  const existingLogin = await postAuthJson('/auth/login', {
    email,
    password,
    device: 'QA Android Automation',
    forceLogoutOtherSessions: true,
  });

  if (existingLogin.ok) {
    return {
      email,
      password,
      name: existingLogin.payload?.user?.name || 'QA User',
    };
  }

  if (existingLogin.payload?.code && existingLogin.payload.code !== 'INVALID_CREDENTIALS') {
    throw new Error(existingLogin.payload?.error || existingLogin.payload?.message || 'Unable to provision QA credentials');
  }

  const generatedEmail = `qa_student_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@edumaster.local`;
  const generatedName = 'QA Student';
  const register = await postAuthJson('/auth/register', {
    name: generatedName,
    email: generatedEmail,
    password,
  });

  if (!register.ok && register.payload?.code !== 'EMAIL_EXISTS') {
    throw new Error(register.payload?.error || register.payload?.message || 'Unable to register QA student');
  }

  const generatedLogin = await postAuthJson('/auth/login', {
    email: generatedEmail,
    password,
    device: 'QA Android Automation',
    forceLogoutOtherSessions: true,
  });

  if (!generatedLogin.ok) {
    throw new Error(generatedLogin.payload?.error || generatedLogin.payload?.message || 'Unable to log in generated QA student');
  }

  return {
    email: generatedEmail,
    password,
    name: generatedName,
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
    device: 'QA Android Automation',
    forceLogoutOtherSessions: true,
  });

  if (!response.ok || !response.payload?.token) {
    throw new Error(response.payload?.error || response.payload?.message || 'Unable to bootstrap authenticated shell');
  }

  await driver.execute((token) => {
    window.localStorage.setItem('edumaster.jwt', token);
  }, response.payload.token as string);
  try {
    await driver.refresh();
    await sleep(1500);
    await (await driver.$(selectors.shellReady)).waitForExist({ timeout: 30000 });
  } catch (refreshError) {
    // Some WebDriver environments (emulator/browser combo) abort refresh.
    // Fallback to direct navigation to ensure the authenticated shell is available.
    try {
      await driver.url(config.baseUrl);
      await sleep(1500);
      await (await driver.$(selectors.shellReady)).waitForExist({ timeout: 45000 });
    } catch (navError) {
      throw refreshError;
    }
  }
};

const timeStep = async <T>(fn: () => Promise<T>) => {
  const started = Date.now();
  const value = await fn();
  return { value, durationMs: Date.now() - started };
};

const scrollToTop = async (driver: WebdriverIO.Browser) => {
  await driver.execute(() => {
    window.scrollTo(0, 0);
  });
  await sleep(250);
};

const openMobileMoreDestination = async (
  driver: WebdriverIO.Browser,
  destinationSelector: string,
  desktopFallbackSelector: string,
) => {
  const moreButton = await driver.$(selectors.mobileNavMore);

  if (await moreButton.isExisting()) {
    await clickFirstVisible(driver, [selectors.mobileNavMore]);
    await sleep(400);
    await clickFirstVisible(driver, [destinationSelector, desktopFallbackSelector]);
    return;
  }

  await clickFirstVisible(driver, [desktopFallbackSelector]);
};

export const runAudit = async (): Promise<AuditSummary> => {
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
    let result = await timeStep(async () => {
      await driver.url(config.baseUrl);
      await sleep(2500);
    });
    let capture = await captureStep(driver, ctx, {
      stepId: 'launch',
      label: 'app-launch',
      state: 'loading',
      durationMs: result.durationMs,
    });
    captures.push(capture);
    failures.push(...await detectFailuresForStep(driver, steps[0], capture));

    const qaCredentials = await ensureQaCredentials(config.loginEmail, config.loginPassword);

    result = await timeStep(async () => {
      await clearAndType(driver, selectors.loginEmail, qaCredentials.email);
      await clearAndType(driver, selectors.loginPassword, 'WrongPassword!123');
      await (await driver.$(selectors.loginSubmit)).click();
      await sleep(1500);
    });
    capture = await captureStep(driver, ctx, {
      stepId: 'login-error',
      label: 'invalid-login',
      state: 'error',
      durationMs: result.durationMs,
      notes: ['Intentional invalid login to capture error state.'],
    });
    captures.push(capture);
    failures.push(...await detectFailuresForStep(driver, steps[1], capture));

    result = await timeStep(async () => {
      await clearAndType(driver, selectors.loginEmail, qaCredentials.email);
      await clearAndType(driver, selectors.loginPassword, qaCredentials.password);
      await (await driver.$(selectors.loginSubmit)).click();
      await sleep(2500);
      await ensureAuthenticatedShell(driver, qaCredentials.email, qaCredentials.password);
      await sleep(1200);
    });
    capture = await captureStep(driver, ctx, {
      stepId: 'login-success',
      label: 'login-success',
      state: 'success',
      durationMs: result.durationMs,
    });
    captures.push(capture);
    failures.push(...await detectFailuresForStep(driver, steps[2], capture));

    const screenFlows = [
      { step: steps[3], action: async () => { await clickFirstVisible(driver, [selectors.mobileTabOverview, selectors.mobileNavOverview, selectors.navOverview]); await sleep(1200); } },
      { step: steps[4], action: async () => { await clickFirstVisible(driver, [selectors.mobileTabCourses, selectors.mobileNavCourses, selectors.navCourses]); await sleep(1200); } },
      { step: steps[5], action: async () => { await clickFirstVisible(driver, [selectors.mobileTabTests, selectors.mobileNavTests, selectors.navTests]); await sleep(1200); } },
      { step: steps[6], action: async () => { await clickFirstVisible(driver, [selectors.mobileTabLive, selectors.mobileNavLive, selectors.navLive]); await sleep(1200); } },
      { step: steps[7], action: async () => { await openMobileMoreDestination(driver, selectors.mobileMoreRevision, selectors.navRevision); await sleep(1200); } },
    ];

    for (const flow of screenFlows) {
      try {
        const timed = await timeStep(flow.action);
        await scrollToTop(driver);
        const screenCapture = await captureStep(driver, ctx, {
          stepId: flow.step.id,
          label: flow.step.label,
          state: stateForLabel(flow.step.label),
          durationMs: timed.durationMs,
        });
        captures.push(screenCapture);
        failures.push(...await detectFailuresForStep(driver, flow.step, screenCapture));
      } catch (error) {
        const failedCapture = await captureStep(driver, ctx, {
          stepId: flow.step.id,
          label: `${flow.step.label}-failed`,
          state: 'error',
          durationMs: 0,
          notes: [error instanceof Error ? error.message : String(error)],
        });
        captures.push(failedCapture);
        failures.push({
          stepId: flow.step.id,
          title: 'Navigation step failed',
          description: error instanceof Error ? error.message : String(error),
          severity: 'high',
          timestamp: new Date().toISOString(),
          screenshotPath: failedCapture.screenshotPath,
        });
      }
    }

    // Extra mobile live-class checks: join and test publish/toggles/chat
    try {
      // Navigate to live tab explicitly
      await clickFirstVisible(driver, [selectors.mobileTabLive, selectors.mobileNavLive, selectors.navLive]);
      await sleep(1200);

      // Attempt to open the live join form or join the class
      try {
        await clickFirstVisible(driver, [selectors.liveJoinButton, selectors.firstLiveCard]);
        await sleep(1200);
      } catch {
        // ignore if already on live runtime page
      }

      // If mobile-specific join form is present, try its controls
      const mobileJoin = await driver.$('[data-testid="mobile-live-join-form"]');
      if (await mobileJoin.isExisting()) {
        try {
          const openBtn = await driver.$('[data-testid="mobile-live-open-room"]');
          if (await openBtn.isExisting()) {
            await openBtn.click();
            await sleep(800);
          }
        } catch {}

        try {
          const attemptBtn = await driver.$('[data-testid="mobile-live-attempt-publish"]');
          if (await attemptBtn.isExisting()) {
            await attemptBtn.click();
            await sleep(1200);
          }
        } catch {}

        try {
          const micBtn = await driver.$('[data-testid="mobile-live-toggle-audio"]');
          if (await micBtn.isExisting()) {
            await micBtn.click();
            await sleep(600);
          }
        } catch {}

        try {
          const camBtn = await driver.$('[data-testid="mobile-live-toggle-video"]');
          if (await camBtn.isExisting()) {
            await camBtn.click();
            await sleep(600);
          }
        } catch {}

        try {
          const screenBtn = await driver.$('[data-testid="mobile-live-toggle-screen"]');
          if (await screenBtn.isExisting()) {
            await screenBtn.click();
            await sleep(600);
          }
        } catch {}
      }
    } catch (error) {
      // Continue even if mobile live checks fail; we'll capture later
    }

    const deepFlows: Array<{ stepId: string; label: string; expectedTexts: string[]; action: () => Promise<void> }> = [
      {
        stepId: 'course-subjects',
        label: 'course-subjects-view',
        expectedTexts: ['subject', 'lesson'],
        action: async () => {
          await clickFirstVisible(driver, [selectors.mobileTabCourses, selectors.mobileNavCourses, selectors.navCourses]);
          await sleep(900);
          await clickFirstVisible(driver, [selectors.courseWorkspaceSubjects]);
          await sleep(900);
        },
      },
      {
        stepId: 'course-player',
        label: 'course-player-view',
        expectedTexts: ['topic', 'notes'],
        action: async () => {
          await clickFirstVisible(driver, [selectors.firstCourseTopic, selectors.courseWorkspacePlayer, selectors.firstCourseLessonRail]);
          await sleep(1200);
        },
      },
      {
        stepId: 'course-sessions',
        label: 'course-sessions-view',
        expectedTexts: ['session'],
        action: async () => {
          await clickFirstVisible(driver, [selectors.courseOpenSessionArchive, selectors.courseWorkspaceSessions]);
          await sleep(900);
          try {
            await clickFirstVisible(driver, [selectors.firstCourseSession]);
            await sleep(900);
          } catch {
            // Keep the capture even if no sessions are configured for the selected course.
          }
        },
      },
      {
        stepId: 'test-instructions',
        label: 'mock-test-instructions',
        expectedTexts: ['instruction', 'test'],
        action: async () => {
          await clickFirstVisible(driver, [selectors.mobileTabTests, selectors.mobileNavTests, selectors.navTests]);
          await sleep(900);
          await clickFirstVisible(driver, [selectors.firstTestCard]);
          await sleep(1200);
        },
      },
    ];

    for (const flow of deepFlows) {
      try {
        const timed = await timeStep(flow.action);
        await scrollToTop(driver);
        const screenCapture = await captureStep(driver, ctx, {
          stepId: flow.stepId,
          label: flow.label,
          state: 'ui',
          durationMs: timed.durationMs,
        });
        captures.push(screenCapture);
        failures.push(...await detectFailuresForStep(driver, {
          id: flow.stepId,
          label: flow.label,
          expectedTexts: flow.expectedTexts,
        }, screenCapture));
      } catch (error) {
        const failedCapture = await captureStep(driver, ctx, {
          stepId: flow.stepId,
          label: `${flow.label}-failed`,
          state: 'error',
          durationMs: 0,
          notes: [error instanceof Error ? error.message : String(error)],
        });
        captures.push(failedCapture);
        failures.push({
          stepId: flow.stepId,
          title: 'Deep feature step failed',
          description: error instanceof Error ? error.message : String(error),
          severity: 'high',
          timestamp: new Date().toISOString(),
          screenshotPath: failedCapture.screenshotPath,
        });
      }
    }

    try {
      const searchTiming = await timeStep(async () => {
        try {
          await clickFirstVisible(driver, [selectors.testPlayerClose]);
          await sleep(600);
        } catch {
          // Overlay may already be closed.
        }
        await clickFirstVisible(driver, [selectors.mobileTabOverview, selectors.mobileNavOverview, selectors.navOverview]);
        await sleep(700);
        await scrollToTop(driver);
        await (await driver.$(selectors.globalSearch)).setValue('network');
        await sleep(900);
      });
      const searchCapture = await captureStep(driver, ctx, {
        stepId: 'search-results',
        label: 'search-results-ui',
        state: 'ui',
        durationMs: searchTiming.durationMs,
      });
      captures.push(searchCapture);

      const emptyTiming = await timeStep(async () => {
        await (await driver.$(selectors.globalSearch)).setValue('zzzz-no-match-qa');
        await sleep(900);
      });
      const emptyCapture = await captureStep(driver, ctx, {
        stepId: 'search-empty',
        label: 'search-empty-state',
        state: 'empty',
        durationMs: emptyTiming.durationMs,
      });
      captures.push(emptyCapture);
    } catch (error) {
      const searchFailureCapture = await captureStep(driver, ctx, {
        stepId: 'search-missing',
        label: 'search-unavailable',
        state: 'error',
        durationMs: 0,
        notes: [error instanceof Error ? error.message : String(error)],
      });
      captures.push(searchFailureCapture);
      failures.push({
        stepId: 'search-missing',
        title: 'Search interaction failed',
        description: error instanceof Error ? error.message : String(error),
        severity: 'medium',
        timestamp: new Date().toISOString(),
        screenshotPath: searchFailureCapture.screenshotPath,
      });
    }

    const findings = await analyzeUx(captures, failures);
    const generatedFlutterFile = await writeFlutterFile(ctx.flutterDir, findings);

    const summary: AuditSummary = { captures, failures, findings, generatedFlutterFile };
    await writeJson(path.join(ctx.analysisDir, 'summary.json'), summary);
    await writeText(path.join(ctx.analysisDir, 'ux-findings.md'), findingsToMarkdown(findings));
    await writeText(path.join(ctx.logDir, 'run.log'), `Run ${ctx.runId}\nCaptures: ${captures.length}\nFailures: ${failures.length}\nFindings: ${findings.length}\n`);

    return summary;
  } catch (error) {
    failures.push({
      stepId: 'fatal',
      title: 'Audit crashed',
      description: error instanceof Error ? error.message : String(error),
      severity: 'critical',
      timestamp: new Date().toISOString(),
    });
    const findings = await analyzeUx(captures, failures);
    const generatedFlutterFile = await writeFlutterFile(ctx.flutterDir, findings);
    const summary: AuditSummary = { captures, failures, findings, generatedFlutterFile };
    await writeJson(path.join(ctx.analysisDir, 'summary.json'), summary);
    throw error;
  } finally {
    await driver.deleteSession().catch(() => undefined);
  }
};

if (process.argv[1]?.endsWith('runner.ts')) {
  runAudit()
    .then((summary) => {
      console.log(`Audit complete: ${summary.captures.length} captures, ${summary.failures.length} failures, ${summary.findings.length} findings.`);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
