-- Seed the 14 Chicago neighborhoods used by the discovery pipeline and recommendation engine.
-- These match the NEIGHBORHOODS array in scripts/lib/config.ts.
-- Without these rows, discovery can't map restaurants and the Edge Function returns empty results.

INSERT INTO neighborhoods (id, name) VALUES
  (gen_random_uuid(), 'Pilsen'),
  (gen_random_uuid(), 'Wicker Park'),
  (gen_random_uuid(), 'Logan Square'),
  (gen_random_uuid(), 'Lincoln Park'),
  (gen_random_uuid(), 'West Loop'),
  (gen_random_uuid(), 'Bucktown'),
  (gen_random_uuid(), 'Hyde Park'),
  (gen_random_uuid(), 'Chinatown'),
  (gen_random_uuid(), 'Little Italy'),
  (gen_random_uuid(), 'Andersonville'),
  (gen_random_uuid(), 'River North'),
  (gen_random_uuid(), 'Old Town'),
  (gen_random_uuid(), 'Lakeview'),
  (gen_random_uuid(), 'Fulton Market')
ON CONFLICT DO NOTHING;
