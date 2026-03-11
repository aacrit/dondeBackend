-- Add grading columns for score validation system
-- Two independent quality grades: score fit (accuracy) and blurb quality (recommendation text)

-- gauntlet_results: per-query grading
ALTER TABLE gauntlet_results ADD COLUMN IF NOT EXISTS score_fit_score INT;
ALTER TABLE gauntlet_results ADD COLUMN IF NOT EXISTS score_fit_grade TEXT;
ALTER TABLE gauntlet_results ADD COLUMN IF NOT EXISTS blurb_quality_score INT;
ALTER TABLE gauntlet_results ADD COLUMN IF NOT EXISTS blurb_quality_grade TEXT;

-- gauntlet_runs: aggregate grading metrics
ALTER TABLE gauntlet_runs ADD COLUMN IF NOT EXISTS avg_score_fit NUMERIC(5,1);
ALTER TABLE gauntlet_runs ADD COLUMN IF NOT EXISTS avg_blurb_quality NUMERIC(5,1);
ALTER TABLE gauntlet_runs ADD COLUMN IF NOT EXISTS grade_pass_count INT;
ALTER TABLE gauntlet_runs ADD COLUMN IF NOT EXISTS grade_distribution JSONB;
