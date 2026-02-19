-- Fix: tags.id has no default, causing NOT NULL violations on insert
ALTER TABLE public.tags
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
