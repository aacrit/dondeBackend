-- Add 19 new neighborhoods for expanded discovery coverage.
-- These match the additions to NEIGHBORHOODS in scripts/lib/config.ts.
-- Uses WHERE NOT EXISTS to safely skip rows that already exist by name.

INSERT INTO neighborhoods (id, name)
SELECT gen_random_uuid(), n.name
FROM (VALUES
  ('Avondale'),
  ('Back of the Yards'),
  ('Bridgeport'),
  ('Bronzeville'),
  ('Edgewater'),
  ('Gold Coast'),
  ('Greektown'),
  ('Humboldt Park'),
  ('Irving Park'),
  ('Lincoln Square'),
  ('Loop'),
  ('North Center'),
  ('Ravenswood'),
  ('Rogers Park'),
  ('South Loop'),
  ('Streeterville'),
  ('Ukrainian Village'),
  ('Uptown'),
  ('Woodlawn')
) AS n(name)
WHERE NOT EXISTS (
  SELECT 1 FROM neighborhoods existing WHERE existing.name = n.name
);
