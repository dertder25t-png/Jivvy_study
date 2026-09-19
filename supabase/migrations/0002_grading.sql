-- The college's own grade system is the official record (many schools don't use Canvas for totals),
-- so the student can copy in the official grade, and each course can carry its own grading scale.
--   official_grade: {"percent": 88.4, "letter": "B+", "as_of": "2026-09-19T15:00:00Z"}   (either of percent/letter may be null)
--   grading_scale:  [{"letter":"A","floor":93}, {"letter":"A-","floor":90}, ...]           (null = plain A-F 90/80/70/60)
alter table public.courses
  add column if not exists official_grade jsonb,
  add column if not exists grading_scale jsonb;
