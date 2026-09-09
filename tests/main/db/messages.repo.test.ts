/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest';
import {
  bulkInsertMessages,
  countByAccount,
  deleteMessagesByUids,
  getByFolderUid,
  getByMessageId,
  getSamplesByFromAddrsBulk,
  insertMessage,
  iterateByAccount,
  listCachedUidsByFolder,
  listMessagesForContactsBulk,
} from '../../../src/main/db/messages.repo.js';
import {
  upsertMessageBody,
  listCachedBodyIds,
} from '../../../src/main/db/message-bodies.repo.js';
import { makeMessage, seedAccountAndFolder, setupTestDb } from './_helpers.js';

describe('messages.repo', () => {
  it('inserts a single message and reads it back', () => {
    const db = setupTestDb();
    const { account, folder } = seedAccountAndFolder(db);
    const changes = insertMessage(db, makeMessage(account.id, folder.id, 1));
    expect(changes).toBe(1);

    const byMsgId = getByMessageId(db, '<msg-1@example.com>');
    expect(byMsgId).not.toBeNull();
    expect(byMsgId?.uid).toBe(1);
    expect(byMsgId?.direction).toBe('in');

    const byFolderUid = getByFolderUid(db, folder.id, 1);
    expect(byFolderUid?.id).toBe(byMsgId?.id);
  });

  it('round-trips json arrays for to/cc/references', () => {
    const db = setupTestDb();
    const { account, folder } = seedAccountAndFolder(db);
    insertMessage(
      db,
      makeMessage(account.id, folder.id, 1, {
        to: ['a@x.com', 'b@x.com'],
        cc: ['c@x.com'],
        references: ['<root@x>', '<reply@x>'],
      }),
    );
    const row = getByFolderUid(db, folder.id, 1);
    expect(row?.to).toEqual(['a@x.com', 'b@x.com']);
    expect(row?.cc).toEqual(['c@x.com']);
    expect(row?.references).toEqual(['<root@x>', '<reply@x>']);
  });

  it('insert is dedup-safe via UNIQUE(folder_id, uid)', () => {
    const db = setupTestDb();
    const { account, folder } = seedAccountAndFolder(db);
    expect(insertMessage(db, makeMessage(account.id, folder.id, 1))).toBe(1);
    expect(insertMessage(db, makeMessage(account.id, folder.id, 1))).toBe(0);
    expect(countByAccount(db, account.id)).toBe(1);
  });

  it('iterateByAccount yields messages in id order', () => {
    const db = setupTestDb();
    const { account, folder } = seedAccountAndFolder(db);
    bulkInsertMessages(
      db,
      [3, 1, 2].map((uid) => makeMessage(account.id, folder.id, uid)),
    );
    const uids = Array.from(iterateByAccount(db, account.id)).map((m) => m.uid);
    expect(uids).toEqual([3, 1, 2]);
  });

  it('bulkInsert handles 10k rows in a single transaction', () => {
    const db = setupTestDb();
    const { account, folder } = seedAccountAndFolder(db);
    const rows = Array.from({ length: 10_000 }, (_, i) =>
      makeMessage(account.id, folder.id, i + 1),
    );
    const start = performance.now();
    const result = bulkInsertMessages(db, rows);
    const ms = performance.now() - start;
    // eslint-disable-next-line no-console
    console.log(
      `[bench] bulkInsertMessages(${rows.length}) -> ${result.inserted} inserted in ${ms.toFixed(1)}ms (${(rows.length / (ms / 1000)).toFixed(0)} rows/s)`,
    );
    expect(result.inserted).toBe(10_000);
    expect(result.skipped).toBe(0);
    expect(countByAccount(db, account.id)).toBe(10_000);
    expect(ms).toBeLessThan(5_000);
  });

  it('bulkInsert deduplicates against existing rows', () => {
    const db = setupTestDb();
    const { account, folder } = seedAccountAndFolder(db);
    bulkInsertMessages(db, [
      makeMessage(account.id, folder.id, 1),
      makeMessage(account.id, folder.id, 2),
    ]);
    const second = bulkInsertMessages(db, [
      makeMessage(account.id, folder.id, 2),
      makeMessage(account.id, folder.id, 3),
    ]);
    expect(second.inserted).toBe(1);
    expect(second.skipped).toBe(1);
    expect(countByAccount(db, account.id)).toBe(3);
  });

  describe('listCachedUidsByFolder', () => {
    it('returns a Set of every UID currently cached for the folder', () => {
      const db = setupTestDb();
      const { account, folder } = seedAccountAndFolder(db);
      bulkInsertMessages(
        db,
        [1, 2, 3, 7, 12].map((uid) => makeMessage(account.id, folder.id, uid)),
      );
      const set = listCachedUidsByFolder(db, folder.id);
      expect(set).toBeInstanceOf(Set);
      expect([...set].sort((a, b) => a - b)).toEqual([1, 2, 3, 7, 12]);
    });

    it('returns an empty Set when the folder has no cached rows', () => {
      const db = setupTestDb();
      const { folder } = seedAccountAndFolder(db);
      expect(listCachedUidsByFolder(db, folder.id).size).toBe(0);
    });

    it('does not leak rows from other folders', () => {
      const db = setupTestDb();
      const { account, folder } = seedAccountAndFolder(db);
      const otherFolder = seedAccountAndFolder(db, {
        host: 'other.test',
        username: 'other@x.com',
        path: 'OTHER',
      }).folder;
      bulkInsertMessages(db, [
        makeMessage(account.id, folder.id, 1),
        makeMessage(account.id, folder.id, 2),
      ]);
      bulkInsertMessages(db, [makeMessage(account.id, otherFolder.id, 99)]);
      expect([...listCachedUidsByFolder(db, folder.id)].sort()).toEqual([1, 2]);
      expect([...listCachedUidsByFolder(db, otherFolder.id)]).toEqual([99]);
    });
  });

  describe('deleteMessagesByUids', () => {
    it('removes only the listed UIDs in the named folder', () => {
      const db = setupTestDb();
      const { account, folder } = seedAccountAndFolder(db);
      bulkInsertMessages(
        db,
        [1, 2, 3, 4, 5].map((uid) => makeMessage(account.id, folder.id, uid)),
      );
      deleteMessagesByUids(db, folder.id, [2, 4]);
      const remaining = [...listCachedUidsByFolder(db, folder.id)].sort(
        (a, b) => a - b,
      );
      expect(remaining).toEqual([1, 3, 5]);
    });

    it('is a no-op for an empty UID list', () => {
      const db = setupTestDb();
      const { account, folder } = seedAccountAndFolder(db);
      bulkInsertMessages(db, [makeMessage(account.id, folder.id, 1)]);
      deleteMessagesByUids(db, folder.id, []);
      expect(countByAccount(db, account.id)).toBe(1);
    });

    it('does not touch other folders', () => {
      const db = setupTestDb();
      const { account, folder } = seedAccountAndFolder(db);
      const other = seedAccountAndFolder(db, {
        host: 'other.test',
        username: 'b@x.com',
        path: 'OTHER',
      }).folder;
      bulkInsertMessages(db, [
        makeMessage(account.id, folder.id, 5),
        makeMessage(account.id, other.id, 5),
      ]);
      deleteMessagesByUids(db, folder.id, [5]);
      expect(listCachedUidsByFolder(db, folder.id).size).toBe(0);
      expect([...listCachedUidsByFolder(db, other.id)]).toEqual([5]);
    });

    it('chunks correctly past the 500-row inline limit', () => {
      const db = setupTestDb();
      const { account, folder } = seedAccountAndFolder(db);
      const all = Array.from({ length: 1300 }, (_, i) => i + 1);
      bulkInsertMessages(
        db,
        all.map((uid) => makeMessage(account.id, folder.id, uid)),
      );
      deleteMessagesByUids(db, folder.id, all);
      expect(countByAccount(db, account.id)).toBe(0);
    });

    it('cascades to message_bodies (FK ON DELETE CASCADE)', () => {
      const db = setupTestDb();
      const { account, folder } = seedAccountAndFolder(db);
      bulkInsertMessages(db, [
        makeMessage(account.id, folder.id, 1),
        makeMessage(account.id, folder.id, 2),
      ]);
      const row1 = getByFolderUid(db, folder.id, 1)!;
      const row2 = getByFolderUid(db, folder.id, 2)!;
      const cipher = {
        isAvailable: () => true,
        encrypt: (s: string) => Buffer.from('ENC:' + s, 'utf8'),
        decrypt: (b: Buffer) => b.toString('utf8').replace(/^ENC:/, ''),
      };
      upsertMessageBody(db, { messageId: row1.id, plaintext: 'a', originalBytes: 1 }, cipher, 0);
      upsertMessageBody(db, { messageId: row2.id, plaintext: 'b', originalBytes: 1 }, cipher, 0);
      expect(listCachedBodyIds(db, [row1.id, row2.id]).size).toBe(2);

      deleteMessagesByUids(db, folder.id, [1]);

      // row1's body must be gone via cascade; row2's body untouched.
      const stillCached = listCachedBodyIds(db, [row1.id, row2.id]);
      expect(stillCached.has(row1.id)).toBe(false);
      expect(stillCached.has(row2.id)).toBe(true);
    });
  });

  // Regression — SQLite's `SQLITE_LIMIT_VARIABLE_NUMBER` is 32 766; the
  // bulk helpers used to slam the full email list into a single
  // `IN (?, ?, ?, …)` bind list, which exploded on a 100k-mailbox /
  // 38 471-address scan with "too many SQL variables". Chunking at
  // IN_CLAUSE_CHUNK_SIZE (5 000) keeps each statement well under the
  // cap regardless of how many places the list is bound. These tests
  // run the helpers on >40 000 addresses and assert they neither throw
  // nor lose results.
  describe('bulk helpers — chunking under SQLite variable cap', () => {
    it('getSamplesByFromAddrsBulk handles 40 000 distinct addresses without overflowing IN(...)', () => {
      const db = setupTestDb();
      const { account, folder } = seedAccountAndFolder(db);
      // Seed one inbound message per address — small set so the test is
      // fast, but the *email-list size* is what we're stress-testing.
      // 50 real rows + 40 000 lookup addresses (39 950 of which won't
      // be in the messages table).
      const realEmails: string[] = [];
      const rows: ReturnType<typeof makeMessage>[] = [];
      for (let i = 0; i < 50; i += 1) {
        const addr = `real${i}@partner.com`;
        realEmails.push(addr);
        rows.push(
          makeMessage(account.id, folder.id, i + 1, {
            fromAddr: addr,
            direction: 'in',
          }),
        );
      }
      bulkInsertMessages(db, rows);
      const lookupEmails = realEmails.slice();
      for (let i = 0; i < 39_950; i += 1) {
        lookupEmails.push(`ghost${i}@nowhere.example`);
      }
      expect(lookupEmails.length).toBe(40_000);

      const result = getSamplesByFromAddrsBulk(db, account.id, lookupEmails, 5);
      // Every real address still resolves; ghosts don't show up.
      expect(result.size).toBe(50);
      for (const addr of realEmails) {
        const samples = result.get(addr);
        expect(samples?.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('listMessagesForContactsBulk handles 40 000 distinct addresses (each chunk re-binds twice for UNION ALL)', () => {
      const db = setupTestDb();
      const { account, folder } = seedAccountAndFolder(db);
      // 30 inbound + 30 outbound rows, distinct contacts on each side.
      const inbound: string[] = [];
      const outbound: string[] = [];
      const rows: ReturnType<typeof makeMessage>[] = [];
      for (let i = 0; i < 30; i += 1) {
        const addr = `in${i}@partner.com`;
        inbound.push(addr);
        rows.push(
          makeMessage(account.id, folder.id, i + 1, {
            fromAddr: addr,
            direction: 'in',
          }),
        );
      }
      for (let i = 0; i < 30; i += 1) {
        const addr = `out${i}@partner.com`;
        outbound.push(addr);
        rows.push(
          makeMessage(account.id, folder.id, 1000 + i, {
            fromAddr: 'tester@example.com',
            to: [addr],
            direction: 'out',
          }),
        );
      }
      bulkInsertMessages(db, rows);

      const lookupEmails = [...inbound, ...outbound];
      for (let i = 0; i < 39_940; i += 1) {
        lookupEmails.push(`ghost${i}@nowhere.example`);
      }
      expect(lookupEmails.length).toBe(40_000);

      const result = listMessagesForContactsBulk(db, account.id, lookupEmails, 5);
      // Each of the 60 real contacts has exactly one message of theirs.
      expect(result.size).toBe(60);
      for (const addr of [...inbound, ...outbound]) {
        const bucket = result.get(addr);
        expect(bucket?.length).toBe(1);
      }
    });

    it('listCachedBodyIds handles 40 000 message ids without overflowing IN(...)', () => {
      const db = setupTestDb();
      const { account, folder } = seedAccountAndFolder(db);
      // Seed a small body cache; the helper takes a giant lookup list.
      const rows = Array.from({ length: 10 }, (_, i) =>
        makeMessage(account.id, folder.id, i + 1),
      );
      bulkInsertMessages(db, rows);
      const cipher = {
        isAvailable: () => true,
        encrypt: (s: string) => Buffer.from(s, 'utf8'),
        decrypt: (b: Buffer) => b.toString('utf8'),
      };
      const real: number[] = [];
      for (let uid = 1; uid <= 10; uid += 1) {
        const r = getByFolderUid(db, folder.id, uid)!;
        upsertMessageBody(db, { messageId: r.id, plaintext: 'x', originalBytes: 1 }, cipher, 0);
        real.push(r.id);
      }
      const lookup: number[] = real.slice();
      for (let i = 0; i < 39_990; i += 1) lookup.push(1_000_000 + i);
      expect(lookup.length).toBe(40_000);

      const cached = listCachedBodyIds(db, lookup);
      expect(cached.size).toBe(10);
      for (const id of real) expect(cached.has(id)).toBe(true);
    });
  });
});
