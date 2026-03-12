-- Add grading columns to gauntlet_results for score fit + blurb quality tracking
ALTER TABLE gauntlet_results ADD COLUMN IF NOT EXISTS score_fit_score INT;
ALTER TABLE gauntlet_results ADD COLUMN IF NOT EXISTS score_fit_grade TEXT;
ALTER TABLE gauntlet_results ADD COLUMN IF NOT EXISTS blurb_quality_score INT;
ALTER TABLE gauntlet_results ADD COLUMN IF NOT EXISTS blurb_quality_grade TEXT;
ALTER TABLE gauntlet_results ADD COLUMN IF NOT EXISTS mode TEXT DEFAULT 'full';

-- Add summary grading + source tracking to gauntlet_runs
ALTER TABLE gauntlet_runs ADD COLUMN IF NOT EXISTS avg_score_fit NUMERIC(5,1);
ALTER TABLE gauntlet_runs ADD COLUMN IF NOT EXISTS avg_blurb_quality NUMERIC(5,1);
ALTER TABLE gauntlet_runs ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'dashboard';
