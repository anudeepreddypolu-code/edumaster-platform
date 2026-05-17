import path from 'node:path';
import {
  boolEnv,
  buildNormalizedRun,
  buildRegressionReport,
  buildRunIndexEntry,
  buildTrendReport,
  copyArtifacts,
  createBaselineRecord,
  createReproCase,
  defaultCommandForMode,
  discoverLatestReport,
  emitAlerts,
  ensureDir,
  executeCommand,
  ingestBrowserSource,
  ingestLoadSource,
  latestHealthScore,
  loadBaseline,
  loadHistoricalIndex,
  monitoringDataRoot,
  normalizedRunToHistoryEntry,
  persistMonitoringData,
  qaRoot,
  runsRoot,
  writeJson,
  writeSampleRunFiles,
  writeText,
} from './monitoring/lib.js';
import { ContinuousMode, HistoricalRunEntry } from './monitoring/types.js';

const mode = ((process.env.QA_MONITOR_MODE || 'manual-trigger') as ContinuousMode);
const environment = process.env.QA_MONITOR_ENV || 'prod';
const shouldExecute = boolEnv(process.env.QA_MONITOR_EXECUTE, false);
const approveBaseline = boolEnv(process.env.QA_MONITOR_APPROVE_BASELINE, false);
const autoCompare = boolEnv(process.env.QA_MONITOR_AUTO_COMPARE, true);
const webhookUrl = process.env.QA_MONITOR_WEBHOOK_URL || null;
const tags = (process.env.QA_MONITOR_TAGS || mode).split(',').map((item) => item.trim()).filter(Boolean);

const parseList = (value: string | undefined) => (value || '').split(',').map((item) => item.trim()).filter(Boolean);

const resolveLoadSources = async () => {
  const configured = parseList(process.env.QA_MONITOR_LOAD_REPORTS);
  if (configured.length) {
    return configured;
  }
  const latestSustained = await discoverLatestReport('course-video-sustained-', 'full-course-video-report.json');
  const latestDirect = await discoverLatestReport('course-video-direct-', 'full-course-video-report.json');
  const latestProduction = await discoverLatestReport('course-video-production-ladder-', 'full-course-video-report.json');
  return [latestSustained, latestDirect, latestProduction].filter((item): item is string => Boolean(item));
};

const resolveBrowserSource = async () => {
  const configured = process.env.QA_MONITOR_BROWSER_REPORT;
  if (configured) {
    return configured;
  }
  return await discoverLatestReport('course-video-production-qa-');
};

const runContinuousCommandIfNeeded = async () => {
  if (!shouldExecute) {
    return;
  }
  const command = process.env.QA_MONITOR_COMMAND || defaultCommandForMode(mode);
  if (!command) {
    return;
  }
  const result = await executeCommand(command, qaRoot);
  if (result.code !== 0) {
    throw new Error(`Continuous monitor command failed with code ${result.code}: ${command}`);
  }
};

const renderHumanSummary = (
  runId: string,
  runDir: string,
  startupSuccess: number | null,
  manifestP95: number | null,
  healthScore: number,
  previousHealthScore: number | null,
) => `# Continuous QA Monitor

- Run ID: ${runId}
- Environment: ${environment}
- Mode: ${mode}
- Startup success: ${startupSuccess ?? 'n/a'}%
- Media manifest p95: ${manifestP95 ?? 'n/a'} ms
- Playback health score: ${healthScore}
- Previous health score: ${previousHealthScore ?? 'n/a'}
- Run directory: ${runDir}
- Monitoring data: ${path.join(monitoringDataRoot, environment)}
`;

const main = async () => {
  await runContinuousCommandIfNeeded();

  const loadSourcePaths = await resolveLoadSources();
  if (!loadSourcePaths.length) {
    throw new Error('No load report sources were found. Set QA_MONITOR_LOAD_REPORTS or generate at least one course-video report first.');
  }
  const browserSourcePath = await resolveBrowserSource();

  const loadSources = await Promise.all(loadSourcePaths.map((sourcePath) => ingestLoadSource(sourcePath)));
  const browserSource = browserSourcePath ? await ingestBrowserSource(browserSourcePath) : null;
  const sourceReports = [...loadSourcePaths, ...(browserSourcePath ? [browserSourcePath] : [])];
  const normalizedRun = buildNormalizedRun(environment, mode, sourceReports, loadSources, browserSource, tags);

  const runDir = path.join(runsRoot, normalizedRun.runId);
  await ensureDir(runDir);
  await copyArtifacts(sourceReports.filter((item) => !item.endsWith('.json')), runDir);
  await writeJson(path.join(runDir, 'source-manifest.json'), { sourceReports, loadSources, browserSource });

  const history = await loadHistoricalIndex(environment);
  const previousHealth = await latestHealthScore(environment);
  const baseline = await loadBaseline(environment);
  const regression = autoCompare ? buildRegressionReport(environment, normalizedRun, baseline) : buildRegressionReport(environment, normalizedRun, null);
  const nextHistory: HistoricalRunEntry[] = [...history, normalizedRunToHistoryEntry(normalizedRun)];
  const trend = buildTrendReport(environment, nextHistory);
  const effectiveBaseline = approveBaseline || !baseline ? createBaselineRecord(normalizedRun) : baseline;

  await writeSampleRunFiles(runDir, normalizedRun, regression, trend);
  await createReproCase(runDir, normalizedRun, regression);
  await emitAlerts(normalizedRun, regression, webhookUrl, path.join(runDir, 'alert-payload.json'));
  await persistMonitoringData(environment, nextHistory, effectiveBaseline);
  await writeJson(path.join(runDir, 'run-index-entry.json'), buildRunIndexEntry(normalizedRun));
  await writeText(
    path.join(runDir, 'monitor-summary.md'),
    renderHumanSummary(
      normalizedRun.runId,
      runDir,
      normalizedRun.metrics.startupSuccessRate,
      normalizedRun.metrics.mediaManifestP95Ms,
      normalizedRun.playbackHealthScore,
      previousHealth,
    ),
  );

  console.log(`Continuous monitor run complete: ${runDir}`);
};

main().catch((error) => {
  console.error('Continuous course-video monitor failed:', error);
  process.exitCode = 1;
});
