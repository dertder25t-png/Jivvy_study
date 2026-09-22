-- Outline notes: a second note type where the body is a structured, collapsible bullet
-- tree instead of freeform text. `outline` holds the tree (see src/core/outline.ts for
-- the shape); `body` keeps holding a mirrored nested-markdown rendering of that tree so
-- every existing feature that reads `body` (search, flashcards, word count, export)
-- keeps working unchanged.
alter table public.notes
  add column note_type text not null default 'text' check (note_type in ('text', 'outline')),
  add column outline jsonb;
