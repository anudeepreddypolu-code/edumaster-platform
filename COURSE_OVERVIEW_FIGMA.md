# EduMaster Figma Redesign Spec

## Purpose

This document converts the current React and TypeScript product into a Figma-ready redesign plan.

It is based on the real UI structure in:

- `src/App.tsx`
- `src/components/CoursesTab.tsx`
- `src/index.css`
- mobile QA captures in `qa-automation/qa-automation/artifacts/2026-04-13T06-47-59-821Z`

The goal is not to copy the current UI. The goal is to keep every core feature, reduce visual overload, and turn the product into a premium study app with clearer priorities on mobile and desktop.

## Product Audit

### Current screen inventory from code

| Area | Current screen or state in code | Source |
| --- | --- | --- |
| Auth | Login, signup, session takeover modal | `AuthScreen` in `src/App.tsx` |
| App shell | Desktop side rail, mobile bottom nav, global search, mobile more sheet | `Shell` in `src/App.tsx` |
| Dashboard | Overview home with mission hero, continue learning, focus board, saved topics, courses | `OverviewTab` |
| Courses | Course list, course workspace home, subjects, lesson player, live and replay archive | `CoursesTab` |
| Tests | Test list, instructions, declaration, CBT exam, summary, calculator, scorecard | `TestsTab`, `ExactCbtTestPlayer` |
| Quiz | Daily quiz attempt, instant result, daily leaderboard, weekly leaderboard | `QuizTab` |
| Live | Live class list, selected session detail, protected playback, chat and doubts | `LiveTab` |
| Revision | Saved topics, recovery queue, revision plans, mock mistake review | `RevisionTab` |
| Analytics | Metrics, trend chart, adaptive plan, AI coach | `AnalyticsTab` |
| Plans | Pricing, active plan state, payment feedback | `PlansTab` |
| Admin | Metrics, operations, course creation, test and quiz generation, content managers | `AdminTab` |

### Requested screens mapped to the real product

- `Login / Signup`: present today as a combined auth surface with a toggle.
- `Dashboard`: present today as `Overview`.
- `Courses`: present today as the course list plus course selector.
- `Course overview`: present today as course workspace `Home`.
- `Lecture screen`: present today as course workspace `Lesson`.
- `Tests`: present today as test catalog plus exam entry flow.
- `Results`: present today as the post-submit scorecard inside `Tests`.
- `Profile`: not a standalone screen today. Profile data is split across the shell learner card, auth/session behavior, and plans. The redesign should create a dedicated `Profile & Access` screen without removing any functionality.

### Reusable UI patterns found in the code

- Primary buttons, secondary buttons, outline buttons, pill buttons
- Shell navigation: desktop rail, mobile bottom nav, mobile more sheet
- Search field and search results panel
- Metric cards and summary cards
- Surface cards with soft borders and rounded corners
- Filter chips and segmented tabs
- Course cards, subject cards, lesson rows
- Live session cards and status chips
- Question palette cells and test summary tiles
- Pricing cards and feature rows
- Notes and AI helper panels

### Current navigation model

- Unauthenticated flow:
  - Login or signup
  - Optional session takeover confirmation
  - Dashboard

- Authenticated primary destinations:
  - Overview
  - Courses
  - Mock Tests
  - Daily Quiz
  - Live Classes
  - Revision
  - Analytics
  - Plans
  - Admin for admins only

- Mobile treatment today:
  - `Overview`, `Courses`, `Tests`, `Live` on bottom nav
  - all other destinations pushed into `More`

- Deep-link behavior today:
  - global search can jump to lesson, course, test, live class, or saved topic
  - notifications can deep-link into live class playback
  - dashboard continue actions open directly inside course lesson playback

### Feature model that must remain

- Courses and lesson playback
- Saved topics and revision
- Mock tests with full CBT flow
- Daily quiz and streak
- Live classes, replays, chat, and doubts
- Analytics and AI guidance
- Plans and payment activation
- Admin content operations

## UX Reconstruction

### First-time user journey

1. User lands on the auth screen.
2. User logs in or creates an account.
3. User arrives on the dashboard.
4. User needs one obvious starting action.
5. User opens a course, enters a subject, and starts the first lesson.
6. User discovers mock tests and live classes after that first successful learning action.

### Daily usage journey

1. User opens the app.
2. User wants the fastest next action, usually `Resume lesson`, `Join live`, or `Take test`.
3. User completes a focused study block.
4. User checks progress or result.
5. User saves one topic for later revision.
6. User returns through quiz, revision, or live replay without losing context.

### Primary UX issues in the current product

#### 1. Navigation still feels crowded on mobile

- There are many top-level destinations competing for first-tier attention.
- Search, large page titles, tab chips, and content all sit above the fold.
- The result is high vertical cost before the user reaches the first useful item.

#### 2. The dashboard hero is visually strong but too tall

- It looks premium, but it consumes too much space on narrow screens.
- The first action is often below an oversized introduction layer.

#### 3. Course flow contains repeated context

- The course list, course summary, workspace hero, workspace tabs, subject list, and lesson rail all repeat the same course identity.
- On mobile, the learner can scroll through course context before reaching the actual lecture player.

#### 4. Information hierarchy is too even

- Dashboard, analytics, plans, and test surfaces often use cards with similar visual weight.
- Primary actions and secondary facts look equally important.

#### 5. Test entry is accurate but intimidating

- The CBT instructions are faithful to exam style, but the entry flow is text-heavy.
- Users need progressive disclosure, not a wall of content before the exam starts.

#### 6. Search is useful but heavy

- Search sits persistently in the shell and consumes prime space on every screen.
- A dedicated search surface would feel cleaner and more intentional.

#### 7. Profile and account state are fragmented

- Learner identity is shown in the shell.
- Access state is shown in Plans.
- Session and device behavior are shown mostly through auth copy and backend state.
- There is no single `Profile & Access` destination.

## Redesign Strategy

### Core design principles

- One primary action above the fold on every student screen
- One accent surface per screen, not five
- Keep important progress visible, but compress it
- Make navigation contextual instead of global whenever possible
- Move dense utility functions into secondary layers
- Preserve the exam-grade credibility of the test engine
- Let course learning feel calm, focused, and sequential

### New information architecture

#### Primary navigation

- `Home`
- `Courses`
- `Tests`
- `Live`
- `More`

#### More menu destinations

- `Daily Quiz`
- `Revision`
- `Analytics`
- `Plans`
- `Profile & Access`
- `Admin` only for admins

#### Search behavior

- Replace the always-large shell search bar with a compact search trigger in the top bar.
- Open search as a dedicated modal or full-screen mobile sheet.
- Keep the same search sources:
  - courses
  - lessons
  - tests
  - live sessions
  - saved topics

### Structural changes without removing features

- Keep course workspace tabs, but make them smaller and more local to the course page.
- Keep live classes and replays, but separate `Live Now`, `Upcoming`, and `Replay Archive` more clearly.
- Keep the full CBT exam, but simplify the pre-exam instruction sequence.
- Add a true `Profile & Access` screen using current user, plan, streak, and session information.

## Design Direction

### Brand mood

- Calm academic
- Premium but not flashy
- Confident and exam-serious
- Warm white surfaces with deep ink anchors
- Blue used as signal color, not as wallpaper

### Typography

- Display and headings: `Literata`
- UI labels, body, controls: `Space Grotesk`

### Color system

| Token | Value | Role |
| --- | --- | --- |
| `Ink/950` | `#101A2B` | strongest headings, dark panels |
| `Ink/900` | `#142033` | main text and shell anchors |
| `Ink/700` | `#31415B` | secondary strong text |
| `Slate/500` | `#6E7D95` | body copy and labels |
| `Slate/300` | `#D8E2EE` | dividers and soft borders |
| `Canvas/0` | `#FFFFFF` | cards |
| `Canvas/50` | `#F7FAFD` | page background |
| `Canvas/100` | `#EEF4FB` | secondary background |
| `Signal/500` | `#19B3E6` | primary accent |
| `Signal/600` | `#0E97C4` | hover and pressed accent |
| `Signal/050` | `#EAF8FE` | accent fill |
| `Success/500` | `#168B61` | completion and active access |
| `Success/050` | `#E8F8F1` | success background |
| `Warning/500` | `#D18A28` | warnings and pending |
| `Warning/050` | `#FFF5E8` | warning background |
| `Danger/500` | `#CF5538` | locked, destructive, urgent |
| `Danger/050` | `#FDEEE8` | danger background |

### Spacing scale

- `4`
- `8`
- `12`
- `16`
- `20`
- `24`
- `32`
- `40`
- `48`
- `64`

### Radius scale

- `12` for small controls
- `16` for chips and list rows
- `24` for major cards
- `32` for hero sections and sheets

### Shadow system

- `Shadow/Sm`: soft card hover
- `Shadow/Md`: key content surfaces
- `Shadow/Lg`: modal, search, and sticky players

### Motion

- `160ms` for controls
- `220ms` for cards, drawers, and small sheets
- `320ms` for full-page transitions
- Use vertical movement of `8px` to `16px`
- Avoid decorative motion inside test and lecture flows

### Frame sizes and grids

- Mobile base frame: `390 x 844`
- Mobile compact frame: `360 x 800`
- Tablet reference frame: `768 x 1024`
- Desktop base frame: `1440 x 1024`
- Mobile grid: `4 columns`, `16px` margin, `16px` gutter
- Desktop grid: `12 columns`, `80px` side margin, `24px` gutter
- Use Auto Layout for every card, section, sheet, and nav pattern

## Design System Components

### Navigation

- `Nav/Bottom/Primary`
- `Nav/Rail/Desktop`
- `Nav/Secondary Tabs`
- `Nav/More Sheet`
- `Topbar/Student`
- `Topbar/Search Trigger`

### Inputs

- `Input/Text/Default`
- `Input/Search/Inline`
- `Input/Search/Modal`
- `Input/Select`
- `Input/Textarea`
- `Input/Checkbox`

### Actions

- `Button/Primary`
- `Button/Secondary`
- `Button/Outline`
- `Button/Pill`
- `Button/Icon`
- `Button/Destructive`

### Feedback

- `Chip/Status`
- `Badge/Progress`
- `Toast/Success`
- `Toast/Error`
- `Empty State/Default`
- `Skeleton/Card`

### Content cards

- `Card/Hero`
- `Card/Metric`
- `Card/Course`
- `Card/Subject`
- `Card/Lesson`
- `Card/Test`
- `Card/Session`
- `Card/Pricing`
- `Card/Profile Summary`

### Domain components

- `Course/Course Switcher`
- `Course/Progress Strip`
- `Course/Lesson Row`
- `Course/Player Rail`
- `Course/Session Group`
- `Live/Session Detail`
- `Quiz/Question Card`
- `Test/Question Palette`
- `Test/Answer Option`
- `Test/Legend Row`
- `Results/Topic Breakdown`
- `Profile/Stat Tile`

## Figma File Structure

### Page list

1. `00 Cover`
2. `01 Audit`
3. `02 Foundations`
4. `03 Components`
5. `04 Mobile Screens`
6. `05 Desktop Screens`
7. `06 Flows`
8. `07 Admin + Edge Cases`
9. `08 Handoff`

### Page purpose

- `00 Cover`: product title, design direction, version, owner
- `01 Audit`: current app map, user journeys, UX issues
- `02 Foundations`: colors, type, spacing, grid, motion, icon rules
- `03 Components`: master components and variants
- `04 Mobile Screens`: primary production-ready mobile flows
- `05 Desktop Screens`: desktop shell and split-pane adaptations
- `06 Flows`: auth, learning, testing, payment, live-class, profile
- `07 Admin + Edge Cases`: admin, errors, empty states, loading, lock states
- `08 Handoff`: annotations, naming rules, responsive notes

### Frame list for mobile

- `M/Auth/Login`
- `M/Auth/Signup`
- `M/Auth/Session Takeover`
- `M/Home/Dashboard`
- `M/Search/Results`
- `M/Search/Empty`
- `M/Courses/List`
- `M/Courses/Course Home`
- `M/Courses/Subjects`
- `M/Courses/Lesson`
- `M/Courses/Live Archive`
- `M/Tests/List`
- `M/Tests/Instructions`
- `M/Tests/Declaration`
- `M/Tests/Exam`
- `M/Tests/Summary`
- `M/Tests/Results`
- `M/Quiz/Daily Quiz`
- `M/Quiz/Results`
- `M/Live/List`
- `M/Live/Session Detail`
- `M/Revision/Home`
- `M/Analytics/Home`
- `M/Plans/Pricing`
- `M/Profile/Access`
- `M/Admin/Overview`

### Frame list for desktop

- `D/Home/Dashboard`
- `D/Courses/Course Home`
- `D/Courses/Lesson`
- `D/Tests/Exam`
- `D/Live/Session Detail`
- `D/Profile/Access`
- `D/Admin/Overview`

## Naming Conventions

### Components

- `Cmp/Button/Primary/Default`
- `Cmp/Button/Primary/Hover`
- `Cmp/Card/Course/Active`
- `Cmp/Nav/Bottom/5 Item`
- `Cmp/Test/Palette Cell/Answered`

### Tokens

- `Color/Ink/900`
- `Color/Signal/500`
- `Type/H1/Mobile`
- `Spacing/24`
- `Radius/24`
- `Shadow/Md`

### Frames

- `M/Area/Screen/State`
- `D/Area/Screen/State`

Examples:

- `M/Courses/Lesson/Unlocked`
- `M/Tests/Results/Passed`
- `D/Home/Dashboard/Default`

## Screen-by-Screen Redesign

### 1. Login and Signup

#### Goal

Make entry feel premium and trustworthy without looking heavy.

#### Layout

- Mobile: stacked auth card with segmented toggle
- Desktop: split layout with brand story on the left and form on the right
- Keep session takeover as a blocking decision sheet

#### Key content

- brand
- form
- security reassurance
- sample credentials only in local/dev mode

#### UX improvements

- reduce visual noise inside the auth form
- keep one primary CTA per state
- make `session takeover` clearer and less alarming

### 2. Dashboard

#### Goal

Turn the home screen into a calm decision surface.

#### Layout

- compact hero with one primary CTA
- three summary metrics max above fold
- stack `Continue`, `Upcoming Live`, and `Revision Queue`
- move broader stats below first action content

#### Sections

- `Continue learning`
- `Upcoming live class`
- `Saved topics`
- `Recent performance`
- `All courses`

#### UX improvements

- shrink the hero height by roughly 30 percent on mobile
- keep only one dark hero per screen
- use cards with three clear priority levels:
  - primary action
  - active status
  - supporting data

### 3. Courses List

#### Goal

Help learners choose one active course, not browse endlessly.

#### Layout

- top course switcher with search
- students see only purchased courses in `My courses`
- admin keeps `My courses` and `Catalog` toggle
- fewer large stacked promos

#### Content

- course thumbnail
- title
- subject
- progress
- next lesson
- status badge

#### UX improvements

- remove duplicate summary blocks
- reduce course card height
- show just enough metadata to choose and continue

### 4. Course Home

#### Goal

Create a single course dashboard that orients the learner instantly.

#### Layout

- compact dark header with title, progress, and access
- local course tabs under the header:
  - `Home`
  - `Subjects`
  - `Lesson`
  - `Live & Replays`
- primary action row:
  - `Continue lesson`
  - `Open subjects`
  - `Open sessions`

#### Key sections

- current lesson
- progress strip
- subject cards
- session summary
- saved topic count

#### UX improvements

- keep only one course summary header
- do not repeat the same course name in multiple full-size cards

### 5. Subjects

#### Goal

Make subject selection feel structured, not dense.

#### Layout

- left subject list on desktop
- stacked subject selector on mobile
- main content shows lessons grouped by chapter

#### Lesson row design

- lesson title
- duration
- type icon
- progress bar
- save toggle
- lock or sequential status

#### UX improvements

- use chapter grouping as information hierarchy
- highlight `resume`, `completed`, and `locked next` states clearly

### 6. Lecture Screen

#### Goal

Make the lecture player the center of attention.

#### Layout

- sticky player first
- slim lesson metadata bar
- previous and next actions close to the player
- notes and AI help in a side drawer or bottom sheet
- lesson rail collapsible on mobile

#### Keep from current feature set

- secure playback
- playback speed
- fullscreen
- notes PDF
- save topic
- mark complete
- AI doubt helper

#### UX improvements

- when entering `Lesson`, the video should appear above the fold immediately
- move course switching out of the lecture viewport
- reduce the amount of duplicated metadata below the player

### 7. Tests List

#### Goal

Make test choice fast and confidence-building.

#### Layout

- segmented filters:
  - `Full Length`
  - `Sectional`
  - `Topic Wise`
- cleaner cards with
  - title
  - duration
  - marks
  - negative marking
  - sections
  - last attempt if available

#### UX improvements

- keep one strong CTA: `Start mock`
- move detailed instructions to the next screen

### 8. Test Instructions and Declaration

#### Goal

Preserve exam realism while making the setup less overwhelming.

#### Layout

- use collapsible instruction groups
- show legend visually, not as long prose first
- keep declaration and language choice together

#### UX improvements

- turn text walls into grouped instruction blocks:
  - time and rules
  - palette legend
  - navigation behavior
  - answer behavior
- make `Begin exam` the only primary CTA

### 9. CBT Exam Screen

#### Goal

Retain the real exam feeling and improve clarity.

#### Layout

- preserve current exam-grade structure:
  - top header
  - timer
  - part tabs
  - question workspace
  - question palette
  - section analysis
- reduce decorative styling
- prioritize legibility over brand styling

#### UX improvements

- stronger contrast for active state
- cleaner spacing around answer options
- calculator appears as a managed overlay with clear open and close state

### 10. Results Screen

#### Goal

Turn the scorecard into a decision screen, not just a stat dump.

#### Layout

- score hero
- section breakdown
- weak and strong topics
- suggested next action
- solution review CTA

#### Sections

- `Your score`
- `Accuracy`
- `Rank / percentile`
- `Weak topics to repair`
- `Strong topics to maintain`
- `Review solutions`
- `Retake or continue learning`

#### UX improvements

- surface the next study recommendation directly below the top metrics
- group topic insights before detailed question review

### 11. Daily Quiz

#### Goal

Keep the streak loop fast and rewarding.

#### Layout

- mobile: one focused question card at a time
- desktop: question card with right-side streak and leaderboard
- result state inline after submission

#### Keep from current feature set

- instant result
- streak
- daily leaderboard
- weekly leaderboard

#### UX improvements

- reduce long-scroll quiz fatigue
- keep leaderboard visible but secondary

### 12. Live Classes

#### Goal

Help learners instantly answer three questions:

- what is live now
- what is next
- what can I replay

#### Layout

- segmented header:
  - `Live Now`
  - `Upcoming`
  - `Replays`
- detail panel for selected session
- join or watch CTA pinned near the session summary
- chat and doubts below the player, not competing with the session list

#### UX improvements

- stronger visual distinction between scheduled, live, ended, and replay-ready
- keep the list lighter and the selected detail richer

### 13. Revision

#### Goal

Turn revision into a guided workflow instead of a passive bookmark list.

#### Layout

- top recovery hero with one recommended next step
- saved topics list
- mock mistake recovery list
- weekly revision plan cards

#### UX improvements

- saved topics should behave like a real queue
- mock recovery should connect directly back to lesson playback

### 14. Analytics

#### Goal

Show performance in a way that leads to action.

#### Layout

- top metric row
- trend chart
- weak and strong topic blocks
- adaptive plan
- AI coach drawer or panel

#### UX improvements

- use chart plus recommendation pairing
- do not give every metric equal weight

### 15. Plans

#### Goal

Make pricing trustworthy and fast to compare.

#### Layout

- one intro panel
- pricing cards
- active plan banner
- `What unlocks` summary

#### UX improvements

- explain account state before pricing
- make active plan unmistakable

### 16. Profile & Access

#### Why this screen exists

The current product does not have a dedicated profile page, but the user requested one and the product already contains the needed data.

#### Data sources already present

- learner identity from auth
- streak and points from dashboard and user
- active plan from subscriptions
- session behavior from auth model and session copy
- saved topics and progress from platform overview

#### Layout

- profile header with avatar, name, role, exam focus
- account stats:
  - streak
  - points
  - active plan
  - saved topics
- access section:
  - current plan
  - device/session policy
  - sign out
- support section:
  - payment help
  - report issue

### 17. Admin

#### Goal

Keep admin utilitarian and separate from the premium learner mood.

#### Layout

- compact operations dashboard
- content creation grouped by type
- analytics at top
- forms and managers below

#### UX rule

Admin should look clear and efficient, not ornamental.

## Component Hierarchy

### App shell

- Top bar
- Primary navigation
- Search layer
- Page header
- Content area
- Sticky action surfaces when needed

### Course hierarchy

- Course switcher
- Course header
- Course local tabs
- Subject selector
- Lesson list
- Player
- Notes and AI helper
- Session archive

### Test hierarchy

- Test card
- Pre-exam setup
- Exam shell
- Question area
- Question palette
- Calculator
- Summary
- Result cards

## Feature Preservation Matrix

| Feature | Keep | New presentation |
| --- | --- | --- |
| Courses | Yes | cleaner course switcher and course home |
| Lectures | Yes | faster path to player, less duplicated chrome |
| Mock tests | Yes | cleaner test choice and result framing |
| Live classes | Yes | clearer status grouping and selected-session detail |
| Replays | Yes | merged into course and live archives |
| Daily quiz | Yes | faster single-focus mobile flow |
| Revision | Yes | guided queue instead of loose bookmark feel |
| Analytics | Yes | action-led insights |
| Payments | Yes | trust-first pricing screen |
| Profile | Expanded | new dedicated `Profile & Access` screen |

## Recommended Figma Build Order

1. Foundations
2. Buttons, chips, cards, nav, search
3. Mobile shell
4. Dashboard
5. Courses flow
6. Tests flow
7. Live, revision, analytics
8. Plans and profile
9. Desktop adaptation
10. Admin and edge cases

## Final Design Outcome

The redesigned app should feel like:

- a focused study cockpit, not a feature catalog
- a premium education product, not a generic dashboard template
- a system that makes the next action obvious
- a mobile experience that respects attention and vertical space

The redesign keeps the platform's full capability, but changes how that capability is organized, prioritized, and presented.
