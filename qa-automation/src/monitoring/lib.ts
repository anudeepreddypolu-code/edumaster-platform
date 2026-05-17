import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AlertPayload,
  BaselineRecord,
  BrowserRunSource,
  ContinuousMode,
  HistoricalRunEntry,
  LoadRunSource,
  MetricDelta,
  MetricSnapshot,
  NormalizedRunSummary,
  RegressionReport,
  Severity,
  TrendPoint,
  TrendReport,
  TrendSeries,
} from './types.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
export const qaRoot = path.resolve(dirname, '..', '..');
export const reportsRoot = path.join(qaRoot, 'reports');
export const runsRoot = path.join(qaRoot, 'runs');
export const monitoringDataRoot = path.join(qaRoot, 'monitoring-data');

const LATENCY_WARN_PCT = 10;
const LATENCY_FAIL_PCT = 20;
const SUCCESS_FAIL_DROP = 5;
const SUCCESS_WARN_DROP = 2;
const BUFFER_FAIL_PCT = 15;
const BUFFER_WARN_PCT = 8;
const CONTINUITY_FAIL_DROP = 5;
const CONTINUITY_WARN_DROP = 2;
const STABILITY_FAIL_DROP = 5;
const STABILITY_WARN_DROP = 2;

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export const nowIso = () => new Date().toISOString();

export const boolEnv = (value: string | undefined, fallback = false) => {
  if (value == null || value === '') {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

export const ensureDir = async (dirPath: string) => {
  await fs.mkdir(dirPath, { recursive: true });
};

export const writeJson = async (filePath: string, data: unknown) => {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
};

export const writeText = async (filePath: string, value: string) => {
  await fs.writeFile(filePath, value, 'utf8');
};

const readJson = async <T>(filePath: string): Promise<T> => JSON.parse(await fs.readFile(filePath, 'utf8')) as T;

const listFilesRecursive = async (root: string): Promise<string[]> => {
  const results: string[] = [];
  const walk = async (dirPath: string) => {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      results.push(fullPath);
    }
  };
  await walk(root);
  return results;
};

const safeName = (value: string) => value.replace(/[^a-zA-Z0-9._-]+/g, '-');

const findEndpoint = (endpointSummary: Array<Record<string, unknown>>, name: string) =>
  endpointSummary.find((entry) => entry.name === name) || null;

const metricOrNull = (entry: Record<string, unknown> | null, key: string) => {
  const value = entry?.[key];
  return isNumber(value) ? value : null;
};

const computeBufferingRatio = (journeySummary: Record<string, unknown> | null) => {
  if (!journeySummary) {
    return null;
  }
  const seconds = journeySummary.bufferingSeconds;
  const users = journeySummary.usersTracked;
  const playbackSeconds = journeySummary.averagePlaybackSeconds;
  if (!isNumber(seconds) || !isNumber(users) || !isNumber(playbackSeconds) || users <= 0 || playbackSeconds <= 0) {
    return null;
  }
  return Number((seconds / (users * playbackSeconds)).toFixed(4));
};

const computeRate = (numerator: number | null, denominator: number | null) => {
  if (numerator == null || denominator == null || denominator <= 0) {
    return null;
  }
  return Number(((numerator / denominator) * 100).toFixed(2));
};

const computeContinuityScore = (journeySummary: Record<string, unknown> | null, startupSuccessRate: number | null) => {
  if (!journeySummary && startupSuccessRate == null) {
    return null;
  }
  const usersTracked = isNumber(journeySummary?.usersTracked) ? Number(journeySummary?.usersTracked) : null;
  const interruptions = isNumber(journeySummary?.interruptions) ? Number(journeySummary?.interruptions) : 0;
  const stalls = isNumber(journeySummary?.stalls) ? Number(journeySummary?.stalls) : 0;
  const freezes = isNumber(journeySummary?.freezes) ? Number(journeySummary?.freezes) : 0;
  const completedWatchers = isNumber(journeySummary?.completedWatchers) ? Number(journeySummary?.completedWatchers) : usersTracked;
  let score = startupSuccessRate ?? 100;
  if (usersTracked && usersTracked > 0) {
    score -= (interruptions / usersTracked) * 20;
    score -= (stalls / usersTracked) * 10;
    score -= (freezes / usersTracked) * 10;
    if (isNumber(completedWatchers)) {
      score -= Math.max(0, ((usersTracked - completedWatchers) / usersTracked) * 30);
    }
  }
  return Number(Math.max(0, Math.min(100, score)).toFixed(2));
};

const aggregateMetric = (values: Array<number | null>, reducer: (nums: number[]) => number) => {
  const nums = values.filter(isNumber);
  if (!nums.length) {
    return null;
  }
  return Number(reducer(nums).toFixed(2));
};

const average = (nums: number[]) => nums.reduce((sum, value) => sum + value, 0) / nums.length;
const min = (nums: number[]) => Math.min(...nums);

export const createMetricSnapshot = (partials: Array<Partial<MetricSnapshot>>): MetricSnapshot => ({
  startupSuccessRate: aggregateMetric(partials.map((item) => item.startupSuccessRate ?? null), average),
  mediaManifestP50Ms: aggregateMetric(partials.map((item) => item.mediaManifestP50Ms ?? null), average),
  mediaManifestP95Ms: aggregateMetric(partials.map((item) => item.mediaManifestP95Ms ?? null), average),
  mediaManifestP99Ms: aggregateMetric(partials.map((item) => item.mediaManifestP99Ms ?? null), average),
  firstFrameMs: aggregateMetric(partials.map((item) => item.firstFrameMs ?? null), average),
  bufferingRatio: aggregateMetric(partials.map((item) => item.bufferingRatio ?? null), average),
  interruptionRate: aggregateMetric(partials.map((item) => item.interruptionRate ?? null), average),
  sustainedContinuityScore: aggregateMetric(partials.map((item) => item.sustainedContinuityScore ?? null), average),
  recoverySuccessRate: aggregateMetric(partials.map((item) => item.recoverySuccessRate ?? null), average),
  cacheHitEffectiveness: aggregateMetric(partials.map((item) => item.cacheHitEffectiveness ?? null), average),
  browserStabilityRate: aggregateMetric(partials.map((item) => item.browserStabilityRate ?? null), average),
  failedRequestRate: aggregateMetric(partials.map((item) => item.failedRequestRate ?? null), average),
});

export const discoverLatestReport = async (prefix: string, requiredFile?: string) => {
  const entries = await fs.readdir(reportsRoot, { withFileTypes: true });
  const matches = await Promise.all(entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map(async (entry) => {
      const dirPath = path.join(reportsRoot, entry.name);
      if (requiredFile) {
        try {
          await fs.access(path.join(dirPath, requiredFile));
        } catch {
          return null;
        }
      }
      const stat = await fs.stat(dirPath);
      return { dirPath, mtimeMs: stat.mtimeMs };
    }));
  const found = matches.filter((item): item is { dirPath: string; mtimeMs: number } => item != null).sort((a, b) => b.mtimeMs - a.mtimeMs);
  return found[0]?.dirPath || null;
};

export const ingestLoadSource = async (sourcePath: string): Promise<LoadRunSource> => {
  const reportPath = sourcePath.endsWith('.json') ? sourcePath : path.join(sourcePath, 'full-course-video-report.json');
  const raw = await readJson<Record<string, unknown>>(reportPath);
  const reportDir = path.dirname(reportPath);
  const endpointSummary = Array.isArray(raw.endpointSummary) ? raw.endpointSummary.filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry != null) : [];
  const journeyTelemetrySummary = typeof raw.journeyTelemetrySummary === 'object' && raw.journeyTelemetrySummary != null
    ? raw.journeyTelemetrySummary as Record<string, unknown>
    : null;
  const mediaManifest = findEndpoint(endpointSummary, 'course.video.mediaManifest');
  const firstFrame = findEndpoint(endpointSummary, 'course.player');
  const usersRequested = isNumber(raw.usersRequested) ? raw.usersRequested : 0;
  const successfulJourneys = isNumber(raw.successfulJourneys) ? raw.successfulJourneys : 0;
  const failedJourneys = isNumber(raw.failedJourneys) ? raw.failedJourneys : 0;
  const totalRequests = isNumber(raw.totalRequests) ? raw.totalRequests : 0;
  const failedRequests = isNumber(raw.failedRequests) ? raw.failedRequests : 0;
  const startupSuccessRate = computeRate(successfulJourneys, usersRequested);
  const interruptionRate = computeRate(
    isNumber(journeyTelemetrySummary?.interruptions) ? Number(journeyTelemetrySummary?.interruptions) : null,
    isNumber(journeyTelemetrySummary?.usersTracked) ? Number(journeyTelemetrySummary?.usersTracked) : null,
  );
  const metrics: MetricSnapshot = {
    startupSuccessRate,
    mediaManifestP50Ms: metricOrNull(mediaManifest, 'p50Ms'),
    mediaManifestP95Ms: metricOrNull(mediaManifest, 'p95Ms'),
    mediaManifestP99Ms: metricOrNull(mediaManifest, 'p99Ms'),
    firstFrameMs: metricOrNull(firstFrame, 'avgMs'),
    bufferingRatio: computeBufferingRatio(journeyTelemetrySummary),
    interruptionRate,
    sustainedContinuityScore: computeContinuityScore(journeyTelemetrySummary, startupSuccessRate),
    recoverySuccessRate: successfulJourneys > 0 ? 100 : 0,
    cacheHitEffectiveness: null,
    browserStabilityRate: null,
    failedRequestRate: computeRate(failedRequests, totalRequests),
  };
  let drilldownUsers: Array<Record<string, unknown>> = [];
  try {
    const journeyTelemetry = await readJson<Array<Record<string, unknown>>>(path.join(reportDir, 'journey-telemetry.json'));
    drilldownUsers = journeyTelemetry.slice(0, 50).map((entry) => ({
      userIndex: entry.userIndex,
      assignmentLabel: entry.assignmentLabel,
      playbackSecondsAdvanced: entry.playbackSecondsAdvanced,
      interruptions: entry.interruptions,
      retries: entry.retries,
      stalls: entry.stalls,
      freezes: entry.freezes,
      completed: entry.completed,
    }));
  } catch {
    if (Array.isArray(raw.sampleBrowserUsers)) {
      drilldownUsers = raw.sampleBrowserUsers
        .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry != null)
        .slice(0, 20);
    }
  }
  return {
    type: 'load',
    sourcePath,
    reportPath,
    runId: String(raw.runId || path.basename(path.dirname(reportPath))),
    reportPrefix: path.basename(path.dirname(reportPath)).replace(/-\d{4}-\d{2}-\d{2}T.*$/, ''),
    usersRequested,
    successfulJourneys,
    failedJourneys,
    totalRequests,
    failedRequests,
    wallClockMs: isNumber(raw.wallClockMs) ? raw.wallClockMs : null,
    watchMode: typeof raw.watchMode === 'string' ? raw.watchMode : null,
    courseAssignments: Array.isArray(raw.courseAssignments) ? raw.courseAssignments.filter((item): item is Record<string, unknown> => typeof item === 'object' && item != null) : [],
    metrics,
    endpointSummary,
    issues: Array.isArray(raw.issues) ? raw.issues.filter((item): item is Record<string, unknown> => typeof item === 'object' && item != null) : [],
    journeyTelemetrySummary,
    resourceTelemetrySamples: Array.isArray(raw.resourceTelemetry) ? raw.resourceTelemetry.length : 0,
    drilldownUsers,
  };
};

export const ingestBrowserSource = async (sourcePath: string): Promise<BrowserRunSource> => {
  const summaryPath = path.join(sourcePath, 'summary.json');
  const allFiles = await listFilesRecursive(sourcePath);
  const screenshots = allFiles.filter((filePath) => /\.(png|jpg|jpeg)$/i.test(filePath)).length;
  const videos = allFiles.filter((filePath) => /\.(webm|mp4)$/i.test(filePath)).length;
  const networkLogs = allFiles.filter((filePath) => /network/i.test(path.basename(filePath))).length;
  const consoleLogs = allFiles.filter((filePath) => /console/i.test(path.basename(filePath))).length;
  const pageErrorFiles = allFiles.filter((filePath) => /page-errors/i.test(path.basename(filePath))).length;
  const playerStateFiles = allFiles.filter((filePath) => /player-state/i.test(path.basename(filePath))).length;
  try {
    await fs.access(summaryPath);
    const summary = await readJson<Record<string, unknown>>(summaryPath);
    const matrixTotals = typeof summary.matrixTotals === 'object' && summary.matrixTotals != null
      ? summary.matrixTotals as BrowserRunSource['matrixTotals']
      : { total: 0, passed: 0, failed: 0, flaky: 0, skipped: 0 };
    return {
      type: 'browser',
      sourcePath,
      runId: String(summary.runId || path.basename(sourcePath)),
      completeSummaryAvailable: true,
      matrixTotals,
      playbackReliabilityPercent: isNumber(summary.playbackReliabilityPercent) ? summary.playbackReliabilityPercent : null,
      loadResults: Array.isArray(summary.loadResults) ? summary.loadResults.filter((item): item is Record<string, unknown> => typeof item === 'object' && item != null) : [],
      screenshots,
      videos,
      networkLogs,
      consoleLogs,
      pageErrorFiles,
      playerStateFiles,
      failureCount: matrixTotals.failed,
      notes: [],
    };
  } catch {
    const caseDirs = (await fs.readdir(sourcePath, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    const caseSummaries = await Promise.all(caseDirs.map(async (dirName) => {
      const perCaseSummary = path.join(sourcePath, dirName, 'summary.json');
      try {
        const caseData = await readJson<Record<string, unknown>>(perCaseSummary);
        return { dirName, error: typeof caseData.error === 'string' ? caseData.error : null };
      } catch {
        return { dirName, error: null };
      }
    }));
    const failures = caseSummaries.filter((entry) => entry.error).length;
    const total = caseDirs.length;
    const passed = Math.max(total - failures, 0);
    return {
      type: 'browser',
      sourcePath,
      runId: path.basename(sourcePath),
      completeSummaryAvailable: false,
      matrixTotals: { total, passed, failed: failures, flaky: 0, skipped: 0 },
      playbackReliabilityPercent: total > 0 ? Number(((passed / total) * 100).toFixed(2)) : null,
      loadResults: [],
      screenshots,
      videos,
      networkLogs,
      consoleLogs,
      pageErrorFiles,
      playerStateFiles,
      failureCount: failures,
      notes: ['Browser root summary.json was not present, so metrics were inferred from case artifact directories.'],
    };
  }
};

export const buildNormalizedRun = (
  environment: string,
  mode: ContinuousMode,
  sourceReports: string[],
  loadSources: LoadRunSource[],
  browserSource: BrowserRunSource | null,
  tags: string[],
): NormalizedRunSummary => {
  const loadMetrics = createMetricSnapshot(loadSources.map((source) => source.metrics));
  const browserStabilityRate = browserSource?.playbackReliabilityPercent ?? (browserSource && browserSource.matrixTotals.total > 0
    ? Number(((browserSource.matrixTotals.passed + browserSource.matrixTotals.flaky) / browserSource.matrixTotals.total * 100).toFixed(2))
    : null);
  const metrics = createMetricSnapshot([loadMetrics, {
    firstFrameMs: loadMetrics.firstFrameMs,
    browserStabilityRate,
  }]);
  const totalUsers = loadSources.reduce((sum, source) => sum + source.usersRequested, 0);
  const successfulUsers = loadSources.reduce((sum, source) => sum + source.successfulJourneys, 0);
  const failedUsers = loadSources.reduce((sum, source) => sum + source.failedJourneys, 0);
  const artifacts = {
    screenshots: browserSource?.screenshots ?? 0,
    videos: browserSource?.videos ?? 0,
    networkLogs: browserSource?.networkLogs ?? 0,
    consoleLogs: browserSource?.consoleLogs ?? 0,
  };
  const playbackHealthScore = computePlaybackHealthScore(metrics);
  return {
    runId: nowIso().replace(/[:.]/g, '-'),
    environment,
    mode,
    createdAt: nowIso(),
    sourceReports,
    loadSources,
    browserSource,
    metrics,
    userJourney: {
      totalUsers,
      successfulUsers,
      failedUsers,
      startupSuccessRate: computeRate(successfulUsers, totalUsers),
    },
    artifacts,
    playbackHealthScore,
    playbackHealthLabel: severityFromHealthScore(playbackHealthScore),
    tags,
  };
};

export const computePlaybackHealthScore = (metrics: MetricSnapshot) => {
  const startup = metrics.startupSuccessRate ?? 0;
  const continuity = metrics.sustainedContinuityScore ?? startup;
  const bufferingPenalty = metrics.bufferingRatio == null ? 0 : Math.min(metrics.bufferingRatio * 300, 25);
  const latencyPenalty = metrics.mediaManifestP95Ms == null ? 0 : Math.min((metrics.mediaManifestP95Ms / 2000) * 10, 25);
  const recovery = metrics.recoverySuccessRate ?? 100;
  const browserStability = metrics.browserStabilityRate ?? 100;
  const failedRequestPenalty = metrics.failedRequestRate == null ? 0 : Math.min((metrics.failedRequestRate / 100) * 25, 20);
  const score = (startup * 0.3)
    + (continuity * 0.2)
    + (recovery * 0.15)
    + (browserStability * 0.1)
    + (Math.max(0, 100 - latencyPenalty * 4) * 0.15)
    + (Math.max(0, 100 - bufferingPenalty * 4) * 0.05)
    + (Math.max(0, 100 - failedRequestPenalty * 4) * 0.05);
  return Number(Math.max(0, Math.min(100, score)).toFixed(2));
};

export const severityFromHealthScore = (score: number): Severity => {
  if (score < 70) {
    return 'CRITICAL';
  }
  if (score < 85) {
    return 'WARNING';
  }
  return 'OK';
};

const compareDelta = (
  metric: keyof MetricSnapshot,
  baseline: number | null,
  current: number | null,
): MetricDelta => {
  if (baseline == null || current == null) {
    return {
      metric,
      baseline,
      current,
      deltaAbsolute: null,
      deltaPercent: null,
      severity: 'OK',
      reason: 'Insufficient data for comparison.',
    };
  }
  const deltaAbsolute = Number((current - baseline).toFixed(2));
  const deltaPercent = baseline === 0 ? null : Number((((current - baseline) / baseline) * 100).toFixed(2));
  let severity: Severity = 'OK';
  let reason = 'Within thresholds.';

  const increasedIsBad = ['mediaManifestP50Ms', 'mediaManifestP95Ms', 'mediaManifestP99Ms', 'firstFrameMs', 'bufferingRatio', 'interruptionRate', 'failedRequestRate'].includes(metric);
  const decreasedIsBad = ['startupSuccessRate', 'sustainedContinuityScore', 'recoverySuccessRate', 'cacheHitEffectiveness', 'browserStabilityRate'].includes(metric);

  if (increasedIsBad && deltaPercent != null) {
    const warn = metric === 'bufferingRatio' ? BUFFER_WARN_PCT : LATENCY_WARN_PCT;
    const fail = metric === 'bufferingRatio' ? BUFFER_FAIL_PCT : LATENCY_FAIL_PCT;
    if (deltaPercent >= fail) {
      severity = 'CRITICAL';
      reason = `${metric} increased by ${deltaPercent}% versus baseline.`;
    } else if (deltaPercent >= warn) {
      severity = 'WARNING';
      reason = `${metric} increased by ${deltaPercent}% versus baseline.`;
    }
  }

  if (decreasedIsBad && deltaPercent != null) {
    const drop = Math.abs(deltaPercent);
    const warn = metric === 'startupSuccessRate' ? SUCCESS_WARN_DROP
      : metric === 'sustainedContinuityScore' ? CONTINUITY_WARN_DROP
      : metric === 'browserStabilityRate' ? STABILITY_WARN_DROP
      : SUCCESS_WARN_DROP;
    const fail = metric === 'startupSuccessRate' ? SUCCESS_FAIL_DROP
      : metric === 'sustainedContinuityScore' ? CONTINUITY_FAIL_DROP
      : metric === 'browserStabilityRate' ? STABILITY_FAIL_DROP
      : SUCCESS_FAIL_DROP;
    if (current < baseline && drop >= fail) {
      severity = 'CRITICAL';
      reason = `${metric} dropped by ${drop}% versus baseline.`;
    } else if (current < baseline && drop >= warn) {
      severity = 'WARNING';
      reason = `${metric} dropped by ${drop}% versus baseline.`;
    }
  }

  return { metric, baseline, current, deltaAbsolute, deltaPercent, severity, reason };
};

export const buildRegressionReport = (
  environment: string,
  currentRun: NormalizedRunSummary,
  baseline: BaselineRecord | null,
): RegressionReport => {
  const metricKeys = Object.keys(currentRun.metrics) as Array<keyof MetricSnapshot>;
  const metricDeltas = metricKeys.map((metric) => compareDelta(metric, baseline?.metrics[metric] ?? null, currentRun.metrics[metric]));
  const overallSeverity = metricDeltas.some((delta) => delta.severity === 'CRITICAL')
    ? 'CRITICAL'
    : metricDeltas.some((delta) => delta.severity === 'WARNING')
      ? 'WARNING'
      : 'OK';
  const criticals = metricDeltas.filter((delta) => delta.severity === 'CRITICAL').map((delta) => delta.reason);
  const warnings = metricDeltas.filter((delta) => delta.severity === 'WARNING').map((delta) => delta.reason);
  return {
    environment,
    baselineRunId: baseline?.approvedRunId ?? null,
    currentRunId: currentRun.runId,
    overallSeverity,
    metricDeltas,
    warnings,
    criticals,
  };
};

const calcMovingAverage = (points: TrendPoint[]) => {
  const values = points.map((point) => point.value).filter(isNumber);
  if (!values.length) {
    return null;
  }
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
};

const calcDriftDirection = (points: TrendPoint[], increasedIsBad: boolean) => {
  const values = points.map((point) => point.value).filter(isNumber);
  if (values.length < 3) {
    return 'stable' as const;
  }
  const [a, b, c] = values.slice(-3);
  if (increasedIsBad && a < b && b < c) {
    return 'degrading' as const;
  }
  if (!increasedIsBad && a > b && b > c) {
    return 'degrading' as const;
  }
  if (increasedIsBad && a > b && b > c) {
    return 'improving' as const;
  }
  if (!increasedIsBad && a < b && b < c) {
    return 'improving' as const;
  }
  return 'stable' as const;
};

const calcAnomaly = (points: TrendPoint[]) => {
  const values = points.map((point) => point.value).filter(isNumber);
  if (values.length < 4) {
    return false;
  }
  const history = values.slice(0, -1);
  const current = values[values.length - 1];
  const mean = average(history);
  const variance = history.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / history.length;
  const stddev = Math.sqrt(variance);
  return stddev > 0 && Math.abs(current - mean) > (stddev * 2);
};

export const buildTrendReport = (environment: string, history: HistoricalRunEntry[]): TrendReport => {
  const seriesKeys: Array<keyof MetricSnapshot | 'playbackHealthScore'> = [
    'startupSuccessRate',
    'mediaManifestP50Ms',
    'mediaManifestP95Ms',
    'mediaManifestP99Ms',
    'firstFrameMs',
    'bufferingRatio',
    'interruptionRate',
    'sustainedContinuityScore',
    'recoverySuccessRate',
    'browserStabilityRate',
    'failedRequestRate',
    'playbackHealthScore',
  ];
  const series = seriesKeys.map((metric): TrendSeries => {
    const points = history.map((entry) => ({
      runId: entry.runId,
      createdAt: entry.createdAt,
      value: metric === 'playbackHealthScore' ? entry.playbackHealthScore : entry.metrics[metric],
    }));
    const increasedIsBad = ['mediaManifestP50Ms', 'mediaManifestP95Ms', 'mediaManifestP99Ms', 'firstFrameMs', 'bufferingRatio', 'interruptionRate', 'failedRequestRate'].includes(metric);
    return {
      metric,
      points,
      movingAverage: calcMovingAverage(points),
      driftDirection: calcDriftDirection(points, increasedIsBad),
      anomalyDetected: calcAnomaly(points),
    };
  });
  const warnings = series
    .filter((item) => item.anomalyDetected || item.driftDirection === 'degrading')
    .map((item) => `${item.metric} shows ${item.anomalyDetected ? 'anomalous behavior' : 'a degrading drift'}.`);
  return {
    environment,
    generatedAt: nowIso(),
    runCount: history.length,
    series,
    warnings,
  };
};

export const loadHistoricalIndex = async (environment: string) => {
  const filePath = path.join(monitoringDataRoot, environment, 'historical-runs-index.json');
  try {
    return await readJson<HistoricalRunEntry[]>(filePath);
  } catch {
    return [];
  }
};

export const loadBaseline = async (environment: string) => {
  const filePath = path.join(monitoringDataRoot, environment, 'baseline-metrics.json');
  try {
    return await readJson<BaselineRecord>(filePath);
  } catch {
    return null;
  }
};

export const persistMonitoringData = async (
  environment: string,
  history: HistoricalRunEntry[],
  baseline: BaselineRecord | null,
) => {
  const envDir = path.join(monitoringDataRoot, environment);
  await ensureDir(envDir);
  await writeJson(path.join(envDir, 'historical-runs-index.json'), history);
  if (baseline) {
    await writeJson(path.join(envDir, 'baseline-metrics.json'), baseline);
  }
  await writeJson(path.join(envDir, 'health-score-history.json'), history.map((entry) => ({
    runId: entry.runId,
    createdAt: entry.createdAt,
    environment: entry.environment,
    playbackHealthScore: entry.playbackHealthScore,
    playbackHealthLabel: entry.playbackHealthLabel,
  })));
};

export const normalizedRunToHistoryEntry = (run: NormalizedRunSummary): HistoricalRunEntry => ({
  runId: run.runId,
  createdAt: run.createdAt,
  environment: run.environment,
  mode: run.mode,
  tags: run.tags,
  sourceReports: run.sourceReports,
  metrics: run.metrics,
  playbackHealthScore: run.playbackHealthScore,
  playbackHealthLabel: run.playbackHealthLabel,
});

export const createBaselineRecord = (run: NormalizedRunSummary): BaselineRecord => ({
  environment: run.environment,
  approvedRunId: run.runId,
  approvedAt: nowIso(),
  tags: run.tags,
  metrics: run.metrics,
  playbackHealthScore: run.playbackHealthScore,
});

export const copyArtifacts = async (
  sourceDirs: string[],
  targetRoot: string,
) => {
  const buckets = {
    screenshots: path.join(targetRoot, 'screenshots'),
    videos: path.join(targetRoot, 'videos'),
    network: path.join(targetRoot, 'network'),
    console: path.join(targetRoot, 'console'),
  };
  await Promise.all(Object.values(buckets).map(ensureDir));
  const counts = {
    screenshots: 0,
    videos: 0,
    network: 0,
    console: 0,
  };
  for (const sourceDir of sourceDirs) {
    const files = await listFilesRecursive(sourceDir);
    for (const filePath of files) {
      const baseName = safeName(`${path.basename(sourceDir)}-${path.relative(sourceDir, filePath)}`);
      if (/\.(png|jpg|jpeg)$/i.test(filePath)) {
        await fs.copyFile(filePath, path.join(buckets.screenshots, baseName));
        counts.screenshots += 1;
      } else if (/\.(webm|mp4)$/i.test(filePath)) {
        await fs.copyFile(filePath, path.join(buckets.videos, baseName));
        counts.videos += 1;
      } else if (/network/i.test(path.basename(filePath))) {
        await fs.copyFile(filePath, path.join(buckets.network, baseName));
        counts.network += 1;
      } else if (/console/i.test(path.basename(filePath))) {
        await fs.copyFile(filePath, path.join(buckets.console, baseName));
        counts.console += 1;
      }
    }
  }
  return counts;
};

const renderMetricValue = (value: number | null, suffix = '') => value == null ? 'n/a' : `${value}${suffix}`;

export const renderRegressionHtml = (run: NormalizedRunSummary, regression: RegressionReport) => `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Regression Summary ${run.runId}</title>
  <style>
    body { font-family: Georgia, serif; margin: 24px; color: #1d1d1f; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    .OK { color: #1f7a1f; }
    .WARNING { color: #b06a00; }
    .CRITICAL { color: #b42318; }
  </style>
</head>
<body>
  <h1>Regression Summary</h1>
  <p>Environment: <strong>${run.environment}</strong></p>
  <p>Current run: <code>${run.runId}</code></p>
  <p>Baseline run: <code>${regression.baselineRunId ?? 'none'}</code></p>
  <p class="${regression.overallSeverity}">Overall severity: <strong>${regression.overallSeverity}</strong></p>
  <table>
    <thead>
      <tr><th>Metric</th><th>Baseline</th><th>Current</th><th>Delta %</th><th>Severity</th><th>Reason</th></tr>
    </thead>
    <tbody>
      ${regression.metricDeltas.map((delta) => `
        <tr>
          <td>${delta.metric}</td>
          <td>${renderMetricValue(delta.baseline)}</td>
          <td>${renderMetricValue(delta.current)}</td>
          <td>${renderMetricValue(delta.deltaPercent, '%')}</td>
          <td class="${delta.severity}">${delta.severity}</td>
          <td>${delta.reason}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>
</body>
</html>`;

export const renderTrendHtml = (trend: TrendReport) => `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Trend Dashboard ${trend.environment}</title>
  <style>
    body { font-family: Georgia, serif; margin: 24px; color: #1d1d1f; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
  </style>
</head>
<body>
  <h1>Trend Dashboard</h1>
  <p>Environment: <strong>${trend.environment}</strong></p>
  <p>Runs tracked: <strong>${trend.runCount}</strong></p>
  <table>
    <thead>
      <tr><th>Metric</th><th>Moving Avg</th><th>Drift</th><th>Anomaly</th><th>Latest</th></tr>
    </thead>
    <tbody>
      ${trend.series.map((series) => `
        <tr>
          <td>${series.metric}</td>
          <td>${renderMetricValue(series.movingAverage)}</td>
          <td>${series.driftDirection}</td>
          <td>${series.anomalyDetected ? 'yes' : 'no'}</td>
          <td>${renderMetricValue(series.points[series.points.length - 1]?.value ?? null)}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>
</body>
</html>`;

export const renderRunDashboardHtml = (run: NormalizedRunSummary, regression: RegressionReport, trend: TrendReport) => `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Run Dashboard ${run.runId}</title>
  <style>
    body { font-family: Georgia, serif; margin: 24px; color: #1d1d1f; }
    .hero { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; margin-bottom: 24px; }
    .card { border: 1px solid #ddd; padding: 16px; border-radius: 12px; background: #faf8f3; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    input, select { padding: 8px; margin-right: 8px; }
    .OK { color: #1f7a1f; }
    .WARNING { color: #b06a00; }
    .CRITICAL { color: #b42318; }
  </style>
</head>
<body>
  <h1>Playback Health Run Dashboard</h1>
  <p>Run: <code>${run.runId}</code> | Environment: <strong>${run.environment}</strong> | Mode: <strong>${run.mode}</strong></p>
  <div class="hero">
    <div class="card"><strong>Health Score</strong><br/>${run.playbackHealthScore}</div>
    <div class="card"><strong>Startup Success</strong><br/>${renderMetricValue(run.metrics.startupSuccessRate, '%')}</div>
    <div class="card"><strong>Manifest p95</strong><br/>${renderMetricValue(run.metrics.mediaManifestP95Ms, ' ms')}</div>
    <div class="card"><strong>Browser Stability</strong><br/>${renderMetricValue(run.metrics.browserStabilityRate, '%')}</div>
  </div>

  <h2>Metric Comparison</h2>
  <label>Filter metric <input id="metricFilter" placeholder="mediaManifest" /></label>
  <label>Filter severity
    <select id="severityFilter">
      <option value="">all</option>
      <option value="OK">OK</option>
      <option value="WARNING">WARNING</option>
      <option value="CRITICAL">CRITICAL</option>
    </select>
  </label>
  <table id="metricsTable">
    <thead>
      <tr><th>Metric</th><th>Baseline</th><th>Current</th><th>Delta %</th><th>Severity</th><th>Reason</th></tr>
    </thead>
    <tbody>
      ${regression.metricDeltas.map((delta) => `
        <tr data-metric="${delta.metric}" data-severity="${delta.severity}">
          <td>${delta.metric}</td>
          <td>${renderMetricValue(delta.baseline)}</td>
          <td>${renderMetricValue(delta.current)}</td>
          <td>${renderMetricValue(delta.deltaPercent, '%')}</td>
          <td class="${delta.severity}">${delta.severity}</td>
          <td>${delta.reason}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <h2>Course Impact</h2>
  <label>Filter course <input id="courseFilter" placeholder="hot-course" /></label>
  <table id="courseTable">
    <thead><tr><th>Source</th><th>Course</th><th>Lesson</th><th>Weight</th><th>Mode</th></tr></thead>
    <tbody>
      ${run.loadSources.flatMap((source) => source.courseAssignments.map((assignment) => `
        <tr data-course="${String(assignment.label || assignment.courseId || '')}">
          <td>${path.basename(source.sourcePath)}</td>
          <td>${String(assignment.courseId || 'n/a')}</td>
          <td>${String(assignment.lessonId || 'n/a')}</td>
          <td>${String(assignment.weight || 'n/a')}</td>
          <td>${source.watchMode ?? 'startup'}</td>
        </tr>
      `)).join('')}
    </tbody>
  </table>

  <h2>Failure Breakdown</h2>
  <label>Filter failure <input id="failureFilter" placeholder="timeout" /></label>
  <table>
    <thead><tr><th>Source</th><th>Failures</th><th>Notes</th></tr></thead>
    <tbody>
      ${run.loadSources.map((source) => `
        <tr data-failure="${source.issues.map((issue) => String(issue.type || issue.name || issue.message || '')).join(' ').toLowerCase()}">
          <td>${path.basename(source.sourcePath)}</td>
          <td>${source.failedJourneys}</td>
          <td>${source.issues.length ? source.issues.map((issue) => String(issue.type || issue.name || issue.message || 'issue')).join(', ') : (source.watchMode ?? 'startup')}</td>
        </tr>
      `).join('')}
      ${run.browserSource ? `
        <tr data-failure="${run.browserSource.notes.join(' ').toLowerCase()}">
          <td>${path.basename(run.browserSource.sourcePath)}</td>
          <td>${run.browserSource.failureCount}</td>
          <td>${run.browserSource.notes.join(' ') || 'browser validation'}</td>
        </tr>
      ` : ''}
    </tbody>
  </table>

  <h2>User Journey Funnel</h2>
  <table>
    <thead><tr><th>Total</th><th>Successful</th><th>Failed</th><th>Startup Success %</th></tr></thead>
    <tbody>
      <tr>
        <td>${run.userJourney.totalUsers}</td>
        <td>${run.userJourney.successfulUsers}</td>
        <td>${run.userJourney.failedUsers}</td>
        <td>${renderMetricValue(run.userJourney.startupSuccessRate, '%')}</td>
      </tr>
    </tbody>
  </table>

  <h2>Per-user Drilldown</h2>
  <label>Filter user <input id="userFilter" placeholder="0 / hot-course" /></label>
  <table id="userTable">
    <thead><tr><th>Source</th><th>User</th><th>Course Label</th><th>Playback Seconds</th><th>Interruptions</th><th>Retries</th><th>Stalls</th><th>Completed</th></tr></thead>
    <tbody>
      ${run.loadSources.flatMap((source) => source.drilldownUsers.map((user) => `
        <tr data-user="${String(user.userIndex ?? user.viewerId ?? '')} ${String(user.assignmentLabel ?? '')}">
          <td>${path.basename(source.sourcePath)}</td>
          <td>${String(user.userIndex ?? user.viewerId ?? 'n/a')}</td>
          <td>${String(user.assignmentLabel ?? 'n/a')}</td>
          <td>${String(user.playbackSecondsAdvanced ?? user.playbackSeconds ?? 'n/a')}</td>
          <td>${String(user.interruptions ?? 'n/a')}</td>
          <td>${String(user.retries ?? 'n/a')}</td>
          <td>${String(user.stalls ?? 'n/a')}</td>
          <td>${String(user.completed ?? 'n/a')}</td>
        </tr>
      `)).join('')}
    </tbody>
  </table>

  <h2>Trend Snapshot</h2>
  <table>
    <thead><tr><th>Metric</th><th>Moving Avg</th><th>Drift</th><th>Anomaly</th></tr></thead>
    <tbody>
      ${trend.series.map((series) => `
        <tr>
          <td>${series.metric}</td>
          <td>${renderMetricValue(series.movingAverage)}</td>
          <td>${series.driftDirection}</td>
          <td>${series.anomalyDetected ? 'yes' : 'no'}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <script>
    const metricFilter = document.getElementById('metricFilter');
    const severityFilter = document.getElementById('severityFilter');
    const rows = Array.from(document.querySelectorAll('#metricsTable tbody tr'));
    const courseFilter = document.getElementById('courseFilter');
    const courseRows = Array.from(document.querySelectorAll('#courseTable tbody tr'));
    const failureFilter = document.getElementById('failureFilter');
    const failureRows = Array.from(document.querySelectorAll('table tbody tr[data-failure]'));
    const userFilter = document.getElementById('userFilter');
    const userRows = Array.from(document.querySelectorAll('#userTable tbody tr'));
    const apply = () => {
      const metricValue = metricFilter.value.toLowerCase();
      const severityValue = severityFilter.value;
      const courseValue = courseFilter.value.toLowerCase();
      const failureValue = failureFilter.value.toLowerCase();
      const userValue = userFilter.value.toLowerCase();
      rows.forEach((row) => {
        const metric = row.dataset.metric.toLowerCase();
        const severity = row.dataset.severity;
        const visible = (!metricValue || metric.includes(metricValue)) && (!severityValue || severity === severityValue);
        row.style.display = visible ? '' : 'none';
      });
      courseRows.forEach((row) => {
        const course = (row.dataset.course || '').toLowerCase();
        row.style.display = (!courseValue || course.includes(courseValue)) ? '' : 'none';
      });
      failureRows.forEach((row) => {
        const failure = (row.dataset.failure || '').toLowerCase();
        row.style.display = (!failureValue || failure.includes(failureValue)) ? '' : 'none';
      });
      userRows.forEach((row) => {
        const user = (row.dataset.user || '').toLowerCase();
        row.style.display = (!userValue || user.includes(userValue)) ? '' : 'none';
      });
    };
    metricFilter.addEventListener('input', apply);
    severityFilter.addEventListener('change', apply);
    courseFilter.addEventListener('input', apply);
    failureFilter.addEventListener('input', apply);
    userFilter.addEventListener('input', apply);
  </script>
</body>
</html>`;

export const createReproCase = async (
  runDir: string,
  run: NormalizedRunSummary,
  regression: RegressionReport,
) => {
  const reproDir = path.join(runDir, 'repro-case');
  await ensureDir(reproDir);
  const criticalMetric = regression.metricDeltas.find((delta) => delta.severity === 'CRITICAL') || regression.metricDeltas.find((delta) => delta.severity === 'WARNING') || null;
  const primaryLoad = run.loadSources[0] || null;
  const replayCommand = primaryLoad
    ? `QA_BASE_URL=<env> COURSE_LOAD_USERS=${Math.max(10, Math.min(primaryLoad.usersRequested, 50))} COURSE_LOAD_ACTIVE_CONCURRENCY=${Math.max(10, Math.min(primaryLoad.usersRequested, 50))} npm --prefix qa-automation run load:course-video`
    : 'npm --prefix qa-automation run qa:course-video:production';
  const config = {
    environment: run.environment,
    sourceRunId: run.runId,
    criticalMetric: criticalMetric?.metric ?? null,
    reason: criticalMetric?.reason ?? 'No critical metric detected.',
    replayCommand,
    sourceReports: run.sourceReports,
  };
  await writeJson(path.join(reproDir, 'config.json'), config);
  await writeText(path.join(reproDir, 'replay-command.txt'), replayCommand);
  await writeJson(path.join(reproDir, 'playback-timeline.json'), {
    metrics: run.metrics,
    userJourney: run.userJourney,
    regression: regression.metricDeltas,
  });
  return reproDir;
};

export const emitAlerts = async (
  run: NormalizedRunSummary,
  regression: RegressionReport,
  webhookUrl: string | null,
  outputPath: string,
) => {
  const message = regression.overallSeverity === 'OK'
    ? `QA_ALERT: OK ${run.environment} playback health score ${run.playbackHealthScore}`
    : `QA_ALERT: ${regression.overallSeverity} ${regression.criticals[0] || regression.warnings[0] || 'regression detected'}`;
  let webhookDelivered = false;
  const payload: AlertPayload = {
    environment: run.environment,
    runId: run.runId,
    severity: regression.overallSeverity,
    message,
    criticals: regression.criticals,
    warnings: regression.warnings,
    webhookDelivered,
  };
  if (webhookUrl && regression.overallSeverity !== 'OK') {
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      webhookDelivered = response.ok;
      payload.webhookDelivered = webhookDelivered;
    } catch {
      webhookDelivered = false;
      payload.webhookDelivered = false;
    }
  }
  await writeJson(outputPath, payload);
  console.log(message);
  return payload;
};

export const executeCommand = async (command: string, cwd: string) => {
  const { spawn } = await import('node:child_process');
  return await new Promise<{ code: number | null }>((resolve, reject) => {
    const child = spawn(command, { cwd, shell: true, stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code }));
  });
};

export const defaultCommandForMode = (mode: ContinuousMode) => {
  if (mode === 'continuous-light') {
    return 'npm --prefix qa-automation run qa:course-video:matrix';
  }
  if (mode === 'continuous-full') {
    return 'npm --prefix qa-automation run qa:course-video:production';
  }
  return '';
};

export const latestHealthScore = async (environment: string) => {
  const history = await loadHistoricalIndex(environment);
  return history[history.length - 1]?.playbackHealthScore ?? null;
};

export const buildRunIndexEntry = (run: NormalizedRunSummary) => ({
  runId: run.runId,
  environment: run.environment,
  mode: run.mode,
  createdAt: run.createdAt,
  playbackHealthScore: run.playbackHealthScore,
  playbackHealthLabel: run.playbackHealthLabel,
});

export const writeSampleRunFiles = async (runDir: string, run: NormalizedRunSummary, regression: RegressionReport, trend: TrendReport) => {
  await Promise.all([
    writeJson(path.join(runDir, 'summary.json'), run),
    writeJson(path.join(runDir, 'baseline-comparison.json'), regression),
    writeJson(path.join(runDir, 'regression-report.json'), regression),
    writeJson(path.join(runDir, 'trend-data.json'), trend),
    writeJson(path.join(runDir, 'trend-report.json'), trend),
    writeJson(path.join(runDir, 'health-score.json'), {
      runId: run.runId,
      environment: run.environment,
      playbackHealthScore: run.playbackHealthScore,
      label: run.playbackHealthLabel,
    }),
    writeText(path.join(runDir, 'regression-summary.html'), renderRegressionHtml(run, regression)),
    writeText(path.join(runDir, 'trend-dashboard.html'), renderTrendHtml(trend)),
    writeText(path.join(runDir, 'run-dashboard.html'), renderRunDashboardHtml(run, regression, trend)),
  ]);
};
