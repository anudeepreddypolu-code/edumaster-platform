# Mobile QA Report - 2026-05-07

## Build And Device Status

- iOS simulator build succeeded and launched on `iPhone 16 Plus` using API base `http://127.0.0.1:3300/backend/api`.
- Android debug APK build succeeded and launched on `Medium_Phone_API_35` using API base `http://10.0.2.2:3300/backend/api`.
- Local backend was already running and healthy on `http://127.0.0.1:3300/backend/api/health`.
- Android Appium mobile feature audit completed: 13 captures, 11 failures, 4 UX findings.

## Screenshot Locations

- Native app launch screenshots:
  - `qa-automation/artifacts/native-mobile-2026-05-07/screenshots/ios-current.png`
  - `qa-automation/artifacts/native-mobile-2026-05-07/screenshots/android-current.png`
  - `qa-automation/artifacts/native-mobile-2026-05-07/screenshots/android-after-login.png`
- Auth mobile flow:
  - `qa-automation/qa-automation/artifacts/2026-05-07T16-04-51-452Z/screenshots/`
- Course mobile/browser captures:
  - `qa-automation/qa-automation/artifacts/2026-05-07T16-05-57-763Z/screenshots/`
- Android Appium feature audit:
  - `qa-automation/qa-automation/artifacts/2026-05-07T16-10-07-799Z/screenshots/`
  - Summary: `qa-automation/qa-automation/artifacts/2026-05-07T16-10-07-799Z/analysis/summary.json`
  - UX findings: `qa-automation/qa-automation/artifacts/2026-05-07T16-10-07-799Z/analysis/ux-findings.md`

## Passed / Working

- Native iOS app launches to the login screen.
- Native Android app launches to the login screen.
- Auth mobile browser flow passed with 4 captures and 0 failures.
- Android Appium reached and captured:
  - launch
  - invalid login state
  - login success
  - dashboard
  - courses
  - mock tests
  - live classes
  - revision

## Failures / Risks

- Android Appium reported slow transitions:
  - App launch: 21580 ms
  - Invalid login state: 40388 ms
  - Login success: 42764 ms
- Android Appium could not complete deep course flows:
  - course subjects
  - course player
  - course sessions
- Android Appium could not open mock test instructions from the captured tests screen.
- Android Appium could not access global search after navigation.
- Courses browser review captured course pages, but reported a high-severity console error: HTTP `409 Conflict`.
- Overview browser review did not become ready within 30000 ms.
- Tests browser review timed out.
- Live browser review failed at opening the live classes list page in the admin flow.
- Native Android login screen has a UI issue: Apple login icon renders as a missing glyph.

## UI Notes

- Overall visual quality is polished: spacing, typography, bottom navigation, and mobile cards are clean.
- The mobile UI is heavy in cards and large typography, which looks premium but can push important actions below the fold.
- Empty states are visually clean, but many test users see empty courses/tests unless seeded/enrolled data exists.
- The Android/iOS login screen looks good, but the Android Apple icon needs a platform-safe icon asset.
- The Appium UX analyzer flagged:
  - high feature density across primary navigation
  - weak loading feedback for slow transitions
  - information hierarchy competing across cards/metrics
  - too many similarly weighted visual groups

## Final UI Fix Pass

- Removed fake in-app phone status bars from the student mobile screens so iOS/Android only show the real system status bar.
- Added shared mobile width guards and native safe-area padding to stop iOS content from sitting under the Dynamic Island/status bar.
- Fixed the Test Series mobile home overflow shown in the reference screenshot:
  - search/filter row now stays inside the viewport
  - hero artwork no longer clips out of the card
  - Quick Actions wraps into two columns, so `Performance` is fully visible
  - long student names/search labels truncate instead of pushing layout sideways
- Tightened the empty Courses screen so it remains within the mobile viewport and feels less oversized.
- Tightened the Overview dashboard header so long learner names and action buttons fit on iOS/Android.

## Final Screenshot Locations

- Full-page signup-to-tabs student loop:
  - `qa-automation/artifacts/mobile-ui-loop-2026-05-07-final/screenshots/01-login.png`
  - `qa-automation/artifacts/mobile-ui-loop-2026-05-07-final/screenshots/02-signup.png`
  - `qa-automation/artifacts/mobile-ui-loop-2026-05-07-final/screenshots/03-signup-filled.png`
  - `qa-automation/artifacts/mobile-ui-loop-2026-05-07-final/screenshots/04-home-dashboard.png`
  - `qa-automation/artifacts/mobile-ui-loop-2026-05-07-final/screenshots/05-courses.png`
  - `qa-automation/artifacts/mobile-ui-loop-2026-05-07-final/screenshots/06-live.png`
  - `qa-automation/artifacts/mobile-ui-loop-2026-05-07-final/screenshots/07-tests.png`
  - `qa-automation/artifacts/mobile-ui-loop-2026-05-07-final/screenshots/08-more.png`
- Native iOS verification:
  - `qa-automation/artifacts/native-mobile-ui-final-2026-05-07/screenshots/ios-after-safearea.png`
- Native Android verification:
  - `qa-automation/artifacts/native-mobile-ui-final-2026-05-07/screenshots/android-login-systemui-restarted.png`

## Final Build Status

- `npm run build:mobile:web` passed.
- `cap sync ios` passed.
- iOS `xcodebuild` Debug simulator build passed, installed, and launched on `iPhone 16 Plus`.
- `cap sync android` passed.
- Android `assembleDebug` passed and `adb install -r` succeeded.
- Android emulator verification was partially blocked by an emulator-level `System UI isn't responding` dialog. The APK itself built, installed, and rendered the login screen behind the system dialog.

## Course Safe-Area Loop

- Problem reproduced from the user screenshot: Courses heading could sit under the iOS Dynamic Island/status bar path.
- Root cause: Course mobile screens used separate shell wrappers. Catalog/course/lesson views still had local `env(safe-area-inset-top)` padding instead of the native-safe mobile shell.
- Fix implemented:
  - catalog, course-detail, lesson-player, and empty-catalog screens now use `mobile-safe-screen`
  - inner Course content now uses `mobile-safe-content`
  - duplicate per-screen safe-area top formulas were removed
  - Course header top margin was normalized so the native shell owns status-bar spacing
- Student UX review after fix:
  - heading is readable and no longer collides with system UI
  - search bar and notification icons stay inside the viewport
  - empty state remains clear: no published courses, with course/lesson/test counts visible
  - no horizontal overflow detected
- Verification screenshots:
  - iOS-style Course screen: `qa-automation/artifacts/course-safearea-loop-2026-05-07/screenshots/web-cap-ios/02-courses-cap-ios.png`
  - Android-style Course screen: `qa-automation/artifacts/course-safearea-loop-2026-05-07/screenshots/web-cap-android/01-courses-cap-android.png`
  - Native iOS post-build screenshot: `qa-automation/artifacts/course-safearea-loop-2026-05-07/screenshots/ios-current-after-course-patch.png`
- Metrics:
  - iOS-style Course heading top: `73px`
  - Android-style Course heading top: `35px`
  - iOS-style scroll width: `393px` for `393px` viewport
  - Android-style scroll width: `393px` for `393px` viewport
- Build verification after the Course fix:
  - iOS web bundle, Capacitor sync, Xcode simulator build, install, and launch passed
  - Android web bundle, Capacitor sync, and debug APK build passed

## Scroll And Live Classes Loop

- Problem reviewed: some feature content could look clipped or feel unscrollable on native mobile because the app shell used `overflow-hidden` around feature pages.
- Fix implemented:
  - mobile app shell now allows vertical scrolling while keeping horizontal overflow hidden
  - removed duplicate native top padding from Overview and Tests
  - Live Classes list/detail/room now use native-safe mobile wrappers
  - Live Classes hero, quick actions, class rows, detail stats, and action buttons were compacted for a student phone screen
  - Live room participant tiles were reduced so the class stage remains the focus
  - added `live-room-maximize` action for the mobile live stage
- Student UX notes:
  - Live list cards are now easier to scan: time, subject, title, teacher, status, and open action fit without giant cards
  - primary Live action remains blue; secondary media/settings actions are smaller and less dominant
  - reminder CTA is still visible after scrolling
  - joined/participant cards are less heavy and no longer compete with the live class stage
- Scroll verification:
  - iOS-style Live list: scrollable and moved on scroll
  - iOS-style Tests: scrollable and moved on scroll
  - iOS-style Courses: no scroll needed for empty state; no clipping
  - Android-style Live list: scrollable and moved on scroll
  - Android-style Courses/Tests empty states: no scroll needed; no clipping
  - no horizontal overflow detected on checked screens (`393px` document width on `393px` viewport)
- Functionality spot checks:
  - Live quick actions clicked: Schedule, My Classes
  - reminder toggle changed to `Reminders Enabled`
  - Live detail tabs clicked: Overview, Live Chat, Notes, Polls
- Verification screenshots:
  - iOS Live list: `qa-automation/artifacts/scroll-live-ui-loop-2026-05-07-final/screenshots/ios/live-list-top.png`
  - iOS Live detail: `qa-automation/artifacts/scroll-live-ui-loop-2026-05-07-final/screenshots/ios/live-detail-top.png`
  - Android Live list: `qa-automation/artifacts/scroll-live-ui-loop-2026-05-07-final/screenshots/android/live-list-top.png`
  - Full metrics: `qa-automation/artifacts/scroll-live-ui-loop-2026-05-07-final/analysis/scroll-live-results.json`
- Build verification after scroll/live fixes:
  - iOS web bundle, Capacitor sync, and Xcode simulator build passed
  - Android web bundle, Capacitor sync, and debug APK build passed
