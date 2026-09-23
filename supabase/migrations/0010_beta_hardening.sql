-- Beta hardening, before inviting more students. Closes the Supabase security advisories and keeps
-- row-level security cheap as the user count grows:
--   * Policies call auth.uid() once per query — (select auth.uid()) — instead of once per row, and
--     course-owned rows are checked with one set lookup instead of a SECURITY DEFINER call per row.
--     With that, the owns_* helpers are gone, so nothing privileged is callable over /rest/v1/rpc.
--   * Not signed in (anon) = no table access at all. Every policy already required a signed-in
--     user; this removes the grants too, including for tables added later.
--   * public.users: a student can read their own row and change only their time zone. Before,
--     they could rewrite plan / email / school_id — claim a paid plan, or take someone else's
--     email so that person's sign-up failed.
--   * content_cache stays server-only (edge functions use the service role).
--   * Trigger functions get a fixed search_path and can't be called directly.
--   * An index behind every foreign key, so deletes and joins stay fast as tables grow.
--   * Syllabus uploads: documents and photos only, up to 12 MB (what parse-syllabus reads).

-- ============ not signed in: nothing ============
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon, public;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon, public;

-- ============ public.users: read your row, change your time zone ============
drop policy if exists users_self on public.users;
create policy users_select_own on public.users for select to authenticated
  using (id = (select auth.uid()));
create policy users_update_own on public.users for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
revoke insert, update, delete, truncate, references, trigger on public.users from authenticated;
grant update (timezone) on public.users to authenticated;

-- Accounts from before the sign-up trigger existed still need their row (idempotent).
insert into public.users (id, email) select id, email from auth.users on conflict (id) do nothing;

-- ============ trigger functions: fixed search_path, not callable over the API ============
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.users (id, email) values (new.id, new.email) on conflict (id) do nothing;
  return new;
end $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;

-- ============ row-level security, rewritten ============
-- Tables with their own user_id.
drop policy if exists terms_own on public.terms;
create policy terms_own on public.terms for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists courses_own on public.courses;
create policy courses_own on public.courses for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists notes_own on public.notes;
create policy notes_own on public.notes for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists cards_own on public.cards;
create policy cards_own on public.cards for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists generation_events_own on public.generation_events;
create policy generation_events_own on public.generation_events for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists waiting_on_own on public.waiting_on;
create policy waiting_on_own on public.waiting_on for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists metric_events_own on public.metric_events;
create policy metric_events_own on public.metric_events for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists learn_progress_own on public.learn_progress;
create policy learn_progress_own on public.learn_progress for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- questions: yours, and (when written) filed under one of your courses. Replaces four policies
-- that applied to the public role.
drop policy if exists "Users can select their own questions" on public.questions;
drop policy if exists "Users can insert questions for their courses" on public.questions;
drop policy if exists "Users can update their own questions" on public.questions;
drop policy if exists "Users can delete their own questions" on public.questions;
create policy questions_own on public.questions for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and course_id in (select c.id from public.courses c where c.user_id = (select auth.uid()))
  );

-- Tables that belong to a course.
drop policy if exists syllabi_own on public.syllabi;
create policy syllabi_own on public.syllabi for all to authenticated
  using (course_id in (select c.id from public.courses c where c.user_id = (select auth.uid())))
  with check (course_id in (select c.id from public.courses c where c.user_id = (select auth.uid())));
drop policy if exists grade_components_own on public.grade_components;
create policy grade_components_own on public.grade_components for all to authenticated
  using (course_id in (select c.id from public.courses c where c.user_id = (select auth.uid())))
  with check (course_id in (select c.id from public.courses c where c.user_id = (select auth.uid())));
drop policy if exists assignments_own on public.assignments;
create policy assignments_own on public.assignments for all to authenticated
  using (course_id in (select c.id from public.courses c where c.user_id = (select auth.uid())))
  with check (course_id in (select c.id from public.courses c where c.user_id = (select auth.uid())));
drop policy if exists exams_own on public.exams;
create policy exams_own on public.exams for all to authenticated
  using (course_id in (select c.id from public.courses c where c.user_id = (select auth.uid())))
  with check (course_id in (select c.id from public.courses c where c.user_id = (select auth.uid())));
drop policy if exists course_policies_own on public.course_policies;
create policy course_policies_own on public.course_policies for all to authenticated
  using (course_id in (select c.id from public.courses c where c.user_id = (select auth.uid())))
  with check (course_id in (select c.id from public.courses c where c.user_id = (select auth.uid())));
drop policy if exists absences_own on public.absences;
create policy absences_own on public.absences for all to authenticated
  using (course_id in (select c.id from public.courses c where c.user_id = (select auth.uid())))
  with check (course_id in (select c.id from public.courses c where c.user_id = (select auth.uid())));
drop policy if exists topics_own on public.topics;
create policy topics_own on public.topics for all to authenticated
  using (course_id in (select c.id from public.courses c where c.user_id = (select auth.uid())))
  with check (course_id in (select c.id from public.courses c where c.user_id = (select auth.uid())));
drop policy if exists "Users can select quizzes for their courses" on public.quizzes;
drop policy if exists "Users can insert quizzes for their courses" on public.quizzes;
drop policy if exists "Users can update quizzes for their courses" on public.quizzes;
drop policy if exists "Users can delete quizzes for their courses" on public.quizzes;
create policy quizzes_own on public.quizzes for all to authenticated
  using (course_id in (select c.id from public.courses c where c.user_id = (select auth.uid())))
  with check (course_id in (select c.id from public.courses c where c.user_id = (select auth.uid())));

-- Join tables.
drop policy if exists exam_coverage_own on public.exam_coverage;
create policy exam_coverage_own on public.exam_coverage for all to authenticated
  using (exam_id in (
    select e.id from public.exams e join public.courses c on c.id = e.course_id where c.user_id = (select auth.uid())))
  with check (exam_id in (
    select e.id from public.exams e join public.courses c on c.id = e.course_id where c.user_id = (select auth.uid())));
drop policy if exists "Users can select quiz_coverage for their courses" on public.quiz_coverage;
drop policy if exists "Users can insert quiz_coverage for their courses" on public.quiz_coverage;
drop policy if exists "Users can delete quiz_coverage for their courses" on public.quiz_coverage;
create policy quiz_coverage_own on public.quiz_coverage for all to authenticated
  using (quiz_id in (
    select q.id from public.quizzes q join public.courses c on c.id = q.course_id where c.user_id = (select auth.uid())))
  with check (quiz_id in (
    select q.id from public.quizzes q join public.courses c on c.id = q.course_id where c.user_id = (select auth.uid())));
drop policy if exists card_reviews_own on public.card_reviews;
create policy card_reviews_own on public.card_reviews for all to authenticated
  using (card_id in (select k.id from public.cards k where k.user_id = (select auth.uid())))
  with check (card_id in (select k.id from public.cards k where k.user_id = (select auth.uid())));

-- Nothing uses these any more.
drop function if exists public.owns_course(uuid);
drop function if exists public.owns_exam(uuid);
drop function if exists public.owns_card(uuid);

-- ============ content_cache: server only ============
revoke all on public.content_cache from anon, authenticated;
drop policy if exists content_cache_server_only on public.content_cache;
create policy content_cache_server_only on public.content_cache for all to service_role using (true) with check (true);

-- ============ an index behind every foreign key ============
create index if not exists assignments_component_idx on public.assignments (component_id);
create index if not exists cards_source_note_idx on public.cards (source_note_id);
create index if not exists cards_topic_idx on public.cards (topic_id);
create index if not exists content_cache_school_idx on public.content_cache (school_id);
create index if not exists courses_term_idx on public.courses (term_id);
create index if not exists exam_coverage_topic_idx on public.exam_coverage (topic_id);
create index if not exists exams_assignment_idx on public.exams (assignment_id);
create index if not exists generation_events_card_idx on public.generation_events (card_id);
create index if not exists generation_events_note_idx on public.generation_events (source_note_id);
create index if not exists notes_topic_idx on public.notes (topic_id);
create index if not exists questions_source_note_idx on public.questions (source_note_id);
create index if not exists questions_topic_idx on public.questions (topic_id);
create index if not exists quiz_coverage_topic_idx on public.quiz_coverage (topic_id);
create index if not exists quizzes_assignment_idx on public.quizzes (assignment_id);
create index if not exists terms_user_idx on public.terms (user_id);
create index if not exists users_school_idx on public.users (school_id);
create index if not exists waiting_on_course_idx on public.waiting_on (course_id);

-- ============ syllabus uploads: documents and photos, 12 MB ============
update storage.buckets
set file_size_limit = 12 * 1024 * 1024,
    allowed_mime_types = array[
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'image/*'
    ]
where id = 'syllabi';
