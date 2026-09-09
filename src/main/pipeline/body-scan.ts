/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import type { Credentials } from '../../shared/domain.js';
import type { Db } from '../db/connection.js';
import {
  listMessagesForContactsBulk,
  updateMessageInlineUnsubscribe,
  type MessageWithFolder,
} from '../db/messages.repo.js';
import {
  BODY_CAP_BYTES,
  listCachedBodyIds,
  upsertMessageBody,
} from '../db/message-bodies.repo.js';
import type { ImapClientLike } from '../imap/client.js';
import type { ImapConnectionPool } from '../imap/connection-pool.js';
import type { CredentialCipher } from '../security/safe-storage.js';
import { isInlineUnsubscribe } from '../classifier/rules/is-inline-unsubscribe.js';
import { CancelledError, describeError } from '../imap/errors.js';
import { withReconnectRetry } from '../imap/retry.js';
import type { ThrottledProgress } from './progress.js';
import { NOOP_METRICS, type MetricsCollector } from './metrics.js';
import {
  makeNoopLogger,
  tracePhase,
  type PipelineLogger,
} from './logger.js';
import { createInlineParser, type Parser } from './parser-pool.js';

function trunc(s: string | null | undefined, n = 200): string {
  if (s === null || s === undefined) return '<none>';
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

// Cap on how many cached messages we look at per kept-candidate contact
// when assembling the deep-scan target list. A high ceiling lets the
// inline-unsubscribe detector see the whole conversation, but a hard
// limit keeps the FETCH window bounded for pathologically chatty
// counterparties.
const MAX_MESSAGES_PER_CONTACT = 5000;

// Cap on UIDs sent to one IMAP FETCH command. Body fetches with `source: true`
// pull full RFC-822 bytes, so a 90k mailbox where every kept contact has
// thousands of messages can blow out the IMAP read buffer or sit on a single
// fetch for minutes with no progress. Splitting into chunks gives the
// renderer per-batch progress and keeps each network round-trip bounded.
const FETCH_CHUNK = 200;

// Defensive pre-parse cap. Network-side, the IMAP fetch already asks
// for at most BODY_CAP_BYTES of source (see imap/client.ts) so under a
// well-behaved server this branch never trips. Kept as belt-and-
// suspenders against (a) servers that ignore `source.maxLength` and
// ship more, (b) future code changes that re-enable full-source fetch.
// Mirrors BODY_CAP_BYTES so "256 KB" is the single number governing
// what we transfer, parse, encrypt, and store for one body — no
// surprise threshold mismatches between stages.
const MAX_RAW_BYTES = BODY_CAP_BYTES;

// Threshold above which we log the parse as "slow" with full message
// metadata (uid, source bytes, elapsed ms). Surfaces pathological
// messages in `main.log` so we can identify a sender or a specific email
// type that consistently stalls the pipeline.
const SLOW_PARSE_MS = 500;

export interface DeepScanArgs {
  readonly runId: string;
  readonly db: Db;
  readonly client: ImapClientLike;
  readonly credentials: Credentials;
  readonly accountId: number;
  readonly keptEmails: ReadonlySet<string>;
  readonly folderIds: ReadonlySet<number>;
  readonly signal: AbortSignal;
  readonly cipher: CredentialCipher;
  readonly inlineUnsubscribeRegex: RegExp;
  readonly now: () => number;
  readonly backoffMs?: readonly number[];
  // Optional progress sink. When supplied, body-scan emits per-message
  // updates ("phase: fetching, currentFolder: bodies (path), processed:N/total")
  // so the UI doesn't appear frozen on large mailboxes.
  readonly progress?: ThrottledProgress;
  readonly logger?: PipelineLogger;
  readonly metrics?: MetricsCollector;
  // Mailparser strategy. Production scans hand in a `worker-pool`
  // backed parser so multiple bodies parse in parallel on background
  // threads; tests / fallback use `createInlineParser()` which runs
  // mailparser on the caller's thread (behaviour-identical to the
  // pre-pool code path). Optional — body-scan defaults to inline so
  // existing callers don't need to plumb a parser through.
  readonly parser?: Parser;
  // IMAP connection pool. When supplied, deep-scan dispatches each
  // folder's body fetch across the pool so INBOX and Sent (the two
  // big folders on any real mailbox) fetch in parallel on separate
  // TCP sessions. Unit tests / fallback omit this and the function
  // walks `groups` serially on `args.client` — exactly the pre-pool
  // shape, behaviour-identical for those callers.
  readonly pool?: ImapConnectionPool;
}

// Deep-scan Pass 2: for each kept-candidate contact, look at every cached
// message of theirs that doesn't already have a body in `message_bodies`,
// fetch the source via IMAP (`source: true`), extract the text/plain part,
// encrypt + store it, and flip `messages.has_inline_unsubscribe` if the
// body matches the inline-unsubscribe regex. Network failures are wrapped
// in `withReconnectRetry` per folder so a transient drop only retries the
// current group.
export async function deepScanBodies(args: DeepScanArgs): Promise<void> {
  const {
    runId,
    db,
    client,
    credentials,
    accountId,
    keptEmails,
    folderIds,
    signal,
    cipher,
    inlineUnsubscribeRegex,
    now,
    backoffMs,
    progress,
  } = args;
  const logger = args.logger ?? makeNoopLogger(runId);
  const metrics = args.metrics ?? NOOP_METRICS;
  const parser = args.parser ?? createInlineParser();

  // Collect every kept contact's messages in a single bulk SQL round-trip
  // (replaces the previous per-contact loop — on the 1528-contact bench
  // that loop alone burned 3.4 s). Dedup by message-id mirrors the
  // aggregator's first-seen-wins semantics for Gmail All-Mail copies;
  // we never want to fetch the same physical message twice.
  const endCollect = tracePhase(logger, metrics, 'deepScan.collectTargets', {
    contacts: keptEmails.size,
  });
  const seenMessageIds = new Set<string>();
  const seenMessageRowIds = new Set<number>();
  const targets: MessageWithFolder[] = [];
  const buckets = listMessagesForContactsBulk(
    db,
    accountId,
    [...keptEmails],
    MAX_MESSAGES_PER_CONTACT,
    folderIds,
  );
  for (const msgs of buckets.values()) {
    for (const m of msgs) {
      // A single physical row can land in multiple buckets (e.g. an
      // outbound message addressed to two kept contacts produces two
      // `matched_email` rows). Dedup first by `id` (catches the exact
      // duplicate) and then by `message_id` (Gmail All-Mail copies that
      // share Message-ID across folders).
      if (seenMessageRowIds.has(m.id)) continue;
      seenMessageRowIds.add(m.id);
      if (m.messageId !== null) {
        if (seenMessageIds.has(m.messageId)) continue;
        seenMessageIds.add(m.messageId);
      }
      targets.push(m);
    }
  }
  endCollect({ targets: targets.length });
  if (targets.length === 0) return;

  // Drop ones already cached.
  const endCachedLookup = tracePhase(logger, metrics, 'deepScan.cachedLookup', {
    targets: targets.length,
  });
  const cached = listCachedBodyIds(db, targets.map((t) => t.id));
  const fresh = targets.filter((t) => !cached.has(t.id));
  endCachedLookup({ cached: cached.size, fresh: fresh.length });
  if (fresh.length === 0) return;

  // Group by folder so we can batch each folder's UIDs into one IMAP
  // FETCH. Folder-scoped retry windows keep failures in one folder from
  // wiping out progress in others.
  const groups = new Map<string, MessageWithFolder[]>();
  for (const m of fresh) {
    const arr = groups.get(m.folderPath) ?? [];
    arr.push(m);
    groups.set(m.folderPath, arr);
  }

  const totalToFetch = fresh.length;
  // Two counters: `bodiesFetched` bumps as soon as IMAP hands us a body
  // (i.e. the moment we know parse work is queued); `bodiesProcessed`
  // bumps inside the parse `.then()` once mailparser has settled. On a
  // slow WAN server one parse can take seconds — without the fetched
  // counter the UI would sit on "0/N" while bytes were already
  // streaming. Renderer progress emits use `bodiesFetched` so the
  // counter starts moving immediately; the parsed counter still drives
  // `deep-scan-done` accuracy.
  let bodiesFetched = 0;
  let bodiesProcessed = 0;
  const contactsCount = keptEmails.size;
  logger.info('deep-scan-start', {
    contacts: contactsCount,
    bodies: totalToFetch,
    folders: groups.size,
  });

  // Periodic heartbeat so a long-running deep-scan on slow IMAP servers
  // produces a visible "still alive" trail in main.log even between
  // chunk-end spans. Without this, a chunk that takes 60 s on a WAN
  // server looks identical to a hung process. Cleared in `finally`
  // below.
  const heartbeatTimer = setInterval(() => {
    logger.info('deep-scan-heartbeat', {
      fetched: bodiesFetched,
      processed: bodiesProcessed,
      total: totalToFetch,
    });
  }, 5000);
  heartbeatTimer.unref();

  // Initial 0/total emit so the UI flips to the bodies phase immediately
  // — without it the user sees a stale "Aggregating contacts" or
  // "Classifying contacts" label until the first chunk's first message
  // arrives, which on a fresh IMAP connect can take a couple of seconds.
  progress?.emit({
    phase: 'fetching-bodies',
    currentFolder: `${contactsCount} contacts`,
    processed: 0,
    total: totalToFetch,
  });
  progress?.flush();

  // Per-folder fetch driver — runs the chunked deep-scan loop on the
  // provided `targetClient`. Extracted so the outer dispatch can call
  // it either serially on `args.client` (no pool) or in parallel via
  // `pool.withConnection` (pool present) without duplicating the
  // hundred-line body of the loop.
  async function processFolderGroup(
    targetClient: ImapClientLike,
    folderPath: string,
    group: MessageWithFolder[],
  ): Promise<void> {
    if (signal.aborted) throw new CancelledError('deep scan cancelled');
    const sortedUids = group.map((m) => m.uid).sort((a, b) => a - b);
    const byUid = new Map(group.map((m) => [m.uid, m]));

    // Chunk the fetch — one giant FETCH on ~10k+ UIDs holds the IMAP
    // socket mid-stream for minutes with no progress signal and stresses
    // imapflow's internal buffers. 200 UIDs/chunk keeps each round-trip
    // bounded and lets the renderer see steady "bodies N/M" progress.
    for (let i = 0; i < sortedUids.length; i += FETCH_CHUNK) {
      const chunk = sortedUids.slice(i, i + FETCH_CHUNK);
      if (signal.aborted) throw new CancelledError('deep scan cancelled');
      const chunkIdx = i / FETCH_CHUNK + 1;
      const endChunk = tracePhase(logger, metrics, 'deepScan.chunk', {
        folder: folderPath,
        chunkIdx,
        size: chunk.length,
      });
      let chunkParseMs = 0;
      let chunkDbMs = 0;
      let chunkBytes = 0;
      let chunkParsed = 0;
      // Pending DB writes for THIS chunk. We accumulate parsed bodies in
      // memory and flush them in a single `BEGIN IMMEDIATE / COMMIT`
      // at the end of the chunk — replaces the previous one-transaction-
      // per-body pattern that meant thousands of fsyncs on a 100k scan.
      interface PendingWrite {
        readonly messageId: number;
        readonly plaintext: string;
        readonly originalBytes: number;
        readonly hasInlineUnsubscribe: boolean;
      }
      const pending: PendingWrite[] = [];

      // Parse promises kicked off for this chunk. With a worker-pool
      // parser these run on background threads in parallel; the pool's
      // round-robin queue absorbs bursts. With the inline parser we
      // degrade to serial (Node's microtask queue chains the awaits)
      // — behaviour-identical to the pre-pool code path.
      const inflightParses: Promise<PendingWrite | null>[] = [];

      await withReconnectRetry(
        {
          client: targetClient,
          credentials,
          signal,
          opName: `deepScanBodies '${folderPath}' chunk=${i / FETCH_CHUNK + 1}`,
          ...(backoffMs ? { backoffMs } : {}),
        },
        async () => {
          for await (const raw of targetClient.fetchHeaders(folderPath, chunk, signal, {
            withBody: true,
          })) {
            if (signal.aborted) throw new CancelledError('deep scan cancelled mid-fetch');
            // Yield to the macro-task queue at the top of every iteration.
            // imapflow may have buffered the whole chunk, in which case
            // `for-await` resolves on a microtask and the loop body chains
            // synchronously through 200 messages before the event loop
            // gets a chance to drain IPC progress emits, signal-abort
            // checks, or the OS message pump (the macOS beach-ball cue).
            await new Promise((resolve) => setImmediate(resolve));
            // Bump fetched the moment a body arrives — even if we end up
            // skipping it (no source / no target) or its parse fails
            // later. Renderer progress emits read this counter so the
            // bar starts moving immediately as IMAP streams bodies in;
            // without this the user stares at "0 / 9678" until the
            // first parse settles, which on a slow WAN can be 30+ s.
            bodiesFetched += 1;
            progress?.emit({
              phase: 'fetching-bodies',
              currentFolder: `${folderPath} · ${contactsCount} contacts`,
              processed: bodiesFetched,
              total: totalToFetch,
            });
            if (raw.source === null) {
              bodiesProcessed += 1;
              continue;
            }
            const target = byUid.get(raw.uid);
            if (target === undefined) {
              bodiesProcessed += 1;
              continue;
            }
            // Truncate the RFC-822 source pre-parse. mailparser can
            // recover from a mid-MIME cut (it parses parts as it goes),
            // and we only need a slab of text/plain to feed the
            // inline-unsubscribe detector + word filter.
            const sourceBytes = raw.source.length;
            chunkBytes += sourceBytes;
            const cappedSource =
              sourceBytes > MAX_RAW_BYTES
                ? raw.source.subarray(0, MAX_RAW_BYTES)
                : raw.source;
            const uid = raw.uid;
            // Kick off the parse — don't await. With a worker pool the
            // request is enqueued; with the inline parser it resolves
            // on the next microtask. Either way the for-await loop
            // continues pulling the next body from IMAP immediately,
            // so fetch IO and parse CPU overlap.
            inflightParses.push(
              parser
                .parse(cappedSource)
                .then(({ text, parseMs }) => {
                  chunkParseMs += parseMs;
                  chunkParsed += 1;
                  if (parseMs > SLOW_PARSE_MS) {
                    logger.warn('body-scan-slow-parse', {
                      folder: folderPath,
                      uid,
                      ms: parseMs.toFixed(0),
                      sourceBytes,
                      truncated: sourceBytes > MAX_RAW_BYTES,
                      mid: trunc(target.messageId),
                      from: trunc(target.fromAddr),
                      subj: trunc(target.subject),
                    });
                  }
                  // Telemetry for the bounded fetch cap: when source
                  // hit the cap AND mailparser couldn't extract any
                  // text, the cap landed inside an HTML-only /
                  // attachment-first MIME and we missed the text part.
                  if (text.length === 0 && sourceBytes >= BODY_CAP_BYTES) {
                    logger.warn('body-scan-empty-text', {
                      folder: folderPath,
                      uid,
                      sourceBytes,
                      mid: trunc(target.messageId),
                      from: trunc(target.fromAddr),
                      subj: trunc(target.subject),
                    });
                  }
                  bodiesProcessed += 1;
                  // No progress.emit here — the renderer's counter is
                  // driven by `bodiesFetched` in the for-await loop
                  // above, so it advances as IMAP streams bodies in
                  // (not as parses settle). Slow-WAN sanity preserved.
                  return {
                    messageId: target.id,
                    plaintext: text,
                    originalBytes: Buffer.byteLength(text, 'utf8'),
                    hasInlineUnsubscribe: isInlineUnsubscribe(
                      target.subject,
                      text,
                      inlineUnsubscribeRegex,
                    ),
                  };
                })
                .catch((parseErr): null => {
                  logger.error('body-scan-parse-error', {
                    folder: folderPath,
                    uid,
                    mid: trunc(target.messageId),
                    from: trunc(target.fromAddr),
                    subj: trunc(target.subject),
                    reason: describeError(parseErr),
                  });
                  bodiesProcessed += 1;
                  // Same reasoning as the success branch above —
                  // progress is driven by the fetch-side counter, no
                  // separate emit on parse failure.
                  return null;
                }),
            );
          }
        },
      );

      // Wait for every parse kicked off in this chunk to settle. With
      // the worker pool this is the point where main-thread CPU
      // becomes idle (parsers run elsewhere); with the inline parser
      // the microtask queue already drained these in order.
      const settled = await Promise.all(inflightParses);
      for (const w of settled) if (w !== null) pending.push(w);

      // One transaction per chunk — replaces the previous per-body
      // BEGIN/COMMIT pattern. On the 8649-body bench that was 8649
      // fsyncs; this brings it to one per chunk (~44 total). A chunk
      // failure rolls the whole chunk back; the next scan re-fetches
      // these UIDs (uidnextSeen isn't touched here — bodies are an
      // attribute of already-ingested messages, not the watermark).
      if (pending.length > 0) {
        const dbStart = performance.now();
        const ts = now();
        db.exec('BEGIN IMMEDIATE');
        try {
          for (const w of pending) {
            upsertMessageBody(
              db,
              { messageId: w.messageId, plaintext: w.plaintext, originalBytes: w.originalBytes },
              cipher,
              ts,
            );
            updateMessageInlineUnsubscribe(db, w.messageId, w.hasInlineUnsubscribe);
          }
          db.exec('COMMIT');
          chunkDbMs += performance.now() - dbStart;
        } catch (err) {
          try {
            db.exec('ROLLBACK');
          } catch {
            /* ignore */
          }
          logger.error('body-scan-write-error', {
            folder: folderPath,
            chunkIdx,
            pending: pending.length,
            reason: describeError(err),
          });
          throw err;
        }
      }

      endChunk({
        folder: folderPath,
        chunkIdx,
        parsed: chunkParsed,
        bytes: chunkBytes,
        parse_ms: chunkParseMs.toFixed(0),
        db_ms: chunkDbMs.toFixed(0),
      });
    }
  }

  // Dispatcher: when an IMAP pool is available, every folder group
  // runs on its own connection in parallel; the inner chunked loop
  // inside `processFolderGroup` stays serial because successive
  // chunks of the same folder share the IMAP mailboxOpen state.
  // Without a pool we walk the groups serially on `args.client` —
  // exactly the pre-pool shape so unit tests don't see a behaviour
  // change.
  //
  // try/finally wraps the dispatch so the heartbeat interval is
  // always cleared, even if a chunk throws.
  try {
    const dbPool = args.pool;
    if (dbPool) {
      logger.info('deep-scan-parallel', {
        folders: groups.size,
        poolSize: dbPool.size,
      });
      await Promise.all(
        [...groups.entries()].map(([folderPath, group]) =>
          dbPool.withConnection(`deepScan '${folderPath}'`, (c) =>
            processFolderGroup(c, folderPath, group),
          ),
        ),
      );
    } else {
      logger.info('deep-scan-sequential', { folders: groups.size });
      for (const [folderPath, group] of groups) {
        await processFolderGroup(client, folderPath, group);
      }
    }
  } finally {
    clearInterval(heartbeatTimer);
  }

  // Final flush so the last batch's "N/N bodies" emit isn't held by the throttler.
  progress?.flush();
  logger.info('deep-scan-done', {
    fetched: bodiesFetched,
    processed: bodiesProcessed,
    total: totalToFetch,
  });
}
