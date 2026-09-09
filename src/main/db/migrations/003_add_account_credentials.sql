-- Persist saved-account credentials. The blob is opaque to the DB layer:
-- callers pass already-encrypted bytes (Electron safeStorage, OS keychain).
-- last_used_at lets the bootstrap flow pick "the last account the user
-- actually connected with" without ambiguity when several are saved.

ALTER TABLE accounts ADD COLUMN password_blob BLOB;
ALTER TABLE accounts ADD COLUMN last_used_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_accounts_last_used ON accounts (last_used_at);
