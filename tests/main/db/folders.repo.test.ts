/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest';
import { upsertAccount } from '../../../src/main/db/accounts.repo.js';
import {
  getFolderById,
  listFoldersByAccount,
  updateFolderState,
  upsertFolder,
} from '../../../src/main/db/folders.repo.js';
import { setupTestDb, seedAccountAndFolder, makeMessage } from './_helpers.js';
import { bulkInsertMessages, countByAccount } from '../../../src/main/db/messages.repo.js';

describe('folders.repo', () => {
  it('upsert + getById', () => {
    const db = setupTestDb();
    const acc = upsertAccount(db, { host: 'h', username: 'u', myAddresses: [] });
    const folder = upsertFolder(db, {
      accountId: acc.id,
      path: 'INBOX',
      uidvalidity: 7,
    });
    expect(folder.path).toBe('INBOX');
    expect(folder.uidnextSeen).toBe(0);
    expect(folder.lastScannedAt).toBeNull();
    expect(getFolderById(db, folder.id)?.id).toBe(folder.id);
  });

  it('listByAccount returns folders sorted by path', () => {
    const db = setupTestDb();
    const acc = upsertAccount(db, { host: 'h', username: 'u', myAddresses: [] });
    upsertFolder(db, { accountId: acc.id, path: 'Sent', uidvalidity: 1 });
    upsertFolder(db, { accountId: acc.id, path: 'INBOX', uidvalidity: 1 });
    upsertFolder(db, { accountId: acc.id, path: 'Archive', uidvalidity: 1 });
    expect(listFoldersByAccount(db, acc.id).map((f) => f.path)).toEqual([
      'Archive',
      'INBOX',
      'Sent',
    ]);
  });

  it('updateFolderState patches selected fields', () => {
    const db = setupTestDb();
    const { folder } = seedAccountAndFolder(db);
    updateFolderState(db, folder.id, { uidnextSeen: 1234, lastScannedAt: 999_999 });
    const refreshed = getFolderById(db, folder.id);
    expect(refreshed?.uidnextSeen).toBe(1234);
    expect(refreshed?.lastScannedAt).toBe(999_999);
    expect(refreshed?.uidvalidity).toBe(folder.uidvalidity);
  });

  it('cascades message deletes when account is removed', () => {
    const db = setupTestDb();
    const { account, folder } = seedAccountAndFolder(db);
    bulkInsertMessages(db, [makeMessage(account.id, folder.id, 1)]);
    expect(countByAccount(db, account.id)).toBe(1);
    db.prepare('DELETE FROM accounts WHERE id = ?').run(account.id);
    expect(countByAccount(db, account.id)).toBe(0);
  });
});
