import React, { useEffect, useMemo, useState } from 'react';
import {
  Bell,
  BookOpen,
  CalendarClock,
  ChevronRight,
  ClipboardList,
  FileText,
  Home,
  Search,
} from 'lucide-react';
import { NotificationItem, PlatformOverview } from '../types';

type OverviewFigmaTabProps = {
  overview: PlatformOverview;
  onContinueLearning: (courseId: string, lessonId?: string | null) => void;
  onOpenLiveTab?: () => void;
  onOpenTestsTab?: () => void;
  onOpenRevisionTab?: () => void;
  onOpenQuizTab?: () => void;
  onOpenNotification?: (notification: NotificationItem) => void;
};

const overviewFontStack = 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

const AvatarArt = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" className="h-full w-full">
    <defs>
      <linearGradient id="overviewAvatarBg" x1="10" y1="8" x2="54" y2="56" gradientUnits="userSpaceOnUse">
        <stop stopColor="#dbe8fb" />
        <stop offset="1" stopColor="#78ace9" />
      </linearGradient>
      <linearGradient id="overviewAvatarFace" x1="22" y1="18" x2="42" y2="42" gradientUnits="userSpaceOnUse">
        <stop stopColor="#f9d2b3" />
        <stop offset="1" stopColor="#e6ad86" />
      </linearGradient>
    </defs>
    <rect width="64" height="64" rx="32" fill="url(#overviewAvatarBg)" />
    <circle cx="32" cy="29" r="13" fill="url(#overviewAvatarFace)" />
    <path d="M16 23c2-10 10-16 16-16s14 5 16 16c-4-2-9-4-16-4s-12 2-16 4z" fill="#294676" />
    <path d="M18 55c3-11 9-17 14-17s11 6 14 17" fill="#355789" />
    <path d="M23 27c3 2 6 3 9 3 3 0 6-1 9-3" stroke="#294676" strokeWidth="2" strokeLinecap="round" />
    <circle cx="27" cy="29" r="1.3" fill="#294676" />
    <circle cx="37" cy="29" r="1.3" fill="#294676" />
    <path d="M28 35c1.5 1.2 6.5 1.2 8 0" stroke="#d68f72" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

const HeroArtwork = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 240" fill="none" className="h-full w-full">
    <defs>
      <linearGradient id="overviewHeroFill" x1="0" y1="0" x2="1000" y2="240" gradientUnits="userSpaceOnUse">
        <stop stopColor="#eef4ff" />
        <stop offset="1" stopColor="#ddeaff" />
      </linearGradient>
      <linearGradient id="overviewHeroWave" x1="0" y1="140" x2="1000" y2="232" gradientUnits="userSpaceOnUse">
        <stop stopColor="#b8d4ff" stopOpacity="0.34" />
        <stop offset="1" stopColor="#8cbcff" stopOpacity="0.2" />
      </linearGradient>
    </defs>
    <rect width="1000" height="240" rx="18" fill="url(#overviewHeroFill)" />
    <circle cx="888" cy="72" r="56" fill="#dfeaff" />
    <circle cx="888" cy="72" r="42" fill="#f4f8ff" />
    <path d="M0 196C124 180 230 176 334 182C454 190 572 204 694 204C806 204 900 194 1000 182V240H0V196Z" fill="url(#overviewHeroWave)" />
    <path d="M0 206C124 190 228 188 334 194C454 202 572 216 694 216C806 216 900 206 1000 196" stroke="#b1ccfb" strokeWidth="2" />
    <path d="M192 178C304 154 430 150 542 160C652 170 768 186 1000 170" stroke="#d2e3ff" strokeWidth="18" strokeLinecap="round" />
  </svg>
);

const ProgressRing = () => (
  <div className="flex flex-col items-center">
    <div className="relative h-[90px] w-[90px] rounded-full border-[7px] border-[#d9e7ff] bg-[#f4f8ff]">
      <div className="absolute inset-[12px] flex items-center justify-center rounded-full bg-white text-[18px] font-semibold text-[#1f2d4e]">
        0%
      </div>
    </div>
    <p className="mt-[10px] text-[13px] font-medium text-[#536682]">Course Progress</p>
  </div>
);

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <p className="text-[15px] font-semibold text-[#1f2d4e]">{children}</p>
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

const ActiveMetric = ({
  value,
  label,
}: {
  value: string;
  label: string;
}) => (
  <div className="min-w-0 border-r border-[#eef2f8] pr-[18px] last:border-r-0 last:pr-0">
    <p className="text-[13px] font-semibold leading-none text-[#1f2d4e]">{value}</p>
    <p className="mt-[8px] text-[12px] leading-none text-[#7b879d]">{label}</p>
  </div>
);

const ActiveCoursePanel = ({
  iconTone,
  icon,
  title,
  subtitle,
  progressLabel,
  progressWidth,
  progressTone,
  metrics,
  testId,
  onClick,
}: {
  iconTone: 'blue' | 'green';
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  progressLabel: string;
  progressWidth: string;
  progressTone: string;
  metrics: Array<{ value: string; label: string }>;
  testId: string;
  onClick: () => void;
}) => (
  <button
    type="button"
    data-testid={testId}
    onClick={onClick}
    className="flex min-w-0 flex-col text-left"
  >
    <div className="flex items-start gap-[14px]">
      <CourseIcon tone={iconTone}>{icon}</CourseIcon>
      <div className="min-w-0">
        <p className="text-[15px] font-semibold text-[#1f2d4e]">{title}</p>
        <p className="mt-[4px] text-[14px] text-[#6d7c93]">{subtitle}</p>
      </div>
    </div>

    <div className="mt-[18px] flex items-center justify-between gap-3">
      <p className="text-[12px] font-medium text-[#6d7c93]">{progressLabel}</p>
      <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#2f6fe4]">
        Continue
        <ChevronRight className="h-4 w-4" />
      </span>
    </div>

    <div className="mt-[8px] h-[6px] rounded-full bg-[#edf2f9]">
      <div className={`h-full rounded-full ${progressTone}`} style={{ width: progressWidth }} />
    </div>

    <div className="mt-[18px] grid grid-cols-3 gap-[18px]">
      {metrics.map((metric) => (
        <ActiveMetric key={`${metric.label}-${metric.value}`} value={metric.value} label={metric.label} />
      ))}
    </div>
  </button>
);

const QuickRevisionCard = ({
  tone,
  title,
  onClick,
  testId,
}: {
  tone: 'blue' | 'green';
  title: string;
  onClick?: () => void;
  testId: string;
}) => {
  const palette = tone === 'green'
    ? 'bg-[#ecfbf0] text-[#27a75f]'
    : 'bg-[#eef4ff] text-[#2f6fe4]';

  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className="flex h-[58px] items-center justify-between rounded-[14px] border border-[#edf1f7] bg-white px-[14px] shadow-[0_6px_18px_rgba(28,41,61,0.05)]"
    >
      <div className="flex items-center gap-[12px]">
        <div className={`flex h-[28px] w-[28px] items-center justify-center rounded-[8px] ${palette}`}>
          <Home className="h-4 w-4" />
        </div>
        <div className="text-left">
          <p className="text-[13px] font-semibold text-[#1f2d4e]">{title}</p>
          <p className="mt-[3px] text-[12px] text-[#7b879d]">Start revision</p>
        </div>
      </div>
      <ChevronRight className="h-4 w-4 text-[#8fa0b8]" />
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

const MiniTestBadge = () => (
  <div className="flex h-[38px] w-[38px] items-center justify-center rounded-[12px] bg-[#eef4ff]">
    <div className="flex h-[26px] w-[26px] flex-col overflow-hidden rounded-[8px] bg-white shadow-[0_6px_14px_rgba(47,111,228,0.14)]">
      <div className="h-[7px] bg-[#2f6fe4]" />
      <div className="flex flex-1 items-center justify-center text-[11px] font-semibold text-[#2f6fe4]">
        32
      </div>
    </div>
  </div>
);

const ConsistencySparkline = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 90 34" fill="none" className="h-[34px] w-[90px]">
    <path d="M1 24C9 24 12 10 20 10C28 10 31 26 40 26C48 26 51 7 59 7C67 7 70 20 78 20C84 20 87 10 89 7" stroke="#61c289" strokeWidth="2.4" strokeLinecap="round" />
    <circle cx="20" cy="10" r="2.4" fill="#61c289" />
    <circle cx="59" cy="7" r="2.4" fill="#61c289" />
  </svg>
);

export const OverviewFigmaTab = ({
  overview,
  onContinueLearning,
  onOpenLiveTab,
  onOpenTestsTab,
  onOpenRevisionTab,
  onOpenQuizTab,
  onOpenNotification,
}: OverviewFigmaTabProps) => {
  const learnerName = 'Abuw Singh';
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

  const heroCourse = useMemo(
    () =>
      overview.courses.find((course) =>
        /ssc je 2026 electrical power track/i.test(course.title) || /ssc je/i.test(course.exam || ''),
      ) || overview.courses[0] || null,
    [overview.courses],
  );

  const rrbCourse = useMemo(
    () =>
      overview.courses.find((course) => /rrb je/i.test(course.title) || /rrb je/i.test(course.exam || '')) ||
      overview.courses[1] ||
      heroCourse,
    [heroCourse, overview.courses],
  );

  const openHeroCourse = () => {
    if (!heroCourse) {
      return;
    }

    onContinueLearning(heroCourse._id, heroCourse.continueLesson?.id || null);
  };

  const openRrbCourse = () => {
    if (!rrbCourse) {
      return;
    }

    onContinueLearning(rrbCourse._id, rrbCourse.continueLesson?.id || null);
  };

  const renderMobileOverview = () => (
    <div
      data-testid="overview-dashboard"
      className="min-h-[100dvh] w-full overflow-x-hidden overflow-y-auto bg-[#f4f7ff] pb-[96px]"
      style={{ fontFamily: overviewFontStack }}
    >
      <div className="px-[14px] pb-[18px] pt-[10px]">
        <div className="flex items-center justify-between text-[12px] font-semibold text-[#101828]">
          <span>9:41</span>
          <div className="flex items-center gap-[5px]">
            <span className="h-[7px] w-[5px] rounded-[2px] bg-[#101828]" />
            <span className="h-[9px] w-[5px] rounded-[2px] bg-[#101828]" />
            <span className="h-[11px] w-[5px] rounded-[2px] bg-[#101828]" />
            <span className="ml-[4px] h-[10px] w-[12px] rounded-[3px] border border-[#101828]" />
          </div>
        </div>

        <div data-testid="overview-topbar" className="mt-[14px]">
          <div className="flex items-start justify-between gap-[12px]">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] leading-[1.25] text-[#3f557a]">Welcome back,</p>
              <p className="mt-[4px] text-[20px] font-semibold leading-[1.18] text-[#152647]">
                {learnerName} 👋
              </p>
              <p className="mt-[6px] max-w-[180px] text-[13px] leading-[1.45] text-[#7283a0]">
                Let&apos;s continue your learning journey.
              </p>
            </div>

            <div className="flex shrink-0 items-start gap-[10px]">
              <button
                type="button"
                data-testid="overview-search-pill"
                className="flex h-[54px] w-[170px] max-w-[44vw] items-center gap-[10px] rounded-[16px] border border-[#dfe7f5] bg-white px-[14px] text-[14px] text-[#8a97ab] shadow-[0_8px_18px_rgba(28,41,61,0.05)]"
              >
                <Search className="h-[18px] w-[18px] shrink-0 text-[#7f91ae]" />
                <span className="truncate">Search anything...</span>
              </button>
              <button
                type="button"
                data-testid="overview-profile-avatar"
                className="flex h-[42px] w-[42px] items-center justify-center overflow-hidden rounded-full border border-[#dfe7f5] bg-white shadow-[0_8px_18px_rgba(28,41,61,0.06)]"
              >
                <AvatarArt />
              </button>
              <button
                type="button"
                data-testid="overview-notification-button"
                onClick={() => {
                  const firstNotification = overview.notifications[0];
                  if (firstNotification) {
                    onOpenNotification?.(firstNotification);
                  }
                }}
                className="relative flex h-[42px] w-[42px] items-center justify-center rounded-full border border-[#dfe7f5] bg-white text-[#5e7397] shadow-[0_8px_18px_rgba(28,41,61,0.06)]"
                aria-label="Notifications"
              >
                <Bell className="h-[20px] w-[20px]" />
                <span className="absolute right-[2px] top-[2px] flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-[#2f6fe4] px-[4px] text-[9px] font-semibold leading-none text-white">
                  {overview.notifications.length}
                </span>
              </button>
            </div>
          </div>
        </div>

        <section
          data-testid="overview-hero"
          className="relative mt-[18px] overflow-hidden rounded-[22px] border border-[#dfe7f5] bg-[#eaf1ff] shadow-[0_14px_30px_rgba(28,41,61,0.08)]"
        >
          <div className="absolute inset-0">
            <HeroArtwork />
          </div>
          <div className="relative z-10 px-[18px] py-[18px]">
            <div className="flex items-center justify-between gap-[12px]">
              <p className="text-[16px] font-semibold text-[#18315d]">Continue Learning</p>
              <span className="rounded-full border border-[#bfd4ff] bg-white/86 px-[10px] py-[4px] text-[13px] font-semibold text-[#2f6fe4]">
                0%
              </span>
            </div>

            <p className="mt-[12px] max-w-[220px] text-[18px] font-semibold leading-[1.28] tracking-[-0.02em] text-[#1a2f57]">
              SSC JE 2026 Electrical Power Track
            </p>
            <p className="mt-[10px] max-w-[230px] text-[14px] leading-[1.55] text-[#5b6f93]">
              Start one lesson, then build revision around what you actually study.
            </p>

            <button
              type="button"
              data-testid="overview-continue-cta"
              onClick={openHeroCourse}
              className="mt-[18px] inline-flex h-[46px] min-w-[172px] items-center justify-between rounded-[14px] bg-[#2f6fe4] px-[16px] text-[16px] font-semibold text-white shadow-[0_14px_28px_rgba(47,111,228,0.22)]"
            >
              Continue Learning
              <ChevronRight className="h-[18px] w-[18px]" />
            </button>
          </div>
        </section>

        <section data-testid="overview-active-courses" className="mt-[20px] space-y-[12px]">
          <div className="flex items-center justify-between gap-[10px]">
            <SectionTitle>Active Courses</SectionTitle>
            <button type="button" className="text-[14px] font-semibold text-[#2f6fe4]">View all</button>
          </div>
          <div className="grid grid-cols-2 gap-[12px]">
            <div className="rounded-[18px] border border-[#e5ebf7] bg-white px-[14px] py-[14px] shadow-[0_8px_18px_rgba(28,41,61,0.05)]">
              <ActiveCoursePanel
                testId="overview-active-course-card-0"
                iconTone="blue"
                icon={<BookOpen className="h-5 w-5" />}
                title="SSC JE 2026"
                subtitle="Electrical Power Track"
                progressLabel="0% Completed"
                progressWidth="4%"
                progressTone="bg-[#2f6fe4]"
                metrics={[
                  { value: '0', label: 'Lessons' },
                  { value: '0', label: 'Mock Tests' },
                  { value: '0', label: 'Questions' },
                ]}
                onClick={openHeroCourse}
              />
            </div>

            <div className="rounded-[18px] border border-[#e5ebf7] bg-white px-[14px] py-[14px] shadow-[0_8px_18px_rgba(28,41,61,0.05)]">
              <ActiveCoursePanel
                testId="overview-active-course-card-1"
                iconTone="green"
                icon={<FileText className="h-5 w-5" />}
                title="RRB JE"
                subtitle="Civil Fast Track"
                progressLabel="23% Completed"
                progressWidth="23%"
                progressTone="bg-[#27a75f]"
                metrics={[
                  { value: '118', label: 'Lessons' },
                  { value: '5', label: 'Mock Tests' },
                  { value: '1,442', label: 'Questions' },
                ]}
                onClick={openRrbCourse}
              />
            </div>
          </div>
        </section>

        <section data-testid="overview-signals" className="mt-[20px] space-y-[12px]">
          <div className="flex items-center justify-between gap-[10px]">
            <SectionTitle>Performance Overview</SectionTitle>
            <button
              type="button"
              data-testid="overview-streak-continue-button"
              onClick={() => {
                onOpenQuizTab?.();
              }}
              className="inline-flex items-center gap-[4px] text-[14px] font-semibold text-[#2f6fe4]"
            >
              Continue
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="overflow-hidden rounded-[18px] border border-[#e5ebf7] bg-white shadow-[0_8px_18px_rgba(28,41,61,0.05)]">
            <div className="grid grid-cols-[minmax(0,1fr)_156px]">
              <div data-testid="overview-streak" className="px-[16px] py-[16px]">
                <div className="flex items-start gap-[10px]">
                  <div className="flex h-[36px] w-[36px] items-center justify-center rounded-full bg-[#fff5eb] text-[18px]">🔥</div>
                  <div>
                    <p className="text-[15px] font-semibold text-[#1f2d4e]">Keep the Streak On</p>
                    <div className="mt-[10px] space-y-[8px]">
                      <div className="flex items-center gap-[8px] text-[13px] text-[#6d7c93]">
                        <ClipboardList className="h-4 w-4 text-[#9aa8bb]" />
                        <span>Daily quiz to keep your revision alive</span>
                      </div>
                      <div className="flex items-center gap-[8px] text-[13px] text-[#6d7c93]">
                        <CalendarClock className="h-4 w-4 text-[#f0b557]" />
                        <span>Next mock test in 4 days</span>
                      </div>
                    </div>
                  </div>
                </div>
                <p className="mt-[16px] text-[13px] text-[#6d7c93]">0 day streak</p>
              </div>

              <div data-testid="overview-score-summary" className="border-l border-[#eef2f8] px-[16px] py-[16px]">
                <div className="flex items-start justify-between gap-[10px]">
                  <div>
                    <p className="text-[12px] text-[#6d7c93]">Score</p>
                    <p className="mt-[6px] text-[16px] font-semibold text-[#1f2d4e]">167</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[12px] text-[#6d7c93]">Rank</p>
                    <p className="mt-[6px] text-[16px] font-semibold text-[#1f2d4e]">#96</p>
                  </div>
                </div>

                <div className="mt-[16px] h-[6px] rounded-full bg-[#dfe8f7]">
                  <div className="h-full w-[72%] rounded-full bg-[#2f6fe4]" />
                </div>

                <div className="mt-[14px] flex items-center justify-between gap-[8px]">
                  <p className="text-[12px] text-[#6d7c93]">Rank</p>
                  <p className="text-[13px] font-medium text-[#1f2d4e]">332</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-[20px] space-y-[12px]">
          <SectionTitle>Recommended Track</SectionTitle>
          <div
            data-testid="overview-recommendation"
            className="rounded-[18px] border border-[#e5ebf7] bg-white px-[16px] py-[14px] shadow-[0_8px_18px_rgba(28,41,61,0.05)]"
          >
            <div className="flex items-center gap-[12px]">
              <CourseIcon tone="purple">
                <BookOpen className="h-5 w-5" />
              </CourseIcon>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-[8px]">
                  <p className="truncate text-[15px] font-semibold text-[#1f2d4e]">Circuits &amp; Network Reduction</p>
                  <span className="rounded-full bg-[#f0ebff] px-[8px] py-[2px] text-[10px] font-semibold text-[#6a58d6]">
                    Recommended
                  </span>
                </div>
                <p className="mt-[4px] text-[13px] leading-[1.5] text-[#6d7c93]">
                  Repair weak concepts, then reopen one saved lesson instead of scattering attention.
                </p>
              </div>
            </div>

            <button
              type="button"
              data-testid="overview-review-now-button"
              onClick={() => {
                onOpenRevisionTab?.();
              }}
              className="mt-[12px] inline-flex items-center gap-[6px] text-[14px] font-semibold text-[#2f6fe4]"
            >
              Review now
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </section>

        <section className="mt-[20px] space-y-[12px]">
          <SectionTitle>Quick Revision</SectionTitle>
          <div className="grid grid-cols-2 gap-[12px]">
            <QuickRevisionCard
              tone="blue"
              title="Network Theory"
              testId="overview-revision-shortcut-network-theory"
              onClick={() => {
                onOpenRevisionTab?.();
              }}
            />
            <QuickRevisionCard
              tone="green"
              title="General Awareness"
              testId="overview-revision-shortcut-general-awareness"
              onClick={() => {
                onOpenRevisionTab?.();
              }}
            />
          </div>
        </section>

        <div data-testid="overview-action-queue" className="mt-[20px] grid grid-cols-2 gap-[12px]">
          <section
            data-testid="overview-upcoming-classes"
            className="rounded-[18px] border border-[#e5ebf7] bg-white px-[16px] py-[16px] shadow-[0_8px_18px_rgba(28,41,61,0.05)]"
          >
            <p className="text-[15px] font-semibold text-[#1f2d4e]">Today&apos;s Schedule</p>

            <div className="relative mt-[16px] pl-[18px]">
              <div className="absolute bottom-[18px] left-[6px] top-[8px] w-px bg-[#ebeff6]" />

              <div className="relative pb-[18px]">
                <span className="absolute -left-[18px] top-[2px] h-[12px] w-[12px] rounded-full border-[3px] border-[#ee4f74] bg-white" />
                <div className="flex items-start justify-between gap-[10px]">
                  <div className="min-w-0">
                    <div className="flex items-center gap-[8px]">
                      <span className="rounded-full bg-[#ff5b6d] px-[8px] py-[2px] text-[10px] font-semibold uppercase text-white">Live</span>
                      <p className="text-[13px] font-semibold text-[#1f2d4e]">Live Session in Progress</p>
                    </div>
                    <p className="mt-[8px] text-[13px] text-[#5f7096]">SSC JE 2026 Electrical Power Track</p>
                    <p className="mt-[8px] text-[12px] text-[#7b879d]">3:00 PM • Active-sharing</p>
                  </div>
                  <button
                    type="button"
                    data-testid="overview-join-now-button"
                    onClick={() => {
                      onOpenLiveTab?.();
                    }}
                    className="shrink-0 text-[13px] font-semibold text-[#2f6fe4]"
                  >
                    Join now
                  </button>
                </div>
              </div>

              <div className="relative">
                <span className="absolute -left-[17px] top-[4px] h-[10px] w-[10px] rounded-full border-2 border-[#8a97ab] bg-white" />
                <p className="text-[13px] font-semibold text-[#1f2d4e]">General Awareness</p>
                <p className="mt-[8px] text-[12px] text-[#7b879d]">11:00 AM • 3 slots remaining</p>
              </div>
            </div>

            <BottomLink
              label="View full timetable"
              onClick={() => {
                onOpenLiveTab?.();
              }}
              testId="overview-view-timetable-button"
            />
          </section>

          <section
            data-testid="overview-upcoming-tests"
            className="rounded-[18px] border border-[#e5ebf7] bg-white px-[16px] py-[16px] shadow-[0_8px_18px_rgba(28,41,61,0.05)]"
          >
            <p className="text-[15px] font-semibold text-[#1f2d4e]">Upcoming Tests</p>
            <div className="mt-[16px] flex items-start gap-[12px]">
              <MiniTestBadge />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold text-[#1f2d4e]">Mock Test 02</p>
                <p className="mt-[4px] text-[12px] text-[#7b879d]">SSC JE Electrical Power Track</p>
              </div>
            </div>
            <div className="mt-[16px] flex items-end justify-between gap-[10px]">
              <p className="text-[13px] text-[#7b879d]">In 4 days</p>
              <button
                type="button"
                data-testid="overview-attempt-now-button"
                onClick={() => {
                  onOpenTestsTab?.();
                }}
                className="text-[13px] font-semibold text-[#2f6fe4]"
              >
                Attempt now
              </button>
            </div>

            <BottomLink
              label="View all tests"
              onClick={() => {
                onOpenTestsTab?.();
              }}
            />
          </section>
        </div>

        <div className="mt-[20px] grid grid-cols-2 gap-[12px]">
          <section
            data-testid="overview-score-card"
            className="rounded-[18px] border border-[#e5ebf7] bg-white px-[16px] py-[16px] shadow-[0_8px_18px_rgba(28,41,61,0.05)]"
          >
            <p className="text-[15px] font-semibold text-[#1f2d4e]">Your Progress</p>

            <div className="mt-[14px] flex items-start justify-between gap-[10px]">
              <div>
                <p className="text-[12px] text-[#6d7c93]">Score</p>
                <p className="mt-[4px] text-[16px] font-semibold text-[#1f2d4e]">167</p>
              </div>
              <div className="text-right">
                <p className="text-[12px] text-[#6d7c93]">Rank</p>
                <p className="mt-[4px] text-[16px] font-semibold text-[#1f2d4e]">#96</p>
              </div>
            </div>

            <div className="mt-[14px] h-[6px] rounded-full bg-[#dfe8f7]">
              <div className="h-full w-[64%] rounded-full bg-[#2f6fe4]" />
            </div>

            <div className="mt-[12px] flex items-center justify-between gap-[8px]">
              <p className="text-[12px] text-[#6d7c93]">Rank</p>
              <p className="text-[13px] font-medium text-[#1f2d4e]">332</p>
            </div>

            <BottomLink
              label="View detailed analytics"
              onClick={() => {
                onOpenTestsTab?.();
              }}
            />
          </section>

          <section className="rounded-[18px] border border-[#e5ebf7] bg-white px-[16px] py-[16px] shadow-[0_8px_18px_rgba(28,41,61,0.05)]">
            <p className="text-[15px] font-semibold text-[#1f2d4e]">Stay Consistent</p>
            <p className="mt-[10px] text-[13px] leading-[1.6] text-[#7b879d]">
              Consistency today, success tomorrow.
              <br />
              You&apos;re doing great!
            </p>
            <div className="mt-[18px] flex justify-end">
              <ConsistencySparkline />
            </div>
          </section>
        </div>
      </div>
    </div>
  );

  if (isMobileLayout) {
    return renderMobileOverview();
  }

  return (
    <div
      data-testid="overview-dashboard"
      className="flex h-dvh min-h-dvh w-full flex-1 overflow-x-hidden overflow-y-auto bg-[#fcfdff] lg:overflow-hidden"
      style={{ fontFamily: overviewFontStack }}
    >
      <div className="flex w-full flex-1 flex-col px-[24px] pb-[18px] pt-[20px] lg:px-[32px] lg:pb-[18px] lg:pt-[18px]">
        <div data-testid="overview-topbar" className="flex items-start justify-between gap-[24px]">
          <div className="min-w-0 pt-[2px]">
            <p className="text-[15px] font-semibold text-[#202a44]">
              Welcome back, {learnerName} 👋
            </p>
            <p className="mt-[8px] text-[14px] text-[#7b879d]">
              Let&apos;s continue your learning journey.
            </p>
          </div>

          <div className="flex items-center gap-[12px] self-start">
            <button
              type="button"
              data-testid="overview-search-pill"
              className="flex h-[36px] w-[210px] items-center gap-2 rounded-full border border-[#e6ecf4] bg-white px-[14px] text-[13px] text-[#8a97ab] shadow-[0_6px_18px_rgba(28,41,61,0.05)]"
            >
              <Search className="h-4 w-4 text-[#8a97ab]" />
              <span>Search anything...</span>
            </button>

            <div className="flex h-[38px] w-[38px] items-center justify-center overflow-hidden rounded-full border border-[#e2e8f2] bg-white shadow-[0_6px_16px_rgba(28,41,61,0.05)]">
              <AvatarArt />
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
              <span className="absolute -right-[3px] -top-[3px] flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-[#2f6fe4] px-[4px] text-[9px] font-semibold leading-none text-white">
                {overview.notifications.length}
              </span>
            </button>
          </div>
        </div>

        <div className="mt-[18px] grid flex-1 min-h-0 grid-cols-1 gap-[16px] lg:grid-cols-[minmax(0,1fr)_292px]">
          <div className="min-w-0 space-y-[14px]">
            <section
              data-testid="overview-hero"
              className="relative h-[192px] overflow-hidden rounded-[18px] border border-[#e7edf6] bg-[#edf4ff] shadow-[0_10px_28px_rgba(28,41,61,0.06)]"
            >
              <div className="absolute inset-0">
                <HeroArtwork />
              </div>

              <div className="relative z-10 flex h-full items-start justify-between gap-6 px-[22px] py-[22px]">
                <div className="max-w-[520px]">
                  <div className="flex items-center gap-[10px] text-[14px] font-semibold text-[#34547d]">
                    <span>Continue Learning</span>
                    <span className="rounded-[6px] bg-[#e3eeff] px-[6px] py-[1px] text-[12px] font-semibold text-[#2f6fe4]">0%</span>
                  </div>

                  <p className="mt-[12px] text-[18px] font-bold leading-[1.35] tracking-[-0.02em] text-[#1f2d4e] sm:text-[20px] lg:text-[22px]">
                    SSC JE 2026 Electrical Power Track
                  </p>

                  <p className="mt-[10px] max-w-[460px] text-[14px] leading-[1.65] text-[#50627d]">
                    Start one lesson, then build revision around what you actually study.
                  </p>

                  <button
                    type="button"
                    data-testid="overview-continue-cta"
                    onClick={openHeroCourse}
                    className="mt-[16px] inline-flex h-[40px] min-w-[160px] items-center justify-between rounded-[10px] bg-[#2f6fe4] px-[16px] text-[13px] font-semibold text-white shadow-[0_10px_20px_rgba(47,111,228,0.2)]"
                  >
                    Continue Learning
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>

                <div className="hidden shrink-0 pt-[8px] lg:block">
                  <ProgressRing />
                </div>
              </div>
            </section>

            <section data-testid="overview-active-courses" className="space-y-[10px]">
              <SectionTitle>Active Courses</SectionTitle>
              <div className="grid grid-cols-1 rounded-[18px] border border-[#edf1f7] bg-white shadow-[0_10px_28px_rgba(28,41,61,0.06)] lg:grid-cols-2">
                <div className="px-[18px] py-[18px] lg:border-r lg:border-[#eef2f8]">
                  <ActiveCoursePanel
                    testId="overview-active-course-card-0"
                    iconTone="blue"
                    icon={<BookOpen className="h-5 w-5" />}
                    title="SSC JE 2026"
                    subtitle="Electrical Power Track"
                    progressLabel="0% Completed"
                    progressWidth="4%"
                    progressTone="bg-[#2f6fe4]"
                    metrics={[
                      { value: '0', label: 'Lessons' },
                      { value: '0', label: 'Mock Tests' },
                      { value: '0', label: 'Questions' },
                    ]}
                    onClick={openHeroCourse}
                  />
                </div>

                <div className="px-[18px] py-[18px]">
                  <ActiveCoursePanel
                    testId="overview-active-course-card-1"
                    iconTone="green"
                    icon={<FileText className="h-5 w-5" />}
                    title="RRB JE"
                    subtitle="Civil Fast Track"
                    progressLabel="23% Completed"
                    progressWidth="23%"
                    progressTone="bg-[#27a75f]"
                    metrics={[
                      { value: '118', label: 'Lessons' },
                      { value: '5', label: 'Mock Tests' },
                      { value: '1,442', label: 'Questions' },
                    ]}
                    onClick={openRrbCourse}
                  />
                </div>
              </div>
            </section>

            <section data-testid="overview-signals" className="space-y-[10px]">
              <SectionTitle>Performance Overview</SectionTitle>
              <div className="grid grid-cols-1 rounded-[18px] border border-[#edf1f7] bg-white shadow-[0_10px_28px_rgba(28,41,61,0.06)] lg:grid-cols-[minmax(0,1.08fr)_330px]">
                <div
                  data-testid="overview-streak"
                  className="px-[18px] py-[16px] lg:border-r lg:border-[#eef2f8]"
                >
                  <div className="flex items-start gap-[12px]">
                    <div className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-[#fff5eb] text-[18px]">
                      🔥
                    </div>
                    <div>
                      <p className="text-[14px] font-semibold text-[#1f2d4e]">Keep the Streak On</p>
                      <div className="mt-[12px] space-y-[10px]">
                        <div className="flex items-center gap-[10px] text-[13px] text-[#6d7c93]">
                          <ClipboardList className="h-4 w-4 text-[#9aa8bb]" />
                          <span>Daily quiz to keep your revision alive</span>
                        </div>
                        <div className="flex items-center gap-[10px] text-[13px] text-[#6d7c93]">
                          <CalendarClock className="h-4 w-4 text-[#f0b557]" />
                          <span>Next mock test in 4 days</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-[18px] flex items-center justify-between gap-3">
                    <p className="text-[13px] text-[#6d7c93]">0 day streak</p>
                    <button
                      type="button"
                      data-testid="overview-streak-continue-button"
                      onClick={() => {
                        onOpenQuizTab?.();
                      }}
                      className="inline-flex items-center gap-1 text-[13px] font-semibold text-[#2f6fe4]"
                    >
                      Continue
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div data-testid="overview-score-summary" className="px-[18px] py-[16px]">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[12px] text-[#6d7c93]">Score</p>
                      <p className="mt-[6px] text-[16px] font-semibold text-[#1f2d4e]">167</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[12px] text-[#6d7c93]">Rank</p>
                      <p className="mt-[6px] text-[16px] font-semibold text-[#1f2d4e]">#96</p>
                    </div>
                  </div>

                  <div className="mt-[16px] h-[6px] rounded-full bg-[#dfe8f7]">
                    <div className="h-full w-[72%] rounded-full bg-[#2f6fe4]" />
                  </div>

                  <div className="mt-[14px] flex items-center justify-between gap-3">
                    <p className="text-[12px] text-[#6d7c93]">Rank</p>
                    <p className="text-[13px] font-medium text-[#1f2d4e]">332</p>
                  </div>
                </div>
              </div>
            </section>

            <section className="space-y-[10px]">
              <SectionTitle>Recommended Track</SectionTitle>
              <div
                data-testid="overview-recommendation"
                className="flex items-center justify-between gap-[18px] rounded-[18px] border border-[#edf1f7] bg-white px-[18px] py-[14px] shadow-[0_10px_28px_rgba(28,41,61,0.06)]"
              >
                <div className="flex min-w-0 items-center gap-[14px]">
                  <CourseIcon tone="purple">
                    <BookOpen className="h-5 w-5" />
                  </CourseIcon>
                  <div className="min-w-0">
                    <div className="flex items-center gap-[8px]">
                      <p className="truncate text-[14px] font-semibold text-[#1f2d4e]">Circuits &amp; Network Reduction</p>
                      <span className="rounded-full bg-[#f0ebff] px-[8px] py-[2px] text-[10px] font-semibold text-[#6a58d6]">
                        Recommended
                      </span>
                    </div>
                    <p className="mt-[4px] text-[13px] text-[#6d7c93]">
                      Repair weak concepts, then reopen one saved lesson instead of scattering attention.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  data-testid="overview-review-now-button"
                  onClick={() => {
                    onOpenRevisionTab?.();
                  }}
                  className="inline-flex shrink-0 items-center gap-1 text-[13px] font-semibold text-[#2f6fe4]"
                >
                  Review now
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </section>

            <section className="space-y-[10px]">
              <SectionTitle>Quick Revision</SectionTitle>
              <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
                <QuickRevisionCard
                  tone="blue"
                  title="Network Theory"
                  testId="overview-revision-shortcut-network-theory"
                  onClick={() => {
                    onOpenRevisionTab?.();
                  }}
                />
                <QuickRevisionCard
                  tone="green"
                  title="General Awareness"
                  testId="overview-revision-shortcut-general-awareness"
                  onClick={() => {
                    onOpenRevisionTab?.();
                  }}
                />
              </div>
            </section>
          </div>

          <aside data-testid="overview-action-queue" className="space-y-[14px]">
            <section
              data-testid="overview-upcoming-classes"
              className="rounded-[18px] border border-[#edf1f7] bg-white px-[20px] py-[18px] shadow-[0_10px_28px_rgba(28,41,61,0.06)]"
            >
              <p className="text-[15px] font-semibold text-[#1f2d4e]">Today&apos;s Schedule</p>

              <div className="relative mt-[18px] pl-[18px]">
                <div className="absolute left-[6px] top-[8px] bottom-[20px] w-px bg-[#ebeff6]" />

                <div className="relative pb-[20px]">
                  <span className="absolute -left-[18px] top-[2px] h-[12px] w-[12px] rounded-full border-[3px] border-[#ee4f74] bg-white" />
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-[8px]">
                        <span className="rounded-full bg-[#ff5b6d] px-[8px] py-[2px] text-[10px] font-semibold uppercase text-white">Live</span>
                        <p className="text-[13px] font-semibold text-[#1f2d4e]">Live Session in Progress</p>
                      </div>
                      <p className="mt-[8px] text-[13px] text-[#5f7096]">SSC JE 2026 Electrical Power Track</p>
                      <p className="mt-[8px] text-[12px] text-[#7b879d]">3:00 PM • Active-sharing</p>
                    </div>

                    <button
                      type="button"
                      data-testid="overview-join-now-button"
                      onClick={() => {
                        onOpenLiveTab?.();
                      }}
                      className="shrink-0 text-[13px] font-semibold text-[#2f6fe4]"
                    >
                      Join now
                    </button>
                  </div>
                </div>

                <div className="relative">
                  <span className="absolute -left-[17px] top-[4px] h-[10px] w-[10px] rounded-full border-2 border-[#8a97ab] bg-white" />
                  <p className="text-[13px] font-semibold text-[#1f2d4e]">General Awareness</p>
                  <p className="mt-[8px] text-[12px] text-[#7b879d]">11:00 AM • 3 slots remaining</p>
                </div>
              </div>

              <BottomLink
                label="View full timetable"
                onClick={() => {
                  onOpenLiveTab?.();
                }}
                testId="overview-view-timetable-button"
              />
            </section>

            <section
              data-testid="overview-upcoming-tests"
              className="rounded-[18px] border border-[#edf1f7] bg-white px-[20px] py-[18px] shadow-[0_10px_28px_rgba(28,41,61,0.06)]"
            >
              <p className="text-[15px] font-semibold text-[#1f2d4e]">Upcoming Tests</p>

              <div className="mt-[18px]">
                <div className="flex items-start gap-[12px]">
                  <MiniTestBadge />
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold text-[#1f2d4e]">Mock Test 02</p>
                    <p className="mt-[4px] text-[12px] text-[#7b879d]">SSC JE Electrical Power Track</p>
                  </div>
                </div>

                <div className="mt-[14px] flex items-end justify-between gap-3">
                  <p className="text-[13px] text-[#7b879d]">In 4 days</p>
                  <button
                    type="button"
                    data-testid="overview-attempt-now-button"
                    onClick={() => {
                      onOpenTestsTab?.();
                    }}
                    className="text-[13px] font-semibold text-[#2f6fe4]"
                  >
                    Attempt now
                  </button>
                </div>
              </div>

              <BottomLink
                label="View all tests"
                onClick={() => {
                  onOpenTestsTab?.();
                }}
              />
            </section>

            <section
              data-testid="overview-score-card"
              className="rounded-[18px] border border-[#edf1f7] bg-white px-[20px] py-[18px] shadow-[0_10px_28px_rgba(28,41,61,0.06)]"
            >
              <p className="text-[15px] font-semibold text-[#1f2d4e]">Your Progress</p>

              <div className="mt-[16px] flex items-start justify-between gap-4">
                <div>
                  <p className="text-[12px] text-[#6d7c93]">Score</p>
                  <p className="mt-[4px] text-[16px] font-semibold text-[#1f2d4e]">167</p>
                </div>
                <div className="text-right">
                  <p className="text-[12px] text-[#6d7c93]">Rank</p>
                  <p className="mt-[4px] text-[16px] font-semibold text-[#1f2d4e]">#96</p>
                </div>
              </div>

              <div className="mt-[14px] h-[6px] rounded-full bg-[#dfe8f7]">
                <div className="h-full w-[64%] rounded-full bg-[#2f6fe4]" />
              </div>

              <div className="mt-[12px] flex items-center justify-between gap-3">
                <p className="text-[12px] text-[#6d7c93]">Rank</p>
                <p className="text-[13px] font-medium text-[#1f2d4e]">332</p>
              </div>

              <BottomLink
                label="View detailed analytics"
                onClick={() => {
                  onOpenTestsTab?.();
                }}
              />
            </section>

            <section className="rounded-[18px] border border-[#edf1f7] bg-white px-[20px] py-[16px] shadow-[0_10px_28px_rgba(28,41,61,0.06)]">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="text-[15px] font-semibold text-[#1f2d4e]">Stay Consistent</p>
                  <p className="mt-[8px] text-[12px] leading-[1.6] text-[#7b879d]">
                    Consistency today, success tomorrow.
                    <br />
                    You&apos;re doing great!
                  </p>
                </div>
                <ConsistencySparkline />
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
};
