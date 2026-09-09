-- Encrypted body cache. Populated only when the user enables Parse
-- Message Bodies. Encryption uses the same Electron safeStorage primitive
-- that backs accounts.password_blob (CLAUDE.md §3); body content is never
-- written to disk in plaintext.
CREATE TABLE IF NOT EXISTS message_bodies (
  message_id  INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  body_blob   BLOB    NOT NULL,
  -- Pre-encryption byte length, for stats/UX only — does NOT leak content.
  bytes       INTEGER NOT NULL,
  -- 1 if the source body was longer than the cap and we stored only the
  -- first BODY_CAP_BYTES bytes of the text/plain part.
  truncated   INTEGER NOT NULL DEFAULT 0,
  cached_at   INTEGER NOT NULL
);

-- Derived metadata bit. Mirrors the existing has_list_unsubscribe / has_list_id
-- columns so the classifier can stay header-only-fast on later scans without
-- re-decrypting the body cache.
ALTER TABLE messages ADD COLUMN has_inline_unsubscribe INTEGER NOT NULL DEFAULT 0;
