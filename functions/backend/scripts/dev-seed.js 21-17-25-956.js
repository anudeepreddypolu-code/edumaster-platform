/**
 * DEV-ONLY seed script.
 * Run with: node backend/scripts/dev-seed.js
 * NEVER runs automatically in production.
 */
'use strict';

if (process.env.NODE_ENV === 'production') {
  console.error('[dev-seed] Refusing to run in production environment.');
  process.exit(1);
}

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const bcrypt = require('bcryptjs');
const { connectDatabase, isPersistentDatabaseReady } = require('../lib/database.js');
const { usersRepository, coursesRepository, testsRepository, quizzesRepository, liveClassesRepository, notificationsRepository, platformRepository } = require('../lib/repositories.js');
const { buildPlatformSeed } = require('../lib/platform-seed.js');

const run = async () => {
  console.log('[dev-seed] Connecting to database...');
  const dbState = await connectDatabase();
  console.log(`[dev-seed] DB mode: ${dbState.mode}`);

  if (!isPersistentDatabaseReady()) {
    console.warn('[dev-seed] No persistent DB connected. Seeding in-memory state only (data will not persist).');
  }

  const seed = buildPlatformSeed();

  for (const seedUser of seed.users) {
    const existing = await usersRepository.findByEmail(seedUser.email);
    if (existing) {
      console.log(`[dev-seed] User already exists: ${seedUser.email}`);
      continue;
    }
    const { passwordPlain, ...rest } = seedUser;
    await usersRepository.create({ ...rest, password: bcrypt.hashSync(passwordPlain, 10) });
    console.log(`[dev-seed] Created user: ${seedUser.email}`);
  }

  for (const course of seed.courses) {
    // Strip YouTube video URLs — production courses start with empty video structure
    const sanitizedCourse = {
      ...course,
      modules: (course.modules || []).map((mod) => ({
        ...mod,
        lessons: (mod.lessons || []).map((lesson) => ({
          ...lesson,
          videoUrl: null,
          youtubeVideoIdCiphertext: null,
        })),
        chapters: (mod.chapters || []).map((chapter) => ({
          ...chapter,
          lessons: (chapter.lessons || []).map((lesson) => ({
            ...lesson,
            videoUrl: null,
            youtubeVideoIdCiphertext: null,
          })),
        })),
      })),
    };
    await coursesRepository.create(sanitizedCourse);
    console.log(`[dev-seed] Created course: ${course.title}`);
  }

  for (const test of seed.tests) {
    await testsRepository.create(test);
    console.log(`[dev-seed] Created test: ${test.title}`);
  }

  await quizzesRepository.create(seed.quiz);
  console.log(`[dev-seed] Created daily quiz for: ${seed.quiz.date}`);

  for (const liveClass of seed.liveClasses) {
    await liveClassesRepository.create(liveClass);
    console.log(`[dev-seed] Created live class: ${liveClass.title}`);
  }

  console.log('[dev-seed] Done.');
  process.exit(0);
};

run().catch((error) => {
  console.error('[dev-seed] Failed:', error);
  process.exit(1);
});
