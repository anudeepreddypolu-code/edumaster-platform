import { Browser } from 'webdriverio';
import { CaptureRecord, FailureRecord, StepDefinition } from './types.js';

export const detectFailuresForStep = async (
  driver: Browser,
  step: StepDefinition,
  capture: CaptureRecord,
): Promise<FailureRecord[]> => {
  const failures: FailureRecord[] = [];

  const pageSource = await driver.getPageSource();
  const now = new Date().toISOString();

  if (capture.durationMs > 6000) {
    failures.push({
      stepId: step.id,
      title: 'Slow screen transition',
      description: `${step.label} took ${capture.durationMs}ms which crossed the slow threshold.`,
      severity: 'medium',
      timestamp: now,
      screenshotPath: capture.screenshotPath,
    });
  }

  for (const selector of step.requiredSelectors || []) {
    const element = await driver.$(selector);
    const exists = await element.isExisting();
    if (!exists) {
      failures.push({
        stepId: step.id,
        title: 'Missing required UI element',
        description: `Required selector not found: ${selector}`,
        severity: 'high',
        timestamp: now,
        screenshotPath: capture.screenshotPath,
      });
    }
  }

  for (const text of step.expectedTexts || []) {
    if (!pageSource.includes(text)) {
      failures.push({
        stepId: step.id,
        title: 'Expected content missing',
        description: `Expected text was not found on the page: "${text}"`,
        severity: 'medium',
        timestamp: now,
        screenshotPath: capture.screenshotPath,
      });
    }
  }

  const likelyErrorState = /something went wrong|unable to|request failed|session expired|error/i.test(pageSource);
  const knownSafeErrorMentions = /mistake recovery|latest mock mistakes|invalid login error state/i.test(pageSource);

  if (likelyErrorState && !knownSafeErrorMentions) {
    failures.push({
      stepId: step.id,
      title: 'Visible error state detected',
      description: 'The DOM contains visible error messaging or failure keywords.',
      severity: 'high',
      timestamp: now,
      screenshotPath: capture.screenshotPath,
    });
  }

  if (/min-width|min-height|overflow-x/i.test(pageSource) && /Question palette|prep operating system/i.test(pageSource)) {
    failures.push({
      stepId: step.id,
      title: 'Potential layout overflow risk',
      description: 'The screen may be relying on rigid sizing that is risky on smaller Android viewports.',
      severity: 'low',
      timestamp: now,
      screenshotPath: capture.screenshotPath,
    });
  }

  return failures;
};
