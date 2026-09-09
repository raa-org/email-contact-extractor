-- Initial schema for contact-extractor.
-- Mirrors CLAUDE.md §3. JSON-shaped columns are stored as TEXT.
-- No message body columns — privacy invariant from §9.

CREATE TABLE IF NOT EXISTS accounts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  host              TEXT    NOT NULL,
  username          TEXT    NOT NULL,
  my_addresses_json TEXT    NOT NULL DEFAULT '[]',
  UNIQUE (host, username)
);

CREATE TABLE IF NOT EXISTS folders (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id      INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  path            TEXT    NOT NULL,
  uidvalidity     INTEGER NOT NULL,
  uidnext_seen    INTEGER NOT NULL DEFAULT 0,
  last_scanned_at INTEGER,
  UNIQUE (account_id, path)
);

CREATE INDEX IF NOT EXISTS idx_folders_account ON folders (account_id);

CREATE TABLE IF NOT EXISTS messages (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id           INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  folder_id            INTEGER NOT NULL REFERENCES folders(id)  ON DELETE CASCADE,
  uid                  INTEGER NOT NULL,
  message_id           TEXT,
  in_reply_to          TEXT,
  references_json      TEXT,
  date_utc             INTEGER,
  from_addr            TEXT,
  from_name            TEXT,
  to_json              TEXT,
  cc_json              TEXT,
  subject              TEXT,
  has_list_unsubscribe INTEGER NOT NULL DEFAULT 0,
  precedence           TEXT,
  auto_submitted       TEXT,
  direction            TEXT    NOT NULL CHECK (direction IN ('in', 'out', 'self')),
  UNIQUE (folder_id, uid)
);

CREATE INDEX IF NOT EXISTS idx_messages_message_id ON messages (message_id);
CREATE INDEX IF NOT EXISTS idx_messages_account    ON messages (account_id);
CREATE INDEX IF NOT EXISTS idx_messages_from_addr  ON messages (from_addr);
CREATE INDEX IF NOT EXISTS idx_messages_date_utc   ON messages (date_utc);
CREATE INDEX IF NOT EXISTS idx_messages_direction  ON messages (direction);

CREATE TABLE IF NOT EXISTS addresses (
  email_normalized      TEXT    PRIMARY KEY,
  display_names_json    TEXT    NOT NULL DEFAULT '[]',
  first_seen_utc        INTEGER NOT NULL,
  last_seen_utc         INTEGER NOT NULL,
  count_in              INTEGER NOT NULL DEFAULT 0,
  count_out             INTEGER NOT NULL DEFAULT 0,
  subjects_sample_json  TEXT    NOT NULL DEFAULT '[]',
  tags_json             TEXT    NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_addresses_total       ON addresses ((count_in + count_out));
CREATE INDEX IF NOT EXISTS idx_addresses_last_seen   ON addresses (last_seen_utc);
