-- Add quizzes support (syllabus phaser completion)

create table public.quizzes (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  assignment_id uuid references public.assignments (id) on delete set null,
  title text not null,
  type text, -- online|paper|in_class|other
  frequency text, -- weekly|bi-weekly|as_needed|null
  due_at timestamptz,
  due_is_approximate boolean not null default false,
  points_possible numeric,
  created_at timestamptz not null default now()
);
create index quizzes_course_idx on public.quizzes (course_id);
create index quizzes_due_idx on public.quizzes (due_at);

create table public.quiz_coverage (
  quiz_id uuid not null references public.quizzes (id) on delete cascade,
  topic_id uuid not null references public.topics (id) on delete cascade,
  primary key (quiz_id, topic_id)
);

-- Row-level security
alter table public.quizzes enable row level security;
alter table public.quiz_coverage enable row level security;

create policy "Users can select quizzes for their courses" on public.quizzes
  for select using (
    exists (select 1 from public.courses c where c.id = course_id and c.user_id = auth.uid())
  );

create policy "Users can insert quizzes for their courses" on public.quizzes
  for insert with check (
    exists (select 1 from public.courses c where c.id = course_id and c.user_id = auth.uid())
  );

create policy "Users can update quizzes for their courses" on public.quizzes
  for update using (
    exists (select 1 from public.courses c where c.id = course_id and c.user_id = auth.uid())
  );

create policy "Users can delete quizzes for their courses" on public.quizzes
  for delete using (
    exists (select 1 from public.courses c where c.id = course_id and c.user_id = auth.uid())
  );

create policy "Users can select quiz_coverage for their courses" on public.quiz_coverage
  for select using (
    exists (select 1 from public.quizzes q where q.id = quiz_id and exists (select 1 from public.courses c where c.id = q.course_id and c.user_id = auth.uid()))
  );

create policy "Users can insert quiz_coverage for their courses" on public.quiz_coverage
  for insert with check (
    exists (select 1 from public.quizzes q where q.id = quiz_id and exists (select 1 from public.courses c where c.id = q.course_id and c.user_id = auth.uid()))
  );

create policy "Users can delete quiz_coverage for their courses" on public.quiz_coverage
  for delete using (
    exists (select 1 from public.quizzes q where q.id = quiz_id and exists (select 1 from public.courses c where c.id = q.course_id and c.user_id = auth.uid()))
  );
