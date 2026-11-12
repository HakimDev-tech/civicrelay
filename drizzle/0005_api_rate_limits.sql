CREATE TABLE api_rate_limits (
  key text PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  count integer NOT NULL CHECK (count > 0)
);
