/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import type { Db } from './connection.js';
import { getDb } from './singleton.js';

export type AccountProtocol = 'imap' | 'smtp';

export interface AccountRow {
  readonly id: number;
  readonly host: string;
  readonly username: string;
  readonly myAddresses: readonly string[];
  readonly hasPassword: boolean;
  readonly lastUsedAt: number | null;
  readonly port: number | null;
  readonly tls: boolean | null;
  readonly protocol: AccountProtocol | null;
}

export interface NewAccount {
  readonly host: string;
  readonly username: string;
  readonly myAddresses: readonly string[];
  // Connection metadata is optional to remain backward-compatible with the
  // pipeline path (which only knows host/username from the active session).
  // It is required when the renderer is explicitly saving a connection.
  readonly port?: number;
  readonly tls?: boolean;
  readonly protocol?: AccountProtocol;
}

interface RawAccountRow {
  id: number;
  host: string;
  username: string;
  my_addresses_json: string;
  password_blob: Buffer | null;
  last_used_at: number | null;
  port: number | null;
  tls: number | null;
  protocol: string | null;
}

const SELECT_COLS =
  'id, host, username, my_addresses_json, password_blob, last_used_at, port, tls, protocol';

function parseProtocol(raw: string | null): AccountProtocol | null {
  if (raw === 'imap' || raw === 'smtp') return raw;
  return null;
}

function toAccountRow(raw: RawAccountRow): AccountRow {
  return {
    id: raw.id,
    host: raw.host,
    username: raw.username,
    myAddresses: JSON.parse(raw.my_addresses_json) as string[],
    hasPassword: raw.password_blob !== null && raw.password_blob.length > 0,
    lastUsedAt: raw.last_used_at,
    port: raw.port,
    tls: raw.tls === null ? null : raw.tls === 1,
    protocol: parseProtocol(raw.protocol),
  };
}

export function upsertAccount(db: Db, input: NewAccount): AccountRow {
  // COALESCE in the UPDATE branch so that callers who only know
  // host/username/myAddresses (e.g. the scan pipeline) don't wipe previously
  // saved port/tls/protocol on every scan run.
  const stmt = db.prepare<
    [string, string, string, number | null, number | null, string | null],
    RawAccountRow
  >(`
    INSERT INTO accounts (host, username, my_addresses_json, port, tls, protocol)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (host, username) DO UPDATE
      SET my_addresses_json = excluded.my_addresses_json,
          port              = COALESCE(excluded.port,     accounts.port),
          tls               = COALESCE(excluded.tls,      accounts.tls),
          protocol          = COALESCE(excluded.protocol, accounts.protocol)
    RETURNING ${SELECT_COLS}
  `);
  const raw = stmt.get(
    input.host,
    input.username,
    JSON.stringify(input.myAddresses),
    input.port ?? null,
    input.tls === undefined ? null : input.tls ? 1 : 0,
    input.protocol ?? null,
  );
  if (!raw) throw new Error('upsertAccount: no row returned');
  return toAccountRow(raw);
}

export function getAccountById(db: Db, id: number): AccountRow | null {
  const stmt = db.prepare<[number], RawAccountRow>(
    `SELECT ${SELECT_COLS} FROM accounts WHERE id = ?`,
  );
  const raw = stmt.get(id);
  return raw ? toAccountRow(raw) : null;
}

export function findAccountByHostUsername(
  db: Db,
  host: string,
  username: string,
): AccountRow | null {
  const stmt = db.prepare<[string, string], RawAccountRow>(
    `SELECT ${SELECT_COLS} FROM accounts WHERE host = ? AND username = ?`,
  );
  const raw = stmt.get(host, username);
  return raw ? toAccountRow(raw) : null;
}

export function listAccounts(db: Db): AccountRow[] {
  const stmt = db.prepare<[], RawAccountRow>(
    `SELECT ${SELECT_COLS} FROM accounts ORDER BY id ASC`,
  );
  return stmt.all().map(toAccountRow);
}

export function setPasswordBlob(db: Db, id: number, blob: Buffer): void {
  db.prepare('UPDATE accounts SET password_blob = ? WHERE id = ?').run(blob, id);
}

export function clearPasswordBlob(db: Db, id: number): void {
  db.prepare('UPDATE accounts SET password_blob = NULL WHERE id = ?').run(id);
}

export function getPasswordBlob(db: Db, id: number): Buffer | null {
  const stmt = db.prepare<[number], { password_blob: Buffer | null }>(
    'SELECT password_blob FROM accounts WHERE id = ?',
  );
  const row = stmt.get(id);
  if (!row || row.password_blob === null || row.password_blob.length === 0) return null;
  return row.password_blob;
}

export function markLastUsed(db: Db, id: number, now: number): void {
  db.prepare('UPDATE accounts SET last_used_at = ? WHERE id = ?').run(now, id);
}

// Pick the most recently used account that still has a saved credential blob.
// Used by the renderer bootstrap to auto-resume the last session.
export function getLastUsedWithPassword(db: Db): AccountRow | null {
  const stmt = db.prepare<[], RawAccountRow>(`
    SELECT ${SELECT_COLS}
    FROM accounts
    WHERE password_blob IS NOT NULL AND last_used_at IS NOT NULL
    ORDER BY last_used_at DESC
    LIMIT 1
  `);
  const raw = stmt.get();
  return raw ? toAccountRow(raw) : null;
}

export function deleteAccount(db: Db, id: number): void {
  db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
}

export default {
  upsert: (input: NewAccount): AccountRow => upsertAccount(getDb(), input),
  getById: (id: number): AccountRow | null => getAccountById(getDb(), id),
  findByHostUsername: (host: string, username: string): AccountRow | null =>
    findAccountByHostUsername(getDb(), host, username),
  list: (): AccountRow[] => listAccounts(getDb()),
  setPasswordBlob: (id: number, blob: Buffer): void =>
    setPasswordBlob(getDb(), id, blob),
  clearPasswordBlob: (id: number): void => clearPasswordBlob(getDb(), id),
  getPasswordBlob: (id: number): Buffer | null => getPasswordBlob(getDb(), id),
  markLastUsed: (id: number, now: number): void => markLastUsed(getDb(), id, now),
  getLastUsedWithPassword: (): AccountRow | null => getLastUsedWithPassword(getDb()),
  delete: (id: number): void => deleteAccount(getDb(), id),
};
