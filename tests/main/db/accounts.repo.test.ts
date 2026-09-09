/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest';
import {
  clearPasswordBlob,
  deleteAccount,
  findAccountByHostUsername,
  getAccountById,
  getLastUsedWithPassword,
  getPasswordBlob,
  listAccounts,
  markLastUsed,
  setPasswordBlob,
  upsertAccount,
} from '../../../src/main/db/accounts.repo.js';
import { setupTestDb } from './_helpers.js';

describe('accounts.repo', () => {
  it('inserts a new account and returns the row', () => {
    const db = setupTestDb();
    const row = upsertAccount(db, {
      host: 'imap.example.com',
      username: 'a@example.com',
      myAddresses: ['a@example.com', 'a.alt@example.com'],
    });
    expect(row.id).toBeGreaterThan(0);
    expect(row.host).toBe('imap.example.com');
    expect(row.username).toBe('a@example.com');
    expect(row.myAddresses).toEqual(['a@example.com', 'a.alt@example.com']);
    expect(row.hasPassword).toBe(false);
    expect(row.lastUsedAt).toBeNull();
  });

  it('upsert is idempotent on (host, username) and updates addresses', () => {
    const db = setupTestDb();
    const first = upsertAccount(db, {
      host: 'h',
      username: 'u',
      myAddresses: ['old@x'],
    });
    const second = upsertAccount(db, {
      host: 'h',
      username: 'u',
      myAddresses: ['new@x'],
    });
    expect(second.id).toBe(first.id);
    expect(second.myAddresses).toEqual(['new@x']);
    expect(listAccounts(db)).toHaveLength(1);
  });

  it('upsert preserves an existing password blob and last_used_at', () => {
    // Re-running upsertAccount during a scan must not wipe the saved
    // credential — it only refreshes my_addresses.
    const db = setupTestDb();
    const created = upsertAccount(db, { host: 'h', username: 'u', myAddresses: [] });
    setPasswordBlob(db, created.id, Buffer.from([1, 2, 3]));
    markLastUsed(db, created.id, 1_700_000_000_000);

    const refreshed = upsertAccount(db, {
      host: 'h',
      username: 'u',
      myAddresses: ['me@x'],
    });
    expect(refreshed.hasPassword).toBe(true);
    expect(refreshed.lastUsedAt).toBe(1_700_000_000_000);
    expect(getPasswordBlob(db, created.id)?.equals(Buffer.from([1, 2, 3]))).toBe(true);
  });

  it('persists connection metadata when supplied and exposes booleans', () => {
    const db = setupTestDb();
    const row = upsertAccount(db, {
      host: 'mail.example.com',
      username: 'u@example.com',
      myAddresses: [],
      port: 993,
      tls: true,
      protocol: 'imap',
    });
    expect(row.port).toBe(993);
    expect(row.tls).toBe(true);
    expect(row.protocol).toBe('imap');
  });

  it('upsert without metadata preserves previously saved port/tls/protocol', () => {
    // Scan-pipeline calls upsertAccount with only host/username/myAddresses;
    // it must not wipe the connection metadata the renderer already saved.
    const db = setupTestDb();
    const initial = upsertAccount(db, {
      host: 'h',
      username: 'u',
      myAddresses: [],
      port: 587,
      tls: false,
      protocol: 'smtp',
    });
    const after = upsertAccount(db, {
      host: 'h',
      username: 'u',
      myAddresses: ['me@x'],
    });
    expect(after.id).toBe(initial.id);
    expect(after.port).toBe(587);
    expect(after.tls).toBe(false);
    expect(after.protocol).toBe('smtp');
  });

  it('looks up by id and by (host, username)', () => {
    const db = setupTestDb();
    const created = upsertAccount(db, {
      host: 'h',
      username: 'u',
      myAddresses: [],
    });
    expect(getAccountById(db, created.id)?.id).toBe(created.id);
    expect(getAccountById(db, 9999)).toBeNull();
    expect(findAccountByHostUsername(db, 'h', 'u')?.id).toBe(created.id);
    expect(findAccountByHostUsername(db, 'h', 'missing')).toBeNull();
  });

  it('stores and retrieves the password blob as opaque bytes', () => {
    const db = setupTestDb();
    const created = upsertAccount(db, { host: 'h', username: 'u', myAddresses: [] });
    expect(getPasswordBlob(db, created.id)).toBeNull();

    const blob = Buffer.from('encrypted-bytes', 'utf8');
    setPasswordBlob(db, created.id, blob);

    const fetched = getPasswordBlob(db, created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.equals(blob)).toBe(true);
    expect(getAccountById(db, created.id)?.hasPassword).toBe(true);
  });

  it('clearPasswordBlob nullifies the saved credential', () => {
    const db = setupTestDb();
    const created = upsertAccount(db, { host: 'h', username: 'u', myAddresses: [] });
    setPasswordBlob(db, created.id, Buffer.from([0xab, 0xcd]));
    clearPasswordBlob(db, created.id);
    expect(getPasswordBlob(db, created.id)).toBeNull();
    expect(getAccountById(db, created.id)?.hasPassword).toBe(false);
  });

  it('treats an empty blob as no-password (defense in depth)', () => {
    const db = setupTestDb();
    const created = upsertAccount(db, { host: 'h', username: 'u', myAddresses: [] });
    setPasswordBlob(db, created.id, Buffer.alloc(0));
    expect(getPasswordBlob(db, created.id)).toBeNull();
    expect(getAccountById(db, created.id)?.hasPassword).toBe(false);
  });

  it('markLastUsed records the supplied timestamp', () => {
    const db = setupTestDb();
    const created = upsertAccount(db, { host: 'h', username: 'u', myAddresses: [] });
    markLastUsed(db, created.id, 1_700_000_000_000);
    expect(getAccountById(db, created.id)?.lastUsedAt).toBe(1_700_000_000_000);
  });

  it('getLastUsedWithPassword picks the most recent account that has a saved blob', () => {
    const db = setupTestDb();
    const a = upsertAccount(db, { host: 'h1', username: 'u', myAddresses: [] });
    const b = upsertAccount(db, { host: 'h2', username: 'u', myAddresses: [] });
    const c = upsertAccount(db, { host: 'h3', username: 'u', myAddresses: [] });

    setPasswordBlob(db, a.id, Buffer.from('a'));
    setPasswordBlob(db, b.id, Buffer.from('b'));
    // c has no blob — must be ignored even if its timestamp is newest

    markLastUsed(db, a.id, 100);
    markLastUsed(db, b.id, 300);
    markLastUsed(db, c.id, 999);

    expect(getLastUsedWithPassword(db)?.id).toBe(b.id);
  });

  it('getLastUsedWithPassword returns null when no account has a stored credential', () => {
    const db = setupTestDb();
    const created = upsertAccount(db, { host: 'h', username: 'u', myAddresses: [] });
    markLastUsed(db, created.id, 1_700_000_000_000);
    expect(getLastUsedWithPassword(db)).toBeNull();
  });

  it('deleteAccount removes the row entirely', () => {
    const db = setupTestDb();
    const created = upsertAccount(db, { host: 'h', username: 'u', myAddresses: [] });
    setPasswordBlob(db, created.id, Buffer.from('x'));
    deleteAccount(db, created.id);
    expect(getAccountById(db, created.id)).toBeNull();
    expect(listAccounts(db)).toHaveLength(0);
  });
});
