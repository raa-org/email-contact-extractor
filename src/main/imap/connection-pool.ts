/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

// Bounded pool of IMAP connections for the scan pipeline.
//
// The Phase A scan ran every fetch on one TCP session — folders ingest
// strictly serial, deep-scan chunks dispatched one folder at a time.
// That serialised both network latency and parsing CPU even with the
// worker_threads pool in place. This module hands out N parallel
// `ImapClient` instances (each its own TCP+TLS+LOGIN) so the runner
// can `Promise.all` across folders and let the IMAP server saturate
// its own I/O fan-out.
//
// Design:
//
//   • `acquire(opName)` returns a free client; if all N are busy the
//     promise queues up behind whoever releases next. Optional
//     opName threads through to logs so a stuck wait shows what the
//     caller wanted.
//
//   • `release(client)` hands the client back; if a waiter is queued,
//     it gets the client directly without a free-list round-trip.
//
//   • `withConnection(fn)` is the standard wrap — acquire, run, release
//     in `finally` even if the body throws. This is the API callers
//     should use 95% of the time.
//
//   • `close()` rejects every queued waiter and disconnects every
//     client. Safe to call from a `finally` block at the end of a scan;
//     idempotent.
//
// Pool size policy: the IPC handler caps it at 4 to match what Cyrus
// and most public IMAP services (Gmail at 15, Outlook at ~10, generic
// dovecot at 10) tolerate without throttling. 4 is also the working
// upper bound where parallel parse + network IO + DB writer can keep
// each other busy without thrashing.

import type { Credentials } from '../../shared/domain.js';
import { CancelledError } from './errors.js';
import { ImapClient, type ImapClientLike } from './client.js';
import type { PipelineLogger } from '../pipeline/logger.js';

export interface ImapConnectionPool {
  // Block until a client is free, then return it. Caller owns the
  // client until `release()` is called. Throws CancelledError if the
  // pool is closed or the signal aborts while we wait.
  acquire(opName: string): Promise<ImapClientLike>;
  release(client: ImapClientLike): void;
  // Acquire / release wrapper. Releases the client back to the pool
  // even if `fn` throws. This is what 95% of callers should use.
  withConnection<T>(opName: string, fn: (client: ImapClientLike) => Promise<T>): Promise<T>;
  // Reject every queued waiter, disconnect every client. Idempotent.
  close(): Promise<void>;
  readonly size: number;
}

export interface CreatePoolArgs {
  readonly size: number;
  readonly credentials: Credentials;
  readonly signal: AbortSignal;
  readonly logger?: PipelineLogger;
  // Factory hook so tests can substitute a fake client. Production
  // code leaves this unset and we instantiate `new ImapClient()`.
  readonly factory?: () => ImapClientLike;
}

interface Waiter {
  readonly resolve: (client: ImapClientLike) => void;
  readonly reject: (err: Error) => void;
  readonly opName: string;
}

// Spin up the pool. Connections come up in parallel — at N=4 on a
// healthy LAN we observed ~150 ms per connect, so serial connection
// would add ~600 ms to startup. `Promise.all` keeps the wait flat.
//
// If any one client fails to connect, we tear the rest down and
// re-throw, so callers don't end up with a half-built pool that
// silently degrades to fewer connections than asked for.
export async function createImapPool(args: CreatePoolArgs): Promise<ImapConnectionPool> {
  if (args.size < 1) throw new Error(`pool size must be >= 1, got ${args.size}`);
  const { size, credentials, signal, logger, factory } = args;
  if (signal.aborted) throw new CancelledError('pool create cancelled');

  const clients: ImapClientLike[] = [];
  try {
    await Promise.all(
      Array.from({ length: size }, async () => {
        const client = factory ? factory() : new ImapClient();
        await client.connect(credentials, signal);
        clients.push(client);
      }),
    );
  } catch (err) {
    // Tear down whatever did come up, then surface the original error.
    // Without this rollback the runner would inherit a half-empty pool
    // and we'd burn waiters forever on the missing slot.
    await Promise.allSettled(clients.map((c) => c.disconnect()));
    throw err;
  }

  const free: ImapClientLike[] = [...clients];
  const waiters: Waiter[] = [];
  let closed = false;

  function acquire(opName: string): Promise<ImapClientLike> {
    if (closed) return Promise.reject(new CancelledError('pool is closed'));
    const free0 = free.pop();
    if (free0) return Promise.resolve(free0);
    return new Promise<ImapClientLike>((resolve, reject) => {
      waiters.push({ resolve, reject, opName });
    });
  }

  function release(client: ImapClientLike): void {
    // Closed pool: just drop. `close()` already disconnected the
    // client; pushing it back into `free` would be a leak.
    if (closed) return;
    const waiter = waiters.shift();
    if (waiter) {
      waiter.resolve(client);
      return;
    }
    free.push(client);
  }

  async function withConnection<T>(
    opName: string,
    fn: (client: ImapClientLike) => Promise<T>,
  ): Promise<T> {
    const client = await acquire(opName);
    try {
      return await fn(client);
    } finally {
      release(client);
    }
  }

  async function close(): Promise<void> {
    if (closed) return;
    closed = true;
    // Reject queued waiters first so any awaiting code unwinds before
    // we tear down the underlying sockets — gives caller-side `finally`
    // blocks a chance to run with the pool still in a sane state.
    const closeErr = new CancelledError('pool closed');
    for (const w of waiters) w.reject(closeErr);
    waiters.length = 0;
    free.length = 0;
    await Promise.allSettled(clients.map((c) => c.disconnect()));
    logger?.info('imap-pool-closed', { size });
  }

  return { acquire, release, withConnection, close, size };
}
