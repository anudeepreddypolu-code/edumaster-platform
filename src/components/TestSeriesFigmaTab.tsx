import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  Bookmark,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Expand,
  FileText,
  Languages,
  List,
  ListFilter,
  MonitorPlay,
  MoreVertical,
  Pause,
  PlayCircle,
  Search,
  Share2,
  Star,
  UserCircle2,
  Users,
  Video,
  X,
} from 'lucide-react';
import { LiveClass, MockQuestion, MockTest, PlatformOverview } from '../types';
import { cn } from '../lib/utils';
import { BrandLogo } from './BrandLogo';

type TestSeriesFigmaTabProps = {
  overview: PlatformOverview;
  onRefresh: () => Promise<void>;
  onImmersiveModeChange?: (immersive: boolean) => void;
  onOpenLiveClass?: (liveClassId: string) => void;
};

type Screen = 'home' | 'detail' | 'instructions' | 'confirmation' | 'exam' | 'result' | 'solutions';
type SectionId = 'PART-A';
type QuestionState = 'unvisited' | 'unanswered' | 'answered' | 'review' | 'answered-review';

type SeriesCard = {
  id: string;
  title: string;
  testsLabel: string;
  progressText: string;
  statsLabel: string;
  chipTone: 'purple' | 'orange' | 'pink' | 'blue';
};

type DetailTestCard = {
  id: string;
  mockTestId?: string | null;
  title: string;
  usersLabel: string;
  button: string;
  companionAction: string;
  companionMeta: string;
  companionTone: 'blue' | 'emerald' | 'amber';
};

type ResolvedDetailTestCard = DetailTestCard & {
  liveClassId: string | null;
  companionButtonLabel: string;
  companionPrimaryMeta: string;
  companionSecondaryMeta: string;
};

type RecommendedTestItem = {
  id: string;
  title: string;
  typeLabel: string;
  secondaryLabel: string;
  attemptedLabel: string;
  iconTone: 'emerald' | 'violet' | 'orange';
  seriesId: string;
};

type QuickActionItem = {
  id: string;
  label: string;
  iconTone: 'blue' | 'violet' | 'emerald' | 'orange';
  onPress: 'detail' | 'home';
};

type ExamQuestion = {
  id: string;
  section: SectionId;
  prompt: string;
  options: string[];
  marks: number;
  correctIndex: number;
  correctIndexes: number[];
  explanation: string;
  topic: string;
};

type AttemptQuestionResult = {
  questionId: string;
  questionNumber: number;
  prompt: string;
  options: string[];
  selectedIndexes: number[];
  correctIndexes: number[];
  explanation: string;
  marks: number;
  topic: string;
  status: 'correct' | 'incorrect' | 'unattempted';
};

type AttemptStatus = 'not-started' | 'in-progress' | 'completed';

type AttemptSession = {
  status: AttemptStatus;
  visitedQuestions: Record<number, boolean>;
  answers: Record<number, number[]>;
  review: Record<number, boolean>;
  currentIndex: number;
  timeLeft: number;
  defaultLanguage: string;
  selectedLanguage: string;
  confirmationAccepted: boolean;
};

type SeriesDetailMeta = {
  title: string;
  breadcrumb: string;
  totalTests: string;
  freeTests: string;
  users: string;
  languages: string;
  updatedOn: string;
  progressLabel: string;
  progressPercent: string;
  paperLabel: string;
};

const uiFontStack = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const cbtFontStack = 'Arial, Helvetica, sans-serif';
const MOCK_TEST_LINK_TAG_PREFIX = 'mock-test:';
const MOCK_TEST_ID_TAG_PREFIX = 'mock-test-id:';

const normalizeMockTestTitle = (value: string) =>
  String(value || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const extractLinkedMockTestTitle = (topicTags: string[] = []) => {
  const linkedTag = (topicTags || []).find((tag) => String(tag || '').toLowerCase().startsWith(MOCK_TEST_LINK_TAG_PREFIX));
  return linkedTag ? linkedTag.slice(MOCK_TEST_LINK_TAG_PREFIX.length).trim() : '';
};

const extractLinkedMockTestId = (topicTags: string[] = []) => {
  const linkedTag = (topicTags || []).find((tag) => String(tag || '').toLowerCase().startsWith(MOCK_TEST_ID_TAG_PREFIX));
  return linkedTag ? linkedTag.slice(MOCK_TEST_ID_TAG_PREFIX.length).trim() : '';
};

const splitCompanionMeta = (meta: string) => {
  const trimmed = String(meta || '').trim();
  const explanationMatch = trimmed.match(/^(.*?)(?:\s+explanation session)$/i);

  if (explanationMatch) {
    return {
      primary: explanationMatch[1].trim(),
      secondary: 'Explanation session',
    };
  }

  return {
    primary: trimmed,
    secondary: '',
  };
};

const formatLiveSchedule = (startTime?: string | null) => {
  if (!startTime) {
    return 'Upcoming';
  }

  const parsed = new Date(startTime);
  if (Number.isNaN(parsed.getTime())) {
    return 'Upcoming';
  }

  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(parsed);
};

const getLiveClassPriority = (liveClass: LiveClass) => {
  const status = String(liveClass.status || '').toLowerCase();
  if (liveClass.joinEnabled || status === 'live') {
    return 0;
  }

  if (status === 'scheduled') {
    return 1;
  }

  if (liveClass.replayReady) {
    return 2;
  }

  if (status === 'ended') {
    return 3;
  }

  return 4;
};

const findLinkedLiveClassForTest = (liveClasses: LiveClass[], testTitle: string, testId?: string | null) => {
  const normalizedTitle = normalizeMockTestTitle(testTitle);

  return [...(liveClasses || [])]
    .filter((liveClass) => {
      if (testId && liveClass.mockTestId && String(liveClass.mockTestId) === String(testId)) {
        return true;
      }

      const linkedMockTestId = extractLinkedMockTestId(liveClass.topicTags || []);
      if (testId && linkedMockTestId && String(linkedMockTestId) === String(testId)) {
        return true;
      }

      const linkedMockTestTitle = extractLinkedMockTestTitle(liveClass.topicTags || []);
      if (linkedMockTestTitle) {
        return normalizeMockTestTitle(linkedMockTestTitle) === normalizedTitle;
      }

      const normalizedLiveTitle = normalizeMockTestTitle(liveClass.title || '');
      if (!normalizedLiveTitle) {
        return false;
      }
      return normalizedLiveTitle.includes(normalizedTitle) || normalizedTitle.includes(normalizedLiveTitle);
    })
    .sort((left, right) => {
      const priorityDelta = getLiveClassPriority(left) - getLiveClassPriority(right);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }

      return new Date(right.startTime).getTime() - new Date(left.startTime).getTime();
    })[0] || null;
};

const buildExamMeta = (test: MockTest | null) => ({
  examTitle: test?.title || 'Mock Test',
  totalQuestions: String(test?.questions?.length || 0),
  duration: `${test?.durationMinutes || 0} Mins`,
  marks: String(test?.totalMarks || 0),
});

const buildSeriesCards = (tests: MockTest[]): SeriesCard[] =>
  tests.slice(0, 8).map((test, index) => ({
    id: test._id,
    title: test.title,
    testsLabel: `${test.questions?.length || 0} Questions`,
    progressText: '0%',
    statsLabel: test.category || test.type || 'Mock Test',
    chipTone: (['orange', 'blue', 'pink', 'purple'] as const)[index % 4],
  }));

const buildRecommendedTests = (tests: MockTest[]): RecommendedTestItem[] =>
  tests.slice(0, 3).map((test, index) => ({
    id: `recommended-${test._id}`,
    title: test.title,
    typeLabel: test.type || test.category || 'Mock Test',
    secondaryLabel: `${test.questions?.length || 0} Questions`,
    attemptedLabel: `${test.durationMinutes || 0} min`,
    iconTone: (['emerald', 'violet', 'orange'] as const)[index % 3],
    seriesId: test._id,
  }));

const quickActionItems: QuickActionItem[] = [
  { id: 'create-custom', label: 'Create Custom Test', iconTone: 'blue', onPress: 'detail' },
  { id: 'saved-tests', label: 'Saved Tests', iconTone: 'violet', onPress: 'home' },
  { id: 'test-history', label: 'Test History', iconTone: 'emerald', onPress: 'detail' },
  { id: 'performance', label: 'Performance', iconTone: 'orange', onPress: 'detail' },
];

const buildSeriesDetailMeta = (test: MockTest | null): SeriesDetailMeta => ({
  title: test?.title || 'Mock Test',
  breadcrumb: test?.title || 'Mock Test',
  totalTests: `${test?.questions?.length || 0} Questions`,
  freeTests: test?.type || 'TEST',
  users: test?.category || 'Mock Test',
  languages: 'Configured in test content',
  updatedOn: 'Live content',
  progressLabel: `${test?.questions?.length || 0} Questions`,
  progressPercent: '0%',
  paperLabel: test?.course || test?.category || 'Test',
});

const sideSeries: Array<{ title: string; stats: string; id: string }> = [];

const whyTakeItems = [
  {
    title: 'All India Rank',
    description: 'Compete with thousands of students across India',
  },
  {
    title: 'Personal recommendation',
    description: 'Recommendations for you based on your strong & weak areas',
  },
  {
    title: 'No.1 Quality',
    description: 'Curated tests designed to mirror the actual CBT experience',
  },
];

const buildEnrolledSeries = (tests: MockTest[]) =>
  tests.slice(0, 5).map((test, index) => ({
    title: test.title,
    subtitle: `${test.questions?.length || 0} Questions`,
    iconTone: (['blue', 'orange', 'ink'] as const)[index % 3],
    id: test._id,
  }));

const liveQuizCards: Array<{ title: string; meta: string; schedule: string; action: string; actionTone: 'blue' | 'green' }> = [];

const questionStateLegend = [
  { id: 'unvisited', description: 'You have not visited the question yet.' },
  { id: 'not-answered', description: 'You have not answered the question.' },
  { id: 'answered', description: 'You have answered the question.' },
  { id: 'review', description: 'You have NOT answered the question, but have marked the question for review.' },
  { id: 'answered-review', description: 'You have answered the question, but marked it for review.' },
] as const;

const buildExamQuestions = (questions: MockQuestion[] = []): ExamQuestion[] =>
  questions
    .filter((question) => question && question.questionText && Array.isArray(question.options) && question.options.length > 0)
    .map((question, index) => {
      const correctIndexes = Array.isArray(question.correctOptions) && question.correctOptions.length > 0
        ? [...new Set(question.correctOptions.map((optionIndex) => Number(optionIndex)).filter((optionIndex) => Number.isInteger(optionIndex) && optionIndex >= 0))].sort((left, right) => left - right)
        : Number.isFinite(Number(question.correctOption))
          ? [Number(question.correctOption)]
          : [0];

      return {
        id: question.id || `question-${index + 1}`,
        section: 'PART-A',
        prompt: question.questionText,
        options: question.options,
        marks: Number(question.marks || 1),
        correctIndex: correctIndexes[0] ?? 0,
        correctIndexes,
        explanation: question.explanation || 'Explanation will appear after the test author adds it.',
        topic: question.topic || 'General Practice',
      };
    });

const getAnswerIndexes = (value: number[] | null | undefined) => [...new Set((value || []).filter((optionIndex) => Number.isInteger(optionIndex) && optionIndex >= 0))].sort((left, right) => left - right);

const areAnswerIndexesEqual = (left: number[], right: number[]) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const formatClock = (seconds: number) => {
  const safe = Math.max(seconds, 0);
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return `${String(minutes).padStart(2, '0')} : ${String(remainder).padStart(2, '0')}`;
};

const formatOptionLabels = (optionIndexes: number[]) => optionIndexes.map((optionIndex) => String.fromCharCode(65 + optionIndex)).join(', ');

const formatMetricValue = (value: number) => {
  if (Number.isInteger(value)) {
    return String(value);
  }

  return value.toFixed(2).replace(/\.?0+$/, '');
};

const getAttemptedAnswerCount = (answers: Record<number, number[]>) =>
  Object.values(answers).filter((selectedIndexes) => getAnswerIndexes(selectedIndexes).length > 0).length;

const getCommittedState = (
  index: number,
  visitedQuestions: Record<number, boolean>,
  answers: Record<number, number[]>,
  review: Record<number, boolean>,
): QuestionState => {
  const hasAnswer = getAnswerIndexes(answers[index]).length > 0;
  const markedForReview = Boolean(review[index]);
  const hasVisited = Boolean(visitedQuestions[index]);

  if (markedForReview && hasAnswer) {
    return 'answered-review';
  }
  if (markedForReview) {
    return 'review';
  }
  if (hasAnswer) {
    return 'answered';
  }
  if (hasVisited) {
    return 'unanswered';
  }
  return 'unvisited';
};

const getDisplayedState = (
  index: number,
  visitedQuestions: Record<number, boolean>,
  answers: Record<number, number[]>,
  review: Record<number, boolean>,
  currentIndex: number,
  draftAnswer: number[],
  draftReview: boolean,
): QuestionState => {
  const committedState = getCommittedState(index, visitedQuestions, answers, review);

  if (index !== currentIndex) {
    return committedState;
  }

  const committedAnswer = getAnswerIndexes(answers[index]);
  const committedReview = Boolean(review[index]);
  const isDirty = !areAnswerIndexesEqual(committedAnswer, draftAnswer) || committedReview !== draftReview;

  if (!isDirty) {
    return committedState;
  }

  if (draftReview) {
    if (draftAnswer.length > 0) {
      return 'answered-review';
    }
    return 'review';
  }

  if (draftAnswer.length > 0) {
    return 'answered';
  }

  return Boolean(visitedQuestions[index]) ? 'unanswered' : 'unvisited';
};

const LogoMark = ({ large = false, dark = false }: { large?: boolean; dark?: boolean }) => (
  <BrandLogo size={large ? 'md' : 'sm'} tone={dark ? 'dark' : 'light'} />
);

const UserAvatar = ({ large = false }: { large?: boolean }) => (
  <div
    className={cn(
      'flex items-center justify-center rounded-full bg-[linear-gradient(180deg,#33bedf_0%,#28a9d9_100%)] text-white',
      large ? 'h-[136px] w-[136px]' : 'h-[42px] w-[42px]',
    )}
  >
    <svg viewBox="0 0 120 120" className={cn(large ? 'h-[78px] w-[78px]' : 'h-[24px] w-[24px]', 'fill-current')} aria-hidden="true">
      <path d="M60 18c10.1 0 18.3 8.2 18.3 18.3S70.1 54.6 60 54.6s-18.3-8.2-18.3-18.3S49.9 18 60 18Zm0 44.4c17.7 0 32.1 10.4 32.1 23.1V98H27.9V85.5C27.9 72.8 42.3 62.4 60 62.4Z" />
    </svg>
  </div>
);

const MobileStatusBar = () => null;

const ChipBadge = ({ tone, children }: { tone: SeriesCard['chipTone']; children: React.ReactNode }) => {
  const classes = {
    purple: 'bg-[#f4eaff] text-[#8a56df]',
    orange: 'bg-[#fff1dd] text-[#f09b34]',
    pink: 'bg-[#ffeaf1] text-[#ef5d90]',
    blue: 'bg-[#e7f3ff] text-[#3f86ed]',
  };

  return <span className={`rounded-full px-[8px] py-[2px] text-[9px] font-semibold ${classes[tone]}`}>{children}</span>;
};

const companionActionToneClasses: Record<DetailTestCard['companionTone'], string> = {
  blue: 'border-[#cfe0ff] bg-[#f4f8ff] text-[#2f78eb]',
  emerald: 'border-[#cfeedd] bg-[#effcf4] text-[#1f9c5a]',
  amber: 'border-[#ffe1be] bg-[#fff5e8] text-[#d88928]',
};

const recommendedIconToneClasses: Record<RecommendedTestItem['iconTone'], string> = {
  emerald: 'bg-[#eefbf2] text-[#24b464]',
  violet: 'bg-[#f5edff] text-[#8d55e3]',
  orange: 'bg-[#fff2e7] text-[#ff8a2b]',
};

const quickActionToneClasses: Record<QuickActionItem['iconTone'], string> = {
  blue: 'bg-[#edf4ff] text-[#2f78eb]',
  violet: 'bg-[#f5edff] text-[#8d55e3]',
  emerald: 'bg-[#eefbf2] text-[#24b464]',
  orange: 'bg-[#fff2e7] text-[#ff8a2b]',
};

const HeroIllustration = ({ compact = false }: { compact?: boolean }) => (
  <div className={cn('relative', compact ? 'h-[142px] w-[158px]' : 'h-[144px] w-[164px]')}>
    <div className={cn(
      'absolute rounded-full bg-[#dde9ff]',
      compact ? 'bottom-[10px] left-[22px] h-[14px] w-[118px]' : 'bottom-[4px] left-[46px] h-[14px] w-[86px]',
    )} />
    <div className={cn(
      'absolute rounded-[26px] border border-[#77a7ff] bg-[linear-gradient(180deg,#79a9ff_0%,#3473f4_100%)] shadow-[0_18px_32px_rgba(61,128,246,0.24)]',
      compact ? 'right-[20px] top-[16px] h-[92px] w-[78px]' : 'right-[6px] top-[6px] h-[78%] w-[70%]',
    )} />
    <div className={cn(
      'absolute rounded-[20px] border border-white/70 bg-white shadow-[0_10px_20px_rgba(50,91,166,0.12)]',
      compact ? 'right-[34px] top-[30px] h-[72px] w-[56px]' : 'right-[20px] top-[22px] h-[58%] w-[45%]',
    )} />
    <div className={cn(
      'absolute rounded-[10px] bg-[#5f90f5]',
      compact ? 'right-[54px] top-[20px] h-[12px] w-[18px]' : 'right-[38px] top-[12px] h-[10px] w-[18px]',
    )} />
    <div className={cn(
      'absolute rounded-full bg-[#d7e6ff]',
      compact ? 'right-[12px] top-[50px] h-[12px] w-[12px]' : 'right-[0px] top-[24px] h-[34px] w-[34px]',
    )}>
      {!compact && <FileText className="m-[9px] h-[16px] w-[16px] text-[#77a2ff]" />}
    </div>
    {compact ? (
      <>
        <div className="absolute right-[46px] top-[44px] space-y-[8px]">
          <div className="flex items-center gap-[6px]">
            <div className="h-[12px] w-[12px] rounded-[4px] border-2 border-[#69a3ff] bg-white" />
            <div className="h-[4px] w-[24px] rounded-full bg-[#bfd3ff]" />
          </div>
          <div className="flex items-center gap-[6px]">
            <div className="h-[12px] w-[12px] rounded-[4px] border-2 border-[#69a3ff] bg-white" />
            <div className="h-[4px] w-[24px] rounded-full bg-[#bfd3ff]" />
          </div>
          <div className="flex items-center gap-[6px]">
            <div className="h-[12px] w-[12px] rounded-[4px] border-2 border-[#69a3ff] bg-white" />
            <div className="h-[4px] w-[24px] rounded-full bg-[#bfd3ff]" />
          </div>
        </div>
        <div className="absolute left-[20px] bottom-[28px] h-[42px] w-[42px] rounded-full border-[4px] border-[#3b7cf6] bg-white shadow-[0_10px_18px_rgba(61,128,246,0.18)]" />
        <div className="absolute left-[34px] bottom-[41px] h-[16px] w-[2px] rounded-full bg-[#3b7cf6]" />
        <div className="absolute left-[34px] bottom-[41px] h-[2px] w-[12px] rounded-full bg-[#3b7cf6]" />
        <div className="absolute left-[25px] bottom-[68px] h-[8px] w-[8px] rounded-full bg-[#3b7cf6]" />
        <div className="absolute left-[47px] bottom-[68px] h-[8px] w-[8px] rounded-full bg-[#3b7cf6]" />
        <div className="absolute right-[6px] bottom-[26px] h-[60px] w-[12px] rotate-[38deg] rounded-full bg-[linear-gradient(180deg,#5598ff_0%,#2f72f4_70%,#f4a43b_70%,#f0b964_100%)] shadow-[0_10px_18px_rgba(61,128,246,0.18)]" />
        <div className="absolute right-[10px] bottom-[18px] h-[28px] w-[18px] rounded-[10px] bg-[#d7f0e8] opacity-80" />
      </>
    ) : (
      <>
        <div className="absolute right-[34px] top-[36px] space-y-[8px]">
          <div className="h-[6px] w-[32px] rounded-full bg-[#8fb5ff]" />
          <div className="h-[6px] w-[28px] rounded-full bg-[#c4d7ff]" />
          <div className="h-[6px] w-[30px] rounded-full bg-[#8fb5ff]" />
        </div>
        <div className="absolute left-[12px] bottom-[18px] flex h-[42px] w-[42px] items-center justify-center rounded-full border border-[#bdd1ff] bg-white/90 shadow-[0_8px_16px_rgba(61,128,246,0.16)]">
          <Clock3 className="h-[18px] w-[18px] text-[#3a79f7]" />
        </div>
      </>
    )}
  </div>
);

const renderLegendBadge = (state: typeof questionStateLegend[number]['id']) => (
  <div className="relative flex h-6 w-6 items-center justify-center">
    {state === 'unvisited' && <div className="h-[20px] w-[20px] border border-[#5d6674] bg-white" />}
    {state === 'not-answered' && (
      <div className="h-[20px] w-[20px] bg-[#c54c31]" style={{ clipPath: 'polygon(0 0,100% 0,100% 64%,50% 100%,0 64%)' }} />
    )}
    {state === 'answered' && (
      <div className="h-[20px] w-[20px] bg-[#2daa59]" style={{ clipPath: 'polygon(0 40%,50% 0,100% 40%,100% 100%,0 100%)' }} />
    )}
    {state === 'review' && <div className="h-[20px] w-[20px] rounded-full bg-[#8f4ee2]" />}
    {state === 'answered-review' && (
      <>
        <div className="h-[20px] w-[20px] rounded-full bg-[#8f4ee2]" />
        <div className="absolute -right-[1px] -top-[1px] flex h-3 w-3 items-center justify-center rounded-full bg-white">
          <Check className="h-3 w-3 text-[#2daa59]" />
        </div>
      </>
    )}
  </div>
);

const renderDesktopPaletteBadge = (state: QuestionState, label: number, active = false) => (
  <div className="relative inline-flex flex-col items-center">
    <div
      className={cn(
        'relative flex h-[28px] w-[38px] items-center justify-center rounded-[7px] border px-1 text-[11px] font-semibold leading-none transition',
        active && (state === 'answered' || state === 'review' || state === 'answered-review') && 'border-[#fff36d] bg-[#fff36d] text-[#111111]',
        (active || !active) && (state === 'unvisited' || state === 'unanswered') && 'border-[#2237dd] bg-[#2237dd] text-white',
        !active && state === 'answered' && 'border-[#2dad5c] bg-[#2dad5c] text-white',
        !active && state === 'review' && 'border-[#8f4ee2] bg-[#8f4ee2] text-white',
        !active && state === 'answered-review' && 'border-[#8f4ee2] bg-[#8f4ee2] text-white',
      )}
    >
      {label}
      {!active && state === 'answered-review' && (
        <div className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-white">
          <Check className="h-3 w-3 text-[#2dad5c]" />
        </div>
      )}
    </div>
    {active && (state === 'answered' || state === 'review' || state === 'answered-review') && (
      <div className="absolute top-[29px] h-0 w-0 border-x-[5px] border-x-transparent border-t-[9px] border-t-black" />
    )}
  </div>
);

const paletteButtonClass = (state: QuestionState, active = false) => cn(
  'flex h-[34px] w-[34px] items-center justify-center rounded-[10px] border text-[12px] font-semibold transition',
  active && (state === 'answered' || state === 'review' || state === 'answered-review') && 'border-[#fff36d] bg-[#fff36d] text-[#111111]',
  (active || !active) && (state === 'unvisited' || state === 'unanswered') && 'border-[#2237dd] bg-[#2237dd] text-white',
  !active && state === 'answered' && 'border-[#2dad5c] bg-[#2dad5c] text-white',
  !active && state === 'review' && 'border-[#8f4ee2] bg-[#8f4ee2] text-white',
  !active && state === 'answered-review' && 'border-[#8f4ee2] bg-[#8f4ee2] text-white',
);

const renderMobileInstructionBody = () => (
  <div className="space-y-[18px] text-[13px] leading-[1.9] text-[#1f2737]">
    <div>
      <p className="text-[15px] font-semibold text-[#1f2737]">General Instructions:</p>
      <ol className="mt-[10px] list-decimal space-y-[10px] pl-[20px]">
        <li>
          The clock will be set at the server. The countdown timer at the top right corner of screen will display the remaining time available for you to
          complete the examination.
        </li>
        <li>
          The Question Palette displayed on the right side of screen will show the status of each question using one of the following symbols:
        </li>
      </ol>
    </div>

    <div className="space-y-[10px]">
      {questionStateLegend.map((item) => (
        <div key={item.id} className="flex items-center gap-[10px]">
          {renderLegendBadge(item.id)}
          <p className="text-[12px] leading-[1.5] text-[#344055]">{item.description}</p>
        </div>
      ))}
    </div>

    <p className="text-[13px] leading-[1.85] text-[#344055]">
      To answer a question, click on the question number in the right side palette or use the action buttons below the question card.
    </p>
  </div>
);

const renderInstructionBody = () => (
  <div className="space-y-5 text-[13px] leading-[1.65] text-slate-800">
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
        <div key={item.id} className="flex items-center gap-3">
          {renderLegendBadge(item.id)}
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

const DesktopTopBar = () => (
  <div className="border-b border-[#dde5f0] bg-white">
    <div className="mx-auto flex h-[82px] max-w-[1600px] items-center gap-6 px-[34px]">
      <div className="relative flex-1">
        <div className="flex h-[48px] items-center rounded-[10px] border border-[#e1e7ef] bg-[#fbfbfb] px-[18px] text-[17px] text-[#7a7f86]">
          <span className="flex-1">Search</span>
          <Search className="h-7 w-7 text-[#86abc4]" />
        </div>
      </div>
      <div className="flex items-center gap-[18px] text-[#8aa0b3]">
        <div className="flex items-center gap-2">
          <Languages className="h-6 w-6 text-[#8aa0b3]" />
          <ChevronDown className="h-5 w-5" />
        </div>
        <button className="flex h-[48px] min-w-[174px] items-center justify-center rounded-[8px] border border-[#d6e0ea] bg-white px-6 text-[16px] text-[#87a5bf]">
          Pass Active
        </button>
        <Bell className="h-7 w-7 text-[#8aa0b3]" />
        <div className="flex items-center gap-3">
          <UserAvatar />
          <ChevronDown className="h-5 w-5" />
        </div>
      </div>
    </div>
  </div>
);

const DesktopInstructionFrame = ({
  testId,
  examTitle,
  userName,
  body,
  footer,
}: {
  testId: string;
  examTitle: string;
  userName: string;
  body: React.ReactNode;
  footer: React.ReactNode;
}) => (
  <div data-testid={testId} className="hidden h-full min-h-0 flex-1 flex-col bg-white lg:flex" style={{ fontFamily: cbtFontStack }}>
    <div className="flex items-center gap-5 border-b border-[#d9d9d9] bg-white px-5 py-4">
      <div className="flex items-center gap-3">
        <LogoMark large />
      </div>
      <p className="text-[13px] font-medium text-[#3a3a3a]">{examTitle}</p>
    </div>

    <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_351px]">
      <section className="cbt-scroll overflow-y-scroll px-5 py-6">{body}</section>
      <aside className="border-l border-[#e5e7eb] bg-[#f8f9fb] px-6 py-8">
        <div className="flex h-full flex-col items-center text-center">
          <UserAvatar large />
          <p className="mt-9 max-w-[190px] text-[24px] font-normal leading-tight text-[#343434]">{userName}</p>
        </div>
      </aside>
    </div>

    <div className="grid border-t border-[#d9d9d9] bg-white lg:grid-cols-[minmax(0,1fr)_351px]">
      {footer}
      <div className="border-l border-[#e5e7eb] bg-[#f8f9fb]" />
    </div>
  </div>
);

export const TestSeriesFigmaTab = ({
  overview,
  onRefresh,
  onImmersiveModeChange,
  onOpenLiveClass,
}: TestSeriesFigmaTabProps) => {
  void onRefresh;

  const [screen, setScreen] = useState<Screen>('home');
  const [selectedSeriesId, setSelectedSeriesId] = useState('');
  const [savedSeriesIds, setSavedSeriesIds] = useState<string[]>([]);
  const [visitedQuestions, setVisitedQuestions] = useState<Record<number, boolean>>({});
  const [answers, setAnswers] = useState<Record<number, number[]>>({});
  const [review, setReview] = useState<Record<number, boolean>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(0);
  const [defaultLanguage, setDefaultLanguage] = useState('English');
  const [selectedLanguage, setSelectedLanguage] = useState('English');
  const [confirmationAccepted, setConfirmationAccepted] = useState(false);
  const [mobilePaletteOpen, setMobilePaletteOpen] = useState(false);
  const [desktopExamPanel, setDesktopExamPanel] = useState<null | 'symbols' | 'instructions' | 'summary' | 'calculator'>(null);
  const [questionZoom, setQuestionZoom] = useState(0);
  const [draftAnswer, setDraftAnswer] = useState<number[]>([]);
  const [draftReview, setDraftReview] = useState(false);
  const [attemptSessions, setAttemptSessions] = useState<Record<string, AttemptSession>>({});
  const hydratedTestIdRef = useRef<string | null>(null);

  const fullMockTests = useMemo(
    () => (overview.testSeries || []).filter((test) => {
      const type = String(test.type || '').toLowerCase();
      return !type || type.includes('full') || type.includes('mock');
    }),
    [overview.testSeries],
  );
  const recentSeries = useMemo(() => buildSeriesCards(fullMockTests), [fullMockTests]);
  const recommendedTests = useMemo(() => buildRecommendedTests(fullMockTests), [fullMockTests]);
  const enrolledSeries = useMemo(() => buildEnrolledSeries(fullMockTests), [fullMockTests]);
  const selectedTest = useMemo(
    () => fullMockTests.find((test) => test._id === selectedSeriesId) || fullMockTests[0] || null,
    [fullMockTests, selectedSeriesId],
  );
  const examMeta = useMemo(() => buildExamMeta(selectedTest), [selectedTest]);
  const learnerName = overview.user?.name || 'Learner';
  const learnerDisplayName = learnerName.includes('@') ? learnerName.split('@')[0] : learnerName;
  const questions = useMemo(() => buildExamQuestions(selectedTest?.questions || []), [selectedTest]);
  const currentQuestion = questions[currentIndex] || {
    id: 'empty-question',
    section: 'PART-A' as const,
    prompt: 'No question is available for this test yet.',
    options: [],
    marks: 1,
    correctIndex: 0,
    correctIndexes: [0],
    explanation: 'Add questions from the admin workspace to enable this test.',
    topic: 'General Practice',
  };
  const selectedSeriesMeta = useMemo(() => buildSeriesDetailMeta(selectedTest), [selectedTest]);
  const detailTestCards = useMemo<ResolvedDetailTestCard[]>(
    () => {
      const sourceTests = fullMockTests.length > 0
        ? fullMockTests.slice(0, 12).map((test, index): DetailTestCard => ({
          id: test._id || `mock-${index}`,
          mockTestId: test._id,
          title: test.title,
          usersLabel: test.category || 'Mock Test',
          button: index === 0 ? 'Resume Now' : 'Start Now',
          companionAction: 'Watch Video',
          companionMeta: 'Create or join an explanation class',
          companionTone: 'amber',
        }))
        : [];

      return sourceTests.map((card) => {
      const linkedLiveClass = findLinkedLiveClassForTest(overview.liveClasses || [], card.title, card.mockTestId);
      const defaultMeta = splitCompanionMeta(card.companionMeta);

      if (!linkedLiveClass) {
        return {
          ...card,
          liveClassId: null,
          companionButtonLabel: card.companionTone === 'blue' ? 'Watch Now' : card.companionTone === 'emerald' ? 'Join' : 'Watch Video',
          companionPrimaryMeta: defaultMeta.primary,
          companionSecondaryMeta: defaultMeta.secondary,
        };
      }

      const status = String(linkedLiveClass.status || '').toLowerCase();
      if (linkedLiveClass.joinEnabled || status === 'live' || status === 'scheduled') {
        return {
          ...card,
          liveClassId: linkedLiveClass._id,
          companionAction: 'Join Live Class',
          companionTone: 'emerald',
          companionMeta: `${formatLiveSchedule(linkedLiveClass.startTime)} explanation session`,
          companionButtonLabel: 'Join',
          companionPrimaryMeta: formatLiveSchedule(linkedLiveClass.startTime),
          companionSecondaryMeta: 'Explanation session',
        };
      }

      if (linkedLiveClass.replayReady) {
        return {
          ...card,
          liveClassId: linkedLiveClass._id,
          companionAction: 'Watch Explanation',
          companionTone: 'blue',
          companionMeta: 'Live class completed, replay ready',
          companionButtonLabel: 'Watch Now',
          companionPrimaryMeta: 'Live class completed, replay ready',
          companionSecondaryMeta: '',
        };
      }

      return {
        ...card,
        liveClassId: linkedLiveClass._id,
        companionButtonLabel: card.companionTone === 'blue' ? 'Watch Now' : card.companionTone === 'emerald' ? 'Join' : 'Watch Video',
        companionPrimaryMeta: defaultMeta.primary,
        companionSecondaryMeta: defaultMeta.secondary,
      };
    });
    },
    [fullMockTests, overview.liveClasses],
  );
  const featuredDetailCard = detailTestCards[0] || null;

  const committedStates = useMemo(
    () => questions.map((_, index) => getCommittedState(index, visitedQuestions, answers, review)),
    [answers, questions, review, visitedQuestions],
  );

  const displayStates = useMemo(
    () => questions.map((_, index) => getDisplayedState(index, visitedQuestions, answers, review, currentIndex, draftAnswer, draftReview)),
    [answers, currentIndex, draftAnswer, draftReview, questions, review, visitedQuestions],
  );

  const answeredCount = useMemo(
    () => committedStates.filter((state) => state === 'answered' || state === 'answered-review').length,
    [committedStates],
  );

  const markReviewCount = useMemo(
    () => committedStates.filter((state) => state === 'review' || state === 'answered-review').length,
    [committedStates],
  );

  const notAnsweredCount = committedStates.filter((state) => state === 'unvisited' || state === 'unanswered').length;
  const questionTextClass = ['text-[14px] leading-[1.58]', 'text-[16px] leading-[1.68]', 'text-[18px] leading-[1.78]'][questionZoom];
  const isCurrentQuestionMarkedForReview = draftReview;
  const currentTestId = selectedTest?._id || '';
  const persistedAttemptStatus = currentTestId ? attemptSessions[currentTestId]?.status : undefined;
  const currentAttemptedAnswerCount = getAttemptedAnswerCount(answers);
  const currentAttemptStatus: AttemptStatus = screen === 'result' || screen === 'solutions'
    ? 'completed'
    : persistedAttemptStatus === 'completed'
      ? 'completed'
    : currentAttemptedAnswerCount > 0 || Object.keys(visitedQuestions).length > 0 || screen === 'exam'
      ? 'in-progress'
      : 'not-started';
  const attemptResults = useMemo<AttemptQuestionResult[]>(
    () => questions.map((question, index) => {
      const selectedIndexes = getAnswerIndexes(answers[index]);
      let status: AttemptQuestionResult['status'] = 'unattempted';

      if (selectedIndexes.length > 0) {
        status = areAnswerIndexesEqual(selectedIndexes, question.correctIndexes) ? 'correct' : 'incorrect';
      }

      return {
        questionId: question.id,
        questionNumber: index + 1,
        prompt: question.prompt,
        options: question.options,
        selectedIndexes,
        correctIndexes: question.correctIndexes,
        explanation: question.explanation,
        marks: question.marks,
        topic: question.topic,
        status,
      };
    }),
    [answers, questions],
  );
  const correctCount = useMemo(
    () => attemptResults.filter((result) => result.status === 'correct').length,
    [attemptResults],
  );
  const incorrectCount = useMemo(
    () => attemptResults.filter((result) => result.status === 'incorrect').length,
    [attemptResults],
  );
  const unattemptedCount = useMemo(
    () => attemptResults.filter((result) => result.status === 'unattempted').length,
    [attemptResults],
  );
  const attemptedCount = correctCount + incorrectCount;
  const resultScore = useMemo(
    () => attemptResults.reduce((sum, result) => {
      if (result.status === 'correct') {
        return sum + Number(result.marks || 1);
      }
      if (result.status === 'incorrect') {
        return sum - Number(selectedTest?.negativeMarking || 0);
      }
      return sum;
    }, 0),
    [attemptResults, selectedTest?.negativeMarking],
  );
  const resultAccuracy = useMemo(
    () => (attemptedCount > 0 ? Math.round((correctCount / attemptedCount) * 100) : 0),
    [attemptedCount, correctCount],
  );
  const resultTotalMarks = Number(selectedTest?.totalMarks || questions.reduce((sum, question) => sum + Number(question.marks || 1), 0));
  const resultRank = overview.dashboard.latestMockTest && selectedTest?._id && overview.dashboard.latestMockTest.testId === selectedTest._id
    ? overview.dashboard.latestMockTest.rank
    : null;
  const solutionFilterSummary = [
    { id: 'all', label: `All (${attemptResults.length})`, tone: 'active' as const },
    { id: 'correct', label: `Correct (${correctCount})`, tone: 'success' as const },
    { id: 'incorrect', label: `Incorrect (${incorrectCount})`, tone: 'danger' as const },
    { id: 'unattempted', label: `Unattempted (${unattemptedCount})`, tone: 'neutral' as const },
  ];
  const getSessionForTest = (testId?: string | null) => (testId ? attemptSessions[testId] || null : null);
  const getAttemptStatusForTest = (testId?: string | null): AttemptStatus => getSessionForTest(testId)?.status || 'not-started';
  const getAttemptProgressForTest = (testId?: string | null, totalQuestions = 0) => {
    const session = getSessionForTest(testId);
    if (!session || totalQuestions <= 0) {
      return 0;
    }

    return Math.min(100, Math.round((getAttemptedAnswerCount(session.answers) / totalQuestions) * 100));
  };
  const getAttemptActionLabel = (status: AttemptStatus) => {
    if (status === 'completed') {
      return 'Completed';
    }
    if (status === 'in-progress') {
      return 'Resume';
    }
    return 'Start Now';
  };

  useEffect(() => {
    if (!selectedSeriesId && fullMockTests[0]?._id) {
      setSelectedSeriesId(fullMockTests[0]._id);
    }
  }, [fullMockTests, selectedSeriesId]);

  useEffect(() => {
    const nextTestId = selectedTest?._id;
    if (!nextTestId) {
      hydratedTestIdRef.current = null;
      return;
    }

    if (hydratedTestIdRef.current === nextTestId) {
      return;
    }

    hydratedTestIdRef.current = nextTestId;

    const session = attemptSessions[nextTestId];
    if (session) {
      setVisitedQuestions(session.visitedQuestions);
      setAnswers(session.answers);
      setReview(session.review);
      setCurrentIndex(session.currentIndex);
      setTimeLeft(session.timeLeft);
      setDefaultLanguage(session.defaultLanguage);
      setSelectedLanguage(session.selectedLanguage);
      setConfirmationAccepted(session.confirmationAccepted);
      setMobilePaletteOpen(false);
      setDesktopExamPanel(null);
      setQuestionZoom(0);
      setDraftAnswer([]);
      setDraftReview(false);
      return;
    }

    setVisitedQuestions({});
    setAnswers({});
    setReview({});
    setCurrentIndex(0);
    setTimeLeft(Math.max(Number(selectedTest?.durationMinutes || 0), 0) * 60);
    setDefaultLanguage('English');
    setSelectedLanguage('English');
    setConfirmationAccepted(false);
    setMobilePaletteOpen(false);
    setDesktopExamPanel(null);
    setQuestionZoom(0);
    setDraftAnswer([]);
    setDraftReview(false);
  }, [attemptSessions, selectedTest?._id, selectedTest?.durationMinutes]);

  useEffect(() => {
    setDraftAnswer(answers[currentIndex] ?? []);
    setDraftReview(Boolean(review[currentIndex]));
  }, [answers, currentIndex, review]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }
  }, [screen, currentIndex, mobilePaletteOpen]);

  useEffect(() => {
    const immersiveScreens = ['instructions', 'confirmation', 'exam', 'result', 'solutions'].includes(screen);
    onImmersiveModeChange?.(immersiveScreens);
    return () => onImmersiveModeChange?.(false);
  }, [onImmersiveModeChange, screen]);

  useEffect(() => {
    if (screen !== 'exam') {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setTimeLeft((current) => (current > 0 ? current - 1 : 0));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [screen]);

  useEffect(() => {
    if (!currentTestId) {
      return;
    }

    setAttemptSessions((current) => ({
      ...current,
      [currentTestId]: {
        status: currentAttemptStatus,
        visitedQuestions,
        answers,
        review,
        currentIndex,
        timeLeft,
        defaultLanguage,
        selectedLanguage,
        confirmationAccepted,
      },
    }));
  }, [
    answers,
    confirmationAccepted,
    currentAttemptStatus,
    currentIndex,
    currentTestId,
    defaultLanguage,
    review,
    selectedLanguage,
    timeLeft,
    visitedQuestions,
  ]);

  const resetAttemptState = () => {
    setVisitedQuestions({});
    setAnswers({});
    setReview({});
    setCurrentIndex(0);
    setTimeLeft(Math.max(Number(selectedTest?.durationMinutes || 0), 0) * 60);
    setDefaultLanguage('English');
    setSelectedLanguage('English');
    setConfirmationAccepted(false);
    setMobilePaletteOpen(false);
    setDesktopExamPanel(null);
    setQuestionZoom(0);
    setDraftAnswer([]);
    setDraftReview(false);
  };

  const clearAttemptSession = (testId?: string | null) => {
    if (!testId) {
      return;
    }

    if (hydratedTestIdRef.current === testId) {
      hydratedTestIdRef.current = null;
    }

    setAttemptSessions((current) => {
      const next = { ...current };
      delete next[testId];
      return next;
    });
  };

  const openSeries = (seriesId: string) => {
    if (!seriesId) {
      return;
    }
    if (selectedSeriesId !== seriesId) {
      hydratedTestIdRef.current = null;
    }
    setSelectedSeriesId(seriesId);
    setScreen('detail');
  };

  const openAttemptFlow = (testId?: string | null) => {
    if (!testId) {
      return;
    }

    if (selectedSeriesId !== testId) {
      hydratedTestIdRef.current = null;
    }
    setSelectedSeriesId(testId);
    const status = getAttemptStatusForTest(testId);
    if (status === 'completed') {
      setScreen('result');
      return;
    }
    if (status === 'in-progress') {
      setScreen('exam');
      return;
    }
    setScreen('instructions');
  };

  const restartCurrentAttempt = () => {
    clearAttemptSession(currentTestId);
    resetAttemptState();
    setScreen('instructions');
  };

  const toggleSavedSeries = (seriesId: string) => {
    setSavedSeriesIds((current) => (
      current.includes(seriesId)
        ? current.filter((id) => id !== seriesId)
        : [...current, seriesId]
    ));
  };

  const openLinkedLiveClass = (liveClassId: string | null) => {
    if (!liveClassId) {
      return;
    }

    onOpenLiveClass?.(liveClassId);
  };

  const goToQuestion = (index: number) => {
    const safeIndex = Math.max(0, Math.min(index, questions.length - 1));
    setVisitedQuestions((current) => ({ ...current, [safeIndex]: true }));
    setCurrentIndex(safeIndex);
    setDesktopExamPanel(null);
    setMobilePaletteOpen(false);
  };

  const selectOption = (index: number) => {
    setVisitedQuestions((current) => ({ ...current, [currentIndex]: true }));
    setDraftAnswer((current) => {
      const allowMultipleAnswers = currentQuestion.correctIndexes.length > 1;
      const currentIndexes = getAnswerIndexes(current);
      if (!allowMultipleAnswers) {
        return currentIndexes.length === 1 && currentIndexes[0] === index ? [] : [index];
      }

      return currentIndexes.includes(index)
        ? currentIndexes.filter((value) => value !== index)
        : [...currentIndexes, index].sort((left, right) => left - right);
    });
  };

  const toggleReview = () => {
    setDraftReview((current) => !current);
  };

  const commitCurrentDraft = () => {
    setAnswers((current) => {
      const next = { ...current };
      if (draftAnswer.length === 0) {
        delete next[currentIndex];
      } else {
        next[currentIndex] = draftAnswer;
      }
      return next;
    });

    setReview((current) => {
      const next = { ...current };
      if (draftReview) {
        next[currentIndex] = true;
      } else {
        delete next[currentIndex];
      }
      return next;
    });
  };

  const saveAndNext = () => {
    commitCurrentDraft();
    setDesktopExamPanel(null);
    setCurrentIndex((current) => {
      const nextIndex = Math.min(current + 1, questions.length - 1);
      setVisitedQuestions((visited) => ({ ...visited, [nextIndex]: true }));
      return nextIndex;
    });
  };

  const beginExam = () => {
    setSelectedLanguage(defaultLanguage || 'English');
    setDesktopExamPanel(null);
    setMobilePaletteOpen(false);
    setVisitedQuestions({ 0: true });
    setCurrentIndex(0);
    setScreen('exam');
  };

  const submitExam = () => {
    commitCurrentDraft();
    setDesktopExamPanel(null);
    setMobilePaletteOpen(false);
    setScreen('result');
    void onRefresh();
  };

  const desktopHome = (
    <div data-testid="tests-home-desktop" className="hidden min-h-0 flex-1 flex-col bg-[#f6f7fb] lg:flex" style={{ fontFamily: uiFontStack }}>
      <DesktopTopBar />
      <div className="cbt-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1380px] px-[22px] py-[16px]">
          <div className="flex h-[30px] items-center rounded-[6px] border border-[#e3e9f1] bg-white px-[14px] text-[12px] text-[#9aa6ba] shadow-[0_4px_12px_rgba(15,23,42,0.03)]">
            Search for your Exam
          </div>

          <section className="mt-[16px]">
            <div className="flex items-center justify-between">
              <p className="text-[16px] font-semibold text-[#1f2737]">Your Recent Test Series</p>
              <button className="text-[11px] font-semibold text-[#4590ef]">View all Attempted Tests</button>
            </div>
            <div className="mt-[12px] grid grid-cols-4 gap-[14px]">
              {recentSeries.map((series, index) => (
                <button
                  key={series.id}
                  type="button"
                  data-testid={index === 0 ? 'tests-open-series-primary' : undefined}
                  onClick={() => openSeries(series.id)}
                  className="overflow-hidden rounded-[12px] border border-[#e8eef6] bg-white text-left shadow-[0_10px_20px_rgba(18,39,74,0.05)]"
                >
                  <div className="bg-[linear-gradient(180deg,#f7e9ff_0%,#f5ebff_100%)] px-[12px] py-[10px]">
                    <div className="flex items-center gap-[8px]">
                      <div className="flex h-[20px] w-[20px] items-center justify-center rounded-full bg-[#fff2e8] text-[10px] font-bold text-[#ff8b4a]">S</div>
                      <ChipBadge tone={series.chipTone}>{series.statsLabel}</ChipBadge>
                    </div>
                  </div>
                  <div className="px-[12px] pb-[12px] pt-[10px]">
                    <p className="min-h-[48px] text-[12px] font-semibold leading-[1.45] text-[#273248]">{series.title}</p>
                    {(() => {
                      const test = fullMockTests.find((entry) => entry._id === series.id);
                      const progress = getAttemptProgressForTest(series.id, test?.questions?.length || 0);
                      const actionLabel = getAttemptActionLabel(getAttemptStatusForTest(series.id));

                      return (
                        <>
                    <div className="mt-[10px] flex items-center justify-between text-[11px] text-[#98a2b3]">
                      <span>{series.testsLabel}</span>
                      <span>{progress}%</span>
                    </div>
                    <span className="mt-[12px] inline-flex h-[28px] items-center rounded-[5px] bg-[#23aaf0] px-[12px] text-[10px] font-semibold text-white">{actionLabel}</span>
                        </>
                      );
                    })()}
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="mt-[18px]">
            <p className="text-[16px] font-semibold text-[#1f2737]">Your Enrolled Test Series</p>
            <div className="mt-[12px] grid grid-cols-5 gap-[10px]">
              {enrolledSeries.map((item) => (
                <button key={item.title} type="button" className="flex items-center gap-[10px] rounded-[12px] border border-[#e8eef6] bg-white px-[12px] py-[12px] text-left shadow-[0_8px_18px_rgba(18,39,74,0.04)]">
                  <div
                    className={cn(
                      'flex h-[34px] w-[34px] items-center justify-center rounded-[10px]',
                      item.iconTone === 'blue' && 'bg-[#eef4ff] text-[#3070e6]',
                      item.iconTone === 'orange' && 'bg-[#fff3ea] text-[#f29f47]',
                      item.iconTone === 'ink' && 'bg-[#f6f7fb] text-[#1c2640]',
                    )}
                  >
                    {item.iconTone === 'ink' ? <UserCircle2 className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-semibold text-[#273248]">{item.title}</p>
                    <p className="mt-[4px] text-[10px] text-[#98a2b3]">{item.subtitle}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-[#a0acbc]" />
                </button>
              ))}
            </div>
          </section>

          <section className="mt-[18px]">
            <div className="flex items-center justify-between">
              <p className="text-[16px] font-semibold text-[#1f2737]">
                Live Tests &amp; <span className="text-[#35bb6f]">Free</span> Quizzes
              </p>
              <button className="text-[11px] font-semibold text-[#4590ef]">View All</button>
            </div>
            <div className="mt-[12px] grid grid-cols-3 gap-[14px]">
              {liveQuizCards.map((card) => (
                <div key={card.title} className="rounded-[12px] border border-[#e8eef6] bg-white p-[12px] text-left shadow-[0_8px_20px_rgba(18,39,74,0.04)]">
                  <div className="flex items-center gap-[6px] text-[9px] font-bold">
                    <span className="rounded-[3px] bg-[#ff4d57] px-[6px] py-[2px] text-white">LIVE TEST</span>
                    <span className="rounded-[3px] bg-[#2ebf6c] px-[6px] py-[2px] text-white">{card.actionTone === 'green' ? 'Register' : 'FREE'}</span>
                  </div>
                  <p className="mt-[10px] min-h-[36px] text-[12px] font-semibold text-[#273248]">{card.title}</p>
                  <p className="mt-[10px] text-[10px] text-[#98a2b3]">{card.meta}</p>
                  <div className="mt-[12px] flex items-center justify-between">
                    <p className="text-[10px] text-[#98a2b3]">{card.schedule}</p>
                    <span className={cn('inline-flex h-[24px] items-center rounded-[4px] px-[10px] text-[10px] font-semibold text-white', card.actionTone === 'green' ? 'bg-[#35bb6f]' : 'bg-[#23aaf0]')}>{card.action}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );

  const desktopDetail = (
    <div data-testid="tests-detail-desktop" className="hidden min-h-0 flex-1 flex-col bg-[#f6f7fb] lg:flex" style={{ fontFamily: uiFontStack }}>
      <div className="cbt-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1380px] px-[22px] py-[14px]">
          <div className="rounded-[12px] border border-[#e4eaf2] bg-white shadow-[0_8px_24px_rgba(18,39,74,0.05)]">
            <div className="border-b border-[#edf2f7] px-[18px] py-[12px] text-[12px] text-[#98a2b3]">
              Home &gt; Tests &gt; <span className="font-semibold text-[#5a90ec]">{selectedSeriesMeta.breadcrumb}</span>
            </div>
            <div className="px-[18px] py-[16px]">
              <div className="flex items-start justify-between gap-8">
                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-[10px]">
                    <div className="mt-[4px] flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[#fff4e8] text-[11px]">🏅</div>
                    <div className="min-w-0 flex-1">
                      <h1 className="max-w-[760px] text-[20px] font-semibold leading-[1.45] text-[#273248]">{selectedSeriesMeta.title}</h1>
                      <div className="mt-[8px] flex items-center gap-[8px] text-[11px] text-[#98a2b3]">
                        <Clock3 className="h-3.5 w-3.5" />
                        <span>Last updated on {selectedSeriesMeta.updatedOn}</span>
                      </div>
                      <div className="mt-[12px] flex flex-wrap items-center gap-[18px] text-[12px] text-[#6d7c93]">
                        <span>{selectedSeriesMeta.totalTests}</span>
                        <span className="rounded-[4px] bg-[#2ecf67] px-[8px] py-[2px] text-[10px] font-semibold text-white">{selectedSeriesMeta.freeTests}</span>
                        <span>{selectedSeriesMeta.users}</span>
                        <span>{selectedSeriesMeta.languages}</span>
                      </div>
                      <div className="mt-[10px] max-w-[280px]">
                        <div className="h-[5px] rounded-full bg-[#e8eef6]">
                          <div className="h-full w-[1%] rounded-full bg-[#2ecf67]" />
                        </div>
                        <div className="mt-[6px] flex items-center justify-between text-[11px]">
                          <span className="text-[#6d7c93]">{selectedSeriesMeta.progressLabel}</span>
                          <span className="font-semibold text-[#2ecf67]">{selectedSeriesMeta.progressPercent}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <button className="flex h-[32px] min-w-[116px] items-center justify-center gap-[8px] rounded-[8px] border border-[#d9e2ec] bg-white px-[12px] text-[12px] font-semibold text-[#60718a]">
                  {selectedSeriesMeta.paperLabel}
                  <ChevronDown className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          <div className="mt-[14px] grid gap-[14px] xl:grid-cols-[minmax(0,1fr)_196px]">
            <div>
              <div className="rounded-[10px] border border-[#e4eaf2] bg-white p-[14px] shadow-[0_8px_24px_rgba(18,39,74,0.05)]">
                <p className="text-[14px] font-semibold text-[#273248]">Suggested Next Test</p>
                <div className="mt-[12px] rounded-[8px] border border-[#edf2f7] bg-white px-[14px] py-[16px]">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-[14px] font-semibold text-[#273248]">{examMeta.examTitle}</p>
                      <div className="mt-[8px] flex flex-wrap items-center gap-[12px] text-[11px] text-[#98a2b3]">
                        <span>{examMeta.totalQuestions} Qs</span>
                        <span>{examMeta.marks} Marks</span>
                        <span>{examMeta.duration}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      data-testid="tests-open-instructions"
                      onClick={() => openAttemptFlow(selectedTest?._id)}
                      className="flex h-[28px] min-w-[92px] items-center justify-center rounded-[4px] bg-[#23aaf0] px-[12px] text-[11px] font-semibold text-white"
                    >
                      {getAttemptActionLabel(getAttemptStatusForTest(selectedTest?._id))}
                    </button>
                  </div>
                  <div className="mt-[8px] flex gap-[10px] text-[11px] text-[#4d93ef]">
                    <span>Syllabus</span>
                    <span>English, Hindi</span>
                  </div>
                  {featuredDetailCard && (
                  <div className="mt-[12px] flex items-center justify-between gap-4 rounded-[10px] border border-[#edf2f7] bg-[#fbfdff] px-[12px] py-[10px]">
                    <div>
                      <p className="text-[11px] font-semibold text-[#273248]">{featuredDetailCard.companionTone === 'emerald' ? 'Live Class' : featuredDetailCard.companionAction}</p>
                      <p className="mt-[4px] text-[10px] text-[#7c8ba0]">{featuredDetailCard.companionPrimaryMeta}</p>
                      {featuredDetailCard.companionSecondaryMeta && (
                        <p className="mt-[2px] text-[10px] text-[#7c8ba0]">{featuredDetailCard.companionSecondaryMeta}</p>
                      )}
                    </div>
                    <button
                      type="button"
                      data-testid="tests-live-companion-featured-desktop"
                      onClick={() => openLinkedLiveClass(featuredDetailCard.liveClassId)}
                      className={cn(
                        'flex h-[30px] min-w-[124px] items-center justify-center rounded-[6px] border px-[12px] text-[11px] font-semibold',
                        companionActionToneClasses[featuredDetailCard.companionTone],
                      )}
                    >
                      {featuredDetailCard.companionButtonLabel}
                    </button>
                  </div>
                  )}
                </div>

                <div className="mt-[10px] flex items-center gap-[18px] border-b border-[#edf2f7] text-[12px] text-[#75849a]">
                  <button className="border-b-2 border-[#2f8df4] pb-[8px] font-semibold text-[#2f8df4]">Full Mock Tests ({detailTestCards.length})</button>
                </div>

                <div className="mt-[8px] space-y-[8px]">
                  {detailTestCards.map((card) => (
                    <div key={card.id} className="border-b border-[#edf2f7] px-[8px] py-[14px] last:border-b-0">
                      <div>
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <p className="text-[14px] font-semibold text-[#273248]">{card.title}</p>
                            <div className="mt-[8px] flex flex-wrap items-center gap-[12px] text-[11px] text-[#98a2b3]">
                              <span>{examMeta.totalQuestions} Questions</span>
                              <span>{examMeta.marks} Marks</span>
                              <span>{examMeta.duration}</span>
                            </div>
                            <div className="mt-[8px] flex gap-[10px] text-[11px] text-[#4d93ef]">
                              <span>Syllabus</span>
                              <span>English, Hindi</span>
                            </div>
                          </div>
                          <div className="flex min-w-[164px] flex-col items-end gap-[8px]">
                            <button type="button" onClick={() => openAttemptFlow(card.mockTestId || card.id)} className="flex h-[28px] min-w-[90px] items-center justify-center rounded-[4px] bg-[#23aaf0] px-[12px] text-[11px] font-semibold text-white">
                              {getAttemptActionLabel(getAttemptStatusForTest(card.mockTestId || card.id))}
                            </button>
                            <button
                              type="button"
                              data-testid={`tests-live-companion-desktop-${card.id}`}
                              onClick={() => openLinkedLiveClass(card.liveClassId)}
                              className={cn(
                                'flex h-[28px] min-w-[132px] items-center justify-center rounded-[6px] border px-[12px] text-[11px] font-semibold',
                                companionActionToneClasses[card.companionTone],
                              )}
                            >
                              {card.companionButtonLabel}
                            </button>
                            <p className="max-w-[160px] text-right text-[10px] leading-[1.5] text-[#7c8ba0]">{card.companionMeta}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-[8px]">
              <div>
                <div className="rounded-[10px] border border-[#e4eaf2] bg-white px-[12px] py-[12px] shadow-[0_8px_24px_rgba(18,39,74,0.05)]">
                  <p className="text-[13px] font-semibold text-[#273248]">More Test Series for you</p>
                  {sideSeries.map((item) => (
                    <button key={item.title} type="button" onClick={() => openSeries(item.id)} className="flex w-full items-start justify-between gap-3 border-b border-[#edf2f7] py-[12px] text-left last:border-b-0">
                      <div>
                        <p className="text-[12px] font-semibold leading-[1.35] text-[#273248]">{item.title}</p>
                        <p className="mt-[6px] text-[10px] text-[#98a2b3]">{item.stats}</p>
                      </div>
                      <ChevronRight className="mt-[2px] h-4 w-4 shrink-0 text-[#a0acbc]" />
                    </button>
                  ))}
                  <button className="mt-[12px] flex h-[32px] w-full items-center justify-center rounded-[5px] border border-[#93c4f6] text-[12px] font-semibold text-[#2f8df4]">View More</button>
                </div>
              </div>

              <div>
                <div className="rounded-[10px] border border-[#e4eaf2] bg-white px-[12px] py-[12px] shadow-[0_8px_24px_rgba(18,39,74,0.05)]">
                  <p className="text-[13px] font-semibold text-[#273248]">Want to know your Rank?</p>
                  <button className="mt-[10px] flex w-full items-center justify-between rounded-[8px] bg-[#fff6ed] px-[10px] py-[10px] text-left">
                    <span className="text-[11px] font-semibold text-[#ee9943]">Rank Predictor</span>
                    <ChevronRight className="h-4 w-4 text-[#d2d9e2]" />
                  </button>
                </div>
              </div>

              <div>
                <div className="rounded-[10px] border border-[#e4eaf2] bg-white px-[12px] py-[12px] shadow-[0_8px_24px_rgba(18,39,74,0.05)]">
                  <p className="text-[13px] font-semibold text-[#273248]">Why Take this Test Series ?</p>
                  {whyTakeItems.map((item) => (
                    <div key={item.title} className="border-b border-[#edf2f7] py-[10px] last:border-b-0">
                      <p className="text-[11px] font-semibold text-[#273248]">{item.title}</p>
                      <p className="mt-[4px] text-[10px] leading-[1.45] text-[#98a2b3]">{item.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const desktopInstructions = (
    <DesktopInstructionFrame
      testId="tests-instructions-desktop"
      examTitle={examMeta.examTitle}
      userName={learnerName}
      body={renderInstructionBody()}
      footer={(
        <div className="flex items-center justify-between px-5 py-3">
          <button type="button" onClick={() => setScreen('detail')} className="text-[13px] font-medium text-[#4a94cb]">
            ← Go to Tests
          </button>
          <button
            type="button"
            data-testid="tests-instructions-next-desktop"
            onClick={() => setScreen('confirmation')}
            className="rounded-[3px] bg-[#7db3ec] px-8 py-2 text-[12px] font-semibold text-white"
          >
            Next
          </button>
        </div>
      )}
    />
  );

  const desktopConfirmation = (
    <DesktopInstructionFrame
      testId="tests-confirmation-desktop"
      examTitle={examMeta.examTitle}
      userName={learnerName}
      body={(
        <div>
          <p className="text-center text-[21px] font-semibold text-slate-900">{examMeta.examTitle}</p>

          <div className="mt-8 flex flex-wrap items-center justify-between gap-4 text-[14px] font-semibold text-slate-800">
            <p>Duration: {examMeta.duration}</p>
            <p>Maximum Marks: {examMeta.marks}</p>
          </div>

          <p className="mt-6 text-[15px] font-semibold text-slate-900">Read the following instructions carefully.</p>
          <ol className="mt-4 list-decimal space-y-3 pl-6 text-[13px] leading-8 text-slate-800">
            <li>The test contains {examMeta.totalQuestions} total questions.</li>
            <li>Each question has 4 Options out of which only one is correct.</li>
            <li>You have to finish the test in 120 minutes.</li>
            <li>Try not to guess the answer as there is negative marking.</li>
            <li>You will be awarded 3 mark for each correct answer and 1 will be deducted for each wrong answer.</li>
            <li>There is no negative marking for the questions that you have not attempted.</li>
            <li>You can submit this test and reattempt it later if needed. Make sure you complete or submit the current attempt before leaving.</li>
          </ol>

          <div className="mt-8 border-y border-slate-200 py-6">
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-[13px] font-semibold text-slate-900">Choose your default language:</label>
              <select
                data-testid="tests-confirmation-language-desktop"
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
              Please note all questions will appear in your default language. This language can be changed for a particular question later on
            </p>
          </div>

          <div className="mt-6">
            <p className="text-[15px] font-semibold text-slate-900">Declaration:</p>
            <label
              data-testid="tests-confirmation-checkbox-desktop"
              className="mt-3 flex cursor-pointer items-start gap-3 text-[13px] leading-7 text-slate-800"
            >
              <input
                type="checkbox"
                checked={confirmationAccepted}
                onChange={(event) => setConfirmationAccepted(event.target.checked)}
                className="mt-1 h-4 w-4 rounded-none border-slate-300"
              />
              <span>
                I have read all the instructions carefully and have understood them. I agree not to cheat or use unfair means in this examination. I understand
                that using unfair means of any sort for my own or someone else&apos;s advantage will lead to my immediate disqualification. The decision of
                VARONENGLISH will be final in these matters and cannot be appealed.
              </span>
            </label>
          </div>
        </div>
      )}
      footer={(
        <div className="grid grid-cols-[auto_1fr_auto] items-center px-5 py-3">
          <button
            type="button"
            onClick={() => setScreen('instructions')}
            className="rounded-[3px] bg-[#eef5ff] px-5 py-2 text-[12px] font-semibold text-slate-700 ring-1 ring-slate-300"
          >
            Previous
          </button>
          <div className="flex justify-center">
            <button
              type="button"
              data-testid="tests-confirmation-begin-desktop"
              onClick={beginExam}
              disabled={!confirmationAccepted || !defaultLanguage}
              className="rounded-[3px] bg-[#72d0e9] px-8 py-2 text-[12px] font-semibold text-white disabled:opacity-50"
            >
              I am ready to begin
            </button>
          </div>
          <div />
        </div>
      )}
    />
  );

  const desktopExamOverlay = desktopExamPanel ? (
    <div className="pointer-events-none absolute inset-0 z-10 flex justify-center">
      {desktopExamPanel === 'calculator' && (
        <div className="pointer-events-auto mt-[40px] w-[420px] max-w-[calc(100%-80px)] rounded-[8px] border border-[#d7dee8] bg-white p-[18px] shadow-[0_12px_24px_rgba(15,23,42,0.18)]">
          <div className="flex items-center justify-between">
            <p className="text-[18px] font-semibold text-[#1f2737]">Calculator</p>
            <button type="button" onClick={() => setDesktopExamPanel(null)} className="text-[#7a8799]">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-[14px] rounded-[8px] border border-[#dce5ef] bg-[#f9fbfd] px-[14px] py-[16px] text-right text-[28px] font-semibold text-[#1f2737]">0</div>
          <div className="mt-[12px] grid grid-cols-4 gap-[8px]">
            {['7', '8', '9', '/', '4', '5', '6', 'x', '1', '2', '3', '-', '0', '.', '=', '+'].map((key) => (
              <button key={key} type="button" className="flex h-[42px] items-center justify-center rounded-[8px] border border-[#dce5ef] bg-white text-[14px] font-semibold text-[#47556d]">
                {key}
              </button>
            ))}
          </div>
        </div>
      )}

      {desktopExamPanel === 'symbols' && (
        <div data-testid="tests-desktop-symbols-overlay" className="pointer-events-auto mt-[26px] w-[1040px] max-w-[calc(100%-56px)] rounded-[8px] border border-[#8a8a8a] bg-white shadow-[0_6px_16px_rgba(0,0,0,0.24)]">
          <table className="w-full border-collapse text-left text-[12px] text-[#154ca3]">
            <thead>
              <tr className="bg-[#ded4be] text-[#1f1f1f]">
                <th className="w-[180px] border border-[#d3d3d3] px-4 py-2 text-center text-[16px] font-semibold">Symbol</th>
                <th className="border border-[#d3d3d3] px-4 py-2 text-[16px] font-semibold">Description</th>
              </tr>
            </thead>
            <tbody>
              {[
                {
                  symbol: <div className="mx-auto h-[18px] w-[18px] rounded-full border border-[#7b7b7b] bg-white" />,
                  text: 'Option Not chosen',
                },
                {
                  symbol: (
                    <div className="mx-auto flex h-[18px] w-[18px] items-center justify-center rounded-full border border-[#2466db] bg-white">
                      <div className="h-[8px] w-[8px] rounded-full bg-[#2466db]" />
                    </div>
                  ),
                  text: 'Option chosen as correct (By clicking on it again you can delete your option and choose another option if desired.)',
                },
                {
                  symbol: <div className="flex justify-center">{renderDesktopPaletteBadge('unvisited', 12)}</div>,
                  text: 'Question number shown in blue color indicates that you have not yet attempted the question.',
                },
                {
                  symbol: <div className="flex justify-center">{renderDesktopPaletteBadge('answered', 13)}</div>,
                  text: 'Question number shown in green color indicates that you have answered the question.',
                },
                {
                  symbol: <div className="flex justify-center">{renderDesktopPaletteBadge('review', 14, true)}</div>,
                  text: 'You have not yet answered the question, but marked it for coming back for review later, if time permits.',
                },
                {
                  symbol: <div className="flex justify-center">{renderDesktopPaletteBadge('answered-review', 15, true)}</div>,
                  text: 'You have answered the question, but marked it for review later, if time permits.',
                },
              ].map((row) => (
                <tr key={row.text}>
                  <td className="border border-[#d3d3d3] px-4 py-2">{row.symbol}</td>
                  <td className="border border-[#d3d3d3] px-4 py-2 text-[13px] font-semibold leading-[1.45]">{row.text}</td>
                </tr>
              ))}
              {[
                ['Save & Next', 'Clicking on this will take you to the next question.'],
                ['Previous', 'Clicking on this will take you to the previous question.'],
                ['Mark for Review', 'By clicking on this button, you can mark the question for review later. Please note that if you answer the question and mark it for review, the question will be treated as answered and evaluated even if you do not review it.'],
                ['Unmark Review', 'By clicking on this button, you can unmark the question for review'],
              ].map(([label, text]) => (
                <tr key={label}>
                  <td className="border border-[#d3d3d3] px-4 py-2">
                    <div className="mx-auto flex h-[32px] w-[138px] items-center justify-center rounded-[4px] bg-[#2f69d9] text-[14px] font-semibold text-white">
                      {label}
                    </div>
                  </td>
                  <td className="border border-[#d3d3d3] px-4 py-2 text-[13px] font-semibold leading-[1.45]">{text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {desktopExamPanel === 'summary' && (
        <div data-testid="tests-desktop-summary-overlay" className="pointer-events-auto mt-[32px] w-[880px] max-w-[calc(100%-160px)] rounded-[2px] border border-[#adadad] bg-white px-[24px] py-[30px] shadow-[0_8px_18px_rgba(0,0,0,0.18)]">
          <div className="border border-[#d2d2d2]">
            <div className="bg-[#ded4be] px-3 py-2 text-[15px] font-semibold text-[#2b2b2b]">Test Summary</div>
            <div className="space-y-6 px-8 py-8 text-center text-[24px] font-semibold leading-none text-[#2b2b2b]">
              <p>You have answered <span className="text-[#ff1b00]">{answeredCount}</span> questions out of <span className="text-[#ff1b00]">{questions.length}</span> questions.</p>
              <p>You have not answered <span className="text-[#ff1b00]">{notAnsweredCount}</span> questions out of <span className="text-[#ff1b00]">{questions.length}</span> questions.</p>
              <p>You have marked for review <span className="text-[#ff1b00]">{markReviewCount}</span> questions out of <span className="text-[#ff1b00]">{questions.length}</span> questions.</p>
            </div>
          </div>
        </div>
      )}

      {desktopExamPanel === 'instructions' && (
        <div data-testid="tests-desktop-instructions-overlay" className="pointer-events-auto mt-[24px] h-[calc(100%-48px)] w-[1080px] max-w-[calc(100%-70px)] overflow-hidden rounded-[4px] border border-[#cfd6df] bg-white shadow-[0_10px_24px_rgba(0,0,0,0.18)]">
          <div className="cbt-scroll h-full overflow-y-auto px-6 py-5" style={{ fontFamily: cbtFontStack }}>
            {renderInstructionBody()}
          </div>
        </div>
      )}
    </div>
  ) : null;

  const desktopExam = (
    <div data-testid="tests-exam-desktop" className="hidden h-full min-h-0 flex-1 flex-col bg-white lg:flex" style={{ fontFamily: cbtFontStack }}>
      <div className="grid gap-3 border-b border-[#d9d9d9] bg-white px-4 py-3 lg:grid-cols-[250px_190px_minmax(0,1fr)_372px] lg:items-center">
        <div className="flex items-center gap-3">
          <LogoMark large />
          <div>
            <p className="max-w-[190px] truncate text-[11px] font-semibold leading-tight text-slate-900">{examMeta.examTitle}</p>
          </div>
        </div>

        <div className="flex items-center justify-center gap-2 lg:justify-start">
          <button
            type="button"
            onClick={() => setQuestionZoom((current) => Math.min(current + 1, 2))}
            className="rounded-[14px] bg-[#2f69d9] px-4 py-2 text-[10px] font-semibold text-white"
          >
            Zoom (+)
          </button>
          <button
            type="button"
            onClick={() => setQuestionZoom((current) => Math.max(current - 1, 0))}
            className="rounded-[14px] bg-[#2f69d9] px-4 py-2 text-[10px] font-semibold text-white"
          >
            Zoom (-)
          </button>
        </div>

        <div className="text-center">
          <p className="text-[17px] font-semibold text-slate-900">{examMeta.examTitle}</p>
          <p className="mt-1 text-[11px] font-semibold text-slate-700">Roll No : 918297161559</p>
        </div>

        <div className="flex flex-wrap items-start justify-end gap-3">
          <button type="button" onClick={() => void document.documentElement.requestFullscreen?.()} className="flex h-11 w-11 items-center justify-center rounded-[4px] border border-[#37b3eb] bg-white text-[#37b3eb]">
            <Expand className="h-4 w-4" />
          </button>
          <button type="button" className="flex h-11 w-11 items-center justify-center rounded-[4px] border border-[#37b3eb] bg-white text-[#37b3eb]">
            <Pause className="h-4 w-4" />
          </button>
          <div className="px-1 text-right">
            <p className="text-[11px] font-semibold text-slate-800">Time Left</p>
            <p className="mt-1 bg-[#fff36d] px-3 py-1 text-[17px] font-bold tracking-[0.08em] text-red-600">{formatClock(timeLeft)}</p>
          </div>
          <div className="flex gap-2">
            <div className="w-[78px] text-center">
              <div className="flex h-[58px] items-center justify-center bg-[#dfe6f1] text-[#99a5b9]"><UserCircle2 className="h-[42px] w-[42px]" /></div>
              <p className="mt-1 text-[9px] font-medium leading-[1.15] text-slate-600">Registration Photo</p>
            </div>
            <div className="w-[78px] text-center">
              <div className="flex h-[58px] items-center justify-center bg-[#dfe6f1] text-[#99a5b9]"><UserCircle2 className="h-[42px] w-[42px]" /></div>
              <p className="mt-1 text-[9px] font-medium leading-[1.15] text-slate-600">Captured Photo</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid border-b border-[#d9d9d9] lg:grid-cols-[minmax(0,1fr)_430px]">
        <div className="flex flex-wrap items-center gap-5 px-4 py-3">
          {[
            { id: 'symbols', label: 'SYMBOLS', tone: 'text-[#1f78c5]' },
            { id: 'calculator', label: 'CALCULATOR', tone: 'text-[#1f78c5]' },
            { id: 'instructions', label: 'INSTRUCTIONS', tone: 'text-[#cc4b2a]' },
            { id: 'summary', label: 'OVERALL TEST SUMMARY', tone: 'text-[#8d2e17]' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              data-testid={tab.id === 'symbols'
                ? 'tests-desktop-open-symbols'
                : tab.id === 'instructions'
                  ? 'tests-desktop-open-instructions'
                  : tab.id === 'summary'
                    ? 'tests-desktop-open-summary'
                    : undefined}
              onClick={() => setDesktopExamPanel((current) => (current === tab.id ? null : tab.id as 'symbols' | 'instructions' | 'summary' | 'calculator'))}
              className={cn('text-[11px] font-semibold uppercase underline underline-offset-4', tab.tone)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="border-l border-[#d9d9d9] px-4 py-3 text-right">
          <p className="text-[12px] font-semibold text-slate-900">
            Total Questions Answered: <span className="bg-[#fff36d] px-1.5 py-0.5 text-[#ff1b00]">{answeredCount}</span>
          </p>
        </div>
      </div>

      <div className="grid border-b border-[#d9d9d9] lg:grid-cols-[minmax(0,1fr)_430px]">
        <div className="px-4 py-3">
          <div className="grid items-center gap-4 xl:grid-cols-[auto_1fr_auto]">
            <div className="flex flex-wrap gap-2">
              <button className="rounded-[4px] bg-[#179b17] px-4 py-[7px] text-[12px] font-semibold text-white">PART-A</button>
            </div>

            <div className="flex justify-center">
              <div className="flex flex-wrap items-center gap-2.5">
                {currentIndex > 0 && (
                  <button
                    type="button"
                    onClick={() => goToQuestion(currentIndex - 1)}
                    className="min-w-[108px] rounded-[4px] bg-[#2f69d9] px-4 py-[8px] text-[12px] font-semibold text-white"
                  >
                    Previous
                  </button>
                )}
                <button
                  type="button"
                  onClick={toggleReview}
                  className={cn(
                    'min-w-[134px] rounded-[4px] px-4 py-[8px] text-[12px] font-semibold',
                    isCurrentQuestionMarkedForReview ? 'bg-[#ece3c9] text-[#242424]' : 'bg-[#2f69d9] text-white',
                  )}
                >
                  {isCurrentQuestionMarkedForReview ? 'Unmark Review' : 'Mark for Review'}
                </button>
                <button type="button" onClick={saveAndNext} className="min-w-[122px] rounded-[4px] bg-[#2f69d9] px-4 py-[8px] text-[12px] font-semibold text-white">
                  Save &amp; Next
                </button>
                <button
                  type="button"
                  data-testid="tests-exam-submit-desktop"
                  onClick={submitExam}
                  className="min-w-[114px] rounded-[4px] bg-[#2f69d9] px-4 py-[8px] text-[12px] font-semibold text-white"
                >
                  Submit Test
                </button>
              </div>
            </div>

            <div />
          </div>
        </div>
        <div className="border-l border-[#d9d9d9] bg-white" />
      </div>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_430px]">
        <main className="cbt-scroll relative min-h-0 overflow-y-scroll px-4 py-5">
          <div className={cn('space-y-4', desktopExamPanel && 'opacity-[0.96]')}>
            <p className="text-[18px] font-semibold text-[#333333]">Question No. {currentIndex + 1}</p>

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
                <div className="border border-transparent p-[14px]">
                  <div className="border border-[#e2e7ee] bg-white">
                    <div className="border-b border-[#e2e7ee] px-5 py-5">
                      <p className={cn('whitespace-pre-wrap font-normal text-slate-900', questionTextClass)}>
                        {currentQuestion.prompt}
                      </p>
                    </div>

                    <div className="divide-y divide-[#e2e7ee]">
                      {currentQuestion.options.map((option, optionIndex) => {
                        const isSelected = draftAnswer.includes(optionIndex);
                        const allowsMultipleAnswers = currentQuestion.correctIndexes.length > 1;
                        const optionInputId = `tests-desktop-option-${currentQuestion.id}-${optionIndex}`;

                        return (
                          <label
                            key={`${currentQuestion.id}-${option}`}
                            htmlFor={optionInputId}
                            className="grid w-full cursor-pointer grid-cols-[58px_minmax(0,1fr)] items-center text-left"
                          >
                            <div className="flex h-full items-center justify-center border-r border-[#e2e7ee] py-6">
                              <input
                                id={optionInputId}
                                type={allowsMultipleAnswers ? 'checkbox' : 'radio'}
                                checked={isSelected}
                                onChange={() => selectOption(optionIndex)}
                                className="sr-only"
                              />
                              <div className={cn(
                                allowsMultipleAnswers
                                  ? 'flex h-[19px] w-[19px] items-center justify-center rounded-[4px] border border-slate-400 bg-white'
                                  : 'flex h-[19px] w-[19px] items-center justify-center rounded-full border border-slate-400 bg-white',
                                isSelected && 'border-[#1e88e5]',
                              )}>
                                {isSelected && <div className={cn(allowsMultipleAnswers ? 'h-[9px] w-[9px] rounded-[2px] bg-[#1e88e5]' : 'h-[8px] w-[8px] rounded-full bg-[#1e88e5]')} />}
                              </div>
                            </div>
                            <div className="px-[28px] py-[20px]">
                              <p className={cn('text-slate-800', questionZoom === 0 ? 'text-[14px]' : questionZoom === 1 ? 'text-[16px]' : 'text-[18px]')}>
                                {option}
                              </p>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {desktopExamOverlay}
        </main>

        <aside className="min-h-0 border-l border-[#d9d9d9] bg-white">
          <div className="flex h-full min-h-0 flex-col px-4 py-3">
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex items-center gap-2">
                <div className="h-0 w-0 border-y-[10px] border-y-transparent border-l-[14px] border-l-[#31a8dd]" />
                <p className="text-[13px] font-semibold text-slate-900">General Engineering</p>
              </div>

              <div className="cbt-scroll mt-3 flex-1 overflow-y-scroll pr-1">
                <div className="grid grid-cols-4 justify-items-center gap-y-4 pb-2">
                  {displayStates.map((state, index) => (
                    <button
                      key={`desktop-palette-${index}`}
                      type="button"
                      data-testid={`tests-desktop-jump-${index + 1}`}
                      onClick={() => goToQuestion(index)}
                    >
                      {renderDesktopPaletteBadge(state, index + 1, currentIndex === index)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-3 shrink-0 border border-slate-400 bg-white">
              <div className="border-b border-slate-400 bg-slate-100 px-3 py-[8px] text-center text-[13px] font-semibold text-slate-900">
                PART-A Analysis
              </div>
              <div className="divide-y divide-slate-200">
                <div className="grid grid-cols-[minmax(0,1fr)_40px] text-[12px]">
                  <span className="px-4 py-[9px] text-slate-700">Answered</span>
                  <span className="flex items-center justify-center border-l border-slate-200 bg-[#fff36d] font-semibold text-[#ff1b00]">{answeredCount}</span>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_40px] text-[12px]">
                  <span className="px-4 py-[9px] text-slate-700">Not Answered</span>
                  <span className="flex items-center justify-center border-l border-slate-200 bg-[#fff36d] font-semibold text-[#ff1b00]">{notAnsweredCount}</span>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_40px] text-[12px]">
                  <span className="px-4 py-[9px] text-slate-700">Mark for Review</span>
                  <span className="flex items-center justify-center border-l border-slate-200 bg-[#fff36d] font-semibold text-[#ff1b00]">{markReviewCount}</span>
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );

  const mobileShell = (testId: string, content: React.ReactNode) => (
    <div
      data-testid={testId}
      className="mobile-safe-screen flex min-h-dvh flex-1 flex-col overflow-x-hidden bg-white pb-[108px] pt-[10px] lg:hidden"
      style={{ fontFamily: uiFontStack }}
    >
      <div className="mobile-safe-content mx-auto flex w-full max-w-[390px] flex-1 flex-col overflow-x-hidden px-[16px]">{content}</div>
    </div>
  );

  const mobileHome = mobileShell('tests-home-mobile', (
    <>
      <MobileStatusBar />
      <div className="mt-[6px] flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] font-semibold text-[#1e2f5a]">Hi {learnerDisplayName}</p>
          <p className="mt-[4px] text-[12px] leading-5 text-[#7284a7]">Pick up your next mock without the extra clutter.</p>
        </div>
      </div>

      <div className="mt-[14px] flex items-center gap-[10px]">
        <div className="flex h-[46px] min-w-0 flex-1 items-center gap-3 rounded-[16px] border border-[#e5ebf5] bg-white px-[14px] text-[13px] text-[#96a1b4] shadow-[0_8px_18px_rgba(16,24,40,0.05)]">
          <Search className="h-4 w-4" />
          <span className="truncate">Search for tests, classes...</span>
        </div>
        <button className="flex h-[46px] w-[46px] items-center justify-center rounded-[16px] border border-[#e5ebf5] bg-white text-[#223357] shadow-[0_8px_18px_rgba(16,24,40,0.05)]">
          <ListFilter className="h-[18px] w-[18px]" />
        </button>
      </div>

      <button
        type="button"
        onClick={() => openAttemptFlow(selectedTest?._id || fullMockTests[0]?._id || '')}
        className="mt-[14px] overflow-hidden rounded-[22px] border border-[#dfe8fb] bg-[linear-gradient(135deg,#f5f9ff_0%,#ffffff_52%,#eef4ff_100%)] p-[14px] text-left shadow-[0_16px_34px_rgba(45,110,229,0.08)]"
      >
        <div className="grid grid-cols-[minmax(0,1fr)_96px] items-center gap-[8px] min-[390px]:grid-cols-[minmax(0,1fr)_118px]">
          <div className="min-w-0">
            <span className="inline-flex rounded-full bg-[#eaf1ff] px-[10px] py-[4px] text-[11px] font-semibold text-[#2f78eb]">
              {getAttemptStatusForTest(selectedTest?._id || fullMockTests[0]?._id || '') === 'completed'
                ? 'Test completed'
                : getAttemptStatusForTest(selectedTest?._id || fullMockTests[0]?._id || '') === 'in-progress'
                  ? 'Resume where you left'
                  : 'Ready to start'}
            </span>
            <p className="mt-[10px] text-[18px] font-semibold leading-[1.18] tracking-[-0.03em] text-[#1e2f5a]">
              {selectedTest?.title || 'No mock test available'}
            </p>
            <p className="mt-[4px] text-[13px] text-[#526987]">{selectedTest?.category || selectedTest?.type || 'Mock Test'}</p>
            <p className="mt-[12px] text-[12px] font-medium text-[#526987]">{getAttemptActionLabel(getAttemptStatusForTest(selectedTest?._id || fullMockTests[0]?._id || ''))}</p>
            <div className="mt-[8px] h-[4px] w-[118px] rounded-full bg-[#dfe8fb]">
              <div className="h-full rounded-full bg-[linear-gradient(90deg,#3d94f4_0%,#2b83e6_100%)]" style={{ width: `${getAttemptProgressForTest(selectedTest?._id || fullMockTests[0]?._id || '', selectedTest?.questions?.length || 0)}%` }} />
            </div>
            <span className="mt-[14px] inline-flex h-[38px] items-center gap-[8px] rounded-[12px] bg-[linear-gradient(90deg,#2d8cf1,#315df9)] px-[14px] text-[12px] font-semibold text-white shadow-[0_12px_24px_rgba(49,99,255,0.24)]">
              {getAttemptStatusForTest(selectedTest?._id || fullMockTests[0]?._id || '') === 'completed' ? 'Open Result' : getAttemptActionLabel(getAttemptStatusForTest(selectedTest?._id || fullMockTests[0]?._id || ''))}
              <ArrowRight className="h-[16px] w-[16px]" />
            </span>
          </div>
          <div className="flex shrink-0 justify-end pl-[10px]">
            <HeroIllustration compact />
          </div>
        </div>
      </button>

      <div className="mt-[16px]">
        <div className="flex items-center justify-between">
          <p className="min-w-0 text-[16px] font-semibold text-[#1e2f5a]">Your Recent Test Series</p>
          <button className="inline-flex items-center gap-[4px] text-[12px] font-semibold text-[#2f78eb]">
            View All
            <ChevronRight className="h-[14px] w-[14px]" />
          </button>
        </div>
        <div className="mt-[10px] grid grid-cols-2 gap-[10px] min-[390px]:grid-cols-3">
          {recentSeries.slice(0, 3).map((series, index) => (
            <button
              key={series.id}
              type="button"
              data-testid={index === 0 ? 'tests-open-series-primary' : undefined}
              onClick={() => openSeries(series.id)}
              className="rounded-[18px] border border-[#ebeef6] bg-white p-[10px] text-left shadow-[0_10px_22px_rgba(18,39,74,0.06)]"
            >
              <div className="flex items-center justify-between">
                <div className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-[#fff3ec] text-[10px] font-bold text-[#ff6e3c]">S</div>
                <ChipBadge tone={series.chipTone}>{series.progressText}</ChipBadge>
              </div>
              <p className="mt-[10px] min-h-[70px] text-[11px] font-semibold leading-[1.42] text-[#1e2f5a]">{series.title}</p>
              <p className="mt-[4px] text-[10px] text-[#7a8eae]">{series.statsLabel}</p>
              <div className="mt-[8px] flex items-center justify-between text-[10px] text-[#7b879d]">
                <span>{series.testsLabel}</span>
                <span>{series.progressText}</span>
              </div>
              <div className="mt-[8px] h-[4px] rounded-full bg-[#edf2fb]">
                <div className="h-full w-[4%] rounded-full bg-[#3d94f4]" />
              </div>
              <div className="mt-[10px] flex items-center gap-[8px]">
                <span className="inline-flex h-[34px] flex-1 items-center justify-center rounded-[10px] bg-[linear-gradient(90deg,#2d8cf1,#315df9)] text-[11px] font-semibold text-white">
                  Open Series
                </span>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleSavedSeries(series.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      event.stopPropagation();
                      toggleSavedSeries(series.id);
                    }
                  }}
                  className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] border border-[#e6edf8] bg-white text-[#2f78eb]"
                >
                  <Bookmark className={cn('h-[15px] w-[15px]', savedSeriesIds.includes(series.id) && 'fill-current')} />
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-[16px]">
        <div className="flex items-center justify-between">
          <p className="min-w-0 text-[16px] font-semibold text-[#1e2f5a]">Recommended for You</p>
          <button className="inline-flex items-center gap-[4px] text-[12px] font-semibold text-[#2f78eb]">
            See All
            <ChevronRight className="h-[14px] w-[14px]" />
          </button>
        </div>
        <div className="mt-[10px] overflow-hidden rounded-[20px] border border-[#ebeef6] bg-white shadow-[0_10px_22px_rgba(18,39,74,0.06)]">
          {recommendedTests.map((item, index) => (
            <button
              key={item.id}
              type="button"
              onClick={() => openSeries(item.seriesId)}
              className={cn(
                'grid w-full grid-cols-[38px_minmax(0,1fr)_18px] items-center gap-[10px] px-[12px] py-[11px] text-left min-[390px]:grid-cols-[42px_minmax(0,1fr)_70px_18px]',
                index !== recommendedTests.length - 1 && 'border-b border-[#edf2fb]',
              )}
            >
              <div className={cn('flex h-[36px] w-[36px] items-center justify-center rounded-[12px]', recommendedIconToneClasses[item.iconTone])}>
                {index === 0 ? <FileText className="h-[16px] w-[16px]" /> : index === 1 ? <List className="h-[16px] w-[16px]" /> : <AlertTriangle className="h-[16px] w-[16px]" />}
              </div>
              <div className="min-w-0">
                <p className="truncate text-[12px] font-semibold text-[#1e2f5a]">{item.title}</p>
                <div className="mt-[4px] flex flex-wrap gap-[6px]">
                  <span className="rounded-full bg-[#f3f6fb] px-[8px] py-[3px] text-[10px] text-[#607394]">{item.typeLabel}</span>
                  <span className="rounded-full bg-[#f3f6fb] px-[8px] py-[3px] text-[10px] text-[#607394]">{item.secondaryLabel}</span>
                </div>
              </div>
              <div className="hidden text-right min-[390px]:block">
                <p className="text-[10px] text-[#8a97ab]">Attempted by</p>
                <p className="mt-[4px] text-[11px] font-medium text-[#526987]">{item.attemptedLabel}</p>
              </div>
              <ChevronRight className="h-[16px] w-[16px] text-[#8ca0bc]" />
            </button>
          ))}
        </div>
      </div>

      <div className="mt-[16px]">
        <p className="text-[16px] font-semibold text-[#1e2f5a]">Quick Actions</p>
        <div className="mt-[10px] grid grid-cols-2 gap-[10px]">
          {quickActionItems.map((item, index) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                if (item.onPress === 'detail') {
                  openSeries(selectedTest?._id || fullMockTests[0]?._id || '');
                } else {
                  setScreen('home');
                }
              }}
              className="rounded-[18px] border border-[#ebeef6] bg-white px-[12px] py-[12px] text-left shadow-[0_10px_22px_rgba(18,39,74,0.06)]"
            >
              <div className={cn('flex h-[36px] w-[36px] items-center justify-center rounded-[12px]', quickActionToneClasses[item.iconTone])}>
                {index === 0 ? <FileText className="h-[16px] w-[16px]" /> : index === 1 ? <Bookmark className="h-[16px] w-[16px]" /> : index === 2 ? <Clock3 className="h-[16px] w-[16px]" /> : <Users className="h-[16px] w-[16px]" />}
              </div>
              <p className="mt-[12px] text-[12px] font-medium leading-[1.35] text-[#1e2f5a]">{item.label}</p>
            </button>
          ))}
        </div>
      </div>
    </>
  ));

  const mobileDetail = mobileShell('tests-detail-mobile', (
    <>
      <MobileStatusBar />
      <div className="mt-[6px] flex items-center justify-between">
        <button type="button" onClick={() => setScreen('home')} className="flex h-[46px] w-[46px] items-center justify-center rounded-[16px] border border-[#e5ebf5] bg-white text-[#1d2740] shadow-[0_10px_18px_rgba(16,24,40,0.05)]">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="flex h-[54px] w-[54px] items-center justify-center rounded-full border border-[#e5ebf5] bg-white text-[18px] shadow-[0_12px_18px_rgba(16,24,40,0.05)]">🏅</div>
        <button type="button" className="flex h-[46px] w-[46px] items-center justify-center rounded-[16px] border border-[#e5ebf5] bg-white text-[#1d2740] shadow-[0_10px_18px_rgba(16,24,40,0.05)]">
          <Share2 className="h-5 w-5" />
        </button>
      </div>
      <h1
        className="mx-auto mt-[14px] max-w-[326px] text-center text-[19px] font-bold leading-[1.18] tracking-[-0.03em] text-[#1f2c54]"
        style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
      >
        <span className="block">{selectedSeriesMeta.title}</span>
      </h1>
      <div className="mt-[12px] grid grid-cols-3 items-center rounded-[26px] border border-[#e6edf7] bg-white px-[18px] py-[13px] text-[11px] text-[#65748c] shadow-[0_10px_22px_rgba(18,39,74,0.05)]">
        <div className="text-center">
          <p className="text-[24px] font-semibold leading-none text-[#2458c7]">{selectedSeriesMeta.totalTests.split(' ')[0]}</p>
          <p className="mt-[6px]">Total tests</p>
        </div>
        <div className="flex justify-center">
          <div className="rounded-full bg-[#2cc96f] px-[20px] py-[8px] text-[9px] font-semibold tracking-[0.08em] text-white whitespace-nowrap">{selectedSeriesMeta.freeTests}</div>
        </div>
        <div className="text-center">
          <p className="text-[24px] font-semibold leading-none text-[#1f2737]">{selectedSeriesMeta.users.replace(' Users', '').replace('k', 'K')}</p>
          <p className="mt-[6px]">Users</p>
        </div>
      </div>
      <div className="mt-[10px] text-[11px] text-[#65748c]">
        <div className="flex items-center justify-between">
          <span className="text-[12px]">{selectedSeriesMeta.progressLabel}</span>
          <span className="text-[11px] font-semibold text-[#2cc96f]">{selectedSeriesMeta.progressPercent}</span>
        </div>
        <div className="mt-[8px] h-[7px] rounded-full bg-[#e7edf6]">
          <div className="h-full w-[2.2%] rounded-full bg-[#2cc96f]" />
        </div>
      </div>
      <div className="mt-[14px] rounded-[26px] border border-[#e7eef8] bg-[linear-gradient(135deg,#f7fbff_0%,#ffffff_58%,#eef4ff_100%)] px-[14px] py-[13px] shadow-[0_12px_24px_rgba(18,39,74,0.06)]">
        <div className="grid grid-cols-[minmax(0,1fr)_118px] items-center gap-[0px]">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-[#2f78eb]">Suggested next test</p>
            <p className="mt-[8px] text-[14px] font-semibold leading-[1.18] tracking-[-0.02em] text-[#1e2f5a]">{examMeta.examTitle}</p>
            <div className="mt-[8px] flex flex-wrap gap-[7px] text-[10px] text-[#526987]">
              <span className="inline-flex items-center gap-[5px] rounded-[10px] bg-white/92 px-[8px] py-[4px] shadow-[0_6px_12px_rgba(61,128,246,0.05)]"><FileText className="h-[11px] w-[11px] text-[#8095ba]" />{examMeta.totalQuestions} Qs</span>
              <span className="inline-flex items-center gap-[5px] rounded-[10px] bg-white/92 px-[8px] py-[4px] shadow-[0_6px_12px_rgba(61,128,246,0.05)]"><Star className="h-[11px] w-[11px] text-[#8095ba]" />{examMeta.marks} Marks</span>
              <span className="inline-flex items-center gap-[5px] rounded-[10px] bg-white/92 px-[8px] py-[4px] shadow-[0_6px_12px_rgba(61,128,246,0.05)]"><Clock3 className="h-[11px] w-[11px] text-[#8095ba]" />{examMeta.duration}</span>
            </div>
            <div className="mt-[8px] flex gap-[16px] text-[10px] font-medium text-[#2f78eb]">
              <span>Syllabus</span>
              <span>English, Hindi</span>
            </div>
            <button type="button" data-testid="tests-open-instructions" onClick={() => openAttemptFlow(selectedTest?._id)} className="mt-[10px] inline-flex h-[40px] min-w-[150px] items-center justify-center gap-[12px] rounded-[12px] bg-[linear-gradient(90deg,#2d8cf1,#315df9)] px-[20px] text-[12px] font-semibold text-white shadow-[0_12px_22px_rgba(49,99,255,0.24)]">
              {getAttemptActionLabel(getAttemptStatusForTest(selectedTest?._id))}
              <ArrowRight className="h-[18px] w-[18px]" />
            </button>
          </div>
          <div className="flex shrink-0 justify-end pt-[10px]">
            <HeroIllustration compact />
          </div>
        </div>
        {featuredDetailCard && (
        <div className="mt-[10px] grid grid-cols-[minmax(0,1fr)_140px] items-center gap-0 rounded-[16px] border border-[#e7edf8] bg-white/92 px-[12px] py-[9px]">
          <div className="flex min-w-0 items-center gap-[10px] border-r border-[#e8eef7] pr-[12px]">
            <div className="flex h-[36px] w-[36px] items-center justify-center rounded-[11px] bg-[#eefbf2] text-[#1f9c5a]">
              <Video className="h-[16px] w-[16px]" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-[8px]">
                <p className="whitespace-nowrap text-[11px] font-semibold text-[#1e2f5a]">Live Class</p>
                <span className="rounded-full bg-[#ffefef] px-[7px] py-[2px] text-[10px] font-semibold text-[#ff5b57]">LIVE</span>
              </div>
              <p className="mt-[2px] text-[10px] text-[#607394]">{featuredDetailCard.companionPrimaryMeta}</p>
              {featuredDetailCard.companionSecondaryMeta && (
                <p className="mt-[1px] text-[10px] text-[#607394]">{featuredDetailCard.companionSecondaryMeta}</p>
              )}
            </div>
          </div>
          <button type="button" data-testid="tests-live-companion-featured-mobile" onClick={() => openLinkedLiveClass(featuredDetailCard.liveClassId)} className="ml-[12px] inline-flex h-[40px] items-center justify-center gap-[8px] rounded-[12px] border border-[#cfeedd] bg-[#effcf4] px-[10px] text-[11px] font-semibold text-[#1f9c5a]">
            <Video className="h-[14px] w-[14px]" />
            {featuredDetailCard.companionAction}
          </button>
        </div>
        )}
      </div>
      <div className="mt-[14px] flex items-center gap-[12px] border-b border-[#edf2f7] text-[11px] text-[#6d7c93]">
        <div className="flex min-w-0 flex-1 gap-[16px] overflow-x-auto">
          <button className="border-b-[3px] border-[#2f8df4] pb-[12px] font-semibold text-[#2f8df4]">Full Mock Tests ({detailTestCards.length})</button>
        </div>
        <button className="mb-[8px] flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[14px] border border-[#e7edf7] bg-white text-[#223357] shadow-[0_8px_14px_rgba(16,24,40,0.04)]">
          <ListFilter className="h-[16px] w-[16px]" />
        </button>
      </div>
      <div className="mt-[10px] space-y-[12px]">
        {detailTestCards.map((card, index) => (
          <div key={card.id} className="rounded-[22px] border border-[#ebeef6] bg-white px-[14px] py-[13px] shadow-[0_8px_18px_rgba(18,39,74,0.05)]">
            <div className="grid grid-cols-[64px_minmax(0,1fr)] gap-[10px]">
              <div className={cn(
                'flex h-[60px] w-[60px] items-center justify-center rounded-[14px] border text-[22px] font-semibold shadow-[inset_0_-6px_14px_rgba(43,120,235,0.08)]',
                index === 0 ? 'border-[#dce7ff] bg-[#eef4ff] text-[#2f78eb]' : index === 1 ? 'border-[#dce7ff] bg-[#eef4ff] text-[#2f78eb]' : 'border-[#d7f2df] bg-[#eefbf2] text-[#27b35d]',
              )}>
                {index + 9}
              </div>
              <div className="min-w-0">
                <div className="flex items-start justify-between gap-[10px]">
                  <p className="pr-[2px] text-[11px] font-semibold leading-[1.2] tracking-[-0.02em] text-[#1e2f5a]">{card.title}</p>
                  <div className="text-right">
                    <span className="inline-flex min-w-[76px] justify-center rounded-full bg-[#eef4ff] px-[8px] py-[6px] text-[10px] font-semibold text-[#2f78eb]">{card.usersLabel}</span>
                    <p className="mt-[7px] text-[10px] text-[#7a8eae]">{selectedSeriesMeta.paperLabel}</p>
                  </div>
                </div>
                <div className="mt-[6px] flex flex-wrap gap-[14px] text-[10px] text-[#607394]">
                  <span>{examMeta.totalQuestions} Qs</span>
                  <span>{examMeta.marks} Marks</span>
                  <span>{examMeta.duration}</span>
                </div>
                <div className="mt-[6px] flex gap-[16px] text-[10px] font-medium text-[#2f78eb]">
                  <span>Syllabus</span>
                  <span>English, Hindi</span>
                </div>
              </div>
            </div>
            <div className="mt-[12px] grid grid-cols-[116px_minmax(0,1fr)] items-end gap-[12px]">
              <button
                type="button"
                onClick={() => openAttemptFlow(card.mockTestId || card.id)}
                className={cn(
                  'flex h-[38px] items-center justify-center self-end rounded-[10px] px-[12px] text-[10px] font-semibold text-white shadow-[0_10px_18px_rgba(49,99,255,0.18)]',
                  getAttemptStatusForTest(card.mockTestId || card.id) === 'not-started' ? 'bg-[linear-gradient(90deg,#30bf67,#24a957)]' : 'bg-[linear-gradient(90deg,#2d8cf1,#315df9)]',
                )}
              >
                {getAttemptActionLabel(getAttemptStatusForTest(card.mockTestId || card.id))}
              </button>
              {card.companionTone === 'emerald' ? (
                <div className="rounded-[14px] border border-[#edf2f7] bg-[#fbfdff] px-[12px] py-[9px]">
                  <div className="grid grid-cols-[28px_minmax(0,1fr)_62px] items-center gap-[8px]">
                    <div className="flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-[10px] bg-[#eefbf2] text-[#1f9c5a]">
                      <Video className="h-[14px] w-[14px]" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-[6px]">
                        <p className="whitespace-nowrap text-[10px] font-semibold text-[#1e2f5a]">Live Class</p>
                        <span className="shrink-0 rounded-full bg-[#ffefef] px-[6px] py-[2px] text-[9px] font-semibold text-[#ff5b57]">LIVE</span>
                      </div>
                      <p className="mt-[2px] whitespace-nowrap text-[9px] text-[#7c8ba0]">{card.companionPrimaryMeta}</p>
                      {card.companionSecondaryMeta && (
                        <p className="mt-[1px] whitespace-nowrap text-[9px] text-[#7c8ba0]">{card.companionSecondaryMeta}</p>
                      )}
                    </div>
                    <button
                      type="button"
                      data-testid={`tests-live-companion-mobile-${card.id}`}
                      onClick={() => openLinkedLiveClass(card.liveClassId)}
                      className="flex h-[34px] items-center justify-center rounded-[10px] border border-[#cfeedd] bg-[#effcf4] text-[10px] font-semibold text-[#1f9c5a]"
                    >
                      {card.companionButtonLabel}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="rounded-[14px] border border-[#edf2f7] bg-[#fbfdff] px-[12px] py-[9px]">
                  <div className="flex items-center gap-[8px]">
                    <div
                      className={cn(
                        'flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-[10px]',
                        card.companionTone === 'blue' ? 'bg-[#eef4ff] text-[#2f78eb]' : 'bg-[#fff5e8] text-[#d88928]',
                      )}
                    >
                      {card.companionTone === 'blue' ? <MonitorPlay className="h-[14px] w-[14px]" /> : <PlayCircle className="h-[14px] w-[14px]" />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold leading-[1.2] text-[#1e2f5a]">{card.companionAction}</p>
                      <p className="mt-[2px] text-[9px] leading-[1.35] text-[#7c8ba0]">{card.companionMeta}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    data-testid={`tests-live-companion-mobile-${card.id}`}
                    onClick={() => openLinkedLiveClass(card.liveClassId)}
                    className={cn(
                      'mt-[10px] flex h-[30px] w-full items-center justify-center rounded-[10px] border text-[10px] font-semibold',
                      companionActionToneClasses[card.companionTone],
                    )}
                  >
                    {card.companionButtonLabel}
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  ));

  const mobileInstructions = mobileShell('tests-instructions-mobile', (
    <>
      <MobileStatusBar />
      <div className="mt-[12px] flex items-center justify-between">
        <button type="button" onClick={() => setScreen('detail')} className="text-[#1f2737]"><ChevronLeft className="h-5 w-5" /></button>
        <p className="text-[16px] font-semibold text-[#1f2737]">Instructions</p>
        <div className="w-[20px]" />
      </div>
      <div className="mt-[16px] rounded-[18px] border border-[#ebeef6] bg-white p-[18px] shadow-[0_10px_24px_rgba(18,39,74,0.06)]">
        {renderMobileInstructionBody()}
      </div>
      <button type="button" data-testid="tests-instructions-next-mobile" onClick={() => setScreen('confirmation')} className="mt-[16px] flex h-[42px] items-center justify-center rounded-[8px] bg-[#2f8df4] text-[14px] font-semibold text-white">Next</button>
      <button type="button" onClick={() => setScreen('detail')} className="mt-[12px] text-center text-[14px] font-semibold text-[#2f8df4]">Go to Tests</button>
    </>
  ));

  const mobileConfirmation = mobileShell('tests-confirmation-mobile', (
    <>
      <MobileStatusBar />
      <div className="mt-[12px] flex items-center justify-between">
        <button type="button" onClick={() => setScreen('instructions')} className="text-[#1f2737]"><ChevronLeft className="h-5 w-5" /></button>
        <div className="w-[20px]" />
      </div>
      <div className="mt-[14px] rounded-[18px] border border-[#ebeef6] bg-white px-[18px] py-[22px] shadow-[0_10px_24px_rgba(18,39,74,0.06)]">
        <h1 className="text-center text-[20px] font-semibold text-[#1f2737]">{examMeta.examTitle}</h1>
        <div className="mt-[18px] grid gap-[14px] text-[13px]">
          <div className="flex items-center gap-[10px]"><Clock3 className="h-4 w-4 text-[#7c889d]" /><div><p className="font-semibold text-[#1f2737]">Duration</p><p className="text-[#7c889d]">120 Minutes</p></div></div>
          <div className="flex items-center gap-[10px]"><FileText className="h-4 w-4 text-[#2f8df4]" /><div><p className="font-semibold text-[#1f2737]">Total Questions</p><p className="text-[#7c889d]">{examMeta.totalQuestions}</p></div></div>
          <div className="flex items-center gap-[10px]"><Users className="h-4 w-4 text-[#f4a33b]" /><div><p className="font-semibold text-[#1f2737]">Maximum Marks</p><p className="text-[#7c889d]">{examMeta.marks}</p></div></div>
        </div>
        <ol className="mt-[18px] list-decimal space-y-[8px] pl-[18px] text-[13px] leading-[1.8] text-[#1f2737]">
          <li>The test contains {examMeta.totalQuestions} total questions.</li>
          <li>Each question has 4 options out of which only one is correct.</li>
          <li>You have to finish the test in 120 minutes.</li>
          <li>Try not to guess the answer as there is negative marking.</li>
          <li>You will be awarded 3 mark for each correct answer and 1 will be deducted for each wrong answer.</li>
          <li>There is no negative marking for the questions that you have not attempted.</li>
          <li>You can reattempt this test later if you want to improve your score.</li>
        </ol>
        <div className="mt-[16px]">
          <label className="text-[12px] font-semibold text-[#1f2737]">Choose your default language:</label>
          <select data-testid="tests-confirmation-language-mobile" value={defaultLanguage} onChange={(event) => setDefaultLanguage(event.target.value)} className="mt-[8px] h-[38px] w-full rounded-[8px] border border-[#d9e1eb] px-[12px] text-[13px] text-[#1f2737]">
            <option value="">-- Select --</option>
            <option value="English">English</option>
            <option value="Hindi">Hindi</option>
          </select>
        </div>
        <label
          data-testid="tests-confirmation-checkbox-mobile"
          className="mt-[16px] flex cursor-pointer items-start gap-[10px] text-[12px] leading-[1.7] text-[#1f2737]"
        >
          <input
            type="checkbox"
            checked={confirmationAccepted}
            onChange={(event) => setConfirmationAccepted(event.target.checked)}
            className="mt-[4px] h-[14px] w-[14px]"
          />
          <span>I have read all the instructions carefully and have understood them.</span>
        </label>
        <button
          type="button"
          data-testid="tests-confirmation-begin-mobile"
          disabled={!confirmationAccepted || !defaultLanguage}
          onClick={beginExam}
          className="mt-[18px] flex h-[42px] w-full items-center justify-center rounded-[8px] bg-[#2f8df4] text-[14px] font-semibold text-white disabled:opacity-50"
        >
          I am ready to begin
        </button>
      </div>
    </>
  ));

  const mobileExam = mobileShell('tests-exam-mobile', (
    <>
      <MobileStatusBar />
      <div className="mt-[10px] flex items-center justify-between">
        <p className="max-w-[270px] truncate text-[17px] font-semibold text-[#1f2737]">{examMeta.examTitle}</p>
        <button type="button" data-testid="tests-palette-open-mobile" onClick={() => setMobilePaletteOpen(true)} className="text-[#1f2737]"><List className="h-5 w-5" /></button>
      </div>
      <div className="mt-[12px] flex items-center gap-[18px] border-b border-[#edf2f7] pb-[10px] text-[12px] font-semibold">
        <button className="text-[#17a53b]">PART-A</button>
        <div className="ml-auto text-right">
          <p className="text-[10px] text-[#7c889d]">Time Left</p>
          <p className="text-[22px] font-bold leading-none text-[#f02020]">{formatClock(timeLeft)}</p>
        </div>
      </div>

      <div className="mt-[12px] grid grid-cols-3 gap-[8px]">
        <div className="rounded-[12px] border border-[#edf2f7] bg-[#f9fbff] px-[10px] py-[8px] text-center">
          <p className="text-[10px] text-[#7c889d]">Answered</p>
          <p className="mt-[4px] text-[16px] font-semibold text-[#2dbb6a]">{answeredCount}</p>
        </div>
        <div className="rounded-[12px] border border-[#edf2f7] bg-[#f9fbff] px-[10px] py-[8px] text-center">
          <p className="text-[10px] text-[#7c889d]">Pending</p>
          <p className="mt-[4px] text-[16px] font-semibold text-[#59667f]">{notAnsweredCount}</p>
        </div>
        <div className="rounded-[12px] border border-[#edf2f7] bg-[#f9fbff] px-[10px] py-[8px] text-center">
          <p className="text-[10px] text-[#7c889d]">Review</p>
          <p className="mt-[4px] text-[16px] font-semibold text-[#8f51d9]">{markReviewCount}</p>
        </div>
      </div>

      <div className="mt-[10px] flex items-center justify-between rounded-[12px] border border-[#edf2f7] bg-white px-[12px] py-[10px] text-[11px] text-[#526987] shadow-[0_8px_18px_rgba(18,39,74,0.04)]">
        <span>Question {currentIndex + 1} of {questions.length}</span>
        <button type="button" onClick={() => setMobilePaletteOpen(true)} className="font-semibold text-[#2f8df4]">
          Open Palette
        </button>
      </div>

      <div className="mt-[12px] min-h-0 flex-1 overflow-y-auto pr-[2px]">
        <p className="text-[13px] font-semibold text-[#1f2737]">Question {currentIndex + 1}</p>
        <p className="mt-[10px] whitespace-pre-line text-[13px] leading-[1.7] text-[#1f2737]">{currentQuestion.prompt}</p>
        <div className="mt-[12px] space-y-[10px]">
          {currentQuestion.options.map((option, optionIndex) => {
            const optionInputId = `tests-mobile-option-${currentQuestion.id}-${optionIndex}`;

            return (
              <label htmlFor={optionInputId} key={option} className="flex cursor-pointer items-start gap-[8px] rounded-[12px] border border-[#edf2f7] bg-white px-[10px] py-[10px] text-[12px] leading-[1.55] text-[#1f2737]">
                <input
                  id={optionInputId}
                  type={currentQuestion.correctIndexes.length > 1 ? 'checkbox' : 'radio'}
                  checked={draftAnswer.includes(optionIndex)}
                  onChange={() => selectOption(optionIndex)}
                  className="mt-[4px] h-[14px] w-[14px]"
                />
                <span>{option}</span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="mt-[12px] flex items-center gap-[10px] border-t border-[#edf2f7] bg-white pt-[12px]">
        <button type="button" onClick={() => goToQuestion(currentIndex - 1)} className="flex h-[38px] items-center rounded-[8px] border border-[#d9e1eb] px-[14px] text-[12px] font-semibold text-[#2f8df4]">Previous</button>
        <button type="button" onClick={toggleReview} className="flex h-[38px] items-center rounded-[8px] border border-[#2f8df4] px-[16px] text-[12px] font-semibold text-[#2f8df4]">{draftReview ? 'Unmark' : 'Mark Review'}</button>
        <button type="button" onClick={saveAndNext} className="flex h-[38px] flex-1 items-center justify-center rounded-[8px] bg-[#2f8df4] text-[12px] font-semibold text-white">Save &amp; Next</button>
      </div>
      <div className="mt-[10px] grid grid-cols-2 gap-[10px]">
        <button type="button" onClick={() => setScreen('detail')} className="flex h-[40px] items-center justify-center rounded-[8px] border border-[#d9e1eb] text-[12px] font-semibold text-[#47556d]">Go to Tests</button>
        <button type="button" data-testid="tests-exam-submit-mobile" onClick={submitExam} className="flex h-[40px] items-center justify-center rounded-[8px] bg-[#1f9c5a] text-[12px] font-semibold text-white">Submit Test</button>
      </div>
    </>
  ));

  const mobilePalette = mobileShell('tests-mobile-palette', (
    <>
      <MobileStatusBar />
      <div className="mt-[12px] flex items-center justify-between">
        <button type="button" onClick={() => setMobilePaletteOpen(false)} className="text-[#1f2737]"><ChevronLeft className="h-5 w-5" /></button>
        <p className="text-[16px] font-semibold text-[#1f2737]">Question Palette</p>
        <button type="button" data-testid="tests-palette-close-mobile" onClick={() => setMobilePaletteOpen(false)} className="text-[#1f2737]"><X className="h-4 w-4" /></button>
      </div>
      <div className="mt-[18px] grid grid-cols-4 gap-[12px]">
        {questions.map((_, index) => (
          <button
            key={`mobile-palette-${index}`}
            type="button"
            data-testid={`tests-mobile-jump-${index + 1}`}
            onClick={() => goToQuestion(index)}
            className={paletteButtonClass(displayStates[index], index === currentIndex)}
          >
            {index + 1}
          </button>
        ))}
      </div>
      <div className="mt-[20px] space-y-[10px] text-[12px] text-[#47556d]">
        <div className="flex items-center justify-between"><span className="flex items-center gap-[8px]"><span className="h-[10px] w-[10px] rounded-[2px] bg-[#60be79]" />Answered</span><span className="font-semibold text-[#2dbb6a]">{answeredCount}</span></div>
        <div className="flex items-center justify-between"><span className="flex items-center gap-[8px]"><span className="h-[10px] w-[10px] rounded-[2px] bg-[#c7cfdd]" />Not Answered</span><span className="font-semibold text-[#59667f]">{notAnsweredCount}</span></div>
        <div className="flex items-center justify-between"><span className="flex items-center gap-[8px]"><span className="h-[10px] w-[10px] rounded-[2px] bg-[#8f51d9]" />Mark for Review</span><span className="font-semibold text-[#8f51d9]">{markReviewCount}</span></div>
      </div>
      <div className="mt-[18px] grid grid-cols-2 gap-[10px]">
        <button type="button" onClick={() => setScreen('detail')} className="flex h-[40px] items-center justify-center rounded-[8px] border border-[#d9e1eb] text-[12px] font-semibold text-[#47556d]">Go to Tests</button>
        <button type="button" onClick={submitExam} className="flex h-[40px] items-center justify-center rounded-[8px] bg-[#1f9c5a] text-[12px] font-semibold text-white">Submit Test</button>
      </div>
      <button type="button" data-testid="tests-palette-close-mobile" onClick={() => setMobilePaletteOpen(false)} className="mt-auto flex h-[42px] w-full items-center justify-center rounded-[8px] bg-[#2f8df4] text-[14px] font-semibold text-white">Close</button>
    </>
  ));

  const mobileResult = mobileShell('tests-result-mobile', (
    <>
      <MobileStatusBar />
      <div className="mt-[12px] flex items-center">
        <button type="button" onClick={() => setScreen('detail')} className="text-[#1f2737]"><ChevronLeft className="h-5 w-5" /></button>
      </div>
      <div className="mt-[14px] rounded-[18px] border border-[#ebeef6] bg-white px-[18px] py-[22px] text-center shadow-[0_10px_24px_rgba(18,39,74,0.06)]">
        <div className="mx-auto flex h-[84px] w-[84px] items-center justify-center rounded-full bg-[linear-gradient(180deg,#7bd98b_0%,#48bf6b_100%)] text-white shadow-[0_14px_28px_rgba(72,191,107,0.26)]">
          <Check className="h-10 w-10" />
        </div>
        <p className="mt-[16px] text-[24px] font-semibold text-[#1f2737]">Congratulations!</p>
        <p className="mt-[6px] text-[14px] text-[#7c889d]">You have completed the test.</p>
        <div className="mt-[18px] grid grid-cols-3 gap-[10px]">
          <div className="rounded-[12px] border border-[#edf2f7] p-[10px]"><p className="text-[11px] text-[#7c889d]">Score</p><p className="mt-[6px] text-[18px] font-semibold text-[#1f2737]">{formatMetricValue(resultScore)} / {formatMetricValue(resultTotalMarks)}</p></div>
          <div className="rounded-[12px] border border-[#edf2f7] p-[10px]"><p className="text-[11px] text-[#7c889d]">Accuracy</p><p className="mt-[6px] text-[18px] font-semibold text-[#1f2737]">{resultAccuracy}%</p></div>
          <div className="rounded-[12px] border border-[#edf2f7] p-[10px]"><p className="text-[11px] text-[#7c889d]">Correct / Wrong</p><p className="mt-[6px] text-[18px] font-semibold text-[#1f2737]">{correctCount} / {incorrectCount}</p></div>
        </div>
        <div className="mt-[18px] grid grid-cols-2 gap-[10px]">
          <button type="button" data-testid="tests-view-solutions" onClick={() => setScreen('solutions')} className="flex h-[40px] items-center justify-center rounded-[8px] border border-[#2f8df4] text-[13px] font-semibold text-[#2f8df4]">View Solutions</button>
          <button type="button" onClick={() => setScreen('solutions')} className="flex h-[40px] items-center justify-center rounded-[8px] bg-[#2f8df4] text-[13px] font-semibold text-white">View Analysis</button>
        </div>
      </div>
      <div className="mt-[18px] rounded-[18px] border border-[#ebeef6] bg-white px-[18px] py-[18px] shadow-[0_10px_24px_rgba(18,39,74,0.06)]">
        <p className="text-[15px] font-semibold text-[#1f2737]">Other Actions</p>
        <button type="button" onClick={restartCurrentAttempt} className="mt-[14px] flex w-full items-center justify-between rounded-[12px] border border-[#edf2f7] px-[14px] py-[12px] text-[13px] text-[#47556d]">
          <span>Attempt Again</span>
          <ChevronRight className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => { resetAttemptState(); setScreen('home'); }} className="mt-[10px] flex w-full items-center justify-between rounded-[12px] border border-[#edf2f7] px-[14px] py-[12px] text-[13px] text-[#47556d]">
          <span>Go to Test Series</span>
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </>
  ));

  const mobileSolutions = mobileShell('tests-solutions-mobile', (
    <>
      <MobileStatusBar />
      <div className="mt-[12px] flex items-center justify-between">
        <button type="button" onClick={() => setScreen('result')} className="text-[#1f2737]"><ChevronLeft className="h-5 w-5" /></button>
        <p className="text-[16px] font-semibold text-[#1f2737]">Solutions</p>
        <button type="button" onClick={() => setScreen('detail')} className="text-[11px] font-semibold text-[#2f8df4]">Tests</button>
      </div>
        <div className="mt-[16px] flex gap-[8px] text-[11px] font-semibold">
        {solutionFilterSummary.map((item) => (
          <button
            key={item.id}
            className={cn(
              'rounded-[6px] px-[10px] py-[6px]',
              item.tone === 'active' && 'bg-[#2f8df4] text-white',
              item.tone === 'success' && 'bg-[#f4fff7] text-[#2ebf6c]',
              item.tone === 'danger' && 'bg-[#fff7f7] text-[#e85555]',
              item.tone === 'neutral' && 'bg-[#f5f7fb] text-[#5d6b84]',
            )}
          >
            {item.label}
          </button>
        ))}
        </div>
        <div className="mt-[12px] grid grid-cols-2 gap-[10px]">
          <button type="button" onClick={restartCurrentAttempt} className="flex h-[40px] items-center justify-center rounded-[8px] border border-[#2f8df4] text-[12px] font-semibold text-[#2f8df4]">Reattempt</button>
          <button type="button" onClick={() => setScreen('detail')} className="flex h-[40px] items-center justify-center rounded-[8px] bg-[#2f8df4] text-[12px] font-semibold text-white">Go to Tests</button>
        </div>
      <div className="mt-[16px] space-y-[16px]">
        {attemptResults.map((result) => (
          <div key={result.questionId} className="rounded-[18px] border border-[#ebeef6] bg-white px-[18px] py-[18px] shadow-[0_10px_24px_rgba(18,39,74,0.06)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[14px] font-semibold text-[#1f2737]">Question {result.questionNumber}</p>
                <p className="mt-[10px] whitespace-pre-line text-[13px] leading-[1.8] text-[#1f2737]">{result.prompt}</p>
              </div>
              <span className={cn(
                'rounded-full px-[10px] py-[4px] text-[10px] font-semibold',
                result.status === 'correct' && 'bg-[#ebfff1] text-[#2ebf6c]',
                result.status === 'incorrect' && 'bg-[#fff7f7] text-[#e85555]',
                result.status === 'unattempted' && 'bg-[#f5f7fb] text-[#5d6b84]',
              )}>
                {result.status === 'correct' ? 'Correct' : result.status === 'incorrect' ? 'Incorrect' : 'Unattempted'}
              </span>
            </div>
            <div className={cn(
              'mt-[12px] rounded-[12px] p-[12px]',
              result.status === 'incorrect' && 'border border-[#ffd2d2] bg-[#fff7f7]',
              result.status !== 'incorrect' && 'border border-[#e6ebf3] bg-[#fafcff]',
            )}>
              <p className="text-[11px] font-semibold text-[#47556d]">Your Answer</p>
              <p className="mt-[6px] text-[12px] leading-[1.6] text-[#1f2737]">
                {result.selectedIndexes.length > 0
                  ? `${formatOptionLabels(result.selectedIndexes)}. ${result.selectedIndexes.map((optionIndex) => result.options[optionIndex]).filter(Boolean).join(' / ')}`
                  : 'Not answered'}
              </p>
            </div>
            <div className="mt-[12px] rounded-[12px] border border-[#c7efd3] bg-[#f4fff7] p-[12px]">
              <p className="text-[11px] font-semibold text-[#2ebf6c]">Correct Answer</p>
              <p className="mt-[6px] text-[12px] leading-[1.6] text-[#1f2737]">{formatOptionLabels(result.correctIndexes)}. {result.correctIndexes.map((optionIndex) => result.options[optionIndex]).filter(Boolean).join(' / ')}</p>
            </div>
            <p className="mt-[14px] text-[12px] leading-[1.8] text-[#47556d]">{result.explanation}</p>
          </div>
        ))}
      </div>
    </>
  ));

  const desktopResult = (
    <div data-testid="tests-result-desktop" className="hidden h-full min-h-0 flex-1 bg-[#f5f7fb] px-[28px] py-[18px] lg:block" style={{ fontFamily: uiFontStack }}>
      <div className="mx-auto max-w-[760px] rounded-[18px] border border-[#dde5f0] bg-white px-[28px] py-[28px] shadow-[0_12px_24px_rgba(18,39,74,0.05)]">
        <div className="text-center">
          <div className="mx-auto flex h-[84px] w-[84px] items-center justify-center rounded-full bg-[linear-gradient(180deg,#7bd98b_0%,#48bf6b_100%)] text-white shadow-[0_14px_28px_rgba(72,191,107,0.26)]">
            <Check className="h-10 w-10" />
          </div>
          <p className="mt-[16px] text-[28px] font-semibold text-[#1f2737]">Congratulations!</p>
          <p className="mt-[6px] text-[14px] text-[#7c889d]">You have completed the test.</p>
        </div>
        <div className="mt-[20px] grid grid-cols-3 gap-[14px]">
          <div className="rounded-[14px] border border-[#edf2f7] p-[14px]"><p className="text-[11px] text-[#7c889d]">Score</p><p className="mt-[8px] text-[22px] font-semibold text-[#1f2737]">{formatMetricValue(resultScore)} / {formatMetricValue(resultTotalMarks)}</p></div>
          <div className="rounded-[14px] border border-[#edf2f7] p-[14px]"><p className="text-[11px] text-[#7c889d]">Accuracy</p><p className="mt-[8px] text-[22px] font-semibold text-[#1f2737]">{resultAccuracy}%</p></div>
          <div className="rounded-[14px] border border-[#edf2f7] p-[14px]"><p className="text-[11px] text-[#7c889d]">Rank</p><p className="mt-[8px] text-[22px] font-semibold text-[#1f2737]">{resultRank ? `#${resultRank}` : `${correctCount} / ${questions.length} correct`}</p></div>
        </div>
        <div className="mt-[20px] flex justify-center gap-[10px]">
          <button type="button" data-testid="tests-view-solutions-desktop" onClick={() => setScreen('solutions')} className="flex h-[42px] items-center justify-center rounded-[8px] border border-[#2f8df4] px-[18px] text-[13px] font-semibold text-[#2f8df4]">View Solutions</button>
          <button type="button" onClick={() => setScreen('detail')} className="flex h-[42px] items-center justify-center rounded-[8px] bg-[#2f8df4] px-[18px] text-[13px] font-semibold text-white">Go to Tests</button>
        </div>
        <div className="mt-[14px] flex justify-center">
          <button type="button" onClick={restartCurrentAttempt} className="flex h-[42px] items-center justify-center rounded-[8px] border border-[#2f8df4] px-[18px] text-[13px] font-semibold text-[#2f8df4]">Attempt Again</button>
        </div>
      </div>
    </div>
  );

  const desktopSolutions = (
    <div data-testid="tests-solutions-desktop" className="hidden h-full min-h-0 flex-1 bg-[#f5f7fb] px-[28px] py-[18px] lg:block" style={{ fontFamily: uiFontStack }}>
      <div className="mx-auto max-w-[920px] rounded-[18px] border border-[#dde5f0] bg-white px-[24px] py-[22px] shadow-[0_12px_24px_rgba(18,39,74,0.05)]">
        <div className="flex items-center justify-between">
          <p className="text-[24px] font-semibold text-[#1f2737]">Solutions</p>
          <div className="flex items-center gap-[12px]">
            <button type="button" onClick={restartCurrentAttempt} className="text-[13px] font-semibold text-[#2f8df4]">Reattempt</button>
            <button type="button" onClick={() => setScreen('detail')} className="text-[13px] font-semibold text-[#2f8df4]">Go to tests</button>
            <button type="button" onClick={() => setScreen('result')} className="text-[13px] font-semibold text-[#2f8df4]">Back to result</button>
          </div>
        </div>
        <div className="mt-[14px] flex flex-wrap gap-[8px] text-[11px] font-semibold">
          {solutionFilterSummary.map((item) => (
            <span
              key={item.id}
              className={cn(
                'rounded-[999px] px-[10px] py-[6px]',
                item.tone === 'active' && 'bg-[#2f8df4] text-white',
                item.tone === 'success' && 'bg-[#f4fff7] text-[#2ebf6c]',
                item.tone === 'danger' && 'bg-[#fff7f7] text-[#e85555]',
                item.tone === 'neutral' && 'bg-[#f5f7fb] text-[#5d6b84]',
              )}
            >
              {item.label}
            </span>
          ))}
        </div>
        <div className="mt-[18px] space-y-[16px]">
          {attemptResults.map((result) => (
            <div key={result.questionId} className="rounded-[14px] border border-[#ebeef6] p-[18px]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[15px] font-semibold text-[#1f2737]">Question {result.questionNumber}</p>
                  <p className="mt-[10px] whitespace-pre-line text-[13px] leading-[1.8] text-[#1f2737]">{result.prompt}</p>
                </div>
                <span className={cn(
                  'rounded-full px-[10px] py-[4px] text-[10px] font-semibold',
                  result.status === 'correct' && 'bg-[#ebfff1] text-[#2ebf6c]',
                  result.status === 'incorrect' && 'bg-[#fff7f7] text-[#e85555]',
                  result.status === 'unattempted' && 'bg-[#f5f7fb] text-[#5d6b84]',
                )}>
                  {result.status === 'correct' ? 'Correct' : result.status === 'incorrect' ? 'Incorrect' : 'Unattempted'}
                </span>
              </div>
              <div className="mt-[12px] rounded-[12px] border border-[#e6ebf3] bg-[#fafcff] p-[12px]">
                <p className="text-[11px] font-semibold text-[#47556d]">Your Answer</p>
                <p className="mt-[6px] text-[12px] leading-[1.6] text-[#1f2737]">
                  {result.selectedIndexes.length > 0
                    ? `${formatOptionLabels(result.selectedIndexes)}. ${result.selectedIndexes.map((optionIndex) => result.options[optionIndex]).filter(Boolean).join(' / ')}`
                    : 'Not answered'}
                </p>
              </div>
              <div className="mt-[12px] rounded-[12px] border border-[#c7efd3] bg-[#f4fff7] p-[12px]">
                <p className="text-[11px] font-semibold text-[#2ebf6c]">Correct Answer</p>
                <p className="mt-[6px] text-[12px] leading-[1.6] text-[#1f2737]">{formatOptionLabels(result.correctIndexes)}. {result.correctIndexes.map((optionIndex) => result.options[optionIndex]).filter(Boolean).join(' / ')}</p>
              </div>
              <p className="mt-[14px] text-[12px] leading-[1.8] text-[#47556d]">{result.explanation}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div data-testid="tests-figma-page" className="flex min-h-0 flex-1 flex-col bg-[#f5f7fb]">
      {screen === 'home' && (
        <>
          {desktopHome}
          {mobileHome}
        </>
      )}

      {screen === 'detail' && (
        <>
          {desktopDetail}
          {mobileDetail}
        </>
      )}

      {screen === 'instructions' && (
        <>
          {desktopInstructions}
          {mobileInstructions}
        </>
      )}

      {screen === 'confirmation' && (
        <>
          {desktopConfirmation}
          {mobileConfirmation}
        </>
      )}

      {screen === 'exam' && (
        <>
          {desktopExam}
          {mobilePaletteOpen ? mobilePalette : mobileExam}
        </>
      )}

      {screen === 'result' && (
        <>
          {desktopResult}
          {mobileResult}
        </>
      )}

      {screen === 'solutions' && (
        <>
          {desktopSolutions}
          {mobileSolutions}
        </>
      )}
    </div>
  );
};
