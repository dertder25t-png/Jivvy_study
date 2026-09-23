-- Learn mode now mixes due reviews of cards you've already learned into each pocket (so nothing
-- learned on day 1 is lost by day 9). A card counts as finished in a pocket when it was graded after
-- the pocket started — so the pocket needs a start time. Null (older rows) = the beginning of time.
alter table public.learn_progress add column if not exists pocket_started_at timestamptz;
