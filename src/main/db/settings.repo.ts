/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import type { Db } from './connection.js';
import { getDb } from './singleton.js';

// Setting keys are intentionally typed as a string-literal union so callers
// don't drift; add new keys here as the surface grows.
export type SettingKey = 'default_export_dir' | `scan_filter_prefs:${string}`;

export function getSetting(db: Db, key: SettingKey): string | null {
  const stmt = db.prepare<[string], { value: string }>(
    'SELECT value FROM settings WHERE key = ?',
  );
  const row = stmt.get(key);
  return row?.value ?? null;
}

export function setSetting(db: Db, key: SettingKey, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE
       SET value      = excluded.value,
           updated_at = excluded.updated_at`,
  ).run(key, value, Date.now());
}

export function deleteSetting(db: Db, key: SettingKey): void {
  db.prepare('DELETE FROM settings WHERE key = ?').run(key);
}

export default {
  get: (key: SettingKey): string | null => getSetting(getDb(), key),
  set: (key: SettingKey, value: string): void => setSetting(getDb(), key, value),
  delete: (key: SettingKey): void => deleteSetting(getDb(), key),
};
