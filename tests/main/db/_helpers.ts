/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { openDb, type Db } from '../../../src/main/db/connection.js';
import {
  upsertAccount,
  type AccountRow,
} from '../../../src/main/db/accounts.repo.js';
import { upsertFolder, type FolderRow } from '../../../src/main/db/folders.repo.js';
import type { NewMessage } from '../../../src/main/db/messages.repo.js';

export function setupTestDb(): Db {
  return openDb(':memory:');
}

export interface SeedOverrides {
  readonly host?: string;
  readonly username?: string;
  readonly path?: string;
  readonly uidvalidity?: number;
}

export function seedAccountAndFolder(
  db: Db,
  overrides: SeedOverrides = {},
): { account: AccountRow; folder: FolderRow } {
  const username = overrides.username ?? 'tester@example.com';
  const account = upsertAccount(db, {
    host: overrides.host ?? 'imap.example.com',
    username,
    myAddresses: [username],
  });
  const folder = upsertFolder(db, {
    accountId: account.id,
    path: overrides.path ?? 'INBOX',
    uidvalidity: overrides.uidvalidity ?? 12345,
  });
  return { account, folder };
}

export function makeMessage(
  accountId: number,
  folderId: number,
  uid: number,
  overrides: Partial<NewMessage> = {},
): NewMessage {
  return {
    accountId,
    folderId,
    uid,
    messageId: `<msg-${uid}@example.com>`,
    inReplyTo: null,
    references: null,
    dateUtc: 1_700_000_000_000 + uid * 1000,
    fromAddr: `sender${uid}@external.com`,
    fromName: `Sender ${uid}`,
    to: ['tester@example.com'],
    cc: null,
    subject: `Subject ${uid}`,
    hasListUnsubscribe: false,
    precedence: null,
    autoSubmitted: null,
    direction: 'in',
    ...overrides,
  };
}
