-- Every note is a bullet outline (nested, collapsible bullet points). `outline` holds the
-- tree (see src/core/outline.ts for the shape); `body` keeps holding a mirrored nested-markdown
-- rendering of that tree so every existing feature that reads `body` (search, flashcards,
-- word count, export) keeps working unchanged.
alter table public.notes add column outline jsonb;
