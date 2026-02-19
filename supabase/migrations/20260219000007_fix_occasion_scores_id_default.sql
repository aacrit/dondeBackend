-- Fix: occasion_scores.id has no default, causing NOT NULL violations on insert
ALTER TABLE public.occasion_scores
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
