-- Notes can nest under other notes ("sub notes"). Deleting a parent note promotes its
-- children to top-level rather than deleting them (they aren't the parent's data to lose).
alter table public.notes add column parent_note_id uuid references public.notes (id) on delete set null;
create index notes_parent_idx on public.notes (parent_note_id);
