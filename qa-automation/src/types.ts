export type CaptureState = 'loading' | 'empty' | 'error' | 'success' | 'ui';

export type FailureSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface StepDefinition {
  id: string;
  label: string;
  requiredSelectors?: string[];
  expectedTexts?: string[];
}

export interface RunConfig {
  baseUrl: string;
  appiumHost: string;
  appiumPort: number;
  androidDeviceName: string;
  browserName: string;
  loginEmail: string;
  loginPassword: string;
  slowThresholdMs: number;
  openAiApiKey?: string;
  openAiBaseUrl: string;
  openAiModel: string;
}

export interface RunContext {
  runId: string;
  rootDir: string;
  screenshotDir: string;
  sourceDir: string;
  logDir: string;
  analysisDir: string;
  flutterDir: string;
}

export interface CaptureRecord {
  stepId: string;
  label: string;
  state: CaptureState;
  durationMs: number;
  screenshotPath: string;
  sourcePath: string;
  timestamp: string;
  notes?: string[];
}

export interface FailureRecord {
  stepId: string;
  title: string;
  description: string;
  severity: FailureSeverity;
  timestamp: string;
  screenshotPath?: string;
}

export interface UxFinding {
  category: 'spacing' | 'navigation' | 'hierarchy' | 'clarity' | 'responsiveness' | 'visual-noise';
  severity: FailureSeverity;
  title: string;
  evidence: string;
  recommendation: string;
}

export interface AuditSummary {
  captures: CaptureRecord[];
  failures: FailureRecord[];
  findings: UxFinding[];
  generatedFlutterFile?: string;
}
