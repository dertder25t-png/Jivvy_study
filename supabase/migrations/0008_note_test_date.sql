-- A note that's really a flashcard set can carry its own test date, so the
-- days-until-test study pacing (see src/core/learning.ts) works for sets that
-- aren't tied to a syllabus-imported exam.
alter table public.notes add column test_date timestamptz;
