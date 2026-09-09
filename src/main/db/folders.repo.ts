/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import type { Db } from './connection.js';
import { getDb } from './singleton.js';

export interface FolderRow {
  readonly id: number;
  readonly accountId: number;
  readonly path: string;
  readonly uidvalidity: number;
  readonly uidnextSeen: number;
  readonly lastScannedAt: number | null;
}

export interface NewFolder {
  readonly accountId: number;
  readonly path: string;
  readonly uidvalidity: number;
}

export interface FolderStateUpdate {
  readonly uidvalidity?: number;
  readonly uidnextSeen?: number;
  readonly lastScannedAt?: number | null;
}

interface RawFolderRow {
  id: number;
  account_id: number;
  path: string;
  uidvalidity: number;
  uidnext_seen: number;
  last_scanned_at: number | null;
}

function toFolderRow(raw: RawFolderRow): FolderRow {
  return {
    id: raw.id,
    accountId: raw.account_id,
    path: raw.path,
    uidvalidity: raw.uidvalidity,
    uidnextSeen: raw.uidnext_seen,
    lastScannedAt: raw.last_scanned_at,
  };
}

export function upsertFolder(db: Db, input: NewFolder): FolderRow {
  const stmt = db.prepare<[number, string, number], RawFolderRow>(`
    INSERT INTO folders (account_id, path, uidvalidity)
    VALUES (?, ?, ?)
    ON CONFLICT (account_id, path) DO UPDATE
      SET uidvalidity = excluded.uidvalidity
    RETURNING id, account_id, path, uidvalidity, uidnext_seen, last_scanned_at
  `);
  const raw = stmt.get(input.accountId, input.path, input.uidvalidity);
  if (!raw) throw new Error('upsertFolder: no row returned');
  return toFolderRow(raw);
}

export function getFolderById(db: Db, id: number): FolderRow | null {
  const stmt = db.prepare<[number], RawFolderRow>(
    'SELECT id, account_id, path, uidvalidity, uidnext_seen, last_scanned_at FROM folders WHERE id = ?',
  );
  const raw = stmt.get(id);
  return raw ? toFolderRow(raw) : null;
}

export function listFoldersByAccount(db: Db, accountId: number): FolderRow[] {
  const stmt = db.prepare<[number], RawFolderRow>(
    'SELECT id, account_id, path, uidvalidity, uidnext_seen, last_scanned_at FROM folders WHERE account_id = ? ORDER BY path ASC',
  );
  return stmt.all(accountId).map(toFolderRow);
}

export function updateFolderState(db: Db, id: number, patch: FolderStateUpdate): void {
  const sets: string[] = [];
  const values: Array<string | number | null> = [];
  if (patch.uidvalidity !== undefined) {
    sets.push('uidvalidity = ?');
    values.push(patch.uidvalidity);
  }
  if (patch.uidnextSeen !== undefined) {
    sets.push('uidnext_seen = ?');
    values.push(patch.uidnextSeen);
  }
  if (patch.lastScannedAt !== undefined) {
    sets.push('last_scanned_at = ?');
    values.push(patch.lastScannedAt);
  }
  if (sets.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE folders SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function deleteFolderRows(db: Db, id: number): void {
  db.prepare('DELETE FROM messages WHERE folder_id = ?').run(id);
}

export default {
  upsert: (input: NewFolder): FolderRow => upsertFolder(getDb(), input),
  getById: (id: number): FolderRow | null => getFolderById(getDb(), id),
  listByAccount: (accountId: number): FolderRow[] => listFoldersByAccount(getDb(), accountId),
  updateState: (id: number, patch: FolderStateUpdate): void =>
    updateFolderState(getDb(), id, patch),
  deleteFolderRows: (id: number): void => deleteFolderRows(getDb(), id),
};
