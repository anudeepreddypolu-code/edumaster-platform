-- PostgreSQL reference schema for EduMaster
-- Focused on SSC JE / RRB JE scale, analytics, course access, mock tests, live classes, and payments.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(160) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'student',
  avatar_url TEXT,
  referral_code VARCHAR(32) UNIQUE,
  streak_days INT NOT NULL DEFAULT 0,
  reward_points INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  jwt_session_id VARCHAR(64) NOT NULL,
  device_id VARCHAR(80) NOT NULL,
  device_name VARCHAR(120),
  platform VARCHAR(40),
  ip_address INET,
  user_agent TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, is_active) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE device_activity (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id UUID REFERENCES user_sessions(id) ON DELETE SET NULL,
  event_type VARCHAR(40) NOT NULL,
  event_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(80) NOT NULL UNIQUE,
  exam_type VARCHAR(40) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0
);

CREATE TABLE courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  title VARCHAR(255) NOT NULL,
  slug VARCHAR(255) UNIQUE NOT NULL,
  exam VARCHAR(80) NOT NULL,
  subject VARCHAR(120) NOT NULL,
  level VARCHAR(60) NOT NULL,
  description TEXT NOT NULL,
  instructor_name VARCHAR(120),
  thumbnail_url TEXT,
  price_inr NUMERIC(10,2) NOT NULL DEFAULT 0,
  validity_days INT NOT NULL DEFAULT 365,
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title VARCHAR(160) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0
);

CREATE TABLE lessons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  lesson_type VARCHAR(40) NOT NULL,
  youtube_url TEXT,
  premium_video_url TEXT,
  notes_pdf_url TEXT,
  duration_minutes INT NOT NULL DEFAULT 0,
  is_premium BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  access_type VARCHAR(40) NOT NULL DEFAULT 'course',
  source VARCHAR(40) NOT NULL DEFAULT 'payment',
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  UNIQUE (user_id, course_id)
);

CREATE TABLE watch_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  lesson_id UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  progress_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  progress_seconds INT NOT NULL DEFAULT 0,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, lesson_id)
);

CREATE TABLE test_series (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID REFERENCES courses(id) ON DELETE SET NULL,
  title VARCHAR(255) NOT NULL,
  series_type VARCHAR(40) NOT NULL,
  price_inr NUMERIC(10,2) NOT NULL DEFAULT 0,
  published BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_series_id UUID REFERENCES test_series(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  exam VARCHAR(80) NOT NULL,
  test_type VARCHAR(40) NOT NULL,
  duration_minutes INT NOT NULL,
  total_marks NUMERIC(8,2) NOT NULL,
  negative_marking NUMERIC(6,2) NOT NULL DEFAULT 0,
  published BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id UUID NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  topic_name VARCHAR(160) NOT NULL,
  question_text TEXT NOT NULL,
  option_a TEXT NOT NULL,
  option_b TEXT NOT NULL,
  option_c TEXT,
  option_d TEXT,
  correct_option VARCHAR(1) NOT NULL,
  explanation TEXT,
  marks NUMERIC(6,2) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0
);

CREATE TABLE test_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  test_id UUID NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  score NUMERIC(8,2) NOT NULL DEFAULT 0,
  correct_count INT NOT NULL DEFAULT 0,
  incorrect_count INT NOT NULL DEFAULT 0,
  unattempted_count INT NOT NULL DEFAULT 0,
  percentile NUMERIC(6,2),
  all_india_rank INT,
  time_taken_seconds INT,
  answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  topic_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE daily_quizzes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_date DATE NOT NULL UNIQUE,
  title VARCHAR(255) NOT NULL,
  question_count INT NOT NULL,
  questions JSONB NOT NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE daily_quiz_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  daily_quiz_id UUID NOT NULL REFERENCES daily_quizzes(id) ON DELETE CASCADE,
  score INT NOT NULL DEFAULT 0,
  total INT NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, daily_quiz_id)
);

CREATE TABLE live_classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID REFERENCES courses(id) ON DELETE SET NULL,
  module_id UUID,
  module_title VARCHAR(160),
  chapter_id UUID,
  chapter_title VARCHAR(160),
  title VARCHAR(255) NOT NULL,
  provider VARCHAR(40) NOT NULL,
  room_reference VARCHAR(255),
  scheduled_start_at TIMESTAMPTZ NOT NULL,
  duration_minutes INT NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'scheduled',
  replay_url TEXT,
  chat_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  doubt_solving_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  recording_storage_provider VARCHAR(20),
  recording_storage_path TEXT,
  recording_published_at TIMESTAMPTZ,
  recording_expires_at TIMESTAMPTZ,
  recording_duration_minutes INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE live_replay_access_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  live_class_id UUID NOT NULL REFERENCES live_classes(id) ON DELETE CASCADE,
  access_type VARCHAR(40) NOT NULL DEFAULT 'live-replay',
  expires_at TIMESTAMPTZ NOT NULL,
  max_views INT NOT NULL DEFAULT 2,
  used_views INT NOT NULL DEFAULT 0,
  active_session_id TEXT,
  last_started_at TIMESTAMPTZ,
  last_completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, live_class_id)
);

CREATE TABLE live_chat_messages (
  id BIGSERIAL PRIMARY KEY,
  live_class_id UUID NOT NULL REFERENCES live_classes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(160) NOT NULL,
  billing_cycle VARCHAR(40) NOT NULL,
  price_inr NUMERIC(10,2) NOT NULL,
  feature_list JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_plan_id UUID NOT NULL REFERENCES subscription_plans(id) ON DELETE CASCADE,
  status VARCHAR(30) NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  auto_renew BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id UUID REFERENCES courses(id) ON DELETE SET NULL,
  subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
  provider VARCHAR(30) NOT NULL,
  amount_inr NUMERIC(10,2) NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'INR',
  status VARCHAR(30) NOT NULL,
  provider_reference VARCHAR(255),
  failure_reason TEXT,
  retry_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_type VARCHAR(40) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  delivery_channel VARCHAR(30) NOT NULL DEFAULT 'push',
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referred_email VARCHAR(160) NOT NULL,
  referred_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  reward_points INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ai_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  response TEXT NOT NULL,
  recommendation_type VARCHAR(40) NOT NULL DEFAULT 'coach',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_sessions_user_active ON user_sessions(user_id, is_active);
CREATE INDEX idx_enrollments_user ON enrollments(user_id);
CREATE INDEX idx_watch_history_user_course ON watch_history(user_id, course_id);
CREATE INDEX idx_test_attempts_user_test ON test_attempts(user_id, test_id);
CREATE INDEX idx_daily_quiz_attempts_quiz ON daily_quiz_attempts(daily_quiz_id);
CREATE INDEX idx_notifications_user_read ON notifications(user_id, is_read);
