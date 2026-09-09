-- Scope `addresses` per account.
--
-- Until this migration the addresses table was global, keyed by
-- email_normalized alone. With multi-account use that means scanning
-- account A and then switching to account B (without re-scanning) shows
-- A's contacts. Worse, the next scan from B wipes A's results entirely
-- via replaceAllAddresses' DELETE-then-INSERT pattern.
--
-- We rebuild the table with a composite primary key (account_id,
-- email_normalized) and an FK to accounts. The old global rows can't be
-- assigned to a specific account post-hoc — drop them. Each account's
-- next scan repopulates its own slice. The aggregator is a deterministic
-- function of `messages` (still per-account), so no information is lost.

CREATE TABLE addresses_new (
  account_id            INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  email_normalized      TEXT    NOT NULL,
  display_names_json    TEXT    NOT NULL DEFAULT '[]',
  first_seen_utc        INTEGER NOT NULL,
  last_seen_utc         INTEGER NOT NULL,
  count_in              INTEGER NOT NULL DEFAULT 0,
  count_out             INTEGER NOT NULL DEFAULT 0,
  subjects_sample_json  TEXT    NOT NULL DEFAULT '[]',
  tags_json             TEXT    NOT NULL DEFAULT '[]',
  PRIMARY KEY (account_id, email_normalized)
);

DROP INDEX IF EXISTS idx_addresses_total;
DROP INDEX IF EXISTS idx_addresses_last_seen;
DROP TABLE addresses;
ALTER TABLE addresses_new RENAME TO addresses;

CREATE INDEX idx_addresses_total     ON addresses ((count_in + count_out));
CREATE INDEX idx_addresses_last_seen ON addresses (last_seen_utc);
CREATE INDEX idx_addresses_account   ON addresses (account_id);
