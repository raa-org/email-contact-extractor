-- Persist enough connection metadata alongside the encrypted password blob
-- to rehydrate Credentials for an auto-resume without a fresh user prompt.
-- Existing rows keep NULL port/tls/protocol — those accounts simply won't
-- have `hasPassword=true` either (they predate saved-credential support).

ALTER TABLE accounts ADD COLUMN port     INTEGER;
ALTER TABLE accounts ADD COLUMN tls      INTEGER;
ALTER TABLE accounts ADD COLUMN protocol TEXT;
