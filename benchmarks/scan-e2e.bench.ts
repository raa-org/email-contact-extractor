/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { describe, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/main/db/connection.js';
import { ImapClient } from '../src/main/imap/client.js';
import { runScan } from '../src/main/pipeline/scan-runner.js';
import { createMetricsCollector } from '../src/main/pipeline/metrics.js';
import { makeConsoleLogger } from '../src/main/pipeline/logger.js';
import { Credentials, ScanOptions } from '../src/shared/domain.js';
import {
  readBenchFolderInclude,
  readBenchImapCredentials,
  readBenchParseBodies,
} from '../src/shared/env-config.js';
import { buildOutputPath, makeRunHeader } from './_lib/run-header.js';
import { identityCipher } from './_lib/identity-cipher.js';

// End-to-end bench harness — connects to a real IMAP server, runs the
// full scan pipeline, and writes its metrics JSONL alongside the
// micro-bench output. Designed to reproduce the user-visible "hangs on
// 100k mailbox" symptom under instrumentation, so we can compare bytes-
// over-the-wire vs CPU vs DB time without guessing.
//
// Connection params come from env vars (per CLAUDE.md §9 we never echo
// them to disk):
//   BENCH_IMAP_HOST=imap.example.com
//   BENCH_IMAP_PORT=993                 (defaults to 993)
//   BENCH_IMAP_TLS=true                 (defaults to true)
//   BENCH_IMAP_USER=tester@example.com
//   BENCH_IMAP_PASS=...                 (read from env, never logged)
//   BENCH_PARSE_BODIES=true             (defaults to false)
//   BENCH_FOLDERS=INBOX,Sent            (CSV; omit for "all folders")
//
// The whole bench is gated on BENCH_IMAP_HOST being set — without it we
// `it.skip` so `npm run bench:e2e` is safe to run on CI without secrets.

// Skip-gate evaluated at module load; without `BENCH_IMAP_HOST` we
// `it.skip` so this file is safe to invoke on CI with no secrets.
const itOrSkip = readBenchImapCredentials() !== null ? it : it.skip;

describe('scan e2e bench', () => {
  itOrSkip('runs full IMAP scan against a live server', async () => {
    const creds = readBenchImapCredentials();
    if (creds === null) {
      throw new Error('BENCH_IMAP_HOST/USER/PASS must all be set');
    }
    const parseBodies = readBenchParseBodies();
    const folderInclude = readBenchFolderInclude();

    const credentials = Credentials.parse({
      protocol: 'imap',
      host: creds.host,
      port: creds.port,
      tls: creds.tls,
      username: creds.user,
      password: creds.pass,
    });
    const optionsRaw: Record<string, unknown> = { parseBodies };
    if (folderInclude !== undefined) optionsRaw['folderInclude'] = folderInclude;
    const options = ScanOptions.parse(optionsRaw);

    const header = makeRunHeader({
      scenario: 'bench-e2e-scan',
      options: {
        host: creds.host,
        parseBodies,
        folderIncludeCount: folderInclude?.length ?? null,
      },
    });
    const metrics = createMetricsCollector(header);
    const logger = makeConsoleLogger(header.runId);

    // Temp DB is fresh on each run so cached uidnextSeen / message_bodies
    // never bias the reading. SQLite WAL files land in the same dir.
    const tmpDir = mkdtempSync(join(tmpdir(), 'contact-extractor-bench-'));
    const dbPath = join(tmpDir, 'bench.db');
    const db = openDb(dbPath);
    const client = new ImapClient();
    const controller = new AbortController();

    try {
      const result = await runScan(
        {
          runId: header.runId,
          credentials,
          options,
          onProgress: () => undefined,
          signal: controller.signal,
        },
        {
          db,
          client,
          metrics,
          log: logger,
          bodyCipher: identityCipher,
        },
      );
      metrics.event('scan.result', {
        contactsCount: result.contactsCount,
        accountId: result.accountId,
      });
      // eslint-disable-next-line no-console
      console.log(
        `[bench-e2e-scan] contacts=${result.contactsCount} db=${dbPath}`,
      );
    } finally {
      try {
        await client.disconnect();
      } catch {
        /* best-effort */
      }
      db.close();
      const out = buildOutputPath(header);
      await metrics.flush(out);
      // eslint-disable-next-line no-console
      console.log(`[bench-e2e-scan] metrics → ${out}`);
    }
  });
});
