const express = require('express');
const { getCourses, getCourse, getCourseLessons, getProtectedLessonPlayer, streamProtectedLesson, createCourse } = require('./course.controller.js');
const {
  uploadVideoToModule,
  deleteVideoFromModule,
  listVideosInModule,
  getVideoMetadata,
} = require('./video-upload.controller.js');
const {
  updateCourse,
  deleteCourse,
  addModule,
  updateModule,
  addChapter,
  updateChapter,
  deleteChapter,
  deleteModule,
  getCourseDetails,
  listCoursesAdmin,
} = require('./course-admin.controller.js');
const { requireAuth, attachAuthIfPresent } = require('../middleware/auth.js');
const { requireAdmin } = require('../middleware/admin.js');
const upload = require('../lib/multer-config.js');
const router = express.Router();

// Admin routes - course management
router.get('/admin/details/:id', requireAuth, requireAdmin, getCourseDetails);
router.get('/admin/list', requireAuth, requireAdmin, listCoursesAdmin);
router.post('/', requireAuth, requireAdmin, createCourse);
router.put('/:id', requireAuth, requireAdmin, updateCourse);
router.delete('/:id', requireAuth, requireAdmin, deleteCourse);

// Admin routes - module management
router.post('/:courseId/modules', requireAuth, requireAdmin, addModule);
router.put('/:courseId/modules/:moduleId', requireAuth, requireAdmin, updateModule);
router.delete('/:courseId/modules/:moduleId', requireAuth, requireAdmin, deleteModule);
router.post('/:courseId/modules/:moduleId/chapters', requireAuth, requireAdmin, addChapter);
router.put('/:courseId/modules/:moduleId/chapters/:chapterId', requireAuth, requireAdmin, updateChapter);
router.delete('/:courseId/modules/:moduleId/chapters/:chapterId', requireAuth, requireAdmin, deleteChapter);

// Admin routes - video upload and management
router.post('/:courseId/modules/:moduleId/videos', requireAuth, requireAdmin, upload.single('video'), uploadVideoToModule);
router.delete('/:courseId/modules/:moduleId/videos/:videoId', requireAuth, requireAdmin, deleteVideoFromModule);
router.get('/:courseId/modules/:moduleId/videos', requireAuth, requireAdmin, listVideosInModule);
router.get('/:courseId/modules/:moduleId/videos/:videoId', requireAuth, requireAdmin, getVideoMetadata);

// Public routes
router.get('/', attachAuthIfPresent, getCourses);
router.get('/stream/:token', streamProtectedLesson);
router.get('/:id/lessons/:lessonId/player', requireAuth, getProtectedLessonPlayer);
router.get('/:id/lessons', attachAuthIfPresent, getCourseLessons);
router.get('/:id', attachAuthIfPresent, getCourse);

module.exports = router;
