/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ScanOptions, type ScanProgress } from '../../../src/shared/domain.js';
import { DEFAULT_AUTOMATION_LOCAL_PARTS } from '../../../src/shared/heuristics-config.js';
import { closeDb, type Db } from '../../../src/main/db/connection.js';
import { listAccounts } from '../../../src/main/db/accounts.repo.js';
import { listFoldersByAccount } from '../../../src/main/db/folders.repo.js';
import {
  countByAccount,
  iterateByAccount,
  listCachedUidsByFolder,
} from '../../../src/main/db/messages.repo.js';
import {
  iterateAllAddresses,
  listAddresses,
} from '../../../src/main/db/addresses.repo.js';
import { runScan } from '../../../src/main/pipeline/scan-runner.js';
import { CancelledError } from '../../../src/main/imap/errors.js';
import { setupTestDb } from '../db/_helpers.js';
import {
  FakeImapClient,
  TEST_CREDENTIALS,
  buildFixture,
  fixtureMessageCount,
  type Fixture,
} from './_fixtures.js';

describe('runScan integration', () => {
  let db: Db;
  let fixture: Fixture;
  let progressEvents: ScanProgress[];

  beforeEach(() => {
    db = setupTestDb();
    fixture = buildFixture();
    progressEvents = [];
  });

  afterEach(() => {
    closeDb(db);
  });

  it('ingests, classifies, and tags the synthetic mailbox', async () => {
    const client = new FakeImapClient(fixture);
    const totalMessages = fixtureMessageCount(fixture);

    const t0 = performance.now();
    const memBefore = process.memoryUsage().heapUsed;
    const result = await runScan(
      {
        credentials: TEST_CREDENTIALS,
        options: ScanOptions.parse({ excludeDomains: ['internal.test'] }),
        onProgress: (p) => progressEvents.push(p),
        signal: new AbortController().signal,
      },
      { db, client, progressIntervalMs: 0 },
    );
    const elapsedMs = performance.now() - t0;
    const memAfter = process.memoryUsage().heapUsed;
    // eslint-disable-next-line no-console
    console.log(
      `[bench] runScan(${totalMessages} msgs across ${fixture.folders.length} folders) took ` +
        `${elapsedMs.toFixed(1)}ms; heapUsed Δ=${((memAfter - memBefore) / 1024 / 1024).toFixed(2)}MB`,
    );

    expect(countByAccount(db, result.accountId)).toBe(totalMessages);
    expect(listAccounts(db)).toHaveLength(1);
    expect(listFoldersByAccount(db, result.accountId)).toHaveLength(4);

    const tagsByEmail = new Map<string, readonly string[]>();
    for (const a of iterateAllAddresses(db, result.accountId)) {
      tagsByEmail.set(a.emailNormalized, a.tags);
    }

    // Bidirectional external partners → kept.
    expect(tagsByEmail.get('partner1@acme.com')).toEqual(['kept']);
    expect(tagsByEmail.get('partner2@beta.io')).toEqual(['kept']);
    expect(tagsByEmail.get('partner3@gamma.co')).toEqual(['kept']);
    // support local-part is always automation-localpart now.
    expect(tagsByEmail.get('support@helpful.io')).toEqual(['filtered:automation-localpart']);

    // Newsletters → automated headers (every message), so all-messages-automated.
    const newsTags = tagsByEmail.get('news@news.example.com');
    expect(newsTags).toBeDefined();
    expect(newsTags).toContain('filtered:not-bidirectional');

    // noreply → automation-localpart.
    const noreplyTags = tagsByEmail.get('noreply@bank.com');
    expect(noreplyTags).toBeDefined();
    expect(noreplyTags).toContain('filtered:automation-localpart');

    // support local-part is now treated as automation-localpart.
    const supportTags = tagsByEmail.get('support@vendor.com');
    expect(supportTags).toBeDefined();
    expect(supportTags).toContain('filtered:automation-localpart');

    // Internal address → hard-filtered at aggregate (excludeDomains passed
    // into the scan), so it never enters the addresses table at all rather
    // than being tagged 'filtered:internal-domain'.
    expect(tagsByEmail.has('colleague@internal.test')).toBe(false);

    // Final kept count.
    expect(result.contactsCount).toBe(3);

    // Direction was computed correctly: at least some 'out' messages exist.
    const directions = new Set<string>();
    for (const m of iterateByAccount(db, result.accountId)) directions.add(m.direction);
    expect(directions.has('in')).toBe(true);
    expect(directions.has('out')).toBe(true);

    // Progress phases include connecting → enumerating → fetching → aggregating → classifying → done.
    const phases = new Set(progressEvents.map((p) => p.phase));
    expect(phases.has('connecting')).toBe(true);
    expect(phases.has('done')).toBe(true);
  });

  it('respects per-scan automation local-part overrides', async () => {
    const client = new FakeImapClient(fixture);

    const result = await runScan(
      {
        credentials: TEST_CREDENTIALS,
        options: ScanOptions.parse({
          excludeDomains: ['internal.test'],
          automationLocalParts: DEFAULT_AUTOMATION_LOCAL_PARTS.filter(
            (value) => value !== 'support',
          ),
        }),
        onProgress: () => undefined,
        signal: new AbortController().signal,
      },
      { db, client, progressIntervalMs: 0 },
    );

    const tagsByEmail = new Map<string, readonly string[]>();
    for (const a of iterateAllAddresses(db, result.accountId)) {
      tagsByEmail.set(a.emailNormalized, a.tags);
    }

    expect(tagsByEmail.get('support@helpful.io')).toEqual(['kept']);
    expect(result.contactsCount).toBe(4);
  });

  it('preserves the most-recent checkpoint when cancelled mid-folder, losing only the in-flight batch', async () => {
    // Tiny BATCH_SIZE-sized fixture so the test can reason about checkpoint
    // boundaries without depending on the production constant. We cancel at
    // a precise UID and assert that everything yielded up to that point was
    // committed (best-effort flush in the catch path) while no later UIDs
    // leaked into the DB.
    const client = new FakeImapClient(fixture);
    const ac = new AbortController();
    let yielded = 0;
    fixture.onFetchYield = (folder) => {
      if (folder === 'INBOX') {
        yielded += 1;
        if (yielded === 5) ac.abort();
      }
    };

    await expect(
      runScan(
        {
          credentials: TEST_CREDENTIALS,
          options: ScanOptions.parse({}),
          onProgress: () => undefined,
          signal: ac.signal,
        },
        { db, client, progressIntervalMs: 0, imapRetryBackoffMs: [0, 0, 0] },
      ),
    ).rejects.toBeInstanceOf(CancelledError);

    const account = listAccounts(db)[0];
    expect(account).toBeDefined();
    const folders = listFoldersByAccount(db, account!.id);
    const inbox = folders.find((f) => f.path === 'INBOX');
    expect(inbox).toBeDefined();
    // With the checkpointing model, whatever was yielded BEFORE the abort
    // signal was flushed in the catch path: 4 messages survived, and
    // uidnextSeen advanced to the highest committed UID. The 5th yield
    // (which triggered the abort) and everything after it must NOT appear.
    let inboxMsgCount = 0;
    let inboxMaxUid = 0;
    for (const m of iterateByAccount(db, account!.id)) {
      if (m.folderId === inbox!.id) {
        inboxMsgCount += 1;
        if (m.uid > inboxMaxUid) inboxMaxUid = m.uid;
      }
    }
    expect(inboxMsgCount).toBe(4);
    expect(inboxMaxUid).toBe(4);
    expect(inbox!.uidnextSeen).toBe(4);
  });

  it('dedupes messages by Message-ID across folders (Gmail All Mail case)', async () => {
    // Reproduce the Gmail layout: each physical message lives both in INBOX
    // and in [Gmail]/All Mail under different UIDs. The same outbound message
    // lives in both Sent Mail and All Mail. Without dedup, count_in and
    // count_out double for the partner.
    const sharedHeaders = (
      messageId: string,
      from: string,
      to: string,
      subject: string,
    ): Map<string, string> => {
      const m = new Map<string, string>();
      m.set('from', from);
      m.set('to', to);
      m.set('date', new Date(Date.UTC(2024, 0, 1, 9, 0, 0)).toUTCString());
      m.set('subject', subject);
      m.set('message-id', `<${messageId}@external.com>`);
      return m;
    };
    const inboxIn = {
      uid: 1,
      dateMs: Date.UTC(2024, 0, 1, 9, 0, 0),
      headers: sharedHeaders('msg-in-1', 'partner@acme.com', TEST_CREDENTIALS.username, 'Hello'),
    };
    const allMailIn = { ...inboxIn, uid: 11 };
    const sentOut = {
      uid: 1,
      dateMs: Date.UTC(2024, 0, 1, 10, 0, 0),
      headers: sharedHeaders('msg-out-1', TEST_CREDENTIALS.username, 'partner@acme.com', 'Re: Hello'),
    };
    const allMailOut = { ...sentOut, uid: 12 };

    const dupFixture: Fixture = {
      folders: [
        { path: 'INBOX', uidvalidity: 1, specialUse: '\\Inbox', messages: [inboxIn] },
        { path: 'Sent Mail', uidvalidity: 2, specialUse: '\\Sent', messages: [sentOut] },
        { path: '[Gmail]/All Mail', uidvalidity: 3, messages: [allMailIn, allMailOut] },
      ],
    };
    const client = new FakeImapClient(dupFixture);

    const result = await runScan(
      {
        credentials: TEST_CREDENTIALS,
        options: ScanOptions.parse({}),
        onProgress: () => undefined,
        signal: new AbortController().signal,
      },
      { db, client, progressIntervalMs: 0 },
    );

    // 4 raw rows in DB (2 physical messages × 2 folders each), but the
    // address aggregate must reflect 1 in + 1 out = 2 — not 2 + 2 = 4.
    expect(countByAccount(db, result.accountId)).toBe(4);
    const partner = [...iterateAllAddresses(db, result.accountId)].find(
      (a) => a.emailNormalized === 'partner@acme.com',
    );
    expect(partner).toBeDefined();
    expect(partner!.countIn).toBe(1);
    expect(partner!.countOut).toBe(1);
  });

  it('emits per-folder snapshots with monotonically-growing kept contacts when onSnapshot is provided', async () => {
    const client = new FakeImapClient(fixture);
    const snapshots: string[][] = [];

    const result = await runScan(
      {
        credentials: TEST_CREDENTIALS,
        options: ScanOptions.parse({}),
        onProgress: () => undefined,
        onSnapshot: (delta) => {
          snapshots.push(delta.map((r) => r.emailNormalized));
        },
        signal: new AbortController().signal,
      },
      { db, client, progressIntervalMs: 0 },
    );

    // At least one snapshot fired and each one carries only never-before-seen
    // emails (delta semantics, not cumulative state).
    expect(snapshots.length).toBeGreaterThan(0);
    const seen = new Set<string>();
    for (const delta of snapshots) {
      for (const email of delta) {
        expect(seen.has(email)).toBe(false);
        seen.add(email);
      }
    }
    // Every contact reported across snapshots is present in the final
    // canonical state, and the union equals the final kept count.
    expect(seen.size).toBe(result.contactsCount);
    const finalKept = [...iterateAllAddresses(db, result.accountId)]
      .filter((a) => a.tags.includes('kept'))
      .map((a) => a.emailNormalized);
    expect(new Set(finalKept)).toEqual(seen);
  });

  it('resumes ingest after a transient connection drop without losing messages or refetching committed ones', async () => {
    // Single small folder; fixed dateMs so we don't depend on any cursor.
    const baseDate = Date.UTC(2024, 0, 1, 9, 0, 0);
    function mkMsg(uid: number) {
      const headers = new Map<string, string>();
      headers.set('from', '"Partner" <partner@acme.com>');
      headers.set('to', TEST_CREDENTIALS.username);
      headers.set('date', new Date(baseDate + uid * 60_000).toUTCString());
      headers.set('subject', `Hello #${uid}`);
      headers.set('message-id', `<msg-${uid}@external.com>`);
      return { uid, dateMs: baseDate + uid * 60_000, headers };
    }
    const TOTAL = 20;
    const messages = Array.from({ length: TOTAL }, (_, i) => mkMsg(i + 1));
    const dropFixture: Fixture = {
      folders: [
        {
          path: 'INBOX',
          uidvalidity: 9000,
          specialUse: '\\Inbox',
          messages,
        },
      ],
    };

    // Drop the connection on the FIRST attempt to fetch UID 5. After that
    // the throw-flag is down — the second iteration of the retry loop will
    // sail through and yield UID 5..20.
    let droppedOnce = false;
    let yieldsObserved = 0;
    dropFixture.onFetchYield = (folder, uid) => {
      if (folder !== 'INBOX') return;
      yieldsObserved += 1;
      if (uid === 5 && !droppedOnce) {
        droppedOnce = true;
        const err = new Error('Connection not available') as Error & { code: string };
        err.code = 'NoConnection';
        throw err;
      }
    };

    const client = new FakeImapClient(dropFixture);
    const result = await runScan(
      {
        credentials: TEST_CREDENTIALS,
        options: ScanOptions.parse({}),
        onProgress: () => undefined,
        signal: new AbortController().signal,
      },
      { db, client, progressIntervalMs: 0, imapRetryBackoffMs: [0, 0, 0] },
    );

    // The drop fired exactly once and the scan still completed.
    expect(droppedOnce).toBe(true);
    // All 20 messages persisted (no losses, no duplicates — the unique
    // (folder_id, uid) constraint protects the latter, but the count check
    // makes both contracts explicit).
    expect(countByAccount(db, result.accountId)).toBe(TOTAL);
    // We yielded the 4 pre-drop UIDs once, attempted UID 5 (which threw)
    // once, then yielded UIDs 5..20 once on the second attempt. So
    // onFetchYield ran 4 + 1 + 16 = 21 times.
    expect(yieldsObserved).toBe(TOTAL + 1);
    // Folder bookkeeping reflects the highest UID we committed.
    const folders = listFoldersByAccount(db, result.accountId);
    const inbox = folders.find((f) => f.path === 'INBOX');
    expect(inbox?.uidnextSeen).toBe(TOTAL);
  });

  it('surfaces a descriptive NetworkError when reconnect retries are exhausted', async () => {
    function mkMsg(uid: number) {
      const headers = new Map<string, string>();
      headers.set('from', '"P" <p@x.com>');
      headers.set('to', TEST_CREDENTIALS.username);
      headers.set('date', new Date(Date.UTC(2024, 0, 1)).toUTCString());
      headers.set('subject', `m${uid}`);
      headers.set('message-id', `<m-${uid}@x.com>`);
      return { uid, dateMs: Date.UTC(2024, 0, 1) + uid, headers };
    }
    const stubborn: Fixture = {
      folders: [
        {
          path: 'INBOX',
          uidvalidity: 1,
          specialUse: '\\Inbox',
          messages: [mkMsg(1), mkMsg(2), mkMsg(3)],
        },
      ],
    };
    // Throw on every yield — retries can never succeed.
    stubborn.onFetchYield = (folder) => {
      if (folder !== 'INBOX') return;
      const err = new Error('Connection not available') as Error & { code: string };
      err.code = 'NoConnection';
      throw err;
    };
    const client = new FakeImapClient(stubborn);

    await expect(
      runScan(
        {
          credentials: TEST_CREDENTIALS,
          options: ScanOptions.parse({}),
          onProgress: () => undefined,
          signal: new AbortController().signal,
        },
        { db, client, progressIntervalMs: 0, imapRetryBackoffMs: [0, 0, 0] },
      ),
    ).rejects.toMatchObject({
      tag: 'NetworkError',
      message: expect.stringMatching(/Folder 'INBOX' ingest failed.*after 4 attempts.*NoConnection/),
    });
  });

  it("under strict scope, INBOX-only re-scan yields zero bidirectional contacts (countOut=0 because Sent is out of scope)", async () => {
    // First scan: full mailbox — cache holds INBOX inbounds and Sent outbounds.
    const client = new FakeImapClient(fixture);
    await runScan(
      {
        credentials: TEST_CREDENTIALS,
        options: ScanOptions.parse({}),
        onProgress: () => undefined,
        signal: new AbortController().signal,
      },
      { db, client, progressIntervalMs: 0 },
    );

    // Strict-scope rule: aggregation iterates only messages from selected
    // folders. With only INBOX picked, every aggregated message has
    // direction='in' so countOut=0 across the board → bidirectional rule
    // (countIn>=1 AND countOut>=1) excludes every contact.
    const second = await runScan(
      {
        credentials: TEST_CREDENTIALS,
        options: ScanOptions.parse({ folderInclude: ['INBOX'] }),
        onProgress: () => undefined,
        signal: new AbortController().signal,
      },
      { db, client, progressIntervalMs: 0 },
    );

    expect(second.contactsCount).toBe(0);
    const tagsByEmail = new Map<string, readonly string[]>();
    for (const a of iterateAllAddresses(db, second.accountId)) {
      tagsByEmail.set(a.emailNormalized, a.tags);
    }
    // Every partner is now filtered for not-bidirectional (no countOut in
    // scope). No 'kept' entries.
    for (const tags of tagsByEmail.values()) {
      expect(tags).not.toEqual(['kept']);
    }
  });

  it("with directionMode='off', INBOX-only re-scan keeps inbound-only contacts (rule disabled, minMessages neutralised)", async () => {
    // Same setup as the INBOX-only/empty test above. Whereas 'bi' yields
    // zero (countOut=0), 'off' should let inbound-only partners through:
    // the bidirectionality rule collapses to 0/0/0 thresholds, so any
    // contact with ≥1 message survives that check. Other classifier rules
    // (automation, role, internal-domain) still apply.
    const client = new FakeImapClient(fixture);
    await runScan(
      {
        credentials: TEST_CREDENTIALS,
        options: ScanOptions.parse({}),
        onProgress: () => undefined,
        signal: new AbortController().signal,
      },
      { db, client, progressIntervalMs: 0 },
    );

    const second = await runScan(
      {
        credentials: TEST_CREDENTIALS,
        options: ScanOptions.parse({
          folderInclude: ['INBOX'],
          directionMode: 'off',
        }),
        onProgress: () => undefined,
        signal: new AbortController().signal,
      },
      { db, client, progressIntervalMs: 0 },
    );

    expect(second.contactsCount).toBeGreaterThan(0);
    const tagsByEmail = new Map<string, readonly string[]>();
    for (const a of iterateAllAddresses(db, second.accountId)) {
      tagsByEmail.set(a.emailNormalized, a.tags);
    }
    // Inbound-only partners now survive — bidirectional rule was the only
    // thing filtering them out before.
    expect(tagsByEmail.get('partner1@acme.com')).toEqual(['kept']);
    expect(tagsByEmail.get('partner2@beta.io')).toEqual(['kept']);
    expect(tagsByEmail.get('partner3@gamma.co')).toEqual(['kept']);
    // Automation rule still fires on the newsletter (List-Unsubscribe etc.)
    // — Direction filter isn't what was filtering it, so 'off' doesn't
    // rescue it.
    expect(tagsByEmail.get('news@news.example.com')).not.toEqual(['kept']);
  });

  it("under strict scope, INBOX+Sent re-scan keeps bidirectional partners", async () => {
    // Counterpart to the INBOX-only test: with both inbound and outbound
    // folders selected, strict scope still produces the expected partners.
    const client = new FakeImapClient(fixture);
    await runScan(
      {
        credentials: TEST_CREDENTIALS,
        options: ScanOptions.parse({}),
        onProgress: () => undefined,
        signal: new AbortController().signal,
      },
      { db, client, progressIntervalMs: 0 },
    );

    const second = await runScan(
      {
        credentials: TEST_CREDENTIALS,
        options: ScanOptions.parse({ folderInclude: ['INBOX', 'Sent'] }),
        onProgress: () => undefined,
        signal: new AbortController().signal,
      },
      { db, client, progressIntervalMs: 0 },
    );

    expect(second.contactsCount).toBeGreaterThan(0);
    const tagsByEmail = new Map<string, readonly string[]>();
    for (const a of iterateAllAddresses(db, second.accountId)) {
      tagsByEmail.set(a.emailNormalized, a.tags);
    }
    expect(tagsByEmail.get('partner1@acme.com')).toEqual(['kept']);
    expect(tagsByEmail.get('partner2@beta.io')).toEqual(['kept']);
    // A pure-Spam newsletter sender wasn't in INBOX or Sent → not surfaced.
    expect(tagsByEmail.has('news@news.example.com')).toBe(false);
  });

  it('does not surface contacts from previously-scanned folders when the new scan only includes an empty folder', async () => {
    // First scan: full mailbox. Builds up the cache with INBOX/Sent/Archive
    // partner contacts.
    const client = new FakeImapClient(fixture);
    const first = await runScan(
      {
        credentials: TEST_CREDENTIALS,
        options: ScanOptions.parse({}),
        onProgress: () => undefined,
        signal: new AbortController().signal,
      },
      { db, client, progressIntervalMs: 0 },
    );
    expect(first.contactsCount).toBeGreaterThan(0);
    const firstAddresses = listAddresses(db, first.accountId, {}, { offset: 0, limit: 1000 });
    expect(firstAddresses.total).toBeGreaterThan(0);

    // Second scan: INCLUDE only an empty folder that wasn't in the first
    // run (so its uidvalidity / messages won't collide with the cache).
    fixture.folders.push({
      path: 'Empty/test',
      uidvalidity: 9999,
      messages: [],
    });
    const second = await runScan(
      {
        credentials: TEST_CREDENTIALS,
        options: ScanOptions.parse({ folderInclude: ['Empty/test'] }),
        onProgress: () => undefined,
        signal: new AbortController().signal,
      },
      { db, client, progressIntervalMs: 0 },
    );

    // The empty-folder scan must report zero contacts even though the DB
    // still holds the previous run's INBOX/Sent messages. Same account, so
    // the address aggregate is REPLACED — not appended.
    expect(second.accountId).toBe(first.accountId);
    expect(second.contactsCount).toBe(0);
    const secondAddresses = listAddresses(db, second.accountId, {}, { offset: 0, limit: 1000 });
    expect(secondAddresses.total).toBe(0);
  });

  it('does not surface contacts from previously-scanned folders during streaming snapshots either', async () => {
    // Same scenario as above but with onSnapshot wired up — guards the
    // snapshot path, which uses a separate call site for the aggregate.
    const client = new FakeImapClient(fixture);
    await runScan(
      {
        credentials: TEST_CREDENTIALS,
        options: ScanOptions.parse({}),
        onProgress: () => undefined,
        signal: new AbortController().signal,
      },
      { db, client, progressIntervalMs: 0 },
    );

    fixture.folders.push({
      path: 'Empty/test',
      uidvalidity: 9999,
      messages: [],
    });
    const snapshots: string[][] = [];
    const second = await runScan(
      {
        credentials: TEST_CREDENTIALS,
        options: ScanOptions.parse({ folderInclude: ['Empty/test'] }),
        onProgress: () => undefined,
        onSnapshot: (delta) => {
          snapshots.push(delta.map((r) => r.emailNormalized));
        },
        signal: new AbortController().signal,
      },
      { db, client, progressIntervalMs: 0 },
    );

    expect(second.contactsCount).toBe(0);
    // Critically: NO snapshot delta should ever include partner1/2/3 from
    // the prior INBOX scan. That was the user-reported regression.
    for (const delta of snapshots) {
      expect(delta).not.toContain('partner1@acme.com');
      expect(delta).not.toContain('partner2@beta.io');
      expect(delta).not.toContain('partner3@gamma.co');
    }
  });

  it("counts outbound messages correctly when the user is also in to/cc (group emails, cc-self-for-archive)", async () => {
    // Pre-fix bug: messages with from=me AND any recipient=me were tagged
    // 'self' and dropped by the aggregate, so external recipients lost
    // their countOut and failed the bidirectional rule. This fixture
    // exercises three multi-recipient outbound shapes that real users hit
    // every day.
    const myEmail = TEST_CREDENTIALS.username;
    const baseDate = Date.UTC(2024, 0, 1);
    function mkOut(uid: number, headers: Record<string, string>) {
      const m = new Map<string, string>();
      m.set('from', myEmail);
      m.set('date', new Date(baseDate + uid * 60_000).toUTCString());
      m.set('subject', `Out #${uid}`);
      m.set('message-id', `<sent-${uid}@example.com>`);
      for (const [k, v] of Object.entries(headers)) m.set(k, v);
      return { uid, dateMs: baseDate + uid * 60_000, headers: m };
    }
    function mkIn(uid: number, fromEmail: string, fromName: string) {
      const m = new Map<string, string>();
      m.set('from', `"${fromName}" <${fromEmail}>`);
      m.set('to', myEmail);
      m.set('date', new Date(baseDate + uid * 60_000).toUTCString());
      m.set('subject', `In #${uid}`);
      m.set('message-id', `<inbox-${uid}@external.com>`);
      return { uid, dateMs: baseDate + uid * 60_000, headers: m };
    }

    // Sent folder: 5 outbound messages to alice in different recipient
    // shapes — every one of them must contribute +1 to alice.countOut.
    const sentMessages = [
      // Shape 1: classic, only alice in to.
      mkOut(1, { to: 'alice@x.com' }),
      // Shape 2: alice + me in to (group email).
      mkOut(2, { to: `alice@x.com, ${myEmail}` }),
      // Shape 3: alice in to, me in cc-for-archive.
      mkOut(3, { to: 'alice@x.com', cc: myEmail }),
      // Shape 4: multiple externals + alice in to, me in cc.
      mkOut(4, { to: 'alice@x.com, bob@y.com', cc: myEmail }),
      // Shape 5: only me in to but alice in cc — still an outbound to alice.
      mkOut(5, { to: myEmail, cc: 'alice@x.com' }),
    ];
    const inboxMessages = [
      // One inbound from alice so she's bidirectional and survives the
      // 'kept' filter.
      mkIn(101, 'alice@x.com', 'Alice'),
    ];
    const fxt: Fixture = {
      folders: [
        { path: 'INBOX', uidvalidity: 1, specialUse: '\\Inbox', messages: inboxMessages },
        { path: 'Sent', uidvalidity: 2, specialUse: '\\Sent', messages: sentMessages },
      ],
    };
    const client = new FakeImapClient(fxt);

    const result = await runScan(
      {
        credentials: TEST_CREDENTIALS,
        options: ScanOptions.parse({}),
        onProgress: () => undefined,
        signal: new AbortController().signal,
      },
      { db, client, progressIntervalMs: 0 },
    );

    const addrs = [...iterateAllAddresses(db, result.accountId)];
    const alice = addrs.find((a) => a.emailNormalized === 'alice@x.com');
    expect(alice).toBeDefined();
    // Alice was the recipient of all 5 outbound messages, regardless of
    // whether self appeared in to or cc.
    expect(alice!.countOut).toBe(5);
    expect(alice!.countIn).toBe(1);
    expect(alice!.tags).toEqual(['kept']);

    // Bob was only in shape 4; one outbound, no inbound. Not bidirectional,
    // so filtered out — but his countOut must reflect the one outbound.
    const bob = addrs.find((a) => a.emailNormalized === 'bob@y.com');
    expect(bob).toBeDefined();
    expect(bob!.countOut).toBe(1);
    expect(bob!.countIn).toBe(0);
    expect(bob!.tags).toContain('filtered:not-bidirectional');

    // Final 'kept' count includes alice (bob filtered, self not a contact).
    expect(result.contactsCount).toBeGreaterThanOrEqual(1);
  });

  it("includeDomains whitelist surfaces only contacts in the listed domains", async () => {
    const client = new FakeImapClient(fixture);
    const result = await runScan(
      {
        credentials: TEST_CREDENTIALS,
        options: ScanOptions.parse({ includeDomains: ['acme.com'] }),
        onProgress: () => undefined,
        signal: new AbortController().signal,
      },
      { db, client, progressIntervalMs: 0 },
    );

    const addrs = [...iterateAllAddresses(db, result.accountId)];
    // Every surviving address belongs to acme.com.
    expect(addrs.every((a) => a.emailNormalized.endsWith('@acme.com'))).toBe(true);
    // partner1@acme.com survives the whitelist; partner2@beta.io does not.
    expect(addrs.some((a) => a.emailNormalized === 'partner1@acme.com')).toBe(true);
    expect(addrs.some((a) => a.emailNormalized === 'partner2@beta.io')).toBe(false);
    expect(result.contactsCount).toBeGreaterThanOrEqual(1);
  });

  it("excludeWordsInbound drops a contact when ANY of their inbound messages matches", async () => {
    // partner1: 2 inbounds with "newsletter" → drop. partner2: 1 of 2
    // inbounds matches → also drop (ANY-match semantic). Outbound replies
    // mention "newsletter" too but excludeWordsInbound ignores outbound.
    const baseDate = Date.UTC(2024, 0, 1);
    function mk(uid: number, fromEmail: string, subject: string) {
      const m = new Map<string, string>();
      m.set('from', fromEmail);
      m.set('to', TEST_CREDENTIALS.username);
      m.set('date', new Date(baseDate + uid * 60_000).toUTCString());
      m.set('subject', subject);
      m.set('message-id', `<m-${uid}@external.com>`);
      return { uid, dateMs: baseDate + uid * 60_000, headers: m };
    }
    function mkSent(uid: number, toEmail: string, subject: string) {
      const m = new Map<string, string>();
      m.set('from', TEST_CREDENTIALS.username);
      m.set('to', toEmail);
      m.set('date', new Date(baseDate + uid * 60_000).toUTCString());
      m.set('subject', subject);
      m.set('message-id', `<s-${uid}@example.com>`);
      return { uid, dateMs: baseDate + uid * 60_000, headers: m };
    }
    const fxt: Fixture = {
      folders: [
        {
          path: 'INBOX',
          uidvalidity: 1,
          specialUse: '\\Inbox',
          messages: [
            mk(1, 'p1@acme.com', 'Newsletter — week 1'),
            mk(2, 'p1@acme.com', 'Newsletter — week 2'),
            mk(3, 'p2@beta.io', 'Newsletter — promo'),
            mk(4, 'p2@beta.io', 'Project update'),
          ],
        },
        {
          path: 'Sent',
          uidvalidity: 2,
          specialUse: '\\Sent',
          messages: [
            mkSent(1, 'p1@acme.com', 'Re: Newsletter'),
            mkSent(2, 'p2@beta.io', 'Re: Project update'),
          ],
        },
      ],
    };
    const client = new FakeImapClient(fxt);
    const result = await runScan(
      {
        credentials: TEST_CREDENTIALS,
        options: ScanOptions.parse({ excludeWordsInbound: ['newsletter'] }),
        onProgress: () => undefined,
        signal: new AbortController().signal,
      },
      { db, client, progressIntervalMs: 0 },
    );

    const emails = [...iterateAllAddresses(db, result.accountId)].map((a) => a.emailNormalized);
    // Both inbound counts hit at least once → both dropped.
    expect(emails).not.toContain('p1@acme.com');
    expect(emails).not.toContain('p2@beta.io');
    expect(result.contactsCount).toBe(0);
  });

  it("includeWordsInbound keeps a contact iff at least ONE inbound matches", async () => {
    const baseDate = Date.UTC(2024, 0, 1);
    function mk(uid: number, fromEmail: string, subject: string) {
      const m = new Map<string, string>();
      m.set('from', fromEmail);
      m.set('to', TEST_CREDENTIALS.username);
      m.set('date', new Date(baseDate + uid * 60_000).toUTCString());
      m.set('subject', subject);
      m.set('message-id', `<m-${uid}@external.com>`);
      return { uid, dateMs: baseDate + uid * 60_000, headers: m };
    }
    function mkSent(uid: number, toEmail: string, subject: string) {
      const m = new Map<string, string>();
      m.set('from', TEST_CREDENTIALS.username);
      m.set('to', toEmail);
      m.set('date', new Date(baseDate + uid * 60_000).toUTCString());
      m.set('subject', subject);
      m.set('message-id', `<s-${uid}@example.com>`);
      return { uid, dateMs: baseDate + uid * 60_000, headers: m };
    }
    const fxt: Fixture = {
      folders: [
        {
          path: 'INBOX',
          uidvalidity: 1,
          specialUse: '\\Inbox',
          messages: [
            mk(1, 'project@acme.com', 'Project Apollo update'),
            mk(2, 'casual@beta.io', 'Random chat'),
          ],
        },
        {
          path: 'Sent',
          uidvalidity: 2,
          specialUse: '\\Sent',
          messages: [
            mkSent(1, 'project@acme.com', 'Re: Apollo'),
            mkSent(2, 'casual@beta.io', 'Re: Random'),
          ],
        },
      ],
    };
    const client = new FakeImapClient(fxt);
    const result = await runScan(
      {
        credentials: TEST_CREDENTIALS,
        options: ScanOptions.parse({ includeWordsInbound: ['apollo'] }),
        onProgress: () => undefined,
        signal: new AbortController().signal,
      },
      { db, client, progressIntervalMs: 0 },
    );

    const emails = [...iterateAllAddresses(db, result.accountId)].map(
      (a) => a.emailNormalized,
    );
    expect(emails).toContain('project@acme.com');
    expect(emails).not.toContain('casual@beta.io');
  });

  it("direction-split word filters: inbound exclude with quote-stripping, outbound exclude scoped to user's writes", async () => {
    // Three contacts, parseBodies on, default 'unsubscribe' chip in BOTH
    // inbound and outbound exclude. Each contact crafted to test one
    // dimension:
    //   • dropMe — fresh inbound text says "please unsubscribe me" → drop
    //     via excludeWordsInbound.
    //   • quoteOnly — inbound body has "unsubscribe" only inside an
    //     `On … wrote:` quoted-reply block → kept (stripQuotedReply
    //     removes it).
    //   • outboundCase — user replies with the word "unsubscribe" in
    //     outbound; contact's inbounds are clean → drop via
    //     excludeWordsOutbound.
    const baseDate = Date.UTC(2024, 0, 1);
    function mkInbound(uid: number, fromEmail: string, subject: string, body: string) {
      const m = new Map<string, string>();
      m.set('from', fromEmail);
      m.set('to', TEST_CREDENTIALS.username);
      m.set('date', new Date(baseDate + uid * 60_000).toUTCString());
      m.set('subject', subject);
      m.set('message-id', `<m-${uid}@external.com>`);
      return { uid, dateMs: baseDate + uid * 60_000, headers: m, body };
    }
    function mkSent(uid: number, toEmail: string, subject: string, body: string) {
      const m = new Map<string, string>();
      m.set('from', TEST_CREDENTIALS.username);
      m.set('to', toEmail);
      m.set('date', new Date(baseDate + uid * 60_000).toUTCString());
      m.set('subject', subject);
      m.set('message-id', `<s-${uid}@example.com>`);
      return { uid, dateMs: baseDate + uid * 60_000, headers: m, body };
    }
    const inbox = [
      mkInbound(
        1,
        'dropme@acme.com',
        'Re: Project',
        'Please unsubscribe me from these emails.',
      ),
      mkInbound(
        2,
        'quoteonly@beta.io',
        'Re: Project',
        'Got it, thanks!\n\nOn Mon, Jan 1, 2024 at 9:00 AM Me <me@example.com> wrote:\n> we will unsubscribe you from the list',
      ),
      mkInbound(3, 'outbound@gamma.co', 'Re: Project', 'Ack — see attached.'),
    ];
    const sent = [
      mkSent(1, 'dropme@acme.com', 'Project', 'Looping in.'),
      mkSent(2, 'quoteonly@beta.io', 'Project', 'Looping in.'),
      mkSent(3, 'outbound@gamma.co', 'Project', 'Heads up — we are about to unsubscribe you from the legacy queue.'),
    ];
    const fxt: Fixture = {
      folders: [
        { path: 'INBOX', uidvalidity: 1, specialUse: '\\Inbox', messages: inbox },
        { path: 'Sent', uidvalidity: 2, specialUse: '\\Sent', messages: sent },
      ],
    };
    const memoryCipher = {
      isAvailable: () => true,
      encrypt: (s: string) => Buffer.from('ENC:' + s, 'utf8'),
      decrypt: (b: Buffer) => b.toString('utf8').replace(/^ENC:/, ''),
    };
    const client = new FakeImapClient(fxt);
    const result = await runScan(
      {
        credentials: TEST_CREDENTIALS,
        options: ScanOptions.parse({
          parseBodies: true,
          excludeWordsInbound: ['unsubscribe'],
          excludeWordsOutbound: ['unsubscribe'],
        }),
        onProgress: () => undefined,
        signal: new AbortController().signal,
      },
      { db, client, progressIntervalMs: 0, bodyCipher: memoryCipher },
    );

    const emails = [...iterateAllAddresses(db, result.accountId)]
      .filter((a) => a.tags.includes('kept'))
      .map((a) => a.emailNormalized);
    expect(emails).not.toContain('dropme@acme.com');
    expect(emails).not.toContain('outbound@gamma.co');
    expect(emails).toContain('quoteonly@beta.io');
  });

  it("directionMode='one' surfaces contacts that wrote only inbound (no reply needed)", async () => {
    const baseDate = Date.UTC(2024, 0, 1);
    function mk(uid: number, fromEmail: string) {
      const m = new Map<string, string>();
      m.set('from', fromEmail);
      m.set('to', TEST_CREDENTIALS.username);
      m.set('date', new Date(baseDate + uid * 60_000).toUTCString());
      m.set('subject', `Hello #${uid}`);
      m.set('message-id', `<m-${uid}@external.com>`);
      return { uid, dateMs: baseDate + uid * 60_000, headers: m };
    }
    const fxt: Fixture = {
      folders: [
        {
          path: 'INBOX',
          uidvalidity: 1,
          specialUse: '\\Inbox',
          // 2 inbound messages, NO reply from the user.
          messages: [mk(1, 'partner@acme.com'), mk(2, 'partner@acme.com')],
        },
      ],
    };
    const client = new FakeImapClient(fxt);

    // Default 'bi' mode: the contact must have ≥1 outbound — they don't,
    // so they're filtered.
    {
      const dbA = setupTestDb();
      try {
        const r = await runScan(
          {
            credentials: TEST_CREDENTIALS,
            options: ScanOptions.parse({}),
            onProgress: () => undefined,
            signal: new AbortController().signal,
          },
          { db: dbA, client, progressIntervalMs: 0 },
        );
        const tagsBi = [...iterateAllAddresses(dbA, r.accountId)].find(
          (a) => a.emailNormalized === 'partner@acme.com',
        )?.tags;
        expect(tagsBi).toBeDefined();
        expect(tagsBi).toContain('filtered:not-bidirectional');
      } finally {
        closeDb(dbA);
      }
    }

    // 'one' mode with minMessages=2: the contact passes the directional
    // rule on inbound count alone.
    {
      const clientB = new FakeImapClient(fxt);
      const result = await runScan(
        {
          credentials: TEST_CREDENTIALS,
          options: ScanOptions.parse({ directionMode: 'one', minMessages: 2 }),
          onProgress: () => undefined,
          signal: new AbortController().signal,
        },
        { db, client: clientB, progressIntervalMs: 0 },
      );
      const tagsOne = [...iterateAllAddresses(db, result.accountId)].find(
        (a) => a.emailNormalized === 'partner@acme.com',
      )?.tags;
      expect(tagsOne).toEqual(['kept']);
      expect(result.contactsCount).toBe(1);
    }
  });

  it("filters out a contact whose body contains a 'reply with unsubscribe' instruction when parseBodies is on", async () => {
    const baseDate = Date.UTC(2024, 0, 1);
    function mkInbound(uid: number, fromEmail: string, subject: string, body: string) {
      const m = new Map<string, string>();
      m.set('from', fromEmail);
      m.set('to', TEST_CREDENTIALS.username);
      m.set('date', new Date(baseDate + uid * 60_000).toUTCString());
      m.set('subject', subject);
      m.set('message-id', `<m-${uid}@external.com>`);
      return { uid, dateMs: baseDate + uid * 60_000, headers: m, body };
    }
    function mkSent(uid: number, toEmail: string, subject: string) {
      const m = new Map<string, string>();
      m.set('from', TEST_CREDENTIALS.username);
      m.set('to', toEmail);
      m.set('date', new Date(baseDate + uid * 60_000).toUTCString());
      m.set('subject', subject);
      m.set('message-id', `<s-${uid}@example.com>`);
      return { uid, dateMs: baseDate + uid * 60_000, headers: m, body: 'OK, thanks.' };
    }

    // Mailer hides every unsubscribe instruction in the BODY — no
    // List-Unsubscribe / List-Id / Auto-Submitted, so header-only scan
    // happily passes them through. parseBodies must catch this.
    const inbox = [
      mkInbound(
        1,
        'mailer@semi-manual.com',
        'Weekly digest',
        'Hi! Lots of news this week.\nTo opt out, please reply to this email with the word UNSUBSCRIBE.',
      ),
      mkInbound(
        2,
        'mailer@semi-manual.com',
        'Weekly digest #2',
        'Another newsletter — reply with "Unsubscribe" if you want off the list.',
      ),
    ];
    const sent = [mkSent(1, 'mailer@semi-manual.com', 'Re: Weekly digest')];
    const fxt: Fixture = {
      folders: [
        { path: 'INBOX', uidvalidity: 1, specialUse: '\\Inbox', messages: inbox },
        { path: 'Sent', uidvalidity: 2, specialUse: '\\Sent', messages: sent },
      ],
    };

    // In-memory cipher stub — the integration test path doesn't have
    // Electron's safeStorage available, so we feed our own.
    const memoryCipher = {
      isAvailable: () => true,
      encrypt: (s: string) => Buffer.from('ENC:' + s, 'utf8'),
      decrypt: (b: Buffer) => b.toString('utf8').replace(/^ENC:/, ''),
    };

    // Header-only scan: contact passes (sender has bidirectional traffic
    // and zero automation headers).
    {
      const dbA = setupTestDb();
      try {
        const client = new FakeImapClient(fxt);
        const r = await runScan(
          {
            credentials: TEST_CREDENTIALS,
            options: ScanOptions.parse({}),
            onProgress: () => undefined,
            signal: new AbortController().signal,
          },
          { db: dbA, client, progressIntervalMs: 0, bodyCipher: memoryCipher },
        );
        const tags = [...iterateAllAddresses(dbA, r.accountId)].find(
          (a) => a.emailNormalized === 'mailer@semi-manual.com',
        )?.tags;
        expect(tags).toEqual(['kept']);
      } finally {
        closeDb(dbA);
      }
    }

    // Deep scan: same fixture, parseBodies on. The inline-unsubscribe
    // detector flips the bit on every inbound message; classifier rules
    // every-message-automated → contact dropped.
    {
      const dbB = setupTestDb();
      try {
        const client = new FakeImapClient(fxt);
        const r = await runScan(
          {
            credentials: TEST_CREDENTIALS,
            options: ScanOptions.parse({ parseBodies: true }),
            onProgress: () => undefined,
            signal: new AbortController().signal,
          },
          { db: dbB, client, progressIntervalMs: 0, bodyCipher: memoryCipher },
        );
        const tags = [...iterateAllAddresses(dbB, r.accountId)].find(
          (a) => a.emailNormalized === 'mailer@semi-manual.com',
        )?.tags;
        expect(tags).toBeDefined();
        expect(tags).toContain('filtered:all-messages-automated');
      } finally {
        closeDb(dbB);
      }
    }
  });

  it('produces identical output on a second incremental run (zero new messages)', async () => {
    const client = new FakeImapClient(fixture);
    const opts = ScanOptions.parse({});

    const first = await runScan(
      {
        credentials: TEST_CREDENTIALS,
        options: opts,
        onProgress: () => undefined,
        signal: new AbortController().signal,
      },
      { db, client, progressIntervalMs: 0 },
    );

    const firstMsgCount = countByAccount(db, first.accountId);
    const firstAddresses = listAddresses(db, first.accountId, {}, { offset: 0, limit: 1000 });

    const second = await runScan(
      {
        credentials: TEST_CREDENTIALS,
        options: opts,
        onProgress: () => undefined,
        signal: new AbortController().signal,
      },
      { db, client, progressIntervalMs: 0 },
    );

    const secondMsgCount = countByAccount(db, second.accountId);
    const secondAddresses = listAddresses(db, second.accountId, {}, { offset: 0, limit: 1000 });

    expect(second.accountId).toBe(first.accountId);
    expect(secondMsgCount).toBe(firstMsgCount);
    expect(second.contactsCount).toBe(first.contactsCount);
    expect(secondAddresses.total).toBe(firstAddresses.total);

    // Per-row identity check: same emails, same counts, same tags.
    const firstByEmail = new Map(
      firstAddresses.rows.map((r) => [r.emailNormalized, r] as const),
    );
    for (const r of secondAddresses.rows) {
      const prev = firstByEmail.get(r.emailNormalized);
      expect(prev).toBeDefined();
      expect(r.countIn).toBe(prev!.countIn);
      expect(r.countOut).toBe(prev!.countOut);
      expect(r.tags).toEqual(prev!.tags);
    }
  });

  it('drops expunged messages from the cache on re-scan (live UID sync detects deletion)', async () => {
    // Tiny dedicated fixture: contact has 2 inbounds + 1 outbound. The
    // second inbound subject contains "remove" so excludeWordsInbound
    // would normally filter the contact out. After we delete that
    // message from the fixture (mimicking the user expunging it in
    // their mail client) and re-scan, the live UID sync should drop
    // the cached row, the contact is no longer matched against the
    // exclude rule, and they reappear in the result.
    const baseDate = Date.UTC(2024, 0, 1);
    function mkInbound(uid: number, subject: string) {
      const m = new Map<string, string>();
      m.set('from', '"Boss" <boss@acme.com>');
      m.set('to', TEST_CREDENTIALS.username);
      m.set('date', new Date(baseDate + uid * 60_000).toUTCString());
      m.set('subject', subject);
      m.set('message-id', `<inbox-${uid}@acme.com>`);
      return { uid, dateMs: baseDate + uid * 60_000, headers: m };
    }
    function mkSent(uid: number, subject: string) {
      const m = new Map<string, string>();
      m.set('from', TEST_CREDENTIALS.username);
      m.set('to', 'boss@acme.com');
      m.set('date', new Date(baseDate + uid * 60_000).toUTCString());
      m.set('subject', subject);
      m.set('message-id', `<sent-${uid}@example.com>`);
      return { uid, dateMs: baseDate + uid * 60_000, headers: m };
    }
    const fxt: Fixture = {
      folders: [
        {
          path: 'INBOX',
          uidvalidity: 1,
          specialUse: '\\Inbox',
          messages: [
            mkInbound(1, 'Q3 numbers'),
            mkInbound(2, 'please remove me from the thread'),
          ],
        },
        {
          path: 'Sent',
          uidvalidity: 2,
          specialUse: '\\Sent',
          messages: [mkSent(1, 'Re: Q3 numbers')],
        },
      ],
    };

    // First scan: contact has the "remove" message, gets excluded.
    const client1 = new FakeImapClient(fxt);
    await runScan(
      {
        credentials: TEST_CREDENTIALS,
        options: ScanOptions.parse({
          excludeWordsInbound: ['remove'],
        }),
        onProgress: () => undefined,
        signal: new AbortController().signal,
      },
      { db, client: client1, progressIntervalMs: 0 },
    );
    // Aggregation-level word filters drop the contact BEFORE the
    // addresses table is populated, so boss has no row at all on the
    // first scan.
    const firstAddrs = [...iterateAllAddresses(db, 1)].map((a) => a.emailNormalized);
    expect(firstAddrs).not.toContain('boss@acme.com');
    // Pre-condition: at this point cache holds 3 messages (2 inbox + 1 sent).
    expect(countByAccount(db, 1)).toBe(3);

    // Simulate user deleting the "remove" message in their mail client.
    // The IMAP server expunges it; the next live UID set lacks uid=2.
    fxt.folders[0]!.messages = [mkInbound(1, 'Q3 numbers')];

    // Second scan with the same options.
    const client2 = new FakeImapClient(fxt);
    await runScan(
      {
        credentials: TEST_CREDENTIALS,
        options: ScanOptions.parse({
          excludeWordsInbound: ['remove'],
        }),
        onProgress: () => undefined,
        signal: new AbortController().signal,
      },
      { db, client: client2, progressIntervalMs: 0 },
    );

    // Cache shrank by one: the expunged row is gone.
    expect(countByAccount(db, 1)).toBe(2);

    // Boss now passes the inbound-exclude rule (no remaining message
    // matches) AND the bidirectional + classifier checks, so they
    // surface as a kept contact this time.
    const secondTags = new Map<string, readonly string[]>();
    for (const a of iterateAllAddresses(db, 1)) secondTags.set(a.emailNormalized, a.tags);
    expect(secondTags.get('boss@acme.com')).toEqual(['kept']);

    const remaining = [...iterateByAccount(db, 1)].map((m) => m.messageId);
    expect(remaining).not.toContain('<inbox-2@acme.com>');
    expect(remaining).toContain('<inbox-1@acme.com>');
    expect(remaining).toContain('<sent-1@example.com>');
  });

  it('drops moved-between-folders messages from the source cache (server EXPUNGE + COPY)', async () => {
    // IMAP "move" is COPY + EXPUNGE: the source folder loses the UID,
    // the destination gets a NEW UID (different from the original).
    // We simulate that on a fixture: scan with one inbox message, then
    // mutate the fixture to move it to Archive (drop from INBOX, add
    // to Archive with a different UID), then re-scan with both folders
    // selected. Result: the source-folder cache row is dropped via
    // live UID sync; the destination gets a fresh row via the
    // incremental fetch.
    const baseDate = Date.UTC(2024, 0, 1);
    function mkInbox(uid: number, subject: string) {
      const m = new Map<string, string>();
      m.set('from', '"Boss" <boss@acme.com>');
      m.set('to', TEST_CREDENTIALS.username);
      m.set('date', new Date(baseDate + uid * 60_000).toUTCString());
      m.set('subject', subject);
      m.set('message-id', `<mid-${uid}@acme.com>`);
      return { uid, dateMs: baseDate + uid * 60_000, headers: m };
    }
    const fxt: Fixture = {
      folders: [
        {
          path: 'INBOX',
          uidvalidity: 1,
          specialUse: '\\Inbox',
          messages: [mkInbox(42, 'Project update')],
        },
        {
          path: 'Archive',
          uidvalidity: 2,
          messages: [],
        },
        {
          path: 'Sent',
          uidvalidity: 3,
          specialUse: '\\Sent',
          messages: [],
        },
      ],
    };

    const client1 = new FakeImapClient(fxt);
    await runScan(
      {
        credentials: TEST_CREDENTIALS,
        options: ScanOptions.parse({}),
        onProgress: () => undefined,
        signal: new AbortController().signal,
      },
      { db, client: client1, progressIntervalMs: 0 },
    );
    const inboxFolder = listFoldersByAccount(db, 1).find((f) => f.path === 'INBOX')!;
    const archiveFolder = listFoldersByAccount(db, 1).find(
      (f) => f.path === 'Archive',
    )!;
    expect([...listCachedUidsByFolder(db, inboxFolder.id)]).toEqual([42]);
    expect(listCachedUidsByFolder(db, archiveFolder.id).size).toBe(0);

    // Simulate the user moving the message in their mail client:
    // INBOX loses uid=42; Archive gains a NEW uid (different number,
    // higher than its current uidnext) for the same Message-Id.
    fxt.folders[0]!.messages = [];
    fxt.folders[1]!.messages = [
      {
        uid: 100,
        dateMs: baseDate + 42 * 60_000,
        headers: new Map([
          ['from', '"Boss" <boss@acme.com>'],
          ['to', TEST_CREDENTIALS.username],
          ['date', new Date(baseDate + 42 * 60_000).toUTCString()],
          ['subject', 'Project update'],
          ['message-id', '<mid-42@acme.com>'],
        ]),
      },
    ];

    const client2 = new FakeImapClient(fxt);
    await runScan(
      {
        credentials: TEST_CREDENTIALS,
        options: ScanOptions.parse({
          folderInclude: ['INBOX', 'Archive', 'Sent'],
        }),
        onProgress: () => undefined,
        signal: new AbortController().signal,
      },
      { db, client: client2, progressIntervalMs: 0 },
    );

    // INBOX cache now empty; the message landed in Archive with the
    // server's new UID.
    expect(listCachedUidsByFolder(db, inboxFolder.id).size).toBe(0);
    expect([...listCachedUidsByFolder(db, archiveFolder.id)]).toEqual([100]);
  });

  it('does not crash if listLiveUids fails — falls back to incremental fetch only', async () => {
    // Defensive: a SEARCH ALL flake should not stop the rest of the
    // scan. We patch the FakeImapClient method to throw and verify
    // (a) ingestion still picks up new messages via uidnextSeen, and
    // (b) the scan completes without surfacing the error.
    const baseDate = Date.UTC(2024, 0, 1);
    function mk(uid: number, subject: string) {
      const m = new Map<string, string>();
      m.set('from', '"Boss" <boss@acme.com>');
      m.set('to', TEST_CREDENTIALS.username);
      m.set('date', new Date(baseDate + uid * 60_000).toUTCString());
      m.set('subject', subject);
      m.set('message-id', `<mid-${uid}@acme.com>`);
      return { uid, dateMs: baseDate + uid * 60_000, headers: m };
    }
    const fxt: Fixture = {
      folders: [
        {
          path: 'INBOX',
          uidvalidity: 1,
          specialUse: '\\Inbox',
          messages: [mk(1, 'first')],
        },
        {
          path: 'Sent',
          uidvalidity: 2,
          specialUse: '\\Sent',
          messages: [],
        },
      ],
    };
    const client = new FakeImapClient(fxt);
    let calls = 0;
    client.listLiveUids = async () => {
      calls += 1;
      throw new Error('synthetic search-all failure');
    };

    await runScan(
      {
        credentials: TEST_CREDENTIALS,
        options: ScanOptions.parse({}),
        onProgress: () => undefined,
        signal: new AbortController().signal,
      },
      { db, client, progressIntervalMs: 0 },
    );
    expect(calls).toBeGreaterThan(0);
    expect(countByAccount(db, 1)).toBe(1);
  });
});
