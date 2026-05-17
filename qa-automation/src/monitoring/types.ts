export type Severity = 'OK' | 'WARNING' | 'CRITICAL';

export type ContinuousMode = 'continuous-light' | 'continuous-full' | 'manual-trigger';

export interface MetricSnapshot {
  startupSuccessRate: number | null;
  mediaManifestP50Ms: number | null;
  mediaManifestP95Ms: number | null;
  mediaManifestP99Ms: number | null;
  firstFrameMs: number | null;
  bufferingRatio: number | null;
  interruptionRate: number | null;
  sustainedContinuityScore: number | null;
  recoverySuccessRate: number | null;
  cacheHitEffectiveness: number | null;
  browserStabilityRate: number | null;
  failedRequestRate: number | null;
}

export interface LoadRunSource {
  type: 'load';
  sourcePath: string;
  reportPath: string;
  runId: string;
  reportPrefix: string;
  usersRequested: number;
  successfulJourneys: number;
  failedJourneys: number;
  totalRequests: number;
  failedRequests: number;
  wallClockMs: number | null;
  watchMode: string | null;
  courseAssignments: Array<Record<string, unknown>>;
  metrics: MetricSnapshot;
  endpointSummary: Array<Record<string, unknown>>;
  issues: Array<Record<string, unknown>>;
  journeyTelemetrySummary: Record<string, unknown> | null;
  resourceTelemetrySamples: number;
  drilldownUsers: Array<Record<string, unknown>>;
}

export interface BrowserRunSource {
  type: 'browser';
  sourcePath: string;
  runId: string;
  completeSummaryAvailable: boolean;
  matrixTotals: {
    total: number;
    passed: number;
    failed: number;
    flaky: number;
    skipped: number;
  };
  playbackReliabilityPercent: number | null;
  loadResults: Array<Record<string, unknown>>;
  screenshots: number;
  videos: number;
  networkLogs: number;
  consoleLogs: number;
  pageErrorFiles: number;
  playerStateFiles: number;
  failureCount: number;
  notes: string[];
}

export interface NormalizedRunSummary {
  runId: string;
  environment: string;
  mode: ContinuousMode;
  createdAt: string;
  sourceReports: string[];
  loadSources: LoadRunSource[];
  browserSource: BrowserRunSource | null;
  metrics: MetricSnapshot;
  userJourney: {
    totalUsers: number;
    successfulUsers: number;
    failedUsers: number;
    startupSuccessRate: number | null;
  };
  artifacts: {
    screenshots: number;
    videos: number;
    networkLogs: number;
    consoleLogs: number;
  };
  playbackHealthScore: number;
  playbackHealthLabel: Severity;
  tags: string[];
}

export interface BaselineRecord {
  environment: string;
  approvedRunId: string;
  approvedAt: string;
  tags: string[];
  metrics: MetricSnapshot;
  playbackHealthScore: number;
}

export interface HistoricalRunEntry {
  runId: string;
  createdAt: string;
  environment: string;
  mode: ContinuousMode;
  tags: string[];
  sourceReports: string[];
  metrics: MetricSnapshot;
  playbackHealthScore: number;
  playbackHealthLabel: Severity;
}

export interface MetricDelta {
  metric: keyof MetricSnapshot;
  baseline: number | null;
  current: number | null;
  deltaAbsolute: number | null;
  deltaPercent: number | null;
  severity: Severity;
  reason: string;
}

export interface RegressionReport {
  environment: string;
  baselineRunId: string | null;
  currentRunId: string;
  overallSeverity: Severity;
  metricDeltas: MetricDelta[];
  warnings: string[];
  criticals: string[];
}

export interface TrendPoint {
  runId: string;
  createdAt: string;
  value: number | null;
}

export interface TrendSeries {
  metric: keyof MetricSnapshot | 'playbackHealthScore';
  points: TrendPoint[];
  movingAverage: number | null;
  driftDirection: 'improving' | 'stable' | 'degrading';
  anomalyDetected: boolean;
}

export interface TrendReport {
  environment: string;
  generatedAt: string;
  runCount: number;
  series: TrendSeries[];
  warnings: string[];
}

export interface AlertPayload {
  environment: string;
  runId: string;
  severity: Severity;
  message: string;
  criticals: string[];
  warnings: string[];
  webhookDelivered: boolean;
}
