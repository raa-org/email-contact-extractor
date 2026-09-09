-- App-wide key/value settings. Used so far by the export-dialog flow to
-- remember the directory the user last exported into, so subsequent
-- exports default to the same place rather than prompting in a fresh
-- working directory every time.
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER
);
