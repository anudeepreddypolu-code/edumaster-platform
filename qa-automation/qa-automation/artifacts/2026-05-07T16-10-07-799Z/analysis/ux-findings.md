# UX Analysis

## High feature density across primary navigation
- Category: navigation
- Severity: medium
- Evidence: The app exposes many top-level destinations, which can increase cognitive load on smaller Android devices.
- Recommendation: Keep bottom navigation focused on 4-5 destinations and move secondary tools like revision and analytics into contextual entry points or a "More" surface.

## Perceived loading speed needs stronger feedback
- Category: responsiveness
- Severity: high
- Evidence: At least one core screen crossed the configured slow threshold.
- Recommendation: Add skeleton loaders and preserve layout while data loads so transitions feel intentional instead of blocked.

## Information hierarchy should prioritize student actions over raw density
- Category: hierarchy
- Severity: medium
- Evidence: Dashboard, analytics, and practice surfaces contain many cards and metrics competing for attention.
- Recommendation: Lead each screen with one primary action, one progress summary, and move secondary metrics below the fold.

## The product would benefit from calmer visual grouping
- Category: visual-noise
- Severity: medium
- Evidence: Many surfaces use similarly weighted cards, making it harder to distinguish primary vs secondary information.
- Recommendation: Use quieter containers for supporting information, stronger section spacing, and one accent surface per screen.
