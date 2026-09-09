/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDb, openDb } from '../../../src/main/db/connection.js';
import { setupTestDb } from './_helpers.js';

describe('openDb', () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
    tmpDirs.length = 0;
  });

  it('enables foreign keys on in-memory db', () => {
    const db = setupTestDb();
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    closeDb(db);
  });

  it('enables WAL on a file-backed db', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cx-conn-'));
    tmpDirs.push(dir);
    const db = openDb(join(dir, 'test.db'));
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    closeDb(db);
  });

  it('runs migrations on open by default', () => {
    const db = setupTestDb();
    const tables = db
      .prepare<[], { name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`,
      )
      .all()
      .map((r) => r.name);
    expect(tables).toContain('accounts');
    expect(tables).toContain('messages');
    closeDb(db);
  });

  it('skips migrations when migrate=false', () => {
    const db = openDb(':memory:', { migrate: false });
    const tables = db
      .prepare<[], { name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table'`,
      )
      .all();
    expect(tables).toHaveLength(0);
    closeDb(db);
  });
});
