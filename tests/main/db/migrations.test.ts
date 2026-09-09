/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest';
import {
  listAppliedMigrations,
  runMigrations,
} from '../../../src/main/db/migrations/runner.js';
import { setupTestDb } from './_helpers.js';

describe('migrations runner', () => {
  it('applies the initial migration', () => {
    const db = setupTestDb();
    expect(listAppliedMigrations(db)).toContain('001_init.sql');
  });

  it('is idempotent across multiple runs', () => {
    const db = setupTestDb();
    const before = listAppliedMigrations(db);
    runMigrations(db);
    runMigrations(db);
    expect(listAppliedMigrations(db)).toEqual(before);
  });

  it('creates the _migrations bookkeeping table', () => {
    const db = setupTestDb();
    const row = db
      .prepare<[], { name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'`,
      )
      .get();
    expect(row?.name).toBe('_migrations');
  });

  it('applies all expected schema tables', () => {
    const db = setupTestDb();
    const tables = new Set(
      db
        .prepare<[], { name: string }>(
          `SELECT name FROM sqlite_master WHERE type='table'`,
        )
        .all()
        .map((r) => r.name),
    );
    for (const t of ['accounts', 'folders', 'messages', 'addresses']) {
      expect(tables.has(t)).toBe(true);
    }
  });

  it('adds saved-credential columns to the accounts table', () => {
    const db = setupTestDb();
    const cols = new Set(
      db
        .prepare<[], { name: string }>(`PRAGMA table_info('accounts')`)
        .all()
        .map((r) => r.name),
    );
    expect(cols.has('password_blob')).toBe(true);
    expect(cols.has('last_used_at')).toBe(true);
    expect(cols.has('port')).toBe(true);
    expect(cols.has('tls')).toBe(true);
    expect(cols.has('protocol')).toBe(true);
  });
});
