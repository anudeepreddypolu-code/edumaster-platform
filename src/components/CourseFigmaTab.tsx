import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  Bookmark,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Filter,
  FileText,
  LayoutGrid,
  List,
  Lock,
  Maximize2,
  MoreVertical,
  Pause,
  Play,
  Search,
  Send,
  MessageSquare,
  Sparkles,
  Video,
} from 'lucide-react';
import { CourseCard, CourseLesson, PlatformOverview } from '../types';
import { cn } from '../lib/utils';

type CourseFigmaTabProps = {
  overview: PlatformOverview;
  onRefresh: () => Promise<void>;
  initialCourseId?: string | null;
  initialLessonId?: string | null;
  onResumeNavigationHandled?: () => void;
  savedTopicIds: string[];
  onToggleSavedTopic: (courseId: string, lessonId: string) => void;
  onImmersiveModeChange?: (immersive: boolean) => void;
};


type Screen = 'catalog' | 'course' | 'lesson';
type CourseTab = 'Lessons';
type LessonTab = 'Video' | 'CBT Exam' | 'Explanation';
type LessonSupportPanel = 'notes' | 'doubts' | null;
type MobileSupportTab = Exclude<LessonSupportPanel, null>;
type LessonStage = 'video' | 'exam' | 'explanation';
type MobileLessonStage = 'watch' | 'completed' | 'exam' | 'exam-complete' | 'explanation' | 'explanation-complete';
type CatalogTone = 'blue' | 'teal' | 'orange' | 'purple';
type ArtworkVariant = 'power' | 'diagram' | 'generation';

type StoredProgress = {
  lessonId: string;
  progressPercent: number;
  progressSeconds: number;
  completed: boolean;
  lessonStage?: LessonStage;
  examSubmitted?: boolean;
  examSelectedOption?: number | null;
  explanationSeconds?: number;
  videoWatchCount?: number;
  explanationWatchCount?: number;
  updatedAt: string;
};

type StoredProgressPatch = Partial<StoredProgress> & Pick<StoredProgress, 'lessonId'>;

type CourseLessonEntry = {
  lesson: CourseLesson;
  moduleId: string;
  moduleTitle: string;
  chapterId: string | null;
  chapterTitle: string | null;
  sectionId: string;
  sectionLabel: string;
  sectionTitle: string;
  sectionIndex: number;
  lessonIndex: number;
};

type CourseSection = {
  id: string;
  label: string;
  title: string;
  moduleId: string;
  chapterId: string | null;
  lessons: CourseLessonEntry[];
};

type LessonCopy = {
  heading: string;
  summary: string;
  about: string;
  takeaways: string[];
  notes: Array<{ title: string; body: string }>;
  quiz: {
    prompt: string;
    options: string[];
    answerIndex: number;
    explanation: string;
  };
  discussionPrompt: string;
  quickTip: string;
  artwork: ArtworkVariant;
  featureLabels: string[];
};

type LessonDoubtMessage = {
  id: string;
  name: string;
  time: string;
  message: string;
  self?: boolean;
};

const uiFontStyle = {
  fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
} as React.CSSProperties;

const PLAYER_STORAGE_PREFIX = 'edumaster.course-figma-progress';
const PLAYER_TICK_MS = 320;
const PLAYER_TICK_STEP_SECONDS = 18;
const AUTOPLAY_COUNTDOWN_SECONDS = 3;
const VIDEO_STAGE_PROGRESS = 34;
const EXAM_STAGE_PROGRESS = 67;
const EXPLANATION_DURATION_SECONDS = 120;
const MAX_VIDEO_WATCHES = 2;
const MAX_EXPLANATION_WATCHES = 1;

const courseTabs: CourseTab[] = ['Lessons'];
const lessonTabs: LessonTab[] = ['Video'];
const mobileLessonTabLabels: Record<LessonTab, string> = {
  Video: 'Video',
  'CBT Exam': 'Quiz',
  Explanation: 'Discussion',
};

const toneStyles: Record<CatalogTone, {
  surface: string;
  chip: string;
  button: string;
  progress: string;
  sidebar: string;
}> = {
  blue: {
    surface: 'bg-[linear-gradient(180deg,#dce9ff_0%,#edf4ff_30%,#ffffff_100%)]',
    chip: 'bg-[#5a98f5] text-white',
    button: 'bg-[linear-gradient(180deg,#4285f4_0%,#2d6ee5_100%)] shadow-[0_14px_28px_rgba(45,110,229,0.24)]',
    progress: 'bg-[linear-gradient(90deg,#58a3ff_0%,#7bb8ff_100%)]',
    sidebar: 'bg-[#edf4ff]',
  },
  teal: {
    surface: 'bg-[linear-gradient(180deg,#d8f0f7_0%,#eef8fd_30%,#ffffff_100%)]',
    chip: 'bg-[#60c0d5] text-white',
    button: 'bg-[linear-gradient(180deg,#5bc3da_0%,#45aac4_100%)] shadow-[0_14px_28px_rgba(69,170,196,0.22)]',
    progress: 'bg-[linear-gradient(90deg,#5ebfe1_0%,#7fd0e7_100%)]',
    sidebar: 'bg-[#eef8fb]',
  },
  orange: {
    surface: 'bg-[linear-gradient(180deg,#ffe6d5_0%,#fff3eb_30%,#ffffff_100%)]',
    chip: 'bg-[#f6a04d] text-white',
    button: 'bg-[linear-gradient(180deg,#f7a348_0%,#f18f32_100%)] shadow-[0_14px_28px_rgba(241,143,50,0.24)]',
    progress: 'bg-[linear-gradient(90deg,#f6a455_0%,#f4b56d_100%)]',
    sidebar: 'bg-[#fff5ee]',
  },
  purple: {
    surface: 'bg-[linear-gradient(180deg,#efe5ff_0%,#f7f1ff_30%,#ffffff_100%)]',
    chip: 'bg-[#9b6cf2] text-white',
    button: 'bg-[linear-gradient(180deg,#9b67f0_0%,#8351e6_100%)] shadow-[0_14px_28px_rgba(131,81,230,0.24)]',
    progress: 'bg-[linear-gradient(90deg,#a57cf6_0%,#be9bff_100%)]',
    sidebar: 'bg-[#f4edff]',
  },
};

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

const formatDurationLabel = (minutes: number) => `${minutes} min${minutes === 1 ? '' : 's'}`;

const mobileCatalogPriority: Record<string, number> = {
  'rrb je civil fast track': 0,
  'ssc je 2026 electrical power track': 1,
  'ssc je general awareness revision vault': 2,
};

const mobileDisplayTitleMap: Record<string, string> = {
  'ssc je 2026 electrical power track': 'SSC JE 2026 Electrical Track',
  'ssc je general awareness revision vault': 'SSC JE General Awareness Vault',
};

const formatPlaybackTime = (seconds: number) => {
  const safeSeconds = Math.max(Math.floor(seconds || 0), 0);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
  }

  return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
};

const buildInitials = (value: string) =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('') || 'EM';

const normalize = (value?: string | null) => String(value || '').trim().toLowerCase();

const getMobileCoursePriority = (course: CourseCard) => mobileCatalogPriority[normalize(course.title)] ?? 99;

const getMobileCatalogTone = (course: CourseCard): CatalogTone => {
  const title = normalize(course.title);
  if (title === 'rrb je civil fast track') {
    return 'blue';
  }
  if (title === 'ssc je general awareness revision vault') {
    return 'purple';
  }
  if (title === 'ssc je 2026 electrical power track') {
    return 'teal';
  }
  return getCatalogTone(course, 0);
};

const getMobileCourseTitle = (course?: CourseCard | null) => {
  const title = String(course?.title || '');
  return mobileDisplayTitleMap[normalize(title)] || title;
};

const buildStorageKey = (courseId: string) => `${PLAYER_STORAGE_PREFIX}.${courseId}`;

const readStoredProgress = (courseId: string) => {
  if (typeof window === 'undefined' || !courseId) {
    return {} as Record<string, StoredProgress>;
  }

  try {
    const raw = window.localStorage.getItem(buildStorageKey(courseId));
    return raw ? JSON.parse(raw) as Record<string, StoredProgress> : {};
  } catch {
    return {};
  }
};

const writeStoredProgress = (courseId: string, progress: Record<string, StoredProgress>) => {
  if (typeof window === 'undefined' || !courseId) {
    return;
  }

  try {
    window.localStorage.setItem(buildStorageKey(courseId), JSON.stringify(progress));
  } catch {
    // Ignore local storage write failures and keep UI responsive.
  }
};

const findCourseIdForLesson = (courses: CourseCard[], lessonId?: string | null) => {
  if (!lessonId) {
    return null;
  }

  for (const course of courses) {
    for (const module of course.modules || []) {
      if ((module.lessons || []).some((lesson) => lesson.id === lessonId)) {
        return course._id;
      }
      for (const chapter of module.chapters || []) {
        if ((chapter.lessons || []).some((lesson) => lesson.id === lessonId)) {
          return course._id;
        }
      }
    }
  }

  return null;
};

const getCatalogTone = (course: CourseCard, index: number): CatalogTone => {
  const exam = normalize(course.exam);
  const subject = normalize(course.subject);

  if (exam.includes('rrb')) {
    return 'teal';
  }

  if (subject.includes('general') || subject.includes('reasoning')) {
    return 'orange';
  }

  return (['blue', 'teal', 'orange'] as CatalogTone[])[index % 3];
};

const buildCourseSections = (course: CourseCard | null): CourseSection[] => {
  if (!course) {
    return [];
  }

  const sections: CourseSection[] = [];
  let sectionCount = 0;
  let lessonCount = 0;

  (course.modules || []).forEach((module) => {
    if ((module.lessons || []).length > 0) {
      sectionCount += 1;
      const sectionId = `${module.id}::module`;
      const lessons: CourseLessonEntry[] = (module.lessons || []).map((lesson) => {
        lessonCount += 1;
        return {
          lesson,
          moduleId: module.id,
          moduleTitle: module.title,
          chapterId: null,
          chapterTitle: null,
          sectionId,
          sectionLabel: `Chapter ${sectionCount}`,
          sectionTitle: module.title,
          sectionIndex: sectionCount,
          lessonIndex: lessonCount,
        };
      });

      sections.push({
        id: sectionId,
        label: `Chapter ${sectionCount}`,
        title: module.title,
        moduleId: module.id,
        chapterId: null,
        lessons,
      });
    }

    (module.chapters || []).forEach((chapter) => {
      sectionCount += 1;
      const sectionId = `${module.id}::${chapter.id}`;
      const lessons: CourseLessonEntry[] = (chapter.lessons || []).map((lesson) => {
        lessonCount += 1;
        return {
          lesson,
          moduleId: module.id,
          moduleTitle: module.title,
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          sectionId,
          sectionLabel: `Chapter ${sectionCount}`,
          sectionTitle: chapter.title,
          sectionIndex: sectionCount,
          lessonIndex: lessonCount,
        };
      });

      sections.push({
        id: sectionId,
        label: `Chapter ${sectionCount}`,
        title: chapter.title,
        moduleId: module.id,
        chapterId: chapter.id,
        lessons,
      });
    });
  });

  return sections;
};

const buildProgressMap = (
  course: CourseCard | null,
  localProgress: Record<string, StoredProgress>,
  transientProgress?: StoredProgress | null,
) => {
  const progressMap = new Map<string, StoredProgress>();

  (course?.lessonProgress || []).forEach((entry) => {
    progressMap.set(entry.lessonId, entry);
  });

  Object.values(localProgress || {}).forEach((entry) => {
    progressMap.set(entry.lessonId, entry);
  });

  if (transientProgress?.lessonId) {
    progressMap.set(transientProgress.lessonId, transientProgress);
  }

  return progressMap;
};

const buildCourseSnapshot = (
  course: CourseCard,
  localProgress: Record<string, StoredProgress>,
  transientProgress?: StoredProgress | null,
) => {
  const sections = buildCourseSections(course);
  const lessons = sections.flatMap((section) => section.lessons);
  const progressMap = buildProgressMap(course, localProgress, transientProgress);
  const totalLessons = lessons.length;
  const completedLessons = lessons.filter((entry) => hasLessonVideoMilestone(progressMap.get(entry.lesson.id))).length;
  const progressPercent = totalLessons === 0
    ? 0
    : Math.round(
      lessons.reduce((sum, entry) => sum + Number(progressMap.get(entry.lesson.id)?.progressPercent || 0), 0) / totalLessons,
    );

  return {
    totalLessons,
    completedLessons,
    progressPercent,
  };
};

const buildUnlockMap = (course: CourseCard | null, progressMap: Map<string, StoredProgress>) => {
  const sections = buildCourseSections(course);
  const lessons = sections.flatMap((section) => section.lessons);
  const accessMap = new Map<string, { unlocked: boolean; reason: string | null }>();
  const hasCourseAccess = Boolean(
    course?.enrolled
    || course?.price === 0
    || (course?.progressPercent || 0) > 0
    || course?.continueLesson,
  );

  lessons.forEach((entry, index) => {
    if (entry.lesson.locked) {
      accessMap.set(entry.lesson.id, {
        unlocked: false,
        reason: 'This lesson is locked in the current course setup.',
      });
      return;
    }

    if (!hasCourseAccess) {
      accessMap.set(entry.lesson.id, {
        unlocked: index === 0,
        reason: index === 0 ? 'Preview lesson unlocked.' : 'Unlock the course to continue this playlist.',
      });
      return;
    }

    accessMap.set(entry.lesson.id, {
      unlocked: true,
      reason: null,
    });
  });

  return accessMap;
};

const hasLessonVideoMilestone = (progress?: StoredProgress | null) =>
  Boolean(
    progress
    && (
      progress.lessonStage === 'exam'
      || progress.lessonStage === 'explanation'
      || progress.completed
      || Number(progress.progressPercent || 0) >= VIDEO_STAGE_PROGRESS
    ),
  );

const getVideoWatchCount = (progress?: StoredProgress | null) => {
  if (!progress) {
    return 0;
  }

  if (typeof progress.videoWatchCount === 'number') {
    return progress.videoWatchCount;
  }

  return hasLessonVideoMilestone(progress) ? 1 : 0;
};

const getExplanationWatchCount = (progress?: StoredProgress | null) => {
  if (!progress) {
    return 0;
  }

  if (typeof progress.explanationWatchCount === 'number') {
    return progress.explanationWatchCount;
  }

  return progress.completed ? 1 : 0;
};

const getLessonVariant = (lessonTitle: string): ArtworkVariant => {
  const title = normalize(lessonTitle);
  if (title.includes('diagram')) {
    return 'diagram';
  }
  if (title.includes('generation')) {
    return 'generation';
  }
  return 'power';
};

const buildLessonCopy = (entry: CourseLessonEntry | null, course: CourseCard | null): LessonCopy => {
  const lessonTitle = normalize(entry?.lesson.title);
  const courseSubject = course?.subject || 'Power Systems';

  if (lessonTitle.includes('diagram')) {
    return {
      heading: entry?.lesson.title || 'Single Line Diagram Essentials',
      summary: 'A single line diagram represents the components of a power system using simplified symbols in one clean line.',
      about: 'This lesson explains why single line diagrams matter, how equipment is abstracted into symbols, and how to read power flow quickly during revision.',
      takeaways: [
        'Single line diagrams simplify complex wiring networks.',
        'Standard symbols help you identify buses, transformers, breakers, and feeders.',
        'The diagram is the fastest way to trace source, protection, and end load.',
      ],
      notes: [
        {
          title: 'Why this topic matters',
          body: 'Single line diagrams compress large systems into one visual map, which makes revision and troubleshooting significantly faster.',
        },
        {
          title: 'What to observe',
          body: 'Watch the path from source to load and mark where control, switching, and protection elements appear.',
        },
        {
          title: 'Exam memory hook',
          body: 'Read left to right: source, transformation, distribution, and load. It keeps the order easy to recall.',
        },
      ],
      quiz: {
        prompt: 'What is the main purpose of a single line diagram?',
        options: [
          'To show every wire in detail',
          'To simplify a power system using standard symbols',
          'To replace circuit protection devices',
          'To describe only mechanical components',
        ],
        answerIndex: 1,
        explanation: 'A single line diagram simplifies the network using standard symbols so the flow and equipment become easier to understand.',
      },
      discussionPrompt: 'Which symbol or connection in this diagram feels least intuitive right now?',
      quickTip: 'Say the component names aloud while tracing the line. It helps convert symbols into memory faster.',
      artwork: 'diagram',
      featureLabels: ['Source', 'Bus', 'Switching', 'Protection'],
    };
  }

  if (lessonTitle.includes('generation')) {
    return {
      heading: entry?.lesson.title || 'Components of Power Generation',
      summary: 'Generation starts with a source, moves through control and protection, and enters the wider network through regulated output.',
      about: 'This lesson breaks generation into simple system blocks so you can link plant equipment, control hardware, and transmission handoff points clearly.',
      takeaways: [
        'Generation begins with a controlled energy conversion process.',
        'Protection and control keep the system stable during output changes.',
        'The generation stage must connect cleanly into transmission or distribution.',
      ],
      notes: [
        {
          title: 'Layer the idea',
          body: 'Think of generation as source, conversion, control, protection, and export to the grid.',
        },
        {
          title: 'Operational focus',
          body: 'Voltage regulation and safe switching are as important as the source itself when explaining generation.',
        },
        {
          title: 'Revision shortcut',
          body: 'Map each component to one function: produce, condition, protect, and deliver.',
        },
      ],
      quiz: {
        prompt: 'Which statement best describes the generation stage in a power system?',
        options: [
          'It only manages consumer loads',
          'It creates and conditions electrical energy before delivery to the grid',
          'It removes the need for substations',
          'It replaces distribution feeders',
        ],
        answerIndex: 1,
        explanation: 'Generation covers both production and conditioning so usable power can enter the wider network safely.',
      },
      discussionPrompt: 'Which generation component would you use to explain system control to a classmate?',
      quickTip: 'Tie every plant component to a verb: generate, regulate, protect, transmit.',
      artwork: 'generation',
      featureLabels: ['Source', 'Control', 'Protection', 'Grid'],
    };
  }

  return {
    heading: lessonTitle.includes('transformer') ? 'Transformers in Power Systems' : 'What is a Power System?',
    summary: 'A power system is an interconnected network used to generate, transmit, distribute and consume electrical energy.',
    about: `In this lesson, we will learn the basic definition, structure, and importance of ${courseSubject}. This gives you a stronger foundation for the upcoming lessons in the track.`,
    takeaways: [
      'Power systems form a connected network rather than isolated components.',
      'Generation, transmission, distribution, and utilization work as one flow.',
      'A strong systems view makes later protection and machine topics easier to understand.',
    ],
    notes: [
      {
        title: 'Core definition',
        body: 'A power system connects generation, transmission, distribution, and consumption into a coordinated electrical network.',
      },
      {
        title: 'Why it matters',
        body: 'Thinking in system blocks helps you move from theory to diagrams, operation, and protection problems.',
      },
      {
        title: 'Revision cue',
        body: 'Remember the order: source, transfer, delivery, and use.',
      },
    ],
    quiz: {
      prompt: 'Which sequence best describes the flow inside a power system?',
      options: [
        'Consumption -> distribution -> generation -> transmission',
        'Generation -> transmission -> distribution -> consumption',
        'Transmission -> generation -> consumption -> protection',
        'Generation -> consumption -> protection -> distribution',
      ],
      answerIndex: 1,
      explanation: 'Electrical power is generated first, then transmitted, distributed, and finally consumed.',
    },
    discussionPrompt: 'Which part of the power system chain feels easiest to explain, and which part still feels abstract?',
    quickTip: 'Take short notes while watching the lesson. One line per stage is enough for fast recall.',
    artwork: 'power',
    featureLabels: ['Generation', 'Transmission', 'Distribution', 'Consumption'],
  };
};

const buildCourseHeroArt = () => {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 240" fill="none">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="960" y2="240" gradientUnits="userSpaceOnUse">
          <stop stop-color="#dbe9ff"/>
          <stop offset="0.55" stop-color="#bed7ff"/>
          <stop offset="1" stop-color="#eef5ff"/>
        </linearGradient>
      </defs>
      <rect width="960" height="240" fill="url(#bg)"/>
      <path d="M0 168C140 146 270 141 394 150C557 162 682 180 960 156V240H0V168Z" fill="#e8f1ff"/>
      <path d="M0 184C180 169 332 168 510 179C709 191 812 194 960 182V240H0V184Z" fill="#f4f8ff"/>
      <g stroke="#8ba7d4" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" opacity="0.82">
        <path d="M760 34l-20 140h40L760 34Z" fill="#8ba7d4" stroke="none"/>
        <path d="M760 34l-58 46h116L760 34Zm-58 46-30 24h176l-30-24m-116 0-22 18m116-18 22 18"/>
        <path d="M844 54l-15 120h30L844 54Z" fill="#8ba7d4" stroke="none"/>
        <path d="M844 54l-44 34h88L844 54Zm-44 34-22 18h132l-22-18"/>
        <path d="M640 148c64-38 132-46 240-39"/>
      </g>
      <circle cx="790" cy="72" r="112" fill="#ffffff" opacity="0.32"/>
      <circle cx="266" cy="66" r="42" fill="#ffffff" opacity="0.26"/>
    </svg>
  `.trim();

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
};

const buildLessonArtwork = (variant: ArtworkVariant) => {
  if (variant === 'diagram') {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540" fill="none">
        <rect width="960" height="540" rx="24" fill="#d7e8ff"/>
        <path d="M110 396H860" stroke="#28416d" stroke-width="6"/>
        <path d="M178 396v-58m176 58v-34m147 34v-88m124 88v-48m110 48v-64" stroke="#28416d" stroke-width="6" stroke-linecap="round"/>
        <circle cx="178" cy="338" r="18" stroke="#28416d" stroke-width="6"/>
        <circle cx="354" cy="362" r="8" fill="#28416d"/>
        <circle cx="501" cy="308" r="14" stroke="#28416d" stroke-width="6"/>
        <circle cx="625" cy="348" r="14" stroke="#28416d" stroke-width="6"/>
        <circle cx="735" cy="332" r="14" stroke="#28416d" stroke-width="6"/>
        <circle cx="860" cy="332" r="14" stroke="#28416d" stroke-width="6"/>
        <path d="M472 162v234m0-188h48m-48 44h48m-48 44h48" stroke="#28416d" stroke-width="6" stroke-linecap="round"/>
        <path d="M612 188v208m0-148h42m-42 42h42m-42 42h42" stroke="#28416d" stroke-width="6" stroke-linecap="round"/>
        <path d="M772 208v188m0-126h36m-36 42h36m-36 42h36" stroke="#28416d" stroke-width="6" stroke-linecap="round"/>
        <path d="M300 396h268" stroke="#28416d" stroke-width="6"/>
        <path d="M300 396v-28" stroke="#28416d" stroke-width="6" stroke-linecap="round"/>
      </svg>
    `.trim();

    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  }

  if (variant === 'generation') {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540" fill="none">
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="960" y2="540" gradientUnits="userSpaceOnUse">
            <stop stop-color="#d8ebff"/>
            <stop offset="1" stop-color="#c5dcfb"/>
          </linearGradient>
        </defs>
        <rect width="960" height="540" rx="24" fill="url(#g)"/>
        <path d="M0 408C145 380 282 372 430 386C614 404 770 434 960 398V540H0V408Z" fill="#b8d16e"/>
        <rect x="146" y="266" width="128" height="96" fill="#8fa6bf"/>
        <rect x="174" y="224" width="26" height="42" fill="#f39b59"/>
        <rect x="220" y="214" width="30" height="52" fill="#6b97bc"/>
        <rect x="330" y="282" width="72" height="80" fill="#8fa6bf"/>
        <rect x="352" y="236" width="24" height="46" fill="#f39b59"/>
        <rect x="450" y="302" width="158" height="40" rx="12" fill="#6885b0"/>
        <rect x="654" y="292" width="120" height="50" rx="14" fill="#556f9f"/>
        <path d="M566 196l-18 146h36L566 196Z" fill="#6986b0"/>
        <path d="M566 196l-50 34h100L566 196Zm-50 34-26 20h152l-26-20m-100 0-20 14m100-14 20 14" stroke="#6986b0" stroke-width="5" stroke-linejoin="round"/>
        <path d="M698 214l-16 128h32L698 214Z" fill="#40526d"/>
        <path d="M698 214l-42 30h84L698 214Zm-42 30-22 18h128l-22-18" stroke="#40526d" stroke-width="5" stroke-linejoin="round"/>
        <path d="M274 308c76 0 118-22 196-70m36 104c78 0 118-20 192-64" stroke="#7ea2c6" stroke-width="4" stroke-linecap="round"/>
        <circle cx="798" cy="112" r="42" fill="#ffffff" opacity="0.86"/>
      </svg>
    `.trim();

    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  }

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540" fill="none">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="960" y2="540" gradientUnits="userSpaceOnUse">
          <stop stop-color="#dcecff"/>
          <stop offset="1" stop-color="#c6ddfb"/>
        </linearGradient>
      </defs>
      <rect width="960" height="540" rx="24" fill="url(#sky)"/>
      <path d="M0 404C132 388 266 386 414 395C572 404 758 432 960 396V540H0V404Z" fill="#b9d16e"/>
      <path d="M0 422H960" stroke="#9dbc5b" stroke-width="8"/>
      <rect x="124" y="298" width="120" height="84" fill="#96a9b9"/>
      <rect x="150" y="270" width="18" height="28" fill="#f39b59"/>
      <rect x="200" y="262" width="22" height="36" fill="#5d92b7"/>
      <rect x="712" y="336" width="120" height="88" fill="#f7f4ea"/>
      <path d="M712 336h120l-62-48-58 48Z" fill="#5873aa"/>
      <path d="M536 116l-42 308h84L536 116Z" fill="#6986b0"/>
      <path d="M536 116l-116 80h232L536 116Zm-116 80-58 46h348l-58-46m-232 0-42 32m232-32 42 32" stroke="#6986b0" stroke-width="6" stroke-linejoin="round"/>
      <path d="M772 220l-30 204h60L772 220Z" fill="#40526d"/>
      <path d="M772 220l-88 64h176L772 220Zm-88 64-48 34h272l-48-34" stroke="#40526d" stroke-width="6" stroke-linejoin="round"/>
      <path d="M308 308l-24 116h48l-24-116Z" fill="#5f7ea3"/>
      <path d="M308 308l-64 46h128l-64-46Zm-64 46-34 24h196l-34-24" stroke="#5f7ea3" stroke-width="5" stroke-linejoin="round"/>
      <path d="M220 370c84 0 130-48 202-104m-42 160c92 0 138-30 236-98m34 86c68 0 98-26 166-78" stroke="#7da2c8" stroke-width="4" stroke-linecap="round"/>
      <circle cx="840" cy="110" r="26" fill="#fff" opacity="0.92"/>
      <circle cx="868" cy="118" r="18" fill="#fff" opacity="0.92"/>
      <circle cx="710" cy="156" r="20" fill="#fff" opacity="0.9"/>
      <circle cx="738" cy="164" r="14" fill="#fff" opacity="0.9"/>
      <circle cx="140" cy="152" r="28" fill="#fff" opacity="0.3"/>
    </svg>
  `.trim();

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
};

const HeaderTools = ({
  searchValue,
  onSearchChange,
  placeholder,
  userName,
  notificationCount,
  testId,
}: {
  searchValue: string;
  onSearchChange: (value: string) => void;
  placeholder: string;
  userName: string;
  notificationCount: number;
  testId?: string;
}) => (
  <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
    <label
      className="flex h-[42px] min-w-0 items-center gap-[10px] rounded-[14px] border border-[#d8e0ef] bg-white px-[14px] text-[15px] text-[#7a8dab] shadow-[0_8px_22px_rgba(60,86,134,0.05)] sm:w-[240px]"
      data-testid={testId}
    >
      <Search className="h-[16px] w-[16px]" />
      <input
        value={searchValue}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder={placeholder}
        className="w-full bg-transparent text-[#263b63] outline-none placeholder:text-[#93a1ba]"
      />
    </label>

    <div className="flex items-center gap-[14px] text-[#38527e]">
      <div className="flex h-[38px] w-[38px] items-center justify-center overflow-hidden rounded-full bg-[linear-gradient(180deg,#eef3ff_0%,#d8e4fa_100%)] shadow-[0_8px_18px_rgba(64,89,142,0.10)]">
        <span className="text-[13px] font-semibold">{buildInitials(userName)}</span>
      </div>
      <button
        type="button"
        className="relative flex h-[38px] w-[38px] items-center justify-center rounded-full border border-[#d8e0ef] bg-[#f9fbff] shadow-[0_8px_18px_rgba(64,89,142,0.06)]"
      >
        <Bell className="h-[17px] w-[17px]" />
        {notificationCount > 0 && (
          <span className="absolute -right-[1px] -top-[4px] flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#3d82ef] px-[4px] text-[10px] font-semibold text-white">
            {Math.min(notificationCount, 9)}
          </span>
        )}
      </button>
    </div>
  </div>
);

const ProgressDonut = ({
  percent,
  title,
  size = 118,
  testId,
}: {
  percent: number;
  title: string;
  size?: number;
  testId?: string;
}) => {
  const clamped = Math.min(Math.max(percent, 0), 100);
  const outerStyle = {
    width: size,
    height: size,
    background: `conic-gradient(#9bc5ff 0deg ${clamped * 3.6}deg, #dfe8f9 ${clamped * 3.6}deg 360deg)`,
  } as React.CSSProperties;
  const isCompact = size <= 80;
  const isMedium = size > 80 && size <= 100;
  const innerSize = Math.max(size - (isCompact ? 16 : 22), isCompact ? 48 : 56);

  return (
    <div className="flex items-center justify-center" data-testid={testId}>
      <div style={outerStyle} className="relative flex items-center justify-center rounded-full">
        <div
          style={{ width: innerSize, height: innerSize }}
          className="flex flex-col items-center justify-center rounded-full bg-white text-center"
        >
          <span className={cn(
            'leading-none text-[#1c2d4c]',
            isCompact ? 'text-[14px] font-semibold' : isMedium ? 'text-[22px] font-semibold' : 'text-[34px]',
          )}
          >
            {clamped}%
          </span>
          <span className={cn(
            'text-[#5d7092]',
            isCompact ? 'mt-[2px] text-[8px] font-medium' : isMedium ? 'mt-[3px] text-[11px]' : 'mt-[4px] text-[15px]',
          )}
          >
            {title}
          </span>
        </div>
      </div>
    </div>
  );
};

const ToggleSwitch = ({
  checked,
  onToggle,
  testId,
}: {
  checked: boolean;
  onToggle: () => void;
  testId?: string;
}) => (
  <button
    type="button"
    onClick={onToggle}
    data-testid={testId}
    aria-checked={checked}
    className={cn(
      'relative inline-flex h-[28px] w-[50px] shrink-0 items-center rounded-full border p-[2px] transition-all duration-200',
      checked
        ? 'border-[#2d6ee5] bg-[linear-gradient(180deg,#2f6ef0_0%,#3d80ff_100%)] shadow-[0_6px_14px_rgba(45,110,229,0.18)]'
        : 'border-[#d8e3f4] bg-[#edf3ff]',
    )}
  >
    <span
      className={cn(
        'block h-[22px] w-[22px] rounded-full bg-white shadow-[0_6px_12px_rgba(17,24,39,0.14)] transition-transform duration-200',
        checked ? 'translate-x-[22px]' : 'translate-x-0',
      )}
    />
  </button>
);

const CatalogCourseCard = ({
  course,
  tone,
  snapshot,
  onOpen,
}: {
  course: CourseCard;
  tone: CatalogTone;
  snapshot: {
    totalLessons: number;
    completedLessons: number;
    progressPercent: number;
  };
  onOpen: () => void;
}) => {
  const styles = toneStyles[tone];
  const actionLabel = snapshot.progressPercent > 0 ? 'Continue' : course.enrolled ? 'Start Course' : course.price === 0 ? 'Open Course' : 'Explore';
  const chipLabel = course.exam || course.category || 'Course';

  return (
    <button
      type="button"
      data-testid={`course-catalog-card-${slugify(course._id)}`}
      onClick={onOpen}
      className={cn(
        'group relative flex h-[246px] flex-col overflow-hidden rounded-[22px] border border-white/70 px-[18px] pb-[16px] pt-[14px] text-left shadow-[0_18px_40px_rgba(45,68,117,0.10)] transition hover:-translate-y-0.5',
        styles.surface,
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_82%_12%,rgba(255,255,255,0.92),transparent_28%),radial-gradient(circle_at_24%_14%,rgba(255,255,255,0.48),transparent_40%),linear-gradient(180deg,rgba(255,255,255,0)_24%,rgba(255,255,255,0.86)_100%)]" />
      <div className="relative flex h-full flex-col">
        <span className={cn('inline-flex w-fit rounded-[7px] px-[12px] py-[4px] text-[11px] font-semibold tracking-[0.02em]', styles.chip)}>
          {chipLabel}
        </span>

        <div className="mt-[16px] min-h-[76px]">
          <p className="text-[20px] font-semibold leading-[1.1] tracking-[-0.02em] text-[#142140]">{course.title}</p>
          <p className="mt-[6px] line-clamp-2 text-[15px] leading-[1.18] text-[#32466c]">{course.subject}</p>
        </div>

        <div className="mt-[6px] flex items-end justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-[15px] leading-none text-[#2d3d62]">{snapshot.progressPercent}% Completed</p>
            <div className="mt-[11px] h-[8px] w-full max-w-[162px] overflow-hidden rounded-full bg-[#d8e4f7]">
              <div className={cn('h-full rounded-full', styles.progress)} style={{ width: `${snapshot.progressPercent}%` }} />
            </div>
          </div>
          <span className={cn('inline-flex h-[40px] shrink-0 items-center rounded-[10px] px-[18px] text-[15px] font-semibold text-white', styles.button)}>
            {actionLabel}
          </span>
        </div>

        <div className="mt-[16px] border-t border-[#dde6f4]" />

        <div className="mt-[10px] grid grid-cols-3 gap-[8px] text-[#31456a]">
          <div>
            <p className="text-[13px] leading-[1.1]">{snapshot.totalLessons} Lessons</p>
            <p className="mt-[6px] text-[11px] text-[#8193b0]">Course flow</p>
          </div>
          <div>
            <p className="text-[13px] leading-[1.1]">{snapshot.completedLessons} Done</p>
            <p className="mt-[6px] text-[11px] text-[#8193b0]">Completed lessons</p>
          </div>
          <div>
            <p className="text-[13px] leading-[1.1]">{snapshot.progressPercent}%</p>
            <p className="mt-[6px] text-[11px] text-[#8193b0]">Progress</p>
          </div>
        </div>
      </div>
    </button>
  );
};

const LessonRow = ({
  entry,
  active,
  completed,
  unlocked,
  onOpen,
  showButton,
  testId,
}: {
  entry: CourseLessonEntry;
  active: boolean;
  completed: boolean;
  unlocked: boolean;
  onOpen: () => void;
  showButton?: boolean;
  testId?: string;
}) => (
  <button
    type="button"
    data-testid={testId}
    onClick={unlocked ? onOpen : undefined}
    className={cn(
      'flex w-full items-center gap-4 border-b border-[#e3eaf7] px-[18px] py-[14px] text-left last:border-b-0',
      active ? 'bg-[linear-gradient(90deg,rgba(64,125,233,0.10)_0%,rgba(255,255,255,0.98)_100%)]' : 'bg-white',
      unlocked ? 'cursor-pointer' : 'cursor-not-allowed',
    )}
  >
    <div className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full border border-[#d1ddf4] bg-[#edf3fe] text-[#7092c8]">
      {unlocked ? <Play className="ml-[1px] h-[15px] w-[15px] fill-current" /> : <Lock className="h-[14px] w-[14px]" />}
    </div>
    <div className="min-w-0 flex-1">
      <p className={cn('text-[15px] leading-[1.18] text-[#223356]', active && 'font-semibold text-[#1b49d6]')}>{entry.lesson.title}</p>
      <p className="mt-[4px] text-[13px] text-[#6e80a1]">{formatDurationLabel(entry.lesson.durationMinutes)}</p>
    </div>
    {completed ? (
      <CheckCircle2 className="h-[18px] w-[18px] shrink-0 text-[#22b573]" />
    ) : showButton && unlocked ? (
      <span className="inline-flex h-[34px] shrink-0 items-center rounded-[10px] bg-[linear-gradient(180deg,#4688f4_0%,#2d6ee5_100%)] px-[16px] text-[14px] font-semibold text-white shadow-[0_10px_24px_rgba(45,110,229,0.18)]">
        Open
      </span>
    ) : !unlocked ? (
      <Lock className="h-[16px] w-[16px] shrink-0 text-[#8fa2c3]" />
    ) : null}
  </button>
);

export const CourseFigmaTab = ({
  overview,
  onRefresh: _onRefresh,
  initialCourseId,
  initialLessonId,
  onResumeNavigationHandled,
  savedTopicIds,
  onToggleSavedTopic,
  onImmersiveModeChange,
}: CourseFigmaTabProps) => {
  const defaultCourseId = overview.courses[0]?._id || null;
  const initialResolvedCourseId = initialCourseId || findCourseIdForLesson(overview.courses, initialLessonId) || defaultCourseId;
  const [screen, setScreen] = useState<Screen>(initialLessonId ? 'lesson' : initialCourseId ? 'course' : 'catalog');
  const [activeCourseTab, setActiveCourseTab] = useState<CourseTab>('Lessons');
  const [activeLessonTab, setActiveLessonTab] = useState<LessonTab>('Video');
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(initialResolvedCourseId);
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(initialLessonId || null);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'unlocked' | 'progress' | 'completed' | 'not-started'>('all');
  const [sortBy, setSortBy] = useState<'latest' | 'progress' | 'title'>('latest');
  const [mobileCatalogLayout, setMobileCatalogLayout] = useState<'list' | 'grid'>('list');
  const [mobileCourseTab, setMobileCourseTab] = useState<'Content' | 'Syllabus' | 'Resources'>('Content');
  const [expandedSectionsByCourse, setExpandedSectionsByCourse] = useState<Record<string, string[]>>({});
  const [autoplayEnabled, setAutoplayEnabled] = useState(true);
  const [autoplayCountdown, setAutoplayCountdown] = useState<number | null>(null);
  const [videoPlaybackSeconds, setVideoPlaybackSeconds] = useState(0);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [explanationPlaybackSeconds, setExplanationPlaybackSeconds] = useState(0);
  const [isExplanationPlaying, setIsExplanationPlaying] = useState(false);
  const [isVideoReplayMode, setIsVideoReplayMode] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [mobileLessonStageOverride, setMobileLessonStageOverride] = useState<MobileLessonStage | null>(null);
  const [isMobileLayout, setIsMobileLayout] = useState(false);
  const [quizSelections, setQuizSelections] = useState<Record<string, number | null>>({});
  const [quizSubmitted, setQuizSubmitted] = useState<Record<string, boolean>>({});
  const [lessonDoubtDrafts, setLessonDoubtDrafts] = useState<Record<string, string>>({});
  const [lessonDoubtThreads, setLessonDoubtThreads] = useState<Record<string, LessonDoubtMessage[]>>({});
  const [expandedSupportPanel, setExpandedSupportPanel] = useState<LessonSupportPanel>(null);
  const [mobileSupportTab, setMobileSupportTab] = useState<MobileSupportTab>('notes');
  const [localProgressByCourse, setLocalProgressByCourse] = useState<Record<string, Record<string, StoredProgress>>>(() =>
    overview.courses.reduce<Record<string, Record<string, StoredProgress>>>((accumulator, course) => {
      accumulator[course._id] = readStoredProgress(course._id);
      return accumulator;
    }, {}),
  );
  const playerViewportRef = useRef<HTMLDivElement | null>(null);
  const autoplayHandledRef = useRef<string | null>(null);
  const handledResumeNavigationRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const updateLayout = () => {
      setIsMobileLayout(window.matchMedia('(max-width: 1023px)').matches);
    };

    updateLayout();
    window.addEventListener('resize', updateLayout);

    return () => {
      window.removeEventListener('resize', updateLayout);
    };
  }, []);

  useEffect(() => {
    const nextImmersive = isMobileLayout && screen === 'lesson';
    onImmersiveModeChange?.(nextImmersive);
    return () => onImmersiveModeChange?.(false);
  }, [isMobileLayout, onImmersiveModeChange, screen]);

  useEffect(() => {
    setLocalProgressByCourse((current) => {
      const nextState = { ...current };
      let mutated = false;

      overview.courses.forEach((course) => {
        if (!nextState[course._id]) {
          nextState[course._id] = readStoredProgress(course._id);
          mutated = true;
        }
      });

      return mutated ? nextState : current;
    });
  }, [overview.courses]);

  useEffect(() => {
    if (selectedCourseId && overview.courses.some((course) => course._id === selectedCourseId)) {
      return;
    }
    setSelectedCourseId(defaultCourseId);
  }, [defaultCourseId, overview.courses, selectedCourseId]);

  useEffect(() => {
    const resumeKey = `${initialCourseId || ''}::${initialLessonId || ''}`;
    if ((!initialCourseId && !initialLessonId) || handledResumeNavigationRef.current === resumeKey) {
      return;
    }

    const targetCourseId = initialCourseId || findCourseIdForLesson(overview.courses, initialLessonId) || defaultCourseId;
    if (targetCourseId) {
      setSelectedCourseId(targetCourseId);
      setScreen(initialLessonId ? 'lesson' : 'course');
      setSearchQuery('');
      setActiveCourseTab('Lessons');
      setActiveLessonTab('Video');
    }

    if (initialLessonId) {
      setSelectedLessonId(initialLessonId);
    }

    handledResumeNavigationRef.current = resumeKey;
    onResumeNavigationHandled?.();
  }, [defaultCourseId, initialCourseId, initialLessonId, onResumeNavigationHandled, overview.courses]);

  const selectedCourse = useMemo(
    () => overview.courses.find((course) => course._id === selectedCourseId) || overview.courses[0] || null,
    [overview.courses, selectedCourseId],
  );

  const selectedCourseSections = useMemo(
    () => buildCourseSections(selectedCourse),
    [selectedCourse],
  );

  useEffect(() => {
    if (!selectedCourse?._id || selectedCourseSections.length === 0) {
      return;
    }

    setExpandedSectionsByCourse((current) => {
      if (current[selectedCourse._id]?.length) {
        return current;
      }

      return {
        ...current,
        [selectedCourse._id]: [selectedCourseSections[0].id],
      };
    });
  }, [selectedCourse?._id, selectedCourseSections]);

  const localProgress = selectedCourse ? localProgressByCourse[selectedCourse._id] || {} : {};
  const selectedCourseEntries = selectedCourseSections.flatMap((section) => section.lessons);

  useEffect(() => {
    if (!selectedCourse) {
      setSelectedLessonId(null);
      return;
    }

    if (selectedLessonId && selectedCourseEntries.some((entry) => entry.lesson.id === selectedLessonId)) {
      return;
    }

    const continueEntry = selectedCourseEntries.find((entry) => entry.lesson.id === selectedCourse.continueLesson?.id)
      || selectedCourseEntries[0]
      || null;
    setSelectedLessonId(continueEntry?.lesson.id || null);
  }, [selectedCourse, selectedCourseEntries, selectedLessonId]);

  const selectedLessonEntry = useMemo(
    () => selectedCourseEntries.find((entry) => entry.lesson.id === selectedLessonId) || selectedCourseEntries[0] || null,
    [selectedCourseEntries, selectedLessonId],
  );

  const selectedLessonVideoDurationSeconds = Math.max((selectedLessonEntry?.lesson.durationMinutes || 1) * 60, 60);
  const selectedLessonExplanationDurationSeconds = EXPLANATION_DURATION_SECONDS;
  const selectedLessonStoredProgress = selectedLessonEntry ? localProgress[selectedLessonEntry.lesson.id] || null : null;
  const selectedLessonExamSelectedOption = selectedLessonEntry
    ? quizSelections[selectedLessonEntry.lesson.id] ?? selectedLessonStoredProgress?.examSelectedOption ?? null
    : null;
  const selectedLessonExamSubmitted = selectedLessonEntry
    ? Boolean(quizSubmitted[selectedLessonEntry.lesson.id] ?? selectedLessonStoredProgress?.examSubmitted)
    : false;
  const selectedLessonVideoWatchCount = getVideoWatchCount(selectedLessonStoredProgress);
  const selectedLessonExplanationWatchCount = getExplanationWatchCount(selectedLessonStoredProgress);
  const canRewatchLessonVideo = selectedLessonVideoWatchCount > 0 && selectedLessonVideoWatchCount < MAX_VIDEO_WATCHES;
  const hasReachedLessonVideoWatchLimit = selectedLessonVideoWatchCount >= MAX_VIDEO_WATCHES;
  const hasReachedExplanationWatchLimit = selectedLessonExplanationWatchCount >= MAX_EXPLANATION_WATCHES;
  const canWatchExplanation = selectedLessonExamSubmitted && !hasReachedExplanationWatchLimit;
  const selectedLessonStage: LessonStage = selectedLessonStoredProgress?.lessonStage || (selectedLessonStoredProgress?.completed ? 'explanation' : 'video');
  const lessonProgressTab: LessonTab = activeLessonTab;
  const transientProgress = selectedLessonEntry
    ? (() => {
      let progressPercent = selectedLessonStoredProgress?.progressPercent || 0;
      let progressSeconds = selectedLessonStoredProgress?.progressSeconds || 0;
      let completed = Boolean(selectedLessonStoredProgress?.completed);
      let lessonStage: LessonStage = selectedLessonStage;

      if (lessonProgressTab === 'Video') {
        progressPercent = Math.min(VIDEO_STAGE_PROGRESS, Math.round((videoPlaybackSeconds / selectedLessonVideoDurationSeconds) * VIDEO_STAGE_PROGRESS));
        progressSeconds = Math.min(videoPlaybackSeconds, selectedLessonVideoDurationSeconds);
        completed = false;
        lessonStage = 'video';
      } else if (lessonProgressTab === 'CBT Exam') {
        progressPercent = selectedLessonExamSubmitted ? EXAM_STAGE_PROGRESS : VIDEO_STAGE_PROGRESS;
        progressSeconds = selectedLessonVideoDurationSeconds;
        completed = false;
        lessonStage = selectedLessonExamSubmitted ? 'explanation' : 'exam';
      } else if (lessonProgressTab === 'Explanation') {
        const explanationProgress = Math.min(
          33,
          Math.round((explanationPlaybackSeconds / selectedLessonExplanationDurationSeconds) * 33),
        );
        progressPercent = selectedLessonExamSubmitted ? EXAM_STAGE_PROGRESS + explanationProgress : VIDEO_STAGE_PROGRESS;
        progressSeconds = explanationPlaybackSeconds;
        completed = selectedLessonExamSubmitted && explanationPlaybackSeconds >= selectedLessonExplanationDurationSeconds;
        lessonStage = completed ? 'explanation' : 'explanation';
        if (completed) {
          progressPercent = 100;
        }
      }

      return {
        lessonId: selectedLessonEntry.lesson.id,
        progressPercent,
        progressSeconds,
        completed,
        lessonStage,
        examSubmitted: selectedLessonExamSubmitted,
        examSelectedOption: selectedLessonExamSelectedOption,
        explanationSeconds: lessonProgressTab === 'Explanation' ? explanationPlaybackSeconds : 0,
        videoWatchCount: selectedLessonVideoWatchCount,
        explanationWatchCount: selectedLessonExplanationWatchCount,
        updatedAt: new Date().toISOString(),
      };
    })()
    : null;

  const selectedCourseProgressMap = useMemo(
    () => buildProgressMap(selectedCourse, localProgress, screen === 'lesson' ? transientProgress : null),
    [localProgress, screen, selectedCourse, transientProgress],
  );

  const unlockMap = useMemo(
    () => buildUnlockMap(selectedCourse, selectedCourseProgressMap),
    [selectedCourse, selectedCourseProgressMap],
  );

  const selectedCourseSnapshot = useMemo(
    () => selectedCourse
      ? buildCourseSnapshot(selectedCourse, localProgress, screen === 'lesson' ? transientProgress : null)
      : { totalLessons: 0, completedLessons: 0, progressPercent: 0 },
    [localProgress, screen, selectedCourse, transientProgress],
  );

  const selectedCourseExamAttempts = useMemo(
    () => selectedCourseEntries.filter((entry) => Boolean(selectedCourseProgressMap.get(entry.lesson.id)?.examSubmitted)).length,
    [selectedCourseEntries, selectedCourseProgressMap],
  );
  const selectedCourseVideoCompletedCount = useMemo(
    () => selectedCourseEntries.filter((entry) => hasLessonVideoMilestone(selectedCourseProgressMap.get(entry.lesson.id))).length,
    [selectedCourseEntries, selectedCourseProgressMap],
  );
  const selectedCourseVideoCompletedDisplayCount = useMemo(() => {
    if (!selectedLessonEntry) {
      return selectedCourseVideoCompletedCount;
    }

    const otherLessonsCompleted = selectedCourseEntries.filter((entry) =>
      entry.lesson.id !== selectedLessonEntry.lesson.id
      && hasLessonVideoMilestone(selectedCourseProgressMap.get(entry.lesson.id))).length;

    const currentLessonProgress = transientProgress ?? selectedLessonStoredProgress;
    return otherLessonsCompleted + (hasLessonVideoMilestone(currentLessonProgress) ? 1 : 0);
  }, [
    selectedCourseEntries,
    selectedCourseProgressMap,
    selectedCourseVideoCompletedCount,
    selectedLessonEntry,
    selectedLessonStoredProgress,
    transientProgress,
  ]);
  const currentExpandedSections = selectedCourse?._id ? expandedSectionsByCourse[selectedCourse._id] || [] : [];
  const selectedLessonCopy = useMemo(
    () => buildLessonCopy(selectedLessonEntry, selectedCourse),
    [selectedLessonEntry, selectedCourse],
  );

  useEffect(() => {
    if (!selectedLessonEntry) {
      return;
    }

    const lessonId = selectedLessonEntry.lesson.id;
    const mentorName = selectedCourse?.instructor || 'Mentor';

    setLessonDoubtThreads((current) => {
      if (current[lessonId]) {
        return current;
      }

      return {
        ...current,
        [lessonId]: [
          {
            id: `${lessonId}-doubt-1`,
            name: 'Aman',
            time: '10:05 AM',
            message: selectedLessonCopy.discussionPrompt,
          },
          {
            id: `${lessonId}-doubt-2`,
            name: mentorName,
            time: '10:06 AM',
            message: selectedLessonCopy.quickTip,
          },
        ],
      };
    });

    setLessonDoubtDrafts((current) => (
      Object.prototype.hasOwnProperty.call(current, lessonId)
        ? current
        : { ...current, [lessonId]: '' }
    ));
  }, [
    selectedCourse?.instructor,
    selectedLessonCopy.discussionPrompt,
    selectedLessonCopy.quickTip,
    selectedLessonEntry,
  ]);

  useEffect(() => {
    setMobileSupportTab('notes');
    setExpandedSupportPanel(null);
  }, [selectedLessonEntry?.lesson.id]);

  const selectedLessonIndex = selectedCourseEntries.findIndex((entry) => entry.lesson.id === selectedLessonEntry?.lesson.id);
  const nextLessonEntry = selectedLessonIndex >= 0 && selectedLessonIndex < selectedCourseEntries.length - 1
    ? selectedCourseEntries[selectedLessonIndex + 1]
    : null;

  const filteredCourseSections = useMemo(() => {
    const query = normalize(searchQuery);

    if (!query) {
      return selectedCourseSections;
    }

    return selectedCourseSections
      .map((section) => ({
        ...section,
        lessons: section.lessons.filter((entry) => normalize(entry.lesson.title).includes(query)),
      }))
      .filter((section) => section.lessons.length > 0 || normalize(section.title).includes(query));
  }, [searchQuery, selectedCourseSections]);

  const categories = useMemo(
    () => ['all', ...Array.from(new Set(overview.courses.map((course) => course.exam || course.category).filter(Boolean)))],
    [overview.courses],
  );

  const courseSnapshots = useMemo(
    () => overview.courses.reduce<Record<string, { totalLessons: number; completedLessons: number; progressPercent: number }>>((accumulator, course) => {
      accumulator[course._id] = buildCourseSnapshot(
        course,
        localProgressByCourse[course._id] || {},
        course._id === selectedCourse?._id && screen === 'lesson' ? transientProgress : null,
      );
      return accumulator;
    }, {}),
    [localProgressByCourse, overview.courses, screen, selectedCourse?._id, transientProgress],
  );

  const filteredCourses = useMemo(() => {
    const query = normalize(searchQuery);

    return [...overview.courses]
      .filter((course) => {
        const snapshot = courseSnapshots[course._id] || { totalLessons: 0, completedLessons: 0, progressPercent: 0 };
        const matchesQuery = !query || [
          course.title,
          course.subject,
          course.category,
          course.exam,
          course.instructor,
        ].some((value) => normalize(value).includes(query));
        const matchesCategory = categoryFilter === 'all' || normalize(course.exam || course.category) === normalize(categoryFilter);
        const matchesStatus = statusFilter === 'all'
          || (statusFilter === 'unlocked' && Boolean(course.enrolled || course.price === 0))
          || (statusFilter === 'progress' && snapshot.progressPercent > 0 && snapshot.progressPercent < 100)
          || (statusFilter === 'completed' && snapshot.progressPercent >= 100)
          || (statusFilter === 'not-started' && snapshot.progressPercent === 0);

        return matchesQuery && matchesCategory && matchesStatus;
      })
      .sort((left, right) => {
        const leftSnapshot = courseSnapshots[left._id] || { totalLessons: 0, completedLessons: 0, progressPercent: 0 };
        const rightSnapshot = courseSnapshots[right._id] || { totalLessons: 0, completedLessons: 0, progressPercent: 0 };

        if (sortBy === 'title') {
          return left.title.localeCompare(right.title);
        }

        if (sortBy === 'progress') {
          return rightSnapshot.progressPercent - leftSnapshot.progressPercent || left.title.localeCompare(right.title);
        }

        return Number(Boolean(right.enrolled)) - Number(Boolean(left.enrolled))
          || rightSnapshot.progressPercent - leftSnapshot.progressPercent
          || left.title.localeCompare(right.title);
      });
  }, [categoryFilter, courseSnapshots, overview.courses, searchQuery, sortBy, statusFilter]);

  const mobileCatalogCourses = useMemo(
    () => [...filteredCourses].sort((left, right) => {
      const priorityDelta = getMobileCoursePriority(left) - getMobileCoursePriority(right);
      return priorityDelta || left.title.localeCompare(right.title);
    }),
    [filteredCourses],
  );

  const recommendedTopics = useMemo(() => {
    const lessonTitles = selectedCourseSections.flatMap((section) => section.lessons.map((entry) => entry.lesson.title));
    return Array.from(
      new Set([
        ...lessonTitles,
        ...overview.dashboard.strongTopics,
        ...overview.dashboard.weakTopics,
      ]),
    ).slice(0, 4);
  }, [overview.dashboard.strongTopics, overview.dashboard.weakTopics, selectedCourseSections]);
  const selectedLessonSaved = Boolean(selectedCourse && selectedLessonEntry && savedTopicIds.includes(`${selectedCourse._id}:${selectedLessonEntry.lesson.id}`));

  const derivedMobileLessonStage: MobileLessonStage = useMemo(() => {
    if (!selectedLessonEntry) {
      return 'watch';
    }

    if (isVideoReplayMode) {
      return 'watch';
    }

    if (selectedLessonStoredProgress?.completed) {
      return 'completed';
    }

    if (selectedLessonExamSubmitted && selectedLessonStoredProgress?.lessonStage === 'explanation') {
      return explanationPlaybackSeconds > 0 ? 'explanation' : 'exam-complete';
    }

    if (selectedLessonStoredProgress?.lessonStage === 'exam') {
      return 'completed';
    }

    if (selectedLessonStoredProgress?.lessonStage === 'explanation') {
      return 'explanation';
    }

    return 'watch';
  }, [
    explanationPlaybackSeconds,
    hasReachedLessonVideoWatchLimit,
    isVideoReplayMode,
    selectedLessonEntry,
    selectedLessonExamSubmitted,
    selectedLessonStoredProgress?.completed,
    selectedLessonStoredProgress?.lessonStage,
  ]);

  const mobileLessonStage = mobileLessonStageOverride || derivedMobileLessonStage;
  const isLessonReadyForExam = selectedLessonStage !== 'video';
  const isExplanationUnlocked = canWatchExplanation;
  const isLessonFlowComplete = Boolean(selectedLessonStoredProgress?.completed);

  useEffect(() => {
    setMobileLessonStageOverride(null);
    setIsVideoReplayMode(false);
  }, [selectedLessonEntry?.lesson.id, selectedCourse?._id]);

  useEffect(() => {
    setExpandedSupportPanel(null);
  }, [selectedLessonEntry?.lesson.id, selectedCourse?._id]);

  useEffect(() => {
    setMobileCourseTab('Content');
  }, [selectedCourse?._id, screen]);

  useEffect(() => {
    if (!selectedLessonEntry) {
      setVideoPlaybackSeconds(0);
      setExplanationPlaybackSeconds(0);
      setIsVideoPlaying(false);
      setIsExplanationPlaying(false);
      setAutoplayCountdown(null);
      return;
    }

    const isCompletionState = Boolean(
      selectedLessonStoredProgress?.completed || selectedLessonStoredProgress?.lessonStage === 'explanation',
    );

    autoplayHandledRef.current = null;
    setIsVideoPlaying(false);
    setIsExplanationPlaying(false);
    if (!isCompletionState) {
      setAutoplayCountdown(null);
    }
    setPlaybackSpeed(1);
    setVideoPlaybackSeconds(
      selectedLessonStoredProgress?.lessonStage === 'video' || !selectedLessonStoredProgress?.lessonStage
        ? selectedLessonStoredProgress?.progressSeconds || 0
        : selectedLessonStoredProgress?.completed
          ? selectedLessonVideoDurationSeconds
          : 0,
    );
    setExplanationPlaybackSeconds(selectedLessonStoredProgress?.explanationSeconds || 0);

    if (isMobileLayout) {
      setActiveLessonTab('Video');
      return;
    }

    if (selectedLessonStoredProgress?.lessonStage === 'exam') {
      setActiveLessonTab('Video');
      return;
    }

    if (selectedLessonStoredProgress?.completed) {
      setActiveLessonTab('Video');
      return;
    }

    if (selectedLessonStoredProgress?.lessonStage === 'explanation') {
      setActiveLessonTab('CBT Exam');
      return;
    }

    setActiveLessonTab('Video');
  }, [isMobileLayout, selectedLessonEntry?.lesson.id, selectedLessonStoredProgress, selectedLessonVideoDurationSeconds]);

  useEffect(() => {
    if (screen !== 'lesson' || !selectedLessonEntry || autoplayCountdown !== null) {
      return;
    }

    const shouldTickVideo = lessonProgressTab === 'Video' && isVideoPlaying;
    const shouldTickExplanation = lessonProgressTab === 'Explanation' && isExplanationPlaying;

    if (!shouldTickVideo && !shouldTickExplanation) {
      return;
    }

    const intervalId = window.setInterval(() => {
      const delta = Math.max(Math.round(PLAYER_TICK_STEP_SECONDS * playbackSpeed), 8);
      if (shouldTickVideo) {
        setVideoPlaybackSeconds((current) => Math.min(current + delta, selectedLessonVideoDurationSeconds));
      }
      if (shouldTickExplanation) {
        setExplanationPlaybackSeconds((current) => Math.min(current + delta, selectedLessonExplanationDurationSeconds));
      }
    }, PLAYER_TICK_MS);

    return () => window.clearInterval(intervalId);
  }, [
    autoplayCountdown,
    explanationPlaybackSeconds,
    isExplanationPlaying,
    isVideoPlaying,
    lessonProgressTab,
    playbackSpeed,
    screen,
    selectedLessonEntry,
    selectedLessonExplanationDurationSeconds,
    selectedLessonVideoDurationSeconds,
  ]);

  const persistProgress = (courseId: string, lessonId: string, nextRecord: StoredProgressPatch) => {
    const targetCourse = overview.courses.find((course) => course._id === courseId);
    const targetEntry = buildCourseSections(targetCourse).flatMap((section) => section.lessons).find((item) => item.lesson.id === lessonId);

    if (!targetCourse || !targetEntry) {
      return;
    }

    setLocalProgressByCourse((current) => {
      const seededProgress = (targetCourse.lessonProgress || []).find((entry) => entry.lessonId === lessonId) as StoredProgress | undefined;
      const existingRecord: StoredProgress | undefined = current[courseId]?.[lessonId] || seededProgress;
      const mergedRecord: StoredProgress = {
        lessonId,
        progressPercent: Number(existingRecord?.progressPercent || 0),
        progressSeconds: Number(existingRecord?.progressSeconds || 0),
        completed: Boolean(existingRecord?.completed),
        updatedAt: nextRecord.updatedAt || new Date().toISOString(),
        ...(existingRecord || {}),
        ...nextRecord,
        explanationSeconds: nextRecord.explanationSeconds ?? existingRecord?.explanationSeconds ?? 0,
        examSubmitted: nextRecord.examSubmitted ?? existingRecord?.examSubmitted ?? false,
        examSelectedOption: Object.prototype.hasOwnProperty.call(nextRecord, 'examSelectedOption')
          ? nextRecord.examSelectedOption ?? null
          : existingRecord?.examSelectedOption ?? null,
        videoWatchCount: nextRecord.videoWatchCount ?? getVideoWatchCount(existingRecord),
        explanationWatchCount: nextRecord.explanationWatchCount ?? getExplanationWatchCount(existingRecord),
      };
      const nextCourseProgress = {
        ...(current[courseId] || {}),
        [lessonId]: mergedRecord,
      };
      writeStoredProgress(courseId, nextCourseProgress);
      return {
        ...current,
        [courseId]: nextCourseProgress,
      };
    });
  };

  const startLessonVideoReplay = () => {
    if (!selectedLessonEntry || !canRewatchLessonVideo) {
      return;
    }

    autoplayHandledRef.current = null;
    setAutoplayCountdown(null);
    setIsVideoReplayMode(true);
    setActiveLessonTab('Video');
    setMobileLessonStageOverride('watch');
    setVideoPlaybackSeconds(0);
    setIsVideoPlaying(false);
    setIsExplanationPlaying(false);
  };

  useEffect(() => {
    if (!selectedCourse || !selectedLessonEntry || screen !== 'lesson') {
      return;
    }

    const autoplayKey = `${selectedLessonEntry.lesson.id}::${lessonProgressTab}`;
    if (autoplayHandledRef.current === autoplayKey) {
      return;
    }

    if (lessonProgressTab === 'Video') {
      if (videoPlaybackSeconds < selectedLessonVideoDurationSeconds) {
        return;
      }

      if (!isVideoReplayMode && hasLessonVideoMilestone(selectedLessonStoredProgress)) {
        autoplayHandledRef.current = autoplayKey;
        setIsVideoPlaying(false);
        if (isMobileLayout) {
          setMobileLessonStageOverride('completed');
        } else {
          setActiveLessonTab('Video');
        }
        return;
      }

      const nextVideoWatchCount = Math.min(selectedLessonVideoWatchCount + 1, MAX_VIDEO_WATCHES);
      const preserveCompletion = Boolean(selectedLessonStoredProgress?.completed);
      const nextLessonStage: LessonStage = selectedLessonExamSubmitted || preserveCompletion ? 'explanation' : 'exam';
      const nextProgressPercent = preserveCompletion
        ? 100
        : selectedLessonExamSubmitted
          ? EXAM_STAGE_PROGRESS
          : VIDEO_STAGE_PROGRESS;

      autoplayHandledRef.current = autoplayKey;
      setIsVideoPlaying(false);
      setIsVideoReplayMode(false);
      persistProgress(selectedCourse._id, selectedLessonEntry.lesson.id, {
        lessonId: selectedLessonEntry.lesson.id,
        progressSeconds: preserveCompletion ? selectedLessonExplanationDurationSeconds : selectedLessonVideoDurationSeconds,
        progressPercent: nextProgressPercent,
        completed: preserveCompletion,
        lessonStage: nextLessonStage,
        examSubmitted: selectedLessonExamSubmitted,
        examSelectedOption: selectedLessonExamSelectedOption,
        explanationSeconds: selectedLessonStoredProgress?.explanationSeconds || 0,
        videoWatchCount: nextVideoWatchCount,
        explanationWatchCount: selectedLessonExplanationWatchCount,
        updatedAt: new Date().toISOString(),
      });

      if (isMobileLayout) {
        setMobileLessonStageOverride('completed');
      } else {
        setActiveLessonTab('Video');
      }
      return;
    }

    if (lessonProgressTab === 'Explanation' && explanationPlaybackSeconds >= selectedLessonExplanationDurationSeconds) {
      autoplayHandledRef.current = autoplayKey;
      setIsExplanationPlaying(false);
      persistProgress(selectedCourse._id, selectedLessonEntry.lesson.id, {
        lessonId: selectedLessonEntry.lesson.id,
        progressSeconds: selectedLessonExplanationDurationSeconds,
        progressPercent: 100,
        completed: true,
        lessonStage: 'explanation',
        examSubmitted: true,
        examSelectedOption: selectedLessonExamSelectedOption,
        explanationSeconds: selectedLessonExplanationDurationSeconds,
        videoWatchCount: selectedLessonVideoWatchCount,
        explanationWatchCount: MAX_EXPLANATION_WATCHES,
        updatedAt: new Date().toISOString(),
      });

      if (isMobileLayout) {
        if (autoplayEnabled && nextLessonEntry) {
          openNextLesson(true);
          return;
        }
        setActiveLessonTab('Video');
        setMobileLessonStageOverride('explanation-complete');
        return;
      }

      if (!isMobileLayout && autoplayEnabled && nextLessonEntry) {
        setAutoplayCountdown(AUTOPLAY_COUNTDOWN_SECONDS);
      }
    }
  }, [
    autoplayEnabled,
    explanationPlaybackSeconds,
    lessonProgressTab,
    nextLessonEntry,
    isMobileLayout,
    isVideoReplayMode,
    selectedLessonExplanationWatchCount,
    screen,
    selectedCourse,
    selectedLessonExamSelectedOption,
    selectedLessonExamSubmitted,
    selectedLessonExplanationDurationSeconds,
    selectedLessonEntry,
    selectedLessonStoredProgress?.completed,
    selectedLessonStoredProgress?.lessonStage,
    selectedLessonStoredProgress?.explanationSeconds,
    selectedLessonVideoDurationSeconds,
    selectedLessonVideoWatchCount,
    videoPlaybackSeconds,
  ]);

  useEffect(() => {
    if (autoplayCountdown === null) {
      return;
    }

    if (autoplayCountdown <= 0) {
      if (nextLessonEntry) {
        setSelectedLessonId(nextLessonEntry.lesson.id);
        setActiveLessonTab('Video');
        setVideoPlaybackSeconds(0);
        setExplanationPlaybackSeconds(0);
      }
      setAutoplayCountdown(null);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setAutoplayCountdown((current) => (current === null ? null : current - 1));
    }, 1000);

    return () => window.clearTimeout(timeoutId);
  }, [autoplayCountdown, nextLessonEntry]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === playerViewportRef.current);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = async () => {
    if (!playerViewportRef.current) {
      return;
    }

    if (document.fullscreenElement === playerViewportRef.current) {
      await document.exitFullscreen().catch(() => undefined);
      return;
    }

    await playerViewportRef.current.requestFullscreen?.().catch(() => undefined);
  };

  const submitLessonExam = (advanceToExplanation: boolean) => {
    if (!selectedCourse || !selectedLessonEntry) {
      return;
    }

    setQuizSubmitted((current) => ({ ...current, [selectedLessonEntry.lesson.id]: true }));
    persistProgress(selectedCourse._id, selectedLessonEntry.lesson.id, {
      lessonId: selectedLessonEntry.lesson.id,
      progressSeconds: selectedLessonVideoDurationSeconds,
      progressPercent: EXAM_STAGE_PROGRESS,
      completed: false,
      lessonStage: 'explanation',
      examSubmitted: true,
      examSelectedOption: selectedLessonExamSelectedOption,
      explanationSeconds: explanationPlaybackSeconds,
      updatedAt: new Date().toISOString(),
    });

    if (isMobileLayout) {
      setMobileLessonStageOverride(advanceToExplanation ? 'explanation' : 'exam-complete');
      setIsExplanationPlaying(false);
      setIsVideoReplayMode(false);
      return;
    }

    setActiveLessonTab('CBT Exam');
    setIsExplanationPlaying(false);
    setIsVideoReplayMode(false);
  };

  const startLessonExam = () => {
    if (!isLessonReadyForExam) {
      return;
    }

    if (isMobileLayout) {
      setActiveLessonTab('CBT Exam');
      setMobileLessonStageOverride('exam');
      setIsVideoReplayMode(false);
      return;
    }

    setActiveLessonTab('CBT Exam');
    setIsVideoReplayMode(false);
  };

  const openLessonExplanation = () => {
    if (!canWatchExplanation) {
      return;
    }

    if (isMobileLayout) {
      setActiveLessonTab('Explanation');
      setMobileLessonStageOverride('explanation');
      setIsExplanationPlaying(false);
      setIsVideoReplayMode(false);
      return;
    }

    setActiveLessonTab('Explanation');
    setIsExplanationPlaying(false);
    setIsVideoReplayMode(false);
  };

  const completeMobileLessonAndAdvance = () => {
    if (selectedCourse && selectedLessonEntry) {
      persistProgress(selectedCourse._id, selectedLessonEntry.lesson.id, {
        lessonId: selectedLessonEntry.lesson.id,
        progressSeconds: selectedLessonExplanationDurationSeconds,
        progressPercent: 100,
        completed: true,
        lessonStage: 'explanation',
        examSubmitted: true,
        examSelectedOption: selectedLessonExamSelectedOption,
        explanationSeconds: selectedLessonExplanationDurationSeconds,
        videoWatchCount: selectedLessonVideoWatchCount,
        explanationWatchCount: MAX_EXPLANATION_WATCHES,
        updatedAt: new Date().toISOString(),
      });
    }

    openNextLesson(true);
  };

  const openCourse = (courseId: string, nextScreen: Screen = 'course') => {
    const targetCourse = overview.courses.find((course) => course._id === courseId);
    if (!targetCourse) {
      return;
    }

    const sections = buildCourseSections(targetCourse);
    const nextLesson = sections.flatMap((section) => section.lessons).find((entry) => entry.lesson.id === targetCourse.continueLesson?.id)
      || sections.flatMap((section) => section.lessons)[0]
      || null;

    setSelectedCourseId(courseId);
    setSelectedLessonId(nextLesson?.lesson.id || null);
    setScreen(nextScreen);
    setActiveCourseTab('Lessons');
    setActiveLessonTab('Video');
    setMobileLessonStageOverride(null);
    setSearchQuery('');
    setAutoplayCountdown(null);
    setIsVideoPlaying(false);
    setIsExplanationPlaying(false);
    setExpandedSectionsByCourse((current) => ({
      ...current,
      [courseId]: current[courseId]?.length ? current[courseId] : sections[0] ? [sections[0].id] : [],
    }));
  };

  const openLesson = (lessonId: string, forceOpen = false) => {
    if (!selectedCourse) {
      return;
    }

    const targetEntry = selectedCourseEntries.find((entry) => entry.lesson.id === lessonId);
    if (!targetEntry || (!forceOpen && !unlockMap.get(lessonId)?.unlocked)) {
      return;
    }

    setExpandedSectionsByCourse((current) => ({
      ...current,
      [selectedCourse._id]: Array.from(new Set([...(current[selectedCourse._id] || []), targetEntry.sectionId])),
    }));
    setSelectedLessonId(lessonId);
    setScreen('lesson');
    setActiveLessonTab('Video');
    setMobileLessonStageOverride(null);
    setSearchQuery('');
    setVideoPlaybackSeconds(0);
    setExplanationPlaybackSeconds(0);
    setIsVideoPlaying(false);
    setIsExplanationPlaying(false);
    setIsVideoReplayMode(false);
  };

  const toggleSection = (sectionId: string) => {
    if (!selectedCourse) {
      return;
    }

    setExpandedSectionsByCourse((current) => {
      const existing = current[selectedCourse._id] || [];
      const next = existing.includes(sectionId)
        ? existing.filter((item) => item !== sectionId)
        : [...existing, sectionId];

      return {
        ...current,
        [selectedCourse._id]: next,
      };
    });
  };

  const handlePrimaryLessonAction = () => {
    if (!selectedLessonEntry) {
      return;
    }

    if (activeLessonTab === 'Video') {
      if (!isLessonReadyForExam) {
        setActiveLessonTab('Video');
        setIsVideoPlaying((current) => !current);
        return;
      }

      if (!selectedLessonExamSubmitted) {
        startLessonExam();
        return;
      }

      if (!isLessonFlowComplete) {
        openLessonExplanation();
        return;
      }

      openNextLesson();
      return;
    }

    if (activeLessonTab === 'CBT Exam') {
      if (!selectedLessonExamSubmitted) {
        if (selectedLessonExamSelectedOption === null) {
          return;
        }
        submitLessonExam(false);
        return;
      }
      openLessonExplanation();
      return;
    }

    if (activeLessonTab === 'Explanation') {
      if (explanationPlaybackSeconds >= selectedLessonExplanationDurationSeconds) {
        openNextLesson();
        return;
      }
      setIsExplanationPlaying((current) => !current);
    }
  };

  const openNextLesson = (forceOpen = false) => {
    if (!nextLessonEntry || (!forceOpen && !unlockMap.get(nextLessonEntry.lesson.id)?.unlocked)) {
      return;
    }
    setAutoplayCountdown(null);
    setIsVideoReplayMode(false);
    openLesson(nextLessonEntry.lesson.id, forceOpen);
  };

  const isLessonTabUnlocked = (tab: LessonTab) => {
    if (tab === 'CBT Exam') {
      return isLessonReadyForExam;
    }

    if (tab === 'Explanation') {
      return isExplanationUnlocked;
    }

    return true;
  };

  const handleLessonTabSelect = (tab: LessonTab) => {
    if (!isLessonTabUnlocked(tab)) {
      return;
    }

    setActiveLessonTab(tab);
    if (tab !== 'Video') {
      setIsVideoReplayMode(false);
    } else {
      setIsVideoReplayMode(false);
      setMobileLessonStageOverride(null);
    }

    if (!isMobileLayout) {
      if (tab === 'Explanation') {
        setIsExplanationPlaying(false);
      }
      return;
    }

    if (tab === 'CBT Exam') {
      setMobileLessonStageOverride(selectedLessonExamSubmitted ? 'exam-complete' : 'exam');
      return;
    }

    if (tab === 'Explanation') {
      setMobileLessonStageOverride('explanation');
      setIsExplanationPlaying(false);
      return;
    }

    if (tab === 'Video') {
      setMobileLessonStageOverride(null);
      return;
    }

    setMobileLessonStageOverride(null);
  };

  const nextStepDescriptor = useMemo(() => {
    if (!selectedLessonEntry) {
      return null;
    }

    if (!selectedLessonExamSubmitted) {
      return {
        kind: 'cbt' as const,
        title: 'Chapter CBT Exam',
        subtitle: isLessonReadyForExam
          ? 'Take the one-time chapter based test before the explanation unlocks.'
          : 'Finish this lesson video first to unlock the chapter test.',
        badge: isLessonReadyForExam ? 'Ready' : 'Lesson required',
        actionLabel: isLessonReadyForExam ? 'Start CBT Exam' : 'Finish lesson first',
        onClick: isLessonReadyForExam ? startLessonExam : undefined,
        disabled: !isLessonReadyForExam,
      };
    }

    if (!isLessonFlowComplete) {
      return {
        kind: 'explanation' as const,
        title: 'CBT Explanation Video',
        subtitle: 'Watch the explanation once before the next lesson unlocks.',
        badge: 'One-time watch',
        actionLabel: 'Watch Explanation',
        onClick: canWatchExplanation ? openLessonExplanation : undefined,
        disabled: !canWatchExplanation,
      };
    }

    if (nextLessonEntry) {
      return {
        kind: 'lesson' as const,
        title: nextLessonEntry.lesson.title,
        subtitle: formatDurationLabel(nextLessonEntry.lesson.durationMinutes),
        badge: autoplayCountdown !== null ? `Autoplay in ${autoplayCountdown}s` : 'Ready',
        actionLabel: 'Open Next Lesson',
        onClick: openNextLesson,
        disabled: false,
      };
    }

    return {
      kind: 'complete' as const,
      title: 'Lesson sequence complete',
      subtitle: 'You have completed this lesson path.',
      badge: 'Done',
      actionLabel: 'Completed',
      onClick: undefined,
      disabled: true,
    };
  }, [
    autoplayCountdown,
    isExplanationUnlocked,
    isLessonFlowComplete,
    isLessonReadyForExam,
    nextLessonEntry,
    canWatchExplanation,
    openNextLesson,
    openLessonExplanation,
    selectedLessonEntry,
    selectedLessonExamSubmitted,
    startLessonExam,
  ]);

  const primaryLessonActionLabel = activeLessonTab === 'Explanation'
    ? explanationPlaybackSeconds >= selectedLessonExplanationDurationSeconds
      ? 'Next Lesson'
      : isExplanationPlaying
        ? 'Pause Explanation'
        : 'Play Explanation'
    : activeLessonTab === 'CBT Exam'
      ? selectedLessonExamSubmitted
        ? 'Watch Explanation'
        : 'Submit CBT'
      : isVideoReplayMode || !isLessonReadyForExam
        ? (isVideoPlaying ? 'Pause Lesson' : 'Resume Lesson')
        : !selectedLessonExamSubmitted
          ? 'Start CBT Exam'
          : !isLessonFlowComplete
            ? 'Watch Explanation'
            : 'Open Next Lesson';

  const primaryLessonActionDisabled = activeLessonTab === 'CBT Exam'
    ? !selectedLessonExamSubmitted && selectedLessonExamSelectedOption === null
    : false;

  const renderNextStepCard = (variant: 'desktop' | 'mobile') => {
    if (!nextStepDescriptor) {
      return null;
    }

    const isMobileCard = variant === 'mobile';
    const Icon = nextStepDescriptor.kind === 'cbt'
      ? ClipboardCheck
      : nextStepDescriptor.kind === 'explanation'
        ? Video
        : nextStepDescriptor.kind === 'lesson'
          ? Play
          : CheckCircle2;

    return (
      <section
        data-testid="course-up-next"
        className={cn(
          isMobileCard
            ? 'rounded-[16px] border border-[#dbe4f3] bg-white px-[13px] py-[11px] shadow-[0_12px_24px_rgba(54,78,123,0.04)]'
            : 'rounded-[22px] bg-white px-[18px] py-[16px] shadow-[0_16px_34px_rgba(54,78,123,0.08)]',
        )}
      >
        <div className="flex items-center justify-between gap-[12px]">
          <p className={cn(isMobileCard ? 'text-[13px]' : 'text-[17px]', 'font-semibold text-[#17233f]')}>Up Next</p>
          <span className={cn(isMobileCard ? 'text-[11px]' : 'text-[13px]', 'font-medium text-[#2d6ee5]')}>
            {nextStepDescriptor.badge}
          </span>
        </div>

        <div
          className={cn(
            'mt-[12px] rounded-[16px] border border-[#e7edf7] bg-[#fbfdff]',
            isMobileCard ? 'px-[11px] py-[11px]' : 'px-[14px] py-[14px]',
          )}
        >
          <div className="flex items-start gap-[12px]">
            <div
              className={cn(
                'flex shrink-0 items-center justify-center rounded-[14px] bg-[#e8f0ff] text-[#2d6ee5]',
                isMobileCard ? 'h-[38px] w-[38px]' : 'h-[44px] w-[44px]',
              )}
            >
              <Icon className={cn(nextStepDescriptor.kind === 'lesson' ? 'ml-[1px]' : '', isMobileCard ? 'h-[16px] w-[16px]' : 'h-[19px] w-[19px]', nextStepDescriptor.kind === 'lesson' && 'fill-current')} />
            </div>
            <div className="min-w-0 flex-1">
              <p className={cn(isMobileCard ? 'text-[13px]' : 'text-[15px]', 'font-semibold leading-[1.22] text-[#23385f]')}>
                {nextStepDescriptor.title}
              </p>
              <p className={cn(isMobileCard ? 'mt-[3px] text-[11px]' : 'mt-[5px] text-[13px]', 'leading-[1.4] text-[#6e80a1]')}>
                {nextStepDescriptor.subtitle}
              </p>
            </div>
          </div>

          <button
            type="button"
            data-testid={
              nextStepDescriptor.kind === 'cbt'
                ? 'course-player-start-cbt'
                : nextStepDescriptor.kind === 'explanation'
                  ? 'course-player-watch-explanation'
                  : nextStepDescriptor.kind === 'lesson'
                    ? 'course-player-continue-next-lesson'
                    : undefined
            }
            onClick={() => nextStepDescriptor.onClick?.()}
            disabled={nextStepDescriptor.disabled}
            className={cn(
              'mt-[14px] inline-flex w-full items-center justify-center rounded-[10px] text-center font-semibold transition',
              isMobileCard ? 'h-[36px] text-[12px]' : 'h-[42px] text-[14px]',
              nextStepDescriptor.disabled
                ? 'cursor-not-allowed border border-[#d7e1f0] bg-[#f2f6fd] text-[#8aa0c2]'
                : 'bg-[linear-gradient(180deg,#2f6ef0_0%,#2660e3_100%)] text-white shadow-[0_12px_24px_rgba(45,110,229,0.20)]',
            )}
          >
            {nextStepDescriptor.actionLabel}
          </button>
        </div>
      </section>
    );
  };

  const userName = overview.user?.name || 'Edu Master';
  const notificationCount = overview.notifications.length;
  const selectedTone = getCatalogTone(selectedCourse || overview.courses[0], 0);
  const selectedToneStyles = toneStyles[selectedTone];
  const breadcrumbLabel = selectedLessonEntry
    ? ['Courses', selectedCourse?.title, selectedLessonEntry.sectionLabel, selectedLessonEntry.lesson.title].filter(Boolean).join(' / ')
    : ['Courses', selectedCourse?.title].filter(Boolean).join(' / ');

  const renderCatalogView = () => (
    isMobileLayout ? (
      <div
        data-testid="course-figma-page"
        data-course-view="catalog"
        className="min-h-[100dvh] bg-[#f4f7ff] pb-[76px]"
      >
        <div className="px-[12px] pb-[10px] pt-[10px]" style={uiFontStyle}>
          <div className="flex items-center justify-between text-[12px] font-semibold text-[#101828]">
            <span>9:41</span>
            <div className="flex items-center gap-[5px]">
              <span className="h-[7px] w-[5px] rounded-[2px] bg-[#101828]" />
              <span className="h-[9px] w-[5px] rounded-[2px] bg-[#101828]" />
              <span className="h-[11px] w-[5px] rounded-[2px] bg-[#101828]" />
              <span className="ml-[4px] h-[10px] w-[20px] rounded-full border border-[#101828]" />
            </div>
          </div>

          <header className="mt-[12px]">
            <div className="flex items-center justify-between gap-[12px]">
              <h1 className="text-[20px] font-semibold leading-none tracking-[-0.03em] text-[#1c2844]">All Courses</h1>
              <div className="flex items-center gap-[12px] text-[#1d3158]">
                <Search className="h-[21px] w-[21px]" />
                <button
                  type="button"
                  className="relative flex h-[24px] w-[24px] items-center justify-center"
                  data-testid="course-catalog-notification"
                >
                  <Bell className="h-[21px] w-[21px]" />
                  <span className="absolute right-0 top-0 h-[8px] w-[8px] rounded-full bg-[#ff4d5f]" />
                </button>
              </div>
            </div>

            <label
              data-testid="course-catalog-search"
              className="mt-[12px] flex h-[42px] items-center gap-[10px] rounded-[14px] border border-[#d9e3f2] bg-white px-[13px] text-[13px] text-[#7f8fb0] shadow-[0_8px_18px_rgba(28,41,61,0.04)]"
            >
              <Search className="h-[17px] w-[17px]" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search courses..."
                className="w-full bg-transparent text-[#1f2d4e] outline-none placeholder:text-[#9aa7bc]"
              />
            </label>
          </header>

          <div className="mt-[14px] space-y-[8px]">
            {mobileCatalogCourses.map((course, index) => {
              const tone = getMobileCatalogTone(course);
              const styles = toneStyles[tone];
              const snapshot = courseSnapshots[course._id] || { totalLessons: 0, completedLessons: 0, progressPercent: 0 };
              const actionLabel = snapshot.progressPercent > 0 ? 'Continue' : course.enrolled ? 'Start Course' : course.price === 0 ? 'Open Course' : 'Explore';
              const icon = index % 3 === 0
                ? <BookOpen className="h-[26px] w-[26px]" />
                : index % 3 === 1
                  ? <FileText className="h-[26px] w-[26px]" />
                  : <ClipboardCheck className="h-[26px] w-[26px]" />;

              return (
                <button
                  key={course._id}
                  type="button"
                  data-testid={`course-catalog-card-${slugify(course._id)}`}
                  onClick={() => openCourse(course._id, 'course')}
                  className="w-full overflow-hidden rounded-[18px] border border-[#dee7f4] bg-white px-[11px] py-[10px] text-left shadow-[0_10px_24px_rgba(28,41,61,0.06)]"
                >
                  <div className="flex items-start gap-[10px]">
                    <div className={cn('flex h-[48px] w-[48px] shrink-0 items-center justify-center rounded-[14px]', styles.sidebar, styles.chip.replace('text-white', 'text-current'))}>
                      {React.cloneElement(icon, { className: 'h-[22px] w-[22px]' })}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-[8px]">
                        <div className="min-w-0">
                          <span className={cn('inline-flex rounded-full px-[10px] py-[3px] text-[10px] font-semibold uppercase tracking-[0.03em]', styles.chip)}>
                            {course.exam || course.category || 'Course'}
                          </span>
                          <p className="mt-[6px] text-[13px] font-semibold leading-[1.16] text-[#1f2d4e]">{getMobileCourseTitle(course)}</p>
                          <p className="mt-[2px] text-[11px] text-[#6d7c93]">{course.subject || course.category || 'Competitive Exam'}</p>
                        </div>
                        <MoreVertical className="h-[17px] w-[17px] shrink-0 text-[#7f8fb0]" />
                      </div>

                      <div className="mt-[8px] flex items-center gap-[8px]">
                        <p className="shrink-0 text-[11px] font-medium text-[#5e7397]">{snapshot.progressPercent}% Completed</p>
                        <div className="h-[5px] flex-1 overflow-hidden rounded-full bg-[#e8eef7]">
                          <div className={cn('h-full rounded-full', styles.progress)} style={{ width: `${Math.max(snapshot.progressPercent, 4)}%` }} />
                        </div>
                        <span className={cn('inline-flex h-[30px] shrink-0 items-center rounded-[10px] px-[11px] text-[11px] font-semibold text-white', styles.button)}>
                          {actionLabel}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-[10px] grid grid-cols-3 gap-[6px] border-t border-[#eef2f8] pt-[8px]">
                    <div className="text-center">
                      <p className="text-[13px] font-semibold text-[#1f2d4e]">{snapshot.totalLessons}</p>
                      <p className="mt-[2px] text-[10px] text-[#7b879d]">Course flow</p>
                    </div>
                    <div className="border-x border-[#eef2f8] text-center">
                      <p className="text-[13px] font-semibold text-[#1f2d4e]">{snapshot.completedLessons}</p>
                      <p className="mt-[2px] text-[10px] text-[#7b879d]">Completed</p>
                    </div>
                    <div className="text-center">
                      <p className="text-[13px] font-semibold text-[#1f2d4e]">{snapshot.progressPercent}%</p>
                      <p className="mt-[2px] text-[10px] text-[#7b879d]">Progress</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    ) : (
    <div
      data-testid="course-figma-page"
      data-course-view="catalog"
      className="overflow-hidden rounded-[30px] border border-white/70 bg-[linear-gradient(180deg,#f9fbff_0%,#eef3ff_100%)] shadow-[0_30px_90px_rgba(33,51,97,0.13)]"
    >
      <header className="flex flex-col gap-[18px] border-b border-[#dde5f5] bg-[linear-gradient(180deg,#ffffff_0%,#f7faff_100%)] px-[24px] py-[20px] lg:flex-row lg:items-center lg:justify-between">
        <h1 className="text-[24px] font-semibold leading-none tracking-[-0.03em] text-[#1c2844]">All Courses</h1>
        <HeaderTools
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          placeholder="Search courses..."
          userName={userName}
          notificationCount={notificationCount}
          testId="course-catalog-search"
        />
      </header>

      <div className="flex flex-col gap-[16px] border-b border-[#dde5f5] bg-[linear-gradient(180deg,#f2f6ff_0%,#eef3ff_100%)] px-[24px] py-[18px] xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap gap-[10px]">
          <label className="relative">
            <select
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
              className="h-[42px] min-w-[170px] appearance-none rounded-[12px] border border-[#d7dfef] bg-white px-[16px] pr-[38px] text-[15px] text-[#27385c] shadow-[0_8px_18px_rgba(64,89,142,0.05)] outline-none"
            >
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category === 'all' ? 'Category' : category}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-[12px] top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-[#5f7297]" />
          </label>

          <label className="relative">
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
              className="h-[42px] min-w-[170px] appearance-none rounded-[12px] border border-[#d7dfef] bg-white px-[16px] pr-[38px] text-[15px] text-[#27385c] shadow-[0_8px_18px_rgba(64,89,142,0.05)] outline-none"
            >
              <option value="all">Status</option>
              <option value="unlocked">Unlocked</option>
              <option value="progress">In Progress</option>
              <option value="completed">Completed</option>
              <option value="not-started">Not Started</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-[12px] top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-[#5f7297]" />
          </label>

          <button
            type="button"
            onClick={() => {
              setCategoryFilter('all');
              setStatusFilter('all');
              setSortBy('latest');
              setSearchQuery('');
            }}
            className="flex h-[42px] items-center gap-[8px] rounded-[12px] border border-[#d7dfef] bg-white px-[16px] text-[15px] text-[#516786] shadow-[0_8px_18px_rgba(64,89,142,0.05)]"
          >
            <Sparkles className="h-[15px] w-[15px]" />
            Reset Filter
          </button>
        </div>

        <label className="relative">
          <select
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as typeof sortBy)}
            className="h-[42px] min-w-[190px] appearance-none rounded-[12px] border border-[#d7dfef] bg-white px-[16px] pr-[38px] text-[15px] text-[#27385c] shadow-[0_8px_18px_rgba(64,89,142,0.05)] outline-none"
          >
            <option value="latest">Latest</option>
            <option value="progress">Progress</option>
            <option value="title">Title</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-[12px] top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-[#5f7297]" />
        </label>
      </div>

      <div className="bg-[radial-gradient(circle_at_12%_12%,rgba(255,255,255,0.88),transparent_22%),linear-gradient(180deg,#eaf1ff_0%,#e7efff_100%)] px-[24px] py-[22px]">
        {filteredCourses.length === 0 ? (
          <div className="rounded-[24px] border border-dashed border-[#d8e1f1] bg-white/90 px-[24px] py-[32px] text-center text-[15px] text-[#607089]">
            No courses match the current search and filters.
          </div>
        ) : (
          <div className="grid gap-[18px] xl:grid-cols-3">
            {filteredCourses.map((course, index) => (
              <CatalogCourseCard
                key={course._id}
                course={course}
                tone={getCatalogTone(course, index)}
                snapshot={courseSnapshots[course._id] || { totalLessons: 0, completedLessons: 0, progressPercent: 0 }}
                onOpen={() => openCourse(course._id, 'course')}
              />
            ))}
          </div>
        )}
      </div>
    </div>
    )
  );

  const renderLessonsTab = () => (
    <div className="space-y-[14px]">
      <div data-testid="course-figma-lessons" className="overflow-hidden rounded-[18px] border border-[#dbe4f3] bg-white shadow-[0_12px_24px_rgba(54,78,123,0.06)]">
        {filteredCourseSections.length === 0 ? (
          <div className="px-[20px] py-[26px] text-[15px] text-[#607089]">No lessons match the current search.</div>
        ) : (
          filteredCourseSections.map((section, index) => {
            const expanded = currentExpandedSections.includes(section.id);
            return (
              <div
                key={section.id}
                data-testid={index === 0 ? 'course-figma-chapter-1' : undefined}
                className={cn(index > 0 && 'border-t border-[#e4ebf8]')}
              >
                <button
                  type="button"
                  data-testid={`course-figma-chapter-${index + 1}-toggle`}
                  aria-expanded={expanded}
                  onClick={() => toggleSection(section.id)}
                  className="flex h-[62px] w-full items-center justify-between px-[20px] text-left"
                >
                  <div className="flex items-center gap-[12px]">
                    <p className="text-[16px] font-semibold text-[#1b2d50]">{section.label}</p>
                    <p className="text-[16px] text-[#44597f]">{section.title}</p>
                  </div>
                  <ChevronDown className={cn('h-[18px] w-[18px] text-[#7c8eae] transition', expanded ? 'rotate-180' : '')} />
                </button>

                {expanded && (
                  <div
                    data-testid={`course-figma-chapter-${index + 1}-panel`}
                    className={cn(index === 0 ? 'border-l-[4px] border-l-[#4a8ef5]' : 'border-l-[4px] border-l-transparent')}
                  >
                    {section.lessons.map((entry) => {
                      const completed = Boolean(selectedCourseProgressMap.get(entry.lesson.id)?.completed);
                      const unlocked = Boolean(unlockMap.get(entry.lesson.id)?.unlocked);
                      return (
                        <LessonRow
                          key={entry.lesson.id}
                          entry={entry}
                          active={selectedLessonEntry?.lesson.id === entry.lesson.id}
                          completed={completed}
                          unlocked={unlocked}
                          onOpen={() => openLesson(entry.lesson.id)}
                          showButton
                          testId={`course-lesson-open-${entry.lesson.id}`}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <div
        data-testid="course-figma-cbt-card"
        className={cn(
          'rounded-[18px] border border-[#dbe4f3] bg-white shadow-[0_12px_24px_rgba(54,78,123,0.05)]',
          isMobileLayout ? 'px-[16px] py-[16px]' : 'px-[20px] py-[18px]',
        )}
      >
        <div className="flex items-start gap-[12px]">
          <div className="flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-[12px] bg-[linear-gradient(180deg,#d9e7fb_0%,#bad2f3_100%)] text-[#3e7fea]">
            <ClipboardCheck className="h-[20px] w-[20px]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className={cn(isMobileLayout ? 'text-[17px]' : 'text-[16px]', 'font-semibold leading-[1.1] text-[#1b2d50]')}>Lesson flow</p>
            <p className={cn(isMobileLayout ? 'text-[14px]' : 'text-[15px]', 'mt-[4px] leading-[1.5] text-[#5d6f8e]')}>
              Finish the lesson video, take the one-time CBT, then unlock the explanation video to complete this lesson flow.
            </p>
          </div>
        </div>

        <div className="mt-[14px] flex flex-wrap gap-[8px]">
          <span className="inline-flex items-center gap-[7px] rounded-full bg-[#eef4ff] px-[12px] py-[7px] text-[12px] font-medium text-[#46658f]">
            <Play className="ml-[1px] h-[12px] w-[12px] fill-current text-[#4a8ef5]" />
            Lesson video
          </span>
          <span className="inline-flex items-center gap-[7px] rounded-full bg-[#eef4ff] px-[12px] py-[7px] text-[12px] font-medium text-[#46658f]">
            <ClipboardCheck className="h-[12px] w-[12px] text-[#4a8ef5]" />
            One CBT attempt
          </span>
          <span className="inline-flex items-center gap-[7px] rounded-full bg-[#eef4ff] px-[12px] py-[7px] text-[12px] font-medium text-[#46658f]">
            <Video className="h-[12px] w-[12px] text-[#4a8ef5]" />
            Explanation once
          </span>
        </div>
      </div>
    </div>
  );

  const renderCourseView = () => (
    isMobileLayout ? (
      <div
        data-testid="course-figma-page"
        data-course-view="course"
        className="min-h-[100dvh] bg-[#f4f7ff] pb-[82px]"
        style={uiFontStyle}
      >
        <div className="px-[11px] pb-[8px] pt-[9px]">
          <div className="flex items-center justify-between text-[12px] font-semibold text-[#101828]">
            <span>9:41</span>
            <div className="flex items-center gap-[5px]">
              <span className="h-[7px] w-[5px] rounded-[2px] bg-[#101828]" />
              <span className="h-[9px] w-[5px] rounded-[2px] bg-[#101828]" />
              <span className="h-[11px] w-[5px] rounded-[2px] bg-[#101828]" />
              <span className="ml-[4px] h-[10px] w-[20px] rounded-full border border-[#101828]" />
            </div>
          </div>

          <header className="mt-[10px]">
            <div className="flex items-center justify-between gap-[12px]">
              <button
                type="button"
                data-testid="course-back-to-catalog"
                onClick={() => {
                  setScreen('catalog');
                  setSearchQuery('');
                }}
                className="flex h-[32px] w-[32px] items-center justify-center text-[#1f2d4e]"
              >
                <ChevronLeft className="h-[22px] w-[22px]" />
              </button>

              <h1 className="text-center text-[14px] font-semibold leading-[1.15] tracking-[-0.02em] text-[#1f2d4e]">
                {getMobileCourseTitle(selectedCourse)}
              </h1>

              <button
                type="button"
                className="flex h-[32px] w-[32px] items-center justify-center text-[#1f2d4e]"
              >
                <Search className="h-[19px] w-[19px]" />
              </button>
            </div>

            <div data-testid="course-figma-tabs" className="mt-[8px] grid grid-cols-3 border-b border-[#dde5f5] text-center">
              {(['Content', 'Syllabus', 'Resources'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setMobileCourseTab(tab)}
                  className={cn(
                    'relative py-[9px] text-[11.5px] font-medium text-[#5b6f98]',
                    mobileCourseTab === tab && 'font-semibold text-[#1b49d6]',
                  )}
                >
                  {tab}
                  {mobileCourseTab === tab && <span className="absolute bottom-0 left-[18px] right-[18px] h-[3px] rounded-full bg-[#2d6ee5]" />}
                </button>
              ))}
            </div>
          </header>

          <section
            data-testid="course-figma-hero"
            className="mt-[10px] rounded-[18px] border border-[#dbe4f3] bg-white px-[10px] py-[9px] shadow-[0_12px_24px_rgba(54,78,123,0.06)]"
          >
            <div className="grid grid-cols-[52px_repeat(3,minmax(0,1fr))_96px] items-center gap-[1px]">
              <div className="shrink-0">
                <ProgressDonut
                  percent={selectedCourseSnapshot.progressPercent}
                  title="Completed"
                  size={52}
                  testId="course-progress-percent"
                />
              </div>
              <div className="min-w-0 text-center">
                <p className="text-[14px] font-semibold leading-none text-[#1f2d4e]">{selectedCourseSnapshot.totalLessons}</p>
                <p className="mt-[2px] text-[8px] leading-none text-[#7b879d]">Lessons</p>
              </div>
              <div className="min-w-0 text-center">
                <p data-testid="course-progress-lessons-completed" className="text-[14px] font-semibold leading-none text-[#1f2d4e]">{selectedCourseVideoCompletedDisplayCount}</p>
                <p className="mt-[2px] text-[8px] leading-none text-[#7b879d]">Done</p>
              </div>
              <div className="min-w-0 text-center">
                <p className="text-[14px] font-semibold leading-none text-[#1f2d4e]">{Math.max(selectedCourseEntries.length - selectedCourseVideoCompletedDisplayCount, 0)}</p>
                <p className="mt-[2px] text-[8px] leading-none text-[#7b879d]">Left</p>
              </div>
              <button
                type="button"
                onClick={() => selectedLessonEntry && openLesson(selectedLessonEntry.lesson.id)}
                className="inline-flex h-[30px] w-full items-center justify-center rounded-[10px] bg-[#2f6fe4] px-[7px] text-[9.5px] font-semibold whitespace-nowrap text-white shadow-[0_12px_24px_rgba(45,110,229,0.2)]"
              >
                Continue Course
              </button>
            </div>
          </section>

          <div className="mt-[7px] flex items-center gap-[5px] overflow-x-auto px-[2px] pb-[2px] text-[9px] whitespace-nowrap text-[#516786] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <span className="font-semibold text-[#1f2d4e]">Lesson Flow:</span>
            <span className="inline-flex items-center gap-[4px]"><Play className="h-[10px] w-[10px] fill-current text-[#2d6ee5]" /> Watch Video</span>
            <span className="text-[#9aabbe]">→</span>
            <span className="inline-flex items-center gap-[4px]"><ClipboardCheck className="h-[10px] w-[10px] text-[#2d6ee5]" /> Take CBT (1 Attempt)</span>
            <span className="text-[#9aabbe]">→</span>
            <span className="inline-flex items-center gap-[4px]"><Video className="h-[10px] w-[10px] text-[#2d6ee5]" /> View Explanation</span>
          </div>

          {mobileCourseTab === 'Content' && (
            <div data-testid="course-figma-lessons" className="mt-[8px] space-y-[7px]">
              {filteredCourseSections.map((section, index) => {
                const expanded = currentExpandedSections.includes(section.id);
                const completedCount = section.lessons.filter((entry) => Boolean(selectedCourseProgressMap.get(entry.lesson.id)?.completed)).length;

                return (
                  <section
                    key={section.id}
                    data-testid={index === 0 ? 'course-figma-chapter-1' : undefined}
                    className="overflow-hidden rounded-[16px] border border-[#dbe4f3] bg-white shadow-[0_12px_24px_rgba(54,78,123,0.05)]"
                  >
                    <button
                      type="button"
                      data-testid={`course-figma-chapter-${index + 1}-toggle`}
                      onClick={() => toggleSection(section.id)}
                      className="flex w-full items-center justify-between gap-[10px] px-[11px] py-[10px] text-left"
                    >
                      <div className="min-w-0 flex items-center gap-[8px]">
                        <p className="text-[12.5px] font-semibold text-[#1f2d4e]">{section.label}</p>
                        <p className="truncate text-[11.5px] text-[#516786]">{section.title}</p>
                        </div>
                      <div className="flex shrink-0 items-center gap-[5px] text-[9px] text-[#5f7297]">
                        <span>{completedCount}/{section.lessons.length} Lessons</span>
                        <ChevronDown className={cn('h-[14px] w-[14px] transition', expanded ? 'rotate-180' : '')} />
                      </div>
                    </button>

                    {expanded && (
                      <div className="border-t border-[#edf2f8] px-[7px] py-[1px]">
                        {section.lessons.map((entry) => {
                          const progress = selectedCourseProgressMap.get(entry.lesson.id);
                          const unlocked = Boolean(unlockMap.get(entry.lesson.id)?.unlocked);
                          const lessonDone = hasLessonVideoMilestone(progress);
                          const examDone = Boolean(progress?.examSubmitted);
                          const explanationDone = Boolean(progress?.completed || getExplanationWatchCount(progress) >= MAX_EXPLANATION_WATCHES);
                          const rows = [
                            {
                              key: `${entry.lesson.id}-lesson`,
                              icon: <Play className="ml-[1px] h-[16px] w-[16px] fill-current" />,
                              iconClass: 'text-[#2d6ee5]',
                              title: entry.lesson.title,
                              subtitle: formatDurationLabel(entry.lesson.durationMinutes),
                              status: explanationDone || lessonDone ? 'Completed' : unlocked ? 'Ready' : 'Locked',
                              onClick: unlocked ? () => openLesson(entry.lesson.id) : undefined,
                            },
                            {
                              key: `${entry.lesson.id}-cbt`,
                              icon: <ClipboardCheck className="h-[16px] w-[16px]" />,
                              iconClass: 'text-[#5b6f98]',
                              title: `CBT - ${section.label} (One Attempt)`,
                              subtitle: '10 Questions',
                              status: examDone ? 'Completed' : lessonDone ? 'Ready' : 'Locked',
                              onClick: undefined,
                            },
                            {
                              key: `${entry.lesson.id}-explanation`,
                              icon: <Video className="h-[16px] w-[16px]" />,
                              iconClass: 'text-[#5b6f98]',
                              title: 'Explanation Video',
                              subtitle: '18 mins',
                              status: explanationDone ? 'Completed' : examDone ? 'Ready' : 'Locked',
                              onClick: undefined,
                            },
                          ] as const;

                          return rows.map((row, rowIndex) => (
                            <div key={row.key} className={cn('flex gap-[8px] px-[1px] py-[5px]', !(entry === section.lessons[section.lessons.length - 1] && rowIndex === rows.length - 1) && 'border-b border-[#eef2f8]')}>
                              <div className="flex w-[12px] flex-col items-center pt-[3px]">
                                <span
                                  className={cn(
                                    'h-[8px] w-[8px] rounded-full',
                                    row.status === 'Completed'
                                      ? 'bg-[#25ba74]'
                                      : row.status === 'Ready'
                                        ? 'bg-[#2d6ee5]'
                                        : 'bg-[#d2dceb]',
                                  )}
                                />
                              </div>

                              <button
                                type="button"
                                data-testid={row.onClick ? `course-lesson-open-${entry.lesson.id}` : undefined}
                                disabled={!row.onClick}
                                onClick={row.onClick}
                                className={cn(
                                  'flex min-w-0 flex-1 items-center gap-[8px] rounded-[14px] px-[2px] py-[2px] text-left',
                                  row.onClick ? 'cursor-pointer' : 'cursor-default',
                                )}
                              >
                                <div className={cn('flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-full border border-[#dbe4f3] bg-[#f5f8fe]', row.iconClass)}>
                                  {row.icon}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-[11px] font-medium leading-[1.12] text-[#1f2d4e]">{row.title}</p>
                                  <p className="mt-[1px] text-[9px] text-[#7b879d]">{row.subtitle}</p>
                                </div>
                                <span
                                  className={cn(
                                    'inline-flex h-[20px] shrink-0 items-center rounded-full px-[6px] text-[8px] font-semibold',
                                    row.status === 'Completed'
                                      ? 'bg-[#e9f8ee] text-[#28a45e]'
                                      : row.status === 'Ready'
                                        ? 'bg-[#eef4ff] text-[#2d6ee5]'
                                        : 'bg-[#f1f4f9] text-[#8a9bb6]',
                                  )}
                                >
                                  {row.status}
                                </span>
                              </button>
                            </div>
                          ));
                        })}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )}

          {mobileCourseTab === 'Syllabus' && (
            <div className="mt-[16px] space-y-[12px]">
              {selectedCourseSections.map((section) => (
                <section key={section.id} className="rounded-[18px] border border-[#dbe4f3] bg-white px-[16px] py-[16px] shadow-[0_12px_24px_rgba(54,78,123,0.05)]">
                  <div className="flex items-center justify-between gap-[10px]">
                    <p className="text-[16px] font-semibold text-[#1f2d4e]">{section.label} {section.title}</p>
                    <span className="text-[13px] text-[#6f84ab]">{section.lessons.length} lessons</span>
                  </div>
                  <div className="mt-[10px] space-y-[8px]">
                    {section.lessons.map((entry) => (
                      <p key={entry.lesson.id} className="text-[14px] text-[#516786]">{entry.lesson.title}</p>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}

          {mobileCourseTab === 'Resources' && (
            <div className="mt-[16px] space-y-[12px]">
              <section className="rounded-[18px] border border-[#dbe4f3] bg-white px-[16px] py-[16px] shadow-[0_12px_24px_rgba(54,78,123,0.05)]">
                <p className="text-[16px] font-semibold text-[#1f2d4e]">Resources</p>
                <p className="mt-[8px] text-[14px] leading-[1.6] text-[#5d6f8e]">
                  Open any lesson in this course whenever you want. Resources stay aligned to the lesson you are viewing.
                </p>
              </section>
            </div>
          )}

          <section className="mt-[6px] rounded-[14px] border border-[#dbe4f3] bg-[#eef4ff] px-[10px] py-[8px] text-[10px] text-[#4b658f]">
            <div className="flex items-center gap-[8px]">
              <div className="flex h-[16px] w-[16px] items-center justify-center rounded-full border border-[#2d6ee5] text-[10px] text-[#2d6ee5]">i</div>
              <p>You can open any lesson directly from the course list.</p>
            </div>
          </section>
        </div>
      </div>
    ) : (
    <div
      data-testid="course-figma-page"
      data-course-view="course"
      className="overflow-hidden rounded-[26px] border border-white/70 bg-[linear-gradient(180deg,#f9fbff_0%,#eef3ff_100%)] shadow-[0_30px_90px_rgba(33,51,97,0.13)] xl:rounded-[30px]"
    >
      <header className="flex flex-col gap-[14px] border-b border-[#dde5f5] bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] px-[16px] py-[16px] xl:flex-row xl:items-center xl:justify-between xl:px-[24px] xl:py-[20px]">
        <button
          type="button"
          data-testid="course-back-to-catalog"
          onClick={() => {
            setScreen('catalog');
            setSearchQuery('');
          }}
          className="flex items-center gap-[10px] text-left text-[14px] text-[#5e7397] xl:text-[15px]"
        >
          <ChevronLeft className="h-[18px] w-[18px]" />
          <span>{['Courses', selectedCourse?.title].filter(Boolean).join(' / ')}</span>
        </button>
        <HeaderTools
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          placeholder="Search lessons..."
          userName={userName}
          notificationCount={notificationCount}
        />
      </header>

      <div className="grid gap-[14px] px-[14px] py-[14px] xl:grid-cols-[minmax(0,1fr)_300px] xl:gap-[18px] xl:px-[24px] xl:py-[20px]">
        <div className="min-w-0">
          <section className="overflow-hidden rounded-[20px] border border-[#dbe4f3] bg-white shadow-[0_16px_34px_rgba(54,78,123,0.08)] xl:rounded-[24px]">
            <div data-testid="course-figma-hero" className="relative h-[160px] overflow-hidden xl:h-[220px]">
              <img alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover" src={buildCourseHeroArt()} />
              <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.18)_0%,rgba(255,255,255,0.06)_55%,rgba(255,255,255,0)_100%)]" />
              <div className="relative h-full px-[18px] pt-[18px] text-[#16264a] xl:px-[30px] xl:pt-[32px]">
                <h2 className="max-w-[280px] text-[24px] font-semibold leading-[1.08] tracking-[-0.03em] xl:max-w-[560px] xl:text-[32px] xl:leading-[1.12]">
                  {selectedCourse?.title}
                </h2>
                <div className="mt-[10px] flex items-center gap-[10px] text-[14px] text-[#24355a] xl:mt-[14px] xl:gap-[14px] xl:text-[16px]">
                  <span>{selectedCourseSnapshot.progressPercent}% Complete</span>
                  <div className="h-[8px] w-[138px] overflow-hidden rounded-full bg-[#cfdcf2] xl:h-[10px] xl:w-[180px]">
                    <div className={cn('h-full rounded-full', selectedToneStyles.progress)} style={{ width: `${selectedCourseSnapshot.progressPercent}%` }} />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => selectedLessonEntry && openLesson(selectedLessonEntry.lesson.id)}
                  className="mt-[16px] inline-flex h-[38px] items-center gap-[8px] rounded-[11px] bg-[linear-gradient(180deg,#4487f4_0%,#2d6ee5_100%)] px-[16px] text-[13px] font-semibold text-white shadow-[0_14px_28px_rgba(45,110,229,0.24)] xl:mt-[28px] xl:h-[46px] xl:gap-[10px] xl:rounded-[12px] xl:px-[22px] xl:text-[15px]"
                >
                  {selectedCourseSnapshot.progressPercent > 0 ? 'Continue Course' : 'Start Course'}
                  <ChevronRight className="h-[16px] w-[16px]" />
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-[10px] border-b border-[#e0e8f6] bg-white px-[14px] py-[14px] xl:flex-row xl:items-end xl:justify-between xl:px-[20px] xl:py-[18px]">
              <div data-testid="course-figma-tabs" className="flex gap-[20px] overflow-x-auto xl:gap-[26px]">
                {courseTabs.map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActiveCourseTab(tab)}
                    className={cn(
                      'relative pb-[8px] text-[15px] text-[#4c6086] xl:pb-[10px] xl:text-[16px]',
                      activeCourseTab === tab ? 'font-semibold text-[#16264a]' : 'font-medium',
                    )}
                  >
                    {tab}
                    {activeCourseTab === tab && <span className="absolute bottom-0 left-0 right-0 h-[3px] rounded-full bg-[#3c83ef]" />}
                  </button>
                ))}
              </div>

              <div className="inline-flex h-[36px] items-center gap-[7px] rounded-[10px] border border-[#dbe4f3] bg-[#f7faff] px-[12px] text-[13px] text-[#5e7397] xl:h-[40px] xl:gap-[8px] xl:px-[14px] xl:text-[15px]">
                <ClipboardCheck className="h-[15px] w-[15px]" />
                {selectedCourseExamAttempts}/{selectedCourseEntries.length} CBT attempts
              </div>
            </div>

            <div className="bg-[linear-gradient(180deg,#f6f9ff_0%,#eef4ff_100%)] px-[12px] py-[12px] xl:px-[14px] xl:py-[14px]">
              {activeCourseTab === 'Lessons' && renderLessonsTab()}
            </div>
          </section>
        </div>

        <aside data-testid="course-figma-sidebar" className="space-y-[12px]">
          <section data-testid="course-figma-stats" className="rounded-[18px] bg-white px-[16px] pb-[14px] pt-[14px] shadow-[0_16px_34px_rgba(54,78,123,0.08)] xl:rounded-[22px] xl:px-[18px] xl:pb-[14px] xl:pt-[16px]">
            <p className="text-[16px] font-medium text-[#1c2d4c] xl:text-[17px]">Course Statistics</p>
            <div className="mt-[14px] flex justify-center">
              <ProgressDonut percent={selectedCourseSnapshot.progressPercent} title="Completed" size={isMobileLayout ? 100 : 118} testId="course-progress-percent" />
            </div>
            <div className="mt-[14px] grid grid-cols-2 gap-y-[8px] px-[2px] text-[13px] text-[#5d7092] xl:px-[6px] xl:text-[14px]">
              <span data-testid="course-progress-lessons-completed">{selectedCourseVideoCompletedDisplayCount} Lessons</span>
              <span>{selectedCourseExamAttempts} CBT Done</span>
              <span>{Math.max(selectedCourseEntries.length - selectedCourseExamAttempts, 0)} CBT Left</span>
              <span className="text-[#7a90b7]">{selectedCourseSnapshot.totalLessons} Total</span>
            </div>
          </section>

          <section data-testid="course-figma-note" className="rounded-[18px] bg-[#fbf3e5] px-[16px] py-[14px] shadow-[0_16px_34px_rgba(54,78,123,0.06)] xl:rounded-[22px] xl:px-[18px]">
            <div className="flex items-center gap-[8px] text-[14px] text-[#bf8646] xl:text-[15px]">
              <BookOpen className="h-[14px] w-[14px]" />
              <span>Pinned Note</span>
            </div>
            <h3 className="mt-[10px] text-[15px] font-medium leading-[1.24] text-[#202833] xl:text-[16px]">
              Basic concepts build the foundation
            </h3>
            <p className="mt-[8px] text-[13px] leading-[1.5] text-[#747980] xl:text-[14px] xl:leading-[1.42]">
              Use this course page to expand chapters, choose the next topic, and carry progress cleanly into the player without losing context.
            </p>
          </section>

          <section data-testid="course-figma-topics" className="rounded-[18px] bg-white px-[16px] py-[14px] shadow-[0_16px_34px_rgba(54,78,123,0.08)] xl:rounded-[22px] xl:px-[18px]">
            <p className="text-[15px] font-medium text-[#1c2d4c] xl:text-[16px]">Recommended Topics</p>
            <div className="mt-[12px] space-y-[10px]">
              {recommendedTopics.slice(0, 3).map((topic) => (
                <button
                  key={topic}
                  type="button"
                  onClick={() => selectedLessonEntry && openLesson(selectedLessonEntry.lesson.id)}
                  className="flex w-full items-center gap-[10px] text-left"
                >
                  <div className="flex h-[24px] w-[24px] items-center justify-center rounded-[7px] bg-[#dfeafb] text-[#4b86ea]">
                    <BookOpen className="h-[12px] w-[12px]" />
                  </div>
                  <p className="text-[14px] leading-[1.24] text-[#34486f] xl:text-[15px] xl:leading-[1.18]">{topic}</p>
                </button>
              ))}
            </div>
          </section>

          {!isMobileLayout && (
            <section data-testid="course-figma-recommended" className="overflow-hidden rounded-[22px] bg-white shadow-[0_16px_34px_rgba(54,78,123,0.08)]">
            <div className="flex h-[40px] items-center justify-between border-b border-[#edf2fb] px-[18px]">
              <div className="flex items-center gap-[8px] text-[15px] text-[#1c2d4c]">
                <span className="h-[14px] w-[14px] rounded-[4px] bg-[#62c2a4]" />
                <span>Recommended</span>
              </div>
              <div className="flex items-center gap-[6px]">
                <span className="h-[8px] w-[8px] rounded-full bg-[#d8e0f2]" />
                <span className="h-[8px] w-[8px] rounded-full bg-[#3d83ef]" />
                <span className="h-[8px] w-[8px] rounded-full bg-[#d8e0f2]" />
              </div>
            </div>
            <div className="px-[18px] py-[12px]">
              <p className="text-[15px] leading-[1.28] text-[#273852]">
                {selectedLessonCopy.quiz.prompt}
              </p>
              <div className="mt-[10px] flex items-center justify-between text-[13px] text-[#677b9e]">
                <div className="flex items-center gap-[6px]">
                  <Clock3 className="h-[13px] w-[13px]" />
                  <span>{Math.max(Math.round(selectedLessonVideoDurationSeconds / 60), 1)} mins + CBT</span>
                </div>
                <button
                  type="button"
                  onClick={startLessonExam}
                  disabled={!isLessonReadyForExam}
                  className={cn(
                    'rounded-full px-[12px] py-[4px] text-[12px]',
                    isLessonReadyForExam
                      ? 'bg-[#e2ebfb] text-[#7086ab]'
                      : 'cursor-not-allowed bg-[#eef3fb] text-[#9caac1]',
                  )}
                >
                  Open CBT
                </button>
              </div>
            </div>
          </section>
          )}
        </aside>
      </div>
    </div>
    )
  );

  const renderDesktopFlowCompletePanel = () => (
    <div className="space-y-[18px]">
      <section className="rounded-[18px] border border-[#dbe4f3] bg-white px-[18px] py-[18px] shadow-[0_12px_24px_rgba(54,78,123,0.05)]">
        <div className="flex flex-col items-center text-center">
          <div className="flex h-[58px] w-[58px] items-center justify-center rounded-full bg-[#18ad73] text-white shadow-[0_10px_20px_rgba(24,173,115,0.22)]">
            <CheckCircle2 className="h-[32px] w-[32px]" />
          </div>
          <p className="mt-[14px] text-[20px] font-semibold text-[#17233f]">Lesson Flow Completed</p>
          <p className="mt-[8px] max-w-[480px] text-[14px] leading-[1.48] text-[#5d7092]">
            Video, chapter CBT, and explanation are all completed for {selectedLessonEntry?.lesson.title}.
          </p>
        </div>

        <div className="mt-[18px] grid gap-[14px] lg:grid-cols-2">
          <div className="rounded-[16px] border border-[#e3ebf6] bg-[#fbfdff] px-[16px] py-[16px]">
            <p className="text-[14px] font-semibold text-[#17305c]">Lesson Replay</p>
            <p className="mt-[6px] text-[13px] leading-[1.45] text-[#5d7092]">
              {hasReachedLessonVideoWatchLimit
                ? 'Maximum lesson video rewatch limit reached.'
                : `${selectedLessonVideoWatchCount}/${MAX_VIDEO_WATCHES} watches used. One more replay is still available.`}
            </p>
            {canRewatchLessonVideo ? (
              <button
                type="button"
                data-testid="course-player-rewatch-video"
                onClick={startLessonVideoReplay}
                className="mt-[14px] inline-flex h-[40px] w-full items-center justify-center rounded-[10px] border border-[#d7e3f5] bg-white text-[14px] font-semibold text-[#2d6ee5]"
              >
                Rewatch Lesson
              </button>
            ) : (
              <div data-testid="course-player-rewatch-limit" className="mt-[14px] inline-flex h-[34px] items-center rounded-full bg-[#eef3fb] px-[12px] text-[12px] font-medium text-[#7287a8]">
                Maximum limit reached
              </div>
            )}
          </div>

          <div className="rounded-[16px] border border-[#e3ebf6] bg-[#fbfdff] px-[16px] py-[16px]">
            <p className="text-[14px] font-semibold text-[#17305c]">Explanation Status</p>
            <p className="mt-[6px] text-[13px] leading-[1.45] text-[#5d7092]">
              {hasReachedExplanationWatchLimit
                ? 'Explanation video watched once. Rewatch is no longer available.'
                : 'Explanation video is ready to watch once after the CBT.'}
            </p>
            <div className="mt-[14px] inline-flex h-[34px] items-center rounded-full bg-[#eef4ff] px-[12px] text-[12px] font-medium text-[#4b658f]">
              {hasReachedExplanationWatchLimit ? 'Maximum limit reached' : 'One-time watch'}
            </div>
          </div>
        </div>

        <div className="mt-[14px] rounded-[16px] border border-[#e3ebf6] bg-white px-[16px] py-[16px]">
          <div className="flex items-start gap-[10px]">
            <div className="mt-[2px] flex h-[30px] w-[30px] items-center justify-center rounded-[10px] bg-[#edf4ff] text-[#2d6ee5]">
              <Sparkles className="h-[14px] w-[14px]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold text-[#17305c]">What&apos;s Next?</p>
              <p className="mt-[4px] text-[14px] leading-[1.42] text-[#5d7092]">
                {nextLessonEntry
                  ? `Move to ${nextLessonEntry.lesson.title} and continue the same lesson → CBT → explanation sequence.`
                  : 'You have completed this lesson flow. Return to the course page and open any lesson you want.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            data-testid="course-player-continue-next-lesson"
            onClick={() => {
              if (nextLessonEntry) {
                openNextLesson();
                return;
              }
              setScreen('course');
            }}
            className="mt-[16px] inline-flex h-[42px] w-full items-center justify-center rounded-[10px] bg-[linear-gradient(180deg,#2f6ef0_0%,#2660e3_100%)] text-[14px] font-semibold text-white shadow-[0_12px_24px_rgba(45,110,229,0.2)]"
          >
            {nextLessonEntry ? 'Open Next Lesson' : 'Back to Lessons'}
          </button>
        </div>
      </section>
    </div>
  );

  const renderDesktopCompletionPanel = () => (
    <div className="space-y-[18px]">
      <section className="rounded-[18px] border border-[#dbe4f3] bg-white px-[18px] py-[18px] shadow-[0_12px_24px_rgba(54,78,123,0.05)]">
        <div className="flex flex-col items-center text-center">
          <div className="flex h-[58px] w-[58px] items-center justify-center rounded-full bg-[#18ad73] text-white shadow-[0_10px_20px_rgba(24,173,115,0.22)]">
            <CheckCircle2 className="h-[32px] w-[32px]" />
          </div>
          <p className="mt-[14px] text-[20px] font-semibold text-[#17233f]">Lesson Completed!</p>
          <p className="mt-[8px] max-w-[420px] text-[14px] leading-[1.48] text-[#5d7092]">
            Great job! You&apos;ve completed {selectedLessonEntry?.lesson.title}.
          </p>
        </div>

        <div className="mt-[18px] rounded-[16px] border border-[#e3ebf6] bg-[#fbfdff] px-[16px] py-[16px]">
          <div className="flex items-start gap-[10px]">
            <div className="mt-[2px] flex h-[30px] w-[30px] items-center justify-center rounded-[10px] bg-[#edf4ff] text-[#2d6ee5]">
              <Sparkles className="h-[14px] w-[14px]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold text-[#17305c]">What&apos;s Next?</p>
              <p className="mt-[4px] text-[14px] leading-[1.42] text-[#5d7092]">
                Take a CBT (Chapter Based Test) to test your understanding.
              </p>
            </div>
          </div>
          <button
            type="button"
            data-testid="course-player-start-cbt"
            onClick={startLessonExam}
            className="mt-[16px] inline-flex h-[42px] w-full items-center justify-center rounded-[10px] bg-[linear-gradient(180deg,#2f6ef0_0%,#2660e3_100%)] text-[14px] font-semibold text-white shadow-[0_12px_24px_rgba(45,110,229,0.2)]"
          >
            Start CBT Exam
          </button>
          <div className="mt-[10px] flex items-center justify-center gap-[6px] text-[13px] text-[#6f84ab]">
            <span>One Attempt Only</span>
            <Clock3 className="h-[12px] w-[12px]" />
          </div>

          <div className="mt-[14px] border-t border-[#e6edf8] pt-[14px]">
            <div className="flex items-start justify-between gap-[14px]">
              <div className="min-w-0">
                <p className="text-[14px] font-semibold text-[#17305c]">Lesson Replay</p>
                <p className="mt-[4px] text-[13px] leading-[1.45] text-[#5d7092]">
                  {hasReachedLessonVideoWatchLimit
                    ? 'Maximum lesson video rewatch limit reached.'
                    : `${selectedLessonVideoWatchCount}/${MAX_VIDEO_WATCHES} watches used. Rewatch is still available before the limit is reached.`}
                </p>
              </div>
              {canRewatchLessonVideo ? (
                <button
                  type="button"
                  data-testid="course-player-rewatch-video"
                  onClick={startLessonVideoReplay}
                  className="inline-flex h-[38px] shrink-0 items-center justify-center rounded-[10px] border border-[#d7e3f5] bg-white px-[14px] text-[13px] font-semibold text-[#2d6ee5]"
                >
                  Rewatch Lesson
                </button>
              ) : (
                <span data-testid="course-player-rewatch-limit" className="inline-flex h-[32px] shrink-0 items-center rounded-full bg-[#eef3fb] px-[12px] text-[12px] font-medium text-[#7287a8]">
                  Limit reached
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="mt-[14px] rounded-[16px] border border-[#e3ebf6] bg-white px-[16px] py-[16px]">
          <div className="flex items-center justify-between">
            <p className="text-[15px] font-semibold text-[#17233f]">Lesson Progress</p>
            <span className="text-[14px] font-medium text-[#2d6ee5]">100%</span>
          </div>
          <p className="mt-[6px] text-[14px] text-[#5d7092]">
            {selectedCourseVideoCompletedCount} of {selectedCourseSnapshot.totalLessons} lessons completed
          </p>
          <div className="mt-[10px] h-[6px] overflow-hidden rounded-full bg-[#d8e4f7]">
            <div
              className="h-full rounded-full bg-[linear-gradient(90deg,#57a4ff_0%,#7ab8ff_100%)]"
              style={{ width: '100%' }}
            />
          </div>
        </div>
      </section>
    </div>
  );

  const renderVideoPanel = () => {
    if (!isVideoReplayMode && selectedLessonStoredProgress?.completed) {
      return renderDesktopFlowCompletePanel();
    }

    if (!isVideoReplayMode && hasLessonVideoMilestone(selectedLessonStoredProgress)) {
      return renderDesktopCompletionPanel();
    }

    return (
    <div className="space-y-[18px]">
      <section
        ref={playerViewportRef}
        data-testid="course-figma-player"
        className={cn(
          'relative overflow-hidden rounded-[18px] border border-[#dde7f5] bg-[#d8e8ff] shadow-[0_12px_28px_rgba(46,67,111,0.08)]',
          isFullscreen && 'rounded-none border-0',
        )}
      >
        <div className="absolute inset-0">
          <img alt="" aria-hidden="true" className={cn('h-full w-full object-cover', autoplayCountdown !== null && 'opacity-30 blur-[1px]')} src={buildLessonArtwork(selectedLessonCopy.artwork)} />
        </div>

        {autoplayCountdown !== null && nextLessonEntry ? (
          <div data-testid="course-player-overlay" className="relative flex min-h-[450px] flex-col items-center justify-center bg-[linear-gradient(180deg,rgba(42,54,84,0.12)_0%,rgba(42,54,84,0.72)_100%)] px-[24px] py-[30px] text-center text-white">
            <p className="text-[18px] font-semibold">Up Next</p>
            <div className="mt-[18px] flex h-[110px] w-[110px] items-center justify-center rounded-full bg-white/94 text-[#2d6ee5]">
              <BookOpen className="h-[48px] w-[48px]" />
            </div>
            <p className="mt-[18px] text-[20px] font-semibold">{nextLessonEntry.lesson.title}</p>
            <p className="mt-[8px] text-[14px] text-white/84">{formatDurationLabel(nextLessonEntry.lesson.durationMinutes)}</p>
            <p className="mt-[18px] text-[14px] text-white/88">Starting in {autoplayCountdown} second{autoplayCountdown === 1 ? '' : 's'}...</p>
            <button
              type="button"
              onClick={() => setAutoplayCountdown(null)}
              className="mt-[20px] inline-flex h-[44px] items-center gap-[8px] rounded-full border border-white/30 px-[18px] text-[14px] font-medium text-white"
            >
              <span className="text-[18px] leading-none">×</span>
              Cancel
            </button>
          </div>
        ) : (
          <div className="relative flex min-h-[450px] flex-col">
            <div className="grid gap-[18px] px-[26px] pt-[26px] lg:grid-cols-[360px_minmax(0,1fr)]">
              <div className="max-w-[360px]">
                <h2 className="text-[22px] font-semibold leading-[1.12] tracking-[-0.03em] text-[#16264a]">{selectedLessonCopy.heading}</h2>
                <p className="mt-[10px] text-[15px] leading-[1.48] text-[#34486f]">{selectedLessonCopy.summary}</p>
              </div>
            </div>

            {selectedLessonCopy.artwork === 'power' && (
              <div className="mt-auto px-[24px] pb-[82px]">
                <div className="flex flex-wrap gap-[16px]">
                  {selectedLessonCopy.featureLabels.map((label) => (
                    <div key={label} className="flex items-center gap-[10px] rounded-full bg-white/70 px-[14px] py-[12px] shadow-[0_8px_20px_rgba(76,106,157,0.08)] backdrop-blur">
                      <span className="flex h-[44px] w-[44px] items-center justify-center rounded-full border border-[#c9daf8] bg-[#eef5ff] text-[#5f84c8]">
                        <Sparkles className="h-[18px] w-[18px]" />
                      </span>
                      <span className="text-[14px] font-medium text-[#223356]">{label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!hasReachedLessonVideoWatchLimit || isVideoReplayMode ? (
              <button
                type="button"
                data-testid="course-player-video-play"
                onClick={() => setIsVideoPlaying((current) => !current)}
                className="absolute left-1/2 top-1/2 flex h-[68px] w-[68px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[#4a5f8d] text-white shadow-[0_18px_32px_rgba(42,57,92,0.22)]"
              >
                {isVideoPlaying ? <Pause className="h-[26px] w-[26px] fill-current" /> : <Play className="ml-[3px] h-[28px] w-[28px] fill-current" />}
              </button>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="rounded-full border border-white/30 bg-white/92 px-[16px] py-[10px] text-[12px] font-semibold text-[#17305c] shadow-[0_12px_28px_rgba(8,15,25,0.14)]">
                  Video limit reached
                </div>
              </div>
            )}

            <div className="mt-auto bg-[linear-gradient(180deg,rgba(30,48,82,0)_0%,rgba(30,48,82,0.18)_20%,rgba(33,48,77,0.92)_100%)] px-[20px] pb-[14px] pt-[24px] text-white">
              <div className="h-[5px] overflow-hidden rounded-full bg-white/26">
                <div className="h-full rounded-full bg-[#2f72e8]" style={{ width: `${Math.min((videoPlaybackSeconds / selectedLessonVideoDurationSeconds) * 100, 100)}%` }} />
              </div>
              <div className="mt-[12px] flex flex-wrap items-center justify-between gap-[14px] text-[15px]">
                <div className="flex items-center gap-[12px]">
                  {!hasReachedLessonVideoWatchLimit || isVideoReplayMode ? (
                    <button
                      type="button"
                      data-testid="course-player-toggle"
                      onClick={() => setIsVideoPlaying((current) => !current)}
                    >
                      {isVideoPlaying ? <Pause className="h-[22px] w-[22px] fill-current" /> : <Play className="h-[22px] w-[22px] fill-current" />}
                    </button>
                  ) : (
                    <span data-testid="course-player-rewatch-limit" className="inline-flex h-[30px] items-center rounded-full border border-white/20 bg-white/14 px-[12px] text-[11px] font-semibold text-white/92">
                      Video limit reached
                    </span>
                  )}
                  <span>{formatPlaybackTime(videoPlaybackSeconds)} / {formatPlaybackTime(selectedLessonVideoDurationSeconds)}</span>
                </div>

                <div className="flex items-center gap-[18px] text-[14px]">
                  <button
                    type="button"
                    data-testid="course-player-speed"
                    onClick={() => setPlaybackSpeed((current) => current >= 2 ? 0.75 : Number((current + 0.25).toFixed(2)))}
                  >
                    {playbackSpeed}x
                  </button>
                  <button
                    type="button"
                    data-testid="course-player-next"
                    onClick={() => openNextLesson()}
                    disabled={!nextLessonEntry}
                    className="disabled:opacity-40"
                  >
                    <ChevronRight className="h-[22px] w-[22px]" />
                  </button>
                  <button type="button" data-testid="course-player-fullscreen" onClick={() => void toggleFullscreen()}>
                    <Maximize2 className="h-[18px] w-[18px]" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      {renderLessonSupportSections('desktop')}

      <section className="grid gap-[14px] xl:grid-cols-[minmax(0,1.1fr)_260px]">
        <div className="rounded-[18px] border border-[#dbe4f3] bg-white px-[18px] py-[16px] shadow-[0_12px_24px_rgba(54,78,123,0.05)]">
          <p className="text-[16px] font-semibold text-[#1b2d50]">About this lesson</p>
          <p className="mt-[10px] text-[15px] leading-[1.55] text-[#516786]">{selectedLessonCopy.about}</p>
        </div>
        <div className="grid gap-[12px] rounded-[18px] border border-[#dbe4f3] bg-white px-[18px] py-[16px] shadow-[0_12px_24px_rgba(54,78,123,0.05)]">
          <div className="flex items-center gap-[10px] text-[15px] text-[#516786]">
            <Clock3 className="h-[18px] w-[18px] text-[#7a90b7]" />
            <span>{formatDurationLabel(selectedLessonEntry?.lesson.durationMinutes || 0)}</span>
          </div>
          <div className="flex items-center gap-[10px] text-[15px] text-[#516786]">
            <Video className="h-[18px] w-[18px] text-[#7a90b7]" />
            <span>Beginner Level</span>
          </div>
        </div>
      </section>

      <section className="grid gap-[14px] xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.7fr)]">
        <div className="rounded-[18px] border border-[#dbe4f3] bg-white px-[18px] py-[16px] shadow-[0_12px_24px_rgba(54,78,123,0.05)]">
          <p className="text-[16px] font-semibold text-[#1b2d50]">Key Takeaways</p>
          <div className="mt-[14px] space-y-[10px]">
            {selectedLessonCopy.takeaways.map((point) => (
              <div key={point} className="flex items-start gap-[10px] text-[15px] leading-[1.48] text-[#32466c]">
                <CheckCircle2 className="mt-[2px] h-[18px] w-[18px] shrink-0 text-[#2d6ee5]" />
                <span>{point}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[18px] border border-[#dbe4f3] bg-white px-[18px] py-[16px] shadow-[0_12px_24px_rgba(54,78,123,0.05)]">
          <p className="text-[16px] font-semibold text-[#1b2d50]">Need Help?</p>
          <p className="mt-[10px] text-[15px] leading-[1.55] text-[#516786]">
            Move to the chapter CBT once the video finishes, then open the explanation video after you submit your answer.
          </p>
          <div className="mt-[16px] flex flex-wrap gap-[10px]">
            <button
              type="button"
              data-testid="course-player-start-cbt"
              onClick={startLessonExam}
              disabled={!isLessonReadyForExam}
              className={cn(
                'rounded-[10px] px-[16px] py-[10px] text-[14px] font-semibold transition',
                isLessonReadyForExam
                  ? 'bg-[#2d6ee5] text-white'
                  : 'cursor-not-allowed border border-[#dbe4f3] bg-[#eef3fb] text-[#91a4c2]',
              )}
            >
              Open CBT Exam
            </button>
            <button
              type="button"
              data-testid="course-player-watch-explanation"
              onClick={openLessonExplanation}
              disabled={!isExplanationUnlocked}
              className={cn(
                'rounded-[10px] px-[16px] py-[10px] text-[14px] font-semibold transition',
                isExplanationUnlocked
                  ? 'bg-[#103b91] text-white'
                  : 'cursor-not-allowed border border-[#dbe4f3] bg-[#eef3fb] text-[#91a4c2]',
              )}
            >
              Watch Explanation
            </button>
            <button
              type="button"
              onClick={() => scrollToLessonSection('course-lesson-doubts-section')}
              className="rounded-[10px] border border-[#dbe4f3] bg-white px-[16px] py-[10px] text-[14px] font-semibold text-[#2d6ee5]"
            >
              Ask Doubts
            </button>
          </div>
        </div>
      </section>
    </div>
  );
  };

  const renderNotesPanel = () => (
    <div className="space-y-[14px]">
      {selectedLessonCopy.notes.map((note) => (
        <section key={note.title} className="rounded-[18px] border border-[#dbe4f3] bg-white px-[18px] py-[18px] shadow-[0_12px_24px_rgba(54,78,123,0.05)]">
          <div className="flex items-center gap-[10px] text-[#2d6ee5]">
            <FileText className="h-[18px] w-[18px]" />
            <p className="text-[16px] font-semibold text-[#1b2d50]">{note.title}</p>
          </div>
          <p className="mt-[10px] text-[15px] leading-[1.55] text-[#516786]">{note.body}</p>
        </section>
      ))}
    </div>
  );

  const renderQuizPanel = () => {
    const selectedOption = selectedLessonExamSelectedOption;
    const submitted = selectedLessonExamSubmitted;
    const correct = selectedOption === selectedLessonCopy.quiz.answerIndex;

    if (submitted && !isMobileLayout) {
      const score = correct ? '8 / 10' : '7 / 10';
      const percent = correct ? 80 : 70;
      const correctAnswers = correct ? 8 : 7;
      const wrongAnswers = correct ? 2 : 3;

      return (
        <section className="space-y-[18px]">
          <div className="rounded-[18px] border border-[#dbe4f3] bg-white px-[20px] py-[22px] shadow-[0_12px_24px_rgba(54,78,123,0.05)]">
            <div className="flex flex-col items-center text-center">
              <div className="flex h-[62px] w-[62px] items-center justify-center rounded-full bg-[#18ad73] text-white shadow-[0_10px_20px_rgba(24,173,115,0.22)]">
                <CheckCircle2 className="h-[34px] w-[34px]" />
              </div>
              <p className="mt-[14px] text-[20px] font-semibold text-[#17233f]">CBT Completed!</p>
              <p className="mt-[6px] text-[14px] text-[#6f84ab]">You have used your 1 attempt.</p>
            </div>

            <div className="mt-[18px] rounded-[16px] border border-[#e3ebf6] bg-white px-[18px] py-[16px]">
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-[13px] text-[#6f84ab]">Your Score</p>
                  <p className="mt-[2px] text-[18px] font-semibold text-[#17233f]">{score}</p>
                </div>
                <span className="text-[18px] font-semibold text-[#18ad73]">{percent}%</span>
              </div>
              <div className="mt-[12px] grid grid-cols-2 gap-[16px] border-t border-[#e8edf7] pt-[12px] text-[13px] text-[#5d7092]">
                <div>
                  <p>Correct Answers</p>
                  <p className="mt-[4px] text-[17px] font-semibold text-[#17233f]">{correctAnswers}</p>
                </div>
                <div>
                  <p>Wrong Answers</p>
                  <p className="mt-[4px] text-[17px] font-semibold text-[#17233f]">{wrongAnswers}</p>
                </div>
              </div>
            </div>

            <div className="mt-[16px] rounded-[16px] border border-[#e3ebf6] bg-[#fbfdff] px-[16px] py-[16px]">
              <div className="flex items-start gap-[10px]">
                <div className="mt-[2px] flex h-[30px] w-[30px] items-center justify-center rounded-[10px] bg-[#edf4ff] text-[#2d6ee5]">
                  <Sparkles className="h-[14px] w-[14px]" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold text-[#17305c]">What&apos;s Next?</p>
                  <p className="mt-[4px] text-[14px] leading-[1.45] text-[#5d7092]">
                    {hasReachedExplanationWatchLimit
                      ? nextLessonEntry
                        ? `Explanation is complete. Continue with ${nextLessonEntry.lesson.title}.`
                        : 'Explanation is complete. Continue from the course page.'
                      : 'Watch the explanation video once before this lesson flow is marked complete.'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                data-testid="course-player-watch-explanation"
                onClick={hasReachedExplanationWatchLimit
                  ? () => {
                    if (nextLessonEntry) {
                      openNextLesson();
                      return;
                    }
                    setScreen('course');
                  }
                  : openLessonExplanation}
                className="mt-[16px] inline-flex h-[42px] w-full items-center justify-center rounded-[10px] bg-[linear-gradient(180deg,#2f6ef0_0%,#2660e3_100%)] text-[14px] font-semibold text-white shadow-[0_12px_24px_rgba(45,110,229,0.2)]"
              >
                {hasReachedExplanationWatchLimit ? (nextLessonEntry ? 'Open Next Lesson' : 'Back to Lessons') : 'Watch Explanation'}
              </button>
            </div>

            <div className="mt-[14px] rounded-[16px] border border-[#e3ebf6] bg-[#eef4ff] px-[16px] py-[12px] text-[14px] text-[#4b658f]">
              <div className="flex items-center gap-[8px]">
                <div className="flex h-[18px] w-[18px] items-center justify-center rounded-full border border-[#2d6ee5] text-[11px] text-[#2d6ee5]">i</div>
                <p>{hasReachedExplanationWatchLimit ? 'Explanation watch limit reached for this lesson.' : 'The explanation video is the next required step in this lesson flow.'}</p>
              </div>
            </div>
          </div>
        </section>
      );
    }

    return (
      <section className="rounded-[18px] border border-[#dbe4f3] bg-white px-[18px] py-[18px] shadow-[0_12px_24px_rgba(54,78,123,0.05)]">
        <p className="text-[16px] font-semibold text-[#1b2d50]">Chapter CBT Exam</p>
        <p className="mt-[10px] text-[16px] leading-[1.48] text-[#253a62]">{selectedLessonCopy.quiz.prompt}</p>
        <div className="mt-[16px] space-y-[10px]">
          {selectedLessonCopy.quiz.options.map((option, index) => (
            <button
              key={option}
              type="button"
              data-testid={`course-player-cbt-option-${index}`}
              disabled={submitted}
              onClick={() => {
                if (submitted) {
                  return;
                }
                setQuizSelections((current) => ({ ...current, [selectedLessonEntry?.lesson.id || '']: index }));
              }}
              className={cn(
                'flex w-full items-center gap-[12px] rounded-[14px] border px-[16px] py-[14px] text-left transition disabled:cursor-not-allowed',
                selectedOption === index
                  ? 'border-[#8fbdf7] bg-[#eef5ff] text-[#1b49d6]'
                  : 'border-[#dbe4f3] bg-[#f9fbff] text-[#516786]',
                submitted && selectedOption !== index && 'opacity-70',
              )}
            >
              <span className="flex h-[24px] w-[24px] items-center justify-center rounded-full border border-current text-[12px] font-semibold">
                {String.fromCharCode(65 + index)}
              </span>
              <span className="text-[15px]">{option}</span>
            </button>
          ))}
        </div>

        <div className="mt-[18px] flex flex-wrap gap-[10px]">
            <button
              type="button"
              data-testid="course-player-cbt-submit"
              disabled={submitted || selectedOption === null}
              onClick={() => submitLessonExam(true)}
              className="rounded-[10px] bg-[#2d6ee5] px-[16px] py-[10px] text-[14px] font-semibold text-white disabled:opacity-60"
            >
              {submitted ? 'Submitted' : 'Submit CBT'}
              </button>
            </div>

        {submitted && selectedOption !== null && (
          <div className={cn('mt-[16px] rounded-[14px] px-[16px] py-[14px] text-[15px] leading-[1.52]', correct ? 'bg-[#eefaf4] text-[#24734e]' : 'bg-[#fff5ef] text-[#9a5724]')}>
            <p className="font-semibold">{correct ? 'Correct answer' : 'Review this once more'}</p>
            <p className="mt-[6px]">{selectedLessonCopy.quiz.explanation}</p>
          </div>
        )}
      </section>
    );
  };

  const renderExplanationPanel = () => {
    if (!selectedLessonExamSubmitted) {
      return (
        <section className="rounded-[18px] border border-[#dbe4f3] bg-white px-[18px] py-[20px] shadow-[0_12px_24px_rgba(54,78,123,0.05)]">
          <p className="text-[16px] font-semibold text-[#1b2d50]">CBT Explanation Video</p>
          <p className="mt-[8px] text-[15px] leading-[1.55] text-[#516786]">
            Submit the chapter CBT to unlock the explanation video for this lesson.
          </p>
          <button
            type="button"
            onClick={startLessonExam}
            className="mt-[16px] inline-flex h-[42px] items-center gap-[8px] rounded-[12px] bg-[#2d6ee5] px-[16px] text-[14px] font-semibold text-white"
          >
            Open CBT Exam
          </button>
        </section>
      );
    }

    return (
      <div className="space-y-[14px]">
        <section className="rounded-[18px] border border-[#dbe4f3] bg-white px-[18px] py-[18px] shadow-[0_12px_24px_rgba(54,78,123,0.05)]">
          <p className="text-[16px] font-semibold text-[#1b2d50]">CBT Explanation Video</p>
          <p className="mt-[6px] text-[14px] text-[#5d6f8e]">
            Review the answer and watch the explanation before moving to the next lesson.
          </p>
        </section>

        <section className="overflow-hidden rounded-[18px] border border-[#dbe4f3] bg-white shadow-[0_12px_24px_rgba(54,78,123,0.05)]">
          <div className="relative min-h-[320px] bg-[#d8e8ff]">
            <img
              alt=""
              aria-hidden="true"
              className="absolute inset-0 h-full w-full object-cover"
              src={buildLessonArtwork(selectedLessonCopy.artwork)}
            />
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.12)_0%,rgba(14,35,72,0.66)_100%)]" />
            <div className="relative flex min-h-[320px] flex-col justify-between px-[20px] py-[18px] text-white">
              <div className="max-w-[420px]">
                <p className="text-[16px] font-semibold uppercase tracking-[0.18em] text-white/72">Explanation video</p>
                <h3 className="mt-[10px] text-[20px] font-semibold leading-[1.12] tracking-[-0.03em]">{selectedLessonCopy.quiz.explanation}</h3>
                <p className="mt-[10px] text-[15px] leading-[1.55] text-white/88">
                  The explanation is tied directly to the CBT attempt so the lesson ends with review, not a dead end.
                </p>
              </div>
              <div className="flex items-center justify-between gap-[12px] rounded-[16px] bg-black/20 px-[14px] py-[12px] backdrop-blur">
                <button
                  type="button"
                  data-testid="course-player-explanation-play"
                  onClick={() => setIsExplanationPlaying((current) => !current)}
                  className="flex h-[48px] w-[48px] items-center justify-center rounded-full bg-white text-[#1b49d6]"
                >
                  {isExplanationPlaying ? <Pause className="h-[22px] w-[22px] fill-current" /> : <Play className="ml-[2px] h-[22px] w-[22px] fill-current" />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="h-[6px] overflow-hidden rounded-full bg-white/28">
                    <div
                      className="h-full rounded-full bg-[#69a6ff]"
                      style={{ width: `${Math.min((explanationPlaybackSeconds / selectedLessonExplanationDurationSeconds) * 100, 100)}%` }}
                    />
                  </div>
                  <div className="mt-[8px] flex items-center justify-between text-[13px] text-white/82">
                    <span>{formatPlaybackTime(explanationPlaybackSeconds)}</span>
                    <span>{formatPlaybackTime(selectedLessonExplanationDurationSeconds)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-[18px] border border-[#dbe4f3] bg-white px-[18px] py-[18px] shadow-[0_12px_24px_rgba(54,78,123,0.05)]">
          <p className="text-[16px] font-semibold text-[#1b2d50]">Why this answer is right</p>
          <div className="mt-[12px] space-y-[10px]">
            {selectedLessonCopy.takeaways.map((point) => (
              <div key={point} className="flex items-start gap-[10px] text-[15px] leading-[1.48] text-[#32466c]">
                <CheckCircle2 className="mt-[2px] h-[18px] w-[18px] shrink-0 text-[#2d6ee5]" />
                <span>{point}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    );
  };

  const scrollToLessonSection = (sectionId: string) => {
    if (typeof document === 'undefined') {
      return;
    }

    const section = document.getElementById(sectionId);
    section?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const submitLessonDoubt = () => {
    if (!selectedLessonEntry) {
      return;
    }

    const lessonId = selectedLessonEntry.lesson.id;
    const message = (lessonDoubtDrafts[lessonId] || '').trim();
    if (!message) {
      return;
    }

    const now = new Date();
    const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

    setLessonDoubtThreads((current) => ({
      ...current,
      [lessonId]: [
        ...(current[lessonId] || []),
        {
          id: `${lessonId}-${now.getTime()}`,
          name: overview.user?.name || 'You',
          time,
          message,
          self: true,
        },
      ],
    }));
    setLessonDoubtDrafts((current) => ({
      ...current,
      [lessonId]: '',
    }));
  };

  const toggleSupportPanel = (panel: Exclude<LessonSupportPanel, null>) => {
    setExpandedSupportPanel((current) => (current === panel ? null : panel));
  };

  const renderLessonNotesSection = (layout: 'desktop' | 'mobile') => {
    if (!selectedLessonEntry) {
      return null;
    }

    const isDesktop = layout === 'desktop';
    const isExpanded = expandedSupportPanel === 'notes';

    return (
      <section
        id="course-lesson-notes-section"
        data-testid="course-lesson-notes-section"
        data-state={isExpanded ? 'expanded' : 'collapsed'}
        className={cn(
          'rounded-[18px] border bg-white shadow-[0_12px_24px_rgba(54,78,123,0.05)] transition',
          isExpanded ? 'border-[#bdd2fb] bg-[#fbfdff]' : 'border-[#dbe4f3]',
          isDesktop ? 'px-[18px] py-[18px]' : 'px-[14px] py-[14px]',
        )}
      >
        <button
          type="button"
          onClick={() => toggleSupportPanel('notes')}
          className="flex w-full items-start justify-between gap-[10px] text-left"
        >
        <div className="flex items-start gap-[10px]">
          <div className="mt-[2px] flex h-[30px] w-[30px] items-center justify-center rounded-[10px] bg-[#edf4ff] text-[#2d6ee5]">
            <FileText className="h-[14px] w-[14px]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className={cn(isDesktop ? 'text-[16px]' : 'text-[14px]', 'font-semibold text-[#17305c]')}>Notes</p>
            <p className={cn(isDesktop ? 'text-[13px]' : 'text-[12px]', 'mt-[4px] leading-[1.45] text-[#5d7092]')}>
              {isExpanded ? 'Revision notes are open under the video.' : 'Expand notes only when you want a quick recap.'}
            </p>
          </div>
        </div>
          <span className="rounded-full border border-[#dbe4f3] bg-white px-[12px] py-[6px] text-[11px] font-semibold text-[#2d6ee5]">
            {isExpanded ? 'Collapse' : 'Expand'}
          </span>
        </button>

        {isExpanded && (
          <>
            <div className={cn('mt-[14px]', isDesktop ? 'space-y-[10px]' : 'space-y-[8px]')}>
              {selectedLessonCopy.notes.map((note) => (
                <div
                  key={note.title}
                  className={cn(
                    'rounded-[14px] bg-[#fbfdff]',
                    isDesktop ? 'px-[14px] py-[14px]' : 'px-[12px] py-[12px]',
                  )}
                >
                  <p className={cn(isDesktop ? 'text-[14px]' : 'text-[13px]', 'font-semibold text-[#1b2d50]')}>{note.title}</p>
                  <p className={cn(isDesktop ? 'text-[14px]' : 'text-[12px]', 'mt-[6px] leading-[1.55] text-[#516786]')}>
                    {note.body}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-[14px] rounded-[14px] border border-[#e3ebf6] bg-[#f6f9ff] px-[14px] py-[12px]">
              <p className={cn(isDesktop ? 'text-[13px]' : 'text-[12px]', 'font-semibold text-[#17305c]')}>Quick Tip</p>
              <p className={cn(isDesktop ? 'text-[13px]' : 'text-[12px]', 'mt-[4px] leading-[1.5] text-[#5d7092]')}>
                {selectedLessonCopy.quickTip}
              </p>
            </div>
          </>
        )}
      </section>
    );
  };

  const renderLessonDoubtsSection = (layout: 'desktop' | 'mobile') => {
    if (!selectedLessonEntry) {
      return null;
    }

    const isDesktop = layout === 'desktop';
    const lessonId = selectedLessonEntry.lesson.id;
    const thread = lessonDoubtThreads[lessonId] || [];
    const draft = lessonDoubtDrafts[lessonId] || '';
    const isExpanded = expandedSupportPanel === 'doubts';

    return (
      <section
        id="course-lesson-doubts-section"
        data-testid="course-lesson-doubts-section"
        data-state={isExpanded ? 'expanded' : 'collapsed'}
        className={cn(
          'rounded-[18px] border bg-white shadow-[0_12px_24px_rgba(54,78,123,0.05)] transition',
          isExpanded ? 'border-[#bdd2fb] bg-[#fbfdff]' : 'border-[#dbe4f3]',
          isDesktop ? 'px-[18px] py-[18px]' : 'px-[14px] py-[14px]',
        )}
      >
        <button
          type="button"
          onClick={() => toggleSupportPanel('doubts')}
          className="flex w-full items-start justify-between gap-[10px] text-left"
        >
        <div className="flex items-start gap-[10px]">
          <div className="mt-[2px] flex h-[30px] w-[30px] items-center justify-center rounded-[10px] bg-[#edf4ff] text-[#2d6ee5]">
            <MessageSquare className="h-[14px] w-[14px]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className={cn(isDesktop ? 'text-[16px]' : 'text-[14px]', 'font-semibold text-[#17305c]')}>Ask Doubts</p>
            <p className={cn(isDesktop ? 'text-[13px]' : 'text-[12px]', 'mt-[4px] leading-[1.45] text-[#5d7092]')}>
              {isExpanded ? selectedLessonCopy.discussionPrompt : 'Open the chat helper only when you need it.'}
            </p>
          </div>
        </div>
          <span className="rounded-full border border-[#dbe4f3] bg-white px-[12px] py-[6px] text-[11px] font-semibold text-[#2d6ee5]">
            {isExpanded ? 'Collapse' : 'Expand'}
          </span>
        </button>

        {isExpanded && (
          <>
            <div className={cn('mt-[14px]', isDesktop ? 'space-y-[10px]' : 'space-y-[8px]')}>
              {thread.map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    'rounded-[14px] px-[14px] py-[12px]',
                    message.self ? 'ml-auto bg-[#edf7ff]' : 'bg-[#f6f9ff]',
                  )}
                >
                  <div className="flex items-center justify-between gap-[10px]">
                    <p className={cn(isDesktop ? 'text-[13px]' : 'text-[12px]', 'font-semibold text-[#1f2d4e]')}>
                      {message.name}
                    </p>
                    <span className={cn(isDesktop ? 'text-[11px]' : 'text-[10px]', 'text-[#8aa0b8]')}>
                      {message.time}
                    </span>
                  </div>
                  <p className={cn(isDesktop ? 'text-[13px]' : 'text-[12px]', 'mt-[6px] leading-[1.55] text-[#5c708d]')}>
                    {message.message}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-[14px] flex items-center gap-[8px] rounded-[14px] border border-[#dbe4f3] bg-[#f9fbff] px-[12px] py-[10px]">
              <input
                type="text"
                value={draft}
                onChange={(event) => setLessonDoubtDrafts((current) => ({
                  ...current,
                  [lessonId]: event.target.value,
                }))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    submitLessonDoubt();
                  }
                }}
                placeholder="Type your doubt..."
                className="min-w-0 flex-1 bg-transparent text-[13px] text-[#20314b] outline-none placeholder:text-[#8aa0b8]"
              />
              <button
                type="button"
                data-testid="course-lesson-doubt-send"
                onClick={submitLessonDoubt}
                className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-[#2d6ee5] text-white"
              >
                <Send className="h-[15px] w-[15px]" />
              </button>
            </div>
          </>
        )}
      </section>
    );
  };

  const renderLessonSupportSections = (layout: 'desktop' | 'mobile') => (
    <div
      className={cn(
        'grid gap-[14px]',
        layout === 'desktop' ? 'xl:grid-cols-2' : 'grid-cols-1',
      )}
    >
      {renderLessonNotesSection(layout)}
      {renderLessonDoubtsSection(layout)}
    </div>
  );

  const renderMobileSupportTabs = () => {
    if (!selectedLessonEntry) {
      return null;
    }

    const lessonId = selectedLessonEntry.lesson.id;
    const thread = lessonDoubtThreads[lessonId] || [];
    const draft = lessonDoubtDrafts[lessonId] || '';
    const seededThread = thread.length > 0 ? thread : [
      {
        id: `${lessonId}-starter`,
        name: 'Mentor desk',
        time: 'Now',
        message: selectedLessonCopy.discussionPrompt,
      },
    ];

    return (
      <section className="overflow-hidden rounded-[20px] border border-[#dfe7f4] bg-white shadow-[0_14px_28px_rgba(54,78,123,0.06)]">
        <div className="grid grid-cols-2 border-b border-[#e7edf7]">
          {([
            ['notes', 'Notes', FileText],
            ['doubts', 'Doubts', MessageSquare],
          ] as const).map(([tabId, label, Icon]) => {
            const active = mobileSupportTab === tabId;
            return (
              <button
                key={tabId}
                type="button"
                onClick={() => setMobileSupportTab(tabId)}
                className={cn(
                  'relative flex h-[56px] items-center justify-center gap-[8px] text-[14px] font-semibold transition',
                  active ? 'text-[#1f6fff]' : 'text-[#7d8eac]',
                )}
              >
                <Icon className="h-[18px] w-[18px]" />
                <span>{label}</span>
                {active && <span className="absolute inset-x-[20px] bottom-0 h-[3px] rounded-full bg-[#2f7ef7]" />}
              </button>
            );
          })}
        </div>

        <div
          id="course-lesson-notes-section"
          data-testid="course-lesson-notes-section"
          data-state={mobileSupportTab === 'notes' ? 'expanded' : 'collapsed'}
          className={cn('px-[14px] py-[14px]', mobileSupportTab !== 'notes' && 'hidden')}
        >
          <div className="space-y-[10px]">
            {selectedLessonCopy.notes.map((note, index) => (
              <div
                key={note.title}
                className="flex items-start gap-[12px] rounded-[16px] border border-[#edf2fa] bg-[#fcfdff] px-[12px] py-[12px]"
              >
                <div
                  className={cn(
                    'mt-[2px] flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-[14px]',
                    index % 2 === 0 ? 'bg-[#edf4ff] text-[#2d6ee5]' : 'bg-[#ecfbf2] text-[#1fa45d]',
                  )}
                >
                  <FileText className="h-[18px] w-[18px]" />
                </div>
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold leading-[1.35] text-[#17233f]">{note.title}</p>
                  <p className="mt-[4px] text-[12px] leading-[1.55] text-[#607394]">{note.body}</p>
                  <p className="mt-[6px] text-[11px] font-medium text-[#7a8faf]">Updated 2 days ago</p>
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            className="mt-[12px] flex h-[46px] w-full items-center justify-center gap-[8px] rounded-[14px] border border-[#e4ecfa] bg-[#fbfdff] text-[14px] font-semibold text-[#1f6fff]"
          >
            <span className="text-[22px] leading-none">+</span>
            Add Note
          </button>
        </div>

        <div
          id="course-lesson-doubts-section"
          data-testid="course-lesson-doubts-section"
          data-state={mobileSupportTab === 'doubts' ? 'expanded' : 'collapsed'}
          className={cn('px-[14px] py-[14px]', mobileSupportTab !== 'doubts' && 'hidden')}
        >
          <div className="max-h-[240px] space-y-[10px] overflow-y-auto pr-[4px]">
            {seededThread.map((message) => (
              <div
                key={message.id}
                className={cn(
                  'rounded-[16px] border px-[12px] py-[12px]',
                  message.self
                    ? 'ml-[22px] border-[#d8e7ff] bg-[#eef5ff]'
                    : 'border-[#edf2fa] bg-[#fcfdff]',
                )}
              >
                <div className="flex items-center justify-between gap-[12px]">
                  <p className="text-[13px] font-semibold text-[#1f2d4e]">{message.name}</p>
                  <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-[#8ca0bc]">{message.time}</span>
                </div>
                <p className="mt-[6px] text-[12px] leading-[1.55] text-[#607394]">{message.message}</p>
              </div>
            ))}
          </div>

          <div className="mt-[12px] rounded-[16px] border border-[#dbe4f3] bg-[#f9fbff] px-[12px] py-[12px]">
            <p className="text-[12px] font-semibold text-[#17305c]">Ask a quick doubt</p>
            <div className="mt-[10px] flex items-center gap-[8px]">
              <input
                type="text"
                value={draft}
                onChange={(event) => setLessonDoubtDrafts((current) => ({
                  ...current,
                  [lessonId]: event.target.value,
                }))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    submitLessonDoubt();
                  }
                }}
                placeholder="Type your doubt..."
                className="min-w-0 flex-1 bg-transparent text-[13px] text-[#20314b] outline-none placeholder:text-[#8aa0b8]"
              />
              <button
                type="button"
                data-testid="course-lesson-doubt-send"
                onClick={submitLessonDoubt}
                className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-[#2d6ee5] text-white shadow-[0_8px_18px_rgba(45,110,229,0.24)]"
              >
                <Send className="h-[16px] w-[16px]" />
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  };

  const renderMobileLessonView = () => {
    const mobileMode: MobileLessonStage =
      activeLessonTab === 'CBT Exam'
        ? mobileLessonStageOverride || 'exam'
        : activeLessonTab === 'Explanation'
          ? mobileLessonStageOverride || 'explanation'
          : 'watch';
    const currentTimeLabel = formatPlaybackTime(videoPlaybackSeconds || selectedLessonStoredProgress?.progressSeconds || 0);
    const totalTimeLabel = formatPlaybackTime(selectedLessonVideoDurationSeconds);

    const renderMobileVideoPill = () => (
      <div className="flex items-center justify-between gap-[10px]">
        <button
          type="button"
          data-testid="course-player-tab-video"
          onClick={() => handleLessonTabSelect('Video')}
          className={cn(
            'inline-flex h-[30px] items-center rounded-full px-[12px] text-[12px] font-semibold transition',
            activeLessonTab === 'Video'
              ? 'bg-[#e8f0ff] text-[#2d6ee5]'
              : 'border border-[#dbe4f3] bg-white text-[#5e7397]',
          )}
        >
          Video
        </button>
        <span className="text-[11px] font-medium text-[#6f84ab]">
          {hasReachedLessonVideoWatchLimit ? 'Video limit reached' : canRewatchLessonVideo ? 'Rewatch available' : 'Ready to watch'}
        </span>
      </div>
    );

    const renderWatchCard = () => (
      <section data-testid="course-figma-player" className="overflow-hidden rounded-[18px] border border-[#d8e2f1] bg-[#d8e8ff] shadow-[0_12px_28px_rgba(46,67,111,0.08)]">
        <div className="relative min-h-[316px] bg-[#d8e8ff]">
          <img
            alt=""
            aria-hidden="true"
            className={cn('absolute inset-0 h-full w-full object-cover', autoplayCountdown !== null && 'opacity-30 blur-[1px]')}
            src={buildLessonArtwork(selectedLessonCopy.artwork)}
          />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.10)_0%,rgba(255,255,255,0.02)_34%,rgba(15,28,54,0.25)_68%,rgba(14,23,39,0.88)_100%)]" />
          <div className="relative flex min-h-[316px] flex-col">
            <div className="px-[18px] pt-[16px]">
              <h2 className="max-w-[230px] text-[18px] font-semibold leading-[1.15] tracking-[-0.03em] text-[#14233f]">
                {selectedLessonCopy.heading}
              </h2>
              <p className="mt-[8px] max-w-[200px] text-[13px] leading-[1.5] text-[#31486f]">
                {selectedLessonCopy.summary}
              </p>
            </div>

            {!hasReachedLessonVideoWatchLimit || isVideoReplayMode ? (
              <button
                type="button"
                onClick={() => setIsVideoPlaying((current) => !current)}
                className="absolute left-1/2 top-1/2 flex h-[54px] w-[54px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[#5a6e93] text-white shadow-[0_12px_24px_rgba(21,33,57,0.22)]"
              >
                {isVideoPlaying ? <Pause className="h-[22px] w-[22px] fill-current" /> : <Play className="ml-[2px] h-[22px] w-[22px] fill-current" />}
              </button>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="rounded-full border border-white/30 bg-white/92 px-[16px] py-[10px] text-[12px] font-semibold text-[#17305c] shadow-[0_12px_28px_rgba(8,15,25,0.14)]">
                  Video limit reached
                </div>
              </div>
            )}

            <div className="mt-auto px-[12px] pb-[12px]">
              <div className="flex items-center gap-[10px] rounded-[12px] bg-[linear-gradient(180deg,rgba(3,16,33,0.02)_0%,rgba(3,16,33,0.78)_100%)] px-[10px] py-[9px] text-white backdrop-blur">
                {!hasReachedLessonVideoWatchLimit || isVideoReplayMode ? (
                  <button
                    type="button"
                    data-testid="course-player-video-play"
                    onClick={() => setIsVideoPlaying((current) => !current)}
                    className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-transparent"
                  >
                    {isVideoPlaying ? <Pause className="h-[16px] w-[16px] fill-current" /> : <Play className="ml-[1px] h-[16px] w-[16px] fill-current" />}
                  </button>
                ) : (
                  <span data-testid="course-player-rewatch-limit" className="inline-flex h-[22px] items-center rounded-full bg-white/14 px-[10px] text-[10px] font-semibold text-white/92">
                    Video limit reached
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="h-[4px] overflow-hidden rounded-full bg-white/28">
                    <div
                      className="h-full rounded-full bg-white"
                      style={{ width: `${Math.min((videoPlaybackSeconds / selectedLessonVideoDurationSeconds) * 100, 100)}%` }}
                    />
                  </div>
                  <div className="mt-[6px] flex items-center justify-between text-[12px] text-white/92">
                    <span>{currentTimeLabel} / {totalTimeLabel}</span>
                    <div className="flex items-center gap-[12px]">
                      <button
                        type="button"
                        data-testid="course-player-speed"
                        onClick={() => setPlaybackSpeed((current) => (current >= 2 ? 1 : current + 0.5))}
                        className="text-[12px] font-medium"
                      >
                        {playbackSpeed}x
                      </button>
                      <button
                        type="button"
                        data-testid="course-player-fullscreen"
                        onClick={() => void toggleFullscreen()}
                        className="text-white"
                      >
                        <Maximize2 className="h-[14px] w-[14px]" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {autoplayCountdown !== null && nextLessonEntry ? (
              <div data-testid="course-player-overlay" className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[linear-gradient(180deg,rgba(21,31,49,0.16)_0%,rgba(21,31,49,0.74)_100%)] px-[20px] text-center text-white">
                <p className="text-[17px] font-semibold">Up Next</p>
                <div className="mt-[16px] flex h-[92px] w-[92px] items-center justify-center rounded-full bg-white text-[#2d6ee5]">
                  <BookOpen className="h-[40px] w-[40px]" />
                </div>
                <p className="mt-[18px] max-w-[240px] text-[17px] font-semibold leading-[1.22]">{nextLessonEntry.lesson.title}</p>
                <p className="mt-[8px] text-[14px] text-white/82">{formatDurationLabel(nextLessonEntry.lesson.durationMinutes)}</p>
                <p className="mt-[18px] text-[14px] text-white/88">Starting in {autoplayCountdown} second{autoplayCountdown === 1 ? '' : 's'}...</p>
                <button
                  type="button"
                  onClick={() => setAutoplayCountdown(null)}
                  className="mt-[18px] inline-flex h-[40px] items-center gap-[8px] rounded-full border border-white/36 px-[16px] text-[14px] font-medium text-white"
                >
                  <span className="text-[18px] leading-none">×</span>
                  Cancel
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    );

    const renderCompletionCard = () => {
      const lessonsCompletedLabel = selectedCourseVideoCompletedDisplayCount;

      if (isLessonFlowComplete) {
        return (
          <section className="rounded-[18px] border border-[#dbe4f3] bg-white px-[16px] py-[18px] shadow-[0_12px_24px_rgba(54,78,123,0.05)]">
            <div className="flex flex-col items-center text-center">
              <div className="flex h-[54px] w-[54px] items-center justify-center rounded-full bg-[#18ad73] text-white shadow-[0_10px_20px_rgba(24,173,115,0.22)]">
                <CheckCircle2 className="h-[30px] w-[30px]" />
              </div>
              <p className="mt-[12px] text-[17px] font-semibold leading-none text-[#17233f]">Lesson Flow Completed</p>
              <p className="mt-[7px] max-w-[230px] text-[13px] leading-[1.42] text-[#5d7092]">
                Video, CBT, and explanation are all complete for {selectedLessonEntry?.lesson.title}.
              </p>
            </div>

            <div className="mt-[18px] rounded-[16px] border border-[#e3ebf6] bg-[#fbfdff] px-[14px] py-[14px]">
              <div className="flex items-start gap-[10px]">
                <div className="mt-[2px] flex h-[28px] w-[28px] items-center justify-center rounded-[10px] bg-[#edf4ff] text-[#2d6ee5]">
                  <Sparkles className="h-[14px] w-[14px]" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-[#17305c]">What&apos;s Next?</p>
                  <p className="mt-[4px] text-[12px] leading-[1.4] text-[#5d7092]">
                    {nextLessonEntry
                      ? `Continue with ${nextLessonEntry.lesson.title}.`
                      : 'You have completed this lesson sequence.'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                data-testid="course-player-continue-next-lesson"
                onClick={() => {
                  if (nextLessonEntry) {
                    openNextLesson();
                    return;
                  }
                  setScreen('course');
                }}
                className="mt-[14px] inline-flex h-[40px] w-full items-center justify-center rounded-[8px] bg-[linear-gradient(180deg,#2f6ef0_0%,#2660e3_100%)] text-[13px] font-semibold text-white shadow-[0_12px_24px_rgba(45,110,229,0.2)]"
              >
                {nextLessonEntry ? 'Open Next Lesson' : 'Back to Lessons'}
              </button>
            </div>

            <div className="mt-[12px] grid gap-[12px]">
              <div className="rounded-[16px] border border-[#e3ebf6] bg-white px-[14px] py-[14px]">
                <p className="text-[12px] font-semibold text-[#17305c]">Lesson Replay</p>
                <p className="mt-[4px] text-[11px] leading-[1.42] text-[#5d7092]">
                  {hasReachedLessonVideoWatchLimit
                    ? 'Maximum lesson video rewatch limit reached.'
                    : `${selectedLessonVideoWatchCount}/${MAX_VIDEO_WATCHES} watches used. One more replay is available.`}
                </p>
                {canRewatchLessonVideo ? (
                  <button
                    type="button"
                    data-testid="course-player-rewatch-video"
                    onClick={startLessonVideoReplay}
                    className="mt-[12px] inline-flex h-[32px] items-center justify-center rounded-[10px] border border-[#d7e3f5] bg-white px-[12px] text-[11px] font-semibold text-[#2d6ee5]"
                  >
                    Rewatch Lesson
                  </button>
                ) : (
                  <div data-testid="course-player-rewatch-limit" className="mt-[12px] inline-flex h-[26px] items-center rounded-full bg-[#eef3fb] px-[10px] text-[10px] font-medium text-[#7287a8]">
                    Maximum limit reached
                  </div>
                )}
              </div>

              <div className="rounded-[16px] border border-[#e3ebf6] bg-white px-[14px] py-[14px]">
                <p className="text-[12px] font-semibold text-[#17305c]">Explanation Status</p>
                <p className="mt-[4px] text-[11px] leading-[1.42] text-[#5d7092]">
                  {hasReachedExplanationWatchLimit
                    ? 'Explanation video already watched once. Rewatch is not available.'
                    : 'Explanation video is still pending.'}
                </p>
                <div className="mt-[12px] inline-flex h-[26px] items-center rounded-full bg-[#eef4ff] px-[10px] text-[10px] font-medium text-[#4b658f]">
                  {hasReachedExplanationWatchLimit ? 'Maximum limit reached' : 'One-time watch'}
                </div>
              </div>
            </div>

            <div className="mt-[14px] rounded-[16px] border border-[#e3ebf6] bg-white px-[14px] py-[14px]">
              <div className="flex items-center justify-between">
                <p className="text-[13px] font-semibold text-[#17233f]">Lesson Progress</p>
                <span className="text-[12px] font-medium text-[#2d6ee5]">100%</span>
              </div>
              <p className="mt-[5px] text-[12px] text-[#5d7092]">
                {lessonsCompletedLabel} of {selectedCourseSnapshot.totalLessons} lessons completed
              </p>
              <div className="mt-[10px] h-[6px] overflow-hidden rounded-full bg-[#d8e4f7]">
                <div
                  className="h-full rounded-full bg-[linear-gradient(90deg,#57a4ff_0%,#7ab8ff_100%)]"
                  style={{ width: '100%' }}
                />
              </div>
            </div>
          </section>
        );
      }

      return (
        <section className="rounded-[18px] border border-[#dbe4f3] bg-white px-[16px] py-[18px] shadow-[0_12px_24px_rgba(54,78,123,0.05)]">
          <div className="flex flex-col items-center text-center">
            <div className="flex h-[54px] w-[54px] items-center justify-center rounded-full bg-[#18ad73] text-white shadow-[0_10px_20px_rgba(24,173,115,0.22)]">
              <CheckCircle2 className="h-[30px] w-[30px]" />
            </div>
            <p className="mt-[12px] text-[17px] font-semibold leading-none text-[#17233f]">Lesson Completed!</p>
            <p className="mt-[7px] max-w-[210px] text-[13px] leading-[1.42] text-[#5d7092]">
              Great job! You&apos;ve completed {selectedLessonEntry?.lesson.title}.
            </p>
          </div>

          <div className="mt-[18px] rounded-[16px] border border-[#e3ebf6] bg-[#fbfdff] px-[14px] py-[14px]">
            <div className="flex items-start gap-[10px]">
              <div className="mt-[2px] flex h-[28px] w-[28px] items-center justify-center rounded-[10px] bg-[#edf4ff] text-[#2d6ee5]">
                <Sparkles className="h-[14px] w-[14px]" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-[#17305c]">What&apos;s Next?</p>
                <p className="mt-[4px] text-[12px] leading-[1.4] text-[#5d7092]">
                  Take a CBT (Chapter Based Test) to test your understanding.
                </p>
              </div>
            </div>
            <button
              type="button"
              data-testid="course-player-start-cbt"
              onClick={startLessonExam}
              className="mt-[14px] inline-flex h-[40px] w-full items-center justify-center rounded-[8px] bg-[linear-gradient(180deg,#2f6ef0_0%,#2660e3_100%)] text-[13px] font-semibold text-white shadow-[0_12px_24px_rgba(45,110,229,0.2)]"
            >
              Start CBT Exam
            </button>
            <div className="mt-[10px] flex items-center justify-center gap-[6px] text-[11px] text-[#6f84ab]">
              <span>One Attempt Only</span>
              <Clock3 className="h-[12px] w-[12px]" />
            </div>

            <div className="mt-[12px] border-t border-[#e6edf8] pt-[12px]">
              <div className="flex items-start justify-between gap-[10px]">
                <div className="min-w-0">
                  <p className="text-[12px] font-semibold text-[#17305c]">Lesson Replay</p>
                  <p className="mt-[4px] text-[11px] leading-[1.42] text-[#5d7092]">
                    {hasReachedLessonVideoWatchLimit
                      ? 'Maximum lesson video rewatch limit reached.'
                      : `${selectedLessonVideoWatchCount}/${MAX_VIDEO_WATCHES} watches used. You can replay this lesson one more time.`}
                  </p>
                </div>
                {canRewatchLessonVideo ? (
                <button
                  type="button"
                  data-testid="course-player-rewatch-video"
                  onClick={startLessonVideoReplay}
                  className="inline-flex h-[32px] shrink-0 items-center justify-center rounded-[10px] border border-[#d7e3f5] bg-white px-[12px] text-[11px] font-semibold text-[#2d6ee5]"
                >
                  Rewatch
                </button>
              ) : (
                <span data-testid="course-player-rewatch-limit" className="inline-flex h-[26px] shrink-0 items-center rounded-full bg-[#eef3fb] px-[10px] text-[10px] font-medium text-[#7287a8]">
                  Limit reached
                </span>
              )}
              </div>
            </div>
          </div>

          <div className="mt-[14px] rounded-[16px] border border-[#e3ebf6] bg-white px-[14px] py-[14px]">
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-semibold text-[#17233f]">Lesson Progress</p>
              <span className="text-[12px] font-medium text-[#2d6ee5]">100%</span>
            </div>
            <p className="mt-[5px] text-[12px] text-[#5d7092]">
              {lessonsCompletedLabel} of {selectedCourseSnapshot.totalLessons} lessons completed
            </p>
            <div className="mt-[10px] h-[6px] overflow-hidden rounded-full bg-[#d8e4f7]">
              <div
                className="h-full rounded-full bg-[linear-gradient(90deg,#57a4ff_0%,#7ab8ff_100%)]"
                style={{ width: '100%' }}
              />
            </div>
          </div>
        </section>
      );
    };

    const renderExamCard = () => {
      const selectedOption = selectedLessonExamSelectedOption;
      const prompt = selectedLessonCopy.quiz.prompt;
      return (
        <section className="rounded-[18px] border border-[#dbe4f3] bg-white px-[14px] py-[14px] shadow-[0_12px_24px_rgba(54,78,123,0.05)]">
          <div className="flex items-center justify-between border-b border-[#e4ebf8] pb-[10px]">
            <button type="button" className="border-b-[2px] border-[#2d6ee5] pb-[6px] text-[14px] font-semibold text-[#1b49d6]">
              CBT Exam
            </button>
            <button type="button" className="text-[12px] font-medium text-[#ff8a00]">
              One Attempt Only &gt;
            </button>
          </div>

          <div className="mt-[12px] flex items-center justify-between text-[13px] text-[#7a90b7]">
            <div>
              <p className="uppercase tracking-[0.04em]">Time Left</p>
              <p className="mt-[4px] text-[16px] font-semibold text-[#17233f]">
                {formatPlaybackTime(Math.max(selectedLessonVideoDurationSeconds - 315, 0))}
              </p>
            </div>
            <div className="text-right">
              <p className="uppercase tracking-[0.04em]">Question</p>
              <p className="mt-[4px] text-[16px] font-semibold text-[#17233f]">1 / 10</p>
            </div>
          </div>

          <div className="mt-[14px] rounded-[16px] border border-[#e1e9f6] bg-[#fbfdff] px-[14px] py-[14px]">
            <p className="text-[16px] font-semibold leading-[1.35] text-[#17233f]">Q1. {prompt}</p>
            <div className="mt-[14px] space-y-[10px]">
              {selectedLessonCopy.quiz.options.map((option, index) => (
                <button
                  key={option}
                  type="button"
                  data-testid={`course-player-cbt-option-${index}`}
                  disabled={selectedLessonExamSubmitted}
                  onClick={() => {
                    if (selectedLessonExamSubmitted) {
                      return;
                    }
                    setQuizSelections((current) => ({ ...current, [selectedLessonEntry?.lesson.id || '']: index }));
                  }}
                  className={cn(
                    'flex w-full items-center gap-[10px] rounded-[12px] border px-[12px] py-[12px] text-left',
                    selectedOption === index ? 'border-[#8fbdf7] bg-[#eef5ff] text-[#1b49d6]' : 'border-[#dbe4f3] bg-white text-[#516786]',
                    selectedLessonExamSubmitted && selectedOption !== index && 'opacity-70',
                  )}
                >
                  <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full border border-current text-[10px] font-semibold">
                    {String.fromCharCode(65 + index)}
                  </span>
                  <span className="text-[14px] leading-[1.35]">{option}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-[14px] flex items-center gap-[10px]">
            <button
              type="button"
              onClick={() => {
                if (!selectedLessonEntry) {
                  return;
                }
                setQuizSelections((current) => ({ ...current, [selectedLessonEntry.lesson.id]: null }));
              }}
              className="inline-flex h-[40px] flex-1 items-center justify-center rounded-[10px] border border-[#dbe4f3] bg-white text-[14px] font-medium text-[#5e7397]"
            >
              Clear Answer
            </button>
            <button
              type="button"
              data-testid="course-player-cbt-submit"
              disabled={selectedOption === null}
              onClick={() => submitLessonExam(false)}
              className="inline-flex h-[40px] flex-1 items-center justify-center rounded-[10px] bg-[linear-gradient(180deg,#2f6ef0_0%,#2660e3_100%)] text-[14px] font-semibold text-white shadow-[0_12px_24px_rgba(45,110,229,0.2)] disabled:opacity-60"
            >
              Next
            </button>
          </div>
        </section>
      );
    };

    const renderExamCompleteCard = () => {
      const selectedOption = selectedLessonExamSelectedOption;
      const correct = selectedOption === selectedLessonCopy.quiz.answerIndex;
      const score = correct ? '8 / 10' : '7 / 10';
      const percent = correct ? 80 : 70;
      const correctAnswers = correct ? 8 : 7;
      const wrongAnswers = correct ? 2 : 3;

      return (
        <section className="space-y-[14px]">
          <div className="rounded-[18px] border border-[#dbe4f3] bg-white px-[16px] py-[18px] shadow-[0_12px_24px_rgba(54,78,123,0.05)]">
            <div className="flex flex-col items-center text-center">
              <div className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-[#18ad73] text-white shadow-[0_10px_20px_rgba(24,173,115,0.22)]">
                <CheckCircle2 className="h-[28px] w-[28px]" />
              </div>
              <p className="mt-[12px] text-[17px] font-semibold text-[#17233f]">CBT Completed!</p>
              <p className="mt-[6px] text-[12px] text-[#6f84ab]">You have used your 1 attempt.</p>
            </div>

            <div className="mt-[16px] rounded-[16px] border border-[#e3ebf6] bg-white px-[14px] py-[14px]">
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-[12px] text-[#6f84ab]">Your Score</p>
                  <p className="mt-[2px] text-[16px] font-semibold text-[#17233f]">{score}</p>
                </div>
                <span className="text-[15px] font-semibold text-[#18ad73]">{percent}%</span>
              </div>
              <div className="mt-[12px] grid grid-cols-2 gap-[12px] border-t border-[#e8edf7] pt-[12px] text-[12px] text-[#5d7092]">
                <div>
                  <p>Correct Answers</p>
                  <p className="mt-[4px] text-[15px] font-semibold text-[#17233f]">{correctAnswers}</p>
                </div>
                <div>
                  <p>Wrong Answers</p>
                  <p className="mt-[4px] text-[15px] font-semibold text-[#17233f]">{wrongAnswers}</p>
                </div>
              </div>
            </div>

            <div className="mt-[14px] rounded-[16px] border border-[#e3ebf6] bg-[#fbfdff] px-[14px] py-[14px]">
              <div className="flex items-start gap-[10px]">
                <div className="mt-[2px] flex h-[28px] w-[28px] items-center justify-center rounded-[10px] bg-[#edf4ff] text-[#2d6ee5]">
                  <Sparkles className="h-[14px] w-[14px]" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-[#17305c]">What&apos;s Next?</p>
                  <p className="mt-[4px] text-[12px] leading-[1.4] text-[#5d7092]">
                    {hasReachedExplanationWatchLimit
                      ? nextLessonEntry
                        ? `Explanation is complete. Continue with ${nextLessonEntry.lesson.title}.`
                        : 'Explanation is complete. Continue from the lesson list.'
                      : 'Watch the explanation video to understand the correct answers.'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                data-testid="course-player-watch-explanation"
                onClick={hasReachedExplanationWatchLimit
                  ? () => {
                    if (nextLessonEntry) {
                      openNextLesson();
                      return;
                    }
                    setScreen('course');
                  }
                  : openLessonExplanation}
                className="mt-[14px] inline-flex h-[40px] w-full items-center justify-center rounded-[8px] bg-[linear-gradient(180deg,#2f6ef0_0%,#2660e3_100%)] text-[13px] font-semibold text-white shadow-[0_12px_24px_rgba(45,110,229,0.2)]"
              >
                {hasReachedExplanationWatchLimit ? (nextLessonEntry ? 'Open Next Lesson' : 'Back to Lessons') : 'Watch Explanation'}
              </button>
            </div>

            <div className="mt-[14px] rounded-[16px] border border-[#e3ebf6] bg-[#eef4ff] px-[14px] py-[12px] text-[12px] text-[#4b658f]">
              <div className="flex items-center gap-[8px]">
                <div className="flex h-[18px] w-[18px] items-center justify-center rounded-full border border-[#2d6ee5] text-[11px] text-[#2d6ee5]">i</div>
                <p>{hasReachedExplanationWatchLimit ? 'Explanation watch limit reached for this lesson.' : 'You cannot retake this CBT.'}</p>
              </div>
            </div>
          </div>
        </section>
      );
    };

    const renderExplanationMobile = () => (
      <div className="space-y-[14px]">
        <section className="overflow-hidden rounded-[18px] border border-[#dbe4f3] bg-[#20314b] shadow-[0_12px_24px_rgba(54,78,123,0.08)]">
          <div className="relative min-h-[268px] bg-[#20314b]">
            <img alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover opacity-30" src={buildLessonArtwork(selectedLessonCopy.artwork)} />
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(15,25,40,0.14)_0%,rgba(15,25,40,0.78)_100%)]" />
            <div className="relative flex min-h-[268px] flex-col px-[18px] py-[18px] text-center text-white">
              <div className="flex flex-1 flex-col items-center justify-center">
                <p className="text-[16px] font-medium">CBT Explanation</p>
                <button
                  type="button"
                  data-testid="course-player-explanation-play"
                  onClick={() => {
                    setActiveLessonTab('Explanation');
                    setMobileLessonStageOverride('explanation');
                    setIsExplanationPlaying((current) => !current);
                  }}
                  className="mt-[14px] flex h-[60px] w-[60px] items-center justify-center rounded-full border border-white/28 bg-white/10 text-white backdrop-blur"
                >
                  {isExplanationPlaying ? <Pause className="h-[24px] w-[24px] fill-current" /> : <Play className="ml-[2px] h-[24px] w-[24px] fill-current" />}
                </button>
              </div>
              <div className="mt-auto rounded-[12px] bg-[linear-gradient(180deg,rgba(0,0,0,0.06)_0%,rgba(0,0,0,0.42)_100%)] px-[10px] py-[10px]">
                <div className="h-[4px] overflow-hidden rounded-full bg-white/24">
                  <div
                    className="h-full rounded-full bg-[#8db7ff]"
                    style={{ width: `${Math.min((explanationPlaybackSeconds / selectedLessonExplanationDurationSeconds) * 100, 100)}%` }}
                  />
                </div>
                <div className="mt-[8px] flex items-center justify-between text-[12px] text-white/86">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveLessonTab('Explanation');
                      setMobileLessonStageOverride('explanation');
                      setIsExplanationPlaying((current) => !current);
                    }}
                  >
                    {isExplanationPlaying ? <Pause className="h-[16px] w-[16px] fill-current" /> : <Play className="h-[16px] w-[16px] fill-current" />}
                  </button>
                  <span>{formatPlaybackTime(explanationPlaybackSeconds)} / {formatPlaybackTime(selectedLessonExplanationDurationSeconds)}</span>
                  <span>1x</span>
                  <Maximize2 className="h-[14px] w-[14px]" />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-[18px] border border-[#dbe4f3] bg-white px-[14px] py-[14px] shadow-[0_12px_24px_rgba(54,78,123,0.05)]">
          <p className="text-[16px] font-semibold text-[#17233f]">Explanation Summary</p>
          <p className="mt-[8px] text-[14px] leading-[1.52] text-[#5d7092]">
            In this video, we explain each question in detail with the correct concepts and solutions.
          </p>
        </section>

        <section className="rounded-[18px] border border-[#dbe4f3] bg-white px-[14px] py-[14px] shadow-[0_12px_24px_rgba(54,78,123,0.05)]">
          <p className="text-[14px] leading-[1.5] text-[#5d7092]">
            {autoplayCountdown !== null && nextLessonEntry
              ? `Starting ${nextLessonEntry.lesson.title} in ${autoplayCountdown}s.`
              : 'After watching, you can continue to the next lesson.'}
          </p>
          <button
            type="button"
            data-testid="course-player-continue-next-lesson"
            onClick={completeMobileLessonAndAdvance}
            disabled={explanationPlaybackSeconds < selectedLessonExplanationDurationSeconds || autoplayCountdown !== null}
            className={cn(
              'mt-[14px] inline-flex h-[42px] w-full items-center justify-center rounded-[8px] text-[14px] font-semibold transition',
              explanationPlaybackSeconds >= selectedLessonExplanationDurationSeconds && autoplayCountdown === null
                ? 'bg-[linear-gradient(180deg,#2f6ef0_0%,#2660e3_100%)] text-white shadow-[0_12px_24px_rgba(45,110,229,0.2)]'
                : 'cursor-not-allowed border border-[#dbe4f3] bg-[#eef3fb] text-[#90a4c3]',
            )}
          >
            {autoplayCountdown !== null ? 'Opening Next Lesson...' : 'Continue to Next Lesson'}
          </button>
        </section>
      </div>
    );

    const mobileContent = (() => {
      if (mobileMode === 'exam') {
        return renderExamCard();
      }
      if (mobileMode === 'exam-complete') {
        return renderExamCompleteCard();
      }
      if (mobileMode === 'explanation' || mobileMode === 'explanation-complete') {
        return renderExplanationMobile();
      }
      if (mobileMode === 'completed') {
        return renderCompletionCard();
      }
      return (
        <div className="space-y-[14px]">
          {renderWatchCard()}
          {renderMobileSupportTabs()}

          <section className="rounded-[16px] border border-[#dbe4f3] bg-white px-[13px] py-[11px] shadow-[0_12px_24px_rgba(54,78,123,0.04)]">
            <div className="flex items-center justify-between gap-[14px]">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-[#17233f]">Auto play next video</p>
                <p className="mt-[2px] text-[12px] leading-[1.42] text-[#5d7092]">
                  Automatically play the next video when the current one ends.
                </p>
              </div>
              <ToggleSwitch checked={autoplayEnabled} onToggle={() => setAutoplayEnabled((current) => !current)} testId="course-player-autoplay-toggle" />
            </div>
          </section>

          {nextStepDescriptor && renderNextStepCard('mobile')}

          <section className="rounded-[16px] border border-[#dbe4f3] bg-white px-[14px] py-[12px] shadow-[0_12px_24px_rgba(54,78,123,0.04)]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-[8px] text-[14px] font-semibold text-[#17233f]">
                <FileText className="h-[14px] w-[14px] text-[#7a90b7]" />
                <span>Lesson Playlist</span>
              </div>
            </div>
            <div className="mt-[12px] space-y-[8px]">
              {filteredCourseSections.map((section, index) => {
                const expanded = currentExpandedSections.includes(section.id);
                return (
                  <div key={section.id} className="overflow-hidden rounded-[14px] border border-[#e7edf7] bg-white">
                    <button
                      type="button"
                      onClick={() => toggleSection(section.id)}
                      className="flex h-[46px] w-full items-center justify-between px-[12px] text-left"
                    >
                      <div className="flex items-center gap-[6px] min-w-0">
                        <span className="truncate text-[14px] font-semibold text-[#1b2d50]">{section.label}:</span>
                        <span className="truncate text-[14px] text-[#44597f]">{section.title}</span>
                      </div>
                      <ChevronDown className={cn('h-[14px] w-[14px] shrink-0 text-[#7a8eae] transition', expanded ? 'rotate-180' : '')} />
                    </button>
                    {expanded && (
                      <div className={cn(index === 0 ? 'border-l-[4px] border-l-[#4a8ef5]' : 'border-l-[4px] border-l-transparent')}>
                        {section.lessons.map((entry) => {
                          const completed = Boolean(selectedCourseProgressMap.get(entry.lesson.id)?.completed);
                          const unlocked = Boolean(unlockMap.get(entry.lesson.id)?.unlocked);
                          const active = selectedLessonEntry?.lesson.id === entry.lesson.id;
                          return (
                            <button
                              key={entry.lesson.id}
                              type="button"
                              onClick={() => unlocked && openLesson(entry.lesson.id)}
                              className={cn(
                                'flex w-full items-center gap-[10px] px-[10px] py-[12px] text-left',
                                active ? 'bg-[linear-gradient(90deg,rgba(64,125,233,0.09)_0%,rgba(255,255,255,0.98)_100%)]' : 'bg-white',
                              )}
                            >
                              <div className="flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-full border border-[#d1ddf4] bg-[#eef3fe] text-[#7092c8]">
                                {unlocked ? <Play className="ml-[1px] h-[14px] w-[14px] fill-current" /> : <Lock className="h-[12px] w-[12px]" />}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className={cn('truncate text-[13px] leading-[1.18]', active ? 'font-medium text-[#1b49d6]' : 'text-[#23385f]')}>
                                  {entry.lesson.title}
                                </p>
                                <p className="mt-[3px] text-[12px] text-[#6e80a1]">{formatDurationLabel(entry.lesson.durationMinutes)}</p>
                              </div>
                              {completed ? (
                                <CheckCircle2 className="h-[15px] w-[15px] shrink-0 text-[#26c085]" />
                              ) : !unlocked ? (
                                <Lock className="h-[13px] w-[13px] shrink-0 text-[#8fa2c3]" />
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

        </div>
      );
    })();

    return (
      <div
        data-testid="course-figma-page"
        data-course-view="lesson"
        className="h-[100dvh] overflow-y-auto bg-[linear-gradient(180deg,#f9fbff_0%,#eef3ff_100%)]"
      >
        <div className="px-[13px] pt-[12px]">
          <div className="flex items-center justify-between text-[12px] font-semibold text-[#111827]">
            <span>9:41</span>
            <div className="flex items-center gap-[5px] text-[#111827]">
              <span className="h-[7px] w-[10px] rounded-[2px] bg-[#111827]" />
              <span className="h-[7px] w-[7px] rounded-full border border-[#111827]" />
              <span className="h-[7px] w-[20px] rounded-full border border-[#111827]" />
            </div>
          </div>

          <div className="mt-[12px] flex items-center justify-between gap-[10px]">
            <button
              type="button"
              data-testid="course-back-to-lessons"
              onClick={() => setScreen('course')}
              className="flex h-[30px] w-[30px] items-center justify-center text-[#17233f]"
            >
              <ChevronLeft className="h-[22px] w-[22px]" />
            </button>
            <h1 data-testid="course-player-heading" className="max-w-[214px] text-center text-[15px] font-semibold leading-[1.18] tracking-[-0.02em] text-[#17233f]">
              {selectedLessonEntry?.lesson.title}
            </h1>
            <button
              type="button"
              data-testid="course-player-bookmark"
              onClick={() => selectedCourse && selectedLessonEntry && onToggleSavedTopic(selectedCourse._id, selectedLessonEntry.lesson.id)}
              className="flex h-[30px] w-[30px] items-center justify-center text-[#2d6ee5]"
            >
              <Bookmark className={cn('h-[18px] w-[18px]', selectedLessonSaved && 'fill-current')} />
            </button>
          </div>
        </div>

        <div className="mt-[12px] px-[14px]">
          {renderMobileVideoPill()}
        </div>

        <div className="border-t border-[#e8edf7] px-[14px] py-[14px]">
          {mobileContent}
        </div>
      </div>
    );
  };

  const renderLessonView = () => {
    if (isMobileLayout) {
      return renderMobileLessonView();
    }

    return (
    <div
      data-testid="course-figma-page"
      data-course-view="lesson"
      className="overflow-hidden rounded-[30px] border border-white/70 bg-[linear-gradient(180deg,#f9fbff_0%,#eef3ff_100%)] shadow-[0_30px_90px_rgba(33,51,97,0.13)]"
    >
      <header className="flex flex-col gap-[18px] border-b border-[#dde5f5] bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] px-[24px] py-[20px] xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-center gap-[10px] text-[15px] text-[#5e7397]">
          <button type="button" onClick={() => setScreen('course')} className="flex items-center gap-[10px]">
            <ChevronLeft className="h-[18px] w-[18px]" />
          </button>
          <span>{breadcrumbLabel}</span>
        </div>
        <HeaderTools
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          placeholder="Search playlist..."
          userName={userName}
          notificationCount={notificationCount}
        />
      </header>

      <div className="grid gap-[18px] px-[24px] py-[20px] xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <div className="flex flex-col gap-[16px]">
            <div className="flex flex-col gap-[12px] xl:flex-row xl:items-center xl:justify-between">
              <h1 data-testid="course-player-heading" className="text-[24px] font-semibold tracking-[-0.03em] text-[#1c2d4c]">
                {selectedLessonEntry?.lesson.title}
              </h1>
            </div>

            <div className="flex flex-col gap-[12px] border-b border-[#e0e8f6] pb-[12px] xl:flex-row xl:items-end xl:justify-between">
              <div className="flex items-center gap-[10px]">
                <button
                  type="button"
                  data-testid="course-player-tab-video"
                  onClick={() => handleLessonTabSelect('Video')}
                  className={cn(
                    'relative inline-flex items-center rounded-full px-[12px] py-[8px] text-[15px] transition',
                    activeLessonTab === 'Video'
                      ? 'bg-[#e8f0ff] font-semibold text-[#1b49d6]'
                      : 'border border-[#dbe4f3] bg-white font-medium text-[#4c6086]',
                  )}
                >
                  Video
                  {activeLessonTab === 'Video' && <span className="absolute bottom-0 left-[10px] right-[10px] h-[3px] rounded-full bg-[#3c83ef]" />}
                </button>
                <span className="text-[13px] text-[#6d7c93]">
                  {hasReachedLessonVideoWatchLimit ? 'Video limit reached' : canRewatchLessonVideo ? 'Rewatch available' : 'Video lesson'}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-[12px]">
                <button
                  type="button"
                  data-testid="course-player-mark-complete"
                  onClick={handlePrimaryLessonAction}
                  disabled={primaryLessonActionDisabled}
                  className={cn(
                    'inline-flex h-[40px] items-center gap-[8px] rounded-[12px] border px-[16px] text-[15px] font-medium transition',
                    primaryLessonActionDisabled
                      ? 'cursor-not-allowed border-[#dbe4f3] bg-[#f2f6fd] text-[#90a4c3]'
                      : 'border-[#dbe4f3] bg-[#ffffff] text-[#2d6ee5]',
                  )}
                >
                  <ClipboardCheck className="h-[16px] w-[16px]" />
                  {primaryLessonActionLabel}
                </button>
                <button
                  type="button"
                  data-testid="course-player-bookmark"
                  onClick={() => selectedCourse && selectedLessonEntry && onToggleSavedTopic(selectedCourse._id, selectedLessonEntry.lesson.id)}
                  className="flex h-[40px] w-[40px] items-center justify-center rounded-[12px] border border-[#dbe4f3] bg-white text-[#2d6ee5]"
                >
                  <Bookmark className={cn('h-[18px] w-[18px]', selectedLessonSaved && 'fill-current')} />
                </button>
              </div>
            </div>

            {activeLessonTab === 'Video' && renderVideoPanel()}
            {activeLessonTab === 'CBT Exam' && renderQuizPanel()}
            {activeLessonTab === 'Explanation' && renderExplanationPanel()}
          </div>
        </div>

        <aside className="space-y-[12px]">
          <button
            type="button"
            data-testid="course-back-to-lessons"
            onClick={() => setScreen('course')}
            className="inline-flex items-center gap-[8px] rounded-[12px] bg-[#eef4ff] px-[16px] py-[12px] text-[15px] font-medium text-[#2d6ee5]"
          >
            <ChevronLeft className="h-[16px] w-[16px]" />
            Back to Lessons
          </button>

          <section className="rounded-[22px] bg-white px-[18px] py-[16px] shadow-[0_16px_34px_rgba(54,78,123,0.08)]">
            <p className="text-[16px] font-medium text-[#1c2d4c]">Course Progress</p>
            <div className="mt-[16px]">
              <ProgressDonut percent={selectedCourseSnapshot.progressPercent} title="Completed" testId="course-progress-percent" />
            </div>
            <div className="mt-[14px] grid grid-cols-2 gap-y-[8px] text-[14px] text-[#5d7092]">
              <span data-testid="course-progress-lessons-completed">{selectedCourseVideoCompletedDisplayCount} Lessons Completed</span>
              <span>{selectedCourseExamAttempts} CBT Done</span>
              <span>{Math.max(selectedCourseEntries.length - selectedCourseExamAttempts, 0)} CBT Left</span>
              <span className="text-[#7a90b7]">{selectedCourseSnapshot.totalLessons} Total</span>
            </div>
          </section>

          <section className="rounded-[22px] bg-white px-[18px] py-[16px] shadow-[0_16px_34px_rgba(54,78,123,0.08)]">
            <div className="flex items-center justify-between gap-[12px]">
              <div>
                <p className="text-[16px] font-medium text-[#1c2d4c]">Auto play next video</p>
                <p className="mt-[6px] text-[14px] leading-[1.45] text-[#5d7092]">Automatically play the next lesson when the current one ends.</p>
              </div>
              <ToggleSwitch checked={autoplayEnabled} onToggle={() => setAutoplayEnabled((current) => !current)} testId="course-player-autoplay-toggle" />
            </div>
          </section>

          {nextStepDescriptor && renderNextStepCard('desktop')}

          <section className="rounded-[22px] bg-white px-[14px] py-[14px] shadow-[0_16px_34px_rgba(54,78,123,0.08)]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-[8px] text-[16px] font-medium text-[#1c2d4c]">
                <FileText className="h-[16px] w-[16px] text-[#7a90b7]" />
                <span>Lesson Playlist</span>
              </div>
            </div>
            <div className="mt-[12px] space-y-[8px]">
              {filteredCourseSections.map((section, index) => {
                const expanded = currentExpandedSections.includes(section.id);
                return (
                  <div key={section.id} className="overflow-hidden rounded-[16px] border border-[#e7edf7]">
                    <button
                      type="button"
                      onClick={() => toggleSection(section.id)}
                      className="flex h-[48px] w-full items-center justify-between px-[12px] text-left"
                    >
                      <div className="flex items-center gap-[6px]">
                        <span className="text-[15px] font-semibold text-[#1b2d50]">{section.label}:</span>
                        <span className="text-[15px] text-[#44597f]">{section.title}</span>
                      </div>
                      <ChevronDown className={cn('h-[16px] w-[16px] text-[#7a8eae] transition', expanded ? 'rotate-180' : '')} />
                    </button>
                    {expanded && (
                      <div className={cn(index === 0 ? 'border-l-[4px] border-l-[#4a8ef5]' : 'border-l-[4px] border-l-transparent')}>
                        {section.lessons.map((entry) => {
                          const completed = Boolean(selectedCourseProgressMap.get(entry.lesson.id)?.completed);
                          const unlocked = Boolean(unlockMap.get(entry.lesson.id)?.unlocked);
                          return (
                            <button
                              key={entry.lesson.id}
                              type="button"
                              onClick={() => unlocked && openLesson(entry.lesson.id)}
                              className={cn(
                                'flex w-full items-center gap-[10px] px-[10px] py-[10px] text-left',
                                selectedLessonEntry?.lesson.id === entry.lesson.id ? 'bg-[linear-gradient(90deg,rgba(64,125,233,0.09)_0%,rgba(255,255,255,0.96)_100%)]' : 'bg-white',
                              )}
                            >
                              <div className="flex h-[30px] w-[30px] items-center justify-center rounded-full border border-[#d1ddf4] bg-[#eef3fe] text-[#7092c8]">
                                {unlocked ? <Play className="ml-[1px] h-[15px] w-[15px] fill-current" /> : <Lock className="h-[13px] w-[13px]" />}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className={cn('truncate text-[14px] leading-[1.15]', selectedLessonEntry?.lesson.id === entry.lesson.id ? 'font-medium text-[#1b49d6]' : 'text-[#23385f]')}>
                                  {entry.lesson.title}
                                </p>
                                <p className="mt-[4px] text-[12px] text-[#6e80a1]">{formatDurationLabel(entry.lesson.durationMinutes)}</p>
                              </div>
                              {completed ? (
                                <CheckCircle2 className="h-[16px] w-[16px] shrink-0 text-[#26c085]" />
                              ) : !unlocked ? (
                                <Lock className="h-[14px] w-[14px] shrink-0 text-[#8fa2c3]" />
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

        </aside>
      </div>
    </div>
    );
  };

  return (
    <div className="w-full bg-[#d7def1] p-[14px] lg:p-[18px]" style={uiFontStyle}>
      <div className="mx-auto w-full max-w-[1440px]">
        {screen === 'catalog' && renderCatalogView()}
        {screen === 'course' && selectedCourse && renderCourseView()}
        {screen === 'lesson' && selectedCourse && selectedLessonEntry && renderLessonView()}
      </div>
    </div>
  );
};
