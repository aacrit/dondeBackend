-- Maintenance requests table for Command Center pipeline operations
-- Frontend writes requests; backend worker reads and executes them

CREATE TABLE IF NOT EXISTS maintenance_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation text NOT NULL,
  status text NOT NULL DEFAULT 'pending',  -- pending | running | complete | failed
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  requested_by text NOT NULL DEFAULT 'ceo',
  config jsonb DEFAULT '{}',              -- { dry_run: true, limit: 10 }
  result jsonb,                           -- { rows_affected, errors, summary }
  stages jsonb                            -- [{ name, status, started_at, completed_at, detail }]
);

-- Index for polling active operations
CREATE INDEX idx_maintenance_requests_status ON maintenance_requests(status)
  WHERE status IN ('pending', 'running');

-- Index for recent operations display
CREATE INDEX idx_maintenance_requests_requested_at ON maintenance_requests(requested_at DESC);

-- Enable RLS but allow anon access (admin-only page, auth checked in frontend)
ALTER TABLE maintenance_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon read maintenance_requests" ON maintenance_requests
  FOR SELECT USING (true);

CREATE POLICY "Allow anon insert maintenance_requests" ON maintenance_requests
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow anon update maintenance_requests" ON maintenance_requests
  FOR UPDATE USING (true);
