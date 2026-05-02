import path from 'node:path';
import { runAudit } from './runner.js';
import { writeText } from './utils.js';

const buildLoopSummary = (result: Awaited<ReturnType<typeof runAudit>>) => {
  const lines = [
    '# Continuous QA Loop',
    '',
    'Test -> Screenshot -> Analyze -> Improve -> Update UI',
    '',
    `Captures: ${result.captures.length}`,
    `Failures: ${result.failures.length}`,
    `Findings: ${result.findings.length}`,
    '',
    '## Top Issues',
    ...result.failures.slice(0, 5).map((failure) => `- [${failure.severity}] ${failure.title}: ${failure.description}`),
    '',
    '## Top UX Recommendations',
    ...result.findings.slice(0, 5).map((finding) => `- ${finding.recommendation}`),
    '',
    `Generated Flutter file: ${result.generatedFlutterFile || 'n/a'}`,
  ];
  return lines.join('\n');
};

runAudit()
  .then(async (result) => {
    const loopReportPath = path.join(path.dirname(result.generatedFlutterFile || '.'), 'loop-summary.md');
    await writeText(loopReportPath, buildLoopSummary(result));
    console.log(`Continuous loop completed. Summary: ${loopReportPath}`);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
