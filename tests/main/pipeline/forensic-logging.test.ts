/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sensitive, ScanOptions, type Credentials } from '../../../src/shared/domain.js';
import { closeDb, type Db } from '../../../src/main/db/connection.js';
import { runScan } from '../../../src/main/pipeline/scan-runner.js';
import { makeConsoleLogger } from '../../../src/main/pipeline/logger.js';
import { setupTestDb } from '../db/_helpers.js';
import { FakeImapClient, type Fixture } from './_fixtures.js';

// vi.mock is hoisted to the top of the file. The first parseHeaders call
// throws (mimics a malformed header on a single inbound); every later
// call delegates to the real implementation so the rest of the scan
// completes normally — exactly the production "one bad apple, keep
// going" path.
// Throw deterministically on the INBOX uid=1 message (matched by its
// distinctive subject) so the failure lands inside `ingestFolder` and
// triggers the `ingest-parse-error` forensic log line. Real bootstrap
// calls (deriveMyAddressesFromSent) and the rest of the messages parse
// normally, mimicking production: one busted message, scan keeps going.
vi.mock('../../../src/main/imap/headers.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/main/imap/headers.js')>();
  return {
    ...original,
    parseHeaders: async (h: Map<string, string>) => {
      if (h.get('subject') === 'Q3 numbers') {
        throw new Error('synthetic parse failure for forensic test');
      }
      return original.parseHeaders(h);
    },
  };
});

const CREDS: Credentials = {
  protocol: 'imap',
  host: 'mail.test.local',
  port: 993,
  tls: true,
  username: 'me@example.com',
  password: Sensitive.parse('not-a-real-password'),
};

function H(entries: Record<string, string>): Map<string, string> {
  const m = new Map<string, string>();
  for (const [k, v] of Object.entries(entries)) m.set(k.toLowerCase(), v);
  return m;
}

describe('ingestion forensic logging', () => {
  let db: Db;
  const captured: string[] = [];
  const origStdout = process.stdout.write.bind(process.stdout);
  const origStderr = process.stderr.write.bind(process.stderr);

  beforeEach(() => {
    db = setupTestDb();
    captured.length = 0;
    // Capture every line the structured logger writes through stdout/stderr
    // so the test can grep for the forensic line. The ConsoleLogger sink
    // calls `process.stdout.write(line + '\\n')` for info and
    // `process.stderr.write(...)` for warn/error — so we tap both via
    // a monkey-patch that records and returns true (the write contract).
    // Monkey-patching here rather than vi.spyOn keeps the test free of
    // the stdout-write overload-typing dance.
    (process.stdout.write as unknown) = (chunk: unknown): boolean => {
      captured.push(String(chunk));
      return true;
    };
    (process.stderr.write as unknown) = (chunk: unknown): boolean => {
      captured.push(String(chunk));
      return true;
    };
  });

  afterEach(() => {
    closeDb(db);
    (process.stdout.write as unknown) = origStdout;
    (process.stderr.write as unknown) = origStderr;
  });

  it('logs ingest-parse-error with runId, folder, uid, raw subject/from/messageId, reason — and keeps the scan running', async () => {
    const fixture: Fixture = {
      folders: [
        {
          path: 'INBOX',
          uidvalidity: 1,
          messages: [
            {
              uid: 1,
              dateMs: Date.UTC(2024, 0, 1),
              headers: H({
                from: '"Boss" <boss@acme.com>',
                to: 'me@example.com',
                subject: 'Q3 numbers',
                'message-id': '<boom-1@acme.com>',
              }),
            },
            {
              uid: 2,
              dateMs: Date.UTC(2024, 0, 2),
              headers: H({
                from: '"Boss" <boss@acme.com>',
                to: 'me@example.com',
                subject: 'Re: Q3 numbers',
                'message-id': '<good-2@acme.com>',
              }),
            },
          ],
        },
        {
          path: 'Sent',
          uidvalidity: 2,
          specialUse: '\\Sent',
          messages: [
            {
              uid: 1,
              dateMs: Date.UTC(2024, 0, 3),
              headers: H({
                from: 'me@example.com',
                to: 'boss@acme.com',
                subject: 'Re: Q3 numbers',
                'message-id': '<sent-1@example.com>',
              }),
            },
          ],
        },
      ],
    };

    const client = new FakeImapClient(fixture);
    const result = await runScan(
      {
        runId: 'forensic-test-1234',
        credentials: CREDS,
        options: ScanOptions.parse({}),
        onProgress: () => undefined,
        signal: new AbortController().signal,
      },
      {
        db,
        client,
        progressIntervalMs: 0,
        log: makeConsoleLogger('forensic-test-1234'),
      },
    );

    // Find the forensic log line among captured stdout/stderr writes
    // (warn-level emits — `ingest-parse-error` is logged via logger.warn).
    const forensicLine = captured.find((l) => l.includes('ingest-parse-error'));
    expect(forensicLine).toBeDefined();

    // eslint-disable-next-line no-console
    console.log('\n>>> CAPTURED FORENSIC LOG LINE:\n' + (forensicLine ?? '') + '\n');

    // Hard checks: every key forensic field is present. Structured logger
    // renders strings without spaces unquoted (`folder=INBOX`) and strings
    // with whitespace double-quoted (`rawSubject="Q3 numbers"`).
    expect(forensicLine).toContain('run=forensic-test-1234');
    expect(forensicLine).toContain('folder=INBOX');
    expect(forensicLine).toContain('uid=1');
    expect(forensicLine).toContain('rawSubject="Q3 numbers"');
    expect(forensicLine).toContain('rawFrom=');
    expect(forensicLine).toContain('boss@acme.com');
    expect(forensicLine).toContain('rawMessageId=<boom-1@acme.com>');
    expect(forensicLine).toContain('synthetic parse failure');

    // Scan still produced a result — one busted message didn't kill it.
    expect(result.contactsCount).toBeGreaterThanOrEqual(0);
  });
});
