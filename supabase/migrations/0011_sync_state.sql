-- Cheap cross-device sync. One small row per student whose version goes up whenever any of their
-- data changes (statement-level triggers on every table the app syncs). Each device polls just
-- this row and re-downloads only when it moved because of someone else — instead of re-downloading
-- everything on a timer. `changed_by` is the x-client-id header the app sends, so a device can tell
-- its own changes apart. metric_events is left out: it's write-only logging nothing displays.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.sync_state (
  user_id uuid primary key references public.users (id) on delete cascade,
  version bigint not null default 0,
  changed_by text,
  changed_at timestamptz not null default now()
);

alter table public.sync_state enable row level security;
revoke all on public.sync_state from anon, authenticated;
grant select on public.sync_state to authenticated;
create policy sync_state_read_own on public.sync_state for select to authenticated
  using (user_id = (select auth.uid()));

create or replace function private.bump_sync_state() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    return null; -- server-side maintenance (service role), not a student's device
  end if;
  insert into public.sync_state as s (user_id, version, changed_by, changed_at)
  values (uid, 1, left(nullif(current_setting('request.headers', true), '')::json ->> 'x-client-id', 64), now())
  on conflict (user_id) do update
    set version = s.version + 1, changed_by = excluded.changed_by, changed_at = excluded.changed_at;
  return null;
exception when others then
  return null; -- bookkeeping must never block a student's save
end $$;
revoke execute on function private.bump_sync_state() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'terms', 'courses', 'syllabi', 'grade_components', 'assignments', 'exams', 'exam_coverage', 'quizzes',
    'quiz_coverage', 'course_policies', 'absences', 'topics', 'notes', 'cards', 'card_reviews', 'questions',
    'generation_events', 'waiting_on', 'learn_progress'
  ] loop
    execute format('drop trigger if exists sync_bump on public.%I', t);
    execute format(
      'create trigger sync_bump after insert or update or delete on public.%I for each statement execute function private.bump_sync_state()',
      t);
  end loop;
end $$;
