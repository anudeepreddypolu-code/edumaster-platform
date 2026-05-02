/**
 * VaronEnglish Platform - Production Seed Data
 * 
 * This module provides the seed structure for the VaronEnglish platform.
 * In production, this seed is DISABLED and all content comes from:
 * - Primary Database (PostgreSQL/MongoDB)
 * - Admin Panel content management
 * - API integrations (YouTube, LiveKit, etc.)
 * 
 * For local development/testing ONLY, populate with real VaronEnglish content.
 * NEVER include demo data in production deployments.
 */

const todayIso = () => new Date().toISOString();
const todayDate = () => todayIso().slice(0, 10);

/**
 * Production-ready empty seed structure
 * All content management happens through:
 * 1. Admin panel (src/App.tsx - AdminPanel)
 * 2. Backend APIs (backend/course/course.routes.js)
 * 3. Direct database imports for bulk operations
 */
const buildPlatformSeed = () => ({
  // PRODUCTION: No users are seeded.
  // Use admin panel to create users or configure SSO/OAuth.
  users: [],
  
  // PRODUCTION: No courses are seeded.
  // Add real VaronEnglish English language courses through admin panel:
  // - Grammar Foundations
  // - Vocabulary Mastery
  // - Speaking & Pronunciation
  // - Business English
  // - IELTS / TOEFL Prep
  // - Fluency Development
  courses: [],
  
  // PRODUCTION: No tests are seeded.
  // Create real tests through admin panel or import from assessment system.
  tests: [],
  
  // PRODUCTION: No daily quiz is seeded.
  // Configure through admin panel.
  quiz: {
    _id: 'quiz_daily_prod',
    date: todayDate(),
    questions: [],
  },
  
  // PRODUCTION: No live classes are seeded.
  // Schedule real live classes through admin panel or LiveKit integration.
  liveClasses: [],
  
  // PRODUCTION: No subscription plans are seeded.
  // Configure real subscription plans through admin panel with Stripe integration.
  subscriptions: [],
  
  // PRODUCTION: No sample notifications are seeded.
  notifications: [],
  
  // PRODUCTION: No sample enrollments are seeded.
  enrollments: [],
  
  // PRODUCTION: No sample watch history.
  watchHistory: [],
  
  // PRODUCTION: No sample test attempts.
  testAttempts: [],
  
  // PRODUCTION: No sample chat messages.
  liveChatMessages: [],
  
  // PRODUCTION: No sample user subscriptions.
  userSubscriptions: [],
});

module.exports = {
  buildPlatformSeed,
};
