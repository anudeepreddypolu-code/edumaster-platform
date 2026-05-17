import { openAsBlob } from 'node:fs';

const apiBase = 'http://127.0.0.1:5000/backend/api';
const adminEmail = process.env.ADMIN_EMAIL || process.env.REPLAY_IMPORT_ADMIN_EMAIL;
const adminPassword = process.env.ADMIN_PASSWORD || process.env.REPLAY_IMPORT_ADMIN_PASSWORD;
const sourcePath = process.env.UPLOAD_SOURCE_PATH || '/tmp/primal-fear-3700s-480p.mp4';
const appUrl = process.env.APP_URL || 'https://app.178.105.48.179.nip.io';

const fail = (message) => {
  throw new Error(message);
};

if (!adminEmail || !adminPassword) {
  fail('Admin credentials are missing');
}

const jsonRequest = async (url, options = {}) => {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;

  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!response.ok) {
    throw new Error(typeof body === 'object' && body
      ? (body.message || body.error || JSON.stringify(body))
      : `${response.status} ${response.statusText}`);
  }

  return body;
};

const login = await jsonRequest(`${apiBase}/auth/login`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    email: adminEmail,
    password: adminPassword,
    device: 'codex-upload',
    forceLogoutOtherSessions: true,
  }),
});

if (!login?.token) {
  fail('Login did not return a token');
}

const token = login.token;
const course = await jsonRequest(`${apiBase}/courses`, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    title: `Primal Fear Certification ${new Date().toISOString()}`,
    description: 'Long-form test asset for recorded playback certification.',
    category: 'Recorded',
    exam: 'Recorded',
    subject: 'Certification',
    instructor: 'Codex QA',
    level: 'Long Form',
    price: 0,
    validityDays: 365,
  }),
});

const courseId = course?._id || course?.id;
if (!courseId) {
  fail('Course creation did not return an id');
}

const blob = await openAsBlob(sourcePath, { type: 'video/mp4' });
const form = new FormData();
form.append('lessonTitle', 'Primal Fear Long Form');
form.append('lessonType', 'private-video');
form.append('moduleName', 'Long Form Module');
form.append('durationMinutes', '61');
form.append('isPremium', 'true');
form.append('video', blob, 'primal-fear-3700s-480p.mp4');

const upload = await fetch(`${apiBase}/courses/${courseId}/modules/module_primal_fear/videos`, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${token}`,
  },
  body: form,
});

const uploadText = await upload.text();
let uploadBody = null;
if (uploadText) {
  try {
    uploadBody = JSON.parse(uploadText);
  } catch {
    uploadBody = uploadText;
  }
}

if (!upload.ok) {
  throw new Error(typeof uploadBody === 'object' && uploadBody
    ? (uploadBody.message || uploadBody.error || JSON.stringify(uploadBody))
    : `${upload.status} ${upload.statusText}`);
}

const lessonId = uploadBody?.video?.id;
if (!lessonId) {
  fail('Upload did not return a lesson id');
}

const detailUrl = `${apiBase}/courses/admin/details/${courseId}`;
const findLesson = (courseData) => {
  for (const module of courseData?.modules || []) {
    for (const lesson of module?.lessons || []) {
      if (lesson?.id === lessonId) {
        return lesson;
      }
    }
    for (const chapter of module?.chapters || []) {
      for (const lesson of chapter?.lessons || []) {
        if (lesson?.id === lessonId) {
          return lesson;
        }
      }
    }
  }
  return null;
};

let lesson = null;
for (let attempt = 1; attempt <= 90; attempt += 1) {
  const courseDetails = await jsonRequest(detailUrl, {
    headers: {
      authorization: `Bearer ${token}`,
    },
  });
  lesson = findLesson(courseDetails);
  console.log(JSON.stringify({
    attempt,
    hlsProcessingStatus: lesson?.hlsProcessingStatus,
    deliveryStrategy: lesson?.deliveryStrategy,
    hlsPlaybackPath: lesson?.hlsPlaybackPath || null,
  }));

  if (lesson?.hlsProcessingStatus === 'ready' && lesson?.hlsPlaybackPath) {
    break;
  }

  await new Promise((resolve) => setTimeout(resolve, 10000));
}

if (!lesson || lesson.hlsProcessingStatus !== 'ready') {
  throw new Error('HLS processing did not reach ready state in time');
}

console.log(JSON.stringify({
  courseId,
  lessonId,
  pageUrl: `${appUrl}/?tab=courses&courseId=${courseId}&lessonId=${lessonId}`,
  hlsPlaybackPath: lesson.hlsPlaybackPath,
}, null, 2));
