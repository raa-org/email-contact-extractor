/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import type { Db } from './connection.js';

export interface AddressRow {
  readonly accountId: number;
  readonly emailNormalized: string;
  readonly displayNames: readonly string[];
  readonly firstSeenUtc: number;
  readonly lastSeenUtc: number;
  readonly countIn: number;
  readonly countOut: number;
  readonly subjectsSample: readonly string[];
  readonly tags: readonly string[];
}

export interface AddressUpsertDelta {
  readonly accountId: number;
  readonly emailNormalized: string;
  readonly displayName?: string | null;
  readonly seenUtc: number;
  readonly directionIn: number;
  readonly directionOut: number;
  readonly subject?: string | null;
}

export interface AddressFilter {
  readonly query?: string;
  readonly domains?: readonly string[];
  readonly minTotal?: number;
}

export interface Pagination {
  readonly offset: number;
  readonly limit: number;
}

export const SUBJECTS_SAMPLE_CAP = 10;
export const DISPLAY_NAMES_CAP = 5;

interface RawAddressRow {
  account_id: number;
  email_normalized: string;
  display_names_json: string;
  first_seen_utc: number;
  last_seen_utc: number;
  count_in: number;
  count_out: number;
  subjects_sample_json: string;
  tags_json: string;
}

function toAddressRow(raw: RawAddressRow): AddressRow {
  return {
    accountId: raw.account_id,
    emailNormalized: raw.email_normalized,
    displayNames: JSON.parse(raw.display_names_json) as string[],
    firstSeenUtc: raw.first_seen_utc,
    lastSeenUtc: raw.last_seen_utc,
    countIn: raw.count_in,
    countOut: raw.count_out,
    subjectsSample: JSON.parse(raw.subjects_sample_json) as string[],
    tags: JSON.parse(raw.tags_json) as string[],
  };
}

function appendUnique(existing: readonly string[], next: string | null | undefined, cap: number): string[] {
  if (!next) return [...existing];
  if (existing.includes(next)) return [...existing];
  const merged = [...existing, next];
  return merged.length > cap ? merged.slice(merged.length - cap) : merged;
}

export function upsertAddress(db: Db, delta: AddressUpsertDelta): AddressRow {
  const tx = db.transaction((): RawAddressRow => {
    const existing = db
      .prepare<[number, string], RawAddressRow>(
        'SELECT * FROM addresses WHERE account_id = ? AND email_normalized = ?',
      )
      .get(delta.accountId, delta.emailNormalized);

    if (existing) {
      const displayNames = appendUnique(
        JSON.parse(existing.display_names_json) as string[],
        delta.displayName ?? null,
        DISPLAY_NAMES_CAP,
      );
      const subjects = appendUnique(
        JSON.parse(existing.subjects_sample_json) as string[],
        delta.subject ?? null,
        SUBJECTS_SAMPLE_CAP,
      );
      db.prepare(
        `UPDATE addresses SET
            display_names_json = ?,
            first_seen_utc = MIN(first_seen_utc, ?),
            last_seen_utc = MAX(last_seen_utc, ?),
            count_in = count_in + ?,
            count_out = count_out + ?,
            subjects_sample_json = ?
          WHERE account_id = ? AND email_normalized = ?`,
      ).run(
        JSON.stringify(displayNames),
        delta.seenUtc,
        delta.seenUtc,
        delta.directionIn,
        delta.directionOut,
        JSON.stringify(subjects),
        delta.accountId,
        delta.emailNormalized,
      );
    } else {
      const displayNames = delta.displayName ? [delta.displayName] : [];
      const subjects = delta.subject ? [delta.subject] : [];
      db.prepare(
        `INSERT INTO addresses (
           account_id, email_normalized, display_names_json,
           first_seen_utc, last_seen_utc,
           count_in, count_out,
           subjects_sample_json, tags_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]')`,
      ).run(
        delta.accountId,
        delta.emailNormalized,
        JSON.stringify(displayNames),
        delta.seenUtc,
        delta.seenUtc,
        delta.directionIn,
        delta.directionOut,
        JSON.stringify(subjects),
      );
    }

    const updated = db
      .prepare<[number, string], RawAddressRow>(
        'SELECT * FROM addresses WHERE account_id = ? AND email_normalized = ?',
      )
      .get(delta.accountId, delta.emailNormalized);
    if (!updated) throw new Error('upsertAddress: row missing after write');
    return updated;
  });

  return toAddressRow(tx());
}

export function bulkUpsertAddresses(
  db: Db,
  deltas: readonly AddressUpsertDelta[],
): number {
  if (deltas.length === 0) return 0;
  const tx = db.transaction((rows: readonly AddressUpsertDelta[]): void => {
    for (const r of rows) upsertAddress(db, r);
  });
  tx(deltas);
  return deltas.length;
}

export function getAddress(
  db: Db,
  accountId: number,
  emailNormalized: string,
): AddressRow | null {
  const raw = db
    .prepare<[number, string], RawAddressRow>(
      'SELECT * FROM addresses WHERE account_id = ? AND email_normalized = ?',
    )
    .get(accountId, emailNormalized);
  return raw ? toAddressRow(raw) : null;
}

interface ListResult {
  readonly rows: readonly AddressRow[];
  readonly total: number;
}

export interface AddressUpsertFull {
  readonly emailNormalized: string;
  readonly displayNames: readonly string[];
  readonly firstSeenUtc: number;
  readonly lastSeenUtc: number;
  readonly countIn: number;
  readonly countOut: number;
  readonly subjectsSample: readonly string[];
  readonly tags?: readonly string[];
}

// Replace all addresses FOR ONE ACCOUNT with the given rows, atomically.
// Other accounts' rows are untouched — that's the whole point of the
// per-account scoping. Used by the pipeline after fully re-aggregating
// from the account's messages.
export function replaceAllAddresses(
  db: Db,
  accountId: number,
  rows: readonly AddressUpsertFull[],
): void {
  const tx = db.transaction((batch: readonly AddressUpsertFull[]): void => {
    db.prepare('DELETE FROM addresses WHERE account_id = ?').run(accountId);
    const stmt = db.prepare(
      `INSERT INTO addresses (
         account_id, email_normalized, display_names_json,
         first_seen_utc, last_seen_utc,
         count_in, count_out,
         subjects_sample_json, tags_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const r of batch) {
      stmt.run(
        accountId,
        r.emailNormalized,
        JSON.stringify(r.displayNames),
        r.firstSeenUtc,
        r.lastSeenUtc,
        r.countIn,
        r.countOut,
        JSON.stringify(r.subjectsSample),
        JSON.stringify(r.tags ?? []),
      );
    }
  });
  tx(rows);
}

export function setAddressTags(
  db: Db,
  accountId: number,
  emailNormalized: string,
  tags: readonly string[],
): void {
  db.prepare(
    'UPDATE addresses SET tags_json = ? WHERE account_id = ? AND email_normalized = ?',
  ).run(JSON.stringify(tags), accountId, emailNormalized);
}

// Generator over every address belonging to one account. Memory-friendly
// — better-sqlite3's iterate() streams rows without buffering the result
// set. Other accounts' rows are skipped at the SQL layer.
export function* iterateAllAddresses(
  db: Db,
  accountId: number,
): IterableIterator<AddressRow> {
  const stmt = db.prepare<[number], RawAddressRow>(
    'SELECT * FROM addresses WHERE account_id = ? ORDER BY email_normalized ASC',
  );
  for (const raw of stmt.iterate(accountId)) yield toAddressRow(raw);
}

export function listAddresses(
  db: Db,
  accountId: number,
  filter: AddressFilter = {},
  pagination: Pagination = { offset: 0, limit: 100 },
): ListResult {
  const where: string[] = ['account_id = @accountId'];
  const params: Record<string, string | number> = { accountId };

  if (filter.query) {
    where.push('(email_normalized LIKE @q OR display_names_json LIKE @q)');
    params.q = `%${filter.query}%`;
  }
  if (filter.domains && filter.domains.length > 0) {
    const orParts = filter.domains.map((_d, i) => `email_normalized LIKE @d${i}`);
    filter.domains.forEach((d, i) => {
      params[`d${i}`] = `%@${d.toLowerCase()}`;
    });
    where.push(`(${orParts.join(' OR ')})`);
  }
  if (filter.minTotal !== undefined) {
    where.push('(count_in + count_out) >= @minTotal');
    params.minTotal = filter.minTotal;
  }

  const whereSql = `WHERE ${where.join(' AND ')}`;

  const totalRow = db
    .prepare<typeof params, { c: number }>(
      `SELECT COUNT(*) AS c FROM addresses ${whereSql}`,
    )
    .get(params);
  const total = totalRow?.c ?? 0;

  const listParams = { ...params, limit: pagination.limit, offset: pagination.offset };
  const rows = db
    .prepare<typeof listParams, RawAddressRow>(
      `SELECT * FROM addresses ${whereSql}
       ORDER BY (count_in + count_out) DESC, last_seen_utc DESC
       LIMIT @limit OFFSET @offset`,
    )
    .all(listParams)
    .map(toAddressRow);

  return { rows, total };
}
