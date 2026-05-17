import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { config } from './config.js';
import { qaFetch } from './network.js';

type Json = Record<string, unknown>;

type Metric = {
  name: string;
  method: string;
  path: string;
  status: number;
  ok: boolean;
  durationMs: number;
  user?: string;
  clientProfile?: string;
  bytes?: number;
  error?: string;
};

type Issue = {
  severity: 'Critical' | 'High' | 'Medium' | 'Low';
  whatBroke: string;
  where: string;
  exactErrorMessage: string;
  stepsToReproduce: string;
  userCountDuringFailure: number;
  apiServerResponse?: unknown;
  suggestedFix: string;
};

type LoadUser = {
  index: number;
  email: string;
  token: string;
  userId: string | null;
  name: string;
};

const runId = new Date().toISOString().replace(/[:.]/g, '-');
const rootDir = path.resolve(process.cwd());
const reportDir = path.join(rootDir, 'reports', `platform-1000-${runId}`);
const manifestPath = path.join(reportDir, 'prepared-users.json');
const configuredBaseUrl = process.env.QA_BASE_URL || config.baseUrl || 'http://127.0.0.1:3300';
const apiOrigin = (() => {
  const url = new URL(configuredBaseUrl);
  if (url.hostname === '10.0.2.2') {
    url.hostname = '127.0.0.1';
  }
  return url.origin;
})();
const apiBase = `${apiOrigin}/backend/api`;

const VUS = Math.max(1, Number(process.env.PLATFORM_LOAD_USERS || 1000));
const SETUP_CONCURRENCY = Math.max(1, Number(process.env.PLATFORM_LOAD_SETUP_CONCURRENCY || 50));
const ACTIVE_CONCURRENCY = Math.max(1, Number(process.env.PLATFORM_LOAD_ACTIVE_CONCURRENCY || VUS));
const REQUEST_TIMEOUT_MS = Math.max(1000, Number(process.env.PLATFORM_LOAD_TIMEOUT_MS || 30000));
const USER_PASSWORD = process.env.PLATFORM_LOAD_USER_PASSWORD || 'Student@123';
const ADMIN_EMAIL = process.env.QA_ADMIN_EMAIL || process.env.ADMIN_EMAIL || process.env.QA_LOGIN_EMAIL || config.loginEmail;
const ADMIN_PASSWORD = process.env.QA_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || process.env.QA_LOGIN_PASSWORD || config.loginPassword;
const EXISTING_USERS_FILE = process.env.PLATFORM_LOAD_USERS_FILE || '';
const PARTIAL_REPORT_INTERVAL_MS = Math.max(5000, Number(process.env.PLATFORM_LOAD_PARTIAL_REPORT_MS || 30000));

const metrics: Metric[] = [];
const issues: Issue[] = [];
const progress = {
  phase: 'initializing',
  preparedUsers: 0,
  startedJourneys: 0,
  completedJourneys: 0,
  successfulJourneys: 0,
};

const percentile = (values: number[], target: number) => {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((target / 100) * sorted.length) - 1));
  return sorted[index];
};

const average = (values: number[]) =>
  values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;

const pickId = (value: unknown): string | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const item = value as Record<string, unknown>;
  const direct = item._id || item.id;
  return direct ? String(direct) : null;
};

const getClientProfile = (user?: string) => {
  const index = Number(String(user || '').match(/_(\d+)@/)?.[1] || 0);
  if (index % 3 === 1) {
    return {
      name: 'mobile-ios-web',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    };
  }
  if (index % 3 === 2) {
    return {
      name: 'mobile-android-web',
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36',
    };
  }
  return {
    name: 'desktop-web',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  };
};

const recordIssue = (issue: Issue) => {
  issues.push(issue);
};

const request = async <T = unknown>(
  name: string,
  method: string,
  route: string,
  body?: unknown,
  token?: string,
  user?: string,
): Promise<T | null> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const started = performance.now();
  let status = 0;
  let responsePayload: unknown = null;
  const clientProfile = getClientProfile(user);

  try {
    const response = await qaFetch(`${apiBase}${route}`, {
      method,
      headers: {
        'user-agent': clientProfile.userAgent,
        'x-qa-client-profile': clientProfile.name,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    status = response.status;
    const text = await response.text();
    responsePayload = text ? JSON.parse(text) : null;
    const durationMs = Math.round(performance.now() - started);
    metrics.push({
      name,
      method,
      path: route,
      status,
      ok: response.ok,
      durationMs,
      user,
      clientProfile: clientProfile.name,
      bytes: text.length,
    });

    if (!response.ok) {
      const message = typeof responsePayload === 'object' && responsePayload
        ? String((responsePayload as Record<string, unknown>).message || (responsePayload as Record<string, unknown>).error || `${status}`)
        : `${status}`;
      throw Object.assign(new Error(`${method} ${route} failed with ${status}: ${message}`), {
        status,
        payload: responsePayload,
      });
    }

    return responsePayload as T;
  } catch (error) {
    const durationMs = Math.round(performance.now() - started);
    const message = error instanceof Error ? error.message : String(error);
    metrics.push({
      name,
      method,
      path: route,
      status,
      ok: false,
      durationMs,
      user,
      clientProfile: clientProfile.name,
      error: message,
    });
    throw Object.assign(new Error(message), { status, payload: responsePayload });
  } finally {
    clearTimeout(timeout);
  }
};

const runPool = async <T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>) => {
  const results: R[] = [];
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  });
  await Promise.all(runners);
  return results;
};

const currentSummary = (extra: Json = {}) => {
  const finalMemory = process.memoryUsage();
  return {
    runId,
    baseUrl: apiOrigin,
    apiBase,
    usersRequested: VUS,
    setupConcurrency: SETUP_CONCURRENCY,
    activeConcurrency: ACTIVE_CONCURRENCY,
    progress: { ...progress },
    totalRequests: metrics.length,
    failedRequests: metrics.filter((metric) => !metric.ok).length,
    endpointSummary: summarizeByName(),
    issues,
    crashed: false,
    finalRssMb: Math.round(finalMemory.rss / 1024 / 1024),
    peakHeapUsedMb: Math.round(finalMemory.heapUsed / 1024 / 1024),
    artifacts: {
      reportDir,
      json: path.join(reportDir, 'full-automation-test-report.json'),
      markdown: path.join(reportDir, 'full-automation-test-report.md'),
      manifest: manifestPath,
    },
    ...extra,
  };
};

const writePartialReport = async (reason: string) => {
  await fs.mkdir(reportDir, { recursive: true });
  const summary = currentSummary({ partial: true, reason });
  await fs.writeFile(path.join(reportDir, 'partial-report.json'), JSON.stringify(summary, null, 2));
  console.log(`[${new Date().toISOString()}] partial report: ${reason}; phase=${progress.phase}; prepared=${progress.preparedUsers}/${VUS}; completed=${progress.completedJourneys}/${VUS}; requests=${metrics.length}; failures=${metrics.filter((metric) => !metric.ok).length}`);
};

const login = async (email: string, password: string, device: string) => {
  const payload = await request<{ token: string; user: Json }>('auth.login', 'POST', '/auth/login', {
    email,
    password,
    device,
    forceLogoutOtherSessions: true,
  }, undefined, email);
  if (!payload?.token) {
    throw new Error(`Login did not return token for ${email}`);
  }
  return payload;
};

const createTestData = async (adminToken: string) => {
  const stamp = Date.now();
  const lessonId = `lesson_load_${stamp}`;
  const moduleId = `module_load_${stamp}`;
  const course = await request<Json>('admin.course.create', 'POST', '/courses', {
    title: `QA Load Course ${stamp}`,
    description: 'Synthetic 1000-user QA course generated by automation.',
    category: 'QA',
    exam: 'QA',
    subject: 'Scalability',
    level: 'Full Course',
    price: 0,
    validityDays: 30,
    modules: [{
      id: moduleId,
      title: 'Load Module',
      lessons: [{
        id: lessonId,
        title: 'Recorded Video Smoke Lesson',
        lessonType: 'video',
        videoUrl: 'https://example.com/synthetic-load-video.mp4',
        durationMinutes: 30,
      }],
      chapters: [],
    }],
  }, adminToken, 'admin');
  const courseId = pickId(course);
  if (!courseId) {
    throw new Error('Synthetic course did not return an id.');
  }

  const test = await request<Json>('admin.test.create', 'POST', '/tests', {
    title: `QA Load Mock Test ${stamp}`,
    description: 'Synthetic concurrent mock test.',
    category: 'QA',
    type: 'mock',
    durationMinutes: 30,
    totalMarks: 3,
    negativeMarking: 0.25,
    questions: [
      {
        id: 'q1',
        questionText: 'Load question 1',
        options: ['A', 'B', 'C', 'D'],
        correctOption: 0,
        answer: 0,
        marks: 1,
        topic: 'Load',
      },
      {
        id: 'q2',
        questionText: 'Load question 2',
        options: ['A', 'B', 'C', 'D'],
        correctOption: 1,
        answer: 1,
        marks: 1,
        topic: 'Load',
      },
      {
        id: 'q3',
        questionText: 'Load question 3',
        options: ['A', 'B', 'C', 'D'],
        correctOption: 2,
        answer: 2,
        marks: 1,
        topic: 'Load',
      },
    ],
  }, adminToken, 'admin');
  const testId = pickId(test);
  if (!testId) {
    throw new Error('Synthetic test did not return an id.');
  }

  const livePayload = await request<{ liveClass: Json }>('admin.live.create', 'POST', '/live-classes', {
    title: `QA Load Live Class ${stamp}`,
    startTime: new Date(Date.now() - 60_000).toISOString(),
    durationMinutes: 60,
    instructor: 'QA Load Faculty',
    status: 'scheduled',
    maxAttendees: Math.max(2500, VUS + 100),
    requiresEnrollment: false,
    chatEnabled: true,
    doubtSolving: true,
    topicTags: ['load-test'],
  }, adminToken, 'admin');
  const liveClassId = pickId(livePayload?.liveClass);
  if (!liveClassId) {
    throw new Error('Synthetic live class did not return an id.');
  }
  await request('admin.live.start', 'POST', `/live-classes/${liveClassId}/start`, {}, adminToken, 'admin');

  return { courseId, moduleId, lessonId, testId, liveClassId };
};

const prepareUsers = async (): Promise<LoadUser[]> => {
  if (EXISTING_USERS_FILE) {
    const raw = await fs.readFile(EXISTING_USERS_FILE, 'utf8');
    const loaded = JSON.parse(raw) as LoadUser[];
    console.log(`Loaded ${loaded.length} prepared users from ${EXISTING_USERS_FILE}`);
    progress.preparedUsers = loaded.length;
    return loaded.slice(0, VUS);
  }

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const indexes = Array.from({ length: VUS }, (_, index) => index);
  const users = await runPool(indexes, SETUP_CONCURRENCY, async (index) => {
    const email = `platform_load_${suffix}_${index}@edumaster.local`;
    try {
      await request('auth.signup', 'POST', '/auth/register', {
        name: `Platform Load User ${index + 1}`,
        email,
        password: USER_PASSWORD,
        mobileNumber: `90000${String(index).padStart(5, '0')}`,
      }, undefined, email);
    } catch (error) {
      recordIssue({
        severity: 'High',
        whatBroke: 'Signup failed during user preparation',
        where: 'Login / Signup',
        exactErrorMessage: error instanceof Error ? error.message : String(error),
        stepsToReproduce: `Run platform load test with PLATFORM_LOAD_USERS=${VUS}; failing synthetic user index ${index}.`,
        userCountDuringFailure: index + 1,
        apiServerResponse: (error as { payload?: unknown }).payload,
        suggestedFix: 'Check auth validation, unique email handling, password hashing saturation, and database write throughput.',
      });
      throw error;
    }
    const loginPayload = await login(email, USER_PASSWORD, `platform-load-${index + 1}`);
    progress.preparedUsers += 1;
    if (progress.preparedUsers % 25 === 0 || progress.preparedUsers === VUS) {
      console.log(`[prepare] ${progress.preparedUsers}/${VUS} users ready`);
    }
    return {
      index,
      email,
      token: loginPayload.token,
      userId: pickId(loginPayload.user),
      name: `Platform Load User ${index + 1}`,
    };
  });
  await fs.writeFile(manifestPath, JSON.stringify(users, null, 2));
  console.log(`Prepared user manifest: ${manifestPath}`);
  return users;
};

const runUserJourney = async (
  user: Awaited<ReturnType<typeof prepareUsers>>[number],
  targets: Awaited<ReturnType<typeof createTestData>>,
) => {
  const userLabel = user.email;
  let failed = false;
  const step = async (label: string, fn: () => Promise<unknown>, severity: Issue['severity'] = 'High') => {
    try {
      await fn();
    } catch (error) {
      failed = true;
      recordIssue({
        severity,
        whatBroke: `${label} failed`,
        where: label,
        exactErrorMessage: error instanceof Error ? error.message : String(error),
        stepsToReproduce: `Run the 1000-user platform load test; failing user ${userLabel}; step ${label}.`,
        userCountDuringFailure: VUS,
        apiServerResponse: (error as { payload?: unknown }).payload,
        suggestedFix: 'Inspect the endpoint contract, server route wiring, DB query latency, request timeout/5xx pattern, and frontend callsite for this feature.',
      });
    }
  };

  try {
    await step('Student Dashboard', () => request('dashboard.overview', 'GET', '/platform/overview', undefined, user.token, userLabel));
    await step('Courses list', () => request('courses.list', 'GET', '/courses', undefined, user.token, userLabel));
    await step('Course detail', () => request('courses.detail', 'GET', `/courses/${targets.courseId}`, undefined, user.token, userLabel));
    await step('Course lessons', () => request('courses.lessons', 'GET', `/courses/${targets.courseId}/lessons`, undefined, user.token, userLabel));
    await step('Course enroll', () => request('course.enroll', 'POST', '/platform/enroll', {
      courseId: targets.courseId,
      source: 'load-test',
    }, user.token, userLabel));
    await step('Recorded video watch progress 25%', () => request('recorded.watchProgress.25', 'POST', '/platform/watch-progress', {
      courseId: targets.courseId,
      lessonId: targets.lessonId,
      progressPercent: 25,
      progressSeconds: 450,
      completed: false,
    }, user.token, userLabel));
    await step('Recorded video watch progress 100%', () => request('recorded.watchProgress.100', 'POST', '/platform/watch-progress', {
      courseId: targets.courseId,
      lessonId: targets.lessonId,
      progressPercent: 100,
      progressSeconds: 1800,
      completed: true,
    }, user.token, userLabel));
    await step('Mock tests list', () => request('tests.list', 'GET', '/tests', undefined, user.token, userLabel));
    await step('Mock test detail', () => request('tests.detail', 'GET', `/tests/${targets.testId}`, undefined, user.token, userLabel));
    await step('Mock test submit', () => request('tests.submit', 'POST', `/tests/${targets.testId}/submit`, {
      startedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      answers: {
        q1: user.index % 4,
        q2: (user.index + 1) % 4,
        q3: (user.index + 2) % 4,
      },
    }, user.token, userLabel));
    await step('Leaderboard', () => request('analytics.leaderboard', 'GET', '/analytics/leaderboard', undefined, user.token, userLabel));
    await step('Payment checkout', () => request('payment.checkout', 'POST', '/payment/checkout', {
      amount: 199,
      currency: 'INR',
      item: 'QA Load Course Access',
    }, user.token, userLabel));
    await step('Live classes list', () => request('live.list', 'GET', '/live-classes', undefined, user.token, userLabel));
    await step('Live access', () => request('live.access', 'GET', `/live-classes/${targets.liveClassId}/access`, undefined, user.token, userLabel));
    await step('Live join', () => request('live.session.join', 'POST', `/live-classes/${targets.liveClassId}/session/join`, {}, user.token, userLabel));
    await step('Live chat send', () => request('live.chat.send', 'POST', `/live-classes/${targets.liveClassId}/chat`, {
      message: `Load chat ${user.index}`,
      kind: 'chat',
    }, user.token, userLabel));
    await step('Live heartbeat', () => request('live.session.heartbeat', 'POST', `/live-classes/${targets.liveClassId}/session/heartbeat`, {}, user.token, userLabel));
    await step('Live media update', () => request('live.session.media', 'POST', `/live-classes/${targets.liveClassId}/session/media`, {
      micMuted: user.index % 2 === 0,
      videoEnabled: user.index % 5 === 0,
      isScreenSharing: false,
    }, user.token, userLabel));
    await step('Live raise hand', () => request('live.session.raiseHand', 'POST', `/live-classes/${targets.liveClassId}/session/raise-hand`, {
      raised: user.index % 10 === 0,
    }, user.token, userLabel));
    await step('Live chat list', () => request('live.chat.list', 'GET', `/live-classes/${targets.liveClassId}/chat`, undefined, user.token, userLabel));
    await step('Notifications list', () => request('notifications.list', 'GET', '/notifications', undefined, user.token, userLabel));
    await step('Profile get', () => request('profile.get', 'GET', '/users/profile', undefined, user.token, userLabel));
    await step('Profile update', () => request('profile.update', 'PATCH', '/users/profile', {
      name: user.name,
      email: user.email,
      mobileNumber: `91111${String(user.index).padStart(5, '0')}`,
    }, user.token, userLabel));
    await step('User progress', () => request('user.progress', 'GET', '/users/progress', undefined, user.token, userLabel));
    await step('User analytics', () => request('user.analytics', 'GET', '/users/analytics', undefined, user.token, userLabel));
    await step('Live leave', () => request('live.session.leave', 'POST', `/live-classes/${targets.liveClassId}/session/leave`, {}, user.token, userLabel));
    await step('Auth session', () => request('auth.session', 'GET', '/auth/session', undefined, user.token, userLabel));
    await step('Auth logout', () => request('auth.logout', 'POST', '/auth/logout', {}, user.token, userLabel));
    await step('Auth relogin', () => login(user.email, USER_PASSWORD, `platform-load-relogin-${user.index + 1}`));
    progress.completedJourneys += 1;
    if (!failed) {
      progress.successfulJourneys += 1;
    }
    if (progress.completedJourneys % 25 === 0 || progress.completedJourneys === VUS) {
      console.log(`[active] ${progress.completedJourneys}/${VUS} journeys complete; success=${progress.successfulJourneys}; failures=${progress.completedJourneys - progress.successfulJourneys}`);
    }
    return !failed;
  } catch (error) {
    recordIssue({
      severity: 'High',
      whatBroke: 'Full user journey failed',
      where: 'Concurrent journey',
      exactErrorMessage: error instanceof Error ? error.message : String(error),
      stepsToReproduce: `Run the 1000-user platform load test; failing user ${userLabel}.`,
      userCountDuringFailure: VUS,
      apiServerResponse: (error as { payload?: unknown }).payload,
      suggestedFix: 'Inspect the named endpoint metric, server logs, DB locks, session conflicts, and request timeout/5xx pattern for this user.',
    });
    progress.completedJourneys += 1;
    return false;
  }
};

const summarizeByName = () => {
  const grouped = new Map<string, Metric[]>();
  for (const metric of metrics) {
    grouped.set(metric.name, [...(grouped.get(metric.name) || []), metric]);
  }
  return Array.from(grouped.entries()).map(([name, rows]) => {
    const durations = rows.map((row) => row.durationMs);
    const failures = rows.filter((row) => !row.ok);
    return {
      name,
      requests: rows.length,
      failures: failures.length,
      successRate: rows.length ? Number((((rows.length - failures.length) / rows.length) * 100).toFixed(2)) : 0,
      avgMs: average(durations),
      p50Ms: percentile(durations, 50),
      p95Ms: percentile(durations, 95),
      p99Ms: percentile(durations, 99),
      maxMs: durations.length ? Math.max(...durations) : 0,
      statuses: rows.reduce<Record<string, number>>((acc, row) => {
        acc[String(row.status)] = (acc[String(row.status)] || 0) + 1;
        return acc;
      }, {}),
      sampleErrors: failures.slice(0, 5).map((row) => row.error || `${row.status}`),
    };
  }).sort((left, right) => right.p95Ms - left.p95Ms);
};

const smokeRoute = async (route: string) => {
  const started = performance.now();
  const response = await qaFetch(`${apiOrigin}${route}`);
  await response.text();
  return {
    route,
    status: response.status,
    durationMs: Math.round(performance.now() - started),
    ok: response.ok,
  };
};

const writeReports = async (summary: Json) => {
  await fs.mkdir(reportDir, { recursive: true });
  await fs.writeFile(path.join(reportDir, 'full-automation-test-report.json'), JSON.stringify(summary, null, 2));
  const endpointRows = (summary.endpointSummary as Json[]).map((row) =>
    `| ${row.name} | ${row.requests} | ${row.successRate}% | ${row.avgMs} | ${row.p95Ms} | ${row.p99Ms} | ${row.maxMs} | ${JSON.stringify(row.statuses)} |`,
  ).join('\n');
  const issueRows = issues.length
    ? issues.map((issue, index) =>
      `### ${index + 1}. ${issue.severity}: ${issue.whatBroke}\n- Where: ${issue.where}\n- Error: ${issue.exactErrorMessage}\n- Users: ${issue.userCountDuringFailure}\n- Repro: ${issue.stepsToReproduce}\n- Suggested fix: ${issue.suggestedFix}`,
    ).join('\n\n')
    : 'No API/journey failures were captured by this run.';

  const markdown = `# 1000-User Platform QA Report

Run: ${runId}

## Scope
- Users requested: ${VUS}
- Active journey concurrency: ${ACTIVE_CONCURRENCY}
- Setup concurrency: ${SETUP_CONCURRENCY}
- Base URL: ${apiOrigin}
- Modules covered: Login/Signup, Student Dashboard, Courses, Recorded Videos watch progress, Live Classes session/chat/media, Mock Tests/Test Series, Payments, Notifications, Profile/Settings, Navigation/Routing smoke, API integrations, Database-backed operations.

## Environment
- Host: ${os.hostname()}
- CPU cores visible to Node: ${os.cpus().length}
- Memory total: ${Math.round(os.totalmem() / 1024 / 1024)} MB
- Node: ${process.version}

## Load/Stress Summary
- Total requests: ${summary.totalRequests}
- Failed requests: ${summary.failedRequests}
- Successful journeys: ${summary.successfulJourneys}/${VUS}
- Wall clock: ${summary.wallClockMs} ms
- Peak heap used: ${summary.peakHeapUsedMb} MB
- RSS after run: ${summary.finalRssMb} MB

## Endpoint Performance
| Endpoint | Requests | Success | Avg ms | P95 ms | P99 ms | Max ms | Statuses |
|---|---:|---:|---:|---:|---:|---:|---|
${endpointRows}

## Bug Report
${issueRows}

## Crash Report
${summary.crashed ? 'Run crashed before completion.' : 'No runner crash captured.'}

## Failed API Report
${(summary.endpointSummary as Json[]).filter((row) => Number(row.failures) > 0).map((row) => `- ${row.name}: ${row.failures} failures, statuses ${JSON.stringify(row.statuses)}, sample ${JSON.stringify(row.sampleErrors)}`).join('\n') || 'No failed API groups captured.'}

## UI/UX Issue Report
This run performs route smoke checks, not 1000 real browser sessions. Existing Puppeteer module tests should be run separately for visual proof because 1000 concurrent browsers on this local machine would invalidate performance numbers.

## Database Performance Report
Database-backed write paths exercised: signup, login/session, enrollment, watch progress, test attempts/results, payment checkout, live session state, live chat, notifications, profile update. Use the endpoint P95/P99 table as the DB/API bottleneck proxy for this local run.

## Scalability Recommendations
- Re-run this script against a production-like environment with isolated Postgres metrics, Redis/session backing, and observability enabled.
- Move live session and chat fan-out to Redis/pubsub or a managed realtime layer before relying on multi-instance scaling.
- Add dedicated k6/Artillery streaming tests for real video/audio media servers; this API test does not prove media-plane quality.
- Add DB indexes for high-volume attempt, notification, enrollment, and session queries if p95/p99 grows under this run.
- Use queueing/backpressure for broadcast notifications and analytics aggregation.
`;

  await fs.writeFile(path.join(reportDir, 'full-automation-test-report.md'), markdown);
};

const main = async () => {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    throw new Error('Admin credentials required. Set QA_ADMIN_EMAIL/QA_ADMIN_PASSWORD or ADMIN_EMAIL/ADMIN_PASSWORD.');
  }

  const runStarted = performance.now();
  const memorySamples: NodeJS.MemoryUsage[] = [];
  const sampler = setInterval(() => memorySamples.push(process.memoryUsage()), 1000);
  const partialSampler = setInterval(() => {
    writePartialReport('interval').catch((error) => {
      console.error(`Unable to write partial report: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, PARTIAL_REPORT_INTERVAL_MS);

  const stopRequested = async (signal: string) => {
    progress.phase = `interrupted:${signal}`;
    await writePartialReport(`interrupted by ${signal}`).catch(() => undefined);
    process.exit(130);
  };
  process.once('SIGINT', () => { void stopRequested('SIGINT'); });
  process.once('SIGTERM', () => { void stopRequested('SIGTERM'); });

  try {
    await fs.mkdir(reportDir, { recursive: true });
    progress.phase = 'health-check';
    await request('health.api', 'GET', '/health').catch(() => undefined);
    progress.phase = 'admin-login';
    const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD, 'platform-load-admin');
    progress.phase = 'test-data';
    const targets = await createTestData(admin.token);
    progress.phase = EXISTING_USERS_FILE ? 'load-user-manifest' : 'prepare-users';
    const users = await prepareUsers();

    progress.phase = 'route-smoke';
    const routeSmokes = await Promise.all([
      '/',
      '/?tab=courses',
      '/?tab=live',
      '/?tab=tests',
      '/?tab=profile',
    ].map(smokeRoute));

    progress.phase = 'active-1000-simultaneous-journeys';
    const journeyStarted = performance.now();
    const journeyResults = await runPool(users, ACTIVE_CONCURRENCY, (user) => {
      progress.startedJourneys += 1;
      if (progress.startedJourneys % 100 === 0 || progress.startedJourneys === users.length) {
        console.log(`[active] started ${progress.startedJourneys}/${users.length} journeys`);
      }
      return runUserJourney(user, targets);
    });
    const journeyWallClockMs = Math.round(performance.now() - journeyStarted);
    const successfulJourneys = journeyResults.filter(Boolean).length;
    progress.phase = 'reporting';

    const endpointSummary = summarizeByName();
    const finalMemory = process.memoryUsage();
    const peakHeapUsedMb = Math.round(Math.max(finalMemory.heapUsed, ...memorySamples.map((sample) => sample.heapUsed)) / 1024 / 1024);
    const summary = {
      runId,
      baseUrl: apiOrigin,
      apiBase,
      usersRequested: VUS,
      setupConcurrency: SETUP_CONCURRENCY,
      activeConcurrency: ACTIVE_CONCURRENCY,
      successfulJourneys,
      failedJourneys: VUS - successfulJourneys,
      totalRequests: metrics.length,
      failedRequests: metrics.filter((metric) => !metric.ok).length,
      wallClockMs: Math.round(performance.now() - runStarted),
      journeyWallClockMs,
      endpointSummary,
      routeSmokes,
      issues,
      crashed: false,
      finalRssMb: Math.round(finalMemory.rss / 1024 / 1024),
      peakHeapUsedMb,
      artifacts: {
        reportDir,
        json: path.join(reportDir, 'full-automation-test-report.json'),
        markdown: path.join(reportDir, 'full-automation-test-report.md'),
      },
      note: 'This is a local API/load automation run. It validates API-backed journeys and route smoke checks, not true 1000-device video/audio quality.',
    };
    await writeReports(summary);
    console.log(JSON.stringify({
      reportDir,
      users: VUS,
      successfulJourneys,
      failedJourneys: VUS - successfulJourneys,
      totalRequests: metrics.length,
      failedRequests: metrics.filter((metric) => !metric.ok).length,
      journeyWallClockMs,
      slowestP95: endpointSummary.slice(0, 8),
    }, null, 2));

    if (successfulJourneys !== VUS || metrics.some((metric) => !metric.ok)) {
      process.exitCode = 1;
    }
  } catch (error) {
    progress.phase = 'crashed';
    const finalMemory = process.memoryUsage();
    const summary = {
      runId,
      baseUrl: apiOrigin,
      usersRequested: VUS,
      totalRequests: metrics.length,
      failedRequests: metrics.filter((metric) => !metric.ok).length,
      endpointSummary: summarizeByName(),
      issues,
      crashed: true,
      crash: error instanceof Error ? error.stack || error.message : String(error),
      finalRssMb: Math.round(finalMemory.rss / 1024 / 1024),
      peakHeapUsedMb: Math.round(finalMemory.heapUsed / 1024 / 1024),
    };
    await writeReports(summary);
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  } finally {
    clearInterval(sampler);
    clearInterval(partialSampler);
  }
};

main();
