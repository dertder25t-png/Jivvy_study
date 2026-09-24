-- Learn mode can go through a set in shuffled order. The seed makes the shuffle the same on every
-- device (so a pocket started on the phone continues in the same order on the laptop) and a new seed
-- reshuffles — e.g. when you redo the set. null = the set's own order.
alter table public.learn_progress add column if not exists shuffle_seed text;
