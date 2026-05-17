import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import puppeteer, { type Browser, type HTTPRequest, type HTTPResponse } from 'puppeteer-core';
import { config } from './config.js';
import { chromeHostResolverRule } from './network.js';
import { createRunContext, sleep, writeJson, writeText } from './utils.js';

const execFileAsync = promisify(execFile);

type HlsNetworkSample = {
  viewerId: number;
  url: string;
  status: number;
  durationMs: number;
  cacheControl: string;
  cacheStatus: string;
  age: string;
  cachePolicy: string;
};

type HlsPlayerMetric = {
  viewerId: number;
  type: string;
  at: number;
  [key: string]: unknown;
};

type InfraSample = {
  at: string;
  health?: unknown;
  dockerStats?: unknown[];
  cacheBytes?: number | null;
  error?: string;
};

type ViewerResult = {
  viewerId: number;
  ok: boolean;
  viewport: 'desktop' | 'mobile';
  error?: string;
  durationSeconds?: number;
  startupDelayMs?: number;
  totalBufferMs: number;
  bufferRatio: number;
  segmentCount: number;
  averageSegmentLatencyMs?: number;
  p95SegmentLatencyMs?: number;
  p99SegmentLatencyMs?: number;
  cacheHitRatio?: number;
  fatalHlsErrors: number;
  nonFatalHlsErrors: number;
  memoryGrowthBytes?: number;
  screenshotPaths: string[];
};

const baseUrl = config.baseUrl.replace(/\/$/, '');
const pageUrl = process.env.RECORDED_LOAD_PAGE_URL || `${baseUrl}/`;
const authToken = process.env.RECORDED_LOAD_AUTH_TOKEN || '';
const viewerCount = Number(process.env.RECORDED_BROWSER_VIEWERS || 25);
const concurrency = Math.max(1, Number(process.env.RECORDED_BROWSER_CONCURRENCY || Math.min(viewerCount, 10)));
const watchSeconds = Math.max(5, Number(process.env.RECORDED_BROWSER_WATCH_SECONDS || 3600));
const minDurationSeconds = Math.max(0, Number(process.env.RECORDED_BROWSER_MIN_DURATION_SECONDS || 3600));
const screenshotSample = Math.max(0, Number(process.env.RECORDED_BROWSER_SCREENSHOT_SAMPLE || 5));
const mobileRatio = Math.min(1, Math.max(0, Number(process.env.RECORDED_BROWSER_MOBILE_RATIO || 0.35)));
const behaviorIntervalSeconds = Math.max(10, Number(process.env.RECORDED_BROWSER_BEHAVIOR_INTERVAL_SECONDS || 45));
const infraSshTarget = process.env.RECORDED_INFRA_SSH_TARGET || '';
const infraSampleSeconds = Math.max(10, Number(process.env.RECORDED_INFRA_SAMPLE_SECONDS || 30));
const certificationMode = process.env.RECORDED_BROWSER_CERTIFICATION_MODE !== 'false';
const hlsUrlPattern = /\/backend\/api\/courses\/stream\/|\.m3u8(?:\?|$)|\.(?:ts|m4s|mp4|aac|vtt|webvtt)(?:\?|$)/i;

const percentile = (values: number[], p: number) => {
  if (!values.length) {
    return undefined;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
};

const average = (values: number[]) => {
  if (!values.length) {
    return undefined;
  }

  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
};

const isCacheHit = (sample: HlsNetworkSample) => {
  const cacheText = `${sample.cacheStatus} ${sample.age}`.toLowerCase();
  return /hit|cached|refreshhit/.test(cacheText) || Number(sample.age || 0) > 0;
};

const getViewerViewport = (viewerId: number): 'desktop' | 'mobile' => {
  if (viewerCount <= 1) {
    return mobileRatio > 0.5 ? 'mobile' : 'desktop';
  }

  const mobileEvery = Math.max(1, Math.round(1 / Math.max(mobileRatio, 0.01)));
  return mobileRatio > 0 && viewerId % mobileEvery === 0 ? 'mobile' : 'desktop';
};

const parseDockerStats = (raw: string) => raw
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return { raw: line };
    }
  });

const startInfraSampler = async (ctx: Awaited<ReturnType<typeof createRunContext>>) => {
  const samples: InfraSample[] = [];
  let stopped = false;

  const sample = async () => {
    const entry: InfraSample = { at: new Date().toISOString() };
    try {
      const healthResponse = await fetch(`${baseUrl}/backend/api/health`);
      entry.health = await healthResponse.json().catch(() => ({ status: healthResponse.status }));
    } catch (error) {
      entry.error = `health: ${error instanceof Error ? error.message : String(error)}`;
    }

    if (infraSshTarget) {
      try {
        const stats = await execFileAsync('ssh', [
          infraSshTarget,
          'docker stats --no-stream --format "{{json .}}" lowcost-app-1 lowcost-redis-1 lowcost-postgres-1 lowcost-recorded-hls-cache-1',
        ], { timeout: 20_000, maxBuffer: 1024 * 1024 });
        entry.dockerStats = parseDockerStats(stats.stdout);
      } catch (error) {
        entry.error = `${entry.error ? `${entry.error}; ` : ''}docker-stats: ${error instanceof Error ? error.message : String(error)}`;
      }

      try {
        const cache = await execFileAsync('ssh', [
          infraSshTarget,
          'docker exec lowcost-recorded-hls-cache-1 sh -lc "du -sb /var/cache/nginx/recorded-hls 2>/dev/null | awk \'{print $1}\'"',
        ], { timeout: 20_000, maxBuffer: 1024 * 128 });
        entry.cacheBytes = Number(cache.stdout.trim() || 0);
      } catch {
        entry.cacheBytes = null;
      }
    }

    samples.push(entry);
    await writeJson(path.join(ctx.logDir, 'infra-samples.json'), samples);
  };

  void sample();
  const loop = async () => {
    while (!stopped) {
      await sleep(infraSampleSeconds * 1000);
      if (!stopped) {
        await sample();
      }
    }
  };
  void loop();

  return {
    samples,
    stop: async () => {
      stopped = true;
      await sample();
      return samples;
    },
  };
};

const waitForVideoDuration = async (page: puppeteer.Page) => page.waitForFunction(
  () => {
    const video = document.querySelector('video') as HTMLVideoElement | null;
    return Boolean(video && Number.isFinite(video.duration) && video.duration > 0);
  },
  { timeout: 90_000 },
);

const runViewerBehaviors = async (page: puppeteer.Page, viewerId: number, durationSeconds: number) => {
  const deadline = Date.now() + (watchSeconds * 1000);
  let actionIndex = 0;

  while (Date.now() < deadline) {
    await sleep(Math.min(behaviorIntervalSeconds * 1000, Math.max(deadline - Date.now(), 0)));
    if (Date.now() >= deadline) {
      break;
    }

    actionIndex += 1;
    await page.evaluate(({ actionIndex: currentAction, viewerId: currentViewerId, duration }) => {
      const video = document.querySelector('video') as HTMLVideoElement | null;
      if (!video) {
        return;
      }

      const seekWindowEnd = Math.max(duration - 30, 30);
      const safeSeek = (seconds: number) => {
        if (Number.isFinite(seconds)) {
          video.currentTime = Math.min(Math.max(seconds, 5), seekWindowEnd);
        }
      };

      const action = (currentAction + currentViewerId) % 6;
      if (action === 0) {
        video.pause();
        setTimeout(() => void video.play().catch(() => undefined), 4000 + ((currentViewerId % 5) * 1000));
        return;
      }

      if (action === 1) {
        safeSeek(video.currentTime + 60 + ((currentViewerId % 6) * 15));
        return;
      }

      if (action === 2) {
        safeSeek(video.currentTime - 45 - ((currentViewerId % 4) * 15));
        return;
      }

      if (action === 3) {
        const randomPoint = (0.05 + (((currentViewerId * 97 + currentAction * 53) % 80) / 100)) * seekWindowEnd;
        safeSeek(randomPoint);
        return;
      }

      const level = action === 4 ? (currentViewerId + currentAction) % 4 : -1;
      window.dispatchEvent(new CustomEvent('edumaster:hls-set-level', { detail: { level } }));
    }, { actionIndex, viewerId, duration: durationSeconds });
  }
};

const runViewer = async (
  browser: Browser,
  viewerId: number,
  ctx: Awaited<ReturnType<typeof createRunContext>>,
): Promise<ViewerResult> => {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const networkSamples: HlsNetworkSample[] = [];
  const metrics: HlsPlayerMetric[] = [];
  const requestStartedAt = new Map<string, number>();
  const screenshotPaths: string[] = [];
  const shouldScreenshot = viewerId <= screenshotSample;
  const viewport = getViewerViewport(viewerId);

  if (viewport === 'mobile') {
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  } else {
    await page.setViewport({ width: 1366, height: 900, deviceScaleFactor: 1 });
  }

  if (authToken) {
    await page.evaluateOnNewDocument((token) => {
      window.localStorage.setItem('edumaster.jwt', token);
    }, authToken);
  }

  await page.exposeFunction('__recordRecordedHlsMetric', (metric: HlsPlayerMetric) => {
    metrics.push({ ...metric, viewerId });
  });
  await page.evaluateOnNewDocument(() => {
    window.addEventListener('edumaster:hls-metric', (event) => {
      const metric = event instanceof CustomEvent ? event.detail : {};
      void (window as unknown as { __recordRecordedHlsMetric?: (value: unknown) => Promise<void> })
        .__recordRecordedHlsMetric?.(metric);
    });
  });

  page.on('request', (request: HTTPRequest) => {
    if (hlsUrlPattern.test(request.url())) {
      requestStartedAt.set(request.url(), Date.now());
    }
  });

  page.on('response', (response: HTTPResponse) => {
    const url = response.url();
    if (!hlsUrlPattern.test(url)) {
      return;
    }

    const headers = response.headers();
    const startedAt = requestStartedAt.get(url) || Date.now();
    networkSamples.push({
      viewerId,
      url,
      status: response.status(),
      durationMs: Math.max(Date.now() - startedAt, 0),
      cacheControl: headers['cache-control'] || '',
      cacheStatus: headers['x-recorded-hls-cache'] || headers['cf-cache-status'] || headers['x-cache'] || headers['x-cache-status'] || '',
      age: headers.age || '',
      cachePolicy: headers['x-edumaster-cache-policy'] || '',
    });
  });

  try {
    await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 60_000 });
    await page.waitForSelector('video', { timeout: 45_000 });
    await waitForVideoDuration(page);

    const durationSeconds = await page.evaluate(() => {
      const video = document.querySelector('video') as HTMLVideoElement | null;
      return Math.round(Number(video?.duration || 0));
    });

    if (certificationMode && durationSeconds < minDurationSeconds) {
      throw new Error(`Recorded-course certification requires long-form media >= ${minDurationSeconds}s; detected ${durationSeconds}s.`);
    }

    await page.evaluate((duration) => {
      const video = document.querySelector('video') as HTMLVideoElement | null;
      if (!video) {
        return;
      }

      const seekableEnd = Math.max(duration - 30, 30);
      video.currentTime = Math.min(Math.max((0.05 + Math.random() * 0.85) * seekableEnd, 5), seekableEnd);
      void video.play().catch(() => undefined);
    }, durationSeconds);

    if (shouldScreenshot) {
      const loadedPath = path.join(ctx.screenshotDir, `recorded-viewer-${viewerId}-${viewport}-loaded.png`);
      await page.screenshot({ path: loadedPath, fullPage: true });
      screenshotPaths.push(loadedPath);
    }

    await runViewerBehaviors(page, viewerId, durationSeconds);

    if (shouldScreenshot) {
      const watchPath = path.join(ctx.screenshotDir, `recorded-viewer-${viewerId}-${viewport}-after-${watchSeconds}s.png`);
      await page.screenshot({ path: watchPath, fullPage: true });
      screenshotPaths.push(watchPath);
    }

    const startupDelayMs = metrics.find((metric) => metric.type === 'startup_ready')?.startupDelayMs as number | undefined;
    const totalBufferMs = Math.max(...metrics.map((metric) => Number(metric.totalBufferMs || 0)), 0);
    const memorySamples = metrics
      .map((metric) => Number(metric.usedJSHeapSize || 0))
      .filter((value) => value > 0);
    const memoryGrowthBytes = memorySamples.length >= 2 ? memorySamples[memorySamples.length - 1] - memorySamples[0] : undefined;
    const segmentLatencies = [
      ...metrics
        .filter((metric) => metric.type === 'segment_loaded')
        .map((metric) => Number(metric.loadMs || 0))
        .filter((value) => value > 0),
      ...networkSamples
        .filter((sample) => hlsUrlPattern.test(sample.url))
        .map((sample) => sample.durationMs)
        .filter((value) => value > 0),
    ];
    const cacheableSamples = networkSamples.filter((sample) => sample.cacheControl || sample.cacheStatus || sample.age);
    const cacheHitRatio = cacheableSamples.length
      ? cacheableSamples.filter(isCacheHit).length / cacheableSamples.length
      : undefined;
    const hlsErrors = metrics.filter((metric) => metric.type === 'hls_error');

    return {
      viewerId,
      ok: Boolean(networkSamples.length || metrics.length),
      viewport,
      durationSeconds,
      startupDelayMs,
      totalBufferMs,
      bufferRatio: totalBufferMs / (watchSeconds * 1000),
      segmentCount: segmentLatencies.length,
      averageSegmentLatencyMs: average(segmentLatencies),
      p95SegmentLatencyMs: percentile(segmentLatencies, 95),
      p99SegmentLatencyMs: percentile(segmentLatencies, 99),
      cacheHitRatio,
      fatalHlsErrors: hlsErrors.filter((metric) => Boolean(metric.fatal)).length,
      nonFatalHlsErrors: hlsErrors.filter((metric) => !metric.fatal).length,
      memoryGrowthBytes,
      screenshotPaths,
    };
  } catch (error) {
    const errorPath = path.join(ctx.screenshotDir, `recorded-viewer-${viewerId}-${viewport}-error.png`);
    await page.screenshot({ path: errorPath, fullPage: true }).catch(() => undefined);
    screenshotPaths.push(errorPath);
    return {
      viewerId,
      ok: false,
      viewport,
      error: error instanceof Error ? error.message : String(error),
      totalBufferMs: 0,
      bufferRatio: 1,
      segmentCount: 0,
      fatalHlsErrors: 0,
      nonFatalHlsErrors: 0,
      screenshotPaths,
    };
  } finally {
    await writeJson(path.join(ctx.logDir, `recorded-viewer-${viewerId}.json`), {
      viewerId,
      viewport,
      metrics,
      networkSamples,
    });
    await context.close().catch(() => undefined);
  }
};

const main = async () => {
  const ctx = await createRunContext();
  const infraSampler = await startInfraSampler(ctx);
  const browserHostResolverRule = chromeHostResolverRule(config.baseUrl);
  const browser = await puppeteer.launch({
    executablePath: process.env.QA_CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--mute-audio',
      ...(browserHostResolverRule ? [`--host-resolver-rules=${browserHostResolverRule}`] : []),
    ],
  });

  const queue = Array.from({ length: viewerCount }, (_, index) => index + 1);
  const results: ViewerResult[] = [];

  const worker = async () => {
    while (queue.length > 0) {
      const viewerId = queue.shift();
      if (!viewerId) {
        return;
      }
      results.push(await runViewer(browser, viewerId, ctx));
    }
  };

  let infraSamples: InfraSample[] = [];
  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, viewerCount) }, worker));
  } finally {
    await browser.close().catch(() => undefined);
    infraSamples = await infraSampler.stop();
  }

  const successful = results.filter((result) => result.ok);
  const startupDelays = successful.map((result) => result.startupDelayMs || 0).filter((value) => value > 0);
  const segmentP95Values = successful.map((result) => result.p95SegmentLatencyMs || 0).filter((value) => value > 0);
  const segmentP99Values = successful.map((result) => result.p99SegmentLatencyMs || 0).filter((value) => value > 0);
  const cacheHitRatios = successful.map((result) => result.cacheHitRatio).filter((value): value is number => typeof value === 'number');
  const durations = successful.map((result) => result.durationSeconds || 0).filter((value) => value > 0);
  const memoryGrowthValues = successful.map((result) => result.memoryGrowthBytes).filter((value): value is number => typeof value === 'number');
  const fatalHlsErrors = successful.reduce((sum, result) => sum + result.fatalHlsErrors, 0);
  const nonFatalHlsErrors = successful.reduce((sum, result) => sum + result.nonFatalHlsErrors, 0);
  const longFormCompliant = certificationMode ? durations.every((duration) => duration >= minDurationSeconds) : true;
  const summary = {
    runId: ctx.runId,
    pageUrl,
    viewerCount,
    concurrency,
    watchSeconds,
    minDurationSeconds,
    certificationMode,
    longFormCompliant,
    mobileRatio,
    mobileViewers: results.filter((result) => result.viewport === 'mobile').length,
    successRate: results.length ? successful.length / results.length : 0,
    detectedDurationMinSeconds: durations.length ? Math.min(...durations) : undefined,
    startupDelayP95Ms: percentile(startupDelays, 95),
    startupDelayP99Ms: percentile(startupDelays, 99),
    averageBufferRatio: successful.length
      ? successful.reduce((sum, result) => sum + result.bufferRatio, 0) / successful.length
      : 1,
    segmentLatencyP95Ms: percentile(segmentP95Values, 95),
    segmentLatencyP99Ms: percentile(segmentP99Values, 99),
    cacheHitRatio: cacheHitRatios.length
      ? cacheHitRatios.reduce((sum, value) => sum + value, 0) / cacheHitRatios.length
      : undefined,
    memoryGrowthP95Bytes: percentile(memoryGrowthValues, 95),
    fatalHlsErrors,
    nonFatalHlsErrors,
    infraSampleCount: infraSamples.length,
    failures: results.filter((result) => !result.ok),
    screenshotDir: ctx.screenshotDir,
  };

  await writeJson(path.join(ctx.analysisDir, 'recorded-browser-load-summary.json'), { summary, results, infraSamples });
  await writeText(
    path.join(ctx.analysisDir, 'recorded-browser-load-summary.md'),
    [
      '# Recorded Browser Load Summary',
      '',
      `- Page: ${pageUrl}`,
      `- Viewers: ${viewerCount}`,
      `- Concurrency: ${concurrency}`,
      `- Watch seconds: ${watchSeconds}`,
      `- Certification mode: ${certificationMode ? 'on' : 'off'}`,
      `- Minimum required duration: ${minDurationSeconds}s`,
      `- Detected minimum duration: ${summary.detectedDurationMinSeconds ?? 'n/a'}s`,
      `- Long-form compliant: ${summary.longFormCompliant ? 'yes' : 'no'}`,
      `- Mobile viewers: ${summary.mobileViewers}`,
      `- Success rate: ${(summary.successRate * 100).toFixed(2)}%`,
      `- Startup p95/p99: ${summary.startupDelayP95Ms ?? 'n/a'} / ${summary.startupDelayP99Ms ?? 'n/a'} ms`,
      `- Segment latency p95/p99: ${summary.segmentLatencyP95Ms ?? 'n/a'} / ${summary.segmentLatencyP99Ms ?? 'n/a'} ms`,
      `- Average rebuffer ratio: ${(summary.averageBufferRatio * 100).toFixed(3)}%`,
      `- CDN/cache hit ratio: ${summary.cacheHitRatio === undefined ? 'n/a' : `${(summary.cacheHitRatio * 100).toFixed(2)}%`}`,
      `- Memory growth p95: ${summary.memoryGrowthP95Bytes ?? 'n/a'} bytes`,
      `- HLS errors fatal/non-fatal: ${fatalHlsErrors} / ${nonFatalHlsErrors}`,
      `- Infra samples: ${infraSamples.length}`,
      `- Screenshots: ${ctx.screenshotDir}`,
      '',
      'Failures:',
      ...summary.failures.map((failure) => `- viewer ${failure.viewerId}: ${failure.error || 'no HLS/player signal captured'}`),
    ].join('\n'),
  );

  console.log(JSON.stringify(summary, null, 2));
};

if (process.argv[1]?.endsWith('recorded-browser-load-review.ts')) {
  void main();
}
