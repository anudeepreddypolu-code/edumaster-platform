const fs = require('fs');
const path = require('path');
const { startServer } = require('./server.cjs');
const { coursesRepository } = require('./lib/repositories.js');

let baseUrl = process.env.API_BASE_URL || null;

const VIEWERS = Number(process.env.LOAD_TEST_VIEWERS || 200);
const CONCURRENCY = Math.max(1, Number(process.env.LOAD_TEST_CONCURRENCY || 25));
const STREAM_RANGE = process.env.LOAD_TEST_RANGE || 'bytes=0-65535';
const SCENARIO = process.env.LOAD_TEST_SCENARIO || 'same-lesson';
const TARGETS = Math.max(1, Number(process.env.LOAD_TEST_TARGETS || 8));
const SAMPLE_VIDEO_PATH = process.env.LOAD_TEST_VIDEO_PATH || null;
const ADMIN_EMAIL = process.env.LOAD_TEST_ADMIN_EMAIL || process.env.ADMIN_EMAIL || 'admin@local.edumaster';
const ADMIN_PASSWORD = process.env.LOAD_TEST_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || 'AdminChangeMe_2026';
const STUDENT_PASSWORD = process.env.LOAD_TEST_STUDENT_PASSWORD || 'Student@123';
const TARGET_PREP_TIMEOUT_MS = Number(process.env.LOAD_TEST_TARGET_PREP_TIMEOUT_MS || 180000);

const timed = async (fn) => {
  const started = Date.now();
  const result = await fn();
  return {
    ms: Date.now() - started,
    result,
  };
};

const percentile = (values, target) => {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((target / 100) * sorted.length) - 1));
  return sorted[index];
};

const average = (values) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const request = async (method, requestPath, body = null, token = null, isForm = false) => {
  const response = await fetch(`${baseUrl}${requestPath}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(!isForm && body ? { 'content-type': 'application/json' } : {}),
    },
    body: isForm ? body : (body ? JSON.stringify(body) : undefined),
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error(`${method} ${requestPath} failed with ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
};

const findSampleVideoPath = () => {
  if (SAMPLE_VIDEO_PATH) {
    return path.resolve(SAMPLE_VIDEO_PATH);
  }

  const candidates = [
    path.join(process.cwd(), 'uploads', 'videos'),
    path.join(process.cwd(), '..', 'uploads', 'videos'),
  ];

  for (const directory of candidates) {
    if (!fs.existsSync(directory)) {
      continue;
    }

    const match = fs.readdirSync(directory)
      .find((entry) => /\.(mp4|mov|mkv|webm)$/i.test(entry));
    if (match) {
      return path.join(directory, match);
    }
  }

  throw new Error('No sample video found. Set LOAD_TEST_VIDEO_PATH to an existing file.');
};

const createPrivateVideoCourseTarget = async (adminToken, lessonTitle) => {
  const course = await request('POST', '/courses', {
    title: `Load Test Course ${Date.now()}`,
    description: 'Synthetic load-test course',
    category: 'SSC JE',
    exam: 'SSC JE',
    subject: 'Load Testing',
    level: 'Full Course',
    price: 0,
    validityDays: 365,
    instructor: 'Load Bot',
  }, adminToken);

  const sampleVideoPath = findSampleVideoPath();
  const fileBuffer = fs.readFileSync(sampleVideoPath);
  const fileName = path.basename(sampleVideoPath);
  const extension = path.extname(fileName).toLowerCase();
  const mimeType = extension === '.mkv'
    ? 'video/x-matroska'
    : extension === '.mov'
      ? 'video/quicktime'
      : extension === '.webm'
        ? 'video/webm'
        : 'video/mp4';

  const formData = new FormData();
  formData.append('lessonTitle', lessonTitle);
  formData.append('lessonType', 'private-video');
  formData.append('moduleName', 'Load Module');
  formData.append('durationMinutes', '180');
  formData.append('video', new Blob([fileBuffer], { type: mimeType }), fileName);

  const uploaded = await request(
    'POST',
    `/courses/${course._id}/modules/module_load/videos`,
    formData,
    adminToken,
    true,
  );

  return {
    courseId: course._id,
    lessonId: uploaded.video.id,
    lesson: uploaded.video,
  };
};

const duplicateLessonAcrossCourses = async (baseTarget, count) => {
  const targets = [baseTarget];

  for (let index = 1; index < count; index += 1) {
    const course = await coursesRepository.create({
      title: `Load Test Clone ${Date.now()}_${index}`,
      description: 'Synthetic cloned load-test course',
      category: 'SSC JE',
      exam: 'SSC JE',
      subject: 'Load Testing',
      level: 'Full Course',
      price: 0,
      validityDays: 365,
      instructor: 'Load Bot',
      modules: [],
      createdBy: 'load-test',
    });

    const lessonId = `${baseTarget.lesson.id}_clone_${index}`;
    const moduleId = `module_load_clone_${index}`;
    const lessonClone = {
      ...JSON.parse(JSON.stringify(baseTarget.lesson)),
      id: lessonId,
      title: `Load Test Lesson ${index + 1}`,
      moduleId,
      chapterId: null,
    };

    const courseWithLesson = {
      ...course,
      modules: [{
        id: moduleId,
        title: `Load Module ${index + 1}`,
        description: 'Load-generated module',
        lessons: [lessonClone],
        chapters: [],
      }],
      updated_at: new Date().toISOString(),
    };

    await coursesRepository.updateCourseModule(course._id, courseWithLesson);
    targets.push({
      courseId: course._id,
      lessonId,
      lesson: lessonClone,
    });
  }

  return targets;
};

const waitForStableLessonTarget = async ({ courseId, lessonId }) => {
  const started = Date.now();

  while (Date.now() - started < TARGET_PREP_TIMEOUT_MS) {
    const course = await coursesRepository.findById(courseId);
    const lesson = course
      ? (course.modules || [])
        .flatMap((module) => ([
          ...(module.lessons || []),
          ...((module.chapters || []).flatMap((chapter) => chapter.lessons || [])),
        ]))
        .find((entry) => entry.id === String(lessonId))
      : null;

    if (!lesson) {
      throw new Error(`Load test lesson ${lessonId} was not found while waiting for preparation.`);
    }

    const hlsReady = lesson.deliveryStrategy === 'hls' && lesson.hlsProcessingStatus === 'ready' && lesson.hlsPlaybackPath;
    const sourceReady = Boolean(lesson.storagePath);
    const failedButUsable = lesson.hlsProcessingStatus === 'failed' && sourceReady;

    if (hlsReady || failedButUsable || (!lesson.hlsProcessingStatus && sourceReady)) {
      return lesson;
    }

    await sleep(1000);
  }

  throw new Error(`Timed out waiting for lesson ${lessonId} to become usable for the load test.`);
};

const createStudents = async () => {
  const indexes = Array.from({ length: VIEWERS }, (_, index) => index);
  const students = [];

  for (let offset = 0; offset < indexes.length; offset += CONCURRENCY) {
    const batch = indexes.slice(offset, offset + CONCURRENCY);
    const created = await Promise.all(batch.map(async (index) => {
      const email = `load_user_${Date.now()}_${index}@edumaster.local`;
      await request('POST', '/auth/register', {
        email,
        password: STUDENT_PASSWORD,
        name: `Load User ${index + 1}`,
      });
      const login = await request('POST', '/auth/login', {
        email,
        password: STUDENT_PASSWORD,
        device: `load-runner-${index + 1}`,
      });

      return {
        email,
        token: login.token,
      };
    }));
    students.push(...created);
    console.log(`Registered ${students.length}/${VIEWERS} viewers`);
  }

  return students;
};

const enrollStudents = async (students) => {
  for (let offset = 0; offset < students.length; offset += CONCURRENCY) {
    const batch = students.slice(offset, offset + CONCURRENCY);
    await Promise.all(batch.map((student) =>
      request('POST', '/platform/enroll', {
        courseId: student.courseId,
        source: 'load-test',
      }, student.token)));
    console.log(`Enrolled ${Math.min(offset + CONCURRENCY, students.length)}/${students.length} viewers`);
  }
};

const hitPlayback = async ({ token, courseId, lessonId }) => {
  const playerTimed = await timed(() =>
    request('GET', `/courses/${courseId}/lessons/${lessonId}/player`, null, token));
  const streamPath = String(playerTimed.result.streamUrl || '').replace('/backend', '');
  const streamTimed = await timed(async () => {
    const response = await fetch(`${baseUrl.replace(/\/api$/, '')}${streamPath}`, {
      headers: {
        authorization: `Bearer ${token}`,
        range: STREAM_RANGE,
      },
    });

    if (!response.ok && response.status !== 206) {
      const text = await response.text();
      throw new Error(`Stream failed with ${response.status}: ${text}`);
    }

    await response.arrayBuffer();
    return {
      status: response.status,
      contentType: response.headers.get('content-type'),
    };
  });

  return {
    playerMs: playerTimed.ms,
    streamMs: streamTimed.ms,
    streamStatus: streamTimed.result.status,
  };
};

const runConcurrent = async (items, worker) => {
  const queue = [...items];
  const results = [];
  const errors = [];

  const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (!item) {
        return;
      }

      try {
        results.push(await worker(item));
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  });

  await Promise.all(runners);
  return { results, errors };
};

const main = async () => {
  let serverHandle = null;

  if (!baseUrl) {
    const { server } = await startServer({ port: 0, host: '127.0.0.1' });
    serverHandle = server;
    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}/api`;
  }

  try {
    const admin = await request('POST', '/auth/login', {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      device: 'load-test-admin',
    });

    console.log(`Base URL: ${baseUrl}`);
    console.log(`Scenario: ${SCENARIO}`);
    console.log(`Preparing ${VIEWERS} viewers with concurrency ${CONCURRENCY}`);

    const baseTarget = await createPrivateVideoCourseTarget(admin.token, 'Load Test Lesson 1');
    baseTarget.lesson = await waitForStableLessonTarget(baseTarget);
    const targets = SCENARIO === 'different-lessons'
      ? await duplicateLessonAcrossCourses(baseTarget, TARGETS)
      : [baseTarget];
    const students = (await createStudents()).map((student, index) => ({
      ...student,
      ...targets[index % targets.length],
    }));
    await enrollStudents(students);

    const started = Date.now();
    const { results, errors } = await runConcurrent(
      students,
      hitPlayback,
    );
    const totalMs = Date.now() - started;

    const playerDurations = results.map((entry) => entry.playerMs);
    const streamDurations = results.map((entry) => entry.streamMs);

    console.log(JSON.stringify({
      scenario: SCENARIO,
      viewers: VIEWERS,
      concurrency: CONCURRENCY,
      targets: targets.length,
      range: STREAM_RANGE,
      successes: results.length,
      failures: errors.length,
      totalWallClockMs: totalMs,
      player: {
        avgMs: average(playerDurations),
        p50Ms: percentile(playerDurations, 50),
        p95Ms: percentile(playerDurations, 95),
      },
      stream: {
        avgMs: average(streamDurations),
        p50Ms: percentile(streamDurations, 50),
        p95Ms: percentile(streamDurations, 95),
      },
      sampleErrors: errors.slice(0, 10),
    }, null, 2));
  } finally {
    if (serverHandle) {
      await new Promise((resolve) => serverHandle.close(resolve));
    }
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
