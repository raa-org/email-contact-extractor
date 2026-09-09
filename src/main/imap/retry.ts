/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import type { Credentials } from '../../shared/domain.js';
import type { ImapClientLike } from './client.js';
import {
  CancelledError,
  NetworkError,
  describeError,
  isTransientNetworkError,
} from './errors.js';

// Backoff schedule for transient connection failures during a scan.
// Three retries (four attempts total) with 1s / 2s / 4s waits — enough to
// ride out a brief blip without making the user wait forever if the server
// is genuinely down.
const DEFAULT_BACKOFF_MS: readonly number[] = [1000, 2000, 4000] as const;

export interface ReconnectRetryContext {
  readonly client: ImapClientLike;
  readonly credentials: Credentials;
  readonly signal: AbortSignal;
  readonly opName: string;
  readonly backoffMs?: readonly number[];
}

export async function withReconnectRetry<T>(
  ctx: ReconnectRetryContext,
  op: () => Promise<T>,
): Promise<T> {
  const backoff = ctx.backoffMs ?? DEFAULT_BACKOFF_MS;
  const maxRetries = backoff.length;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (ctx.signal.aborted) {
      throw new CancelledError(`${ctx.opName} cancelled`);
    }
    try {
      return await op();
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      if (err instanceof CancelledError) throw err;
      if (!isTransientNetworkError(err)) throw err;
      lastErr = err;
      if (attempt === maxRetries) {
        throw new NetworkError(
          `${ctx.opName} failed after ${maxRetries + 1} attempts: ${describeError(err)}`,
          err,
        );
      }
      await sleep(backoff[attempt] ?? 1000, ctx.signal);
      try {
        await ctx.client.disconnect();
      } catch {
        /* best effort — socket may already be gone */
      }
      try {
        await ctx.client.connect(ctx.credentials, ctx.signal);
      } catch (connErr) {
        // If reconnect itself failed, the next iteration's op() will fail
        // fast on the still-disconnected client and we'll loop. Surface a
        // pointed error if the *very last* reconnect attempt was the cause.
        if (attempt + 1 === maxRetries) {
          throw new NetworkError(
            `${ctx.opName} failed: could not reconnect after ${attempt + 1} attempts (${describeError(connErr)})`,
            connErr,
          );
        }
      }
    }
  }
  // Loop guarantees we either return or throw above.
  throw new NetworkError(
    `${ctx.opName} failed: ${describeError(lastErr)}`,
    lastErr,
  );
}

// AbortSignal-aware delay. Throws CancelledError if the signal fires while
// we're sleeping so the retry loop unwinds promptly on user-cancel.
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new CancelledError('sleep cancelled'));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      reject(new CancelledError('sleep cancelled'));
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
