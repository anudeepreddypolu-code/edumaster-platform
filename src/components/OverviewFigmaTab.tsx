import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Bell,
  BookOpen,
  CalendarClock,
  ChevronRight,
  ClipboardList,
  FileText,
  Radio,
  Target,
} from 'lucide-react';
import { CourseCard, LiveClass, MockTest, NotificationItem, PlatformOverview } from '../types';

type OverviewFigmaTabProps = {
  overview: PlatformOverview;
  onContinueLearning: (courseId: string, lessonId?: string | null) => void;
  onOpenLiveTab?: () => void;
  onOpenTestsTab?: () => void;
  onOpenRevisionTab?: () => void;
  onOpenCoursesTab?: () => void;
  onOpenNotification?: (notification: NotificationItem) => void;
};

const overviewFontStack = 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

const formatNumber = (value: number) => new Intl.NumberFormat('en-IN').format(Math.max(Math.round(value || 0), 0));

const formatPercent = (value: number) => `${Math.max(Math.round(value || 0), 0)}%`;

const isSameLocalDay = (value: string | null | undefined, date: Date) => {
  if (!value) {
    return false;
  }

  const parsed = new Date(value);
  return parsed.getFullYear() === date.getFullYear()
    && parsed.getMonth() === date.getMonth()
    && parsed.getDate() === date.getDate();
};

const formatClassTime = (value: string) =>
  new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(value));

const getCourseSubtitle = (course: CourseCard) =>
  [course.exam, course.subject].filter(Boolean).join(' | ') || course.category || course.level || 'Course';

const getCompletedLessonCount = (course: CourseCard) =>
  (course.lessonProgress || []).filter((entry) => entry.completed || Number(entry.progressPercent || 0) >= 90).length;

const getCourseQuestionCount = (tests: MockTest[], course: CourseCard) =>
  tests
    .filter((test) => {
      const haystack = [test.course, test.category, test.title, test.description].join(' ').toLowerCase();
      return haystack.includes(course._id.toLowerCase())
        || (course.exam && haystack.includes(course.exam.toLowerCase()))
        || (course.category && haystack.includes(course.category.toLowerCase()));
    })
    .reduce((sum, test) => sum + (test.questions?.length || 0), 0);

const Avatar = ({ name }: { name: string }) => {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'U';

  return (
    <div className="flex h-full w-full items-center justify-center rounded-full bg-[#e9f1ff] text-[13px] font-semibold text-[#2454b8]">
      {initials}
    </div>
  );
};

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <p className="text-[15px] font-semibold text-[#1f2d4e]">{children}</p>
);

const EmptyState = ({
  title,
  body,
  action,
  onClick,
}: {
  title: string;
  body: string;
  action?: string;
  onClick?: () => void;
}) => (
  <div className="rounded-[16px] border border-dashed border-[#dbe5f3] bg-[#f8fbff] px-[14px] py-[14px]">
    <p className="text-[14px] font-semibold text-[#1f2d4e]">{title}</p>
    <p className="mt-[6px] text-[13px] leading-6 text-[#667895]">{body}</p>
    {action && onClick && (
      <button
        type="button"
        onClick={onClick}
        className="mt-[10px] inline-flex items-center gap-1 text-[13px] font-semibold text-[#2f6fe4]"
      >
        {action}
        <ChevronRight className="h-4 w-4" />
      </button>
    )}
  </div>
);

const CourseIcon = ({
  tone,
  children,
}: {
  tone: 'blue' | 'green' | 'purple';
  children: React.ReactNode;
}) => {
  const palette = {
    blue: 'bg-[#ecf3ff] text-[#2f6fe4]',
    green: 'bg-[#e9f8ee] text-[#28a45e]',
    purple: 'bg-[#f3efff] text-[#6a58d6]',
  } as const;

  return (
    <div className={`flex h-[42px] w-[42px] items-center justify-center rounded-[12px] ${palette[tone]}`}>
      {children}
    </div>
  );
};

const ProgressRing = ({ value }: { value: number }) => {
  const percent = Math.max(Math.min(Math.round(value || 0), 100), 0);
  const background = `conic-gradient(#2f6fe4 ${percent * 3.6}deg, #d9e7ff 0deg)`;

  return (
    <div className="flex flex-col items-center">
      <div className="relative flex h-[90px] w-[90px] items-center justify-center rounded-full" style={{ background }}>
        <div className="flex h-[64px] w-[64px] items-center justify-center rounded-full bg-white text-[18px] font-semibold text-[#1f2d4e]">
          {percent}%
        </div>
      </div>
      <p className="mt-[10px] text-[13px] font-medium text-[#536682]">Course progress</p>
    </div>
  );
};

const ActiveMetric = ({ value, label }: { value: string; label: string }) => (
  <div className="min-w-0 border-r border-[#eef2f8] pr-[18px] last:border-r-0 last:pr-0">
    <p className="text-[13px] font-semibold leading-none text-[#1f2d4e]">{value}</p>
    <p className="mt-[8px] text-[12px] leading-none text-[#7b879d]">{label}</p>
  </div>
);

const ActiveCoursePanel = ({
  course,
  tests,
  iconTone,
  icon,
  testId,
  onClick,
}: {
  course: CourseCard;
  tests: MockTest[];
  iconTone: 'blue' | 'green';
  icon: React.ReactNode;
  testId: string;
  onClick: () => void;
}) => {
  const progressPercent = Math.max(Math.min(Math.round(course.progressPercent || 0), 100), 0);
  const completedLessons = getCompletedLessonCount(course);

  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className="flex min-w-0 flex-col text-left"
    >
      <div className="flex items-start gap-[14px]">
        <CourseIcon tone={iconTone}>{icon}</CourseIcon>
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold text-[#1f2d4e]">{course.title}</p>
          <p className="mt-[4px] truncate text-[14px] text-[#6d7c93]">{getCourseSubtitle(course)}</p>
        </div>
      </div>

      <div className="mt-[18px] flex items-center justify-between gap-3">
        <p className="text-[12px] font-medium text-[#6d7c93]">{formatPercent(progressPercent)} complete</p>
        <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#2f6fe4]">
          Continue
          <ChevronRight className="h-4 w-4" />
        </span>
      </div>

      <div className="mt-[8px] h-[6px] rounded-full bg-[#edf2f9]">
        <div className="h-full rounded-full bg-[#2f6fe4]" style={{ width: `${Math.max(progressPercent, progressPercent > 0 ? 4 : 0)}%` }} />
      </div>

      <div className="mt-[18px] grid grid-cols-3 gap-[18px]">
        <ActiveMetric value={formatNumber(completedLessons)} label="Done" />
        <ActiveMetric value={formatNumber(course.lessonCount || 0)} label="Lessons" />
        <ActiveMetric value={formatNumber(getCourseQuestionCount(tests, course))} label="Questions" />
      </div>
    </button>
  );
};

const BottomLink = ({
  label,
  onClick,
  testId,
}: {
  label: string;
  onClick?: () => void;
  testId?: string;
}) => (
  <button
    type="button"
    data-testid={testId}
    onClick={onClick}
    className="mt-[16px] flex w-full items-center justify-between border-t border-[#eef2f7] pt-[12px] text-[13px] font-semibold text-[#2f6fe4]"
  >
    <span>{label}</span>
    <ChevronRight className="h-4 w-4" />
  </button>
);

const HeroArtwork = () => (
  <div className="absolute inset-0 bg-[#eef4ff]">
    <div className="absolute inset-x-0 bottom-0 h-[46%] bg-[#ddeaff]" />
    <div className="absolute -right-[52px] top-[24px] h-[138px] w-[138px] rounded-full bg-white/58" />
    <div className="absolute bottom-[30px] left-[160px] h-[18px] w-[72%] rounded-full bg-[#c8dcff]/70" />
  </div>
);

const ClassItem = ({ item, onOpenLiveTab }: { item: LiveClass; onOpenLiveTab?: () => void }) => {
  const isLive = item.status === 'live';

  return (
    <div className="relative pb-[18px] last:pb-0">
      <span className={`absolute -left-[18px] top-[2px] h-[12px] w-[12px] rounded-full border-[3px] bg-white ${isLive ? 'border-[#ee4f74]' : 'border-[#8a97ab]'}`} />
      <div className="flex items-start justify-between gap-[10px]">
        <div className="min-w-0">
          <div className="flex items-center gap-[8px]">
            {isLive && <span className="rounded-full bg-[#ff5b6d] px-[8px] py-[2px] text-[10px] font-semibold uppercase text-white">Live</span>}
            <p className="truncate text-[13px] font-semibold text-[#1f2d4e]">{item.title}</p>
          </div>
          <p className="mt-[8px] text-[13px] text-[#5f7096]">{item.instructor || item.topicTags?.[0] || 'Live class'}</p>
          <p className="mt-[8px] text-[12px] text-[#7b879d]">{formatClassTime(item.startTime)} | {item.durationMinutes} min</p>
        </div>
        <button
          type="button"
          data-testid={isLive ? 'overview-join-now-button' : undefined}
          onClick={onOpenLiveTab}
          className="shrink-0 text-[13px] font-semibold text-[#2f6fe4]"
        >
          {isLive ? 'Join' : 'Open'}
        </button>
      </div>
    </div>
  );
};

export const OverviewFigmaTab = ({
  overview,
  onContinueLearning,
  onOpenLiveTab,
  onOpenTestsTab,
  onOpenRevisionTab,
  onOpenCoursesTab,
  onOpenNotification,
}: OverviewFigmaTabProps) => {
  const [isMobileLayout, setIsMobileLayout] = useState(false);

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

  const today = useMemo(() => new Date(), []);
  const learnerName = overview.user?.name || 'Learner';
  const activeCourses = useMemo(
    () => overview.courses
      .filter((course) => course.enrolled)
      .sort((left, right) => Number(right.progressPercent || 0) - Number(left.progressPercent || 0)),
    [overview.courses],
  );
  const heroCourse = overview.dashboard.continueLearning[0] || activeCourses[0] || null;
  const secondaryCourse = activeCourses.find((course) => course._id !== heroCourse?._id) || null;
  const activeCourseCards = [heroCourse, secondaryCourse].filter(Boolean) as CourseCard[];
  const todayClasses = useMemo(
    () => overview.liveClasses
      .filter((item) => ['live', 'scheduled'].includes(String(item.status || 'scheduled')) && isSameLocalDay(item.startTime, today))
      .sort((left, right) => new Date(left.startTime).getTime() - new Date(right.startTime).getTime())
      .slice(0, 2),
    [overview.liveClasses, today],
  );
  const availableTest = overview.testSeries[0] || null;
  const latestMock = overview.dashboard.latestMockTest;
  const scorePercent = latestMock?.totalMarks ? Math.round((latestMock.score / latestMock.totalMarks) * 100) : 0;
  const revisionTopics = (overview.analytics.weakTopics.length > 0 ? overview.analytics.weakTopics : []).slice(0, 2);
  const availableCbtCount = useMemo(
    () => overview.courses.reduce((count, course) => (
      count + (course.modules || []).reduce((moduleCount, module) => (
        moduleCount
        + (module.lessons || []).filter((lesson) => lesson.cbt?.questions?.length).length
        + (module.chapters || []).reduce((chapterCount, chapter) => (
          chapterCount + (chapter.lessons || []).filter((lesson) => lesson.cbt?.questions?.length).length
        ), 0)
      ), 0)
    ), 0),
    [overview.courses],
  );
  const recommendation = overview.analytics.attempts > 0
    ? overview.analytics.suggestions[0] || overview.analytics.adaptivePlan.reason
    : null;

  const openCourse = (course: CourseCard | null) => {
    if (!course) {
      return;
    }

    onContinueLearning(course._id, course.continueLesson?.id || null);
  };

  const renderHeader = () => (
    <div data-testid="overview-topbar" className="flex items-start justify-between gap-[16px]">
      <div className="min-w-0">
        <p className="text-[15px] font-semibold text-[#202a44]">Welcome back, {learnerName}</p>
        <p className="mt-[8px] text-[14px] text-[#7b879d]">Your dashboard is based on live course, test, and class activity.</p>
      </div>

      <div className="flex items-center gap-[12px] self-start">
        <div className="flex h-[38px] w-[38px] items-center justify-center overflow-hidden rounded-full border border-[#e2e8f2] bg-white shadow-[0_6px_16px_rgba(28,41,61,0.05)]">
          <Avatar name={learnerName} />
        </div>

        <button
          type="button"
          data-testid="overview-notification-button"
          onClick={() => {
            const firstNotification = overview.notifications[0];
            if (firstNotification) {
              onOpenNotification?.(firstNotification);
            }
          }}
          className="relative flex h-[38px] w-[38px] items-center justify-center rounded-full border border-[#e2e8f2] bg-white text-[#79869b] shadow-[0_6px_16px_rgba(28,41,61,0.05)]"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" />
          {overview.notifications.length > 0 && (
            <span className="absolute -right-[3px] -top-[3px] flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-[#2f6fe4] px-[4px] text-[9px] font-semibold leading-none text-white">
              {overview.notifications.length}
            </span>
          )}
        </button>
      </div>
    </div>
  );

  const renderHero = () => (
    <section
      data-testid="overview-hero"
      className="relative overflow-hidden rounded-[18px] border border-[#e7edf6] bg-[#edf4ff] shadow-[0_10px_28px_rgba(28,41,61,0.06)]"
    >
      <HeroArtwork />
      <div className="relative z-10 flex min-h-[190px] items-start justify-between gap-6 px-[20px] py-[20px]">
        <div className="max-w-[520px]">
          <div className="flex items-center gap-[10px] text-[14px] font-semibold text-[#34547d]">
            <span>{heroCourse ? 'Continue learning' : 'Learning workspace'}</span>
            {heroCourse && (
              <span className="rounded-[6px] bg-[#e3eeff] px-[6px] py-[1px] text-[12px] font-semibold text-[#2f6fe4]">
                {formatPercent(heroCourse.progressPercent || 0)}
              </span>
            )}
          </div>

          <p className="mt-[12px] text-[20px] font-bold leading-[1.35] tracking-[-0.02em] text-[#1f2d4e]">
            {heroCourse?.title || 'No active course yet'}
          </p>

          <p className="mt-[10px] max-w-[460px] text-[14px] leading-[1.65] text-[#50627d]">
            {heroCourse?.continueLesson
              ? `Next lesson: ${heroCourse.continueLesson.title}`
              : heroCourse
                ? getCourseSubtitle(heroCourse)
                : 'Enroll in a course to start tracking lessons, progress, tests, and live classes here.'}
          </p>

          {heroCourse && (
            <button
              type="button"
              data-testid="overview-continue-cta"
              onClick={() => openCourse(heroCourse)}
              className="mt-[16px] inline-flex h-[40px] min-w-[160px] items-center justify-between rounded-[10px] bg-[#2f6fe4] px-[16px] text-[13px] font-semibold text-white shadow-[0_10px_20px_rgba(47,111,228,0.2)]"
            >
              Continue
              <ChevronRight className="h-4 w-4" />
            </button>
          )}
        </div>

        {heroCourse && (
          <div className="hidden shrink-0 pt-[8px] lg:block">
            <ProgressRing value={heroCourse.progressPercent || 0} />
          </div>
        )}
      </div>
    </section>
  );

  const renderCourses = () => (
    <section data-testid="overview-active-courses" className="space-y-[10px]">
      <SectionTitle>Active Courses</SectionTitle>
      {activeCourseCards.length === 0 ? (
        <EmptyState title="No active courses" body="Paid and free course enrollments will appear here after the learner is enrolled." />
      ) : (
        <div className="grid grid-cols-1 rounded-[18px] border border-[#edf1f7] bg-white shadow-[0_10px_28px_rgba(28,41,61,0.06)] lg:grid-cols-2">
          {activeCourseCards.map((course, index) => (
            <div key={course._id} className="px-[18px] py-[18px] lg:border-r lg:border-[#eef2f8] lg:last:border-r-0">
              <ActiveCoursePanel
                testId={`overview-active-course-card-${index}`}
                course={course}
                tests={overview.testSeries}
                iconTone={index === 0 ? 'blue' : 'green'}
                icon={index === 0 ? <BookOpen className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
                onClick={() => openCourse(course)}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );

  const renderPerformance = () => (
    <section data-testid="overview-signals" className="space-y-[10px]">
      <SectionTitle>Performance Overview</SectionTitle>
      <div className="grid grid-cols-1 rounded-[18px] border border-[#edf1f7] bg-white shadow-[0_10px_28px_rgba(28,41,61,0.06)] lg:grid-cols-[minmax(0,1.08fr)_330px]">
        <div data-testid="overview-streak" className="px-[18px] py-[16px] lg:border-r lg:border-[#eef2f8]">
          <div className="flex items-start gap-[12px]">
            <CourseIcon tone="green">
              <Activity className="h-5 w-5" />
            </CourseIcon>
            <div>
              <p className="text-[14px] font-semibold text-[#1f2d4e]">Learning Activity</p>
              <div className="mt-[12px] space-y-[10px]">
                <div className="flex items-center gap-[10px] text-[13px] text-[#6d7c93]">
                  <ClipboardList className="h-4 w-4 text-[#9aa8bb]" />
                  <span>{availableCbtCount > 0 ? `${availableCbtCount} CBT${availableCbtCount > 1 ? 's' : ''} available` : 'No CBT published yet'}</span>
                </div>
                <div className="flex items-center gap-[10px] text-[13px] text-[#6d7c93]">
                  <CalendarClock className="h-4 w-4 text-[#f0b557]" />
                  <span>{todayClasses.length > 0 ? `${todayClasses.length} class${todayClasses.length > 1 ? 'es' : ''} today` : 'No live classes scheduled today'}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-[18px] flex items-center justify-between gap-3">
            <p className="text-[13px] text-[#6d7c93]">{formatNumber(overview.dashboard.streak)} day streak</p>
            <button
              type="button"
              data-testid="overview-streak-continue-button"
              onClick={onOpenCoursesTab}
              className="inline-flex items-center gap-1 text-[13px] font-semibold text-[#2f6fe4]"
            >
              Open Courses
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div data-testid="overview-score-summary" className="px-[18px] py-[16px]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[12px] text-[#6d7c93]">Accuracy</p>
              <p className="mt-[6px] text-[16px] font-semibold text-[#1f2d4e]">{formatPercent(overview.analytics.accuracy)}</p>
            </div>
            <div className="text-right">
              <p className="text-[12px] text-[#6d7c93]">Attempts</p>
              <p className="mt-[6px] text-[16px] font-semibold text-[#1f2d4e]">{formatNumber(overview.analytics.attempts)}</p>
            </div>
          </div>

          <div className="mt-[16px] h-[6px] rounded-full bg-[#dfe8f7]">
            <div className="h-full rounded-full bg-[#2f6fe4]" style={{ width: `${Math.max(Math.min(overview.analytics.accuracy, 100), 0)}%` }} />
          </div>

          <div className="mt-[14px] flex items-center justify-between gap-3">
            <p className="text-[12px] text-[#6d7c93]">Reward points</p>
            <p className="text-[13px] font-medium text-[#1f2d4e]">{formatNumber(overview.dashboard.points)}</p>
          </div>
        </div>
      </div>
    </section>
  );

  const renderRecommendation = () => (
    <section className="space-y-[10px]">
      <SectionTitle>Recommended Track</SectionTitle>
      {recommendation ? (
        <div
          data-testid="overview-recommendation"
          className="flex items-center justify-between gap-[18px] rounded-[18px] border border-[#edf1f7] bg-white px-[18px] py-[14px] shadow-[0_10px_28px_rgba(28,41,61,0.06)]"
        >
          <div className="flex min-w-0 items-center gap-[14px]">
            <CourseIcon tone="purple">
              <Target className="h-5 w-5" />
            </CourseIcon>
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-[#1f2d4e]">{overview.analytics.adaptivePlan.nextTestType} practice</p>
              <p className="mt-[4px] text-[13px] leading-6 text-[#6d7c93]">{recommendation}</p>
            </div>
          </div>

          <button
            type="button"
            data-testid="overview-review-now-button"
            onClick={onOpenRevisionTab}
            className="inline-flex shrink-0 items-center gap-1 text-[13px] font-semibold text-[#2f6fe4]"
          >
            Review
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <EmptyState title="No recommendation yet" body="Recommendations are generated after CBT or mock-test activity is available." action="Open tests" onClick={onOpenTestsTab} />
      )}
    </section>
  );

  const renderRevision = () => (
    <section className="space-y-[10px]">
      <SectionTitle>Quick Revision</SectionTitle>
      {revisionTopics.length === 0 ? (
        <EmptyState title="No weak topics yet" body="Weak-topic shortcuts will appear after completed CBTs or mock tests." action="Open Courses" onClick={onOpenCoursesTab} />
      ) : (
        <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
          {revisionTopics.map((topic, index) => (
            <button
              key={topic}
              type="button"
              data-testid={`overview-revision-shortcut-${index}`}
              onClick={onOpenRevisionTab}
              className="flex h-[58px] items-center justify-between rounded-[14px] border border-[#edf1f7] bg-white px-[14px] shadow-[0_6px_18px_rgba(28,41,61,0.05)]"
            >
              <div className="flex items-center gap-[12px]">
                <CourseIcon tone={index === 0 ? 'blue' : 'green'}>
                  <BookOpen className="h-4 w-4" />
                </CourseIcon>
                <div className="text-left">
                  <p className="text-[13px] font-semibold text-[#1f2d4e]">{topic}</p>
                  <p className="mt-[3px] text-[12px] text-[#7b879d]">Needs attention</p>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-[#8fa0b8]" />
            </button>
          ))}
        </div>
      )}
    </section>
  );

  const renderLiveSchedule = () => (
    <section
      data-testid="overview-upcoming-classes"
      className="rounded-[18px] border border-[#edf1f7] bg-white px-[20px] py-[18px] shadow-[0_10px_28px_rgba(28,41,61,0.06)]"
    >
      <p className="text-[15px] font-semibold text-[#1f2d4e]">Today&apos;s Schedule</p>
      {todayClasses.length === 0 ? (
        <div className="mt-[16px]">
          <EmptyState title="No classes today" body="Published live classes for today will appear here automatically." />
        </div>
      ) : (
        <div className="relative mt-[18px] pl-[18px]">
          <div className="absolute bottom-[20px] left-[6px] top-[8px] w-px bg-[#ebeff6]" />
          {todayClasses.map((item) => (
            <ClassItem key={item._id} item={item} onOpenLiveTab={onOpenLiveTab} />
          ))}
        </div>
      )}
      <BottomLink label="View timetable" onClick={onOpenLiveTab} testId="overview-view-timetable-button" />
    </section>
  );

  const renderTests = () => (
    <section
      data-testid="overview-upcoming-tests"
      className="rounded-[18px] border border-[#edf1f7] bg-white px-[20px] py-[18px] shadow-[0_10px_28px_rgba(28,41,61,0.06)]"
    >
      <p className="text-[15px] font-semibold text-[#1f2d4e]">Tests</p>
      {availableTest ? (
        <div className="mt-[18px]">
          <div className="flex items-start gap-[12px]">
            <CourseIcon tone="blue">
              <ClipboardList className="h-5 w-5" />
            </CourseIcon>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-semibold text-[#1f2d4e]">{availableTest.title}</p>
              <p className="mt-[4px] text-[12px] text-[#7b879d]">{availableTest.questions.length} questions | {availableTest.durationMinutes} min</p>
            </div>
          </div>

          <div className="mt-[14px] flex items-end justify-between gap-3">
            <p className="text-[13px] text-[#7b879d]">{availableTest.type || availableTest.category}</p>
            <button
              type="button"
              data-testid="overview-attempt-now-button"
              onClick={onOpenTestsTab}
              className="text-[13px] font-semibold text-[#2f6fe4]"
            >
              Open
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-[16px]">
          <EmptyState title="No tests published" body="Admin-created mock tests will appear here when available." />
        </div>
      )}
      <BottomLink label="View all tests" onClick={onOpenTestsTab} />
    </section>
  );

  const renderProgress = () => (
    <section
      data-testid="overview-score-card"
      className="rounded-[18px] border border-[#edf1f7] bg-white px-[20px] py-[18px] shadow-[0_10px_28px_rgba(28,41,61,0.06)]"
    >
      <p className="text-[15px] font-semibold text-[#1f2d4e]">Latest Result</p>
      {latestMock ? (
        <>
          <div className="mt-[16px] flex items-start justify-between gap-4">
            <div>
              <p className="text-[12px] text-[#6d7c93]">Score</p>
              <p className="mt-[4px] text-[16px] font-semibold text-[#1f2d4e]">{formatNumber(latestMock.score)}/{formatNumber(latestMock.totalMarks)}</p>
            </div>
            <div className="text-right">
              <p className="text-[12px] text-[#6d7c93]">Rank</p>
              <p className="mt-[4px] text-[16px] font-semibold text-[#1f2d4e]">#{formatNumber(latestMock.rank)}</p>
            </div>
          </div>

          <div className="mt-[14px] h-[6px] rounded-full bg-[#dfe8f7]">
            <div className="h-full rounded-full bg-[#2f6fe4]" style={{ width: `${scorePercent}%` }} />
          </div>

          <div className="mt-[12px] flex items-center justify-between gap-3">
            <p className="text-[12px] text-[#6d7c93]">Accuracy</p>
            <p className="text-[13px] font-medium text-[#1f2d4e]">{formatPercent(scorePercent)}</p>
          </div>
        </>
      ) : (
        <div className="mt-[16px]">
          <EmptyState title="No test result yet" body="Submitted mock-test results will appear here with score, rank, and accuracy." action="Open tests" onClick={onOpenTestsTab} />
        </div>
      )}
    </section>
  );

  const renderSession = () => (
    <section className="rounded-[18px] border border-[#edf1f7] bg-white px-[20px] py-[16px] shadow-[0_10px_28px_rgba(28,41,61,0.06)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[15px] font-semibold text-[#1f2d4e]">Session Status</p>
          <p className="mt-[8px] text-[12px] leading-[1.6] text-[#7b879d]">
            {overview.sessionActivity
              ? `${overview.sessionActivity.activeSessions} active session${overview.sessionActivity.activeSessions === 1 ? '' : 's'}`
              : 'Sign in to track session activity.'}
          </p>
        </div>
        <CourseIcon tone="purple">
          <Radio className="h-5 w-5" />
        </CourseIcon>
      </div>
    </section>
  );

  if (isMobileLayout) {
    return (
      <div
        data-testid="overview-dashboard"
        className="min-h-[100dvh] w-full overflow-x-hidden overflow-y-auto bg-[#f4f7ff] pb-[96px]"
        style={{ fontFamily: overviewFontStack }}
      >
        <div className="space-y-[18px] px-[14px] pb-[18px] pt-[14px]">
          {renderHeader()}
          {renderHero()}
          {renderCourses()}
          {renderPerformance()}
          {renderRecommendation()}
          {renderRevision()}
          <div data-testid="overview-action-queue" className="grid grid-cols-1 gap-[12px]">
            {renderLiveSchedule()}
            {renderTests()}
            {renderProgress()}
            {renderSession()}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="overview-dashboard"
      className="flex h-dvh min-h-dvh w-full flex-1 overflow-x-hidden overflow-y-auto bg-[#fcfdff] lg:overflow-hidden"
      style={{ fontFamily: overviewFontStack }}
    >
      <div className="flex w-full flex-1 flex-col px-[24px] pb-[18px] pt-[20px] lg:px-[32px] lg:pb-[18px] lg:pt-[18px]">
        {renderHeader()}
        <div className="mt-[18px] grid min-h-0 flex-1 grid-cols-1 gap-[16px] lg:grid-cols-[minmax(0,1fr)_292px]">
          <div className="min-w-0 space-y-[14px]">
            {renderHero()}
            {renderCourses()}
            {renderPerformance()}
            {renderRecommendation()}
            {renderRevision()}
          </div>

          <aside data-testid="overview-action-queue" className="space-y-[14px]">
            {renderLiveSchedule()}
            {renderTests()}
            {renderProgress()}
            {renderSession()}
          </aside>
        </div>
      </div>
    </div>
  );
};
