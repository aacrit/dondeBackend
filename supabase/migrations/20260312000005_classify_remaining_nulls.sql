-- Classify final 29 restaurants with NULL cuisine_type
-- Classified from restaurant names, tags, and origin stories. Zero API cost.

-- American (taverns, pubs, comfort food)
UPDATE restaurants SET cuisine_type = 'American', updated_at = now()
WHERE cuisine_type IS NULL AND name IN (
  'Randall''s Pub',
  'Meeting House Tavern',
  'Frank and Mary''s Tavern',
  'Bernice''s Tavern',
  'Fritzy''s Tavern',
  'Barrelman Tavern',
  'Cunneen''s',
  'The Giant Penny Whistle',
  'The Hidden Gem',
  'The River Kitchen and Bar',
  'Brando''s Lincoln Park',
  'Theme House restaurant & karaoke',
  'Cindy''s Rooftop'
);

-- Cocktail Bar (dive bars, lounges, cocktail-focused)
UPDATE restaurants SET cuisine_type = 'Cocktail Bar', updated_at = now()
WHERE cuisine_type IS NULL AND name IN (
  'Esmeralda''s Lounge',
  'The Unforgettable Bar',
  'W. Hideaway Lounge',
  'Mitchell''s Tap',
  'Gold Coast Social',
  'Taylor Street Tap',
  'The Oasis Tavern',
  'The Revel Room',
  'Delilah''s'
);

-- Specific cuisines
UPDATE restaurants SET cuisine_type = 'Japanese', updated_at = now()
WHERE cuisine_type IS NULL AND name = 'Soul Ramen Chicago';

UPDATE restaurants SET cuisine_type = 'Ethiopian', updated_at = now()
WHERE cuisine_type IS NULL AND name = 'MICHUU ETHIOPIAN RESTAURANT';

UPDATE restaurants SET cuisine_type = 'Brunch', updated_at = now()
WHERE cuisine_type IS NULL AND name = 'The Spoke & Bird (Bridgeport)';

UPDATE restaurants SET cuisine_type = 'French', updated_at = now()
WHERE cuisine_type IS NULL AND name = 'Bisous';

UPDATE restaurants SET cuisine_type = 'Seafood', updated_at = now()
WHERE cuisine_type IS NULL AND name = 'Marinero Restaurant + Bar';

UPDATE restaurants SET cuisine_type = 'Latin American', updated_at = now()
WHERE cuisine_type IS NULL AND name = 'Latin Fusion Restaurant';

UPDATE restaurants SET cuisine_type = 'Coffee/Cafe', updated_at = now()
WHERE cuisine_type IS NULL AND name = 'Dope Drip Cafe';
