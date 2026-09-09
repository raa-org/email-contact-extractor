/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import type { Db } from './connection.js';
import { getDb } from './singleton.js';

export type Direction = 'in' | 'out' | 'self';

export interface MessageRow {
  readonly id: number;
  readonly accountId: number;
  readonly folderId: number;
  readonly uid: number;
  readonly messageId: string | null;
  readonly inReplyTo: string | null;
  readonly references: readonly string[] | null;
  readonly dateUtc: number | null;
  readonly fromAddr: string | null;
  readonly fromName: string | null;
  readonly to: readonly string[] | null;
  readonly cc: readonly string[] | null;
  readonly subject: string | null;
  readonly hasListUnsubscribe: boolean;
  readonly hasListId: boolean;
  readonly hasInlineUnsubscribe: boolean;
  readonly precedence: string | null;
  readonly autoSubmitted: string | null;
  readonly direction: Direction;
}

export interface NewMessage {
  readonly accountId: number;
  readonly folderId: number;
  readonly uid: number;
  readonly messageId?: string | null;
  readonly inReplyTo?: string | null;
  readonly references?: readonly string[] | null;
  readonly dateUtc?: number | null;
  readonly fromAddr?: string | null;
  readonly fromName?: string | null;
  readonly to?: readonly string[] | null;
  readonly cc?: readonly string[] | null;
  readonly subject?: string | null;
  readonly hasListUnsubscribe?: boolean;
  readonly hasListId?: boolean;
  readonly hasInlineUnsubscribe?: boolean;
  readonly precedence?: string | null;
  readonly autoSubmitted?: string | null;
  readonly direction: Direction;
}

interface RawMessageRow {
  id: number;
  account_id: number;
  folder_id: number;
  uid: number;
  message_id: string | null;
  in_reply_to: string | null;
  references_json: string | null;
  date_utc: number | null;
  from_addr: string | null;
  from_name: string | null;
  to_json: string | null;
  cc_json: string | null;
  subject: string | null;
  has_list_unsubscribe: number;
  has_list_id: number;
  has_inline_unsubscribe: number;
  precedence: string | null;
  auto_submitted: string | null;
  direction: Direction;
}

function toMessageRow(raw: RawMessageRow): MessageRow {
  return {
    id: raw.id,
    accountId: raw.account_id,
    folderId: raw.folder_id,
    uid: raw.uid,
    messageId: raw.message_id,
    inReplyTo: raw.in_reply_to,
    references: raw.references_json ? (JSON.parse(raw.references_json) as string[]) : null,
    dateUtc: raw.date_utc,
    fromAddr: raw.from_addr,
    fromName: raw.from_name,
    to: raw.to_json ? (JSON.parse(raw.to_json) as string[]) : null,
    cc: raw.cc_json ? (JSON.parse(raw.cc_json) as string[]) : null,
    subject: raw.subject,
    hasListUnsubscribe: raw.has_list_unsubscribe === 1,
    hasListId: raw.has_list_id === 1,
    hasInlineUnsubscribe: raw.has_inline_unsubscribe === 1,
    precedence: raw.precedence,
    autoSubmitted: raw.auto_submitted,
    direction: raw.direction,
  };
}

const INSERT_MESSAGE_SQL = `
  INSERT INTO messages (
    account_id, folder_id, uid, message_id, in_reply_to, references_json,
    date_utc, from_addr, from_name, to_json, cc_json, subject,
    has_list_unsubscribe, has_list_id, has_inline_unsubscribe,
    precedence, auto_submitted, direction
  ) VALUES (
    @accountId, @folderId, @uid, @messageId, @inReplyTo, @referencesJson,
    @dateUtc, @fromAddr, @fromName, @toJson, @ccJson, @subject,
    @hasListUnsubscribe, @hasListId, @hasInlineUnsubscribe,
    @precedence, @autoSubmitted, @direction
  )
  ON CONFLICT (folder_id, uid) DO NOTHING
`;

interface MessageInsertParams {
  accountId: number;
  folderId: number;
  uid: number;
  messageId: string | null;
  inReplyTo: string | null;
  referencesJson: string | null;
  dateUtc: number | null;
  fromAddr: string | null;
  fromName: string | null;
  toJson: string | null;
  ccJson: string | null;
  subject: string | null;
  hasListUnsubscribe: number;
  hasListId: number;
  hasInlineUnsubscribe: number;
  precedence: string | null;
  autoSubmitted: string | null;
  direction: Direction;
}

function toInsertParams(msg: NewMessage): MessageInsertParams {
  return {
    accountId: msg.accountId,
    folderId: msg.folderId,
    uid: msg.uid,
    messageId: msg.messageId ?? null,
    inReplyTo: msg.inReplyTo ?? null,
    referencesJson: msg.references ? JSON.stringify(msg.references) : null,
    dateUtc: msg.dateUtc ?? null,
    fromAddr: msg.fromAddr ?? null,
    fromName: msg.fromName ?? null,
    toJson: msg.to ? JSON.stringify(msg.to) : null,
    ccJson: msg.cc ? JSON.stringify(msg.cc) : null,
    subject: msg.subject ?? null,
    hasListUnsubscribe: msg.hasListUnsubscribe ? 1 : 0,
    hasListId: msg.hasListId ? 1 : 0,
    hasInlineUnsubscribe: msg.hasInlineUnsubscribe ? 1 : 0,
    precedence: msg.precedence ?? null,
    autoSubmitted: msg.autoSubmitted ?? null,
    direction: msg.direction,
  };
}

// Pass 2 of deep scan flips the bit on a per-message row after the body has
// been encrypted-and-stored and matched against the inline-unsubscribe regex.
// Single-row update (one statement per message) — set is small (kept-
// candidates only), so the simple form wins over a batch UPDATE…IN form.
export function updateMessageInlineUnsubscribe(
  db: Db,
  messageId: number,
  hasInlineUnsubscribe: boolean,
): void {
  db.prepare<[number, number]>(
    'UPDATE messages SET has_inline_unsubscribe = ? WHERE id = ?',
  ).run(hasInlineUnsubscribe ? 1 : 0, messageId);
}

export function insertMessage(db: Db, msg: NewMessage): number {
  const stmt = db.prepare<MessageInsertParams>(INSERT_MESSAGE_SQL);
  const result = stmt.run(toInsertParams(msg));
  return result.changes;
}

export interface BulkInsertResult {
  readonly inserted: number;
  readonly skipped: number;
}

export function bulkInsertMessages(db: Db, msgs: readonly NewMessage[]): BulkInsertResult {
  if (msgs.length === 0) return { inserted: 0, skipped: 0 };
  const stmt = db.prepare<MessageInsertParams>(INSERT_MESSAGE_SQL);
  let inserted = 0;
  const tx = db.transaction((rows: readonly NewMessage[]): void => {
    for (const r of rows) {
      const result = stmt.run(toInsertParams(r));
      if (result.changes > 0) inserted += 1;
    }
  });
  tx(msgs);
  return { inserted, skipped: msgs.length - inserted };
}

// Like bulkInsertMessages, but DOES NOT open its own transaction. Useful when
// the caller manages a wider transaction (e.g. one transaction per folder).
export function bulkInsertMessagesInline(
  db: Db,
  msgs: readonly NewMessage[],
): BulkInsertResult {
  if (msgs.length === 0) return { inserted: 0, skipped: 0 };
  const stmt = db.prepare<MessageInsertParams>(INSERT_MESSAGE_SQL);
  let inserted = 0;
  for (const r of msgs) {
    const result = stmt.run(toInsertParams(r));
    if (result.changes > 0) inserted += 1;
  }
  return { inserted, skipped: msgs.length - inserted };
}

export function getByMessageId(db: Db, messageId: string): MessageRow | null {
  const stmt = db.prepare<[string], RawMessageRow>(
    'SELECT * FROM messages WHERE message_id = ? LIMIT 1',
  );
  const raw = stmt.get(messageId);
  return raw ? toMessageRow(raw) : null;
}

export function getByFolderUid(db: Db, folderId: number, uid: number): MessageRow | null {
  const stmt = db.prepare<[number, number], RawMessageRow>(
    'SELECT * FROM messages WHERE folder_id = ? AND uid = ?',
  );
  const raw = stmt.get(folderId, uid);
  return raw ? toMessageRow(raw) : null;
}

export function countByAccount(db: Db, accountId: number): number {
  const stmt = db.prepare<[number], { c: number }>(
    'SELECT COUNT(*) AS c FROM messages WHERE account_id = ?',
  );
  const row = stmt.get(accountId);
  return row?.c ?? 0;
}

// Read every UID we currently hold for a folder. Used by the live UID
// sync phase in `ingestFolder` to compute (cached − live) → stale
// messages whose source disappeared (expunge / move).
export function listCachedUidsByFolder(db: Db, folderId: number): Set<number> {
  const stmt = db.prepare<[number], { uid: number }>(
    'SELECT uid FROM messages WHERE folder_id = ?',
  );
  return new Set(stmt.all(folderId).map((r) => r.uid));
}

// Bulk-delete cached message rows by `(folder_id, uid)`. SQLite doesn't
// allow a parameterised list of arbitrary length, so we expand the IN
// clause once per call. `message_bodies` rows cascade via the
// ON DELETE CASCADE FK introduced in migration 006.
//
// Chunked at 500 to stay well below SQLite's default
// SQLITE_MAX_VARIABLE_NUMBER (32766) — we'd need a 50k-folder full
// purge to come close, but chunking is cheap insurance.
export function deleteMessagesByUids(
  db: Db,
  folderId: number,
  uids: readonly number[],
): void {
  if (uids.length === 0) return;
  const chunkSize = 500;
  for (let i = 0; i < uids.length; i += chunkSize) {
    const chunk = uids.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => '?').join(',');
    db.prepare<unknown[]>(
      `DELETE FROM messages WHERE folder_id = ? AND uid IN (${placeholders})`,
    ).run(folderId, ...chunk);
  }
}

// Helper for the scoping pattern shared by the read helpers below: when the
// caller wants strict scope (only messages from a given subset of folders)
// they pass a non-empty `folderIds`. We generate `AND folder_id IN (?, ?, ?)`
// with one placeholder per id and the caller appends the ids to the bind
// list. `undefined` or an empty set means "unscoped" — keeps drill-down /
// account-wide call sites byte-identical to before.
function inFolderClause(folderIds: ReadonlySet<number> | undefined): {
  sql: string;
  binds: number[];
} {
  if (!folderIds || folderIds.size === 0) return { sql: '', binds: [] };
  const binds = [...folderIds];
  return { sql: ` AND folder_id IN (${binds.map(() => '?').join(',')})`, binds };
}

export function* iterateByAccount(
  db: Db,
  accountId: number,
  folderIds?: ReadonlySet<number>,
): IterableIterator<MessageRow> {
  const scope = inFolderClause(folderIds);
  const stmt = db.prepare<unknown[], RawMessageRow>(
    `SELECT * FROM messages WHERE account_id = ?${scope.sql} ORDER BY id ASC`,
  );
  for (const raw of stmt.iterate(accountId, ...scope.binds)) {
    yield toMessageRow(raw);
  }
}

// Newest-first sample of messages whose from_addr equals (case-insensitive,
// already-normalized) the given email. Capped at `limit` rows. Used by the
// classifier to inspect a few representative messages per contact.
//
// `folderIds` (optional, non-empty) restricts the sample to those folders so
// the classifier sees only in-scope context. Without it, the classifier
// could "save" a contact based on an out-of-scope live message.
export function getSamplesByFromAddr(
  db: Db,
  accountId: number,
  fromAddr: string,
  limit: number,
  folderIds?: ReadonlySet<number>,
): MessageRow[] {
  const scope = inFolderClause(folderIds);
  const stmt = db.prepare<unknown[], RawMessageRow>(
    `SELECT * FROM messages
     WHERE account_id = ? AND from_addr = ?${scope.sql}
     ORDER BY date_utc DESC NULLS LAST
     LIMIT ?`,
  );
  return stmt.all(accountId, fromAddr, ...scope.binds, limit).map(toMessageRow);
}

// Chunk size for `IN (...)` bind lists. SQLite's default
// `SQLITE_LIMIT_VARIABLE_NUMBER` is 32 766 on modern builds. Each bulk
// helper below may bind the email list more than once in a single
// statement (`UNION ALL` over to_json/cc_json doubles it; an
// outer-query reuse triples it). 5 000 is a conservative cap that
// stays well under the SQLite ceiling for any reasonable combination
// of email-list reuse + scope (folder) bindings. The scan that hit
// this on a real mailbox had 38 471 addresses — one chunk per ~5 000
// = 8 chunks, each prepare+run is single-digit ms, the total overhead
// is well under 100 ms.
const IN_CLAUSE_CHUNK_SIZE = 5000;

function chunked<T>(arr: readonly T[], size: number): T[][] {
  if (arr.length <= size) return [Array.from(arr)];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Bulk variant of `getSamplesByFromAddr` — fetches top-`limit` newest
// messages for ALL given from-addresses in a single round-trip per
// chunk, using SQLite's `ROW_NUMBER() OVER (PARTITION BY from_addr
// ORDER BY date_utc DESC)` window function. Returns a Map keyed by
// from_addr; addresses with no matching rows are absent from the map.
// Caller iterates the addresses they care about and falls back to `[]`
// on miss.
//
// Why a Map: the classifier iterates per-address and wants O(1) lookup
// into "the samples for this email". Building the Map once is far
// cheaper than the previous N+1 (one SELECT per address × thousands of
// addresses spent 4+ seconds in `samples_ms` on the 100k bench).
//
// `from_addr IN (?, ?, ?)` is expanded inline, chunked by
// `IN_CLAUSE_CHUNK_SIZE` so a 100k-mailbox / 38k-contact scan doesn't
// blow past SQLite's variable-count limit. Each address falls into
// exactly one chunk, so `ROW_NUMBER()` partitioning is correct chunk-
// by-chunk and the Map merge is just append.
export function getSamplesByFromAddrsBulk(
  db: Db,
  accountId: number,
  emails: readonly string[],
  limit: number,
  folderIds?: ReadonlySet<number>,
): Map<string, MessageRow[]> {
  const out = new Map<string, MessageRow[]>();
  if (emails.length === 0) return out;
  const scope = inFolderClause(folderIds);
  for (const chunk of chunked(emails, IN_CLAUSE_CHUNK_SIZE)) {
    const emailPlaceholders = chunk.map(() => '?').join(',');
    const stmt = db.prepare<unknown[], RawMessageRow>(
      `SELECT * FROM (
         SELECT *, ROW_NUMBER() OVER (
           PARTITION BY from_addr
           ORDER BY date_utc DESC NULLS LAST, id DESC
         ) AS rn
         FROM messages
         WHERE account_id = ?
           AND from_addr IS NOT NULL
           AND from_addr IN (${emailPlaceholders})${scope.sql}
       )
       WHERE rn <= ?
       ORDER BY from_addr ASC, rn ASC`,
    );
    for (const raw of stmt.all(accountId, ...chunk, ...scope.binds, limit)) {
      const row = toMessageRow(raw);
      const key = row.fromAddr ?? '';
      let arr = out.get(key);
      if (!arr) {
        arr = [];
        out.set(key, arr);
      }
      arr.push(row);
    }
  }
  return out;
}

export interface MessageWithFolder extends MessageRow {
  readonly folderPath: string;
}

interface RawMessageWithFolderRow extends RawMessageRow {
  folder_path: string;
}

// All cached messages where the given (already-normalized) email participated
// as the contact. Mirrors rebuildAddressesAggregate (scan-runner.ts) so the
// drill-down sees exactly the messages that built the aggregate:
//   direction='in'  → from_addr matches
//   direction='out' → to_json or cc_json contains the email
//   direction='self' → excluded (drafts/notes the user wrote to themselves)
//
// JS-side dedup by message_id is left to the caller — this matches the
// aggregator's "first-seen wins" behavior for Gmail All-Mail duplicates.
export function listMessagesForContact(
  db: Db,
  accountId: number,
  emailNormalized: string,
  limit: number,
  folderIds?: ReadonlySet<number>,
): MessageWithFolder[] {
  const needle = `"${emailNormalized}"`;
  const scope = inFolderClause(folderIds);
  const scopedM = scope.sql.replace(' AND folder_id IN', ' AND m.folder_id IN');
  const stmt = db.prepare<unknown[], RawMessageWithFolderRow>(
    `SELECT m.*, f.path AS folder_path
     FROM messages m
     JOIN folders f ON f.id = m.folder_id
     WHERE m.account_id = ?
       AND m.direction != 'self'
       AND (
         (m.direction = 'in'  AND m.from_addr = ?) OR
         (m.direction = 'out' AND (m.to_json LIKE '%' || ? || '%' OR m.cc_json LIKE '%' || ? || '%'))
       )${scopedM}
     ORDER BY m.date_utc DESC NULLS LAST
     LIMIT ?`,
  );
  return stmt
    .all(accountId, emailNormalized, needle, needle, ...scope.binds, limit)
    .map((raw) => ({ ...toMessageRow(raw), folderPath: raw.folder_path }));
}

// Bulk variant of `listMessagesForContact` — collects every cached
// message that a participant in `emails` was part of, across ALL given
// emails, in a single round-trip. Used by the deep-scan target
// collection (body-scan.ts) which previously did one SELECT per
// kept-candidate contact and burned ~3.4 s on the 1528-contact bench.
//
// Direction semantics mirror the per-email helper:
//   • 'in' rows match when `from_addr IN emails`
//   • 'out' rows match when any `to_json`/`cc_json` entry IS IN emails
//     (the `json_each` expansion runs once over outbound rows).
//
// Returns a Map keyed by the matched email so the caller can dedup
// per-contact while still streaming a single result set out of SQLite.
// Per-contact cap (`limitPerEmail`) is applied JS-side after sort —
// expressing it in SQL would require another window function plus a
// per-email partitioning expression that doesn't translate cleanly
// across both directions.
export function listMessagesForContactsBulk(
  db: Db,
  accountId: number,
  emails: readonly string[],
  limitPerEmail: number,
  folderIds?: ReadonlySet<number>,
): Map<string, MessageWithFolder[]> {
  const out = new Map<string, MessageWithFolder[]>();
  if (emails.length === 0) return out;
  const scope = inFolderClause(folderIds);
  const scopedM = scope.sql.replace(' AND folder_id IN', ' AND m.folder_id IN');

  function consume(rows: Iterable<RawMessageWithFolderRow & { matched_email: string }>): void {
    for (const raw of rows) {
      const key = raw.matched_email;
      if (typeof key !== 'string' || key.length === 0) continue;
      let bucket = out.get(key);
      if (!bucket) {
        bucket = [];
        out.set(key, bucket);
      }
      if (bucket.length >= limitPerEmail) continue;
      const row: MessageWithFolder = {
        ...toMessageRow(raw),
        folderPath: raw.folder_path,
      };
      bucket.push(row);
    }
  }

  // Chunk the email list to stay under SQLite's variable cap. The
  // outbound statement binds `emails` TWICE inside one prepared
  // statement (UNION ALL over to_json + cc_json), so the effective
  // half-budget for each chunk is what matters; `IN_CLAUSE_CHUNK_SIZE`
  // already accounts for the 2-3× multiplier. Each email lands in
  // exactly one chunk, so per-email bucket cap is consistent.
  for (const chunk of chunked(emails, IN_CLAUSE_CHUNK_SIZE)) {
    const emailPlaceholders = chunk.map(() => '?').join(',');
    // Inbound branch: from_addr ∈ chunk. One row → one match.
    const inboundStmt = db.prepare<unknown[], RawMessageWithFolderRow & { matched_email: string }>(
      `SELECT m.*, f.path AS folder_path, m.from_addr AS matched_email
       FROM messages m
       JOIN folders f ON f.id = m.folder_id
       WHERE m.account_id = ?
         AND m.direction = 'in'
         AND m.from_addr IN (${emailPlaceholders})${scopedM}
       ORDER BY m.date_utc DESC NULLS LAST`,
    );
    // Outbound branch: at least one `to_json` / `cc_json` entry ∈ chunk.
    // Two separate `json_each` queries UNION ALL'd — `||` over the JSON
    // strings would produce `[][]` (invalid JSON) and break the
    // expansion. `json_each` can multiply a single message into multiple
    // rows when several recipients are in `chunk`; the bucket cap below
    // + the caller's dedup-by-id absorb that.
    const outboundStmt = db.prepare<unknown[], RawMessageWithFolderRow & { matched_email: string }>(
      `SELECT m.*, f.path AS folder_path, je.value AS matched_email
         FROM messages m
         JOIN folders f ON f.id = m.folder_id,
           json_each(COALESCE(m.to_json, '[]')) je
        WHERE m.account_id = ?
          AND m.direction = 'out'
          AND je.value IN (${emailPlaceholders})${scopedM}
       UNION ALL
       SELECT m.*, f.path AS folder_path, je.value AS matched_email
         FROM messages m
         JOIN folders f ON f.id = m.folder_id,
           json_each(COALESCE(m.cc_json, '[]')) je
        WHERE m.account_id = ?
          AND m.direction = 'out'
          AND je.value IN (${emailPlaceholders})${scopedM}
       ORDER BY date_utc DESC NULLS LAST`,
    );
    consume(inboundStmt.all(accountId, ...chunk, ...scope.binds));
    consume(
      outboundStmt.all(
        accountId,
        ...chunk,
        ...scope.binds,
        accountId,
        ...chunk,
        ...scope.binds,
      ),
    );
  }
  return out;
}

export default {
  insert: (msg: NewMessage): number => insertMessage(getDb(), msg),
  bulkInsert: (msgs: readonly NewMessage[]): BulkInsertResult =>
    bulkInsertMessages(getDb(), msgs),
  getByMessageId: (messageId: string): MessageRow | null =>
    getByMessageId(getDb(), messageId),
  getByFolderUid: (folderId: number, uid: number): MessageRow | null =>
    getByFolderUid(getDb(), folderId, uid),
  countByAccount: (accountId: number): number => countByAccount(getDb(), accountId),
  iterateByAccount: (accountId: number): IterableIterator<MessageRow> =>
    iterateByAccount(getDb(), accountId),
  getSamplesByFromAddr: (accountId: number, fromAddr: string, limit: number): MessageRow[] =>
    getSamplesByFromAddr(getDb(), accountId, fromAddr, limit),
  listMessagesForContact: (
    accountId: number,
    emailNormalized: string,
    limit: number,
  ): MessageWithFolder[] =>
    listMessagesForContact(getDb(), accountId, emailNormalized, limit),
  updateMessageInlineUnsubscribe: (id: number, value: boolean): void =>
    updateMessageInlineUnsubscribe(getDb(), id, value),
};
