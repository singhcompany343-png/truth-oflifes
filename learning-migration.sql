-- Non-destructive additions for Truth.ofLifes learning platform.
-- Back up your PostgreSQL database before applying to production.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS learning_subjects (
 id SERIAL PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, sort_order INT NOT NULL DEFAULT 0, active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS learning_questions (
 id BIGSERIAL PRIMARY KEY, subject_id INT NOT NULL REFERENCES learning_subjects(id), chapter TEXT NOT NULL DEFAULT 'General', question TEXT NOT NULL,
 options JSONB NOT NULL CHECK (jsonb_typeof(options)='array' AND jsonb_array_length(options)=4), correct_index SMALLINT NOT NULL CHECK(correct_index BETWEEN 0 AND 3),
 explanation TEXT NOT NULL DEFAULT '', difficulty TEXT NOT NULL DEFAULT 'basic', active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS learning_questions_subject_idx ON learning_questions(subject_id, active, id);
CREATE TABLE IF NOT EXISTS learning_attempts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id INT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 subject_id INT NOT NULL REFERENCES learning_subjects(id), started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), completed_at TIMESTAMPTZ,
 question_count INT NOT NULL DEFAULT 100, score INT, status TEXT NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress','completed','abandoned'))
);
CREATE TABLE IF NOT EXISTS learning_attempt_items (
 id BIGSERIAL PRIMARY KEY, attempt_id UUID NOT NULL REFERENCES learning_attempts(id) ON DELETE CASCADE,
 question_id BIGINT NOT NULL REFERENCES learning_questions(id) ON DELETE RESTRICT, position INT NOT NULL,
 presented_at TIMESTAMPTZ, answered_at TIMESTAMPTZ, selected_index SMALLINT CHECK(selected_index BETWEEN 0 AND 3), is_correct BOOLEAN,
 UNIQUE(attempt_id, position), UNIQUE(attempt_id, question_id)
);
CREATE TABLE IF NOT EXISTS learning_certificates (
 id BIGSERIAL PRIMARY KEY, user_id INT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 subject_id INT REFERENCES learning_subjects(id), attempt_id UUID REFERENCES learning_attempts(id) ON DELETE RESTRICT,
 certificate_code TEXT UNIQUE NOT NULL, score INT NOT NULL, max_score INT NOT NULL, percentage NUMERIC(5,2) NOT NULL,
 issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), certificate_type TEXT NOT NULL CHECK(certificate_type IN ('subject','all_subjects'))
);
CREATE TABLE IF NOT EXISTS learning_user_status (
 user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT, is_active BOOLEAN NOT NULL DEFAULT TRUE,
 deactivated_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO learning_subjects(slug,name,sort_order) VALUES
('general-anatomy','General Anatomy',1),('physiology','Physiology',2),('biochemistry','Biochemistry',3),('microbiology','Microbiology',4),('pathology','Pathology',5),('pharmacology','Pharmacology',6),('fundamentals-nursing','Fundamentals of Nursing',7),('medical-surgical-nursing','Medical-Surgical Nursing',8),('community-health-nursing','Community Health Nursing',9),('child-health-nursing','Child Health Nursing',10),('obstetrics-gynecology','Obstetrics & Gynecology',11),('mental-health-nursing','Mental Health Nursing',12),('first-aid-emergency-care','First Aid & Emergency Care',13),('nutrition','Nutrition',14),('infection-control','Infection Control',15),('medical-instruments','Medical Instruments',16),('nursing-procedures','Nursing Procedures',17),('ecg-basic-cardiology','ECG & Basic Cardiology',18),('respiratory-system','Respiratory System',19),('medical-terminology','Medical Terminology',20)
ON CONFLICT(slug) DO NOTHING;
COMMIT;
