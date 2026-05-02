import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BellRing,
  BookOpen,
  Bot,
  Brain,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Expand,
  Flame,
  Gauge,
  GraduationCap,
  LayoutDashboard,
  LifeBuoy,
  LoaderCircle,
  Lock,
  LogOut,
  Mic,
  MicOff,
  MessageSquare,
  MoreHorizontal,
  Pause,
  PlayCircle,
  Radio,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Target,
  Trophy,
  UserCircle2,
  Video,
  Wallet,
  X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AuthProvider, useAuth } from './AuthContext';
import { BrandLogo } from './components/BrandLogo';
import { CourseFigmaTab } from './components/CourseFigmaTab';
import { OverviewFigmaTab } from './components/OverviewFigmaTab';
import { TestSeriesFigmaTab } from './components/TestSeriesFigmaTab';
import { LiveClassesFigmaTab } from './components/LiveClassesFigmaTab';
import { ApiRequestError, EduService } from './EduService';
import { AdminCourseManager } from './components/AdminCourseManager';
import { AdminModuleManager } from './components/AdminModuleManager';
import { AdminVideoUpload } from './components/AdminVideoUpload';
import Hls from 'hls.js';
import {
  AiResponse,
  DailyQuizResult,
  MockTest,
  NotificationItem,
  PlatformOverview,
  ProtectedLessonPlayback,
  RegisterPayload,
  SavedTopic,
  TestAttemptResult,
} from './types';
import { cn } from './lib/utils';

type TabKey = 'overview' | 'courses' | 'live' | 'tests' | 'quiz' | 'revision' | 'analytics' | 'admin';

const currency = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

const tabs: { id: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'courses', label: 'All Courses', icon: BookOpen },
  { id: 'live', label: 'Live Classes', icon: Radio },
  { id: 'tests', label: 'Mock Tests', icon: ClipboardCheck },
  { id: 'quiz', label: 'Daily Quiz', icon: Sparkles },
  { id: 'revision', label: 'Revision', icon: Brain },
  { id: 'analytics', label: 'Analytics', icon: Gauge },
  { id: 'admin', label: 'Admin', icon: ShieldCheck },
];

const mobilePrimaryTabIds: TabKey[] = ['overview', 'courses', 'live', 'tests'];

const shellTabMeta: Record<TabKey, { eyebrow: string; title: string; description: string }> = {
  overview: {
    eyebrow: 'Overview',
    title: 'Your dashboard',
    description: 'Continue your prep with less noise.',
  },
  courses: {
    eyebrow: 'Courses workspace',
    title: 'Study without losing context',
    description: 'Move from subject selection to lesson playback with less scrolling, less noise, and faster recovery.',
  },
  live: {
    eyebrow: 'Live classes',
    title: 'Join the classroom the moment it starts',
    description: 'Live sessions, waiting rooms, classroom controls, chat, and participant sync now stay inside one connected flow.',
  },
  tests: {
    eyebrow: 'Practice zone',
    title: 'Attempt mocks with a cleaner runway',
    description: 'Keep timed practice, review, and progress signals focused so the test flow feels intentional.',
  },
  quiz: {
    eyebrow: 'Daily quiz',
    title: 'Protect the streak with a quick win',
    description: 'Open the daily quiz, finish it fast, and keep the streak visible without crowding the workspace.',
  },
  revision: {
    eyebrow: 'Revision center',
    title: 'Turn saved lessons into repeatable revision',
    description: 'Weak topics, saved lessons, and mistake recovery should feel like one connected workflow.',
  },
  analytics: {
    eyebrow: 'Progress analytics',
    title: 'Read performance without dashboard fatigue',
    description: 'Important trends should stand out first so students can act on them instead of decoding the screen.',
  },
  admin: {
    eyebrow: 'Admin',
    title: 'Administration',
    description: 'Manage platform content and operations.',
  },
};

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));

const formatTimeLeft = (seconds: number) => {
  const minutes = Math.max(Math.floor(seconds / 60), 0);
  const remainingSeconds = Math.max(seconds % 60, 0);
  return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
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

const CBT_BRAND_NAME = 'VARONENGLISH';
const LIVE_FONT_STACK = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const getInitials = (value: string) =>
  value
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('') || 'VE';

const TeacherAvatar = ({ initials = 'RS' }: { initials?: string }) => (
  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[linear-gradient(180deg,#d8edf9_0%,#5fb7d8_100%)] text-[12px] font-semibold text-white shadow-[0_8px_20px_rgba(14,27,42,0.08)]">
    {initials}
  </div>
);

const buildSavedTopicsKey = (userId: string) => `edumaster.saved-topics.${userId}`;

const flattenCourseLessons = (course: PlatformOverview['courses'][number]) =>
  (course.modules || []).flatMap((module) => ([
    ...(module.lessons || []).map((lesson) => ({
      lesson,
      moduleTitle: module.title,
      chapterTitle: null as string | null,
    })),
    ...((module.chapters || []).flatMap((chapter) =>
      (chapter.lessons || []).map((lesson) => ({
        lesson,
        moduleTitle: module.title,
        chapterTitle: chapter.title,
      })))),
  ]));

const formatEventLabel = (eventType: string) =>
  eventType
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const formatShortDate = (value: Date | string) =>
  new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
  }).format(typeof value === 'string' ? new Date(value) : value);

const formatSessionLastUsed = (value?: string | null) => {
  if (!value) {
    return 'Recently active';
  }

  const target = new Date(value);
  if (Number.isNaN(target.getTime())) {
    return 'Recently active';
  }

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTarget = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const diffDays = Math.round((startOfToday.getTime() - startOfTarget.getTime()) / (24 * 60 * 60 * 1000));

  if (diffDays <= 0) {
    return 'Today';
  }

  if (diffDays === 1) {
    return 'Yesterday';
  }

  return `${diffDays} days ago`;
};

const getSessionDeviceIcon = (deviceLabel: string) => {
  const normalized = String(deviceLabel || '').toLowerCase();
  if (normalized.includes('iphone') || normalized.includes('android') || normalized.includes('mobile') || normalized.includes('phone')) {
    return Radio;
  }
  return LayoutDashboard;
};

const buildCourseFallbackArtwork = (title: string) => {
  const safeTitle = String(title || 'VARONENGLISH Course').slice(0, 28);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240" fill="none">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="320" y2="240" gradientUnits="userSpaceOnUse">
          <stop stop-color="#17385d"/>
          <stop offset="1" stop-color="#1b8cb6"/>
        </linearGradient>
      </defs>
      <rect width="320" height="240" rx="28" fill="url(#g)"/>
      <circle cx="250" cy="64" r="42" fill="rgba(255,255,255,0.12)"/>
      <circle cx="78" cy="178" r="56" fill="rgba(255,255,255,0.08)"/>
      <text x="28" y="168" fill="#ffffff" font-size="28" font-family="Georgia, serif" font-weight="700">${safeTitle}</text>
      <text x="28" y="204" fill="rgba(255,255,255,0.72)" font-size="14" font-family="Arial, sans-serif">VARONENGLISH course</text>
    </svg>
  `.trim();
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
};

const formatLargeMetric = (value: number) =>
  new Intl.NumberFormat('en-IN').format(Math.max(Math.round(value || 0), 0));

const buildInitials = (value: string) =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('') || 'VE';

const buildStudyArtwork = (label: string) => {
  const safeLabel = String(label || 'Study').slice(0, 18);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="280" height="180" viewBox="0 0 280 180" fill="none">
      <defs>
        <linearGradient id="bg" x1="16" y1="14" x2="252" y2="170" gradientUnits="userSpaceOnUse">
          <stop stop-color="#7dd1ff"/>
          <stop offset="0.55" stop-color="#6bb0ff"/>
          <stop offset="1" stop-color="#243e7a"/>
        </linearGradient>
        <radialGradient id="sun" cx="0" cy="0" r="1" gradientTransform="translate(168 84) rotate(90) scale(66)">
          <stop stop-color="#fff6b2"/>
          <stop offset="1" stop-color="#fff6b2" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="280" height="180" rx="28" fill="url(#bg)"/>
      <rect x="0" y="120" width="280" height="60" rx="0" fill="#7cb889"/>
      <rect x="0" y="136" width="280" height="44" rx="0" fill="#527d63"/>
      <circle cx="168" cy="84" r="64" fill="url(#sun)"/>
      <path d="M165 124c7-17 7-33 0-50 14 16 20 33 15 51 11-12 16-27 16-43 8 17 7 36-6 58 10-5 17-14 21-24-3 23-18 41-46 54-31-15-43-35-38-60 5 11 13 20 23 28-11-17-15-35-10-52 3 15 9 28 18 38 1-15 3-29 7-41z" fill="#fff1a1"/>
      <text x="18" y="28" fill="rgba(255,255,255,0.82)" font-size="14" font-family="Arial, sans-serif">${safeLabel}</text>
    </svg>
  `.trim();
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
};

const buildCoachPortraitArtwork = (name: string) => {
  const safeName = String(name || 'Tutor').slice(0, 18);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180" fill="none">
      <defs>
        <linearGradient id="bg" x1="20" y1="12" x2="154" y2="166" gradientUnits="userSpaceOnUse">
          <stop stop-color="#dff4ff"/>
          <stop offset="1" stop-color="#83c9ff"/>
        </linearGradient>
      </defs>
      <rect width="180" height="180" rx="34" fill="url(#bg)"/>
      <circle cx="90" cy="72" r="30" fill="#f5c29b"/>
      <path d="M58 64c2-22 16-34 32-34 14 0 28 11 33 27-11-8-20-10-33-10-12 0-22 6-32 17z" fill="#244070"/>
      <path d="M49 154c7-28 23-41 41-41 20 0 36 14 41 41" fill="#2b4c85"/>
      <path d="M66 118l24 18 24-18" stroke="#ffffff" stroke-width="6" stroke-linecap="round"/>
      <text x="90" y="168" fill="rgba(20,46,86,0.7)" font-size="12" font-family="Arial, sans-serif" text-anchor="middle">${safeName}</text>
    </svg>
  `.trim();
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
};

type SearchTarget =
  | { id: string; kind: 'course'; title: string; subtitle: string; tab: TabKey; courseId: string; lessonId?: string | null }
  | { id: string; kind: 'lesson'; title: string; subtitle: string; tab: TabKey; courseId: string; lessonId: string }
  | { id: string; kind: 'test'; title: string; subtitle: string; tab: TabKey }
  | { id: string; kind: 'saved'; title: string; subtitle: string; tab: TabKey; courseId: string; lessonId: string };

type RevisionDayPlan = {
  dateLabel: string;
  title: string;
  summary: string;
  actions: string[];
};

const searchKindLabels: Record<SearchTarget['kind'], string> = {
  course: 'Course',
  lesson: 'Lesson',
  test: 'Mock test',
  saved: 'Saved topic',
};

const getNotificationNavigationTarget = (_notification: NotificationItem) => null;

const HeaderInsightCard = ({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
}) => (
  <div className="rounded-[26px] border border-white/72 bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(246,250,255,0.94)_100%)] p-4 shadow-[0_20px_48px_rgba(15,23,42,0.08)]">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--ink-soft)]">{label}</p>
        <p className="mt-2 line-clamp-2 text-sm font-semibold leading-6 text-[var(--ink)] sm:text-base">{value}</p>
      </div>
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,var(--accent-cream)_0%,#ffffff_100%)] text-[var(--accent-rust)] shadow-[0_12px_28px_rgba(22,152,212,0.16)] ring-1 ring-white/90">
        <Icon className="h-5 w-5" />
      </div>
    </div>
    <p className="mt-3 text-xs leading-6 text-[var(--ink-soft)]/95">{hint}</p>
  </div>
);

const SearchPanel = ({
  open,
  query,
  results,
  onSelect,
  onClose,
}: {
  open: boolean;
  query: string;
  results: SearchTarget[];
  onSelect: (target: SearchTarget) => void;
  onClose: () => void;
}) => (
  <AnimatePresence>
    {open && (
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="absolute left-0 right-0 top-[calc(100%+12px)] z-40 overflow-hidden rounded-[30px] border border-white/72 bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(246,250,255,0.96)_100%)] shadow-[0_32px_96px_rgba(15,23,42,0.16)] backdrop-blur"
      >
        <div className="border-b border-[var(--line)] bg-[linear-gradient(180deg,rgba(255,255,255,1)_0%,rgba(234,247,255,0.96)_100%)] px-4 py-4 sm:px-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--ink-soft)]">
                {query.trim() ? 'Search results' : 'Suggested shortcuts'}
              </p>
              <p className="mt-2 text-sm text-[var(--ink-soft)]">
                {query.trim()
                  ? `Jump to lessons, mocks, and saved topics from one place.`
                  : 'Start with the current lesson, a saved topic, or your next practice task.'}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--line)] bg-white text-[var(--ink-soft)] transition hover:border-[var(--accent-rust)]/30 hover:bg-[var(--accent-cream)] hover:text-[var(--ink)]"
              aria-label="Close search"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="max-h-[min(68vh,34rem)] overflow-y-auto px-3 py-3 sm:px-4">
          {results.length > 0 ? (
            <div className="space-y-2">
              {results.map((target) => (
                <button
                  key={target.id}
                  data-testid={`search-result-${target.kind}`}
                  onClick={() => onSelect(target)}
                  className="flex w-full items-start justify-between gap-4 rounded-[22px] border border-transparent px-4 py-4 text-left transition hover:border-[var(--accent-rust)]/16 hover:bg-[linear-gradient(180deg,#ffffff_0%,var(--accent-cream)_100%)]"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-[var(--accent-cream)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--accent-rust)]">
                        {searchKindLabels[target.kind]}
                      </span>
                    </div>
                    <p className="mt-3 text-sm font-semibold text-[var(--ink)] sm:text-base">{target.title}</p>
                    <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">{target.subtitle}</p>
                  </div>
                  <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,var(--accent-cream)_0%,#ffffff_100%)] text-[var(--accent-rust)] shadow-[0_10px_24px_rgba(22,152,212,0.12)]">
                    <ArrowRight className="h-4 w-4" />
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-[24px] border border-dashed border-[var(--line)] px-5 py-6 text-sm leading-7 text-[var(--ink-soft)]">
              No matching items. Try an exam name, lesson topic, or mock title.
            </div>
          )}
        </div>
      </motion.div>
    )}
  </AnimatePresence>
);

const MobileMoreSheet = ({
  open,
  tabs,
  activeTab,
  onSelect,
  onClose,
  onLogout,
}: {
  open: boolean;
  tabs: { id: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }[];
  activeTab: TabKey;
  onSelect: (tab: TabKey) => void;
  onClose: () => void;
  onLogout: () => Promise<void>;
}) => (
  <AnimatePresence>
    {open && (
      <>
        <motion.button
          type="button"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-40 bg-slate-950/32 backdrop-blur-[3px] lg:hidden"
          aria-label="Close more menu"
        />
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 18 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className="fixed inset-x-3 bottom-24 z-50 rounded-[32px] border border-white/72 bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(245,250,255,0.95)_100%)] p-5 shadow-[0_28px_90px_rgba(15,23,42,0.24)] backdrop-blur lg:hidden"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--ink-soft)]">More destinations</p>
              <h2 className="mt-2 text-xl font-semibold text-[var(--ink)]">Open secondary tools without crowding the main nav</h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[var(--line)] bg-white text-[var(--ink-soft)] shadow-[0_8px_18px_rgba(15,23,42,0.05)]"
              aria-label="Close more menu"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-5 grid gap-3">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                data-testid={`mobile-more-${tab.id}`}
                onClick={() => onSelect(tab.id)}
                className={cn(
                  'flex w-full items-start justify-between gap-4 rounded-[24px] border px-4 py-4 text-left transition',
                  activeTab === tab.id
                    ? 'border-[var(--accent-rust)]/20 bg-[linear-gradient(180deg,#ffffff_0%,var(--accent-cream)_100%)] shadow-[0_16px_30px_rgba(22,152,212,0.10)]'
                    : 'border-[var(--line)] bg-white',
                )}
              >
                <div className="flex min-w-0 items-start gap-3">
                  <div className={cn(
                    'flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl',
                    activeTab === tab.id ? 'bg-white text-[var(--accent-rust)] shadow-[0_10px_22px_rgba(22,152,212,0.12)]' : 'bg-[var(--accent-cream)] text-[var(--ink-soft)]',
                  )}>
                    <tab.icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[var(--ink)]">{tab.label}</p>
                    <p className="mt-1 text-sm leading-6 text-[var(--ink-soft)]">{shellTabMeta[tab.id].description}</p>
                  </div>
                </div>
                <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-[var(--ink-soft)]" />
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void onLogout()}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-[22px] border border-[var(--line)] bg-[var(--accent-cream)] px-4 py-3 text-sm font-semibold text-[var(--ink)]"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </motion.div>
      </>
    )}
  </AnimatePresence>
);

const SectionHeader = ({ title, caption, action }: { title: string; caption: string; action?: React.ReactNode }) => (
  <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--ink-soft)]/95">{caption}</p>
      <h2 className="mt-2 text-xl font-semibold leading-tight text-[var(--ink)] sm:text-2xl">{title}</h2>
    </div>
    {action}
  </div>
);

const SurfaceCard = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <div className={cn('overflow-hidden rounded-[30px] border border-white/72 bg-[linear-gradient(180deg,var(--surface-strong)_0%,rgba(244,249,255,0.94)_100%)] p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)] sm:p-6', className)}>
    {children}
  </div>
);

const MetricCard = ({
  title,
  value,
  hint,
  icon: Icon,
}: {
  title: string;
  value: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
}) => (
  <div className="rounded-[26px] border border-white/72 bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(244,249,255,0.94)_100%)] p-4 shadow-[0_20px_48px_rgba(15,23,42,0.09)] backdrop-blur sm:rounded-[28px] sm:p-5 sm:shadow-[0_24px_60px_rgba(15,23,42,0.09)]">
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm text-[var(--ink-soft)]">{title}</p>
        <p className="mt-2 text-2xl font-semibold text-[var(--ink)] sm:text-3xl">{value}</p>
      </div>
      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,var(--accent-cream)_0%,#ffffff_100%)] text-[var(--accent-rust)] shadow-[0_12px_24px_rgba(22,152,212,0.14)] sm:h-12 sm:w-12">
        <Icon className="h-5 w-5" />
      </div>
    </div>
    <p className="mt-3 text-xs leading-6 text-[var(--ink-soft)] sm:mt-4 sm:text-sm">{hint}</p>
  </div>
);

const LoadingShell = () => (
  <div className="min-h-screen bg-[var(--page-bg)]">
    <div className="flex min-h-screen">
      <aside className="hidden w-[306px] shrink-0 border-r border-white/50 bg-[linear-gradient(180deg,#142033_0%,#1b2942_100%)] px-5 py-6 lg:flex">
        <div className="w-full animate-pulse">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-2xl bg-white/10" />
            <div className="space-y-2">
              <div className="h-4 w-24 rounded-full bg-white/14" />
              <div className="h-3 w-20 rounded-full bg-white/10" />
            </div>
          </div>
          <div className="mt-8 rounded-[30px] border border-white/10 bg-white/8 p-5">
            <div className="h-3 w-24 rounded-full bg-white/10" />
            <div className="mt-4 flex items-center gap-3">
              <div className="h-12 w-12 rounded-2xl bg-white/12" />
              <div className="space-y-2">
                <div className="h-4 w-28 rounded-full bg-white/16" />
                <div className="h-3 w-16 rounded-full bg-white/10" />
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              {[0, 1].map((item) => (
                <div key={item} className="rounded-2xl bg-white/8 p-3">
                  <div className="h-3 w-12 rounded-full bg-white/10" />
                  <div className="mt-3 h-6 w-14 rounded-xl bg-white/14" />
                </div>
              ))}
            </div>
          </div>
          <div className="mt-8 space-y-3">
            {[0, 1, 2, 3, 4].map((item) => (
              <div key={item} className="h-12 rounded-[22px] bg-white/10" />
            ))}
          </div>
        </div>
      </aside>

      <div className="flex-1">
        <div className="border-b border-white/60 bg-[var(--page-bg)]/88 px-4 py-4 backdrop-blur-xl sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl animate-pulse">
            <div className="grid gap-4 xl:grid-cols-[1fr_620px]">
              <div>
                <div className="h-3 w-28 rounded-full bg-white/80" />
                <div className="mt-4 h-10 w-[380px] max-w-full rounded-3xl bg-white/90" />
                <div className="mt-4 h-4 w-[520px] max-w-full rounded-full bg-white/80" />
              </div>
              <div>
                <div className="h-14 rounded-[28px] bg-white/92" />
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  {[0, 1, 2].map((item) => (
                    <div key={item} className="rounded-[24px] bg-white/92 p-4">
                      <div className="h-3 w-16 rounded-full bg-[var(--accent-cream)]" />
                      <div className="mt-3 h-4 w-28 rounded-full bg-[var(--accent-cream)]" />
                      <div className="mt-3 h-3 w-full rounded-full bg-[var(--accent-cream)]" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="animate-pulse">
            <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
              <div className="rounded-[34px] bg-[var(--card-dark)]/95 p-8">
                <div className="h-4 w-32 rounded-full bg-white/15" />
                <div className="mt-5 h-12 w-full max-w-[560px] rounded-3xl bg-white/12" />
                <div className="mt-4 h-5 w-full max-w-[480px] rounded-2xl bg-white/10" />
                <div className="mt-8 grid gap-4 sm:grid-cols-3">
                  {[0, 1, 2].map((item) => (
                    <div key={item} className="rounded-[26px] bg-white/10 p-5">
                      <div className="h-3 w-20 rounded-full bg-white/18" />
                      <div className="mt-4 h-8 w-16 rounded-xl bg-white/18" />
                      <div className="mt-4 h-3 w-full rounded-full bg-white/12" />
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-[34px] bg-white/92 p-6">
                <div className="h-4 w-24 rounded-full bg-[var(--accent-cream)]" />
                <div className="mt-4 h-8 w-48 rounded-2xl bg-[var(--accent-cream)]" />
                <div className="mt-6 space-y-4">
                  {[0, 1, 2].map((item) => (
                    <div key={item} className="rounded-[24px] bg-[var(--accent-cream)] p-5">
                      <div className="h-4 w-32 rounded-full bg-white" />
                      <div className="mt-3 h-3 w-full rounded-full bg-white/80" />
                      <div className="mt-2 h-3 w-3/4 rounded-full bg-white/80" />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              {[0, 1].map((item) => (
                <div key={item} className="rounded-[30px] bg-white/92 p-6">
                  <div className="h-4 w-28 rounded-full bg-[var(--accent-cream)]" />
                  <div className="mt-5 space-y-4">
                    {[0, 1, 2].map((row) => (
                      <div key={row} className="rounded-[24px] bg-[var(--accent-cream)] p-5">
                        <div className="h-4 w-36 rounded-full bg-white" />
                        <div className="mt-3 h-3 w-full rounded-full bg-white/80" />
                        <div className="mt-2 h-3 w-4/5 rounded-full bg-white/80" />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
);

const ReviewToggleButton = ({
  open,
  onClick,
  label = 'Solution',
}: {
  open: boolean;
  onClick: () => void;
  label?: string;
}) => (
  <button
    onClick={onClick}
    className={cn(
      'inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition',
      open
        ? 'bg-[var(--ink)] text-white'
        : 'border border-[var(--line)] bg-white text-[var(--ink-soft)] hover:border-[var(--accent-rust)]/35',
    )}
  >
    {label}
    <ChevronRight className={cn('h-4 w-4 transition', open && 'rotate-90')} />
  </button>
);

const MockSolutionCard = ({
  solution,
  index,
  open,
  onToggle,
}: {
  solution: TestAttemptResult['solutions'][number];
  index: number;
  open: boolean;
  onToggle: () => void;
}) => {
  const status = solution.selectedOption === null
    ? 'skipped'
    : solution.selectedOption === solution.correctOption
      ? 'correct'
      : 'incorrect';

  return (
    <div className="rounded-[24px] border border-[var(--line)] bg-white p-4 shadow-[0_12px_40px_rgba(15,23,42,0.05)]">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-[var(--accent-cream)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-soft)]">
              Question {index + 1}
            </span>
            <span className={cn(
              'rounded-full px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em]',
              status === 'correct'
                ? 'bg-[var(--success-soft)] text-[var(--success)]'
                : status === 'incorrect'
                  ? 'bg-[var(--danger-soft)] text-[var(--danger)]'
                  : 'bg-slate-100 text-slate-500',
            )}>
              {status}
            </span>
            <span className="rounded-full border border-[var(--line)] px-3 py-2 text-xs text-[var(--ink-soft)]">
              {solution.topic}
            </span>
          </div>
          <p className="mt-3 text-base font-semibold leading-7 text-[var(--ink)]">{solution.questionText}</p>
          <p className="mt-3 text-sm text-[var(--ink-soft)]">
            Your answer: <span className="font-semibold text-[var(--ink)]">{solution.selectedOption === null ? 'Skipped' : String.fromCharCode(65 + solution.selectedOption)}</span>
            {' '}• Correct: <span className="font-semibold text-[var(--success)]">{String.fromCharCode(65 + solution.correctOption)}</span>
          </p>
        </div>
        <ReviewToggleButton open={open} onClick={onToggle} />
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0, y: -8 }}
            animate={{ opacity: 1, height: 'auto', y: 0 }}
            exit={{ opacity: 0, height: 0, y: -8 }}
            className="overflow-hidden"
          >
            <div className="mt-4 rounded-[20px] bg-[var(--accent-cream)] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ink-soft)]">AI explanation</p>
              <p className="mt-2 text-sm leading-7 text-[var(--ink-soft)]">{solution.explanation}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const QuizReviewCard = ({
  reviewItem,
  questionIndex,
  open,
  onToggle,
}: {
  reviewItem: DailyQuizResult['review'][number];
  questionIndex: number;
  open: boolean;
  onToggle: () => void;
}) => {
  const isCorrect = reviewItem.selectedAnswer && reviewItem.selectedAnswer === reviewItem.correctAnswer;
  const isSkipped = !reviewItem.selectedAnswer;

  return (
    <div className="mt-4 rounded-[20px] border border-[var(--line)] bg-white p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-[var(--accent-cream)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-soft)]">
              Review {questionIndex + 1}
            </span>
            <span className={cn(
              'rounded-full px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em]',
              isSkipped
                ? 'bg-slate-100 text-slate-500'
                : isCorrect
                  ? 'bg-[var(--success-soft)] text-[var(--success)]'
                  : 'bg-[var(--danger-soft)] text-[var(--danger)]',
            )}>
              {isSkipped ? 'skipped' : isCorrect ? 'correct' : 'incorrect'}
            </span>
            <span className="rounded-full border border-[var(--line)] px-3 py-2 text-xs text-[var(--ink-soft)]">
              {reviewItem.topic}
            </span>
          </div>
          <p className="mt-3 text-sm text-[var(--ink-soft)]">
            Your answer: <span className="font-semibold text-[var(--ink)]">{reviewItem.selectedAnswer || 'Skipped'}</span>
            {' '}• Correct: <span className="font-semibold text-[var(--success)]">{reviewItem.correctAnswer}</span>
          </p>
        </div>
        <ReviewToggleButton open={open} onClick={onToggle} />
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0, y: -8 }}
            animate={{ opacity: 1, height: 'auto', y: 0 }}
            exit={{ opacity: 0, height: 0, y: -8 }}
            className="overflow-hidden"
          >
            <div className="mt-4 rounded-[18px] bg-[var(--accent-cream)] p-4 text-sm text-[var(--ink-soft)]">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ink-soft)]">AI explanation</p>
              <p className="mt-2 leading-7">{reviewItem.explanation}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const AuthScreen = ({
  publicOverview,
}: {
  publicOverview: PlatformOverview | null;
}) => {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionConflict, setSessionConflict] = useState<{
    email: string;
    password: string;
    activeDevice: string;
    activeSessions: Array<{
      sessionId: string;
      device: string;
      lastSeenAt: string | null;
    }>;
    sessionLimit: number;
  } | null>(null);
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [registerForm, setRegisterForm] = useState<RegisterPayload>({
    name: '',
    email: '',
    password: '',
  });
  const authHighlights = [
    '1-device protected access',
    'Resume after restart',
    'Mock tests, analytics',
  ];
  const localAdminCredentials = {
    email: 'admin@local.edumaster',
    password: 'AdminChangeMe_2026',
  };
  const showLocalAdminHelper = import.meta.env.DEV
    || (typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname));

  const submitLogin = async (
    email = loginForm.email,
    password = loginForm.password,
    options?: { forceLogoutOtherSessions?: boolean },
  ) => {
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password, options);
      setSessionConflict(null);
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'SESSION_ACTIVE') {
        const activeDevice = typeof err.details?.activeDevice === 'string' ? err.details.activeDevice : 'another device';
        const activeSessions = Array.isArray(err.details?.activeSessions)
          ? err.details.activeSessions
            .map((session: any, index: number) => ({
              sessionId: typeof session?.sessionId === 'string' ? session.sessionId : `active-${index}`,
              device: typeof session?.device === 'string' ? session.device : activeDevice,
              lastSeenAt: typeof session?.lastSeenAt === 'string' ? session.lastSeenAt : null,
            }))
          : [{ sessionId: 'active-0', device: activeDevice, lastSeenAt: null }];
        setSessionConflict({
          email,
          password,
          activeDevice,
          activeSessions,
          sessionLimit: Number(err.details?.sessionLimit || 1),
        });
        return;
      }

      setError(err instanceof Error ? err.message : 'Unable to log in');
    } finally {
      setSubmitting(false);
    }
  };

  const submitRegister = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await register(registerForm);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create account');
    } finally {
      setSubmitting(false);
    }
  };

  const confirmTakeover = async () => {
    if (!sessionConflict) {
      return;
    }

    await submitLogin(sessionConflict.email, sessionConflict.password, { forceLogoutOtherSessions: true });
  };

  const fillLocalAdminLogin = () => {
    setMode('login');
    setError(null);
    setSessionConflict(null);
    setLoginForm(localAdminCredentials);
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#eef4ff] text-[#15264b]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(96,149,255,0.26),transparent_30%),radial-gradient(circle_at_82%_18%,rgba(64,196,255,0.18),transparent_20%),radial-gradient(circle_at_bottom_center,rgba(33,92,255,0.12),transparent_26%),linear-gradient(180deg,#eef4ff_0%,#f7fbff_46%,#eef5ff_100%)]" />
      <div className="absolute inset-0 opacity-50 [background-image:linear-gradient(rgba(87,118,170,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(87,118,170,0.08)_1px,transparent_1px)] [background-size:88px_88px]" />
      <div className="relative mx-auto flex min-h-screen max-w-7xl items-center justify-center px-3 py-4 sm:px-6 sm:py-8 lg:px-10">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-5xl overflow-hidden rounded-[28px] border border-[#d9e5f6] bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,251,255,0.98))] shadow-[0_24px_70px_rgba(58,89,138,0.14)] backdrop-blur-xl sm:rounded-[36px] sm:shadow-[0_34px_100px_rgba(58,89,138,0.16)]"
        >
          <div className="grid lg:grid-cols-[0.92fr_1.08fr]">
            <section className="relative overflow-hidden border-b border-[#e2ebf7] bg-[linear-gradient(160deg,#123a7b_0%,#1d5bcc_48%,#45baf2_100%)] p-4 text-white sm:p-8 lg:border-b-0 lg:border-r lg:border-[#d8e5f6] lg:p-10">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.18),transparent_32%),radial-gradient(circle_at_bottom_left,rgba(10,35,78,0.26),transparent_30%)]" />
              <div className="relative">
                <div className="flex flex-col gap-2">
                  <BrandLogo tone="dark" size="lg" showTagline />
                  <p className="text-xs text-white/76 sm:text-sm">SSC JE and RRB JE premium access</p>
                </div>

                <h1 className="mt-5 max-w-lg text-[27px] font-semibold leading-[1.08] tracking-[-0.03em] text-white sm:mt-10 sm:text-[52px]">
                  Login or sign up to continue
                </h1>
                <p className="mt-3 max-w-md text-[13px] leading-6 text-white/80 sm:mt-4 sm:text-base sm:leading-7">
                  Secure learner access with single-device protection, persistent sign-in, and quick entry to your prep dashboard.
                </p>

                <div className="mt-6 hidden rounded-[24px] border border-white/12 bg-white/10 p-4 shadow-[0_18px_34px_rgba(10,31,67,0.2)] sm:mt-8 sm:block sm:rounded-[28px] sm:p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-white/60">Why this feels premium</p>
                  <div className="mt-5 space-y-3">
                    {authHighlights.map((item) => (
                      <div key={item} className="flex items-center gap-3 text-sm text-white">
                        <CheckCircle2 className="h-4 w-4 text-[#bfe8ff]" />
                        {item}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <section className="relative bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] p-4 sm:p-8 lg:p-10">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#7a8faf]">Access Portal</p>
                  <p className="mt-2 text-[22px] font-semibold leading-[1.15] text-[#16264a] sm:mt-3 sm:text-2xl">{mode === 'login' ? 'Continue your preparation' : 'Create your learner account'}</p>
                </div>
                <div className="hidden rounded-2xl border border-[#dce7f6] bg-[#f4f8ff] p-3 sm:flex">
                  <LifeBuoy className="h-6 w-6 text-[#5878ad]" />
                </div>
              </div>

              <div className="mt-5 flex rounded-full border border-[#dce7f6] bg-[#eef4ff] p-1 sm:mt-7">
                {(['login', 'register'] as const).map((item) => (
                  <button
                    key={item}
                    onClick={() => {
                      setMode(item);
                      setError(null);
                      setSessionConflict(null);
                    }}
                    className={cn(
                      'flex-1 rounded-full px-3 py-2.5 text-[13px] font-semibold transition sm:px-4 sm:py-3 sm:text-sm',
                      mode === item
                        ? 'bg-[linear-gradient(90deg,#249bff,#3163ff)] text-white shadow-[0_12px_28px_rgba(49,99,255,0.24)]'
                        : 'text-[#6e84a7]',
                    )}
                  >
                    {item === 'login' ? 'Login' : 'Create account'}
                  </button>
                ))}
              </div>

              <div className="mt-6 sm:mt-8">
                {mode === 'login' ? (
                  <form
                    className="space-y-4 sm:space-y-5"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void submitLogin();
                    }}
                    >
                    <div>
                      <label className="text-[13px] font-medium text-[#526987] sm:text-sm">Email address</label>
                      <input
                        data-testid="auth-login-email"
                        value={loginForm.email}
                        onChange={(event) => setLoginForm((current) => ({ ...current, email: event.target.value }))}
                        className="mt-2 w-full rounded-[16px] border border-[#d9e5f6] bg-[#f7fbff] px-4 py-3.5 text-[15px] text-[#16264a] outline-none transition placeholder:text-[#97a8c1] focus:border-[#72a7ff] sm:rounded-[20px] sm:py-4"
                        placeholder="student@varonenglish.app"
                      />
                    </div>
                    <div>
                      <label className="text-[13px] font-medium text-[#526987] sm:text-sm">Password</label>
                      <input
                        data-testid="auth-login-password"
                        type="password"
                        value={loginForm.password}
                        onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))}
                        className="mt-2 w-full rounded-[16px] border border-[#d9e5f6] bg-[#f7fbff] px-4 py-3.5 text-[15px] text-[#16264a] outline-none transition placeholder:text-[#97a8c1] focus:border-[#72a7ff] sm:rounded-[20px] sm:py-4"
                        placeholder="Enter your password"
                      />
                    </div>
                    <button
                      data-testid="auth-login-submit"
                      type="submit"
                      disabled={submitting}
                      className="flex w-full items-center justify-center gap-2 rounded-[16px] bg-[linear-gradient(90deg,#249bff,#3163ff)] px-5 py-3.5 text-[15px] font-semibold text-white shadow-[0_18px_40px_rgba(49,99,255,0.26)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60 sm:rounded-[20px] sm:py-4"
                    >
                      {submitting ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <ArrowRight className="h-5 w-5" />}
                      Continue
                    </button>
                    {showLocalAdminHelper && (
                      <div className="rounded-[16px] border border-[#dce7f6] bg-[#f4f8ff] p-4 text-[13px] text-[#526987] sm:rounded-[20px] sm:text-sm">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="font-semibold text-[#16264a]">Local admin access</p>
                            <p className="mt-1">Use the seeded admin account to open the admin workspace and manage platform content.</p>
                            <p className="mt-2 font-mono text-[12px] text-[#41597d]">admin@local.edumaster / AdminChangeMe_2026</p>
                          </div>
                          <button
                            type="button"
                            onClick={fillLocalAdminLogin}
                            className="rounded-[14px] border border-[#cfe0fb] bg-white px-4 py-2.5 text-[13px] font-semibold text-[#2458c7] shadow-[0_8px_18px_rgba(49,99,255,0.08)]"
                          >
                            Use admin login
                          </button>
                        </div>
                      </div>
                    )}
                  </form>
                ) : (
                  <form
                    className="space-y-4 sm:space-y-5"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void submitRegister();
                    }}
                    >
                    <div>
                      <label className="text-[13px] font-medium text-[#526987] sm:text-sm">Full name</label>
                      <input
                        data-testid="auth-register-name"
                        value={registerForm.name}
                        onChange={(event) => setRegisterForm((current) => ({ ...current, name: event.target.value }))}
                        className="mt-2 w-full rounded-[16px] border border-[#d9e5f6] bg-[#f7fbff] px-4 py-3.5 text-[15px] text-[#16264a] outline-none transition placeholder:text-[#97a8c1] focus:border-[#72a7ff] sm:rounded-[20px] sm:py-4"
                        placeholder="Aspirant name"
                      />
                    </div>
                    <div>
                      <label className="text-[13px] font-medium text-[#526987] sm:text-sm">Email address</label>
                      <input
                        data-testid="auth-register-email"
                        value={registerForm.email}
                        onChange={(event) => setRegisterForm((current) => ({ ...current, email: event.target.value }))}
                        className="mt-2 w-full rounded-[16px] border border-[#d9e5f6] bg-[#f7fbff] px-4 py-3.5 text-[15px] text-[#16264a] outline-none transition placeholder:text-[#97a8c1] focus:border-[#72a7ff] sm:rounded-[20px] sm:py-4"
                        placeholder="you@example.com"
                      />
                    </div>
                    <div>
                      <label className="text-[13px] font-medium text-[#526987] sm:text-sm">Password</label>
                      <input
                        data-testid="auth-register-password"
                        type="password"
                        value={registerForm.password}
                        onChange={(event) => setRegisterForm((current) => ({ ...current, password: event.target.value }))}
                        className="mt-2 w-full rounded-[16px] border border-[#d9e5f6] bg-[#f7fbff] px-4 py-3.5 text-[15px] text-[#16264a] outline-none transition placeholder:text-[#97a8c1] focus:border-[#72a7ff] sm:rounded-[20px] sm:py-4"
                        placeholder="Create a strong password"
                      />
                    </div>
                    <button
                      data-testid="auth-register-submit"
                      type="submit"
                      disabled={submitting}
                      className="flex w-full items-center justify-center gap-2 rounded-[16px] bg-[linear-gradient(90deg,#1e88ff,#29b8f4)] px-5 py-3.5 text-[15px] font-semibold text-white shadow-[0_18px_40px_rgba(41,132,255,0.24)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60 sm:rounded-[20px] sm:py-4"
                    >
                      {submitting ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <GraduationCap className="h-5 w-5" />}
                      Create account
                    </button>
                  </form>
                )}

                {error && (
                  <div className="mt-4 rounded-[16px] border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700 sm:mt-5 sm:rounded-[20px] sm:py-4 sm:text-sm">
                    {error}
                  </div>
                )}

                <div className="mt-5 rounded-[18px] border border-[#dce7f6] bg-[#f4f8ff] p-4 sm:mt-7 sm:rounded-[24px] sm:p-5">
                  <p className="text-[13px] font-semibold text-[#16264a] sm:text-sm">Session behavior</p>
                  <div className="mt-3 space-y-3 text-[13px] text-[#5e7294] sm:mt-4 sm:text-sm">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 text-[#29a86a]" />
                      Stay logged in after refresh or PC restart.
                    </div>
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 text-[#29a86a]" />
                      If your account is active elsewhere, we show a takeover screen before login continues.
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </motion.div>
      </div>

      <AnimatePresence>
        {sessionConflict && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-30 bg-[#0b0d14] text-white"
          >
            <div className="mx-auto flex min-h-screen w-full max-w-[460px] flex-col px-6 pb-8 pt-10 sm:max-w-[520px] sm:px-8">
              <motion.div
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 16 }}
                className="flex min-h-full flex-col"
              >
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setSessionConflict(null)}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-full text-white/92"
                  >
                    <ChevronLeft className="h-8 w-8" />
                  </button>
                  <div className="flex items-center gap-[5px] text-[#f5f7fb]">
                    <span className="h-[7px] w-[5px] rounded-[2px] bg-current" />
                    <span className="h-[9px] w-[5px] rounded-[2px] bg-current" />
                    <span className="h-[11px] w-[5px] rounded-[2px] bg-current" />
                    <span className="ml-[4px] h-[10px] w-[20px] rounded-[4px] border border-current" />
                  </div>
                </div>

                <div className="mt-10 flex flex-1 flex-col">
                  <div className="mx-auto w-full max-w-[340px]">
                    <div className="relative mx-auto h-[180px] w-full max-w-[300px]">
                      <div className="absolute left-[12%] top-[54%] h-[78px] w-[126px] rounded-[10px] border border-[#536187] bg-[linear-gradient(180deg,#434753_0%,#2a2e37_100%)] shadow-[0_20px_40px_rgba(0,0,0,0.36)]" />
                      <div className="absolute left-[7%] top-[79%] h-[3px] w-[140px] rounded-full bg-[#2a2d37]" />
                      <div className="absolute left-[30%] top-[28%] h-[106px] w-[190px] rounded-[10px] border border-[#5a647c] bg-[linear-gradient(180deg,#3a3f4c_0%,#252932_100%)] shadow-[0_24px_48px_rgba(0,0,0,0.32)]" />
                      <div className="absolute left-[30%] top-[82%] h-[4px] w-[206px] rounded-full bg-[#2a2d37]" />
                      <div className="absolute right-[6%] top-[50%] flex h-[82px] w-[44px] items-center justify-center rounded-[10px] border border-[#5a647c] bg-[linear-gradient(180deg,#454955_0%,#2b2f38_100%)] shadow-[0_18px_36px_rgba(0,0,0,0.34)]">
                        <div className="flex h-[44px] w-[44px] items-center justify-center rounded-full border border-white/22 bg-white/6">
                          <AlertTriangle className="h-5 w-5 text-[#d7d8de]" />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 text-center">
                    <p className="text-[20px] font-semibold leading-[1.15] tracking-[-0.03em] text-white sm:text-[22px]">
                      Login Pending, Device Limit Reached
                    </p>
                    <p className="mt-3 text-[15px] leading-6 text-[#8f95ab]">
                      Your current plan supports {sessionConflict.sessionLimit} device only
                    </p>
                  </div>

                  <div className="mt-8 rounded-[22px] bg-[#141925] p-5 shadow-[0_18px_40px_rgba(0,0,0,0.22)]">
                    <p className="text-[18px] font-semibold text-white">
                      Log Out {sessionConflict.activeSessions.length} Device{sessionConflict.activeSessions.length === 1 ? '' : 's'} to Continue
                    </p>

                    <div className="mt-6 space-y-5">
                      {sessionConflict.activeSessions.map((session, index) => {
                        const SessionIcon = getSessionDeviceIcon(session.device);
                        return (
                          <div key={session.sessionId || index} className="flex items-center gap-4">
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] border border-white/10 bg-white/[0.03] text-[#aeb6d6]">
                              <SessionIcon className="h-6 w-6" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[16px] font-medium text-white">{session.device}</p>
                              <p className="mt-1 text-[13px] text-[#8b93ad]">Last used : {formatSessionLastUsed(session.lastSeenAt)}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => void confirmTakeover()}
                              disabled={submitting}
                              className="inline-flex h-[52px] min-w-[120px] items-center justify-center rounded-[12px] bg-white/[0.06] px-4 text-[15px] font-semibold text-white transition hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {submitting ? 'Logging Out...' : 'Log Out'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="mt-7 flex items-center gap-4 text-[#7c839c]">
                    <div className="h-px flex-1 bg-white/12" />
                    <span className="text-[14px] font-medium">Or Upgrade</span>
                    <div className="h-px flex-1 bg-white/12" />
                  </div>

                  <div className="mt-7 rounded-[20px] bg-[#141925] p-4 shadow-[0_18px_40px_rgba(0,0,0,0.2)]">
                    <p className="text-[12px] font-semibold uppercase tracking-[0.04em] text-[#f2af2f]">Recommended</p>
                    <button
                      type="button"
                      onClick={() => setSessionConflict(null)}
                      className="mt-3 flex w-full items-center justify-between gap-4 text-left"
                    >
                      <div className="min-w-0">
                        <p className="text-[17px] leading-6 text-white">Upgrade to 4 devices for ₹699</p>
                        <p className="mt-1 truncate text-[13px] text-[#7f87a2]">Watch on TV, Laptop • 4K UHD • Dolby Atmos • Ads...</p>
                      </div>
                      <ChevronRight className="h-6 w-6 shrink-0 text-white/72" />
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const Shell = ({
  overview,
  activeTab,
  setActiveTab,
  onLogout,
  onRefresh,
  resumeTarget,
  onContinueLearningNavigate,
  onOpenNotification,
  onResumeNavigationHandled,
  savedTopicIds,
  savedTopics,
  onToggleSavedTopic,
}: {
  overview: PlatformOverview;
  activeTab: TabKey;
  setActiveTab: (tab: TabKey) => void;
  onLogout: () => Promise<void>;
  onRefresh: () => Promise<void>;
  resumeTarget: { courseId: string; lessonId?: string | null } | null;
  onContinueLearningNavigate: (courseId: string, lessonId?: string | null) => void;
  onOpenNotification: (notification: NotificationItem) => void;
  onResumeNavigationHandled: () => void;
  savedTopicIds: string[];
  savedTopics: SavedTopic[];
  onToggleSavedTopic: (courseId: string, lessonId: string) => void;
}) => {
  const { user, isAdmin } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isMobileMoreOpen, setIsMobileMoreOpen] = useState(false);
  const [liveMobileMode, setLiveMobileMode] = useState<'list' | 'detail' | 'room'>('list');
  const [isImmersiveCoursePlayer, setIsImmersiveCoursePlayer] = useState(false);
  const [isImmersiveTestsFlow, setIsImmersiveTestsFlow] = useState(false);
  const [pendingLiveClassId, setPendingLiveClassId] = useState<string | null>(null);
  const searchContainerRef = useRef<HTMLDivElement | null>(null);

  const visibleTabs = tabs.filter((tab) => tab.id !== 'admin' || isAdmin);
  const overviewSidebarTabs = useMemo(
    () => ['overview', 'courses', 'live', 'tests', 'revision', 'analytics', ...(isAdmin ? ['admin'] : [])]
      .map((id) => tabs.find((tab) => tab.id === id))
      .filter((tab): tab is (typeof tabs)[number] => Boolean(tab)),
    [isAdmin],
  );
  const primaryNavTabs = mobilePrimaryTabIds
    .map((tabId) => visibleTabs.find((tab) => tab.id === tabId))
    .filter((tab): tab is (typeof tabs)[number] => Boolean(tab));
  const utilityTabs = visibleTabs.filter((tab) => !mobilePrimaryTabIds.includes(tab.id));
  const searchTargets = useMemo(() => buildSearchTargets(overview, savedTopics), [overview, savedTopics]);
  const filteredTargets = useMemo(() => {
    const normalized = searchQuery.trim().toLowerCase();
    if (!normalized) {
      return searchTargets.slice(0, 8);
    }

    return searchTargets
      .filter((target) => `${target.title} ${target.subtitle} ${target.kind}`.toLowerCase().includes(normalized))
      .slice(0, 8);
  }, [searchQuery, searchTargets]);
  const activeMeta = shellTabMeta[activeTab];
  const isOverviewWorkspace = activeTab === 'overview';
  const isCoursesWorkspace = activeTab === 'courses';
  const isTestsWorkspace = activeTab === 'tests';
  const isLiveWorkspace = activeTab === 'live';
  const isFigmaWorkspace = activeTab === 'courses' && isImmersiveCoursePlayer;
  const isImmersiveTestsWorkspace = activeTab === 'tests' && isImmersiveTestsFlow;
  const isImmersiveWorkspace = isFigmaWorkspace || isImmersiveTestsWorkspace;
  const hideMobileShellNav = isLiveWorkspace && liveMobileMode !== 'list';
  const shouldLockViewport = isOverviewWorkspace || isImmersiveWorkspace;
  const continueCourse = overview.dashboard.continueLearning[0] || null;
  const isSecondaryMobileTabActive = utilityTabs.some((tab) => tab.id === activeTab);
  const mobileNavLabels: Record<TabKey, string> = {
    overview: 'Home',
    courses: 'Courses',
    live: 'Live',
    tests: 'Tests',
    quiz: 'Quiz',
    revision: 'Revision',
    analytics: 'Analytics',
    admin: 'Admin',
  };
  const showShellHeader = false;

  useEffect(() => {
    const handleWindowClick = (event: MouseEvent) => {
      if (!searchContainerRef.current?.contains(event.target as Node)) {
        setIsSearchOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsSearchOpen(false);
        setIsMobileMoreOpen(false);
      }
    };

    window.addEventListener('mousedown', handleWindowClick);
    window.addEventListener('keydown', handleEscape);

    return () => {
      window.removeEventListener('mousedown', handleWindowClick);
      window.removeEventListener('keydown', handleEscape);
    };
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined' || !isMobileMoreOpen) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isMobileMoreOpen]);

  useEffect(() => {
    if (activeTab !== 'live') {
      setLiveMobileMode('list');
    }
  }, [activeTab]);

  useEffect(() => {
    if (typeof document === 'undefined' || !shouldLockViewport) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [shouldLockViewport]);

  useEffect(() => {
    if (activeTab !== 'courses') {
      setIsImmersiveCoursePlayer(false);
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'tests') {
      setIsImmersiveTestsFlow(false);
    }
  }, [activeTab]);

  const handleSearchTargetSelect = (target: SearchTarget) => {
    setSearchQuery('');
    setIsSearchOpen(false);
    setIsMobileMoreOpen(false);

    if (target.kind === 'course' || target.kind === 'lesson' || target.kind === 'saved') {
      setActiveTab('courses');
      onContinueLearningNavigate(target.courseId, target.lessonId || null);
      return;
    }

    setActiveTab(target.tab);
  };

  const handleTabChange = (tab: TabKey) => {
    setActiveTab(tab);
    setIsSearchOpen(false);
    setIsMobileMoreOpen(false);
  };

  const renderActiveTab = () => {
    if (activeTab === 'overview') {
      return (
          <OverviewFigmaTab
          overview={overview}
          onContinueLearning={(courseId, lessonId) => {
            onContinueLearningNavigate(courseId, lessonId);
            setActiveTab('courses');
          }}
          onOpenLiveTab={() => setActiveTab('live')}
          onOpenTestsTab={() => setActiveTab('tests')}
          onOpenRevisionTab={() => setActiveTab('revision')}
          onOpenQuizTab={() => setActiveTab('quiz')}
          onOpenNotification={onOpenNotification}
        />
      );
    }

    if (activeTab === 'courses') {
      return (
        <CourseFigmaTab
          overview={overview}
          onRefresh={onRefresh}
          initialCourseId={resumeTarget?.courseId}
          initialLessonId={resumeTarget?.lessonId || null}
          onResumeNavigationHandled={onResumeNavigationHandled}
          savedTopicIds={savedTopicIds}
          onToggleSavedTopic={onToggleSavedTopic}
          onImmersiveModeChange={setIsImmersiveCoursePlayer}
        />
      );
    }

    if (activeTab === 'tests') {
      return (
        <TestSeriesFigmaTab
          overview={overview}
          onRefresh={onRefresh}
          onImmersiveModeChange={setIsImmersiveTestsFlow}
          onOpenLiveClass={(liveClassId) => {
            setPendingLiveClassId(liveClassId);
            setActiveTab('live');
          }}
        />
      );
    }

    if (activeTab === 'live') {
      return (
        <LiveClassesFigmaTab
          overview={overview}
          onRefresh={onRefresh}
          onMobileModeChange={setLiveMobileMode}
          initialLiveClassId={pendingLiveClassId}
          onInitialLiveClassHandled={() => setPendingLiveClassId(null)}
        />
      );
    }

    if (activeTab === 'quiz') {
      return <QuizTab overview={overview} onRefresh={onRefresh} />;
    }

    if (activeTab === 'revision') {
      return (
        <RevisionTab
          overview={overview}
          savedTopics={savedTopics}
          onContinueLearning={(courseId, lessonId) => {
            onContinueLearningNavigate(courseId, lessonId);
            setActiveTab('courses');
          }}
        />
      );
    }

    if (activeTab === 'analytics') {
      return <AnalyticsTab overview={overview} />;
    }

    if (activeTab === 'admin' && overview.adminOverview) {
      return <AdminTab overview={overview} onRefresh={onRefresh} />;
    }

    return null;
  };

  return (
    <div className="min-h-dvh bg-[var(--page-bg)]">
      <div className="flex min-h-dvh">
        {!isImmersiveWorkspace && (
          <aside
            className={cn(
              'hidden shrink-0 overflow-y-auto px-4 py-5 shadow-[0_20px_64px_rgba(15,23,42,0.12)] lg:flex lg:flex-col',
              'w-[280px] border-r border-white/8 bg-[linear-gradient(180deg,#14233f_0%,#172944_100%)] text-white shadow-[0_20px_64px_rgba(15,23,42,0.24)]',
            )}
            style={{ fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}
          >
            <div>
              <div className="px-2">
                <BrandLogo tone="dark" size="sm" />
                <p className="mt-[4px] text-[11px] leading-none text-white/58">Competitive exam platform</p>
              </div>

              <div className="mt-6 rounded-[20px] border border-white/8 bg-white/[0.06] px-[14px] py-[16px]">
                <p className="text-[9px] font-semibold uppercase tracking-[0.22em] text-white/38">Current learner</p>
                <div className="mt-[14px] flex items-center gap-[12px]">
                  <div className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-white/[0.12]">
                    <UserCircle2 className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-[13px] font-semibold text-white">Abuw Singh</p>
                    <p className="text-[12px] text-white/58">Beginner</p>
                  </div>
                </div>

                <div className="mt-[16px] grid grid-cols-2 gap-[10px] text-[11px]">
                  <div className="rounded-[14px] bg-white/[0.07] px-[12px] py-[10px]">
                    <p className="text-white/42">Recent</p>
                    <p className="mt-[6px] text-[16px] font-semibold text-white">9</p>
                  </div>
                  <div className="rounded-[14px] bg-white/[0.07] px-[12px] py-[10px]">
                    <p className="text-white/42">Snapshots</p>
                    <p className="mt-[6px] text-[16px] font-semibold text-white">265</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-[18px]">
              <nav className="space-y-[4px]">
                {overviewSidebarTabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {
                      if (tab.id === 'admin' && !isAdmin) {
                        return;
                      }

                      handleTabChange(tab.id);
                    }}
                    data-testid={`nav-${tab.id}`}
                    className={cn(
                      'flex w-full items-center gap-[11px] rounded-[18px] px-[14px] py-[12px] text-left text-[13px] font-medium transition',
                      activeTab === tab.id
                        ? 'bg-white text-[#1f2d4e] shadow-[0_12px_24px_rgba(255,255,255,0.12)]'
                        : 'text-white/78 hover:bg-white/8 hover:text-white',
                    )}
                  >
                    <tab.icon className="h-4 w-4" />
                    {tab.label}
                  </button>
                ))}
              </nav>
            </div>

            <div className="mt-auto space-y-[12px]">
              <div className="rounded-[20px] border border-white/8 bg-white/[0.06] px-[14px] py-[16px]">
                <p className="text-[9px] font-semibold uppercase tracking-[0.22em] text-white/42">Next Best Move</p>
                <p className="mt-[12px] text-[13px] leading-[1.6] text-white/78">
                  Resume Circuits &amp; Network Reduction Essentials before opening something new.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    if (continueCourse) {
                      onContinueLearningNavigate(continueCourse._id, continueCourse.continueLesson?.id || null);
                      setActiveTab('courses');
                      return;
                    }

                    handleTabChange('revision');
                  }}
                  className="mt-[14px] inline-flex h-[34px] items-center rounded-[12px] bg-white/[0.12] px-[14px] text-[12px] font-semibold text-white transition hover:bg-white/[0.18]"
                >
                  Resume now
                </button>
              </div>

              <div className="rounded-[18px] border border-white/8 bg-white/[0.06] p-[8px]">
                <button
                  type="button"
                  onClick={onLogout}
                  className="flex w-full items-center gap-[10px] rounded-[14px] px-[12px] py-[11px] text-[13px] text-white/78 transition hover:bg-white/8 hover:text-white"
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </button>
              </div>
            </div>
          </aside>
        )}

        <div className="flex min-h-0 flex-1 flex-col overflow-x-hidden" data-testid="shell-ready">
          {isLiveWorkspace && !isImmersiveWorkspace && (
            <div className="hidden border-b border-[#edf2fb] bg-white px-4 py-5 lg:block lg:px-8">
              <div className="mx-auto flex w-full max-w-[1460px] items-center justify-between gap-4">
                <div className="flex min-w-0 flex-1 items-center gap-4">
                  <div className="hidden h-10 w-px bg-[#edf2fb] lg:block" />
                  <div className="flex min-w-0 flex-1 items-center gap-3 rounded-[18px] border border-[#e9eff8] bg-[#fbfcff] px-5 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.04)] lg:max-w-[520px]">
                    <Search className="h-5 w-5 text-[#6f82a5]" />
                    <input
                      value={searchQuery}
                      onFocus={() => {
                        setIsSearchOpen(true);
                        setIsMobileMoreOpen(false);
                      }}
                      onChange={(event) => {
                        setSearchQuery(event.target.value);
                        setIsSearchOpen(true);
                      }}
                      placeholder="Search for tests, classes, notes..."
                      className="min-w-0 flex-1 bg-transparent text-[15px] text-[#31486d] outline-none placeholder:text-[#95a3bc]"
                    />
                    <span className="hidden rounded-[10px] border border-[#e5ebf6] bg-white px-2.5 py-1 text-[12px] font-semibold text-[#7b8cab] sm:inline-flex">
                      ⌘ K
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => {
                      if (overview.notifications[0]) {
                        onOpenNotification(overview.notifications[0]);
                      }
                    }}
                    className="relative flex h-11 w-11 items-center justify-center rounded-full text-[#20335c]"
                  >
                    <BellRing className="h-5 w-5" />
                    <span className="absolute right-0 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#ff4d5d] px-1 text-[9px] font-semibold text-white">
                      {overview.notifications.length}
                    </span>
                  </button>
                  <div className="flex items-center gap-3 rounded-full pl-1">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[linear-gradient(135deg,#dce8ff_0%,#7ea7ff_100%)] text-sm font-semibold text-[#22375e] shadow-[0_10px_24px_rgba(15,23,42,0.08)]">
                      {buildInitials(user?.name || 'Learner')}
                    </div>
                    <div className="hidden sm:block">
                      <p className="text-[15px] font-semibold text-[#1f2d4e]">{user?.name || 'Learner'}</p>
                      <p className="text-[13px] text-[#7b8cab]">{isAdmin ? 'Teacher' : 'Aspirant'}</p>
                    </div>
                    <ChevronDown className="hidden h-4 w-4 text-[#7b8cab] sm:block" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {showShellHeader && (
            <header className="sticky top-0 z-20 border-b border-white/60 bg-[var(--page-bg)]/88 px-4 py-4 backdrop-blur-xl sm:px-6 lg:px-8">
              <div className="mx-auto flex w-full max-w-[1380px] flex-col gap-4">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="max-w-3xl">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--ink-soft)]">{activeMeta.eyebrow}</p>
                        <h1 className="mt-3 text-2xl font-semibold leading-tight text-[var(--ink)] sm:text-[2.2rem]">{activeMeta.title}</h1>
                        <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--ink-soft)] sm:text-base">{activeMeta.description}</p>
                      </div>
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/70 bg-white/85 shadow-sm lg:hidden">
                        <UserCircle2 className="h-5 w-5 text-[var(--accent-rust)]" />
                      </div>
                    </div>
                  </div>

                  <div className="w-full xl:max-w-[620px]">
                    <div ref={searchContainerRef} className="relative">
                      <div className={cn(
                        'flex items-center gap-3 rounded-[28px] border px-4 py-3.5 shadow-[0_16px_34px_rgba(15,23,42,0.07)]',
                        isSearchOpen ? 'border-[var(--accent-rust)]/24 bg-white' : 'border-white/70 bg-white/92',
                      )}>
                        <Search className="h-4 w-4 text-[var(--accent-rust)]" />
                        <input
                          data-testid="global-search-input"
                          value={searchQuery}
                          onFocus={() => {
                            setIsSearchOpen(true);
                            setIsMobileMoreOpen(false);
                          }}
                          onChange={(event) => {
                            setSearchQuery(event.target.value);
                            setIsSearchOpen(true);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                              setIsSearchOpen(false);
                            }

                            if (event.key === 'Enter' && filteredTargets[0]) {
                              event.preventDefault();
                              handleSearchTargetSelect(filteredTargets[0]);
                            }
                          }}
                          placeholder="Search lessons, mocks, and saved topics..."
                          className="w-full bg-transparent text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-soft)]"
                        />
                        <span className="hidden rounded-full bg-[var(--accent-cream)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--accent-rust)] md:inline-flex">
                          Search
                        </span>
                      </div>
                      <SearchPanel
                        open={isSearchOpen}
                        query={searchQuery}
                        results={filteredTargets}
                        onSelect={handleSearchTargetSelect}
                        onClose={() => setIsSearchOpen(false)}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </header>
          )}

          <main className={cn(
            'mx-auto flex w-full flex-1 flex-col overflow-hidden',
            (isOverviewWorkspace || isCoursesWorkspace || isTestsWorkspace)
              ? 'max-w-none px-0 pb-0 pt-0'
              : isLiveWorkspace
                ? cn('max-w-[1460px] px-0 pt-0 sm:px-4 sm:pt-5 lg:px-7 lg:pb-10', hideMobileShellNav ? 'pb-6 sm:pb-8 lg:pb-10' : 'pb-28 sm:pb-36 lg:pb-10')
                : 'max-w-[1380px] px-4 pb-36 pt-4 sm:px-6 lg:px-8 lg:pb-10',
            showShellHeader && !isCoursesWorkspace ? 'pt-6' : '',
          )} style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-y' }}>
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="flex flex-1 flex-col"
              >
                {renderActiveTab()}
              </motion.div>
            </AnimatePresence>
          </main>

          {!isImmersiveWorkspace && !isImmersiveTestsFlow && !hideMobileShellNav && (
            <>
              <MobileMoreSheet
                open={isMobileMoreOpen}
                tabs={utilityTabs}
                activeTab={activeTab}
                onSelect={handleTabChange}
                onClose={() => setIsMobileMoreOpen(false)}
                onLogout={onLogout}
              />

              <div
                className="pointer-events-none fixed inset-x-0 bottom-0 z-30 border-t border-[#dde6f4] bg-white/98 px-3 pt-2 shadow-[0_-12px_34px_rgba(15,23,42,0.08)] backdrop-blur lg:hidden"
                style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.45rem)' }}
              >
                <div className="pointer-events-auto grid grid-cols-5 gap-1">
                  {primaryNavTabs.map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => handleTabChange(tab.id)}
                      data-testid={`mobile-nav-${tab.id}`}
                      className={cn(
                        'flex flex-col items-center gap-[6px] rounded-[16px] px-2 py-[8px] text-[11px] font-medium transition',
                        activeTab === tab.id ? 'text-[#1b5fe3]' : 'text-[#65789b]',
                      )}
                    >
                      <div
                        className={cn(
                          'flex h-[30px] w-[30px] items-center justify-center rounded-[10px]',
                          activeTab === tab.id ? 'bg-[#eef4ff]' : 'bg-transparent',
                        )}
                      >
                        <tab.icon className="h-[19px] w-[19px]" />
                      </div>
                      {mobileNavLabels[tab.id]}
                    </button>
                  ))}
                  <button
                    type="button"
                    data-testid="mobile-nav-more"
                    onClick={() => {
                      setIsMobileMoreOpen(true);
                      setIsSearchOpen(false);
                    }}
                    className={cn(
                      'flex flex-col items-center gap-[6px] rounded-[16px] px-2 py-[8px] text-[11px] font-medium transition',
                      isSecondaryMobileTabActive || isMobileMoreOpen ? 'text-[#1b5fe3]' : 'text-[#65789b]',
                    )}
                  >
                    <div
                      className={cn(
                        'flex h-[30px] w-[30px] items-center justify-center rounded-[10px]',
                        isSecondaryMobileTabActive || isMobileMoreOpen ? 'bg-[#eef4ff]' : 'bg-transparent',
                      )}
                    >
                      <UserCircle2 className="h-[19px] w-[19px]" />
                    </div>
                    Profile
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const OverviewTab = ({
  overview,
  onContinueLearning,
  onOpenNotification,
  savedTopics,
}: {
  overview: PlatformOverview;
  onContinueLearning: (courseId: string, lessonId?: string | null) => void;
  onOpenNotification: (notification: NotificationItem) => void;
  savedTopics: SavedTopic[];
}) => {
  const learnerName = overview.user?.name || 'Learner';
  const learnerInitials = buildInitials(learnerName);
  const enrolledCourses = overview.courses.filter((course) => course.enrolled);
  const continueCourse = overview.dashboard.continueLearning[0] || enrolledCourses[0] || overview.courses[0] || null;
  const secondaryCourse = overview.dashboard.continueLearning[1] || enrolledCourses[1] || overview.courses[1] || null;
  const activeCourses = [continueCourse, secondaryCourse].filter(
    (course, index, items): course is NonNullable<typeof course> => Boolean(course) && items.findIndex((item) => item?._id === course?._id) === index,
  );
  const actionQueueNotification = overview.notifications[0] || null;
  const nextLiveClass = overview.liveClasses.find((liveClass) => {
    const state = `${liveClass.status || ''} ${liveClass.mode || ''}`.toLowerCase();
    return state.includes('live') || state.includes('scheduled') || state.includes('upcoming');
  }) || overview.liveClasses[0] || null;
  const nextTest = overview.dashboard.latestMockTest || overview.testSeries[0] || null;
  const scoreValue = overview.dashboard.latestMockTest?.score ?? Math.round(overview.analytics.accuracy || overview.dashboard.accuracy || 0);
  const rankValue = overview.dashboard.latestMockTest?.rank ?? null;
  const summaryStats = [
    { label: 'Accuracy', value: `${overview.dashboard.accuracy}%`, icon: Target },
    { label: 'Speed', value: `${overview.dashboard.speed}x`, icon: Gauge },
    { label: 'Streak', value: `${overview.dashboard.streak}d`, icon: Flame },
  ];
  const savedTopicCards = savedTopics.length > 0 ? savedTopics.slice(0, 2) : [];
  const focusTopics = overview.dashboard.weakTopics.slice(0, 2);
  const highlightTopic = focusTopics[0] || savedTopics[0]?.lessonTitle || continueCourse?.continueLesson?.title || continueCourse?.title || 'Weekly focus';
  const recommendation = continueCourse
    ? `Resume ${continueCourse.continueLesson?.title || continueCourse.title} and keep your current study rhythm intact.`
    : savedTopics[0]
      ? `Revisit ${savedTopics[0].lessonTitle} and rebuild the topic from the last saved checkpoint.`
      : 'Open one lesson, finish one block, and keep the dashboard moving with a small win.';
  const nextTestTitle = nextTest
    ? 'title' in nextTest
      ? nextTest.title
      : 'Mock test'
    : 'Mock Test 02';
  const nextTestSubtitle = nextTest
    ? 'category' in nextTest
      ? nextTest.category
      : 'SSC JE Electrical Power Track'
    : 'SSC JE Electrical Power Track';
  const nextTestDuration = nextTest
    ? 'durationMinutes' in nextTest
      ? nextTest.durationMinutes
      : 60
    : 60;

  return (
    <div
      data-testid="overview-dashboard"
      className="relative overflow-hidden rounded-[36px] border border-white/70 bg-[linear-gradient(180deg,#dfe8fb_0%,#edf2ff_42%,#e7edf9_100%)] px-4 py-5 shadow-[0_30px_100px_rgba(15,23,42,0.08)] sm:px-5 sm:py-6 lg:px-6"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_14%,rgba(255,255,255,0.92),transparent_28%),radial-gradient(circle_at_82%_18%,rgba(117,166,255,0.24),transparent_20%),radial-gradient(circle_at_70%_84%,rgba(123,176,255,0.18),transparent_26%)] opacity-90" />
      <div className="relative mx-auto flex w-full max-w-[1400px] flex-col gap-5">
        <div data-testid="overview-topbar" className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/68 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--ink-soft)] shadow-[0_10px_24px_rgba(15,23,42,0.06)] backdrop-blur">
              <LayoutDashboard className="h-3.5 w-3.5 text-[var(--accent-rust)]" />
              Overview dashboard
            </div>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-[var(--ink)] sm:text-[3rem]">
              Good to see you, {learnerName}.
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--ink-soft)] sm:text-base">
              {continueCourse
                ? `Continue ${continueCourse.exam} and keep the next lesson, revision queue, and practice flow connected.`
                : 'Start one lesson, then build revision around what you actually study.'}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-white/72 px-3 py-1.5 text-xs font-semibold text-[var(--accent-rust)] shadow-[0_10px_24px_rgba(15,23,42,0.06)]">
                {overview.highlights.concurrencyTarget}
              </span>
              <span className="rounded-full bg-white/72 px-3 py-1.5 text-xs font-semibold text-[var(--ink-soft)] shadow-[0_10px_24px_rgba(15,23,42,0.06)]">
                {overview.highlights.deploymentProfile}
              </span>
              {overview.highlights.modules.slice(0, 2).map((module) => (
                <span key={module} className="rounded-full bg-[rgba(255,255,255,0.66)] px-3 py-1.5 text-xs font-medium text-[var(--ink-soft)]">
                  {module}
                </span>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3 self-start lg:pt-1">
            <button
              type="button"
              data-testid="overview-search-pill"
              className="flex h-11 items-center gap-2 rounded-full border border-white/80 bg-white/72 px-4 text-sm text-[var(--ink-soft)] shadow-[0_10px_24px_rgba(15,23,42,0.07)] backdrop-blur transition hover:bg-white/86"
            >
              <Search className="h-4 w-4 text-[var(--accent-rust)]" />
              <span className="hidden sm:inline">Search...</span>
              <span className="sm:hidden">Search</span>
            </button>
            <button
              type="button"
              data-testid="overview-notification-button"
              onClick={() => {
                if (actionQueueNotification) {
                  onOpenNotification(actionQueueNotification);
                }
              }}
              className="relative flex h-11 w-11 items-center justify-center rounded-full border border-white/80 bg-white/72 text-[var(--ink-soft)] shadow-[0_10px_24px_rgba(15,23,42,0.07)] backdrop-blur transition hover:text-[var(--ink)]"
              aria-label="Open notifications"
            >
              <BellRing className="h-5 w-5" />
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--accent-rust)] px-1 text-[10px] font-semibold text-white">
                {overview.notifications.length}
              </span>
            </button>
            <div
              data-testid="overview-profile-avatar"
              className="flex h-11 w-11 items-center justify-center rounded-full border border-white/80 bg-[linear-gradient(135deg,#6b9cff_0%,#2b63df_100%)] text-sm font-semibold text-white shadow-[0_10px_24px_rgba(15,23,42,0.08)]"
              title={learnerName}
            >
              {learnerInitials}
            </div>
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,0.85fr)]">
          <div className="space-y-5">
            <section
              data-testid="overview-hero"
              className="relative overflow-hidden rounded-[34px] border border-white/40 bg-[linear-gradient(135deg,#2f6fe4_0%,#3b82f6_50%,#7cb8ff_100%)] p-6 text-white shadow-[0_32px_110px_rgba(35,84,190,0.28)] sm:p-8"
            >
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_22%,rgba(255,255,255,0.18),transparent_24%),radial-gradient(circle_at_82%_62%,rgba(255,255,255,0.12),transparent_26%),linear-gradient(120deg,rgba(255,255,255,0.12),transparent_24%)]" />
              <div className="absolute -right-12 top-10 h-48 w-48 rounded-full bg-white/10 blur-3xl" />
              <div className="absolute bottom-0 right-0 h-32 w-64 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.22),transparent_65%)] blur-2xl" />
              <div className="relative max-w-3xl">
                <div className="flex items-center gap-3 text-sm font-semibold">
                  <span className="rounded-full bg-white/16 px-3 py-1.5 backdrop-blur">Continue Learning</span>
                  <span className="text-white/78">{continueCourse?.progressPercent || 0}%</span>
                </div>
                <h3 className="mt-4 max-w-2xl text-3xl font-semibold tracking-[-0.04em] sm:text-[2.7rem]">
                  {continueCourse?.title || 'SSC JE 2026 Electrical Power Track'}
                </h3>
                <p className="mt-4 max-w-2xl text-sm leading-8 text-white/78 sm:text-base">
                  {continueCourse
                    ? `Resume ${continueCourse.continueLesson?.title || 'the next lesson'} and build your revision around what you actually study.`
                    : overview.ai.headline}
                </p>
                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    data-testid="overview-continue-cta"
                    onClick={() => {
                      if (continueCourse) {
                        onContinueLearning(continueCourse._id, continueCourse.continueLesson?.id || null);
                      }
                    }}
                    className="inline-flex items-center gap-2 rounded-[18px] bg-white px-5 py-3 text-base font-semibold text-[var(--accent-rust)] shadow-[0_18px_30px_rgba(8,29,61,0.16)] transition hover:-translate-y-0.5"
                  >
                    Continue Learning
                    <ArrowRight className="h-5 w-5" />
                  </button>
                  <span className="rounded-full border border-white/24 bg-white/10 px-4 py-3 text-sm font-medium text-white/86 backdrop-blur">
                    {continueCourse?.exam || overview.highlights.modules[0] || 'Exam prep'}
                  </span>
                </div>
                <div className="mt-7 grid gap-3 sm:grid-cols-3">
                  {summaryStats.map((stat) => (
                    <div key={stat.label} className="rounded-[22px] border border-white/20 bg-white/10 p-4 backdrop-blur">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/70">{stat.label}</p>
                          <p className="mt-2 text-2xl font-semibold">{stat.value}</p>
                        </div>
                        <stat.icon className="h-5 w-5 text-white/80" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section data-testid="overview-active-courses" className="space-y-4">
              <SectionHeader title="Active Courses" caption="Your current track" />
              <div className="grid gap-4 lg:grid-cols-2">
                {activeCourses.length > 0 ? activeCourses.map((course, index) => (
                  <button
                    key={course._id}
                    type="button"
                    data-testid={`overview-active-course-card-${index}`}
                    onClick={() => onContinueLearning(course._id, course.continueLesson?.id || null)}
                    className="group rounded-[28px] border border-white/72 bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(245,249,255,0.95)_100%)] p-5 text-left shadow-[0_20px_60px_rgba(15,23,42,0.08)] transition hover:-translate-y-0.5 hover:shadow-[0_24px_70px_rgba(15,23,42,0.12)]"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="inline-flex rounded-full bg-[var(--accent-cream)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--accent-rust)]">
                          {course.exam}
                        </p>
                        <h4 className="mt-3 line-clamp-2 text-2xl font-semibold tracking-[-0.03em] text-[var(--ink)]">
                          {course.title}
                        </h4>
                        <p className="mt-1 text-base text-[var(--ink-soft)]">{course.subject}</p>
                      </div>
                      <div className="rounded-full bg-[linear-gradient(135deg,#e7eefc_0%,#ffffff_100%)] px-3 py-1.5 text-sm font-medium text-[var(--ink-soft)] shadow-inner">
                        {course.exam}
                      </div>
                    </div>

                    <div className="mt-5 flex items-center justify-between text-sm text-[var(--ink-soft)]">
                      <span>{course.progressPercent || 0}% Completed</span>
                      <span>{course.lessonCount || 0} lessons</span>
                    </div>
                    <div className="mt-2 h-2 rounded-full bg-[rgba(93,134,220,0.16)]">
                      <div
                        className="h-full rounded-full bg-[linear-gradient(90deg,#2f6fe4_0%,#5aa3ff_100%)]"
                        style={{ width: `${Math.min(course.progressPercent || 0, 100)}%` }}
                      />
                    </div>

                    <div className="mt-5 flex items-center justify-between gap-3">
                      <div className="grid grid-cols-3 gap-4 text-sm text-[var(--ink-soft)]">
                        <div>
                          <p className="text-[11px] uppercase tracking-[0.16em]">Modules</p>
                          <p className="mt-1 font-semibold text-[var(--ink)]">{course.modules?.length || 0}</p>
                        </div>
                        <div>
                          <p className="text-[11px] uppercase tracking-[0.16em]">Tests</p>
                          <p className="mt-1 font-semibold text-[var(--ink)]">{Math.max(1, Math.round((course.lessonCount || 0) / 24))}</p>
                        </div>
                        <div>
                          <p className="text-[11px] uppercase tracking-[0.16em]">Questions</p>
                          <p className="mt-1 font-semibold text-[var(--ink)]">{formatLargeMetric((course.lessonCount || 0) * 12)}</p>
                        </div>
                      </div>
                      <span className="inline-flex items-center gap-2 rounded-full bg-[linear-gradient(135deg,#2f6fe4_0%,#3f82f7_100%)] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_14px_28px_rgba(47,111,228,0.24)]">
                        Continue
                        <ChevronRight className="h-4 w-4" />
                      </span>
                    </div>
                  </button>
                )) : (
                  <div className="rounded-[28px] border border-dashed border-[var(--line)] bg-white/70 p-6 text-sm text-[var(--ink-soft)]">
                    No active courses yet. Enroll in a course to fill this dashboard section.
                  </div>
                )}
              </div>
            </section>

            <section data-testid="overview-signals" className="space-y-4">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--ink-soft)]">Signals</p>
                  <div className="mt-3 flex items-center gap-5 text-base font-medium text-[var(--ink-soft)] sm:text-lg">
                    <span className="border-b-2 border-[var(--accent-rust)] pb-2 text-[var(--ink)]">Signals</span>
                    <span>Saved</span>
                    <span>Focus</span>
                  </div>
                </div>
                <span className="hidden rounded-full bg-white/70 px-3 py-1.5 text-xs font-semibold text-[var(--ink-soft)] shadow-[0_10px_24px_rgba(15,23,42,0.05)] sm:inline-flex">
                  {overview.dashboard.weakTopics.length + savedTopics.length} items ready
                </span>
              </div>

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.16fr)_minmax(0,0.84fr)]">
                <div className="space-y-4">
                  <div
                    data-testid="overview-streak"
                    className="rounded-[30px] border border-white/72 bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(247,250,255,0.94)_100%)] p-5 shadow-[0_20px_60px_rgba(15,23,42,0.08)]"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-2xl">🔥 Keep the Streak On</p>
                        <p className="mt-2 text-sm text-[var(--ink-soft)]">
                          Daily quiz, a short revision block, and one mock touchpoint keep your momentum alive.
                        </p>
                      </div>
                      <div className="rounded-[18px] bg-[var(--accent-cream)] px-4 py-3 text-right">
                        <p className="text-sm text-[var(--ink-soft)]">Current streak</p>
                        <p className="mt-1 text-3xl font-semibold text-[var(--ink)]">{overview.dashboard.streak} day{overview.dashboard.streak === 1 ? '' : 's'}</p>
                      </div>
                    </div>
                    <div className="mt-5 grid gap-3 sm:grid-cols-[1.2fr_0.8fr]">
                      <div className="rounded-[24px] bg-[var(--accent-cream)] p-4">
                        <p className="text-sm font-semibold text-[var(--ink)]">Today&apos;s focus</p>
                        <p className="mt-2 text-sm leading-7 text-[var(--ink-soft)]">{highlightTopic}</p>
                      </div>
                      <button
                        type="button"
                        className="rounded-[24px] bg-[linear-gradient(135deg,#2f6fe4_0%,#3f82f7_100%)] px-5 py-4 text-left text-white shadow-[0_16px_32px_rgba(47,111,228,0.22)]"
                      >
                        <p className="text-sm font-semibold">Continue</p>
                        <p className="mt-2 text-sm text-white/80">Keep one clean study block moving forward.</p>
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    {savedTopicCards.length > 0 ? savedTopicCards.map((topic, index) => (
                      <button
                        key={`${topic.courseId}:${topic.lessonId}`}
                        type="button"
                        data-testid={`overview-saved-topic-${index}`}
                        onClick={() => onContinueLearning(topic.courseId, topic.lessonId)}
                        className="rounded-[26px] border border-white/72 bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(246,250,255,0.94)_100%)] p-4 text-left shadow-[0_18px_42px_rgba(15,23,42,0.07)] transition hover:-translate-y-0.5"
                      >
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ink-soft)]">{topic.exam}</p>
                        <h4 className="mt-2 text-lg font-semibold text-[var(--ink)]">{topic.lessonTitle}</h4>
                        <p className="mt-1 text-sm text-[var(--ink-soft)]">{topic.courseTitle}</p>
                        <div className="mt-4 flex items-center justify-between text-xs uppercase tracking-[0.18em] text-[var(--ink-soft)]">
                          <span>{topic.moduleTitle || 'Saved topic'}</span>
                          <ChevronRight className="h-4 w-4" />
                        </div>
                      </button>
                    )) : (
                      <>
                        <div className="rounded-[26px] border border-dashed border-[var(--line)] bg-white/70 p-4 text-sm text-[var(--ink-soft)]">
                          Save topics while studying to pin them here for quick revision.
                        </div>
                        <div className="rounded-[26px] border border-dashed border-[var(--line)] bg-white/70 p-4 text-sm text-[var(--ink-soft)]">
                          Your saved lessons will appear here once you start bookmarking the material.
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <div className="space-y-4">
                  <div
                    data-testid="overview-recommendation"
                    className="rounded-[30px] border border-white/72 bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(246,250,255,0.94)_100%)] p-5 shadow-[0_20px_60px_rgba(15,23,42,0.08)]"
                  >
                    <p className="text-xl font-semibold tracking-[-0.03em] text-[var(--ink)]">Circuits & Network Reduction</p>
                    <p className="mt-1 text-sm text-[var(--ink-soft)]">Recommended Track</p>
                    <p className="mt-4 text-sm leading-7 text-[var(--ink-soft)]">
                      {recommendation}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        if (continueCourse) {
                          onContinueLearning(continueCourse._id, continueCourse.continueLesson?.id || null);
                        }
                      }}
                      className="mt-5 inline-flex items-center gap-2 rounded-[18px] bg-[linear-gradient(135deg,#2f6fe4_0%,#3f82f7_100%)] px-4 py-3 text-sm font-semibold text-white shadow-[0_16px_32px_rgba(47,111,228,0.22)]"
                    >
                      Review now
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div
                      data-testid="overview-score-summary"
                      className="rounded-[26px] border border-white/72 bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(246,250,255,0.94)_100%)] p-5 shadow-[0_18px_42px_rgba(15,23,42,0.07)]"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <p className="text-sm text-[var(--ink-soft)]">Score</p>
                        <p className="text-3xl font-semibold text-[var(--ink)]">{scoreValue}</p>
                      </div>
                      <div className="mt-4 h-2 rounded-full bg-[rgba(92,136,223,0.16)]">
                        <div className="h-full rounded-full bg-[linear-gradient(90deg,#2f6fe4_0%,#7cb8ff_100%)]" style={{ width: `${Math.min(scoreValue, 100)}%` }} />
                      </div>
                      <div className="mt-4 flex items-center justify-between text-sm text-[var(--ink-soft)]">
                        <span>Rank</span>
                        <span className="text-2xl font-semibold text-[var(--ink)]">{rankValue ? `#${rankValue}` : 'Ready'}</span>
                      </div>
                    </div>

                    <div
                      data-testid="overview-next-test-card"
                      className="rounded-[26px] border border-white/72 bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(246,250,255,0.94)_100%)] p-5 text-left shadow-[0_18px_42px_rgba(15,23,42,0.07)]"
                    >
                      <p className="text-sm text-[var(--ink-soft)]">Next test</p>
                      <p className="mt-2 text-xl font-semibold text-[var(--ink)]">{nextTestTitle}</p>
                      <p className="mt-1 text-sm text-[var(--ink-soft)]">{nextTestSubtitle}</p>
                      <p className="mt-1 text-sm text-[var(--ink-soft)]">{nextTestDuration} minutes</p>
                      <button
                        type="button"
                        className="mt-5 inline-flex items-center gap-2 rounded-[18px] bg-[linear-gradient(135deg,#2f6fe4_0%,#3f82f7_100%)] px-4 py-3 text-sm font-semibold text-white shadow-[0_16px_32px_rgba(47,111,228,0.22)]"
                      >
                        Attempt now
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>

          <aside className="space-y-5 xl:sticky xl:top-6">
            <div
              data-testid="overview-action-queue"
              className="rounded-[30px] border border-white/72 bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(246,250,255,0.94)_100%)] p-5 shadow-[0_20px_60px_rgba(15,23,42,0.08)]"
            >
              <SectionHeader
                title="Action Queue"
                caption="Right now"
                action={<div className="rounded-full bg-[var(--accent-cream)] p-2 text-[var(--accent-rust)]"><ChevronRight className="h-4 w-4 rotate-[-90deg]" /></div>}
              />
              <div className="mt-5 space-y-4">
                <div className="rounded-[26px] border border-[rgba(103,151,234,0.18)] bg-[linear-gradient(180deg,#ffffff_0%,#f1f7ff_100%)] p-4 shadow-[0_14px_28px_rgba(15,23,42,0.05)]">
                  <span className="inline-flex rounded-full bg-[#f7a6aa] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white">
                    Live
                  </span>
                  <p className="mt-3 text-lg font-semibold text-[var(--ink)]">
                    {nextLiveClass ? 'Next live session is in progress.' : 'No live class running right now.'}
                  </p>
                  <p className="mt-2 text-sm text-[var(--ink-soft)]">
                    {nextLiveClass
                      ? nextLiveClass.title
                      : 'Your next live class will appear here once it is scheduled.'}
                  </p>
                  <div className="mt-4 flex items-center justify-between gap-3 text-sm text-[var(--ink-soft)]">
                    <span>{nextLiveClass?.instructor || overview.highlights.modules[0] || 'VARONENGLISH'}</span>
                    <span>{nextLiveClass ? formatDateTime(nextLiveClass.startTime) : 'Upcoming'}</span>
                  </div>
                  <button
                    type="button"
                    className="mt-4 inline-flex w-full items-center justify-center rounded-[18px] bg-[linear-gradient(135deg,#2f6fe4_0%,#3f82f7_100%)] px-4 py-3 text-sm font-semibold text-white shadow-[0_14px_28px_rgba(47,111,228,0.22)]"
                  >
                    Join now
                  </button>
                </div>

                <div className="rounded-[26px] border border-[rgba(103,151,234,0.16)] bg-white/86 p-4">
                  <p className="text-xl font-semibold tracking-[-0.03em] text-[var(--ink)]">Upcoming Classes</p>
                  <div className="mt-4 rounded-[22px] border border-[var(--line)] bg-white p-4">
                    <div className="grid grid-cols-6 gap-2 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--ink-soft)]">
                      {['M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => (
                        <span key={`${day}-${index}`}>{day}</span>
                      ))}
                    </div>
                    <div className="mt-4 space-y-3">
                      {(overview.liveClasses.slice(0, 2).length > 0 ? overview.liveClasses.slice(0, 2) : [null]).map((liveClass, index) => (
                        <div key={liveClass?._id || `live-placeholder-${index}`} className="flex items-center justify-between gap-4">
                          <div>
                            <p className="text-sm font-semibold text-[var(--ink)]">
                              {liveClass ? new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' }).format(new Date(liveClass.startTime)) : '3:00 PM'}
                            </p>
                            <p className="mt-1 text-sm text-[var(--ink-soft)]">{liveClass?.title || 'General Awareness'}</p>
                          </div>
                          <span className="rounded-full bg-[var(--accent-cream)] px-3 py-1.5 text-xs font-semibold text-[var(--accent-rust)]">
                            {liveClass?.status || 'scheduled'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="mt-4 inline-flex w-full items-center justify-center rounded-[18px] bg-[linear-gradient(135deg,#2f6fe4_0%,#3f82f7_100%)] px-4 py-3 text-sm font-semibold text-white shadow-[0_14px_28px_rgba(47,111,228,0.22)]"
                  >
                    View timetable
                  </button>
                </div>
              </div>
            </div>

            <div
              data-testid="overview-upcoming-tests"
              className="rounded-[30px] border border-white/72 bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(246,250,255,0.94)_100%)] p-5 shadow-[0_20px_60px_rgba(15,23,42,0.08)]"
            >
              <SectionHeader title="Upcoming Tests" caption="Practice queue" />
              <div className="mt-4 rounded-[24px] border border-[var(--line)] bg-white p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--accent-cream)] text-[var(--accent-rust)]">
                    <ClipboardCheck className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-lg font-semibold text-[var(--ink)]">{nextTestTitle}</p>
                    <p className="mt-1 text-sm text-[var(--ink-soft)]">{nextTestSubtitle}</p>
                  </div>
                </div>
                <div className="mt-4 flex items-end justify-between gap-3">
                  <div>
                    <p className="text-sm text-[var(--ink-soft)]">Due soon</p>
                    <p className="mt-1 text-2xl font-semibold text-[var(--ink)]">{`${Math.max(1, Math.ceil(nextTestDuration / 45))} days`}</p>
                  </div>
                  <button
                    type="button"
                    className="inline-flex items-center rounded-[18px] bg-[linear-gradient(135deg,#2f6fe4_0%,#3f82f7_100%)] px-4 py-3 text-sm font-semibold text-white shadow-[0_14px_28px_rgba(47,111,228,0.22)]"
                  >
                    Attempt now
                  </button>
                </div>
              </div>
            </div>

            <div
              data-testid="overview-score-card"
              className="rounded-[30px] border border-white/72 bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(246,250,255,0.94)_100%)] p-5 shadow-[0_20px_60px_rgba(15,23,42,0.08)]"
            >
              <div className="flex items-center justify-between gap-4">
                <p className="text-xl font-semibold text-[var(--ink)]">Score</p>
                <p className="text-3xl font-semibold text-[var(--ink)]">{scoreValue}</p>
              </div>
              <div className="mt-4 h-2 rounded-full bg-[rgba(92,136,223,0.16)]">
                <div className="h-full rounded-full bg-[linear-gradient(90deg,#2f6fe4_0%,#7cb8ff_100%)]" style={{ width: `${Math.min(scoreValue, 100)}%` }} />
              </div>
              <div className="mt-4 flex items-center justify-between text-sm text-[var(--ink-soft)]">
                <span>Rank</span>
                <span className="text-2xl font-semibold text-[var(--ink)]">{rankValue ? `#${rankValue}` : '#96'}</span>
              </div>
              <button
                type="button"
                className="mt-5 inline-flex w-full items-center justify-center rounded-[18px] bg-[linear-gradient(135deg,#2f6fe4_0%,#3f82f7_100%)] px-4 py-3 text-sm font-semibold text-white shadow-[0_14px_28px_rgba(47,111,228,0.22)]"
              >
                Attempt now
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
};

const buildSearchTargets = (overview: PlatformOverview, savedTopics: SavedTopic[]): SearchTarget[] => {
  const searchableCourses = overview.user?.role === 'admin'
    ? overview.courses
    : overview.courses.filter((course) => course.enrolled);

  const courseTargets = searchableCourses.flatMap((course) => {
    const lessonTargets = flattenCourseLessons(course).map((entry) => ({
      id: `lesson:${course._id}:${entry.lesson.id}`,
      kind: 'lesson' as const,
      title: entry.lesson.title,
      subtitle: [course.title, entry.moduleTitle, entry.chapterTitle, `${entry.lesson.durationMinutes} min`].filter(Boolean).join(' • '),
      tab: 'courses' as const,
      courseId: course._id,
      lessonId: entry.lesson.id,
    }));

    return [
      {
        id: `course:${course._id}`,
        kind: 'course' as const,
        title: course.title,
        subtitle: [course.exam, course.subject, course.instructor].filter(Boolean).join(' • '),
        tab: 'courses' as const,
        courseId: course._id,
        lessonId: course.continueLesson?.id || null,
      },
      ...lessonTargets,
    ];
  });

  const testTargets = overview.testSeries.map((test) => ({
    id: `test:${test._id}`,
    kind: 'test' as const,
    title: test.title,
    subtitle: [test.category, `${test.durationMinutes} min`, `${test.questions.length} questions`].join(' • '),
    tab: 'tests' as const,
  }));

  const savedTargets = savedTopics.map((topic) => ({
    id: `saved:${topic.courseId}:${topic.lessonId}`,
    kind: 'saved' as const,
    title: topic.lessonTitle,
    subtitle: [topic.courseTitle, topic.moduleTitle, topic.chapterTitle, 'Saved topic'].filter(Boolean).join(' • '),
    tab: 'revision' as const,
    courseId: topic.courseId,
    lessonId: topic.lessonId,
  }));

  return [...savedTargets, ...courseTargets, ...testTargets];
};

const buildRevisionPlan = (overview: PlatformOverview, savedTopics: SavedTopic[]): RevisionDayPlan[] => {
  const today = new Date();
  const latestMock = overview.dashboard.latestMockTest;
  const weakTopics = overview.dashboard.weakTopics.slice(0, 3);
  const strongTopics = overview.dashboard.strongTopics.slice(0, 2);
  const continueCourse = overview.dashboard.continueLearning[0];
  const prioritySaved = savedTopics.slice(0, 3);
  const latestMistakes = latestMock?.solutions.filter((solution) => solution.selectedOption !== solution.correctOption).slice(0, 3) || [];

  const templates = [
    {
      title: 'Recovery sprint',
      summary: weakTopics.length > 0 ? `Repair ${weakTopics.join(', ')} while the last mock is still fresh.` : 'Start with your weakest recent test areas and clear conceptual gaps first.',
      actions: [
        latestMistakes[0] ? `Rework ${latestMistakes[0].topic} mistakes from the latest mock.` : 'Reopen your latest mock and inspect incorrect answers.',
        weakTopics[0] ? `Watch one focused lesson on ${weakTopics[0]}.` : 'Watch one focused concept lesson.',
        'Finish with one short sectional practice set.',
      ],
    },
    {
      title: 'Concept consolidation',
      summary: continueCourse ? `Push ${continueCourse.title} forward instead of opening too many parallel topics.` : 'Use a disciplined single-subject session to build momentum.',
      actions: [
        continueCourse?.continueLesson?.title ? `Resume ${continueCourse.continueLesson.title}.` : 'Resume your most recently active lesson.',
        prioritySaved[0] ? `Revise saved topic ${prioritySaved[0].lessonTitle}.` : 'Save one important lesson for later revision.',
        'Make quick handwritten notes or formula points before closing.',
      ],
    },
    {
      title: 'Speed and accuracy day',
      summary: 'Balance timed practice with clean review so speed gains do not reduce accuracy.',
      actions: [
        'Attempt today’s daily quiz without interruptions.',
        latestMock ? `Compare your pace against the latest mock score of ${latestMock.score}/${latestMock.totalMarks}.` : 'Attempt one timed mini-test.',
        weakTopics[1] ? `Close the day by revising ${weakTopics[1]}.` : 'Close the day with one weak-topic revision block.',
      ],
    },
    {
      title: 'Retention loop',
      summary: prioritySaved.length > 0 ? 'Bring saved lessons back before they become passive bookmarks.' : 'Turn active study into retained memory through repetition.',
      actions: [
        ...prioritySaved.slice(0, 2).map((topic) => `Revisit ${topic.lessonTitle} from ${topic.courseTitle}.`),
        'Test yourself without notes for 10 minutes.',
        'Update your saved list so only high-value revision items remain.',
      ],
    },
    {
      title: 'Mock readiness',
      summary: strongTopics.length > 0 ? `Lean on ${strongTopics.join(' and ')} while stabilizing weaker chapters.` : 'Use one medium-length mock block to judge readiness.',
      actions: [
        'Attempt one sectional or full mock under strict timing.',
        'Review only skipped and incorrect questions immediately after submission.',
        'Mark 3 topics that need another round this week.',
      ],
    },
  ];

  return templates.map((template, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() + index);

    return {
      dateLabel: formatShortDate(date),
      title: template.title,
      summary: template.summary,
      actions: template.actions.slice(0, 3),
    };
  });
};

const RevisionTab = ({
  overview,
  savedTopics,
  onContinueLearning,
}: {
  overview: PlatformOverview;
  savedTopics: SavedTopic[];
  onContinueLearning: (courseId: string, lessonId?: string | null) => void;
}) => {
  const revisionPlan = useMemo(() => buildRevisionPlan(overview, savedTopics), [overview, savedTopics]);
  const latestMock = overview.dashboard.latestMockTest;
  const recoveryItems = latestMock?.solutions.filter((solution) => solution.selectedOption !== solution.correctOption).slice(0, 6) || [];
  const completedSavedTopics = savedTopics.filter((topic) => topic.completed).length;

  return (
    <div className="space-y-6">
      <section className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
        <div className="rounded-[34px] bg-[linear-gradient(135deg,#101827,#12213b_44%,#1d3557_100%)] p-6 text-white shadow-[0_30px_120px_rgba(15,23,42,0.28)] sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-white/52">Revision center</p>
          <h2 className="mt-4 text-3xl font-semibold leading-tight sm:text-4xl">Turn saved lessons, weak topics, and mistakes into a daily recovery workflow.</h2>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-white/70 sm:text-base">
            This screen pulls together the real items that usually get lost after studying: unfinished lessons, bookmarked topics, and errors from your last mock.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <MetricCard title="Saved topics" value={`${savedTopics.length}`} hint="High-value lessons parked for revision" icon={BookOpen} />
            <MetricCard title="Recovered" value={`${completedSavedTopics}`} hint="Saved items already finished" icon={CheckCircle2} />
            <MetricCard title="Weak topics" value={`${overview.dashboard.weakTopics.length}`} hint="Topics currently needing active repair" icon={AlertTriangle} />
          </div>
        </div>

        <div className="rounded-[34px] border border-white/70 bg-white/92 p-6 shadow-[0_24px_90px_rgba(15,23,42,0.08)]">
          <SectionHeader title="Priority queue" caption="What deserves attention first" />
          <div className="mt-6 space-y-4">
            <div className="rounded-[24px] bg-[var(--accent-cream)] p-4">
              <p className="text-sm font-semibold text-[var(--ink)]">Next best action</p>
              <p className="mt-2 text-sm leading-7 text-[var(--ink-soft)]">
                {latestMock
                  ? `Review skipped and incorrect questions from your last mock before attempting a new one. This prevents repeating the same errors.`
                  : `Use this tab to build a revision habit: reopen one saved lesson, solve one short test, and revisit one weak topic.`}
              </p>
            </div>
            <div className="rounded-[24px] border border-[var(--line)] p-4">
              <p className="text-sm font-semibold text-[var(--ink)]">Live repair topics</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {(overview.dashboard.weakTopics.length > 0 ? overview.dashboard.weakTopics : ['Take one fresh mock to identify weak topics']).map((topic) => (
                  <span key={topic} className="rounded-full bg-[var(--accent-cream)] px-3 py-2 text-sm text-[var(--danger)]">
                    {topic}
                  </span>
                ))}
              </div>
            </div>
            {overview.dashboard.continueLearning[0] && (
              <button
                onClick={() => onContinueLearning(overview.dashboard.continueLearning[0]._id, overview.dashboard.continueLearning[0].continueLesson?.id || null)}
                className="w-full rounded-[24px] border border-[var(--line)] bg-white p-4 text-left transition hover:border-[var(--accent-rust)]"
              >
                <p className="text-sm font-semibold text-[var(--ink)]">Resume active course</p>
                <p className="mt-2 text-sm text-[var(--ink-soft)]">
                  {overview.dashboard.continueLearning[0].continueLesson?.title || overview.dashboard.continueLearning[0].title}
                </p>
                <p className="mt-3 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-rust)]">Open lesson</p>
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="rounded-[30px] border border-white/70 bg-white/92 p-6 shadow-[0_22px_70px_rgba(15,23,42,0.07)]">
          <SectionHeader title="Seven-day revision loop" caption="Practical plan" />
          <div className="mt-6 space-y-4">
            {revisionPlan.map((day) => (
              <div key={`${day.dateLabel}-${day.title}`} className="rounded-[24px] border border-[var(--line)] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ink-soft)]">{day.dateLabel}</p>
                    <h3 className="mt-2 text-lg font-semibold text-[var(--ink)]">{day.title}</h3>
                  </div>
                  <span className="rounded-full bg-[var(--accent-cream)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--accent-rust)]">
                    3 actions
                  </span>
                </div>
                <p className="mt-3 text-sm leading-7 text-[var(--ink-soft)]">{day.summary}</p>
                <div className="mt-4 grid gap-2">
                  {day.actions.map((action) => (
                    <div key={action} className="rounded-2xl bg-[var(--accent-cream)] px-4 py-3 text-sm text-[var(--ink)]">
                      {action}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div data-testid="admin-recovery-section" className="space-y-6">
          <div className="rounded-[30px] border border-white/70 bg-white/92 p-6 shadow-[0_22px_70px_rgba(15,23,42,0.07)]">
            <SectionHeader title="Mistake recovery" caption="Latest mock mistakes" />
            <div className="mt-6 space-y-3">
              {recoveryItems.length > 0 ? recoveryItems.map((item, index) => (
                <div key={`${item.questionId}-${index}`} className="rounded-[22px] bg-[var(--accent-cream)] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-[var(--ink)]">{item.topic}</p>
                    <span className="rounded-full bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--danger)]">
                      {item.selectedOption === null ? 'Skipped' : 'Incorrect'}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-[var(--ink-soft)]">{item.questionText}</p>
                  <p className="mt-3 text-xs uppercase tracking-[0.16em] text-[var(--ink-soft)]">
                    Correct option: {String.fromCharCode(65 + item.correctOption)}
                  </p>
                </div>
              )) : (
                <div className="rounded-[22px] border border-dashed border-[var(--line)] p-6 text-sm text-[var(--ink-soft)]">
                  Your latest mock recovery queue will appear here after you attempt a test.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-[30px] border border-white/70 bg-white/92 p-6 shadow-[0_22px_70px_rgba(15,23,42,0.07)]">
            <SectionHeader title="Saved topics" caption="Reopen in one tap" />
            <div className="mt-6 space-y-3">
              {savedTopics.length > 0 ? savedTopics.map((topic) => (
                <button
                  key={`${topic.courseId}:${topic.lessonId}`}
                  onClick={() => onContinueLearning(topic.courseId, topic.lessonId)}
                  className="w-full rounded-[22px] border border-[var(--line)] bg-white p-4 text-left transition hover:border-[var(--accent-rust)]"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ink-soft)]">{topic.exam}</p>
                      <h3 className="mt-2 text-base font-semibold text-[var(--ink)]">{topic.lessonTitle}</h3>
                      <p className="mt-1 text-sm text-[var(--ink-soft)]">{topic.courseTitle}</p>
                    </div>
                    <span className={cn(
                      'rounded-full px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em]',
                      topic.completed ? 'bg-[var(--success-soft)] text-[var(--success)]' : 'bg-[var(--accent-cream)] text-[var(--accent-rust)]',
                    )}>
                      {topic.completed ? 'Completed' : 'Pending'}
                    </span>
                  </div>
                </button>
              )) : (
                <div className="rounded-[22px] border border-dashed border-[var(--line)] p-6 text-sm text-[var(--ink-soft)]">
                  Save lessons from the course player and they will build your revision shelf automatically.
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

type ExamStage = 'instructions' | 'declaration' | 'exam';
type ExamWorkspaceTab = 'question' | 'symbols' | 'calculator' | 'instructions' | 'summary';
type ExamQuestionState = 'unvisited' | 'unanswered' | 'answered' | 'review' | 'answered-review';
type ExamFamily = 'ssc' | 'rrb' | 'banking' | 'default';
type ExamSection = {
  name: string;
  questionCount: number;
  startIndex: number;
  endIndex: number;
};

const examWorkspaceTabs: { id: Exclude<ExamWorkspaceTab, 'question'>; label: string }[] = [
  { id: 'symbols', label: 'Symbols' },
  { id: 'calculator', label: 'Calculator' },
  { id: 'instructions', label: 'Instructions' },
  { id: 'summary', label: 'Overall Test Summary' },
];

const questionStateLegend: { state: ExamQuestionState; label: string; description: string }[] = [
  { state: 'unvisited', label: 'Not Visited', description: 'You have not visited the question yet.' },
  { state: 'unanswered', label: 'Not Answered', description: 'You have not answered the question.' },
  { state: 'answered', label: 'Answered', description: 'You have answered the question.' },
  { state: 'review', label: 'Marked For Review', description: 'You have NOT answered the question, but have marked the question for review.' },
  { state: 'answered-review', label: 'Answered & Review', description: 'You have answered the question, but marked it for review.' },
];

const distributeSectionCounts = (totalQuestions: number, weights: number[]) => {
  if (totalQuestions <= 0 || weights.length === 0) {
    return [];
  }

  const safeWeights = weights.map((weight) => Math.max(weight, 1));
  const counts = new Array(safeWeights.length).fill(0);
  let remaining = totalQuestions;

  for (let index = 0; index < safeWeights.length && remaining > 0; index += 1) {
    counts[index] = 1;
    remaining -= 1;
  }

  if (remaining <= 0) {
    return counts;
  }

  const totalWeight = safeWeights.reduce((sum, weight) => sum + weight, 0);
  const rawAllocations = safeWeights.map((weight) => (weight / totalWeight) * remaining);
  const floorAllocations = rawAllocations.map((value) => Math.floor(value));
  const remainders = rawAllocations.map((value, index) => ({
    index,
    remainder: value - floorAllocations[index],
  })).sort((left, right) => right.remainder - left.remainder);

  floorAllocations.forEach((value, index) => {
    counts[index] += value;
  });

  let stillRemaining = remaining - floorAllocations.reduce((sum, value) => sum + value, 0);

  for (let index = 0; index < remainders.length && stillRemaining > 0; index += 1) {
    counts[remainders[index].index] += 1;
    stillRemaining -= 1;
  }

  return counts;
};

const buildExamSections = (test: MockTest): ExamSection[] => {
  if (test.questions.length === 0) {
    return [];
  }

  const examSource = `${test.category} ${test.title} ${test.type}`.toLowerCase();
  const shouldForceJeThreePartLayout = examSource.includes('ssc je');

  const declaredSections = shouldForceJeThreePartLayout
    ? [
      { name: 'General Intelligence and Reasoning', questions: 1 },
      { name: 'General Awareness', questions: 1 },
      { name: 'General Engineering', questions: 2 },
    ]
    : test.sectionBreakup.length > 0
      ? test.sectionBreakup
      : [{ name: 'Section 1', questions: test.questions.length }];

  const declaredTotal = declaredSections.reduce((sum, section) => sum + Math.max(section.questions, 0), 0);

  const counts = declaredTotal === test.questions.length
    ? declaredSections.map((section) => Math.max(section.questions, 0))
    : distributeSectionCounts(
      test.questions.length,
      declaredSections.map((section) => Math.max(section.questions, 1)),
    );

  let cursor = 0;
  return declaredSections
    .map((section, index) => {
      const questionCount = counts[index] || 0;
      if (questionCount <= 0) {
        return null;
      }

      const startIndex = cursor;
      const endIndex = Math.min(cursor + questionCount - 1, test.questions.length - 1);
      cursor = endIndex + 1;

      return {
        name: section.name,
        questionCount: endIndex - startIndex + 1,
        startIndex,
        endIndex,
      };
    })
    .filter((section): section is ExamSection => Boolean(section));
};

const getExamFamily = (test: MockTest): ExamFamily => {
  const source = `${test.category} ${test.title} ${test.type}`.toLowerCase();

  if (source.includes('bank') || source.includes('ibps') || source.includes('sbi') || source.includes('clerk') || source.includes('po')) {
    return 'banking';
  }

  if (source.includes('rrb') || source.includes('railway')) {
    return 'rrb';
  }

  if (source.includes('ssc')) {
    return 'ssc';
  }

  return 'default';
};

const buildMockRollNumber = (userId: string | undefined, testId: string) => {
  const source = `${userId || 'candidate'}${testId}`;
  const digits = source
    .split('')
    .map((character) => String(character.charCodeAt(0) % 10))
    .join('');

  return digits.slice(0, 12).padEnd(12, '0');
};

const getExamFamilyLabel = (family: ExamFamily) => {
  if (family === 'ssc') {
    return 'SSC CBT Interface';
  }

  if (family === 'rrb') {
    return 'RRB CBT Interface';
  }

  if (family === 'banking') {
    return 'Banking CBT Interface';
  }

  return 'CBT Exam Interface';
};

const getExamFamilySupportCopy = (family: ExamFamily) => {
  if (family === 'ssc') {
    return 'Built to feel like a full SSC exam simulation with instructions, declaration, and a real question palette.';
  }

  if (family === 'rrb') {
    return 'Structured like a railway CBT experience so topic tests and full mocks feel operational, not generic.';
  }

  if (family === 'banking') {
    return 'Prepared for banking-style mocks with declaration, language selection, and a high-focus solving layout.';
  }

  return 'Prepared as a clean CBT workflow so learners move from instructions to declaration to the actual test environment.';
};

const getExamInstructionChecklist = (test: MockTest) => [
  `The exam timer starts only after you click "I am ready to begin" and runs continuously until submission or timeout.`,
  `This mock contains ${test.questions.length} questions for a maximum of ${test.totalMarks} marks in ${test.durationMinutes} minutes.`,
  `Use Save & Next to store your answer and move ahead. Use Mark for Review when you want to revisit a question before final submission.`,
  `You may move between questions through the palette at the right side. Status colors always update live while you attempt the paper.`,
  `Negative marking is ${test.negativeMarking} for every incorrect answer. Unattempted questions are not penalized.`,
  'The final scorecard and explanations will appear immediately after you submit the paper.',
];

const getDeclarationChecklist = (test: MockTest) => [
  `The test contains ${test.questions.length} total questions.`,
  `Each question carries its configured marks and uses the same negative marking settings as the real mock.`,
  `You are expected to complete the exam in ${test.durationMinutes} minutes without refreshing or closing the window.`,
  'Changing questions from the palette does not auto-save the current response unless you use Save & Next.',
  'Marked for review questions stay highlighted so you can revisit them before the timer ends.',
  'This exam can be submitted any time before the timer reaches zero.',
];

const getExamQuestionState = (
  questionId: string,
  answers: Record<string, number>,
  visitedQuestions: Record<string, boolean>,
  reviewQuestions: Record<string, boolean>,
): ExamQuestionState => {
  const isAnswered = answers[questionId] !== undefined;
  const isVisited = Boolean(visitedQuestions[questionId]);
  const isReview = Boolean(reviewQuestions[questionId]);

  if (isReview && isAnswered) {
    return 'answered-review';
  }

  if (isReview) {
    return 'review';
  }

  if (isAnswered) {
    return 'answered';
  }

  if (isVisited) {
    return 'unanswered';
  }

  return 'unvisited';
};

const getQuestionStateButtonClasses = (state: ExamQuestionState, active: boolean) => cn(
  'relative flex h-10 w-full min-w-[42px] items-center justify-center border text-sm font-semibold transition',
  active && 'ring-2 ring-[#2598e8] ring-offset-2 ring-offset-white',
  state === 'unvisited' && 'rounded-md border-slate-500 bg-white text-slate-700',
  state === 'unanswered' && 'rounded-[12px] border-[#c64a2f] bg-[#c64a2f] text-white',
  state === 'answered' && 'rounded-[12px] border-[#2dad5c] bg-[#2dad5c] text-white',
  state === 'review' && 'rounded-[999px] border-[#8c53d8] bg-[#8c53d8] text-white',
  state === 'answered-review' && 'rounded-[999px] border-[#8c53d8] bg-[#8c53d8] text-white',
);

const TestPlayer = ({
  test,
  onClose,
  onSubmitted,
}: {
  test: MockTest;
  onClose: () => void;
  onSubmitted: (result: TestAttemptResult) => void;
}) => {
  const { user } = useAuth();
  const stageContentRef = useRef<HTMLElement | null>(null);
  const examMainRef = useRef<HTMLElement | null>(null);
  const [stage, setStage] = useState<ExamStage>('instructions');
  const [workspaceTab, setWorkspaceTab] = useState<ExamWorkspaceTab>('question');
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [visitedQuestions, setVisitedQuestions] = useState<Record<string, boolean>>({});
  const [reviewQuestions, setReviewQuestions] = useState<Record<string, boolean>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(test.durationMinutes * 60);
  const [submitting, setSubmitting] = useState(false);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState('English');
  const [declarationAccepted, setDeclarationAccepted] = useState(false);
  const [questionZoom, setQuestionZoom] = useState(1);
  const [calculatorExpression, setCalculatorExpression] = useState('');
  const [calculatorResult, setCalculatorResult] = useState('0');

  const examFamily = useMemo(() => getExamFamily(test), [test]);
  const examSections = useMemo(() => buildExamSections(test), [test]);
  const rollNumber = useMemo(() => buildMockRollNumber(user?._id, test._id), [test._id, user?._id]);
  const instructionChecklist = useMemo(() => getExamInstructionChecklist(test), [test]);
  const declarationChecklist = useMemo(() => getDeclarationChecklist(test), [test]);
  const currentQuestion = test.questions[currentIndex];
  const questionTextClass = ['text-lg leading-8', 'text-xl leading-9', 'text-2xl leading-10'][questionZoom];

  const currentSection = useMemo(() => (
    examSections.find((section) => currentIndex >= section.startIndex && currentIndex <= section.endIndex)
    || examSections[0]
    || null
  ), [currentIndex, examSections]);

  const currentSectionIndex = currentSection ? examSections.findIndex((section) => section.name === currentSection.name) : 0;
  const currentSectionLabel = `PART-${String.fromCharCode(65 + Math.max(currentSectionIndex, 0))}`;
  const currentQuestionNumberInSection = currentSection ? (currentIndex - currentSection.startIndex + 1) : (currentIndex + 1);

  const questionStates = useMemo(() => test.questions.reduce<Record<string, ExamQuestionState>>((stateMap, question) => {
    stateMap[question.id] = getExamQuestionState(question.id, answers, visitedQuestions, reviewQuestions);
    return stateMap;
  }, {}), [answers, reviewQuestions, test.questions, visitedQuestions]);

  const statusCounts = useMemo(() => test.questions.reduce((counts, question) => {
    const state = questionStates[question.id];
    if (state === 'answered') {
      counts.answered += 1;
    } else if (state === 'answered-review') {
      counts.answeredReview += 1;
    } else if (state === 'review') {
      counts.review += 1;
    } else if (state === 'unanswered') {
      counts.unanswered += 1;
    } else {
      counts.unvisited += 1;
    }

    return counts;
  }, {
    answered: 0,
    answeredReview: 0,
    review: 0,
    unanswered: 0,
    unvisited: 0,
  }), [questionStates, test.questions]);

  const answeredCount = statusCounts.answered + statusCounts.answeredReview;
  const attentionCount = statusCounts.unanswered + statusCounts.review + statusCounts.unvisited;

  useEffect(() => {
    if (stage !== 'exam' || !currentQuestion) {
      return;
    }

    setVisitedQuestions((current) => (
      current[currentQuestion.id]
        ? current
        : { ...current, [currentQuestion.id]: true }
    ));
  }, [currentQuestion, stage]);

  useEffect(() => {
    if (stage !== 'exam' || submitting) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setTimeLeft((current) => (current > 0 ? current - 1 : 0));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [stage, submitting]);

  useEffect(() => {
    if (stage === 'exam' && timeLeft === 0 && !submitting) {
      void submitTest(true);
    }
  }, [stage, submitting, timeLeft]);

  useEffect(() => {
    stageContentRef.current?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    examMainRef.current?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [stage, workspaceTab, currentIndex]);

  const handleExit = () => {
    if (stage === 'exam' && startedAt && !submitting) {
      const confirmed = window.confirm('Exit this exam interface now? Your current mock progress will not be submitted.');
      if (!confirmed) {
        return;
      }
    }

    onClose();
  };

  const goToQuestion = (questionIndex: number) => {
    setCurrentIndex(Math.min(Math.max(questionIndex, 0), Math.max(test.questions.length - 1, 0)));
    setWorkspaceTab('question');
  };

  const saveCurrentResponse = () => {
    if (!currentQuestion) {
      return;
    }

    setVisitedQuestions((current) => ({ ...current, [currentQuestion.id]: true }));
  };

  const moveToNextQuestion = () => {
    if (currentIndex < test.questions.length - 1) {
      goToQuestion(currentIndex + 1);
    }
  };

  const submitTest = async (forced = false) => {
    if (!user || submitting) {
      return;
    }

    if (!forced) {
      const confirmed = window.confirm('Submit this mock test now? You will move to the scorecard immediately after submission.');
      if (!confirmed) {
        return;
      }
    }

    setSubmitting(true);
    try {
      const effectiveStartedAt = startedAt || new Date().toISOString();
      const result = await EduService.submitMockTest(test._id, answers, effectiveStartedAt);
      onSubmitted(result);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveAndNext = () => {
    saveCurrentResponse();

    if (currentIndex === test.questions.length - 1) {
      return;
    }

    moveToNextQuestion();
  };

  const handleToggleReview = () => {
    if (!currentQuestion) {
      return;
    }

    const isMarked = Boolean(reviewQuestions[currentQuestion.id]);
    setVisitedQuestions((current) => ({ ...current, [currentQuestion.id]: true }));
    setReviewQuestions((current) => {
      const nextState = { ...current };
      if (isMarked) {
        delete nextState[currentQuestion.id];
      } else {
        nextState[currentQuestion.id] = true;
      }
      return nextState;
    });

    if (!isMarked && currentIndex < test.questions.length - 1) {
      moveToNextQuestion();
    }
  };

  const handleClearResponse = () => {
    if (!currentQuestion) {
      return;
    }

    setAnswers((current) => {
      const nextAnswers = { ...current };
      delete nextAnswers[currentQuestion.id];
      return nextAnswers;
    });
    setVisitedQuestions((current) => ({ ...current, [currentQuestion.id]: true }));
  };

  const appendCalculatorValue = (value: string) => {
    setCalculatorExpression((current) => `${current}${value}`);
  };

  const evaluateCalculator = () => {
    const normalizedExpression = calculatorExpression
      .replace(/x/g, '*')
      .replace(/X/g, '*')
      .replace(/÷/g, '/');

    if (!normalizedExpression.trim()) {
      setCalculatorResult('0');
      return;
    }

    if (!/^[0-9+\-*/().\s]+$/.test(normalizedExpression)) {
      setCalculatorResult('Invalid');
      return;
    }

    try {
      const value = Function(`"use strict"; return (${normalizedExpression});`)();
      setCalculatorResult(Number.isFinite(value) ? String(value) : 'Invalid');
    } catch {
      setCalculatorResult('Invalid');
    }
  };

  const candidatePanel = (
    <aside className="border-l border-slate-200 bg-[#f5f8fc] p-6">
      <div className="rounded-[30px] bg-white p-6 text-center shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
        <div className="mx-auto flex h-28 w-28 items-center justify-center rounded-full bg-sky-100 text-sky-600">
          <UserCircle2 className="h-16 w-16" />
        </div>
        <p className="mt-5 text-4xl font-semibold text-slate-900">{user?.name || 'Candidate'}</p>
        <p className="mt-2 text-sm font-medium uppercase tracking-[0.18em] text-slate-500">{test.category}</p>
        <div className="mt-6 grid gap-3 text-left">
          <div className="rounded-2xl bg-slate-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Roll Number</p>
            <p className="mt-2 text-lg font-semibold text-slate-900">{rollNumber}</p>
          </div>
          <div className="rounded-2xl bg-slate-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Duration</p>
            <p className="mt-2 text-lg font-semibold text-slate-900">{test.durationMinutes} mins</p>
          </div>
          <div className="rounded-2xl bg-slate-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Sections</p>
            <p className="mt-2 text-lg font-semibold text-slate-900">{examSections.length || 1}</p>
          </div>
        </div>
      </div>
      <div className="mt-5 rounded-[28px] bg-white p-5 shadow-[0_24px_60px_rgba(15,23,42,0.06)]">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Interface style</p>
        <p className="mt-3 text-lg font-semibold text-slate-900">{getExamFamilyLabel(examFamily)}</p>
        <p className="mt-3 text-sm leading-7 text-slate-600">{getExamFamilySupportCopy(examFamily)}</p>
      </div>
    </aside>
  );

  const renderQuestionView = () => {
    if (!currentQuestion) {
      return (
        <div className="rounded-[28px] border border-slate-200 bg-white p-8 text-slate-600">
          No questions are available in this mock test yet.
        </div>
      );
    }

    const currentQuestionState = questionStates[currentQuestion.id];

    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-lg bg-green-600 px-4 py-2 text-lg font-semibold text-white">{currentSectionLabel}</span>
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">{currentSection?.name || 'Section'}</p>
            <p className="mt-1 text-sm text-slate-600">
              Question {currentIndex + 1} of {test.questions.length}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleToggleReview}
            className="rounded-lg bg-[#2f69d9] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#275bbf]"
          >
            {currentQuestionState === 'review' || currentQuestionState === 'answered-review' ? 'Unmark Review' : 'Mark for Review'}
          </button>
          <button
            onClick={handleSaveAndNext}
            className="rounded-lg bg-[#2f69d9] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#275bbf]"
          >
            {currentIndex === test.questions.length - 1 ? 'Save Response' : 'Save & Next'}
          </button>
          <button
            onClick={() => void submitTest()}
            disabled={submitting}
            className="rounded-lg bg-[#2f69d9] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#275bbf] disabled:opacity-60"
          >
            {submitting ? 'Submitting...' : 'Submit Test'}
          </button>
        </div>

        <div className="rounded-[30px] border border-slate-200 bg-white shadow-[0_18px_42px_rgba(15,23,42,0.06)]">
          <div className="flex flex-col gap-4 border-b border-slate-200 px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-3xl font-semibold text-slate-900">Question No. {currentIndex + 1}</p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                <span className="rounded-full bg-slate-100 px-3 py-2">{currentQuestion.topic}</span>
                <span className="rounded-full bg-slate-100 px-3 py-2">+{currentQuestion.marks} marks</span>
                <span className="rounded-full bg-slate-100 px-3 py-2">-{test.negativeMarking} negative</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-sm text-slate-600">
                <span className="font-semibold">Select Language</span>
                <select
                  value={selectedLanguage}
                  onChange={(event) => setSelectedLanguage(event.target.value)}
                  className="bg-transparent outline-none"
                >
                  <option value="English">English</option>
                  <option value="Hindi">Hindi</option>
                </select>
              </div>
              <button className="rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600">
                Report
              </button>
            </div>
          </div>

          <div className="px-6 py-6">
            <div className="rounded-[28px] border border-slate-200">
              <div className="border-b border-slate-200 px-6 py-6">
                <p className={cn('font-medium text-slate-900', questionTextClass)}>{currentQuestion.questionText}</p>
              </div>

              <div className="divide-y divide-slate-200">
                {currentQuestion.options.map((option, optionIndex) => {
                  const isSelected = answers[currentQuestion.id] === optionIndex;

                  return (
                    <button
                      key={`${currentQuestion.id}-${option}`}
                      onClick={() => {
                        setAnswers((current) => ({ ...current, [currentQuestion.id]: optionIndex }));
                        setVisitedQuestions((current) => ({ ...current, [currentQuestion.id]: true }));
                        setWorkspaceTab('question');
                      }}
                      className={cn(
                        'grid w-full grid-cols-[84px_minmax(0,1fr)] items-center text-left transition',
                        isSelected ? 'bg-sky-50' : 'bg-white hover:bg-slate-50',
                      )}
                    >
                      <div className="flex h-full items-center justify-center border-r border-slate-200 py-6">
                        <div className={cn(
                          'flex h-11 w-11 items-center justify-center rounded-full border text-lg font-semibold',
                          isSelected
                            ? 'border-sky-500 bg-sky-500 text-white'
                            : 'border-slate-300 bg-white text-slate-600',
                        )}>
                          {String.fromCharCode(65 + optionIndex)}
                        </div>
                      </div>
                      <div className="px-6 py-6 text-lg leading-8 text-slate-800">{option}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            onClick={() => goToQuestion(currentIndex - 1)}
            disabled={currentIndex === 0}
            className="rounded-lg border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 disabled:opacity-50"
          >
            Previous
          </button>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleClearResponse}
              className="rounded-lg border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700"
            >
              Clear Response
            </button>
            <button
              onClick={handleSaveAndNext}
              className="rounded-lg bg-[#2f69d9] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#275bbf]"
            >
              {currentIndex === test.questions.length - 1 ? 'Save Response' : 'Save & Next'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderSymbolsView = () => (
    <div className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_18px_42px_rgba(15,23,42,0.05)]">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Status legend</p>
          <h3 className="mt-2 text-3xl font-semibold text-slate-900">Question palette symbols</h3>
        </div>
        <button
          onClick={() => setWorkspaceTab('question')}
          className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
        >
          Return to question
        </button>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {questionStateLegend.map((item) => (
          <div key={item.state} className="rounded-[24px] border border-slate-200 bg-slate-50 p-5">
            <div className="flex items-center gap-4">
              <div className={getQuestionStateButtonClasses(item.state, false)}>1</div>
              <div>
                <p className="text-lg font-semibold text-slate-900">{item.label}</p>
                <p className="mt-2 text-sm leading-7 text-slate-600">{item.description}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-[24px] bg-[#f6fbff] p-5">
        <p className="text-sm font-semibold text-slate-900">How to use the controls</p>
        <div className="mt-3 space-y-3 text-sm leading-7 text-slate-600">
          <p>Save & Next stores the current answer and moves you forward in the paper.</p>
          <p>Mark for Review flags the question so it stands out in the palette and summary before final submission.</p>
          <p>Total answered, unvisited, and review counts update in real time on the right panel.</p>
        </div>
      </div>
    </div>
  );

  const renderInstructionsView = () => (
    <div className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_18px_42px_rgba(15,23,42,0.05)]">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Exam guide</p>
          <h3 className="mt-2 text-3xl font-semibold text-slate-900">Instructions</h3>
        </div>
        <button
          onClick={() => setWorkspaceTab('question')}
          className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
        >
          Return to question
        </button>
      </div>

      <ol className="mt-6 space-y-4 pl-6 text-base leading-8 text-slate-700">
        {instructionChecklist.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ol>

      <div className="mt-6 rounded-[24px] bg-[#f9fbff] p-5">
        <p className="text-sm font-semibold text-slate-900">Sections in this paper</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {examSections.map((section) => (
            <span key={section.name} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700">
              {section.name} • {section.questionCount} questions
            </span>
          ))}
        </div>
      </div>
    </div>
  );

  const renderSummaryView = () => {
    const pendingQuestions = test.questions
      .map((question, index) => ({
        question,
        index,
        state: questionStates[question.id],
      }))
      .filter((item) => item.state !== 'answered' && item.state !== 'answered-review');

    return (
      <div className="space-y-6">
        <div className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_18px_42px_rgba(15,23,42,0.05)]">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Review snapshot</p>
              <h3 className="mt-2 text-3xl font-semibold text-slate-900">Overall test summary</h3>
            </div>
            <button
              onClick={() => setWorkspaceTab('question')}
              className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
            >
              Return to question
            </button>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-5">
            <div className="rounded-[24px] bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Answered</p>
              <p className="mt-2 text-3xl font-semibold text-emerald-600">{answeredCount}</p>
            </div>
            <div className="rounded-[24px] bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Not Answered</p>
              <p className="mt-2 text-3xl font-semibold text-orange-500">{statusCounts.unanswered}</p>
            </div>
            <div className="rounded-[24px] bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Review</p>
              <p className="mt-2 text-3xl font-semibold text-violet-600">{statusCounts.review + statusCounts.answeredReview}</p>
            </div>
            <div className="rounded-[24px] bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Unvisited</p>
              <p className="mt-2 text-3xl font-semibold text-slate-700">{statusCounts.unvisited}</p>
            </div>
            <div className="rounded-[24px] bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Attention</p>
              <p className="mt-2 text-3xl font-semibold text-rose-500">{attentionCount}</p>
            </div>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_18px_42px_rgba(15,23,42,0.05)]">
            <p className="text-lg font-semibold text-slate-900">Section wise coverage</p>
            <div className="mt-5 space-y-4">
              {examSections.map((section, sectionIndex) => {
                const sectionQuestions = test.questions.slice(section.startIndex, section.endIndex + 1);
                const sectionAnswered = sectionQuestions.filter((question) => {
                  const state = questionStates[question.id];
                  return state === 'answered' || state === 'answered-review';
                }).length;

                return (
                  <div key={section.name} className="rounded-[24px] border border-slate-200 bg-slate-50 p-5">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">
                          PART-{String.fromCharCode(65 + sectionIndex)}
                        </p>
                        <p className="mt-1 text-xl font-semibold text-slate-900">{section.name}</p>
                        <p className="mt-2 text-sm text-slate-600">{sectionAnswered}/{section.questionCount} answered</p>
                      </div>
                      <button
                        onClick={() => goToQuestion(section.startIndex)}
                        className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                      >
                        Open section
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_18px_42px_rgba(15,23,42,0.05)]">
            <p className="text-lg font-semibold text-slate-900">Questions needing attention</p>
            <div className="mt-5 space-y-3">
              {pendingQuestions.length > 0 ? pendingQuestions.map((item) => (
                <button
                  key={item.question.id}
                  onClick={() => goToQuestion(item.index)}
                  className="flex w-full items-center justify-between rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4 text-left transition hover:border-sky-400 hover:bg-sky-50"
                >
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Question {item.index + 1}</p>
                    <p className="mt-1 text-sm text-slate-600">{questionStateLegend.find((legend) => legend.state === item.state)?.label}</p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-slate-400" />
                </button>
              )) : (
                <div className="rounded-[20px] bg-emerald-50 px-4 py-5 text-sm font-medium text-emerald-700">
                  Every question has been attempted or saved for review. You are ready for final submission.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderCalculatorView = () => (
    <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
      <div className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_18px_42px_rgba(15,23,42,0.05)]">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Exam utility</p>
            <h3 className="mt-2 text-3xl font-semibold text-slate-900">Calculator</h3>
          </div>
          <button
            onClick={() => setWorkspaceTab('question')}
            className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
          >
            Return to question
          </button>
        </div>

        <div className="mt-6 rounded-[26px] bg-slate-900 p-6 text-white">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/60">Expression</p>
          <p className="mt-3 min-h-[56px] break-words text-2xl font-semibold">{calculatorExpression || '0'}</p>
          <div className="mt-5 border-t border-white/10 pt-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/60">Result</p>
            <p className="mt-3 text-3xl font-semibold text-sky-300">{calculatorResult}</p>
          </div>
        </div>

        <p className="mt-5 text-sm leading-7 text-slate-600">
          This quick calculator stays inside the exam screen so learners do not need to leave the paper for rough arithmetic.
        </p>
      </div>

      <div className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_18px_42px_rgba(15,23,42,0.05)]">
        <div className="grid grid-cols-4 gap-3">
          {['7', '8', '9', '/', '4', '5', '6', '*', '1', '2', '3', '-', '0', '.', '(', ')'].map((item) => (
            <button
              key={item}
              onClick={() => appendCalculatorValue(item)}
              className="rounded-2xl bg-slate-100 px-4 py-4 text-lg font-semibold text-slate-900 transition hover:bg-slate-200"
            >
              {item}
            </button>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3">
          <button
            onClick={() => {
              setCalculatorExpression('');
              setCalculatorResult('0');
            }}
            className="rounded-2xl bg-rose-100 px-4 py-4 text-lg font-semibold text-rose-700 transition hover:bg-rose-200"
          >
            C
          </button>
          <button
            onClick={() => setCalculatorExpression((current) => current.slice(0, -1))}
            className="rounded-2xl bg-amber-100 px-4 py-4 text-lg font-semibold text-amber-700 transition hover:bg-amber-200"
          >
            DEL
          </button>
          <button
            onClick={() => appendCalculatorValue('+')}
            className="rounded-2xl bg-slate-100 px-4 py-4 text-lg font-semibold text-slate-900 transition hover:bg-slate-200"
          >
            +
          </button>
        </div>
        <button
          onClick={evaluateCalculator}
          className="mt-4 flex w-full items-center justify-center rounded-2xl bg-[#2f69d9] px-5 py-4 text-lg font-semibold text-white transition hover:bg-[#275bbf]"
        >
          =
        </button>
      </div>
    </div>
  );

  const renderWorkspace = () => {
    if (workspaceTab === 'symbols') {
      return renderSymbolsView();
    }

    if (workspaceTab === 'calculator') {
      return renderCalculatorView();
    }

    if (workspaceTab === 'instructions') {
      return renderInstructionsView();
    }

    if (workspaceTab === 'summary') {
      return renderSummaryView();
    }

    return renderQuestionView();
  };

  const examScreen = (
    <div className="flex h-full flex-col bg-[#f3f7fb]">
      <div className="border-b border-slate-200 bg-white px-6 py-4 shadow-sm">
        <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)_auto] xl:items-center">
          <div>
            <BrandLogo tone="light" size="sm" />
            <p className="mt-2 text-lg font-semibold text-slate-900">{test.title}</p>
          </div>
          <div className="text-center">
            <h3 className="text-[38px] font-semibold text-slate-900">{test.title}</h3>
            <p className="mt-2 text-xl font-semibold text-slate-700">Roll No : {rollNumber}</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <button
              onClick={() => setQuestionZoom((current) => Math.min(current + 1, 2))}
              className="rounded-xl bg-[#2f69d9] px-4 py-3 text-sm font-semibold text-white"
            >
              Zoom (+)
            </button>
            <button
              onClick={() => setQuestionZoom((current) => Math.max(current - 1, 0))}
              className="rounded-xl bg-[#2f69d9] px-4 py-3 text-sm font-semibold text-white"
            >
              Zoom (-)
            </button>
            <div className="rounded-[20px] bg-[#fff8bf] px-5 py-3 text-right">
              <p className="text-sm font-semibold text-slate-700">Time Left</p>
              <p className="text-4xl font-semibold text-red-600">{formatTimeLeft(timeLeft).replace(':', ' : ')}</p>
            </div>
            <button
              onClick={handleExit}
              className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700"
            >
              Exit Test
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex flex-wrap items-center gap-6">
          {examWorkspaceTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setWorkspaceTab(tab.id)}
              className={cn(
                'text-xl font-semibold underline-offset-4 transition',
                workspaceTab === tab.id ? 'text-[#c34b32] underline' : 'text-[#1f7ecb] hover:text-[#185d97]',
              )}
            >
              {tab.label.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="rounded-full bg-[#fff7ce] px-4 py-3 text-lg font-semibold text-slate-800">
          Total Questions Answered: <span className="text-[#ff2400]">{answeredCount}</span>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 xl:grid-cols-[minmax(0,1fr)_360px]">
        <main className="overflow-y-auto px-6 py-6">
          {renderWorkspace()}
        </main>

        <aside className="border-l border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-5 py-5">
            <div className="flex flex-col items-center rounded-[28px] bg-[#f5f8fc] px-4 py-6 text-center">
              <div className="flex h-24 w-24 items-center justify-center rounded-full bg-sky-100 text-sky-600">
                <UserCircle2 className="h-14 w-14" />
              </div>
              <p className="mt-4 text-4xl font-semibold text-slate-900">{user?.name || 'Candidate'}</p>
              <p className="mt-2 text-sm font-medium uppercase tracking-[0.18em] text-slate-500">{test.category}</p>
            </div>
          </div>

          <div className="h-[calc(100vh-212px)] overflow-y-auto px-5 py-5">
            <div className="rounded-[28px] border border-slate-200 bg-white p-4">
              <p className="text-3xl font-semibold text-slate-900">Question palette</p>
              <div className="mt-5 space-y-5">
                {examSections.map((section) => (
                  <div key={section.name}>
                    <div className="flex items-center gap-3">
                      <div className="h-0 w-0 border-y-[12px] border-y-transparent border-l-[18px] border-l-sky-500" />
                      <p className="text-lg font-semibold text-slate-900">{section.name}</p>
                    </div>
                    <div className="mt-4 grid grid-cols-4 gap-3">
                      {test.questions.slice(section.startIndex, section.endIndex + 1).map((question, sectionQuestionIndex) => {
                        const questionIndex = section.startIndex + sectionQuestionIndex;
                        const questionState = questionStates[question.id];

                        return (
                          <button
                            key={question.id}
                            onClick={() => goToQuestion(questionIndex)}
                            className={getQuestionStateButtonClasses(questionState, currentIndex === questionIndex)}
                          >
                            {questionIndex + 1}
                            {questionState === 'answered-review' && (
                              <CheckCircle2 className="absolute -right-1 -top-1 h-4 w-4 rounded-full bg-white text-emerald-500" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-5 rounded-[28px] border border-slate-300 bg-white">
              <div className="border-b border-slate-300 bg-slate-100 px-4 py-3 text-center text-2xl font-semibold text-slate-900">
                Analysis
              </div>
              <div className="divide-y divide-slate-200 text-lg">
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-slate-700">Answered</span>
                  <span className="font-semibold text-[#ffb300]">{answeredCount}</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-slate-700">Not Answered</span>
                  <span className="font-semibold text-[#ffb300]">{statusCounts.unanswered}</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-slate-700">Mark for Review</span>
                  <span className="font-semibold text-[#ffb300]">{statusCounts.review}</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-slate-700">Answered & Review</span>
                  <span className="font-semibold text-[#ffb300]">{statusCounts.answeredReview}</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-slate-700">Not Visited</span>
                  <span className="font-semibold text-[#ffb300]">{statusCounts.unvisited}</span>
                </div>
              </div>
            </div>

            <button
              onClick={() => void submitTest()}
              disabled={submitting}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-[20px] bg-[#2f69d9] px-5 py-4 text-lg font-semibold text-white transition hover:bg-[#275bbf] disabled:opacity-60"
            >
              {submitting ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <ClipboardCheck className="h-5 w-5" />}
              Submit Test
            </button>
          </div>
        </aside>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-40 bg-slate-900/70 px-3 py-3 backdrop-blur sm:px-5 sm:py-5">
      <div className="mx-auto flex h-full max-w-[1840px] flex-col overflow-hidden rounded-[32px] border border-white/20 bg-white shadow-[0_30px_120px_rgba(2,8,23,0.32)]">
        {stage === 'instructions' && (
          <div className="flex h-full flex-col bg-[#f3f7fb]">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-white px-6 py-5">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-100 text-sky-600">
                  <ClipboardCheck className="h-7 w-7" />
                </div>
                <div>
                  <BrandLogo tone="light" size="sm" />
                  <p className="mt-1 text-sm font-medium uppercase tracking-[0.2em] text-slate-500">{getExamFamilyLabel(examFamily)}</p>
                </div>
              </div>
              <button
                onClick={handleExit}
                data-testid="test-player-close"
                className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
              >
                Go to tests
              </button>
            </div>

            <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_320px]">
              <section className="overflow-y-auto px-6 py-6">
                <div className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-[0_24px_60px_rgba(15,23,42,0.06)]">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">General instructions</p>
                  <h2 className="mt-3 text-5xl font-semibold text-slate-900">{test.title}</h2>
                  <div className="mt-6 grid gap-4 md:grid-cols-3">
                    <div className="rounded-[24px] bg-slate-50 p-5">
                      <p className="text-sm text-slate-500">Duration</p>
                      <p className="mt-2 text-3xl font-semibold text-slate-900">{test.durationMinutes} mins</p>
                    </div>
                    <div className="rounded-[24px] bg-slate-50 p-5">
                      <p className="text-sm text-slate-500">Maximum marks</p>
                      <p className="mt-2 text-3xl font-semibold text-slate-900">{test.totalMarks}</p>
                    </div>
                    <div className="rounded-[24px] bg-slate-50 p-5">
                      <p className="text-sm text-slate-500">Negative marking</p>
                      <p className="mt-2 text-3xl font-semibold text-slate-900">{test.negativeMarking}</p>
                    </div>
                  </div>

                  <ol className="mt-8 space-y-4 pl-6 text-lg leading-8 text-slate-700">
                    {instructionChecklist.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ol>

                  <div className="mt-8 rounded-[28px] border border-slate-200 bg-[#f8fbff] p-6">
                    <p className="text-lg font-semibold text-slate-900">Question palette meanings</p>
                    <div className="mt-5 space-y-4">
                      {questionStateLegend.map((item) => (
                        <div key={item.state} className="flex items-center gap-4">
                          <div className={getQuestionStateButtonClasses(item.state, false)}>1</div>
                          <p className="text-base text-slate-700">{item.description}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </section>

              {candidatePanel}
            </div>

            <div className="flex items-center justify-between border-t border-slate-200 bg-white px-6 py-4">
              <button
                onClick={handleExit}
                className="rounded-xl border border-slate-300 px-5 py-3 text-lg font-semibold text-slate-700"
              >
                Go to Tests
              </button>
              <button
                onClick={() => setStage('declaration')}
                className="rounded-xl bg-[#2f69d9] px-6 py-3 text-lg font-semibold text-white transition hover:bg-[#275bbf]"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {stage === 'declaration' && (
          <div className="flex h-full flex-col bg-[#f3f7fb]">
            <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_320px]">
              <section className="overflow-y-auto bg-white px-6 py-8">
                <div className="mx-auto max-w-6xl">
                  <div className="text-center">
                    <h2 className="text-6xl font-semibold text-slate-900">{test.title}</h2>
                  </div>

                  <div className="mt-8 flex flex-wrap items-center justify-between gap-4 text-2xl font-semibold text-slate-700">
                    <p>Duration: {test.durationMinutes} Mins</p>
                    <p>Maximum Marks: {test.totalMarks}</p>
                  </div>

                  <div className="mt-8">
                    <p className="text-3xl font-semibold text-slate-900">Read the following instructions carefully.</p>
                    <ol className="mt-5 space-y-4 pl-8 text-xl leading-9 text-slate-700">
                      {declarationChecklist.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ol>
                  </div>

                  <div className="mt-10 rounded-[28px] border border-slate-200 p-6">
                    <div className="flex flex-wrap items-center gap-4">
                      <label className="text-2xl font-semibold text-slate-900">Choose your default language</label>
                      <select
                        value={selectedLanguage}
                        onChange={(event) => setSelectedLanguage(event.target.value)}
                        className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-xl text-slate-900 outline-none"
                      >
                        <option value="English">English</option>
                        <option value="Hindi">Hindi</option>
                      </select>
                    </div>
                    <p className="mt-4 text-xl leading-8 text-rose-600">
                      Questions currently appear in the selected app language. This selection can be changed later while you are inside the paper.
                    </p>
                  </div>

                  <div className="mt-8 border-t border-slate-200 pt-6">
                    <p className="text-2xl font-semibold text-slate-900">Declaration</p>
                    <label className="mt-5 flex items-start gap-4 text-xl leading-9 text-slate-700">
                      <input
                        type="checkbox"
                        checked={declarationAccepted}
                        onChange={(event) => setDeclarationAccepted(event.target.checked)}
                        className="mt-2 h-6 w-6 rounded border-slate-300"
                      />
                      <span>
                        I have read all the instructions carefully and I am ready to begin this mock test in the real exam-style interface.
                      </span>
                    </label>
                  </div>
                </div>
              </section>

              {candidatePanel}
            </div>

            <div className="flex items-center justify-between border-t border-slate-200 bg-white px-6 py-4">
              <button
                onClick={() => setStage('instructions')}
                className="rounded-xl border border-slate-300 px-5 py-3 text-lg font-semibold text-slate-700"
              >
                Previous
              </button>
              <button
                onClick={() => {
                  setStartedAt(new Date().toISOString());
                  setStage('exam');
                  setWorkspaceTab('question');
                }}
                disabled={!declarationAccepted}
                className="rounded-xl bg-[#79d7ef] px-6 py-3 text-lg font-semibold text-white transition hover:bg-[#56c9e7] disabled:cursor-not-allowed disabled:opacity-50"
              >
                I am ready to begin
              </button>
            </div>
          </div>
        )}

        {stage === 'exam' && examScreen}
      </div>
    </div>
  );
};

void TestPlayer;

const ExactCbtTestPlayer = ({
  test,
  onClose,
  onSubmitted,
}: {
  test: MockTest;
  onClose: () => void;
  onSubmitted: (result: TestAttemptResult) => void;
}) => {
  const { user } = useAuth();
  const stageContentRef = useRef<HTMLElement | null>(null);
  const examMainRef = useRef<HTMLElement | null>(null);
  const [stage, setStage] = useState<ExamStage>('instructions');
  const [workspaceTab, setWorkspaceTab] = useState<ExamWorkspaceTab>('question');
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [visitedQuestions, setVisitedQuestions] = useState<Record<string, boolean>>({});
  const [reviewQuestions, setReviewQuestions] = useState<Record<string, boolean>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(test.durationMinutes * 60);
  const [submitting, setSubmitting] = useState(false);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [defaultLanguage, setDefaultLanguage] = useState('');
  const [selectedLanguage, setSelectedLanguage] = useState('English');
  const [declarationAccepted, setDeclarationAccepted] = useState(false);
  const [questionZoom, setQuestionZoom] = useState(1);
  const [examPaused, setExamPaused] = useState(false);
  const [calculatorExpression, setCalculatorExpression] = useState('');
  const [calculatorResult, setCalculatorResult] = useState('0');
  const [calculatorAngleMode, setCalculatorAngleMode] = useState<'deg' | 'rad'>('deg');
  const [calculatorMemory, setCalculatorMemory] = useState(0);
  const [calculatorPosition, setCalculatorPosition] = useState({ x: 300, y: 170 });
  const [draggingCalculator, setDraggingCalculator] = useState(false);
  const calculatorDragOffsetRef = useRef({ x: 0, y: 0 });
  const calculatorPanelRef = useRef<HTMLDivElement | null>(null);
  const paletteScrollRef = useRef<HTMLDivElement | null>(null);

  const examSections = useMemo(() => buildExamSections(test), [test]);
  const rollNumber = useMemo(() => buildMockRollNumber(user?._id, test._id), [test._id, user?._id]);
  const candidateName = user?.name || 'Candidate';
  const currentQuestion = test.questions[currentIndex];
  const questionTextClass = ['text-[14px] leading-7', 'text-[16px] leading-8', 'text-[19px] leading-9'][questionZoom];
  const timerLabel = formatTimeLeft(timeLeft).replace(':', ' : ');

  const currentSection = useMemo(() => (
    examSections.find((section) => currentIndex >= section.startIndex && currentIndex <= section.endIndex)
    || examSections[0]
    || null
  ), [currentIndex, examSections]);

  const currentSectionIndex = currentSection ? examSections.findIndex((section) => section.name === currentSection.name) : 0;
  const currentSectionLabel = `PART-${String.fromCharCode(65 + Math.max(currentSectionIndex, 0))}`;
  const currentQuestionNumberInSection = currentSection ? (currentIndex - currentSection.startIndex + 1) : (currentIndex + 1);

  const questionStates = useMemo(() => test.questions.reduce<Record<string, ExamQuestionState>>((stateMap, question) => {
    stateMap[question.id] = getExamQuestionState(question.id, answers, visitedQuestions, reviewQuestions);
    return stateMap;
  }, {}), [answers, reviewQuestions, test.questions, visitedQuestions]);

  const overallCounts = useMemo(() => test.questions.reduce((counts, question) => {
    const state = questionStates[question.id];
    if (state === 'answered') {
      counts.answered += 1;
    } else if (state === 'answered-review') {
      counts.answeredReview += 1;
    } else if (state === 'review') {
      counts.review += 1;
    } else if (state === 'unanswered') {
      counts.unanswered += 1;
    } else {
      counts.unvisited += 1;
    }

    return counts;
  }, {
    answered: 0,
    answeredReview: 0,
    review: 0,
    unanswered: 0,
    unvisited: 0,
  }), [questionStates, test.questions]);

  const answeredCount = overallCounts.answered + overallCounts.answeredReview;
  const isCurrentQuestionMarkedForReview = currentQuestion ? Boolean(reviewQuestions[currentQuestion.id]) : false;

  const currentSectionCounts = useMemo(() => {
    if (!currentSection) {
      return {
        answered: 0,
        unanswered: 0,
        review: 0,
        answeredReview: 0,
        unvisited: 0,
      };
    }

    return test.questions.slice(currentSection.startIndex, currentSection.endIndex + 1).reduce((counts, question) => {
      const state = questionStates[question.id];
      if (state === 'answered') {
        counts.answered += 1;
      } else if (state === 'answered-review') {
        counts.answeredReview += 1;
      } else if (state === 'review') {
        counts.review += 1;
      } else if (state === 'unanswered') {
        counts.unanswered += 1;
      } else {
        counts.unvisited += 1;
      }

      return counts;
    }, {
      answered: 0,
      unanswered: 0,
      review: 0,
      answeredReview: 0,
      unvisited: 0,
    });
  }, [currentSection, questionStates, test.questions]);

  useEffect(() => {
    if (stage !== 'exam' || !currentQuestion) {
      return;
    }

    setVisitedQuestions((current) => (
      current[currentQuestion.id]
        ? current
        : { ...current, [currentQuestion.id]: true }
    ));
  }, [currentQuestion, stage]);

  useEffect(() => {
    if (stage !== 'exam' || submitting || examPaused) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setTimeLeft((current) => (current > 0 ? current - 1 : 0));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [examPaused, stage, submitting]);

  useEffect(() => {
    if (stage === 'exam' && timeLeft === 0 && !submitting) {
      void submitTest(true);
    }
  }, [stage, submitting, timeLeft]);

  useEffect(() => {
    stageContentRef.current?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    examMainRef.current?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [stage, workspaceTab, currentIndex]);

  useEffect(() => {
    if (stage !== 'exam') {
      return;
    }

    const activePaletteItem = paletteScrollRef.current?.querySelector<HTMLElement>('[data-active-palette="true"]');
    activePaletteItem?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [currentIndex, currentSection?.name, stage]);

  const handleExit = () => {
    if (stage === 'exam' && startedAt && !submitting) {
      const confirmed = window.confirm('Exit this test now? Your progress will not be submitted.');
      if (!confirmed) {
        return;
      }
    }

    onClose();
  };

  const goToQuestion = (questionIndex: number) => {
    if (stage === 'exam' && currentQuestion) {
      setVisitedQuestions((current) => (
        current[currentQuestion.id]
          ? current
          : { ...current, [currentQuestion.id]: true }
      ));
    }

    setCurrentIndex(Math.min(Math.max(questionIndex, 0), Math.max(test.questions.length - 1, 0)));
    setWorkspaceTab((current) => (current === 'calculator' ? 'calculator' : 'question'));
  };

  const submitTest = async (forced = false) => {
    if (!user || submitting) {
      return;
    }

    if (!forced) {
      const confirmed = window.confirm('Submit this test now?');
      if (!confirmed) {
        return;
      }
    }

    setSubmitting(true);
    try {
      const effectiveStartedAt = startedAt || new Date().toISOString();
      const result = await EduService.submitMockTest(test._id, answers, effectiveStartedAt);
      onSubmitted(result);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveAndNext = () => {
    if (!currentQuestion) {
      return;
    }

    setVisitedQuestions((current) => ({ ...current, [currentQuestion.id]: true }));
    if (currentIndex < test.questions.length - 1) {
      goToQuestion(currentIndex + 1);
    }
  };

  const handleMarkForReview = () => {
    if (!currentQuestion) {
      return;
    }

    setVisitedQuestions((current) => ({ ...current, [currentQuestion.id]: true }));
    setReviewQuestions((current) => {
      const next = { ...current };
      if (next[currentQuestion.id]) {
        delete next[currentQuestion.id];
      } else {
        next[currentQuestion.id] = true;
      }
      return next;
    });
  };

  const handleClearResponse = () => {
    if (!currentQuestion) {
      return;
    }

    setAnswers((current) => {
      const next = { ...current };
      delete next[currentQuestion.id];
      return next;
    });
    setVisitedQuestions((current) => ({ ...current, [currentQuestion.id]: true }));
  };

  const appendCalculatorValue = (value: string) => {
    setCalculatorExpression((current) => `${current}${value}`);
  };

  const wrapCalculatorExpression = (token: string) => {
    setCalculatorExpression((current) => {
      const trimmed = current.trim();
      return trimmed ? `${token}(${trimmed})` : `${token}(`;
    });
  };

  const evaluateCalculator = () => {
    const normalizedExpression = calculatorExpression.trim();

    if (!normalizedExpression.trim()) {
      setCalculatorResult('0');
      return;
    }

    if (!/^[0-9A-Z_+\-*/%,().\s]+$/.test(normalizedExpression)) {
      setCalculatorResult('Invalid');
      return;
    }

    try {
      const toRadians = (value: number) => (calculatorAngleMode === 'deg' ? (value * Math.PI) / 180 : value);
      const fromRadians = (value: number) => (calculatorAngleMode === 'deg' ? (value * 180) / Math.PI : value);
      const factorial = (value: number) => {
        if (!Number.isInteger(value) || value < 0) {
          throw new Error('Invalid factorial');
        }

        let result = 1;
        for (let index = 2; index <= value; index += 1) {
          result *= index;
        }
        return result;
      };

      const scope = {
        PI: Math.PI,
        CONST_E: Math.E,
        SIN: (value: number) => Math.sin(toRadians(value)),
        COS: (value: number) => Math.cos(toRadians(value)),
        TAN: (value: number) => Math.tan(toRadians(value)),
        ASIN: (value: number) => fromRadians(Math.asin(value)),
        ACOS: (value: number) => fromRadians(Math.acos(value)),
        ATAN: (value: number) => fromRadians(Math.atan(value)),
        SINH: (value: number) => Math.sinh(value),
        COSH: (value: number) => Math.cosh(value),
        TANH: (value: number) => Math.tanh(value),
        ASINH: (value: number) => Math.asinh(value),
        ACOSH: (value: number) => Math.acosh(value),
        ATANH: (value: number) => Math.atanh(value),
        EXP: (value: number) => Math.exp(value),
        LN: (value: number) => Math.log(value),
        LOG10: (value: number) => Math.log10(value),
        LOG2: (value: number) => Math.log2(value),
        SQRT: (value: number) => Math.sqrt(value),
        CBRT: (value: number) => Math.cbrt(value),
        SQR: (value: number) => value ** 2,
        CUBE: (value: number) => value ** 3,
        RECIP: (value: number) => 1 / value,
        ABS: (value: number) => Math.abs(value),
        FACT: (value: number) => factorial(value),
        POW: (left: number, right: number) => left ** right,
        NEG: (value: number) => value * -1,
      };

      const evaluator = Function(
        ...Object.keys(scope),
        `"use strict"; return (${normalizedExpression});`,
      );
      const value = evaluator(...Object.values(scope));
      setCalculatorResult(Number.isFinite(value) ? String(value) : 'Invalid');
    } catch {
      setCalculatorResult('Invalid');
    }
  };

  const toggleFullscreen = async () => {
    if (typeof document === 'undefined') {
      return;
    }

    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      return;
    }
  };

  const renderBrandMark = (size: 'sm' | 'md' = 'sm') => {
    const large = size === 'md';

    return (
      <div
        className={cn(
          'relative overflow-hidden rounded-[5px] border border-[#cfd6df] bg-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.85)]',
          large ? 'h-[39px] w-[39px]' : 'h-[34px] w-[34px]',
        )}
      >
        <div
          className={cn(
            'absolute bottom-[5px] left-[6px] rounded-[1px] bg-[#15395f]',
            large ? 'top-[5px] w-[8px]' : 'top-[4px] w-[7px]',
          )}
        />
        <div
          className={cn(
            'absolute bg-[#23bbe8]',
            large ? 'bottom-[5px] left-[13px] top-[5px] w-[15px]' : 'bottom-[4px] left-[12px] top-[4px] w-[13px]',
          )}
          style={{ clipPath: 'polygon(0 0,100% 10%,100% 72%,56% 100%,0 74%)' }}
        />
      </div>
    );
  };

  const renderSidebarAvatar = () => (
    <div className="flex h-[136px] w-[136px] items-center justify-center rounded-full bg-[#34bddf] text-white">
      <svg viewBox="0 0 120 120" className="h-[78px] w-[78px] fill-current" aria-hidden="true">
        <path d="M60 18c10.1 0 18.3 8.2 18.3 18.3S70.1 54.6 60 54.6s-18.3-8.2-18.3-18.3S49.9 18 60 18Zm0 44.4c17.7 0 32.1 10.4 32.1 23.1V98H27.9V85.5C27.9 72.8 42.3 62.4 60 62.4Z" />
      </svg>
    </div>
  );

  const renderPhotoPlaceholder = (label: string) => (
    <div className="w-[78px] text-center">
      <div className="flex h-[58px] items-center justify-center bg-[#dfe6f1] text-[#99a5b9]">
        <svg viewBox="0 0 120 120" className="h-[42px] w-[42px] fill-current" aria-hidden="true">
          <path d="M60 16c12.4 0 22.4 10.2 22.4 22.8S72.4 61.6 60 61.6 37.6 51.4 37.6 38.8 47.6 16 60 16Zm0 52c22 0 39.9 13.2 39.9 29.5V108H20.1V97.5C20.1 81.2 38 68 60 68Z" />
        </svg>
      </div>
      <p className="mt-1 text-[9px] font-medium leading-[1.15] text-slate-600">{label}</p>
    </div>
  );

  const renderLegendBadge = (state: ExamQuestionState) => (
    <div className="relative flex h-6 w-6 items-center justify-center">
      {state === 'unvisited' && <div className="h-[20px] w-[20px] border border-[#6b7280] bg-white" />}
      {state === 'unanswered' && (
        <div
          className="h-[20px] w-[20px] bg-[#c54c31]"
          style={{ clipPath: 'polygon(0 0,100% 0,100% 64%,50% 100%,0 64%)' }}
        />
      )}
      {state === 'answered' && (
        <div
          className="h-[20px] w-[20px] bg-[#2daa59]"
          style={{ clipPath: 'polygon(0 40%,50% 0,100% 40%,100% 100%,0 100%)' }}
        />
      )}
      {state === 'review' && <div className="h-[20px] w-[20px] rounded-full bg-[#8f4ee2]" />}
      {state === 'answered-review' && (
        <>
          <div className="h-[20px] w-[20px] rounded-full bg-[#8f4ee2]" />
          <div className="absolute -right-[1px] -top-[1px] flex h-3 w-3 items-center justify-center rounded-full bg-white">
            <CheckCircle2 className="h-3 w-3 text-[#2daa59]" />
          </div>
        </>
      )}
    </div>
  );

  const renderPaletteBadge = (state: ExamQuestionState, label: string | number, active = false) => (
    <div className="relative inline-flex flex-col items-center">
      <div
        className={cn(
          'relative flex h-[28px] w-[38px] items-center justify-center rounded-[7px] border px-1 text-[11px] font-semibold leading-none transition',
          active && 'border-[#fff36d] bg-[#fff36d] text-[#111111]',
          !active && state === 'unvisited' && 'border-[#2237dd] bg-[#2237dd] text-white',
          !active && state === 'unanswered' && 'border-[#2237dd] bg-[#2237dd] text-white',
          !active && state === 'answered' && 'border-[#2dad5c] bg-[#2dad5c] text-white',
          !active && state === 'review' && 'border-[#ff1414] bg-[#ff1414] text-white',
          !active && state === 'answered-review' && 'border-[#2dad5c] bg-[#2dad5c] text-white',
        )}
      >
        {label}
        {state === 'answered-review' && (
          <CheckCircle2 className="absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full bg-white text-[#2dad5c]" />
        )}
      </div>
      {active && (
        <div className="absolute top-[29px] h-0 w-0 border-x-[5px] border-x-transparent border-t-[9px] border-t-black" />
      )}
    </div>
  );

  const renderInstructionBody = (compact = false) => (
    <div className={cn(compact ? 'space-y-4' : 'space-y-5', 'text-[13px] leading-[1.65] text-slate-800')}>
      <div>
        <p className="text-[14px] font-semibold text-slate-900">General Instructions:</p>
        <ol className="mt-3 list-decimal space-y-3 pl-7">
          <li>
            The clock will be set at the server. The countdown timer at the top right corner of screen will display the remaining time available for you
            to complete the examination. When the timer reaches zero, the examination will end by itself. You need not terminate the examination or submit
            your paper.
          </li>
          <li>
            The Question Palette displayed on the right side of screen will show the status of each question using one of the following symbols:
          </li>
        </ol>
      </div>

      <div className="ml-7 space-y-2.5">
        {questionStateLegend.map((item) => (
          <div key={item.state} className="flex items-center gap-3">
            {renderLegendBadge(item.state)}
            <p>{item.description}</p>
          </div>
        ))}
      </div>

      <p>
        <span className="font-semibold">The Mark For Review</span> status for a question simply indicates that you would like to look at that question again.
        If a question is answered, but marked for review, then the answer will be considered for evaluation unless the status is modified by the candidate.
      </p>

      <div>
        <p className="text-[14px] font-semibold text-slate-900">Navigating to a Question :</p>
        <ol start={3} className="mt-3 list-decimal space-y-3 pl-7">
          <li>
            To answer a question, do the following:
            <ol className="mt-2 list-decimal space-y-1.5 pl-5">
              <li>
                Click on the question number in the Question Palette at the right of your screen to go to that numbered question directly. Note that using
                this option does NOT save your answer to the current question.
              </li>
              <li>
                Click on <span className="font-semibold">Save &amp; Next</span> to save your answer for the current question and then go to the next question.
              </li>
              <li>
                Click on <span className="font-semibold">Mark for Review &amp; Next</span> to save your answer for the current question and also mark it for review,
                and then go to the next question.
              </li>
            </ol>
          </li>
        </ol>
      </div>

      <p>
        Note that your answer for the current question will not be saved, if you navigate to another question directly by clicking on a question number without
        saving the answer to the previous question.
      </p>

      <p>
        You can view all the questions by clicking on the <span className="font-semibold">Question Paper</span> button.
        <span className="ml-1 text-[#e5503f]">
          This feature is provided, so that if you want you can just see the entire question paper at a glance.
        </span>
      </p>

      <div>
        <p className="text-[14px] font-semibold text-slate-900">Answering a Question :</p>
        <ol start={4} className="mt-3 list-decimal space-y-3 pl-7">
          <li>
            Procedure for answering a multiple choice (MCQ) type question:
            <ol className="mt-2 list-decimal space-y-1.5 pl-5">
              <li>Choose one answer from the 4 options (A,B,C,D) given below the question, click on the bubble placed before the chosen option.</li>
              <li>To deselect your chosen answer, click on the bubble of the chosen option again or click on the <span className="font-semibold">Clear Response</span> button.</li>
              <li>To change your chosen answer, click on the bubble of another option.</li>
              <li>To save your answer, you MUST click on the <span className="font-semibold">Save &amp; Next</span> button.</li>
            </ol>
          </li>
          <li>
            Procedure for answering a numerical answer type question :
            <ol className="mt-2 list-decimal space-y-1.5 pl-5">
              <li>To enter a number as your answer, use the virtual numerical keypad.</li>
              <li>
                A fraction (e.g. -0.3 or -.3) can be entered as an answer with or without &apos;0&apos; before the decimal point.
                <span className="ml-1 text-[#e5503f]">
                  As many as four decimal points, e.g. 12.5435 or 0.003 or -932.6711 or 12.82 can be entered.
                </span>
              </li>
              <li>To clear your answer, click on the <span className="font-semibold">Clear Response</span> button.</li>
              <li>To save your answer, you MUST click on the <span className="font-semibold">Save &amp; Next</span> button.</li>
            </ol>
          </li>
          <li>
            To mark a question for review, click on the <span className="font-semibold">Mark for Review &amp; Next</span> button. If an answer is selected
            (for MCQ/MCAQ) entered (for numerical answer type) for a question that is <span className="font-semibold">Marked For Review</span>, that answer
            will be considered in the evaluation unless the status is modified by the candidate.
          </li>
          <li>
            To change your answer to a question that has already been answered, first select that question for answering and then follow the procedure for
            answering that type of question.
          </li>
          <li>
            Note that <span className="font-semibold">ONLY</span> questions for which answers are <span className="font-semibold">saved</span> or
            <span className="font-semibold"> marked for review after answering</span> will be considered for evaluation.
          </li>
          <li>
            Sections in this question paper are displayed on the top bar of the screen. Questions in a Section can be viewed by clicking on the name of that Section.
            The Section you are currently viewing will be highlighted.
          </li>
          <li>
            After clicking the <span className="font-semibold">Save &amp; Next</span> button for the last question in a Section, you will automatically be taken to
            the first question of the next Section in sequence.
          </li>
          <li>
            You can move the mouse cursor over the name of a Section to view the answering status for that Section.
          </li>
        </ol>
      </div>
    </div>
  );

  const renderExamRichText = (content: string, className: string, imageClassName?: string) => {
    const trimmed = String(content || '').trim();
    const isHtml = /<\/?[a-z][\s\S]*>/i.test(trimmed);
    const isStandaloneImage = /^(https?:\/\/\S+\.(?:png|jpe?g|gif|webp|svg))(?:\?\S*)?$/i.test(trimmed);

    if (isStandaloneImage) {
      return <img src={trimmed} alt="" className={cn('max-w-full', imageClassName)} />;
    }

    if (isHtml) {
      return <div className={className} dangerouslySetInnerHTML={{ __html: trimmed }} />;
    }

    return <div className={cn(className, 'whitespace-pre-wrap')}>{trimmed}</div>;
  };

  const startCalculatorDrag = (event: React.MouseEvent<HTMLDivElement>) => {
    const panel = calculatorPanelRef.current;
    if (!panel) {
      return;
    }

    const panelRect = panel.getBoundingClientRect();
    calculatorDragOffsetRef.current = {
      x: event.clientX - panelRect.left,
      y: event.clientY - panelRect.top,
    };
    setDraggingCalculator(true);
  };

  const renderQuestionView = () => {
    if (!currentQuestion) {
      return <div className="border border-slate-300 bg-white p-8 text-[13px] text-slate-600">No questions found.</div>;
    }

    return (
        <div className="space-y-4">
          <p className="text-[18px] font-semibold text-[#333333]">Question No. {currentQuestionNumberInSection}</p>

        <div className="border border-[#d6dde7] bg-white">
          <div className="flex items-center justify-end gap-5 border-b border-[#e3e8ef] px-[22px] py-[10px]">
            <label className="flex items-center gap-3 text-[12px] font-semibold text-slate-700">
              <span>Select Language</span>
              <select
                value={selectedLanguage}
                onChange={(event) => setSelectedLanguage(event.target.value)}
                className="h-[38px] min-w-[108px] border border-[#cad3de] bg-white px-3 text-[12px] font-normal text-slate-700 outline-none"
              >
                <option value="English">English</option>
                <option value="Hindi">Hindi</option>
              </select>
            </label>
            <button className="inline-flex items-center gap-1 text-[12px] font-medium text-slate-500">
              <AlertTriangle className="h-4 w-4" />
              Report
            </button>
          </div>

          <div className="cbt-scroll h-[calc(100vh-343px)] min-h-[555px] overflow-y-scroll">
            <div className="px-[14px] py-[14px]">
              <div className="border border-[#e2e7ee] bg-white">
                <div className="border-b border-[#e2e7ee] px-5 py-5">
                  {renderExamRichText(
                    currentQuestion.questionText,
                    cn('font-normal text-slate-900', questionTextClass),
                    'max-h-[340px] object-contain',
                  )}
                </div>

                <div className="divide-y divide-[#e2e7ee]">
                  {currentQuestion.options.map((option, optionIndex) => {
                    const isSelected = answers[currentQuestion.id] === optionIndex;

                    return (
                      <button
                        key={`${currentQuestion.id}-${option}`}
                        onClick={() => {
                          setAnswers((current) => ({ ...current, [currentQuestion.id]: optionIndex }));
                          setVisitedQuestions((current) => ({ ...current, [currentQuestion.id]: true }));
                        }}
                        className="grid w-full grid-cols-[58px_minmax(0,1fr)] items-center text-left transition hover:bg-slate-50"
                      >
                        <div className="flex h-full items-center justify-center border-r border-[#e2e7ee] py-6">
                          <div className={cn(
                            'flex h-[19px] w-[19px] items-center justify-center rounded-full border border-slate-400 bg-white',
                            isSelected && 'border-[#1e88e5]',
                          )}>
                            {isSelected && <div className="h-[8px] w-[8px] rounded-full bg-[#1e88e5]" />}
                          </div>
                        </div>
                        <div className="px-[28px] py-[20px]">
                          {renderExamRichText(option, 'text-[14px] leading-[1.5] text-slate-800', 'max-h-[240px] object-contain')}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            onClick={handleClearResponse}
            className="h-[42px] min-w-[142px] rounded-[2px] bg-white px-5 text-[12px] font-semibold text-slate-700 ring-1 ring-slate-300"
          >
            Clear Response
          </button>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => goToQuestion(currentIndex - 1)}
              disabled={currentIndex === 0}
              className="h-[42px] min-w-[112px] rounded-[2px] bg-white px-5 text-[12px] font-semibold text-slate-700 ring-1 ring-slate-300 disabled:opacity-50"
            >
              Previous
            </button>
            <button
              onClick={handleSaveAndNext}
              className="h-[42px] min-w-[142px] rounded-[2px] bg-[#2f69d9] px-5 text-[12px] font-semibold text-white"
            >
              Save &amp; Next
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderSymbolsView = () => (
    <div className="border border-slate-300 bg-white p-5">
      <p className="text-[15px] font-semibold text-slate-900">Symbols</p>
      <div className="mt-4 space-y-3">
        {questionStateLegend.map((item) => (
          <div key={item.state} className="flex items-center gap-3">
            {renderLegendBadge(item.state)}
            <p className="text-[13px] leading-7 text-slate-800">{item.description}</p>
          </div>
        ))}
      </div>
    </div>
  );

  const renderInstructionsView = () => (
    <div className="border border-slate-300 bg-white p-5">
      {renderInstructionBody(true)}
    </div>
  );

  const renderSummaryView = () => {
    const unresolvedQuestions = test.questions
      .map((question, index) => ({
        question,
        index,
        state: questionStates[question.id],
      }))
      .filter((item) => item.state !== 'answered' && item.state !== 'answered-review');

    return (
      <div className="space-y-5">
        <div className="border border-slate-300 bg-white p-5">
          <p className="text-[15px] font-semibold text-slate-900">Overall Test Summary</p>
          <div className="mt-4 grid gap-3 md:grid-cols-5">
            <div className="border border-slate-200 bg-slate-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Answered</p>
              <p className="mt-2 text-[18px] font-semibold text-slate-900">{answeredCount}</p>
            </div>
            <div className="border border-slate-200 bg-slate-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Not Answered</p>
              <p className="mt-2 text-[18px] font-semibold text-slate-900">{overallCounts.unanswered}</p>
            </div>
            <div className="border border-slate-200 bg-slate-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Review</p>
              <p className="mt-2 text-[18px] font-semibold text-slate-900">{overallCounts.review + overallCounts.answeredReview}</p>
            </div>
            <div className="border border-slate-200 bg-slate-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Not Visited</p>
              <p className="mt-2 text-[18px] font-semibold text-slate-900">{overallCounts.unvisited}</p>
            </div>
            <div className="border border-slate-200 bg-slate-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Time Left</p>
              <p className="mt-2 text-[18px] font-semibold text-slate-900">{timerLabel}</p>
            </div>
          </div>
        </div>

        <div className="border border-slate-300 bg-white p-5">
          <p className="text-[15px] font-semibold text-slate-900">Questions Needing Attention</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {unresolvedQuestions.length > 0 ? unresolvedQuestions.map((item) => (
              <button
                key={item.question.id}
                onClick={() => goToQuestion(item.index)}
                className="flex items-center justify-between border border-slate-200 bg-white px-4 py-3 text-left hover:bg-slate-50"
              >
                <div>
                  <p className="text-[13px] font-semibold text-slate-900">Question {item.index + 1}</p>
                  <p className="mt-1 text-[12px] text-slate-600">{questionStateLegend.find((legend) => legend.state === item.state)?.label}</p>
                </div>
                <ArrowRight className="h-4 w-4 text-slate-400" />
              </button>
            )) : (
              <div className="border border-emerald-200 bg-emerald-50 px-4 py-4 text-[13px] font-medium text-emerald-700">
                Every question has been attempted or saved for review.
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderCalculatorView = () => {
    const baseButtonClass = 'flex h-[34px] items-center justify-center rounded-[4px] border border-[#a7a7a7] bg-[#f3f3f3] px-2 text-[12px] font-semibold text-[#454545] shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]';

    const scientificButtons = [
      [
        { label: 'sinh', onClick: () => appendCalculatorValue('SINH(') },
        { label: 'cosh', onClick: () => appendCalculatorValue('COSH(') },
        { label: 'tanh', onClick: () => appendCalculatorValue('TANH(') },
        { label: 'Exp', onClick: () => appendCalculatorValue('EXP(') },
        { label: '(', onClick: () => appendCalculatorValue('(') },
        { label: ')', onClick: () => appendCalculatorValue(')') },
        { label: '←', onClick: () => setCalculatorExpression((current) => current.slice(0, -1)), className: 'bg-[#e95d44] text-white' },
        { label: 'C', onClick: () => { setCalculatorExpression(''); setCalculatorResult('0'); }, className: 'bg-[#ef6841] text-white' },
        { label: '+/-', onClick: () => wrapCalculatorExpression('NEG'), className: 'bg-[#ef6841] text-white' },
        { label: '√', onClick: () => wrapCalculatorExpression('SQRT') },
      ],
      [
        { label: 'sinh⁻¹', onClick: () => appendCalculatorValue('ASINH(') },
        { label: 'cosh⁻¹', onClick: () => appendCalculatorValue('ACOSH(') },
        { label: 'tanh⁻¹', onClick: () => appendCalculatorValue('ATANH(') },
        { label: 'log₂x', onClick: () => appendCalculatorValue('LOG2(') },
        { label: 'ln', onClick: () => appendCalculatorValue('LN(') },
        { label: 'log', onClick: () => appendCalculatorValue('LOG10(') },
        { label: '7', onClick: () => appendCalculatorValue('7') },
        { label: '8', onClick: () => appendCalculatorValue('8') },
        { label: '9', onClick: () => appendCalculatorValue('9') },
        { label: '/', onClick: () => appendCalculatorValue('/') },
      ],
      [
        { label: 'π', onClick: () => appendCalculatorValue('PI') },
        { label: 'e', onClick: () => appendCalculatorValue('CONST_E') },
        { label: 'n!', onClick: () => wrapCalculatorExpression('FACT') },
        { label: 'logₓy', onClick: () => appendCalculatorValue('POW(') },
        { label: 'eˣ', onClick: () => wrapCalculatorExpression('EXP') },
        { label: '10ˣ', onClick: () => appendCalculatorValue('POW(10,') },
        { label: '4', onClick: () => appendCalculatorValue('4') },
        { label: '5', onClick: () => appendCalculatorValue('5') },
        { label: '6', onClick: () => appendCalculatorValue('6') },
        { label: '*', onClick: () => appendCalculatorValue('*') },
      ],
      [
        { label: 'sin', onClick: () => appendCalculatorValue('SIN(') },
        { label: 'cos', onClick: () => appendCalculatorValue('COS(') },
        { label: 'tan', onClick: () => appendCalculatorValue('TAN(') },
        { label: 'xʸ', onClick: () => appendCalculatorValue('POW(') },
        { label: 'x³', onClick: () => wrapCalculatorExpression('CUBE') },
        { label: 'x²', onClick: () => wrapCalculatorExpression('SQR') },
        { label: '1', onClick: () => appendCalculatorValue('1') },
        { label: '2', onClick: () => appendCalculatorValue('2') },
        { label: '3', onClick: () => appendCalculatorValue('3') },
        { label: '-', onClick: () => appendCalculatorValue('-') },
      ],
      [
        { label: 'sin⁻¹', onClick: () => appendCalculatorValue('ASIN(') },
        { label: 'cos⁻¹', onClick: () => appendCalculatorValue('ACOS(') },
        { label: 'tan⁻¹', onClick: () => appendCalculatorValue('ATAN(') },
        { label: '√x', onClick: () => wrapCalculatorExpression('SQRT') },
        { label: '∛', onClick: () => wrapCalculatorExpression('CBRT') },
        { label: '|x|', onClick: () => wrapCalculatorExpression('ABS') },
        { label: '0', onClick: () => appendCalculatorValue('0') },
        { label: '.', onClick: () => appendCalculatorValue('.') },
        { label: '+', onClick: () => appendCalculatorValue('+') },
        { label: '=', onClick: evaluateCalculator, className: 'bg-[#2bc56f] text-white' },
      ],
    ];

    return (
      <div
        ref={calculatorPanelRef}
        className="pointer-events-auto absolute z-20 w-[620px] max-w-[calc(100%-24px)] overflow-hidden border border-[#8d8d8d] bg-[#d7d7d7] shadow-[0_10px_24px_rgba(0,0,0,0.22)]"
        style={{ left: `${calculatorPosition.x}px`, top: `${calculatorPosition.y}px` }}
      >
        <div className="overflow-hidden">
          <div
            onMouseDown={startCalculatorDrag}
            className={cn(
              'flex cursor-move select-none items-center justify-between bg-[#4c8cf0] px-2 py-1.5 text-white',
              draggingCalculator && 'cursor-grabbing',
            )}
          >
            <p className="text-[12px] font-normal">Scientific Calculator</p>
            <div className="flex items-center gap-px">
              <button type="button" className="border border-[#437be8] bg-[#4c8cf0] px-3 py-0.5 text-[11px]">Help</button>
              <button type="button" onClick={() => setWorkspaceTab('question')} className="border border-[#437be8] bg-[#4c8cf0] px-3 py-0.5 text-[16px] leading-none">-</button>
              <button type="button" onClick={() => setWorkspaceTab('question')} className="border border-[#437be8] bg-[#4c8cf0] px-3 py-0.5 text-[16px] leading-none">x</button>
            </div>
          </div>

          <div className="bg-[#ececec] p-2">
            <div className="h-[38px] overflow-hidden border border-[#a0a0a0] bg-white px-2 py-1 text-right text-[16px] leading-[28px] text-[#4d4d4d]">
              {calculatorExpression || ''}
            </div>
            <div className="mt-2 h-[40px] overflow-hidden border border-[#a0a0a0] bg-white px-2 py-1 text-right text-[22px] leading-[28px] text-[#1f1f1f]">
              {calculatorResult}
            </div>

            <div className="mt-2 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button onClick={() => appendCalculatorValue('%')} className={cn(baseButtonClass, 'h-[32px] px-3')}>mod</button>
                <label className="flex items-center gap-1 text-[11px] text-[#444]">
                  <input
                    type="radio"
                    checked={calculatorAngleMode === 'deg'}
                    onChange={() => setCalculatorAngleMode('deg')}
                    className="h-3 w-3"
                  />
                  Deg
                </label>
                <label className="flex items-center gap-1 text-[11px] text-[#444]">
                  <input
                    type="radio"
                    checked={calculatorAngleMode === 'rad'}
                    onChange={() => setCalculatorAngleMode('rad')}
                    className="h-3 w-3"
                  />
                  Rad
                </label>
              </div>

              <div className="grid grid-cols-5 gap-2">
                <button onClick={() => setCalculatorMemory(0)} className={baseButtonClass}>MC</button>
                <button onClick={() => appendCalculatorValue(String(calculatorMemory))} className={baseButtonClass}>MR</button>
                <button onClick={() => setCalculatorMemory(Number(calculatorResult) || 0)} className={baseButtonClass}>MS</button>
                <button onClick={() => setCalculatorMemory((current) => current + (Number(calculatorResult) || 0))} className={baseButtonClass}>M+</button>
                <button onClick={() => setCalculatorMemory((current) => current - (Number(calculatorResult) || 0))} className={baseButtonClass}>M-</button>
              </div>
            </div>

            <div className="mt-3 space-y-2">
              {scientificButtons.map((row, rowIndex) => (
                <div key={`row-${rowIndex}`} className="grid grid-cols-10 gap-2">
                  {row.map((button) => (
                    <button
                      type="button"
                      key={`${rowIndex}-${button.label}`}
                      onClick={button.onClick}
                      className={cn(baseButtonClass, button.className)}
                    >
                      {button.label}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderWorkspace = () => {
    if (workspaceTab === 'calculator') {
      return (
        <div className="relative">
          {renderQuestionView()}
          {renderCalculatorView()}
        </div>
      );
    }

    if (workspaceTab === 'symbols') {
      return renderSymbolsView();
    }

    if (workspaceTab === 'instructions') {
      return renderInstructionsView();
    }

    if (workspaceTab === 'summary') {
      return renderSummaryView();
    }

    return renderQuestionView();
  };

  const preExamHeader = (
    <div className="flex items-center gap-5 border-b border-slate-200 bg-white px-5 py-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
      <div className="flex items-center gap-3">
        {renderBrandMark('md')}
        <p className="text-[18px] font-bold leading-none text-[#1bb9e8]">{CBT_BRAND_NAME}</p>
      </div>
      <p className="text-[13px] font-medium text-slate-800">{test.title}</p>
    </div>
  );

  const preExamSidebar = (
    <aside className="border-l border-slate-200 bg-[#f7f9fc] px-6 py-8">
      <div className="flex h-full flex-col items-center text-center">
        {renderSidebarAvatar()}
        <p className="mt-9 max-w-[190px] text-[24px] font-normal leading-tight text-[#343434]">{candidateName}</p>
      </div>
    </aside>
  );

  const examScreen = (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="grid gap-3 border-b border-slate-200 bg-white px-4 py-3 shadow-[0_1px_3px_rgba(15,23,42,0.06)] lg:grid-cols-[290px_160px_minmax(0,1fr)_360px] lg:items-center">
        <div className="flex items-center gap-3">
          {renderBrandMark('md')}
          <div>
            <p className="text-[20px] font-bold leading-none text-[#1bb9e8]">{CBT_BRAND_NAME}</p>
            <p className="mt-1 text-[10px] font-semibold leading-tight text-slate-900">{test.title}</p>
          </div>
        </div>

        <div className="flex items-center justify-center gap-2 lg:justify-start">
          <button
            onClick={() => setQuestionZoom((current) => Math.min(current + 1, 2))}
            className="rounded-[14px] bg-[#2f69d9] px-4 py-2 text-[10px] font-semibold text-white"
          >
            Zoom (+)
          </button>
          <button
            onClick={() => setQuestionZoom((current) => Math.max(current - 1, 0))}
            className="rounded-[14px] bg-[#2f69d9] px-4 py-2 text-[10px] font-semibold text-white"
          >
            Zoom (-)
          </button>
        </div>

        <div className="text-center">
          <p className="text-[17px] font-semibold text-slate-900">{test.title}</p>
          <p className="mt-1 text-[11px] font-semibold text-slate-700">Roll No : {rollNumber}</p>
        </div>

        <div className="flex flex-wrap items-start justify-end gap-3">
          <button
            onClick={() => void toggleFullscreen()}
            className="flex h-11 w-11 items-center justify-center rounded-[4px] border border-[#37b3eb] bg-white text-[#37b3eb]"
          >
            <Expand className="h-4 w-4" />
          </button>
          <button
            onClick={() => setExamPaused((current) => !current)}
            className="flex h-11 w-11 items-center justify-center rounded-[4px] border border-[#37b3eb] bg-white text-[#37b3eb]"
          >
            {examPaused ? <PlayCircle className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
          </button>
          <div className="px-1 text-right">
            <p className="text-[11px] font-semibold text-slate-800">Time Left</p>
            <p className="mt-1 bg-[#fff36d] px-3 py-1 text-[17px] font-bold tracking-[0.08em] text-red-600">{timerLabel}</p>
          </div>
          <div className="flex gap-2">{renderPhotoPlaceholder('Registration Photo')}{renderPhotoPlaceholder('Captured Photo')}</div>
        </div>
      </div>

      <div className="grid border-b border-slate-200 lg:grid-cols-[minmax(0,1fr)_430px]">
        <div className="flex flex-wrap items-center gap-5 px-4 py-3">
          {examWorkspaceTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setWorkspaceTab(tab.id)}
              className={cn(
                'text-[11px] font-semibold uppercase underline underline-offset-4',
                tab.id === 'symbols' || tab.id === 'calculator' ? 'text-[#1f78c5]' : 'text-[#cc4b2a]',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="border-l border-slate-200 px-4 py-3 text-right">
          <p className="text-[12px] font-semibold text-slate-900">
            Total Questions Answered: <span className="bg-[#fff36d] px-1.5 py-0.5 text-[#ff1b00]">{answeredCount}</span>
          </p>
        </div>
      </div>

      <div className="grid border-b border-slate-200 lg:grid-cols-[minmax(0,1fr)_430px]">
        <div className="px-4 py-3">
          <div className="grid items-center gap-4 xl:grid-cols-[auto_1fr_auto]">
            <div className="flex flex-wrap gap-2">
              {examSections.map((section, sectionIndex) => {
                const sectionLabel = `PART-${String.fromCharCode(65 + sectionIndex)}`;
                const isActiveSection = currentSection?.name === section.name;

                return (
                  <button
                    key={section.name}
                    onClick={() => goToQuestion(section.startIndex)}
                    className={cn(
                      'rounded-[4px] px-4 py-[7px] text-[12px] font-semibold text-white',
                      isActiveSection ? 'bg-[#179b17]' : 'bg-[#2237dd]',
                    )}
                  >
                    {sectionLabel}
                  </button>
                );
              })}
            </div>

            <div className="flex justify-center">
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  onClick={handleMarkForReview}
                  className={cn(
                    'min-w-[134px] rounded-[4px] px-4 py-[8px] text-[12px] font-semibold',
                    isCurrentQuestionMarkedForReview
                      ? 'bg-[#ece3c9] text-[#242424]'
                      : 'bg-[#2f69d9] text-white',
                  )}
                >
                  {isCurrentQuestionMarkedForReview ? 'Unmark Review' : 'Mark for Review'}
                </button>
                <button onClick={handleSaveAndNext} className="min-w-[122px] rounded-[4px] bg-[#2f69d9] px-4 py-[8px] text-[12px] font-semibold text-white">Save &amp; Next</button>
                <button
                  onClick={() => void submitTest()}
                  disabled={submitting}
                  className="min-w-[114px] rounded-[4px] bg-[#2f69d9] px-4 py-[8px] text-[12px] font-semibold text-white disabled:opacity-60"
                >
                  {submitting ? 'Submitting...' : 'Submit Test'}
                </button>
              </div>
            </div>

            <div />
          </div>
        </div>
        <div className="border-l border-slate-200 bg-white" />
      </div>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_430px]">
        <main ref={examMainRef} className="cbt-scroll min-h-0 overflow-y-scroll px-4 py-5">
          {renderWorkspace()}
        </main>

        <aside className="min-h-0 border-l border-slate-200 bg-white">
          <div className="flex h-full min-h-0 flex-col px-4 py-3">
            {currentSection && (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex items-center gap-2">
                  <div className="h-0 w-0 border-y-[10px] border-y-transparent border-l-[14px] border-l-[#31a8dd]" />
                  <p className="text-[13px] font-semibold text-slate-900">{currentSection.name}</p>
                </div>

                <div ref={paletteScrollRef} className="cbt-scroll mt-3 min-h-0 flex-1 overflow-y-scroll pr-1">
                  <div
                    className="grid grid-cols-4 justify-items-center gap-y-4 pb-2"
                  >
                    {test.questions.slice(currentSection.startIndex, currentSection.endIndex + 1).map((question, sectionQuestionIndex) => {
                      const questionIndex = currentSection.startIndex + sectionQuestionIndex;
                      const questionState = questionStates[question.id];

                      return (
                        <button
                          key={question.id}
                          data-active-palette={currentIndex === questionIndex ? 'true' : 'false'}
                          onClick={() => goToQuestion(questionIndex)}
                        >
                          {renderPaletteBadge(questionState, sectionQuestionIndex + 1, currentIndex === questionIndex)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            <div className="mt-3 shrink-0 border border-slate-400 bg-white">
              <div className="border-b border-slate-400 bg-slate-100 px-3 py-[8px] text-center text-[13px] font-semibold text-slate-900">
                {currentSectionLabel} Analysis
              </div>
              <div className="divide-y divide-slate-200">
                <div className="grid grid-cols-[minmax(0,1fr)_40px] text-[12px]">
                  <span className="px-4 py-[9px] text-slate-700">Answered</span>
                  <span className="flex items-center justify-center border-l border-slate-200 bg-[#fff36d] font-semibold text-[#ff1b00]">{currentSectionCounts.answered + currentSectionCounts.answeredReview}</span>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_40px] text-[12px]">
                  <span className="px-4 py-[9px] text-slate-700">Not Answered</span>
                  <span className="flex items-center justify-center border-l border-slate-200 bg-[#fff36d] font-semibold text-[#ff1b00]">{currentSectionCounts.unanswered + currentSectionCounts.unvisited}</span>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_40px] text-[12px]">
                  <span className="px-4 py-[9px] text-slate-700">Mark for Review</span>
                  <span className="flex items-center justify-center border-l border-slate-200 bg-[#fff36d] font-semibold text-[#ff1b00]">{currentSectionCounts.review + currentSectionCounts.answeredReview}</span>
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-40 bg-white text-slate-900 [font-family:Arial,_Helvetica,_sans-serif]">
      {stage === 'instructions' && (
        <div className="flex h-full flex-col bg-white">
          {preExamHeader}
          <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_320px]">
            <section ref={stageContentRef} className="cbt-scroll overflow-y-scroll px-5 py-6">
              {renderInstructionBody()}
            </section>
            {preExamSidebar}
          </div>

          <div className="grid border-t border-slate-200 bg-white lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="flex items-center justify-between px-5 py-3">
              <button
                onClick={handleExit}
                className="text-[13px] font-medium text-[#4a94cb]"
              >
                ← Go to Tests
              </button>
              <button
                onClick={() => setStage('declaration')}
                className="rounded-[3px] bg-[#7db3ec] px-8 py-2 text-[12px] font-semibold text-white"
              >
                Next
              </button>
            </div>
            <div className="border-l border-slate-200 bg-[#f7f9fc]" />
          </div>
        </div>
      )}

      {stage === 'declaration' && (
        <div className="flex h-full flex-col bg-white">
          {preExamHeader}
          <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_320px]">
            <section ref={stageContentRef} className="cbt-scroll overflow-y-scroll px-5 py-6">
              <div>
                <p className="text-center text-[21px] font-semibold text-slate-900">{test.title}</p>

                <div className="mt-8 flex flex-wrap items-center justify-between gap-4 text-[14px] font-semibold text-slate-800">
                  <p>Duration: {test.durationMinutes} Mins</p>
                  <p>Maximum Marks: {test.totalMarks}</p>
                </div>

                <p className="mt-6 text-[15px] font-semibold text-slate-900">Read the following instructions carefully.</p>
                <ol className="mt-4 list-decimal space-y-3 pl-6 text-[13px] leading-8 text-slate-800">
                  <li>The test contains {test.questions.length} total questions.</li>
                  <li>Each question has 4 Options out of which only one is correct.</li>
                  <li>You have to finish the test in {test.durationMinutes} minutes.</li>
                  <li>Try not to guess the answer as there is negative marking.</li>
                  <li>You will be awarded {test.questions[0]?.marks || 1} mark for each correct answer and {test.negativeMarking} will be deducted for each wrong answer.</li>
                  <li>There is no negative marking for the questions that you have not attempted.</li>
                  <li>You can write this test only once. Make sure that you complete the test before you submit the test and/or close the browser.</li>
                </ol>

                <div className="mt-8 border-y border-slate-200 py-6">
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="text-[13px] font-semibold text-slate-900">Choose your default language:</label>
                    <select
                      value={defaultLanguage}
                      onChange={(event) => setDefaultLanguage(event.target.value)}
                      className="h-[35px] border border-slate-300 bg-white px-3 text-[12px] text-slate-900 outline-none"
                    >
                      <option value="">-- Select --</option>
                      <option value="English">English</option>
                      <option value="Hindi">Hindi</option>
                    </select>
                  </div>
                  <p className="mt-4 text-[13px] leading-7 text-[#e54d42]">
                    Please note all questions will appear in your default language. This language can be changed for a particular question later on.
                  </p>
                </div>

                <div className="mt-6">
                  <p className="text-[15px] font-semibold text-slate-900">Declaration:</p>
                  <label className="mt-3 flex items-start gap-3 text-[13px] leading-7 text-slate-800">
                    <input
                      type="checkbox"
                      checked={declarationAccepted}
                      onChange={(event) => setDeclarationAccepted(event.target.checked)}
                      className="mt-1 h-3.5 w-3.5 rounded-none border-slate-300"
                    />
                    <span>
                      I have read all the instructions carefully and have understood them. I agree not to cheat or use unfair means in this examination.
                      I understand that using unfair means of any sort for my own or someone else&apos;s advantage will lead to my immediate disqualification.
                      The decision of {CBT_BRAND_NAME} will be final in these matters and cannot be appealed.
                    </span>
                  </label>
                </div>
              </div>
            </section>
            {preExamSidebar}
          </div>

          <div className="grid border-t border-slate-200 bg-white lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="grid grid-cols-[auto_1fr_auto] items-center px-5 py-3">
              <button
                onClick={() => setStage('instructions')}
                className="rounded-[3px] bg-[#eef5ff] px-5 py-2 text-[12px] font-semibold text-slate-700 ring-1 ring-slate-300"
              >
                Previous
              </button>
              <div className="flex justify-center">
                <button
                  onClick={() => {
                    setStartedAt(new Date().toISOString());
                    setExamPaused(false);
                    setSelectedLanguage(defaultLanguage || 'English');
                    setStage('exam');
                    setWorkspaceTab('question');
                  }}
                  disabled={!declarationAccepted}
                  className="rounded-[3px] bg-[#72d0e9] px-8 py-2 text-[12px] font-semibold text-white disabled:opacity-50"
                >
                  I am ready to begin
                </button>
              </div>
              <div />
            </div>
            <div className="border-l border-slate-200 bg-[#f7f9fc]" />
          </div>
        </div>
      )}

      {stage === 'exam' && examScreen}
    </div>
  );
};

const TestsTab = ({ overview, onRefresh }: { overview: PlatformOverview; onRefresh: () => Promise<void> }) => {
  const [activeTest, setActiveTest] = useState<MockTest | null>(null);
  const [lastResult, setLastResult] = useState<TestAttemptResult | null>(null);
  const [solutionFilter, setSolutionFilter] = useState<'all' | 'correct' | 'incorrect' | 'skipped'>('all');
  const [openSolutions, setOpenSolutions] = useState<Record<string, boolean>>({});
  const filteredSolutions = (lastResult?.solutions || []).filter((solution) => {
    if (solutionFilter === 'all') {
      return true;
    }

    if (solutionFilter === 'skipped') {
      return solution.selectedOption === null;
    }

    const isCorrect = solution.selectedOption !== null && solution.selectedOption === solution.correctOption;
    return solutionFilter === 'correct' ? isCorrect : !isCorrect && solution.selectedOption !== null;
  });

  return (
    <div className="space-y-6">
      <SectionHeader
        title="CBT mock test series"
        caption="Instructions, declaration, live timer, palette, scorecard"
        action={lastResult ? (
          <div className="rounded-full bg-[var(--success-soft)] px-4 py-2 text-sm font-semibold text-[var(--success)]">
            Latest result: {lastResult.score}/{lastResult.totalMarks}
          </div>
        ) : undefined}
      />

      <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
        {overview.testSeries.map((test) => (
          <div key={test._id} className="rounded-[28px] border border-white/70 bg-white/92 p-5 shadow-[0_20px_60px_rgba(15,23,42,0.07)]">
            <div className="flex items-center justify-between gap-3">
              <span className="rounded-full bg-[var(--accent-cream)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--accent-rust)]">
                {test.category}
              </span>
              <span className="text-sm text-[var(--ink-soft)]">{test.durationMinutes} min</span>
            </div>
            <h3 className="mt-4 text-xl font-semibold text-[var(--ink)]">{test.title}</h3>
            <p className="mt-3 text-sm leading-6 text-[var(--ink-soft)]">{test.description}</p>
            <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-2xl bg-[var(--accent-cream)] p-3">
                <p className="text-[var(--ink-soft)]">Marks</p>
                <p className="mt-1 font-semibold text-[var(--ink)]">{test.totalMarks}</p>
              </div>
              <div className="rounded-2xl bg-[var(--accent-cream)] p-3">
                <p className="text-[var(--ink-soft)]">Negative</p>
                <p className="mt-1 font-semibold text-[var(--danger)]">-{test.negativeMarking}</p>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              {test.sectionBreakup.map((section) => (
                <span key={section.name} className="rounded-full border border-[var(--line)] px-3 py-2 text-xs text-[var(--ink-soft)]">
                  {section.name}: {section.questions}
                </span>
              ))}
            </div>
            <button
              onClick={() => setActiveTest(test)}
              data-testid={`test-open-${test._id}`}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-[var(--ink)] px-5 py-3 font-semibold text-white transition hover:bg-[var(--accent-rust)]"
            >
              Open exam instructions
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      {lastResult && (
        <div className="rounded-[30px] border border-white/70 bg-white/92 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.07)]">
          <SectionHeader title="Scorecard" caption="Post-test analytics" />
          <div className="mt-6 grid gap-4 md:grid-cols-4">
            <MetricCard title="Score" value={`${lastResult.score}`} hint="Final score after negative marking" icon={Trophy} />
            <MetricCard title="Rank" value={`#${lastResult.rank}`} hint="All India style mock ranking" icon={Target} />
            <MetricCard title="Percentile" value={`${lastResult.percentile}%`} hint="Relative performance among attempts" icon={Gauge} />
            <MetricCard title="Accuracy band" value={`${lastResult.correctCount} correct`} hint={`${lastResult.incorrectCount} incorrect, ${lastResult.unattemptedCount} skipped`} icon={ClipboardCheck} />
          </div>
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <div className="rounded-[24px] bg-[var(--accent-cream)] p-5">
              <p className="font-semibold text-[var(--ink)]">Weak topics</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {lastResult.weakTopics.map((topic) => (
                  <span key={topic} className="rounded-full bg-white px-3 py-2 text-sm text-[var(--danger)]">{topic}</span>
                ))}
              </div>
            </div>
            <div className="rounded-[24px] bg-[var(--accent-cream)] p-5">
              <p className="font-semibold text-[var(--ink)]">Strong topics</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {lastResult.strongTopics.map((topic) => (
                  <span key={topic} className="rounded-full bg-white px-3 py-2 text-sm text-[var(--success)]">{topic}</span>
                ))}
              </div>
            </div>
          </div>
          {lastResult.solutions.length > 0 && (
            <div className="mt-6 rounded-[24px] border border-[var(--line)] p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-lg font-semibold text-[var(--ink)]">Solutions with explanations</p>
                  <p className="mt-1 text-sm text-[var(--ink-soft)]">Each explanation is already stored with the test and is revealed only when the learner opens it.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(['all', 'correct', 'incorrect', 'skipped'] as const).map((filter) => (
                    <button
                      key={filter}
                      onClick={() => setSolutionFilter(filter)}
                      className={cn(
                        'rounded-full px-4 py-2 text-sm font-semibold capitalize transition',
                        solutionFilter === filter
                          ? 'bg-[var(--ink)] text-white'
                          : 'bg-[var(--accent-cream)] text-[var(--ink-soft)]',
                      )}
                    >
                      {filter}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-4 space-y-3">
                {filteredSolutions.map((solution) => {
                  const originalIndex = lastResult.solutions.findIndex((item) => item.questionId === solution.questionId);
                  return (
                    <MockSolutionCard
                      key={solution.questionId}
                      solution={solution}
                      index={originalIndex >= 0 ? originalIndex : 0}
                      open={Boolean(openSolutions[solution.questionId])}
                      onToggle={() => setOpenSolutions((current) => ({
                        ...current,
                        [solution.questionId]: !current[solution.questionId],
                      }))}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      <AnimatePresence>
        {activeTest && (
          <ExactCbtTestPlayer
            test={activeTest}
            onClose={() => setActiveTest(null)}
            onSubmitted={async (result) => {
              setLastResult(result);
              setActiveTest(null);
              await onRefresh();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

const QuizTab = ({ overview, onRefresh }: { overview: PlatformOverview; onRefresh: () => Promise<void> }) => {
  const { user } = useAuth();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<DailyQuizResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [openQuizSolutions, setOpenQuizSolutions] = useState<Record<string, boolean>>({});

  const quiz = overview.dailyQuiz?.quiz;
  const attemptedCount = quiz ? quiz.questions.filter((question) => Boolean(answers[question.id])).length : 0;

  const submitQuiz = async () => {
    if (!quiz || !user) {
      return;
    }

    setSubmitting(true);
    try {
      const orderedAnswers = quiz.questions.map((question) => answers[question.id] || '');
      const quizResult = await EduService.submitDailyQuiz(quiz._id, orderedAnswers);
      setResult(quizResult);
      await onRefresh();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[1.1fr_0.55fr]">
      <section className="rounded-[30px] border border-white/70 bg-white/92 p-6 shadow-[0_22px_70px_rgba(15,23,42,0.07)]">
        <SectionHeader title="Daily quiz system" caption="5 to 20 questions • instant result • streaks" />
        {quiz ? (
          <div className="mt-6 space-y-5">
            {quiz.questions.map((question, index) => (
              <div key={question.id} className="rounded-[26px] border border-[var(--line)] p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--ink-soft)]">Question {index + 1}</p>
                <h3 className="mt-3 text-lg font-semibold text-[var(--ink)]">{question.prompt}</h3>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {question.options.map((option) => (
                    <button
                      key={option}
                      onClick={() => setAnswers((current) => ({ ...current, [question.id]: option }))}
                      className={cn(
                        'rounded-[20px] border px-4 py-4 text-left text-sm transition',
                        answers[question.id] === option
                          ? 'border-[var(--accent-rust)] bg-[var(--accent-cream)]'
                          : 'border-[var(--line)] bg-white hover:border-[var(--accent-rust)]/40',
                      )}
                    >
                      {option}
                    </button>
                  ))}
                </div>
                {result?.review.find((entry) => entry.questionId === question.id) && (
                  <QuizReviewCard
                    reviewItem={result.review.find((entry) => entry.questionId === question.id)!}
                    questionIndex={index}
                    open={Boolean(openQuizSolutions[question.id])}
                    onToggle={() => setOpenQuizSolutions((current) => ({
                      ...current,
                      [question.id]: !current[question.id],
                    }))}
                  />
                )}
              </div>
            ))}

            <button
              onClick={() => void submitQuiz()}
              data-testid="quiz-submit"
              disabled={submitting}
              className="flex items-center gap-2 rounded-2xl bg-[var(--accent-rust)] px-5 py-3 font-semibold text-white"
            >
              {submitting ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
              Submit daily quiz
            </button>
            {result && (
              <div className="rounded-[24px] bg-[var(--success-soft)] p-5 text-[var(--success)]">
                You scored {result.score}/{result.total}. Your streak and leaderboard are updated on the backend.
              </div>
            )}
          </div>
        ) : (
          <p className="mt-6 text-sm text-[var(--ink-soft)]">No daily quiz is scheduled right now.</p>
        )}
      </section>

      <aside className="space-y-6">
        <div className="rounded-[30px] border border-white/70 bg-white/92 p-6 shadow-[0_22px_70px_rgba(15,23,42,0.07)]">
          <SectionHeader title="Streak & rank" caption="Engagement loop" />
          <div className="mt-6 grid gap-4">
            <MetricCard title="Attempted" value={`${attemptedCount}/${quiz?.questions.length || 0}`} hint="Live progress inside today's quiz" icon={ClipboardCheck} />
            <MetricCard title="Current streak" value={`${overview.dailyQuiz?.streak || 0} days`} hint="Attempt before midnight to extend it" icon={Flame} />
            <MetricCard title="Leaderboard" value={`${overview.dailyQuiz?.leaderboard.length || 0} visible`} hint="Daily and weekly style positioning" icon={Trophy} />
            {result && <MetricCard title="Latest score" value={`${result.score}/${result.total}`} hint="Solutions unlock below each question" icon={Sparkles} />}
          </div>
        </div>

        <div className="rounded-[30px] border border-white/70 bg-white/92 p-6 shadow-[0_22px_70px_rgba(15,23,42,0.07)]">
          <SectionHeader title="Today’s leaderboard" caption="Top performers" />
          <div className="mt-6 space-y-3">
            {(overview.dailyQuiz?.leaderboard || []).map((entry, index) => (
              <div key={`${entry.userId}-${entry.submittedAt}`} className="flex items-center justify-between rounded-[20px] bg-[var(--accent-cream)] px-4 py-4">
                <div>
                  <p className="text-sm font-semibold text-[var(--ink)]">Rank #{index + 1}</p>
                  <p className="text-xs text-[var(--ink-soft)]">{entry.name || entry.userId}</p>
                </div>
                <p className="text-lg font-semibold text-[var(--accent-rust)]">{entry.score}/{entry.total}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[30px] border border-white/70 bg-white/92 p-6 shadow-[0_22px_70px_rgba(15,23,42,0.07)]">
          <SectionHeader title="Weekly leaderboard" caption="Seven-day engagement ranking" />
          <div className="mt-6 space-y-3">
            {(overview.dailyQuiz?.weeklyLeaderboard || []).map((entry, index) => (
              <div key={`${entry.userId}-${entry.submittedAt}-weekly`} className="flex items-center justify-between rounded-[20px] bg-[var(--accent-cream)] px-4 py-4">
                <div>
                  <p className="text-sm font-semibold text-[var(--ink)]">Rank #{index + 1}</p>
                  <p className="text-xs text-[var(--ink-soft)]">{entry.name || entry.userId} • {entry.attempts || 1} attempts</p>
                </div>
                <p className="text-lg font-semibold text-[var(--accent-rust)]">{entry.score}/{entry.total}</p>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
};

const AnalyticsTab = ({ overview }: { overview: PlatformOverview }) => {
  const { user } = useAuth();
  const [aiMessage, setAiMessage] = useState('');
  const [aiReply, setAiReply] = useState<AiResponse | null>(null);
  const [asking, setAsking] = useState(false);

  const sendAi = async (message: string) => {
    if (!user || !message.trim()) {
      return;
    }

    setAsking(true);
    try {
      const response = await EduService.askAi(message);
      setAiReply(response);
      setAiMessage(message);
    } finally {
      setAsking(false);
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
      <section className="rounded-[30px] border border-white/70 bg-white/92 p-6 shadow-[0_22px_70px_rgba(15,23,42,0.07)]">
        <SectionHeader title="Performance analytics" caption="Accuracy, speed, topic health" />
        <div className="mt-6 grid gap-4">
          <MetricCard title="Accuracy" value={`${overview.analytics.accuracy}%`} hint="Derived from quiz + mock test results" icon={Target} />
          <MetricCard title="Speed" value={`${overview.analytics.speed}x`} hint="Tracks pace for mock environments" icon={Gauge} />
          <MetricCard title="Attempts" value={`${overview.analytics.attempts}`} hint="Quiz and test participation count" icon={ClipboardCheck} />
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-[24px] bg-[var(--accent-cream)] p-4">
            <p className="font-semibold text-[var(--ink)]">Weak topics</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {overview.analytics.weakTopics.map((topic) => (
                <span key={topic} className="rounded-full bg-white px-3 py-2 text-sm text-[var(--danger)]">{topic}</span>
              ))}
            </div>
          </div>
          <div className="rounded-[24px] bg-[var(--accent-cream)] p-4">
            <p className="font-semibold text-[var(--ink)]">Strong topics</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {(overview.analytics.strongTopics.length > 0 ? overview.analytics.strongTopics : ['General Awareness']).map((topic) => (
                <span key={topic} className="rounded-full bg-white px-3 py-2 text-sm text-[var(--success)]">{topic}</span>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-6 rounded-[24px] bg-[var(--card-dark)] p-5 text-white">
          <p className="text-sm font-semibold">Recommendation engine</p>
          <p className="mt-3 text-sm leading-7 text-white/75">{overview.analytics.suggestions[0]}</p>
        </div>
        <div className="mt-6 rounded-[24px] border border-[var(--line)] p-5">
          <p className="text-sm font-semibold text-[var(--ink)]">Adaptive test difficulty</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <span className="rounded-full bg-[var(--accent-cream)] px-3 py-2 text-sm text-[var(--ink)]">
              Next: {overview.analytics.adaptivePlan.nextTestType}
            </span>
            <span className="rounded-full bg-[var(--accent-cream)] px-3 py-2 text-sm text-[var(--ink)]">
              Difficulty: {overview.analytics.adaptivePlan.difficulty}
            </span>
          </div>
          <p className="mt-4 text-sm leading-7 text-[var(--ink-soft)]">{overview.analytics.adaptivePlan.reason}</p>
        </div>
      </section>

      <section className="rounded-[30px] border border-white/70 bg-white/92 p-6 shadow-[0_22px_70px_rgba(15,23,42,0.07)]">
        <SectionHeader title="AI coach" caption="Doubt solving + graph-based insights" />
        <div className="mt-6 rounded-[24px] bg-[var(--accent-cream)] p-4">
          <p className="text-sm font-semibold text-[var(--ink)]">Performance trend</p>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={overview.analytics.trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.25)" />
                <XAxis dataKey="label" stroke="#6b7280" tickLine={false} axisLine={false} />
                <YAxis stroke="#6b7280" tickLine={false} axisLine={false} width={42} />
                <Tooltip />
                <Line type="monotone" dataKey="accuracy" stroke="#c25b2d" strokeWidth={3} dot={{ r: 4 }} name="Accuracy %" />
                <Line type="monotone" dataKey="score" stroke="#0f172a" strokeWidth={3} dot={{ r: 4 }} name="Score" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          {overview.ai.prompts.map((prompt) => (
            <button
              key={prompt}
              onClick={() => void sendAi(prompt)}
              className="rounded-full border border-[var(--line)] px-4 py-2 text-sm text-[var(--ink-soft)] transition hover:border-[var(--accent-rust)]"
            >
              {prompt}
            </button>
          ))}
        </div>
        <textarea
          value={aiMessage}
          onChange={(event) => setAiMessage(event.target.value)}
          className="mt-6 h-40 w-full rounded-[24px] border border-[var(--line)] bg-[var(--accent-cream)] px-4 py-4 text-sm outline-none transition focus:border-[var(--accent-rust)]"
          placeholder="Ask for a 7-day revision plan, a topic strategy, or a recommendation on what to study next."
        />
        <button
          onClick={() => void sendAi(aiMessage)}
          disabled={asking}
          className="mt-4 flex items-center gap-2 rounded-2xl bg-[var(--accent-rust)] px-5 py-3 font-semibold text-white"
        >
          {asking ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <Bot className="h-5 w-5" />}
          Ask AI coach
        </button>
        {aiReply && (
          <div className="mt-6 rounded-[24px] border border-[var(--line)] p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--accent-cream)]">
                <Brain className="h-5 w-5 text-[var(--accent-rust)]" />
              </div>
              <div>
                <p className="text-sm font-semibold text-[var(--ink)]">AI answer</p>
                <p className="text-xs uppercase tracking-[0.24em] text-[var(--ink-soft)]">{formatDateTime(aiReply.createdAt)}</p>
              </div>
            </div>
            <p className="mt-4 text-sm leading-7 text-[var(--ink-soft)]">{aiReply.answer}</p>
          </div>
        )}
      </section>
    </div>
  );
};

const AdminTab = ({ overview, onRefresh }: { overview: PlatformOverview; onRefresh: () => Promise<void> }) => {
  const [activeAdminSection, setActiveAdminSection] = useState<'overview' | 'courses' | 'curriculum' | 'assessments' | 'security'>('overview');
  const [courseForm, setCourseForm] = useState({
    title: '',
    description: '',
    category: 'SSC JE',
    exam: 'SSC JE',
    subject: '',
    instructor: '',
    officialChannelUrl: '',
    price: 0,
    validityDays: 183,
    level: 'Full Course',
  });
  const [mockTestForm, setMockTestForm] = useState({
    title: '',
    category: 'SSC JE',
    type: 'sectional',
    durationMinutes: 60,
    negativeMarking: 0.25,
    topic: '',
    questionsJson: '',
  });
  const [quizForm, setQuizForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    prompt: '',
    options: '',
    answer: '',
    explanation: '',
    topic: '',
    questionsJson: '',
  });
  const [adminMessage, setAdminMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const aiProviderOptions = overview.ai.generation?.providers || [
    { id: 'auto', label: 'Auto', available: true, mode: 'fallback', description: 'Pick the best provider automatically.' },
    { id: 'mock', label: 'Local Fallback', available: true, mode: 'fallback', description: 'Generate local draft content without an external API.' },
  ];
  const defaultAiProvider = overview.ai.generation?.defaultProvider || 'auto';
  const [generatingMock, setGeneratingMock] = useState(false);
  const [generatingQuiz, setGeneratingQuiz] = useState(false);
  const [mockAiForm, setMockAiForm] = useState({
    provider: defaultAiProvider,
    subject: '',
    topic: '',
    difficulty: 'medium',
    questionCount: 20,
    durationMinutes: 60,
    instructions: '',
  });
  const [quizAiForm, setQuizAiForm] = useState({
    provider: defaultAiProvider,
    subject: '',
    topic: '',
    difficulty: 'medium',
    questionCount: 5,
    instructions: '',
  });

  const createCourse = async () => {
    setBusy(true);
    try {
      await EduService.createCourse({
        ...courseForm,
        modules: [],
        thumbnailUrl: 'https://picsum.photos/seed/new-course/900/600',
      });
      setAdminMessage('Course created through the backend API.');
      await onRefresh();
      setCourseForm({
        title: '',
        description: '',
        category: 'SSC JE',
        exam: 'SSC JE',
        subject: '',
        instructor: '',
        officialChannelUrl: '',
        price: 0,
        validityDays: 183,
        level: 'Full Course',
      });
    } finally {
      setBusy(false);
    }
  };

  const createMockTest = async () => {
    setBusy(true);
    try {
      const questions = JSON.parse(mockTestForm.questionsJson || '[]');
      if (!Array.isArray(questions) || questions.length === 0) {
        throw new Error('Add real mock questions in JSON format before creating the test.');
      }

      const sectionMap = questions.reduce((accumulator, question) => {
        const sectionName = String(question.topic || mockTestForm.topic || 'General').trim() || 'General';
        accumulator.set(sectionName, (accumulator.get(sectionName) || 0) + 1);
        return accumulator;
      }, new Map<string, number>());

      await EduService.createMockTest({
        title: mockTestForm.title,
        description: `Admin-created ${mockTestForm.type} test for ${mockTestForm.topic || 'selected topics'}`,
        category: mockTestForm.category,
        type: mockTestForm.type,
        durationMinutes: mockTestForm.durationMinutes,
        negativeMarking: mockTestForm.negativeMarking,
        totalMarks: questions.reduce((sum, question) => sum + Number(question.marks || 1), 0),
        sectionBreakup: Array.from(sectionMap.entries()).map(([name, questionCount]) => ({ name, questions: questionCount })),
        questions,
      });
      setAdminMessage('Mock test created through the secured admin flow.');
      await onRefresh();
      setMockTestForm({
        title: '',
        category: 'SSC JE',
        type: 'sectional',
        durationMinutes: 60,
        negativeMarking: 0.25,
        topic: '',
        questionsJson: '',
      });
    } catch (error) {
      setAdminMessage(error instanceof Error ? error.message : 'Unable to create mock test.');
    } finally {
      setBusy(false);
    }
  };

  const createQuiz = async () => {
    setBusy(true);
    try {
      let questions = [];
      if (quizForm.questionsJson.trim()) {
        const parsed = JSON.parse(quizForm.questionsJson);
        if (!Array.isArray(parsed) || parsed.length === 0) {
          throw new Error('Questions JSON must be a non-empty array.');
        }

        questions = parsed.map((question, index) => {
          const options = Array.isArray(question.options)
            ? question.options.map((item: string) => String(item || '').trim()).filter(Boolean)
            : [];

          if (!String(question.prompt || '').trim() || options.length < 2 || !String(question.answer || '').trim() || !String(question.topic || '').trim()) {
            throw new Error(`Quiz question ${index + 1} is missing prompt, options, answer, or topic.`);
          }

          return {
            id: String(question.id || `quiz_${Date.now()}_${index + 1}`),
            prompt: String(question.prompt).trim(),
            options,
            answer: String(question.answer).trim(),
            explanation: String(question.explanation || '').trim(),
            topic: String(question.topic).trim(),
          };
        });
      } else {
        const options = quizForm.options.split(',').map((item) => item.trim()).filter(Boolean);
        if (!quizForm.prompt.trim() || options.length < 2 || !quizForm.answer.trim() || !quizForm.topic.trim()) {
          throw new Error('Enter a real quiz question, at least two options, the correct answer, and a topic.');
        }

        questions = [
          {
            id: `quiz_${Date.now()}`,
            prompt: quizForm.prompt,
            options,
            answer: quizForm.answer,
            explanation: quizForm.explanation,
            topic: quizForm.topic,
          },
        ];
      }

      await EduService.createQuiz({
        date: quizForm.date,
        questions,
      });
      setAdminMessage('Daily quiz created through the secured admin flow.');
      await onRefresh();
      setQuizForm({
        date: new Date().toISOString().slice(0, 10),
        prompt: '',
        options: '',
        answer: '',
        explanation: '',
        topic: '',
        questionsJson: '',
      });
    } catch (error) {
      setAdminMessage(error instanceof Error ? error.message : 'Unable to create daily quiz.');
    } finally {
      setBusy(false);
    }
  };

  const generateMockTestDraft = async () => {
    setGeneratingMock(true);
    setAdminMessage(null);
    try {
      const generated = await EduService.generateAssessmentDraft({
        provider: mockAiForm.provider,
        contentType: 'mock-test',
        exam: mockTestForm.category,
        subject: mockAiForm.subject,
        topic: mockAiForm.topic || mockTestForm.topic,
        title: mockTestForm.title,
        type: mockTestForm.type,
        difficulty: mockAiForm.difficulty,
        questionCount: mockAiForm.questionCount,
        durationMinutes: mockAiForm.durationMinutes,
        negativeMarking: mockTestForm.negativeMarking,
        instructions: mockAiForm.instructions,
      });

      if (!generated.mockTest) {
        throw new Error('Mock test draft was not returned by the AI generator.');
      }

      setMockTestForm((current) => ({
        ...current,
        title: generated.mockTest?.title || current.title,
        category: generated.mockTest?.category || current.category,
        type: generated.mockTest?.type || current.type,
        durationMinutes: generated.mockTest?.durationMinutes || current.durationMinutes,
        negativeMarking: generated.mockTest?.negativeMarking ?? current.negativeMarking,
        topic: generated.mockTest?.sectionBreakup?.[0]?.name || mockAiForm.topic || current.topic,
        questionsJson: JSON.stringify(generated.mockTest.questions, null, 2),
      }));
      setAdminMessage(`${generated.message} The mock test draft is loaded below for review.`);
    } catch (error) {
      setAdminMessage(error instanceof Error ? error.message : 'Unable to generate mock test draft.');
    } finally {
      setGeneratingMock(false);
    }
  };

  const generateDailyQuizDraft = async () => {
    setGeneratingQuiz(true);
    setAdminMessage(null);
    try {
      const generated = await EduService.generateAssessmentDraft({
        provider: quizAiForm.provider,
        contentType: 'daily-quiz',
        exam: mockTestForm.category,
        subject: quizAiForm.subject,
        topic: quizAiForm.topic || quizForm.topic,
        difficulty: quizAiForm.difficulty,
        questionCount: quizAiForm.questionCount,
        quizDate: quizForm.date,
        instructions: quizAiForm.instructions,
      });

      if (!generated.dailyQuiz) {
        throw new Error('Daily quiz draft was not returned by the AI generator.');
      }

      const firstQuestion = generated.dailyQuiz.questions[0];
      setQuizForm((current) => ({
        ...current,
        date: generated.dailyQuiz?.date || current.date,
        prompt: firstQuestion?.prompt || '',
        options: firstQuestion?.options?.join(', ') || '',
        answer: firstQuestion?.answer || '',
        explanation: firstQuestion?.explanation || '',
        topic: firstQuestion?.topic || quizAiForm.topic || current.topic,
        questionsJson: JSON.stringify(generated.dailyQuiz.questions, null, 2),
      }));
      setAdminMessage(`${generated.message} The daily quiz draft is loaded below for review.`);
    } catch (error) {
      setAdminMessage(error instanceof Error ? error.message : 'Unable to generate daily quiz draft.');
    } finally {
      setGeneratingQuiz(false);
    }
  };

  const adminSections: Array<{
    id: 'overview' | 'courses' | 'curriculum' | 'assessments' | 'security';
    label: string;
    caption: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'overview', label: 'Overview', caption: 'Health and readiness', icon: LayoutDashboard },
    { id: 'courses', label: 'Courses', caption: 'Catalog and pricing', icon: BookOpen },
    { id: 'curriculum', label: 'Curriculum', caption: 'Subjects and video assets', icon: GraduationCap },
    { id: 'assessments', label: 'Assessments', caption: 'Mocks and quizzes', icon: ClipboardCheck },
    { id: 'security', label: 'Security', caption: 'Sessions and devices', icon: ShieldCheck },
  ];

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[34px] border border-white/70 bg-[radial-gradient(circle_at_top_left,rgba(22,152,212,0.18),transparent_24%),radial-gradient(circle_at_bottom_right,rgba(255,186,73,0.16),transparent_22%),linear-gradient(135deg,#0f1d33_0%,#17385d_48%,#195f7f_100%)] p-6 text-white shadow-[0_26px_80px_rgba(15,23,42,0.22)] sm:p-8">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-white/58">Admin workspace</p>
            <h2 className="mt-4 text-3xl font-semibold sm:text-[2.6rem]">Operate the platform in focused lanes instead of one long page.</h2>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-white/74 sm:text-base">
              Courses, curriculum, assessments, and device security now live in separate tabs so admins can switch context fast without losing the current workflow.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:min-w-[360px]">
            <div className="rounded-[24px] border border-white/12 bg-white/10 p-4 backdrop-blur">
              <p className="text-xs uppercase tracking-[0.16em] text-white/58">Active users</p>
              <p className="mt-2 text-3xl font-semibold">{overview.adminOverview?.activeUsers || 0}</p>
              <p className="mt-2 text-sm text-white/68">Registered and available on the platform right now.</p>
            </div>
            <div className="rounded-[24px] border border-white/12 bg-white/10 p-4 backdrop-blur">
              <p className="text-xs uppercase tracking-[0.16em] text-white/58">Revenue</p>
              <p className="mt-2 text-3xl font-semibold">{currency.format(overview.adminOverview?.revenue || 0)}</p>
              <p className="mt-2 text-sm text-white/68">Paid collections flowing through the secured backend.</p>
            </div>
          </div>
        </div>

        <div className="mt-8 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          {adminSections.map(({ id, label, caption, icon: Icon }) => (
            <button
              key={id}
              type="button"
              data-testid={`admin-section-${id}`}
              onClick={() => setActiveAdminSection(id)}
              className={cn(
                'rounded-[22px] border px-4 py-4 text-left transition',
                activeAdminSection === id
                  ? 'border-white/30 bg-white text-[#10253c] shadow-[0_18px_40px_rgba(12,18,28,0.18)]'
                  : 'border-white/12 bg-white/8 text-white hover:bg-white/12',
              )}
            >
              <div className="flex items-center gap-3">
                <div className={cn(
                  'flex h-11 w-11 items-center justify-center rounded-2xl',
                  activeAdminSection === id ? 'bg-[var(--accent-cream)] text-[var(--accent-rust)]' : 'bg-white/12 text-white',
                )}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{label}</p>
                  <p className={cn('mt-1 text-xs', activeAdminSection === id ? 'text-[#607089]' : 'text-white/64')}>{caption}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </section>

      {adminMessage && (
        <div className="rounded-[24px] border border-[var(--success)]/18 bg-[var(--success-soft)] px-5 py-4 text-sm text-[var(--success)]">
          {adminMessage}
        </div>
      )}

      {activeAdminSection === 'overview' && (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <MetricCard title="Active users" value={`${overview.adminOverview?.activeUsers || 0}`} hint="Current registered learners" icon={UserCircle2} />
            <MetricCard title="Active sessions" value={`${overview.adminOverview?.activeSessions || 0}`} hint="Single-session protection" icon={ShieldCheck} />
            <MetricCard title="Revenue" value={currency.format(overview.adminOverview?.revenue || 0)} hint="Paid backend totals" icon={Wallet} />
            <MetricCard title="Participation" value={`${overview.adminOverview?.testParticipation || 0}`} hint="Quiz plus mock submissions" icon={ClipboardCheck} />
            <MetricCard title="Capacity target" value={overview.adminOverview?.concurrentCapacityTarget || '10K'} hint="Target concurrency" icon={Gauge} />
          </div>

          <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
            <section className="rounded-[30px] border border-white/70 bg-white/92 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.07)]">
              <SectionHeader title="Operational posture" caption="What this admin system is optimized for" />
              <div className="mt-6 space-y-4">
                <div className="rounded-[24px] bg-[var(--accent-cream)] p-5 text-sm leading-7 text-[var(--ink-soft)]">
                  This admin panel now separates strategy from execution. Use overview for readiness, then move into focused tabs for course catalog changes, curriculum work, assessments, and security checks.
                </div>
                <div className="rounded-[24px] border border-[var(--line)] bg-white p-5">
                  <p className="text-sm font-semibold text-[var(--ink)]">AI provider status</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {aiProviderOptions.map((provider) => (
                      <span
                        key={provider.id}
                        className={cn(
                          'rounded-full px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em]',
                          provider.available
                            ? provider.mode === 'fallback'
                              ? 'bg-[var(--accent-cream)] text-[var(--accent-rust)]'
                              : 'bg-[var(--success-soft)] text-[var(--success)]'
                            : 'bg-slate-100 text-slate-500',
                        )}
                      >
                        {provider.label} • {provider.available ? provider.mode : 'off'}
                      </span>
                    ))}
                  </div>
                  <p className="mt-3 text-sm text-[var(--ink-soft)]">
                    For low-cost production use, set `GEMINI_API_KEY`. For any other model vendor, configure `AI_API_KEY`, `AI_BASE_URL`, and `AI_MODEL`.
                  </p>
                </div>
              </div>
            </section>

            <section className="rounded-[30px] border border-white/70 bg-white/92 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.07)]">
              <SectionHeader title="Recent device activity" caption="Latest security and session events" />
              <div className="mt-6 grid gap-3">
                {(overview.adminOverview?.recentDeviceActivity || []).slice(0, 6).map((activity) => (
                  <div key={activity._id} className="rounded-[22px] bg-[var(--accent-cream)] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-[var(--ink)]">{formatEventLabel(activity.eventType)}</p>
                        <p className="mt-1 text-xs uppercase tracking-[0.16em] text-[var(--ink-soft)]">{activity.device || 'unknown device'}</p>
                      </div>
                      <span className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-soft)]">
                        {formatDateTime(activity.createdAt)}
                      </span>
                    </div>
                    <p className="mt-3 text-sm text-[var(--ink-soft)]">User: {activity.userId}</p>
                  </div>
                ))}
                {(overview.adminOverview?.recentDeviceActivity || []).length === 0 && (
                  <div className="rounded-[22px] border border-dashed border-[var(--line)] p-5 text-sm text-[var(--ink-soft)]">
                    No recent device activity is available yet.
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      )}

      {activeAdminSection === 'courses' && (
        <div className="space-y-6">
          <section className="rounded-[30px] border border-white/70 bg-white/92 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.07)]">
            <SectionHeader title="Create course" caption="Catalog, pricing, and publishing baseline" />
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <input value={courseForm.title} onChange={(event) => setCourseForm((current) => ({ ...current, title: event.target.value }))} placeholder="Course title" className="rounded-2xl border border-[var(--line)] bg-[var(--accent-cream)] px-4 py-4 outline-none" />
              <input value={courseForm.subject} onChange={(event) => setCourseForm((current) => ({ ...current, subject: event.target.value }))} placeholder="Subject" className="rounded-2xl border border-[var(--line)] bg-[var(--accent-cream)] px-4 py-4 outline-none" />
              <input value={courseForm.instructor} onChange={(event) => setCourseForm((current) => ({ ...current, instructor: event.target.value }))} placeholder="Instructor" className="rounded-2xl border border-[var(--line)] bg-[var(--accent-cream)] px-4 py-4 outline-none" />
              <input value={courseForm.officialChannelUrl} onChange={(event) => setCourseForm((current) => ({ ...current, officialChannelUrl: event.target.value }))} placeholder="Official channel URL" className="rounded-2xl border border-[var(--line)] bg-[var(--accent-cream)] px-4 py-4 outline-none" />
              <input type="number" value={courseForm.price} onChange={(event) => setCourseForm((current) => ({ ...current, price: Number(event.target.value) }))} placeholder="Price" className="rounded-2xl border border-[var(--line)] bg-[var(--accent-cream)] px-4 py-4 outline-none" />
              <input value={courseForm.category} onChange={(event) => setCourseForm((current) => ({ ...current, category: event.target.value }))} placeholder="Category" className="rounded-2xl border border-[var(--line)] bg-[var(--accent-cream)] px-4 py-4 outline-none" />
              <input value={courseForm.level} onChange={(event) => setCourseForm((current) => ({ ...current, level: event.target.value }))} placeholder="Level" className="rounded-2xl border border-[var(--line)] bg-[var(--accent-cream)] px-4 py-4 outline-none" />
              <textarea value={courseForm.description} onChange={(event) => setCourseForm((current) => ({ ...current, description: event.target.value }))} placeholder="Course description" className="md:col-span-2 h-32 rounded-2xl border border-[var(--line)] bg-[var(--accent-cream)] px-4 py-4 outline-none" />
              <div className="md:col-span-2">
                <button onClick={() => void createCourse()} disabled={busy} className="rounded-2xl bg-[var(--ink)] px-5 py-4 font-semibold text-white">
                  Create course
                </button>
              </div>
            </div>
          </section>

          <AdminCourseManager courses={overview.courses || []} onCoursesChanged={onRefresh} />
        </div>
      )}

      {activeAdminSection === 'curriculum' && (
        <div className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
            <section className="rounded-[30px] border border-white/70 bg-white/92 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.07)]">
              <SectionHeader title="Curriculum flow" caption="Build in this order" />
              <div className="mt-6 grid gap-4 md:grid-cols-3">
                {[
                  ['1', 'Create course', 'Define the catalog shell, pricing, and instructor details first.'],
                  ['2', 'Add subject tree', 'Build subject and chapter structure before you attach content.'],
                  ['3', 'Upload protected video', 'Attach topic videos into the exact subject or chapter path.'],
                ].map(([step, title, text]) => (
                  <div key={step} className="rounded-[22px] bg-[var(--accent-cream)] p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-soft)]">Step {step}</p>
                    <p className="mt-2 text-lg font-semibold text-[var(--ink)]">{title}</p>
                    <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">{text}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-[30px] border border-white/70 bg-white/92 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.07)]">
              <SectionHeader title="Content estate" caption="Current platform size" />
              <div className="mt-6 grid gap-4 md:grid-cols-3">
                <MetricCard title="Courses" value={`${overview.courses.length}`} hint="Catalog entries now live" icon={BookOpen} />
                <MetricCard title="Subjects" value={`${overview.courses.reduce((sum, course) => sum + (course.modules?.length || 0), 0)}`} hint="Subject nodes across all courses" icon={GraduationCap} />
                <MetricCard title="Topics" value={`${overview.courses.reduce((sum, course) => sum + ((course.lessonCount || 0) || 0), 0)}`} hint="Lesson topics available to learners" icon={Video} />
              </div>
            </section>
          </div>

          <AdminModuleManager courses={overview.courses || []} onModulesChanged={onRefresh} />
          <AdminVideoUpload courses={overview.courses || []} onVideoUploaded={onRefresh} />
        </div>
      )}

      {activeAdminSection === 'assessments' && (
        <div className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-2">
            <section className="rounded-[30px] border border-white/70 bg-white/92 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.07)]">
              <SectionHeader title="Create mock test" caption="Sectional, topic-wise, or full-length" />
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <select
                  value={mockAiForm.provider}
                  onChange={(event) => setMockAiForm((current) => ({ ...current, provider: event.target.value }))}
                  className="rounded-2xl border border-[var(--line)] bg-[var(--accent-cream)] px-4 py-4 outline-none"
                >
                  {aiProviderOptions.map((provider) => (
                    <option key={provider.id} value={provider.id} disabled={!provider.available && provider.id !== 'auto'}>
                      {provider.label} {provider.available ? '' : '(Not configured)'}
                    </option>
                  ))}
                </select>
                <input value={mockAiForm.subject} onChange={(event) => setMockAiForm((current) => ({ ...current, subject: event.target.value }))} placeholder="AI subject" className="rounded-2xl border border-[var(--line)] bg-[var(--accent-cream)] px-4 py-4 outline-none" />
                <input value={mockAiForm.topic} onChange={(event) => setMockAiForm((current) => ({ ...current, topic: event.target.value }))} placeholder="AI topic focus" className="rounded-2xl border border-[var(--line)] bg-[var(--accent-cream)] px-4 py-4 outline-none" />
                <select value={mockAiForm.difficulty} onChange={(event) => setMockAiForm((current) => ({ ...current, difficulty: event.target.value }))} className="rounded-2xl border border-[var(--line)] bg-[var(--accent-cream)] px-4 py-4 outline-none">
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                </select>
                <input type="number" value={mockAiForm.questionCount} onChange={(event) => setMockAiForm((current) => ({ ...current, questionCount: Number(event.target.value) }))} placeholder="AI question count" className="rounded-2xl border border-[var(--line)] bg-[var(--accent-cream)] px-4 py-4 outline-none" />
                <input type="number" value={mockAiForm.durationMinutes} onChange={(event) => setMockAiForm((current) => ({ ...current, durationMinutes: Number(event.target.value) }))} placeholder="AI duration" className="rounded-2xl border border-[var(--line)] bg-[var(--accent-cream)] px-4 py-4 outline-none" />
                <textarea
                  value={mockAiForm.instructions}
                  onChange={(event) => setMockAiForm((current) => ({ ...current, instructions: event.target.value }))}
                  placeholder="Optional AI instructions: chapter mix, exam style, calculation-heavy, etc."
                  className="md:col-span-2 h-24 rounded-2xl border border-[var(--line)] bg-[var(--accent-cream)] px-4 py-4 outline-none"
                />
                <div className="md:col-span-2 flex flex-wrap gap-3">
                  <button onClick={() => void generateMockTestDraft()} disabled={generatingMock} className="rounded-2xl bg-[var(--accent-rust)] px-5 py-4 font-semibold text-white disabled:opacity-60">
                    {generatingMock ? 'Generating mock draft...' : 'Generate with AI'}
                  </button>
                  <span className="self-center text-sm text-[var(--ink-soft)]">AI fills the JSON draft below. You can edit it before saving.</span>
                </div>
                <input value={mockTestForm.title} onChange={(event) => setMockTestForm((current) => ({ ...current, title: event.target.value }))} placeholder="Mock test title" className="rounded-2xl border border-[var(--line)] bg-[var(--accent-cream)] px-4 py-4 outline-none" />
                <input value={mockTestForm.topic} onChange={(event) => setMockTestForm((current) => ({ ...current, topic: event.target.value }))} placeholder="Topic / section" className="rounded-2xl border border-[var(--line)] bg-[var(--accent-cream)] px-4 py-4 outline-none" />
                <input value={mockTestForm.category} onChange={(event) => setMockTestForm((current) => ({ ...current, category: event.target.value }))} placeholder="Category" className="rounded-2xl border border-[var(--line)] bg-[var(--accent-cream)] px-4 py-4 outline-none" />
                <input value={mockTestForm.type} onChange={(event) => setMockTestForm((current) => ({ ...current, type: event.target.value }))} placeholder="Type" className="rounded-2xl border border-[var(--line)] bg-[var(--accent-cream)] px-4 py-4 outline-none" />
                <input type="number" value={mockTestForm.durationMinutes} onChange={(event) => setMockTestForm((current) => ({ ...current, durationMinutes: Number(event.target.value) }))} placeholder="Duration" className="rounded-2xl border border-[var(--line)] bg-[var(--accent-cream)] px-4 py-4 outline-none" />
                <input type="number" step="0.01" value={mockTestForm.negativeMarking} onChange={(event) => setMockTestForm((current) => ({ ...current, negativeMarking: Number(event.target.value) }))} placeholder="Negative marking" className="rounded-2xl border border-[var(--line)] bg-[var(--accent-cream)] px-4 py-4 outline-none" />
                <textarea
                  value={mockTestForm.questionsJson}
                  onChange={(event) => setMockTestForm((current) => ({ ...current, questionsJson: event.target.value }))}
                  placeholder='Questions JSON: [{"id":"q1","questionText":"...","options":["A","B","C","D"],"correctOption":1,"explanation":"...","marks":1,"topic":"Network Theory"}]'
                  className="md:col-span-2 h-36 rounded-2xl border border-[var(--line)] bg-[var(--accent-cream)] px-4 py-4 outline-none"
                />
                <div className="md:col-span-2">
                  <button onClick={() => void createMockTest()} disabled={busy} className="rounded-2xl bg-[var(--ink)] px-5 py-4 font-semibold text-white">
                    Create mock test
                  </button>
                </div>
              </div>
            </section>

            <section className="rounded-[30px] border border-white/70 bg-white/92 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.07)]">
              <SectionHeader title="Create daily quiz" caption="Engagement + streak engine" />
              <div className="mt-6 grid gap-4">
                <input value={quizForm.date} onChange={(event) => setQuizForm((current) => ({ ...current, date: event.target.value }))} type="date" className="rounded-2xl border border-[var(--line)] bg-[var(--accent-cream)] px-4 py-4 outline-none" />
                <select
                  value={quizAiForm.provider}
                  onChange={(event) => setQuizAiForm((current) => ({ ...current, provider: event.target.value }))}
                  className="rounded-2xl border border-[var(--line)] bg-[var(--accent-cream)] px-4 py-4 outline-none"
                >
                  {aiProviderOptions.map((provider) => (
                    <option key={provider.id} value={provider.id} disabled={!provider.available && provider.id !== 'auto'}>
                      {provider.label} {provider.available ? '' : '(Not configured)'}
                    </option>
                  ))}
                </select>
                <input value={quizAiForm.subject} onChange={(event) => setQuizAiForm((current) => ({ ...current, subject: event.target.value }))} placeholder="AI subject" className="rounded-2xl border border-[var(--line)] bg-[var(--accent-cream)] px-4 py-4 outline-none" />
                <input value={quizAiForm.topic} onChange={(event) => setQuizAiForm((current) => ({ ...current, topic: event.target.value }))} placeholder="AI topic focus" className="rounded-2xl border border-[var(--line)] bg-[var(--accent-cream)] px-4 py-4 outline-none" />
                <div className="grid gap-4 md:grid-cols-2">
                  <select value={quizAiForm.difficulty} onChange={(event) => setQuizAiForm((current) => ({ ...current, difficulty: event.target.value }))} className="rounded-2xl border border-[var(--line)] bg-[var(--accent-cream)] px-4 py-4 outline-none">
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </select>
                  <input type="number" value={quizAiForm.questionCount} onChange={(event) => setQuizAiForm((current) => ({ ...current, questionCount: Number(event.target.value) }))} placeholder="AI question count" className="rounded-2xl border border-[var(--line)] bg-[var(--accent-cream)] px-4 py-4 outline-none" />
                </div>
                <textarea value={quizAiForm.instructions} onChange={(event) => setQuizAiForm((current) => ({ ...current, instructions: event.target.value }))} placeholder="Optional AI instructions: quick recall, mixed topics, one-liners, etc." className="h-24 rounded-2xl border border-[var(--line)] bg-[var(--accent-cream)] px-4 py-4 outline-none" />
                <div className="flex flex-wrap gap-3">
                  <button onClick={() => void generateDailyQuizDraft()} disabled={generatingQuiz} className="rounded-2xl bg-[var(--accent-rust)] px-5 py-4 font-semibold text-white disabled:opacity-60">
                    {generatingQuiz ? 'Generating quiz draft...' : 'Generate with AI'}
                  </button>
                  <span className="self-center text-sm text-[var(--ink-soft)]">AI can prepare a multi-question quiz. Review the JSON before saving.</span>
                </div>
                <input value={quizForm.prompt} onChange={(event) => setQuizForm((current) => ({ ...current, prompt: event.target.value }))} placeholder="Quiz question" className="rounded-2xl border border-[var(--line)] bg-[var(--accent-cream)] px-4 py-4 outline-none" />
                <input value={quizForm.options} onChange={(event) => setQuizForm((current) => ({ ...current, options: event.target.value }))} placeholder="Comma-separated options" className="rounded-2xl border border-[var(--line)] bg-[var(--accent-cream)] px-4 py-4 outline-none" />
                <div className="grid gap-4 md:grid-cols-2">
                  <input value={quizForm.answer} onChange={(event) => setQuizForm((current) => ({ ...current, answer: event.target.value }))} placeholder="Correct answer" className="rounded-2xl border border-[var(--line)] bg-[var(--accent-cream)] px-4 py-4 outline-none" />
                  <input value={quizForm.topic} onChange={(event) => setQuizForm((current) => ({ ...current, topic: event.target.value }))} placeholder="Topic" className="rounded-2xl border border-[var(--line)] bg-[var(--accent-cream)] px-4 py-4 outline-none" />
                </div>
                <textarea value={quizForm.explanation} onChange={(event) => setQuizForm((current) => ({ ...current, explanation: event.target.value }))} placeholder="Explanation" className="h-28 rounded-2xl border border-[var(--line)] bg-[var(--accent-cream)] px-4 py-4 outline-none" />
                <textarea value={quizForm.questionsJson} onChange={(event) => setQuizForm((current) => ({ ...current, questionsJson: event.target.value }))} placeholder='Questions JSON (optional for multi-question quiz): [{"prompt":"...","options":["A","B","C","D"],"answer":"A","explanation":"...","topic":"..."}]' className="h-36 rounded-2xl border border-[var(--line)] bg-[var(--accent-cream)] px-4 py-4 outline-none" />
                <div>
                  <button onClick={() => void createQuiz()} disabled={busy} className="rounded-2xl bg-[var(--accent-rust)] px-5 py-4 font-semibold text-white">
                    Create daily quiz
                  </button>
                </div>
              </div>
            </section>
          </div>
        </div>
      )}

      {activeAdminSection === 'security' && (
        <section className="rounded-[30px] border border-white/70 bg-white/92 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.07)]">
          <SectionHeader title="Recent device activity" caption="Login sessions and device events" />
          <div className="mt-6 grid gap-3 lg:grid-cols-2">
            {(overview.adminOverview?.recentDeviceActivity || []).map((activity) => (
              <div key={activity._id} className="rounded-[22px] bg-[var(--accent-cream)] p-4">
                <p className="text-sm font-semibold text-[var(--ink)]">{formatEventLabel(activity.eventType)}</p>
                <p className="mt-1 text-xs uppercase tracking-[0.16em] text-[var(--ink-soft)]">{activity.device || 'unknown device'}</p>
                <p className="mt-3 text-sm text-[var(--ink-soft)]">User: {activity.userId}</p>
                <p className="mt-1 text-sm text-[var(--ink-soft)]">{formatDateTime(activity.createdAt)}</p>
              </div>
            ))}
            {(overview.adminOverview?.recentDeviceActivity || []).length === 0 && (
              <div className="rounded-[22px] border border-dashed border-[var(--line)] p-6 text-sm text-[var(--ink-soft)]">
                No device events are available yet.
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
};

const AppContent = () => {
  const { user, loading, logout } = useAuth();
  const [publicOverview, setPublicOverview] = useState<PlatformOverview | null>(null);
  const [overview, setOverview] = useState<PlatformOverview | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [resumeTarget, setResumeTarget] = useState<{ courseId: string; lessonId?: string | null } | null>(null);
  const [savedTopicIds, setSavedTopicIds] = useState<string[]>([]);

  const refreshOverview = async (background = true) => {
    if (!background) {
      setLoadingOverview(true);
    }
    try {
      const nextPublicOverview = await EduService.getPlatformOverview();
      setPublicOverview(nextPublicOverview);

      if (user) {
        const nextOverview = await EduService.getPlatformOverview();
        setOverview(nextOverview);
      } else {
        setOverview(null);
      }
    } finally {
      if (!background) {
        setLoadingOverview(false);
      }
    }
  };

  useLayoutEffect(() => {
    void refreshOverview(false);
  }, [user]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');

    if (tab && tab in shellTabMeta) {
      setActiveTab(tab as TabKey);
    }
  }, []);

  useEffect(() => {
    if (!user || typeof window === 'undefined') {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      void refreshOverview(true);
    }, 20000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [user]);

  useEffect(() => {
    if (!user?._id || typeof window === 'undefined') {
      setSavedTopicIds([]);
      return;
    }

    try {
      const raw = window.localStorage.getItem(buildSavedTopicsKey(user._id));
      const parsed = raw ? JSON.parse(raw) as string[] : [];
      setSavedTopicIds(Array.isArray(parsed) ? parsed : []);
    } catch {
      setSavedTopicIds([]);
    }
  }, [user?._id]);

  const savedTopics = useMemo(() => {
    if (!overview || !savedTopicIds.length) {
      return [];
    }

    const savedTopicSet = new Set(savedTopicIds);
    return overview.courses.flatMap((course) =>
      flattenCourseLessons(course)
        .filter((entry) => savedTopicSet.has(`${course._id}:${entry.lesson.id}`))
        .map((entry) => {
          const progress = (course.lessonProgress || []).find((item) => item.lessonId === entry.lesson.id);
          return {
            courseId: course._id,
            lessonId: entry.lesson.id,
            savedAt: '',
            courseTitle: course.title,
            lessonTitle: entry.lesson.title,
            exam: course.exam,
            thumbnailUrl: course.thumbnailUrl,
            moduleTitle: entry.moduleTitle,
            chapterTitle: entry.chapterTitle,
            progressSeconds: progress?.progressSeconds || 0,
            completed: progress?.completed || false,
          } as SavedTopic;
        }))
      .sort((left, right) => savedTopicIds.indexOf(`${left.courseId}:${left.lessonId}`) - savedTopicIds.indexOf(`${right.courseId}:${right.lessonId}`));
  }, [overview, savedTopicIds]);

  const toggleSavedTopic = (courseId: string, lessonId: string) => {
    if (!user?._id || typeof window === 'undefined') {
      return;
    }

    setSavedTopicIds((current) => {
      const topicKey = `${courseId}:${lessonId}`;
      const next = current.includes(topicKey)
        ? current.filter((item) => item !== topicKey)
        : [topicKey, ...current];
      window.localStorage.setItem(buildSavedTopicsKey(user._id), JSON.stringify(next));
      return next;
    });
  };

  const openNotification = (notification: NotificationItem) => {
    if (notification.actionUrl && typeof window !== 'undefined') {
      window.location.href = notification.actionUrl;
    }
  };

  if (loading || loadingOverview || (user && !overview)) {
    return <LoadingShell />;
  }

  if (!user) {
    return <AuthScreen publicOverview={publicOverview} />;
  }

  if (!overview) {
    return <LoadingShell />;
  }

  return (
    <Shell
      overview={overview}
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      onLogout={logout}
      onRefresh={() => refreshOverview(true)}
      resumeTarget={resumeTarget}
      onContinueLearningNavigate={(courseId, lessonId) => setResumeTarget({ courseId, lessonId })}
      onOpenNotification={openNotification}
      onResumeNavigationHandled={() => setResumeTarget(null)}
      savedTopicIds={savedTopicIds}
      savedTopics={savedTopics}
      onToggleSavedTopic={toggleSavedTopic}
    />
  );
};

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
