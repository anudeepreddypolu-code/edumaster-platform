import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { CaptureRecord, FailureRecord, UxFinding } from './types.js';

const heuristicFindings = (captures: CaptureRecord[], failures: FailureRecord[]): UxFinding[] => {
  const findings: UxFinding[] = [];
  const navScreens = captures.filter((capture) => ['ui', 'success'].includes(capture.state));
  const hasSearch = captures.some((capture) => capture.label.toLowerCase().includes('search'));
  const hasSlowFailures = failures.some((failure) => failure.title === 'Slow screen transition');
  const hasOverflowRisk = failures.some((failure) => failure.title === 'Potential layout overflow risk');

  if (navScreens.length >= 5) {
    findings.push({
      category: 'navigation',
      severity: 'medium',
      title: 'High feature density across primary navigation',
      evidence: 'The app exposes many top-level destinations, which can increase cognitive load on smaller Android devices.',
      recommendation: 'Keep bottom navigation focused on 4-5 destinations and move secondary tools like revision and analytics into contextual entry points or a "More" surface.',
    });
  }

  if (hasSlowFailures) {
    findings.push({
      category: 'responsiveness',
      severity: 'high',
      title: 'Perceived loading speed needs stronger feedback',
      evidence: 'At least one core screen crossed the configured slow threshold.',
      recommendation: 'Add skeleton loaders and preserve layout while data loads so transitions feel intentional instead of blocked.',
    });
  }

  if (hasOverflowRisk) {
    findings.push({
      category: 'spacing',
      severity: 'medium',
      title: 'Some layouts may be too rigid for Android widths',
      evidence: 'DOM heuristics suggest fixed-height or fixed-width regions in complex screens.',
      recommendation: 'Reduce fixed panel heights, prefer stacked sections on narrow screens, and make large data cards wrap more aggressively.',
    });
  }

  if (!hasSearch) {
    findings.push({
      category: 'clarity',
      severity: 'low',
      title: 'Global search was not surfaced during audit',
      evidence: 'Cross-feature discovery becomes harder when students must manually browse every module.',
      recommendation: 'Keep search persistent in the shell and expose quick actions for lessons, mocks, and live classes.',
    });
  }

  findings.push({
    category: 'hierarchy',
    severity: 'medium',
    title: 'Information hierarchy should prioritize student actions over raw density',
    evidence: 'Dashboard, analytics, and practice surfaces contain many cards and metrics competing for attention.',
    recommendation: 'Lead each screen with one primary action, one progress summary, and move secondary metrics below the fold.',
  });

  findings.push({
    category: 'visual-noise',
    severity: 'medium',
    title: 'The product would benefit from calmer visual grouping',
    evidence: 'Many surfaces use similarly weighted cards, making it harder to distinguish primary vs secondary information.',
    recommendation: 'Use quieter containers for supporting information, stronger section spacing, and one accent surface per screen.',
  });

  return findings;
};

const maybeRunVisionAnalysis = async (captures: CaptureRecord[]): Promise<UxFinding[]> => {
  if (!config.openAiApiKey || captures.length === 0) {
    return [];
  }

  const sample = captures.slice(0, 3);
  const content = await Promise.all(sample.map(async (capture) => {
    const imageBase64 = await fs.readFile(capture.screenshotPath, 'base64');
    return {
      type: 'input_image',
      image_url: `data:image/png;base64,${imageBase64}`,
    };
  }));

  const response = await fetch(`${config.openAiBaseUrl}/responses`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.openAiApiKey}`,
    },
    body: JSON.stringify({
      model: config.openAiModel,
      input: [{
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: 'Analyze these mobile-web screenshots for clutter, spacing, visual hierarchy, confusing navigation, and general UX quality. Return concise JSON array items with category, severity, title, evidence, recommendation.'
          },
          ...content,
        ],
      }],
      text: {
        format: {
          type: 'json_schema',
          name: 'ux_findings',
          schema: {
            type: 'object',
            properties: {
              findings: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    category: { type: 'string' },
                    severity: { type: 'string' },
                    title: { type: 'string' },
                    evidence: { type: 'string' },
                    recommendation: { type: 'string' }
                  },
                  required: ['category', 'severity', 'title', 'evidence', 'recommendation'],
                  additionalProperties: false
                }
              }
            },
            required: ['findings'],
            additionalProperties: false
          }
        }
      }
    }),
  });

  if (!response.ok) {
    throw new Error(`Vision analysis failed with status ${response.status}`);
  }

  const payload = await response.json() as { output_text?: string };
  const parsed = JSON.parse(payload.output_text || '{"findings":[]}') as { findings: UxFinding[] };
  return parsed.findings || [];
};

export const analyzeUx = async (captures: CaptureRecord[], failures: FailureRecord[]): Promise<UxFinding[]> => {
  const findings = heuristicFindings(captures, failures);

  try {
    const aiFindings = await maybeRunVisionAnalysis(captures);
    return [...findings, ...aiFindings];
  } catch (error) {
    return [
      ...findings,
      {
        category: 'clarity',
        severity: 'low',
        title: 'Vision analysis provider unavailable',
        evidence: error instanceof Error ? error.message : 'AI screenshot analysis could not run.',
        recommendation: 'Use the heuristic findings now, then enable OPENAI_API_KEY later for screenshot-level visual review.',
      },
    ];
  }
};

export const findingsToMarkdown = (findings: UxFinding[]) => {
  const lines = ['# UX Analysis', ''];
  for (const finding of findings) {
    lines.push(`## ${finding.title}`);
    lines.push(`- Category: ${finding.category}`);
    lines.push(`- Severity: ${finding.severity}`);
    lines.push(`- Evidence: ${finding.evidence}`);
    lines.push(`- Recommendation: ${finding.recommendation}`);
    lines.push('');
  }
  return lines.join('\n');
};
