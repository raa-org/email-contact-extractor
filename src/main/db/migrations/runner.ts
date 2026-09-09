/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

/// <reference types="vite/client" />
import type { Db } from '../connection.js';

const sqlModules = import.meta.glob<string>('./*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
});

interface MigrationFile {
  readonly id: string;
  readonly sql: string;
}

function loadMigrations(): MigrationFile[] {
  return Object.entries(sqlModules)
    .map(([path, sql]) => ({ id: path.replace(/^\.\//, ''), sql }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function runMigrations(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const appliedRows = db.prepare<[], { id: string }>('SELECT id FROM _migrations').all();
  const applied = new Set(appliedRows.map((r) => r.id));

  const insert = db.prepare(
    'INSERT INTO _migrations (id, applied_at) VALUES (?, ?)',
  );

  for (const { id, sql } of loadMigrations()) {
    if (applied.has(id)) continue;
    const tx = db.transaction(() => {
      db.exec(sql);
      insert.run(id, Date.now());
    });
    tx();
  }
}

export function listAppliedMigrations(db: Db): string[] {
  const rows = db
    .prepare<[], { id: string }>('SELECT id FROM _migrations ORDER BY id ASC')
    .all();
  return rows.map((r) => r.id);
}
