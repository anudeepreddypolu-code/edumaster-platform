# Analytics Module

## Responsibilities

- aggregate quiz + mock test performance
- expose leaderboard data
- calculate weak and strong topics
- produce personalized recommendation text

## Implemented routes

- `GET /api/analytics/user?userId=<id>`
- `GET /api/analytics/leaderboard`
- `GET /api/users/analytics`
- `GET /api/users/progress`

## Current behavior

- analytics are computed from in-memory/mock test attempts and quiz submissions
- weak topics currently come from the latest mock test breakdown
- recommendation text is used directly by the frontend AI/analytics cards

## Production next step

- move analytics aggregation to async workers + Redis caching for high concurrency
