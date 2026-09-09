/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest';
import {
  DISPLAY_NAMES_CAP,
  SUBJECTS_SAMPLE_CAP,
  getAddress,
  listAddresses,
  upsertAddress,
} from '../../../src/main/db/addresses.repo.js';
import { seedAccountAndFolder, setupTestDb } from './_helpers.js';

describe('addresses.repo', () => {
  it('creates a new address on first upsert', () => {
    const db = setupTestDb();
    const { account } = seedAccountAndFolder(db);
    const row = upsertAddress(db, {
      accountId: account.id,
      emailNormalized: 'a@x.com',
      displayName: 'Alice',
      seenUtc: 1_000,
      directionIn: 1,
      directionOut: 0,
      subject: 'Hello',
    });
    expect(row.countIn).toBe(1);
    expect(row.countOut).toBe(0);
    expect(row.firstSeenUtc).toBe(1_000);
    expect(row.lastSeenUtc).toBe(1_000);
    expect(row.displayNames).toEqual(['Alice']);
    expect(row.subjectsSample).toEqual(['Hello']);
  });

  it('accumulates counts and tracks first/last seen', () => {
    const db = setupTestDb();
    const { account } = seedAccountAndFolder(db);
    upsertAddress(db, {
      accountId: account.id,
      emailNormalized: 'a@x.com',
      displayName: 'Alice',
      seenUtc: 2_000,
      directionIn: 1,
      directionOut: 0,
    });
    upsertAddress(db, {
      accountId: account.id,
      emailNormalized: 'a@x.com',
      displayName: 'Alice A.',
      seenUtc: 1_500,
      directionIn: 0,
      directionOut: 2,
    });
    const final = getAddress(db, account.id, 'a@x.com');
    expect(final?.countIn).toBe(1);
    expect(final?.countOut).toBe(2);
    expect(final?.firstSeenUtc).toBe(1_500);
    expect(final?.lastSeenUtc).toBe(2_000);
    expect(final?.displayNames).toEqual(['Alice', 'Alice A.']);
  });

  it('caps subjects sample and display names', () => {
    const db = setupTestDb();
    const { account } = seedAccountAndFolder(db);
    for (let i = 0; i < SUBJECTS_SAMPLE_CAP + 5; i += 1) {
      upsertAddress(db, {
        accountId: account.id,
        emailNormalized: 'cap@x.com',
        seenUtc: i,
        directionIn: 1,
        directionOut: 0,
        subject: `s${i}`,
        displayName: `Name${i}`,
      });
    }
    const row = getAddress(db, account.id, 'cap@x.com');
    expect(row?.subjectsSample.length).toBe(SUBJECTS_SAMPLE_CAP);
    expect(row?.displayNames.length).toBe(DISPLAY_NAMES_CAP);
  });

  it('list filters by query and paginates', () => {
    const db = setupTestDb();
    const { account } = seedAccountAndFolder(db);
    for (let i = 0; i < 25; i += 1) {
      upsertAddress(db, {
        accountId: account.id,
        emailNormalized: `user${i}@example.com`,
        seenUtc: i,
        directionIn: i % 3,
        directionOut: (i + 1) % 4,
      });
    }
    upsertAddress(db, {
      accountId: account.id,
      emailNormalized: 'special@acme.com',
      seenUtc: 100,
      directionIn: 5,
      directionOut: 5,
      displayName: 'Acme Sales',
    });

    const all = listAddresses(db, account.id, {}, { offset: 0, limit: 100 });
    expect(all.total).toBe(26);

    const page1 = listAddresses(db, account.id, {}, { offset: 0, limit: 10 });
    const page2 = listAddresses(db, account.id, {}, { offset: 10, limit: 10 });
    expect(page1.rows).toHaveLength(10);
    expect(page2.rows).toHaveLength(10);
    expect(page1.rows[0]?.emailNormalized).not.toBe(page2.rows[0]?.emailNormalized);

    const acme = listAddresses(
      db,
      account.id,
      { domains: ['acme.com'] },
      { offset: 0, limit: 100 },
    );
    expect(acme.total).toBe(1);
    expect(acme.rows[0]?.emailNormalized).toBe('special@acme.com');

    const queryHit = listAddresses(
      db,
      account.id,
      { query: 'special' },
      { offset: 0, limit: 100 },
    );
    expect(queryHit.total).toBe(1);

    const minTotal = listAddresses(
      db,
      account.id,
      { minTotal: 5 },
      { offset: 0, limit: 100 },
    );
    // user2, user14 (in+out=5), and special@acme.com (in+out=10).
    expect(minTotal.total).toBe(3);
    const veryHigh = listAddresses(
      db,
      account.id,
      { minTotal: 10 },
      { offset: 0, limit: 100 },
    );
    expect(veryHigh.total).toBe(1);
    expect(veryHigh.rows[0]?.emailNormalized).toBe('special@acme.com');
  });

  it('orders by total then last-seen descending', () => {
    const db = setupTestDb();
    const { account } = seedAccountAndFolder(db);
    upsertAddress(db, {
      accountId: account.id,
      emailNormalized: 'low@x.com',
      seenUtc: 1_000,
      directionIn: 1,
      directionOut: 0,
    });
    upsertAddress(db, {
      accountId: account.id,
      emailNormalized: 'high@x.com',
      seenUtc: 500,
      directionIn: 5,
      directionOut: 5,
    });
    const result = listAddresses(db, account.id, {}, { offset: 0, limit: 10 });
    expect(result.rows[0]?.emailNormalized).toBe('high@x.com');
    expect(result.rows[1]?.emailNormalized).toBe('low@x.com');
  });

  it('isolates rows by account_id', () => {
    const db = setupTestDb();
    const { account: a } = seedAccountAndFolder(db);
    const { account: b } = seedAccountAndFolder(db, {
      host: 'other.test',
      username: 'b@x.com',
      path: 'INBOX',
    });
    upsertAddress(db, {
      accountId: a.id,
      emailNormalized: 'shared@x.com',
      seenUtc: 1,
      directionIn: 1,
      directionOut: 0,
    });
    upsertAddress(db, {
      accountId: b.id,
      emailNormalized: 'shared@x.com',
      seenUtc: 2,
      directionIn: 0,
      directionOut: 5,
    });
    const aRow = getAddress(db, a.id, 'shared@x.com');
    const bRow = getAddress(db, b.id, 'shared@x.com');
    expect(aRow?.countIn).toBe(1);
    expect(aRow?.countOut).toBe(0);
    expect(bRow?.countIn).toBe(0);
    expect(bRow?.countOut).toBe(5);
    expect(listAddresses(db, a.id, {}, { offset: 0, limit: 10 }).total).toBe(1);
    expect(listAddresses(db, b.id, {}, { offset: 0, limit: 10 }).total).toBe(1);
  });
});
