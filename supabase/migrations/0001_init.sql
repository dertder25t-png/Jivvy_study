-- Study App — initial schema (spec §4)
--
-- Deviations / additions vs. the spec, all deliberate:
--   * users.plan                — needed for the free/paid split (§8); nothing enforces it yet.
--   * courses.meetings          — class meeting times (spec §12.4), needed for time-based note filing (§5.3).
--   * metric_events             — lightweight event log for the §9 metrics (parse edits, comeback shown, ...).
--   * content_cache uniqueness  — keyed on (hash, kind, parse_version, school) rather than hash alone, so a
--                                 parse_version bump or a different school never collides with an old entry.
--   * user_id defaults to auth.uid() so the client never has to send it.

create extension if not exists pgcrypto;

-- ============ IDENTITY ============
create table public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  domain text
);

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text unique,
  school_id uuid references public.schools (id),
  timezone text not null default 'America/Chicago',
  plan text not null default 'free',
  created_at timestamptz not null default now()
);

-- Mirror every new auth user into public.users.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, email) values (new.id, new.email) on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============ COURSE STRUCTURE ============
create table public.terms (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  name text not null,
  starts_on date not null,
  ends_on date not null
);

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  term_id uuid references public.terms (id) on delete set null,
  name text not null,
  code text,
  section text,
  instructor_name text,
  instructor_email text,
  color text not null default '#4F46E5',
  meetings jsonb not null default '[]'::jsonb, -- [{days:["Tue","Thu"], start:"09:30", end:"10:45", location:"..."}]
  created_at timestamptz not null default now()
);
create index courses_user_idx on public.courses (user_id);

create table public.syllabi (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  file_path text,
  content_hash text,
  raw_text text,
  parsed jsonb,
  parse_status text not null default 'pending' check (parse_status in ('pending', 'ok', 'partial', 'failed')),
  parse_version int not null default 1,
  parsed_at timestamptz
);
create index syllabi_course_idx on public.syllabi (course_id);

-- ============ GRADING ============
create table public.grade_components (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  name text not null,
  weight numeric not null check (weight >= 0 and weight <= 1),
  expected_count int,
  drop_lowest int not null default 0,
  source text not null default 'syllabus'
);
create index grade_components_course_idx on public.grade_components (course_id);

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  component_id uuid references public.grade_components (id) on delete set null,
  title text not null,
  type text not null default 'other', -- reading|paper|quiz|exam|discussion|project|other
  due_at timestamptz,
  due_is_approximate boolean not null default false,
  points_possible numeric,
  points_earned numeric,
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'submitted', 'graded', 'dismissed')),
  estimated_minutes int,
  actual_minutes int,
  source text not null default 'syllabus', -- open enum: syllabus|manual|capture|...
  created_at timestamptz not null default now()
);
create index assignments_course_idx on public.assignments (course_id);
create index assignments_due_idx on public.assignments (due_at);

create table public.exams (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  assignment_id uuid references public.assignments (id) on delete set null,
  title text not null,
  happens_at timestamptz not null,
  is_cumulative boolean not null default false,
  location text
);
create index exams_course_idx on public.exams (course_id);

create table public.course_policies (
  course_id uuid primary key references public.courses (id) on delete cascade,
  late_policy jsonb not null default '{}'::jsonb,       -- {accepted, window_hours, penalty_per_day}
  attendance_policy jsonb not null default '{}'::jsonb, -- {allowed_absences, penalty}
  notes text
);

create table public.absences (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  happened_on date not null,
  excused boolean not null default false
);
create index absences_course_idx on public.absences (course_id);

-- ============ TOPIC SCHEDULE (the spine) ============
create table public.topics (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  week_no int,
  starts_on date,
  ends_on date,
  title text not null,
  readings text,
  source text not null default 'syllabus'
);
create index topics_course_idx on public.topics (course_id);

create table public.exam_coverage (
  exam_id uuid not null references public.exams (id) on delete cascade,
  topic_id uuid not null references public.topics (id) on delete cascade,
  primary key (exam_id, topic_id)
);

-- ============ NOTES ============
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  course_id uuid references public.courses (id) on delete set null,
  topic_id uuid references public.topics (id) on delete set null,
  title text,
  body text not null default '',
  captured_via text not null default 'in_app', -- open enum: widget|voice|share|in_app|...
  course_inferred boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index notes_user_idx on public.notes (user_id, created_at desc);
create index notes_course_idx on public.notes (course_id);

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger notes_touch before update on public.notes
  for each row execute function public.touch_updated_at();

-- ============ FLASHCARDS ============
create table public.cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  topic_id uuid references public.topics (id) on delete set null,
  term text not null,
  definition text not null,
  card_type text not null default 'term_def' check (card_type in ('term_def', 'cloze')),
  cloze_text text,
  origin text not null default 'manual' check (origin in ('generated', 'manual')),
  status text not null default 'accepted' check (status in ('pending', 'accepted', 'rejected', 'edited')),
  source_note_id uuid references public.notes (id) on delete set null,
  source_span_start int,
  source_span_end int,
  created_at timestamptz not null default now()
);
create index cards_user_idx on public.cards (user_id);
create index cards_course_idx on public.cards (course_id);

create table public.card_reviews (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards (id) on delete cascade,
  reviewed_at timestamptz not null default now(),
  rating int not null check (rating between 1 and 4), -- 1=again 2=hard 3=good 4=easy
  interval_days numeric not null,
  ease numeric not null,
  due_at timestamptz not null
);
create index card_reviews_card_idx on public.card_reviews (card_id, reviewed_at desc);

-- ============ EVAL DATA (impossible to backfill — collect from day one) ============
create table public.generation_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  card_id uuid references public.cards (id) on delete set null,
  source_note_id uuid references public.notes (id) on delete set null,
  span_start int,
  span_end int,
  candidate_text text not null,
  pattern_type text not null, -- bold_term|colon_def|is_defined_as|heading_body|glossary_row|named_list_item|parenthetical_def
  model text,
  prompt_version text,
  raw_output jsonb,
  auto_rejected_by text,      -- which Stage-3 filter killed it, if any
  user_decision text check (user_decision in ('accepted', 'rejected', 'edited')),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index generation_events_user_idx on public.generation_events (user_id, created_at desc);
create index generation_events_pattern_idx on public.generation_events (pattern_type);

-- ============ SHARED CACHE (service-role only; no client policies) ============
create table public.content_cache (
  id uuid primary key default gen_random_uuid(),
  content_hash text not null,
  kind text not null check (kind in ('syllabus', 'cards')),
  school_id uuid references public.schools (id),
  parse_version text not null,
  payload jsonb not null,
  hit_count int not null default 0,
  created_at timestamptz not null default now()
);
create unique index content_cache_key_idx on public.content_cache
  (content_hash, kind, parse_version, coalesce(school_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ============ LOOSE ENDS ============
create table public.waiting_on (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  course_id uuid references public.courses (id) on delete set null,
  what text not null,
  sent_at timestamptz not null default now(),
  nudge_at timestamptz not null,
  resolved_at timestamptz
);
create index waiting_on_user_idx on public.waiting_on (user_id) where resolved_at is null;

-- ============ METRICS (§9) ============
create table public.metric_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index metric_events_user_idx on public.metric_events (user_id, created_at desc);

-- ============ ROW LEVEL SECURITY ============
create or replace function public.owns_course(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.courses c where c.id = cid and c.user_id = auth.uid())
$$;

create or replace function public.owns_exam(eid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.exams e join public.courses c on c.id = e.course_id
    where e.id = eid and c.user_id = auth.uid())
$$;

create or replace function public.owns_card(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.cards c where c.id = cid and c.user_id = auth.uid())
$$;

alter table public.schools enable row level security;
alter table public.users enable row level security;
alter table public.terms enable row level security;
alter table public.courses enable row level security;
alter table public.syllabi enable row level security;
alter table public.grade_components enable row level security;
alter table public.assignments enable row level security;
alter table public.exams enable row level security;
alter table public.exam_coverage enable row level security;
alter table public.course_policies enable row level security;
alter table public.absences enable row level security;
alter table public.topics enable row level security;
alter table public.notes enable row level security;
alter table public.cards enable row level security;
alter table public.card_reviews enable row level security;
alter table public.generation_events enable row level security;
alter table public.content_cache enable row level security; -- no policies: service role only
alter table public.waiting_on enable row level security;
alter table public.metric_events enable row level security;

create policy schools_read on public.schools for select to authenticated using (true);

create policy users_self on public.users for all to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- user_id-scoped tables
create policy terms_own on public.terms for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy courses_own on public.courses for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notes_own on public.notes for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy cards_own on public.cards for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy generation_events_own on public.generation_events for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy waiting_on_own on public.waiting_on for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy metric_events_own on public.metric_events for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- course-scoped tables
create policy syllabi_own on public.syllabi for all to authenticated
  using (public.owns_course(course_id)) with check (public.owns_course(course_id));
create policy grade_components_own on public.grade_components for all to authenticated
  using (public.owns_course(course_id)) with check (public.owns_course(course_id));
create policy assignments_own on public.assignments for all to authenticated
  using (public.owns_course(course_id)) with check (public.owns_course(course_id));
create policy exams_own on public.exams for all to authenticated
  using (public.owns_course(course_id)) with check (public.owns_course(course_id));
create policy course_policies_own on public.course_policies for all to authenticated
  using (public.owns_course(course_id)) with check (public.owns_course(course_id));
create policy absences_own on public.absences for all to authenticated
  using (public.owns_course(course_id)) with check (public.owns_course(course_id));
create policy topics_own on public.topics for all to authenticated
  using (public.owns_course(course_id)) with check (public.owns_course(course_id));

-- join tables
create policy exam_coverage_own on public.exam_coverage for all to authenticated
  using (public.owns_exam(exam_id)) with check (public.owns_exam(exam_id));
create policy card_reviews_own on public.card_reviews for all to authenticated
  using (public.owns_card(card_id)) with check (public.owns_card(card_id));

-- ============ STORAGE: private bucket for uploaded syllabi, foldered by user id ============
insert into storage.buckets (id, name, public) values ('syllabi', 'syllabi', false)
  on conflict (id) do nothing;

create policy syllabi_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'syllabi' and (storage.foldername(name))[1] = auth.uid()::text);
create policy syllabi_files_select on storage.objects for select to authenticated
  using (bucket_id = 'syllabi' and (storage.foldername(name))[1] = auth.uid()::text);
create policy syllabi_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'syllabi' and (storage.foldername(name))[1] = auth.uid()::text);
