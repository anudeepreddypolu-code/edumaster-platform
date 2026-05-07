# Live mobile gap notes

## Latest artifacts
- 2026-05-07T03-18-02-031Z: viewport-framed mobile captures for student list/detail and mobile create steps
- 2026-05-07T03-03-21-921Z: first artifact with explicit student mobile list/detail captures before room join
- 2026-05-06T16-02-15-958Z: student room shell capture baseline

## Remaining gaps after student mobile capture pass
1. Mobile create flow is now viewport-framed, but the stepper still wraps more loosely than the Figma and the footer button row is taller than the reference.
2. Student mobile live list is much closer, but the featured hero still feels too empty when no real poster has been uploaded.
3. Student mobile list still cannot fully match the Figma hero without a real live-class poster asset; we intentionally removed fake seeded artwork.
4. Student mobile detail is now in the right visual family, but the hero still has more vertical weight than the Figma and the poster-empty state is visually heavier than the design reference.
5. The room-shell comparison still remains the biggest gap because live media connection times out before the student runtime screen can be captured in its intended state.
6. Admin start/join flow is unstable in automation after the student capture phase, so room-focused loops still need session recovery before they can be trusted.

## Next prompt for implementation loop
Bring the mobile live experience closer to the Figma by focusing next on:
- mobile create wizard stepper density and footer sizing
- student list hero proportions when no poster exists, with a more restrained honest empty state
- student detail hero height, poster-empty-state weight, and button spacing
- room automation recovery so we can capture the learner runtime screen and compare the actual room shell instead of only static fallbacks
