# QA Automation + UX Analysis Loop

This workspace adds a practical Android automation and UX review system around the current EduMaster app.

## What it does

- uses `Appium + WebdriverIO` against Android Chrome
- navigates core flows: login, dashboard, courses, mock tests, results, plans/profile area
- captures screenshots and page source at each step
- stores artifacts in structured timestamped folders
- detects likely failures:
  - missing required UI elements
  - slow loads
  - browser/app crashes
  - layout overflow risk
  - visible error text
- runs UX analysis:
  - heuristic checks locally
  - optional vision-model analysis if `OPENAI_API_KEY` is configured
- generates:
  - JSON summary
  - markdown UX findings
  - Flutter reference UI code for an improved dashboard shell

## Artifact structure

Each run writes to:

`qa-automation/artifacts/<timestamp>/`

- `screenshots/`
- `sources/`
- `logs/`
- `analysis/`
- `generated_flutter/`

## Prerequisites

1. Start this app locally:
   `npm run dev`
2. Start Appium server:
   `appium`
3. Start Android emulator or connect a device with Chrome installed.
4. In this folder install dependencies:
   `npm install`

## Run

`npm run android:web`

Or continuous audit loop:

`npm run loop`

## Environment

Optional environment variables:

- `QA_BASE_URL=http://10.0.2.2:3000`
- `QA_APPIUM_HOST=127.0.0.1`
- `QA_APPIUM_PORT=4723`
- `QA_ANDROID_DEVICE=Android Emulator`
- `QA_BROWSER_NAME=Chrome`
- `QA_LOGIN_EMAIL=student@edumaster.local`
- `QA_LOGIN_PASSWORD=Student@123`
- `QA_SLOW_MS=6000`
- `OPENAI_API_KEY=...`
- `OPENAI_MODEL=gpt-4.1-mini`
- `OPENAI_BASE_URL=https://api.openai.com/v1`

## Notes

- This repo is a `React web app`, not a Flutter app. The generated Flutter code is a reference output based on the QA/UX analysis, not a live app migration.
- The selectors use `data-testid` hooks added to the web UI so Appium is less fragile.
