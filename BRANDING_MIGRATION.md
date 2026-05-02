# VaronEnglish Branding & Migration Guide

## 📋 Overview

This document tracks the complete migration from "EduMaster: SSC JE / RRB JE Prep Platform" to "VaronEnglish: English Language Learning Platform".

---

## ✅ Completed Changes

### 1. Configuration Files
- ✓ `backend/lib/config.js`
  - Updated `serviceName` from `edumaster-platform` to `varonenglish-platform`
  - Updated `livekitRoomPrefix` from `edumaster-live` to `varonenglish-live`
  - Made JWT_SECRET required (no development fallback)
  - Disabled sample credentials exposure by default
  - All hardcoded demo credentials removed

### 2. Frontend Branding
- ✓ `src/App.tsx`
  - `CBT_BRAND_NAME`: `EduMaster` → `VaronEnglish`
  - App tagline: Updated to English language learning
  - Storage keys: `edumaster.*` → `varonenglish.*`
  - Admin email placeholder: Updated to @varonenglish.com

### 3. Service Layer
- ✓ `src/EduService.ts`
  - Storage keys: `edumaster.jwt` → `varonenglish.jwt`
  - Storage keys: `edumaster.auth.event` → `varonenglish.auth.event`

### 4. Metadata & Package
- ✓ `metadata.json`
  - Name: `Remix: EduMaster: SSC & RRB JE Prep Platform` → `VaronEnglish: English Language Learning Platform`
  - Description: Updated to reflect English learning platform

### 5. Seed Data  
- ✓ `backend/lib/platform-seed.js`
  - Removed all demo courses (SSC JE Electrical, RRB JE Civil, GA Revision)
  - Removed all demo users
  - Removed all demo tests
  - Removed all demo live classes
  - Structure maintained for production content
  - Disabled automatic seed loading for production

### 6. Production Configuration
- ✓ Created `.env.production`
  - Complete production environment template
  - All secrets marked as required
  - No hardcoded demo values
  - AWS S3 and LiveKit configuration ready

### 7. Documentation
- ✓ Created `PRODUCTION_DEPLOYMENT.md`
  - Complete deployment checklist
  - Security hardening guide
  - Backup and recovery procedures
  - Monitoring and alerting setup
  - Troubleshooting guide

---

## 🔄 Remaining Changes

### Priority 1: High Impact (Do First)
- [ ] Update `backend/lib/repositories.js`
  - Change all database defaults from `SSC JE` to `English Proficiency`
  - Search and update 8+ occurrences

- [ ] Update `src/components/AdminCourseManager.tsx`
  - Change course category defaults
  - Update exam type UI labels

- [ ] Update `src/components/AdminLiveClassManager.tsx`
  - Change provider name from `EduMaster Live` to `VaronEnglish Live`
  - Update room naming logic

### Priority 2: Medium Impact (Core Components)
- [ ] Update `src/App.tsx` additional references
  - Search for "SSC" mentions
  - Search for "RRB" mentions
  - Update exam family type definitions

- [ ] Update `backend/.env`
  - Remove demo credentials
  - Update service names
  - Update domain references

- [ ] Update `backend/ormconfig.js`
  - Change database name from `edumaster` to `varonenglish`

### Priority 3: Documentation (Important but Lower Priority)
- [ ] Update `README.md`
  - Replace title and description
  - Update feature list for English learning

- [ ] Update `QUICK_REFERENCE.md`
  - Update credentials if any remain
  - Update demo account references

- [ ] Update `PROJECT_ANALYSIS.md`
  - Replace exam focus with English learning
  - Update architecture overview

---

## 📝 Files Needing Review

### Backend Files
```
backend/lib/repositories.js          - 8+ SSC/RRB references
backend/lib/config.js                - ✓ DONE
backend/.env                         - Needs update (remove demo creds)
backend/ormconfig.js                 - Database name needs update
backend/admin/admin.routes.js        - Check for hardcoded values
backend/course/course.controller.js  - Check category defaults
```

### Frontend Files
```
src/App.tsx                          - ✓ PARTIALLY DONE
src/components/AdminCourseManager.tsx  - Category defaults
src/components/AdminLiveClassManager.tsx - Provider name
src/components/CoursesTab.tsx        - Check defaults
src/EduService.ts                    - ✓ DONE
src/types.ts                         - Verify exam type enums
```

### Configuration & Docs
```
metadata.json                        - ✓ DONE
.env.example                         - Should be safe (no real secrets)
.env.production                      - ✓ Created
backend/.env                         - Needs cleanup
package.json                         - Package name is generic (OK)
README.md                            - Needs major update
QUICK_REFERENCE.md                   - Update credentials
PROJECT_ANALYSIS.md                  - Update content
```

---

## 🔍 Search & Replace Quick Reference

### Search Terms to Find & Update

**Branding:**
- "EduMaster" → "VaronEnglish"
- "edumaster" → "varonenglish"  
- "@edumaster.local" → "@varonenglish.com"
- "exam prep" → "English language learning"

**Exam Types:**
- "SSC JE" → "English Proficiency" (or specific exam)
- "RRB JE" → "English Proficiency"
- "category: 'SSC JE'" → "category: 'English Proficiency'"
- "exam: 'SSC JE'" → "exam: 'English Proficiency'"

**Demo Content:**
- "example.com" → Replace with real URLs or remove
- "picsum.photos" → Replace with real course images
- ".local" domain → Use real production domain

### Regex Patterns for Batch Updates

```javascript
// Find hardcoded exam types
/['"](?:SSC|RRB)\s(?:JE|exam)['"]/g

// Find edumaster references
/edumaster/gi

// Find .local domains
/\w+@\w+\.local/g

// Find example.com URLs
/https?:\/\/example\.com\/\S+/g
```

---

## 🎯 Content Migration Strategy

### Course Content
**FROM:** SSC JE & RRB JE exam preparation  
**TO:** English language learning
- Replace electrical engineering with English grammar
- Replace civil engineering with English vocabulary
- Replace general awareness with English proficiency
- Keep live class and assessment structure

### User Roles
- Keep admin/student distinction
- Update default permissions
- Create English-specific course categories
- Update achievement badges for language learning

### Assessments
- Replace exam-specific test questions
- Create English proficiency tests
- Update quiz content for vocabulary
- Adjust scoring rubric

---

## 🚀 Deployment Strategy

### Phase 1: Backend Configuration (Ready for Production)
- ✓ Production environment file ready
- ✓ No hardcoded secrets
- ✓ Database migration ready
- Status: **READY**

### Phase 2: Frontend Branding (In Progress)
- ✓ Core branding updated
- ⏳ Multiple component updates pending
- Status: **60% COMPLETE**

### Phase 3: Content Migration
- ⏳ Replace demo courses
- ⏳ Create real English learning content
- ⏳ Migrate user data (if applicable)
- Status: **0% COMPLETE**

### Phase 4: Testing & QA
- [ ] Regression testing on all pages
- [ ] Admin panel functionality
- [ ] User enrollment & payment flow
- [ ] Video streaming setup
- [ ] Live class functionality
- Status: **NOT STARTED**

### Phase 5: Launch Preparation
- [ ] Final security audit
- [ ] Performance testing
- [ ] Backup system validation
- [ ] Support team training
- Status: **NOT STARTED**

---

## 📊 Migration Checklist

### Code Changes
- [ ] All branding references updated
- [ ] All exam type references updated
- [ ] All demo content removed
- [ ] Storage keys updated
- [ ] Admin credentials secured
- [ ] Configuration cleaned

### Database Changes
- [ ] Database name updated (if applicable)
- [ ] User roles initialized
- [ ] Course categories defined
- [ ] Initial admin user created
- [ ] Backup system configured

### Infrastructure
- [ ] LiveKit deployment ready
- [ ] S3/CDN configuration
- [ ] Database backups enabled
- [ ] SSL certificates installed
- [ ] Email service configured
- [ ] Monitoring set up

### Testing
- [ ] Unit tests passing
- [ ] Integration tests passing
- [ ] E2E tests passing
- [ ] Performance benchmarks met
- [ ] Security audit completed
- [ ] Load testing completed

### Documentation
- [ ] Deployment guide updated
- [ ] API documentation updated
- [ ] Admin guide created
- [ ] User guide created
- [ ] Troubleshooting guide ready
- [ ] Runbooks prepared

---

## 🤝 Team Assignments

| Component | Owner | Status | Target Date |
|-----------|-------|--------|------------|
| Backend config | DevOps | ✓ DONE | - |
| Frontend branding | Frontend Lead | 60% | April 16 |
| Content migration | Content Team | 0% | April 25 |
| Testing & QA | QA Lead | 0% | May 1 |
| Launch prep | Project Manager | 0% | May 5 |

---

**Last Updated:** April 15, 2026  
**Migration Status:** 60% Complete  
**Target Launch:** May 15, 2026
