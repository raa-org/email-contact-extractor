/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest';
import { deleteSetting, getSetting, setSetting } from '../../../src/main/db/settings.repo.js';
import { setupTestDb } from './_helpers.js';

describe('settings.repo', () => {
  it('returns null for an unknown key', () => {
    const db = setupTestDb();
    expect(getSetting(db, 'default_export_dir')).toBeNull();
  });

  it('roundtrips a value via setSetting/getSetting', () => {
    const db = setupTestDb();
    setSetting(db, 'default_export_dir', '/Users/me/Downloads');
    expect(getSetting(db, 'default_export_dir')).toBe('/Users/me/Downloads');
  });

  it('upserts on repeated set for the same key', () => {
    const db = setupTestDb();
    setSetting(db, 'default_export_dir', '/first');
    setSetting(db, 'default_export_dir', '/second');
    expect(getSetting(db, 'default_export_dir')).toBe('/second');
  });

  it('stores scan filter preferences with account-scoped keys', () => {
    const db = setupTestDb();
    const keyA = 'scan_filter_prefs:mail.example.com::a@example.com' as const;
    const keyB = 'scan_filter_prefs:mail.example.com::b@example.com' as const;
    const valueA = JSON.stringify({ version: 1, filters: { includeDomains: ['a.com'] } });
    const valueB = JSON.stringify({ version: 1, filters: { includeDomains: ['b.com'] } });

    setSetting(db, keyA, valueA);
    setSetting(db, keyB, valueB);

    expect(getSetting(db, keyA)).toBe(valueA);
    expect(getSetting(db, keyB)).toBe(valueB);
  });

  it('deletes a single scan filter preference override key', () => {
    const db = setupTestDb();
    const keyA = 'scan_filter_prefs:mail.example.com::a@example.com' as const;
    const keyB = 'scan_filter_prefs:mail.example.com::b@example.com' as const;
    setSetting(db, keyA, '{"version":1}');
    setSetting(db, keyB, '{"version":1}');

    deleteSetting(db, keyA);

    expect(getSetting(db, keyA)).toBeNull();
    expect(getSetting(db, keyB)).toBe('{"version":1}');
  });
});
