/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import Database, { type Database as BetterSqlite3Database } from 'better-sqlite3';
import { runMigrations } from './migrations/runner.js';

export type Db = BetterSqlite3Database;

export interface OpenDbOptions {
  readonly readonly?: boolean;
  readonly migrate?: boolean;
}

export function openDb(path: string, options: OpenDbOptions = {}): Db {
  const db: Db = new Database(path, options.readonly ? { readonly: true } : {});
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  if (options.migrate !== false) {
    runMigrations(db);
  }
  return db;
}

export function closeDb(db: Db): void {
  if (db.open) db.close();
}
