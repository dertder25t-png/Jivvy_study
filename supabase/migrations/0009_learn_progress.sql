-- Learn mode remembers where you left off, on every device: which cards of a set you've
-- finished this round, the pocket you're partway through, and your pocket size / direction.
-- One row per (user, scope). scope_key names the cards being learned: 'note:<id>' for a set,
-- 'exam:<id>', 'course:<id>', 'topic:<id>', combinations joined by '|', or 'all'.
-- It's text rather than a foreign key on purpose — the scope can be any mix of those.
create table public.learn_progress (
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  scope_key text not null,
  pocket_size integer not null check (pocket_size > 0),
  direction text not null default 'term_to_def' check (direction in ('term_to_def', 'def_to_term', 'mixed')),
  done jsonb not null default '{}'::jsonb,   -- card id -> { grade, accuracy, at }
  pocket jsonb not null default '[]'::jsonb, -- card ids of the pocket in progress, in order
  round integer not null default 1,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, scope_key)
);

alter table public.learn_progress enable row level security;

create policy learn_progress_own on public.learn_progress for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
