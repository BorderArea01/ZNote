CREATE TABLE IF NOT EXISTS relay_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS relay_pairs (hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS relay_attempts (ip TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS relay_tokens (id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, name TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS relay_jobs (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, request_id TEXT NOT NULL,
 input TEXT NOT NULL, source_url TEXT NOT NULL, title TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued', message TEXT NOT NULL,
 created INTEGER NOT NULL, updated INTEGER NOT NULL, attempt INTEGER NOT NULL DEFAULT 0,
 lease TEXT, lease_until INTEGER NOT NULL DEFAULT 0, local_id TEXT,
 UNIQUE(owner, request_id)
);
CREATE INDEX IF NOT EXISTS relay_jobs_claim ON relay_jobs(status, lease_until, created);
CREATE INDEX IF NOT EXISTS relay_jobs_owner ON relay_jobs(owner, created DESC);
CREATE INDEX IF NOT EXISTS relay_tokens_expiry ON relay_tokens(expires);
