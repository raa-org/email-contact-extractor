/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import type { Credentials, FolderInfo } from '../../shared/domain.js';
import type { Db } from '../db/connection.js';
import {
  deleteFolderRows,
  updateFolderState,
  upsertFolder,
} from '../db/folders.repo.js';
import {
  bulkInsertMessagesInline,
  deleteMessagesByUids,
  listCachedUidsByFolder,
  type NewMessage,
} from '../db/messages.repo.js';
import type { FolderState, ImapClientLike, UidRange } from '../imap/client.js';
import {
  CancelledError,
  NetworkError,
  describeError,
  isTransientNetworkError,
} from '../imap/errors.js';
import { sleep } from '../imap/retry.js';
import { parseHeaders, type ParsedHeaders } from '../imap/headers.js';
import { computeDirection } from '../classifier/compute-direction.js';
import { deriveMyAddresses } from '../classifier/derive-my-addresses.js';
import { normalizeEmail } from '../../shared/email-normalize.js';
import type { ThrottledProgress } from './progress.js';
import { NOOP_METRICS, type MetricsCollector } from './metrics.js';
import {
  formatRate,
  makeNoopLogger,
  tracePhase,
  type PipelineLogger,
} from './logger.js';

// How many message rows we group into one transaction during folder
// ingestion. Larger batches reduce SQLite commit overhead but raise the
// cost of a transient IMAP drop mid-batch (the current batch rolls back).
// 500 is the empirical sweet spot for ~50k mailboxes.
export const BATCH_SIZE = 500;

// Default reconnect backoff schedule for ingestion-level transient
// failures. Length governs the retry budget (3 = up to 3 retries / 4
// total attempts). Tests typically pass [0, 0, 0] for instant retries.
const DEFAULT_INGEST_BACKOFF_MS: readonly number[] = [1000, 2000, 4000] as const;

// Heartbeat cadence inside the fetch-and-parse loop. One event every
// ~5k messages gives ~1 line/sec on a healthy fetch (typical 4–10k msgs/s
// throughput on local Cyrus). Tightens the trace enough to localise a
// stall, doesn't flood main.log.
const INGEST_HEARTBEAT_EVERY = 5000;

// Truncate a string to N chars for logs so we never spill an entire mass
// mailing's body or a 2000-char marketing subject into the file. 200 is
// long enough to keep the context useful.
function trunc(s: string | null | undefined, n = 200): string {
  if (s === null || s === undefined) return '<none>';
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

// Shared mutable counter across all per-folder ingest tasks. Pre-pool,
// `processed` came in by value and the function returned the updated
// total; that pattern races the moment multiple folders ingest in
// parallel — both readers see `processed=0` and overwrite each other.
// With a ref-object, `counter.processed += 1` is atomic between awaits
// in Node's single-threaded loop, so parallel ingests can share one
// monotonically growing counter for progress display.
export interface IngestCounter {
  // Total estimate across all folders in the scan (sum of `exists`).
  // Used as the denominator in `progress.emit({total, ...})`.
  readonly totalEstimate: number;
  // Current count of messages observed in this run, across all
  // folders that have started ingest. Bumped by ingestFolder.
  processed: number;
}

export interface IngestFolderArgs {
  readonly runId: string;
  readonly db: Db;
  readonly client: ImapClientLike;
  readonly credentials: Credentials;
  readonly folder: FolderInfo;
  readonly state: FolderState;
  readonly accountId: number;
  readonly myAddresses: ReadonlySet<string>;
  readonly signal: AbortSignal;
  // Replaces the previous `totalEstimate: number; processed: number;`
  // pair so multiple parallel ingestFolder calls share one counter.
  readonly counter: IngestCounter;
  readonly progress: ThrottledProgress;
  readonly now: () => number;
  readonly backoffMs?: readonly number[];
  readonly logger?: PipelineLogger;
  readonly metrics?: MetricsCollector;
}

// Ingest one folder. Resumes naturally on transient connection failures:
// each batch (BATCH_SIZE messages) is committed in its own transaction and
// advances `uidnextSeen`, so a dropped socket mid-folder costs at most the
// in-flight batch — the next iteration restarts `fetchHeaders` from the
// new `uidnextSeen + 1`. Exhausting the retry budget surfaces a descriptive
// NetworkError naming the folder + last-confirmed UID.
export async function ingestFolder(args: IngestFolderArgs): Promise<void> {
  const {
    runId,
    db,
    client,
    credentials,
    folder,
    state,
    accountId,
    myAddresses,
    signal,
    progress,
    now,
    counter,
  } = args;
  const logger = args.logger ?? makeNoopLogger(runId);
  const metrics = args.metrics ?? NOOP_METRICS;
  const backoff = args.backoffMs ?? DEFAULT_INGEST_BACKOFF_MS;
  const startProcessed = counter.processed;
  const endIngestPhase = tracePhase(logger, metrics, 'ingestFolder', {
    folder: folder.path,
    uidnext: state.uidnext,
    exists: state.exists,
  });

  let folderRow = upsertFolder(db, {
    accountId,
    path: folder.path,
    uidvalidity: state.uidvalidity,
  });

  if (folderRow.uidvalidity !== state.uidvalidity) {
    // UIDVALIDITY changed: wipe and full rescan from UID 1.
    deleteFolderRows(db, folderRow.id);
    updateFolderState(db, folderRow.id, {
      uidvalidity: state.uidvalidity,
      uidnextSeen: 0,
    });
    folderRow = { ...folderRow, uidvalidity: state.uidvalidity, uidnextSeen: 0 };
  }

  // Live UID sync — drop cached rows whose source disappeared on the
  // server (expunge / move). Detects deletions and inter-folder moves
  // that the incremental `UID > uidnextSeen` fetch alone cannot see,
  // since those events DON'T advance UIDNEXT. uidnextSeen itself is
  // NOT touched: it's a watermark for "highest UID we ever saw", not
  // "how many we currently have".
  try {
    const endLive = tracePhase(logger, metrics, 'imap.listLiveUids', { folder: folder.path });
    const liveUids = new Set<number>(
      await client.listLiveUids(folder.path, signal),
    );
    endLive({ liveCount: liveUids.size });
    if (signal.aborted) throw new CancelledError('scan cancelled during uid sync');
    const endCached = tracePhase(logger, metrics, 'db.listCachedUids', { folder: folder.path });
    const cachedUids = listCachedUidsByFolder(db, folderRow.id);
    endCached({ cachedCount: cachedUids.size });
    const stale: number[] = [];
    for (const u of cachedUids) if (!liveUids.has(u)) stale.push(u);
    if (stale.length > 0) {
      const endDel = tracePhase(logger, metrics, 'db.deleteStale', {
        folder: folder.path,
        count: stale.length,
      });
      db.exec('BEGIN IMMEDIATE');
      try {
        deleteMessagesByUids(db, folderRow.id, stale);
        db.exec('COMMIT');
      } catch (err) {
        try {
          db.exec('ROLLBACK');
        } catch {
          /* ignore */
        }
        throw err;
      }
      endDel();
    }
    logger.info('uid-sync', {
      folder: folder.path,
      live: liveUids.size,
      cached: cachedUids.size,
      dropped: stale.length,
    });
  } catch (err) {
    if (err instanceof CancelledError) throw err;
    // listLiveUids failure is best-effort: we still want to ingest new
    // messages even if the SEARCH ALL flaked. Log and continue —
    // staleness will be cleaned up on the next successful scan.
    logger.warn('uid-sync-error', {
      folder: folder.path,
      reason: describeError(err),
    });
  }

  if (folderRow.uidnextSeen + 1 >= state.uidnext) {
    // Already up to date.
    progress.emit({
      phase: 'fetching',
      currentFolder: folder.path,
      processed: counter.processed,
      total: counter.totalEstimate,
    });
    endIngestPhase({
      folder: folder.path,
      delta: 0,
      reason: 'already-up-to-date',
    });
    return;
  }

  let highestUid = folderRow.uidnextSeen;
  let batch: NewMessage[] = [];

  // Persist whatever's accumulated so far in its own short transaction and
  // advance uidnextSeen. Calling this with an empty batch is a no-op.
  function flushAndCheckpoint(): void {
    if (batch.length === 0 && highestUid === folderRow.uidnextSeen) return;
    const flushSize = batch.length;
    const flushStart = performance.now();
    db.exec('BEGIN IMMEDIATE');
    try {
      if (batch.length > 0) bulkInsertMessagesInline(db, batch);
      const patch =
        highestUid > folderRow.uidnextSeen
          ? { uidnextSeen: highestUid, lastScannedAt: now() }
          : { lastScannedAt: now() };
      updateFolderState(db, folderRow.id, patch);
      db.exec('COMMIT');
      if (highestUid > folderRow.uidnextSeen) {
        folderRow = { ...folderRow, uidnextSeen: highestUid };
      }
      batch = [];
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw err;
    }
    metrics.event('ingest.flush', {
      folder: folder.path,
      batchSize: flushSize,
      flushMs: performance.now() - flushStart,
      highestUid,
    });
  }

  let attempt = 0;
  const fetchStartedAt = performance.now();
  let parseTotalMs = 0;
  let lastHeartbeatProcessed = counter.processed;
  while (true) {
    if (signal.aborted) throw new CancelledError('scan cancelled mid-folder');

    // Recompute on each iteration — uidnextSeen may have advanced via a
    // checkpoint during a previous iteration.
    if (folderRow.uidnextSeen + 1 >= state.uidnext) break;
    const range: UidRange = { min: folderRow.uidnextSeen + 1 };

    try {
      for await (const raw of client.fetchHeaders(folder.path, range, signal)) {
        if (signal.aborted) throw new CancelledError('scan cancelled mid-folder');
        // Always advance highestUid first so even skipped messages move
        // uidnextSeen forward — we don't want to re-fetch trash next scan.
        if (raw.uid > highestUid) highestUid = raw.uid;
        // Skip Trash entries: the IMAP \Deleted flag marks a message
        // for expunge (Thunderbird's "move to Trash" sets it). These
        // aren't real correspondence and their inclusion was inflating
        // bidirectionality counts and surfacing opted-out contacts.
        if (raw.flags.has('\\Deleted')) {
          counter.processed += 1;
          progress.emit({
            phase: 'fetching',
            currentFolder: folder.path,
            processed: counter.processed,
            total: counter.totalEstimate,
          });
          continue;
        }
        let parsed: ParsedHeaders;
        const parseStart = performance.now();
        try {
          parsed = await parseHeaders(raw.headers);
          parseTotalMs += performance.now() - parseStart;
        } catch (parseErr) {
          // A single malformed header shouldn't kill the whole folder.
          // Log everything we know about the offending message so the
          // user can grep their mail client for it, then skip.
          logger.warn('ingest-parse-error', {
            folder: folder.path,
            uid: raw.uid,
            rawSubject: trunc(raw.headers.get('subject')),
            rawFrom: trunc(raw.headers.get('from')),
            rawMessageId: trunc(raw.headers.get('message-id')),
            reason: describeError(parseErr),
          });
          counter.processed += 1;
          progress.emit({
            phase: 'fetching',
            currentFolder: folder.path,
            processed: counter.processed,
            total: counter.totalEstimate,
          });
          continue;
        }
        const direction = computeDirection(parsed, myAddresses);
        const fromNormalized = parsed.from?.email
          ? normalizeEmail(parsed.from.email)
          : null;
        const newMsg: NewMessage = {
          accountId,
          folderId: folderRow.id,
          uid: raw.uid,
          messageId: parsed.messageId ?? null,
          inReplyTo: parsed.inReplyTo ?? null,
          references: parsed.references.length > 0 ? [...parsed.references] : null,
          dateUtc: tsFor(parsed.date, raw.internalDate),
          fromAddr: fromNormalized,
          fromName: parsed.from?.name ?? null,
          to: parsed.to.map((t) => normalizeEmail(t.email)),
          cc: parsed.cc.map((t) => normalizeEmail(t.email)),
          subject: parsed.subject ?? null,
          hasListUnsubscribe: parsed.hasListUnsubscribe,
          hasListId: parsed.hasListId,
          precedence: parsed.precedence ?? null,
          autoSubmitted: parsed.autoSubmitted ?? null,
          direction,
        };
        batch.push(newMsg);
        counter.processed += 1;
        // Emit per-message — `createThrottledProgress` coalesces to ~10
        // events/sec, so the IPC inbox isn't flooded but the renderer's
        // "processed" counter advances visibly instead of jumping by
        // BATCH_SIZE-message blocks.
        progress.emit({
          phase: 'fetching',
          currentFolder: folder.path,
          processed: counter.processed,
          total: counter.totalEstimate,
        });

        if (batch.length >= BATCH_SIZE) flushAndCheckpoint();
        if (counter.processed - lastHeartbeatProcessed >= INGEST_HEARTBEAT_EVERY) {
          const elapsed = performance.now() - fetchStartedAt;
          const delta = counter.processed - startProcessed;
          logger.heartbeat('ingestFolder', {
            folder: folder.path,
            processed: counter.processed,
            highestUid,
            parseTotalMs: parseTotalMs.toFixed(0),
            rate: formatRate(delta, elapsed, 'msgs'),
          });
          lastHeartbeatProcessed = counter.processed;
        }
      }
      // The fake/real client may finish its iterator silently on signal.aborted.
      if (signal.aborted) throw new CancelledError('scan cancelled before folder commit');
      flushAndCheckpoint();
      break; // success path — leave the retry loop
    } catch (err) {
      // Best-effort: persist whatever we already received before the error.
      // A partial batch + advanced uidnextSeen means the next iteration
      // (or the next scan) won't re-download those messages.
      const lastInBatch = batch.at(-1);
      try {
        flushAndCheckpoint();
      } catch (flushErr) {
        logger.error('ingest-flush-error', {
          folder: folder.path,
          reason: describeError(flushErr),
        });
      }

      // Log identifying detail for the last in-flight message so the
      // user can correlate the crash with a real piece of mail. Even
      // when the failure was at the IMAP layer (no specific message in
      // hand), naming the last-known UID + last-batch tail narrows down
      // the suspect window meaningfully.
      logger.error('ingest-error', {
        folder: folder.path,
        uidnextSeen: folderRow.uidnextSeen,
        highestUid,
        batchSize: batch.length,
        lastMid: trunc(lastInBatch?.messageId ?? null),
        lastFrom: trunc(lastInBatch?.fromAddr ?? null),
        lastSubj: trunc(lastInBatch?.subject ?? null),
        reason: describeError(err),
      });

      if (signal.aborted) throw err;
      if (err instanceof CancelledError) throw err;
      if (!isTransientNetworkError(err)) throw err;

      if (attempt >= backoff.length) {
        throw new NetworkError(
          `Folder '${folder.path}' ingest failed at UID ${folderRow.uidnextSeen} after ${attempt + 1} attempts: ${describeError(err)}`,
          err,
        );
      }

      const delay = backoff[attempt] ?? 1000;
      attempt += 1;
      logger.warn('ingest-retry', {
        folder: folder.path,
        uid: folderRow.uidnextSeen,
        attempt,
        budget: backoff.length,
      });
      await sleep(delay, signal);
      try {
        await client.disconnect();
      } catch {
        /* best effort */
      }
      try {
        await client.connect(credentials, signal);
      } catch (connErr) {
        if (attempt >= backoff.length) {
          throw new NetworkError(
            `Folder '${folder.path}' ingest failed: could not reconnect after ${attempt} attempts (${describeError(connErr)})`,
            connErr,
          );
        }
        // else: next loop iteration will fail fast and retry again
      }
    }
  }

  progress.emit({
    phase: 'fetching',
    currentFolder: folder.path,
    processed: counter.processed,
    total: counter.totalEstimate,
  });
  const totalElapsed = performance.now() - fetchStartedAt;
  const delta = counter.processed - startProcessed;
  endIngestPhase({
    folder: folder.path,
    delta,
    totalAcrossFolders: counter.processed,
    parseTotalMs: parseTotalMs.toFixed(0),
    rate: formatRate(delta, totalElapsed, 'msgs'),
  });
}

function tsFor(parsedDate: Date | null, internalDate: Date): number | null {
  if (parsedDate && !Number.isNaN(parsedDate.getTime())) return parsedDate.getTime();
  if (!Number.isNaN(internalDate.getTime())) return internalDate.getTime();
  return null;
}

// Detects "Sent"-flavoured folders for the myAddresses bootstrap. Accepts
// both the IMAP `\Sent` special-use flag and a small set of common path
// names (case-insensitive, last segment) covering English-language clients
// and the user's Russian-localized server.
export function isSentFolder(f: FolderInfo): boolean {
  if (f.specialUse === '\\Sent') return true;
  const path = f.path.toLowerCase();
  const last = path.split(/[/.]/).pop() ?? '';
  return [
    'sent',
    'sent items',
    'sent mail',
    'sent messages',
    'отправленные',
  ].includes(last);
}

// Cap on how many Sent headers we read per folder when bootstrapping
// `myAddresses`. The set typically converges after ~50–200 messages
// (one address per alias the user actually sends from); scanning all
// 40k Sent headers on a large mailbox burned ~14 s in the previous
// version for the same two-element output. The cap is well above the
// observed convergence point so even unusual setups with multiple
// aliases get caught.
const DERIVE_MYADDR_LIMIT_PER_FOLDER = 2000;

// Reads up to DERIVE_MYADDR_LIMIT_PER_FOLDER messages in each Sent
// folder and harvests their `From` addresses, then unions with the
// login address. The output set labels messages as
// `direction='in'|'out'|'self'` downstream.
//
// Skips messages with malformed headers (logged as
// `derive-myaddr-parse-error`) instead of failing the whole derivation
// — one busted Sent message shouldn't block the rest of the scan.
//
// The cap is enforced by breaking the per-folder iterator early. The
// IMAP server still scans its index (cheap) but stops sending bodies
// once we stop pulling.
export async function deriveMyAddressesFromSent(
  runId: string,
  client: ImapClientLike,
  sentFolders: readonly FolderInfo[],
  credentials: Credentials,
  signal: AbortSignal,
  logger: PipelineLogger = makeNoopLogger(runId),
  metrics: MetricsCollector = NOOP_METRICS,
): Promise<Set<string>> {
  const headers: ParsedHeaders[] = [];
  for (const folder of sentFolders) {
    const endSent = tracePhase(logger, metrics, 'derive-myAddresses.folder', {
      folder: folder.path,
      limit: DERIVE_MYADDR_LIMIT_PER_FOLDER,
    });
    let count = 0;
    let truncated = false;
    for await (const raw of client.fetchHeaders(folder.path, { min: 1 }, signal)) {
      if (signal.aborted) throw new CancelledError('scan cancelled while reading Sent');
      count += 1;
      try {
        headers.push(await parseHeaders(raw.headers));
      } catch (err) {
        logger.warn('derive-myaddr-parse-error', {
          folder: folder.path,
          uid: raw.uid,
          rawFrom: trunc(raw.headers.get('from')),
          reason: describeError(err),
        });
      }
      if (count >= DERIVE_MYADDR_LIMIT_PER_FOLDER) {
        truncated = true;
        break;
      }
    }
    endSent({ folder: folder.path, count, truncated });
  }
  return deriveMyAddresses({
    loginAddress: credentials.username,
    sentHeaders: headers,
  });
}
