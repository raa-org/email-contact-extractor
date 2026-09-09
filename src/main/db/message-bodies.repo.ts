/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import type { Db } from './connection.js';
import type { CredentialCipher } from '../security/safe-storage.js';

// Hard cap on how much of the plain-text body we encrypt and store. 256 KB
// is plenty to capture any unsubscribe CTA while keeping the SQLite file
// reasonable for a 50k+ mailbox. Bytes past the cap are dropped before
// encryption — the `truncated` column on the row records that fact.
export const BODY_CAP_BYTES = 256 * 1024;

export interface NewMessageBody {
  readonly messageId: number;
  readonly plaintext: string;
  // Pre-truncation byte length; surfaces to the UI for size hints, never
  // back to the body itself.
  readonly originalBytes: number;
}

interface RawBodyRow {
  message_id: number;
  body_blob: Buffer;
  bytes: number;
  truncated: number;
  cached_at: number;
}

// Truncates, encrypts via Electron safeStorage, and writes/replaces the row.
// Idempotent on `message_id` (PK) — re-storing a body for the same message
// just refreshes the blob. Returns true on success and false when
// safeStorage isn't available right now (e.g. user locked the keychain
// after the scan started); the caller treats false as "skip this body,
// keep going" rather than crashing the whole pass — never write a body
// blob in the clear.
export function upsertMessageBody(
  db: Db,
  input: NewMessageBody,
  cipher: CredentialCipher,
  now: number,
): boolean {
  if (!cipher.isAvailable()) return false;
  // Truncate by byte length (UTF-8) — string slice is by code units, but
  // for the unsubscribe-detect/word-match haystacks the difference is
  // immaterial; we store an upper-bound number of UTF-8 bytes.
  const truncated = input.originalBytes > BODY_CAP_BYTES;
  const text =
    truncated && input.plaintext.length > BODY_CAP_BYTES
      ? input.plaintext.slice(0, BODY_CAP_BYTES)
      : input.plaintext;
  const blob = cipher.encrypt(text);
  db.prepare<[number, Buffer, number, number, number]>(
    `INSERT INTO message_bodies (message_id, body_blob, bytes, truncated, cached_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(message_id) DO UPDATE
       SET body_blob  = excluded.body_blob,
           bytes      = excluded.bytes,
           truncated  = excluded.truncated,
           cached_at  = excluded.cached_at`,
  ).run(
    input.messageId,
    blob,
    input.originalBytes,
    truncated ? 1 : 0,
    now,
  );
  return true;
}

// Decrypt-and-return helper. Returns null when no row is cached, or when
// safeStorage is currently unavailable (e.g. brand-new user session before
// the first Keychain unlock). Callers in the aggregator treat null as
// "fall back to subject-only matching for this message".
export function getMessageBodyDecrypted(
  db: Db,
  messageId: number,
  cipher: CredentialCipher,
): string | null {
  const row = db
    .prepare<[number], RawBodyRow>(
      'SELECT message_id, body_blob, bytes, truncated, cached_at FROM message_bodies WHERE message_id = ?',
    )
    .get(messageId);
  if (!row) return null;
  if (!cipher.isAvailable()) return null;
  return cipher.decrypt(row.body_blob);
}

// Load every cached body for an account into an in-memory
// Map<message_id, plaintext>. Used by `rebuildAddressesAggregate` on
// the final-pass with-body run to replace what was a per-message
// `getMessageBodyDecrypted` round-trip (effectively N+1 SQL on 100k
// messages → ~2 s of pure SQLite overhead). One SQL + one decrypt
// loop instead, since the rest of the aggregator already keeps all
// addresses in RAM anyway.
//
// `account_id` is recovered via a JOIN on `messages` so a stale
// `message_bodies` row left over from a previous account's scan
// (shouldn't happen — FK with ON DELETE CASCADE — but defence in
// depth) can't leak into this account's filter input.
export function loadAllBodiesDecrypted(
  db: Db,
  accountId: number,
  cipher: CredentialCipher,
): Map<number, string> {
  const out = new Map<number, string>();
  if (!cipher.isAvailable()) return out;
  const rows = db
    .prepare<[number], { message_id: number; body_blob: Buffer }>(
      `SELECT mb.message_id, mb.body_blob
         FROM message_bodies mb
         JOIN messages m ON m.id = mb.message_id
        WHERE m.account_id = ?`,
    )
    .all(accountId);
  for (const r of rows) {
    if (!Buffer.isBuffer(r.body_blob) || r.body_blob.length === 0) continue;
    try {
      out.set(r.message_id, cipher.decrypt(r.body_blob));
    } catch {
      // A single bad blob shouldn't sink the whole pre-load; treat
      // it as "no body" and let the matcher fall through to
      // subject-only filtering for that message.
    }
  }
  return out;
}

// Chunk size for `IN (...)` lookups — kept well under SQLite's
// `SQLITE_LIMIT_VARIABLE_NUMBER` (32 766) so a 100k-mailbox deep scan
// looking up 30k+ cached body ids in one call doesn't blow the cap.
const LIST_CACHED_BODY_IDS_CHUNK = 5000;

// Set of messages_ids that already have a cached body. Used by the deep
// scan to skip messages we've already fetched, so re-running with
// parseBodies enabled doesn't re-fetch from IMAP for messages we have.
export function listCachedBodyIds(
  db: Db,
  messageIds: readonly number[],
): Set<number> {
  const out = new Set<number>();
  if (messageIds.length === 0) return out;
  for (let i = 0; i < messageIds.length; i += LIST_CACHED_BODY_IDS_CHUNK) {
    const chunk = messageIds.slice(i, i + LIST_CACHED_BODY_IDS_CHUNK);
    const placeholders = Array.from({ length: chunk.length }, () => '?').join(',');
    const rows = db
      .prepare<unknown[], { message_id: number }>(
        `SELECT message_id FROM message_bodies WHERE message_id IN (${placeholders})`,
      )
      .all(...chunk);
    for (const r of rows) out.add(r.message_id);
  }
  return out;
}
