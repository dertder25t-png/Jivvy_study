-- Test/Quiz question storage and generation

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  topic_id uuid references public.topics (id) on delete set null,
  quiz_id uuid references public.quizzes (id) on delete set null,
  concept text not null,
  question_type text not null check (question_type in ('short_answer', 'essay', 'multiple_choice', 'fill_blank', 'true_false')),
  question_text text not null,
  answer_text text,
  answer_options jsonb, -- ["A", "B", "C", "D"] for multiple choice
  context text,
  difficulty text not null default 'medium' check (difficulty in ('easy', 'medium', 'hard')),
  origin text not null default 'generated' check (origin in ('generated', 'manual')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'edited')),
  source_note_id uuid references public.notes (id) on delete set null,
  source_span_start int,
  source_span_end int,
  created_at timestamptz not null default now()
);
create index questions_user_idx on public.questions (user_id);
create index questions_course_idx on public.questions (course_id);
create index questions_quiz_idx on public.questions (quiz_id);
create index questions_status_idx on public.questions (status);

-- Row-level security
alter table public.questions enable row level security;

create policy "Users can select their own questions" on public.questions
  for select using (user_id = auth.uid());

create policy "Users can insert questions for their courses" on public.questions
  for insert with check (
    user_id = auth.uid() and
    exists (select 1 from public.courses c where c.id = course_id and c.user_id = auth.uid())
  );

create policy "Users can update their own questions" on public.questions
  for update using (user_id = auth.uid());

create policy "Users can delete their own questions" on public.questions
  for delete using (user_id = auth.uid());
