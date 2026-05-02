import fs from 'node:fs/promises';
import { Browser } from 'webdriverio';
import { artifactPath, writeText } from './utils.js';
import { CaptureRecord, CaptureState, RunContext } from './types.js';

export const captureStep = async (
  driver: Browser,
  ctx: RunContext,
  {
    stepId,
    label,
    state,
    durationMs,
    notes,
  }: {
    stepId: string;
    label: string;
    state: CaptureState;
    durationMs: number;
    notes?: string[];
  },
): Promise<CaptureRecord> => {
  const screenshotPath = artifactPath(ctx.screenshotDir, stepId, `${state}-${label}`, 'png');
  const sourcePath = artifactPath(ctx.sourceDir, stepId, `${state}-${label}`, 'xml');

  const screenshot = await driver.takeScreenshot();
  await fs.writeFile(screenshotPath, Buffer.from(screenshot, 'base64'));
  await writeText(sourcePath, await driver.getPageSource());

  return {
    stepId,
    label,
    state,
    durationMs,
    screenshotPath,
    sourcePath,
    timestamp: new Date().toISOString(),
    notes,
  };
};
