-- Flashcards no longer require a class. A card can be filed under a course later,
-- but studying and organizing cards on their own is a first-class path.
alter table public.cards alter column course_id drop not null;
