/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { describe, it } from 'vitest';
import { openDb } from '../src/main/db/connection.js';
import {
  classifyAndPersistAddresses,
  rebuildAddressesAggregate,
} from '../src/main/pipeline/aggregation.js';
import { createMetricsCollector } from '../src/main/pipeline/metrics.js';
import { makeConsoleLogger } from '../src/main/pipeline/logger.js';
import { DEFAULT_HEURISTICS_CONFIG } from '../src/shared/heuristics-config.js';
import { readBenchAggregateShapeWithLegacy } from '../src/shared/env-config.js';
import { DEFAULT_SHAPE, seedSyntheticMailbox, type SeedShape } from './_lib/seed.js';
import { buildOutputPath, makeRunHeader } from './_lib/run-header.js';

// Micro-bench: skip the IMAP / ingest path and target the two zones the
// user reported as stalling on a 100k mailbox — Aggregate
// (rebuildAddressesAggregate) and Classify (classifyAndPersistAddresses).
// Generates a synthetic dataset in an in-memory SQLite, runs both passes
// through the real pipeline modules, and writes the metrics JSONL so we
// can compare across commits.
//
// Override the dataset shape via env vars (see src/shared/env-config.ts):
//   BENCH_MESSAGES_PER_FOLDER=20000 BENCH_FOLDERS_COUNT=5 BENCH_CONTACTS=3000 \
//     npm run bench:micro
// `BENCH_FOLDERS=5` (legacy spelling, numeric) still works as an alias.

function shapeFromEnv(): SeedShape {
  const shape = readBenchAggregateShapeWithLegacy({
    folders: DEFAULT_SHAPE.folders.length,
    messagesPerFolder: DEFAULT_SHAPE.messagesPerFolder,
    contacts: DEFAULT_SHAPE.distinctContacts,
  });
  const folderNames =
    shape.folders <= DEFAULT_SHAPE.folders.length
      ? DEFAULT_SHAPE.folders.slice(0, shape.folders)
      : [
          ...DEFAULT_SHAPE.folders,
          ...Array.from(
            { length: shape.folders - DEFAULT_SHAPE.folders.length },
            (_v, i) => `Extra${i}`,
          ),
        ];
  return {
    ...DEFAULT_SHAPE,
    folders: folderNames,
    messagesPerFolder: shape.messagesPerFolder,
    distinctContacts: shape.contacts,
  };
}

describe('aggregate micro-bench', () => {
  it('runs rebuildAddressesAggregate + classifyAndPersistAddresses', async () => {
    const shape = shapeFromEnv();
    const totalEstimate = shape.messagesPerFolder * shape.folders.length;
    const header = makeRunHeader({
      scenario: 'bench-micro-aggregate',
      options: {
        folders: shape.folders.length,
        messagesPerFolder: shape.messagesPerFolder,
        distinctContacts: shape.distinctContacts,
        totalMessages: totalEstimate,
      },
    });
    const metrics = createMetricsCollector(header);
    const logger = makeConsoleLogger(header.runId);
    const endRun = metrics.startSpan('runScan', {
      synthetic: true,
      totalMessages: totalEstimate,
    });

    const db = openDb(':memory:');
    try {
      const endSeed = metrics.startSpan('seed.syntheticMailbox', {
        totalMessages: totalEstimate,
      });
      const seeded = seedSyntheticMailbox(db, shape);
      endSeed({ inserted: seeded.totalMessages });

      const endAgg = metrics.startSpan('final.aggregate', {});
      rebuildAddressesAggregate(
        db,
        seeded.accountId,
        seeded.myAddresses,
        seeded.folderIds,
        {
          includeDomains: [],
          excludeDomains: ['example.com'],
          includeWordsInbound: [],
          excludeWordsInbound: [],
          includeWordsOutbound: [],
          excludeWordsOutbound: [],
        },
        undefined,
        logger,
        metrics,
      );
      endAgg();

      const endClassify = metrics.startSpan('final.classify', {});
      const { keptEmails } = classifyAndPersistAddresses(
        db,
        seeded.accountId,
        seeded.folderIds,
        DEFAULT_HEURISTICS_CONFIG,
        () => undefined,
        logger,
        metrics,
      );
      endClassify({ kept: keptEmails.size });

      endRun({ kept: keptEmails.size });
    } finally {
      db.close();
    }

    const out = buildOutputPath(header);
    await metrics.flush(out);
    // eslint-disable-next-line no-console
    console.log(`[bench-micro-aggregate] metrics → ${out}`);
  });
});
