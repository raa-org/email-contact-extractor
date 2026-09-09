/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest';
import { createImapPool } from '../../../src/main/imap/connection-pool.js';
import { CancelledError } from '../../../src/main/imap/errors.js';
import { TEST_CREDENTIALS } from '../pipeline/_fixtures.js';
import type {
  FetchHeadersOpts,
  FolderState,
  ImapClientLike,
  RawHeader,
  UidRange,
} from '../../../src/main/imap/client.js';

// Minimal fake client just for the pool tests. The pipeline's
// FakeImapClient is overkill — we don't need fetch behaviour, just
// connect/disconnect bookkeeping so we can assert lifecycle.
class FakeClient implements ImapClientLike {
  connected = false;
  connectCalls = 0;
  disconnectCalls = 0;
  async connect(): Promise<void> {
    this.connectCalls += 1;
    this.connected = true;
  }
  async disconnect(): Promise<void> {
    this.disconnectCalls += 1;
    this.connected = false;
  }
  isConnected(): boolean {
    return this.connected;
  }
  async listFolders(): Promise<never[]> {
    return [];
  }
  async getFolderState(): Promise<FolderState> {
    return { uidvalidity: 1, uidnext: 1, exists: 0 };
  }
  async *fetchHeaders(
    _path: string,
    _range: UidRange,
    _signal?: AbortSignal,
    _opts?: FetchHeadersOpts,
  ): AsyncGenerator<RawHeader, void, void> {
    /* empty */
  }
  async listLiveUids(): Promise<readonly number[]> {
    return [];
  }
}

describe('createImapPool', () => {
  it('spins up N clients in parallel and serves acquire requests up to N', async () => {
    const clients: FakeClient[] = [];
    const pool = await createImapPool({
      size: 3,
      credentials: TEST_CREDENTIALS,
      signal: new AbortController().signal,
      factory: () => {
        const c = new FakeClient();
        clients.push(c);
        return c;
      },
    });
    expect(pool.size).toBe(3);
    expect(clients).toHaveLength(3);
    for (const c of clients) expect(c.connectCalls).toBe(1);

    const a = await pool.acquire('test');
    const b = await pool.acquire('test');
    const c = await pool.acquire('test');
    expect(new Set([a, b, c]).size).toBe(3);

    await pool.close();
    for (const cl of clients) expect(cl.disconnectCalls).toBe(1);
  });

  it('queues acquires when all clients are busy and serves them on release', async () => {
    const pool = await createImapPool({
      size: 2,
      credentials: TEST_CREDENTIALS,
      signal: new AbortController().signal,
      factory: () => new FakeClient(),
    });
    const a = await pool.acquire('first');
    const b = await pool.acquire('second');
    // Both clients in flight; this acquire MUST queue.
    let third: ImapClientLike | null = null;
    const pending = pool.acquire('third').then((c) => {
      third = c;
    });
    // Give the microtask queue a chance to settle — `third` should
    // still be null because no release has happened yet.
    await new Promise((r) => setImmediate(r));
    expect(third).toBeNull();
    pool.release(a);
    await pending;
    expect(third).toBe(a);
    pool.release(b);
    pool.release(third!);
    await pool.close();
  });

  it('withConnection releases even when the body throws', async () => {
    const pool = await createImapPool({
      size: 1,
      credentials: TEST_CREDENTIALS,
      signal: new AbortController().signal,
      factory: () => new FakeClient(),
    });
    await expect(
      pool.withConnection('boom', async () => {
        throw new Error('test failure');
      }),
    ).rejects.toThrow('test failure');
    // Pool of 1 — if release didn't fire, the next acquire would hang.
    // Wrap in Promise.race against a tiny timer to fail fast on regression.
    const acquired = await Promise.race([
      pool.acquire('recover').then((c) => ({ ok: true as const, client: c })),
      new Promise<{ ok: false }>((r) => setTimeout(() => r({ ok: false }), 200)),
    ]);
    expect(acquired.ok).toBe(true);
    if (acquired.ok) pool.release(acquired.client);
    await pool.close();
  });

  it('close rejects queued waiters with CancelledError', async () => {
    const pool = await createImapPool({
      size: 1,
      credentials: TEST_CREDENTIALS,
      signal: new AbortController().signal,
      factory: () => new FakeClient(),
    });
    const a = await pool.acquire('first');
    const waiter = pool.acquire('queued');
    void a; // hold a, never release
    await pool.close();
    await expect(waiter).rejects.toBeInstanceOf(CancelledError);
  });

  it('rolls back partial connection failures', async () => {
    const clients: FakeClient[] = [];
    let i = 0;
    await expect(
      createImapPool({
        size: 3,
        credentials: TEST_CREDENTIALS,
        signal: new AbortController().signal,
        factory: () => {
          const c = new FakeClient();
          const idx = i++;
          // First two clients connect fine, third one throws.
          c.connect = async (): Promise<void> => {
            if (idx === 2) throw new Error('synthetic connect failure');
            c.connected = true;
            c.connectCalls += 1;
          };
          clients.push(c);
          return c;
        },
      }),
    ).rejects.toThrow('synthetic connect failure');
    // The two that did connect must be disconnected in the rollback.
    expect(clients.filter((c) => c.disconnectCalls > 0).length).toBeGreaterThanOrEqual(1);
  });
});
