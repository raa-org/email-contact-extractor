/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Credentials } from '../../../src/shared/domain.js';
import { Sensitive } from '../../../src/shared/domain.js';

const { flowMock, ImapFlowCtor } = vi.hoisted(() => {
  const flowMock = {
    connect: vi.fn(),
    logout: vi.fn(),
    list: vi.fn(),
    status: vi.fn(),
    mailboxOpen: vi.fn(),
    mailboxClose: vi.fn(),
    fetch: vi.fn(),
    // ImapClient subscribes to 'close'/'error' to detect server-side socket
    // drops. The mock just records the listeners so tests can fire events
    // synthetically if they want to exercise the drop-detection path.
    on: vi.fn(),
  };
  const ImapFlowCtor = vi.fn((_opts: Record<string, unknown>) => flowMock);
  return { flowMock, ImapFlowCtor };
});

vi.mock('imapflow', () => ({
  ImapFlow: ImapFlowCtor,
}));

import {
  AuthError,
  CancelledError,
  FolderNotFoundError,
  NetworkError,
} from '../../../src/main/imap/errors.js';
import { ImapClient } from '../../../src/main/imap/client.js';

const credentials: Credentials = {
  protocol: 'imap',
  host: 'imap.example.com',
  port: 993,
  tls: true,
  username: 'tester@example.com',
  password: Sensitive.parse('not-a-real-password'),
};

function makeMessage(uid: number, headers: Record<string, string> = {}): unknown {
  const headerMap = new Map<string, string[]>();
  headerMap.set('from', [headers.from ?? `sender${uid}@example.com`]);
  headerMap.set('to', [headers.to ?? 'tester@example.com']);
  headerMap.set('subject', [headers.subject ?? `Subject ${uid}`]);
  headerMap.set('message-id', [headers.messageId ?? `<m-${uid}@example.com>`]);
  return {
    uid,
    internalDate: new Date(1_700_000_000_000 + uid * 1000),
    flags: new Set(['\\Seen']),
    headers: headerMap,
  };
}

async function* fromArray<T>(items: readonly T[]): AsyncGenerator<T, void, void> {
  for (const item of items) {
    yield item;
  }
}

beforeEach(() => {
  for (const fn of Object.values(flowMock) as Mock[]) fn.mockReset();
  ImapFlowCtor.mockClear();
  flowMock.connect.mockResolvedValue(undefined);
  flowMock.logout.mockResolvedValue(undefined);
  flowMock.mailboxClose.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ImapClient.connect / disconnect', () => {
  it('connects with the provided credentials', async () => {
    const client = new ImapClient();
    await client.connect(credentials);
    expect(ImapFlowCtor).toHaveBeenCalledTimes(1);
    const firstCall = ImapFlowCtor.mock.calls[0];
    expect(firstCall).toBeDefined();
    const firstArg = firstCall?.[0];
    expect(firstArg).toBeDefined();
    const args = firstArg as Record<string, unknown>;
    expect(args.host).toBe('imap.example.com');
    expect(args.port).toBe(993);
    expect(args.secure).toBe(true);
    expect(args.logger).toBe(false);
    expect((args.auth as { user: string; pass: string }).user).toBe('tester@example.com');
    expect(flowMock.connect).toHaveBeenCalledOnce();
    expect(client.isConnected()).toBe(true);
  });

  it('throws AuthError on authentication failure', async () => {
    flowMock.connect.mockRejectedValueOnce({
      authenticationFailed: true,
      message: 'Authentication failed',
    });
    const client = new ImapClient();
    await expect(client.connect(credentials)).rejects.toBeInstanceOf(AuthError);
    expect(client.isConnected()).toBe(false);
    expect(flowMock.logout).toHaveBeenCalled();
  });

  it('throws NetworkError on non-auth connect failure', async () => {
    flowMock.connect.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const client = new ImapClient();
    await expect(client.connect(credentials)).rejects.toBeInstanceOf(NetworkError);
    expect(client.isConnected()).toBe(false);
  });

  it('disconnect is a no-op when never connected', async () => {
    const client = new ImapClient();
    await expect(client.disconnect()).resolves.toBeUndefined();
    expect(flowMock.logout).not.toHaveBeenCalled();
  });

  it('disconnect clears state and tolerates logout failure', async () => {
    flowMock.logout.mockRejectedValueOnce(new Error('already closed'));
    const client = new ImapClient();
    await client.connect(credentials);
    await client.disconnect();
    expect(client.isConnected()).toBe(false);
    // A second connect must work (no leaked state)
    await client.connect(credentials);
    expect(client.isConnected()).toBe(true);
  });

  it('rejects double-connect on the same instance', async () => {
    const client = new ImapClient();
    await client.connect(credentials);
    await expect(client.connect(credentials)).rejects.toBeInstanceOf(NetworkError);
  });

  it("flips isConnected back to false when imapflow emits 'close'", async () => {
    const client = new ImapClient();
    await client.connect(credentials);
    expect(client.isConnected()).toBe(true);
    // Pull the 'close' handler the production code registered and fire it
    // ourselves — same effect as the server idle-timing the socket out.
    const closeCall = flowMock.on.mock.calls.find((c) => c[0] === 'close');
    expect(closeCall).toBeDefined();
    const closeHandler = closeCall![1] as () => void;
    closeHandler();
    expect(client.isConnected()).toBe(false);
    // After detection, a fresh connect must succeed without a manual disconnect.
    await client.connect(credentials);
    expect(client.isConnected()).toBe(true);
  });

  it('aborts connect when signal is already aborted', async () => {
    const client = new ImapClient();
    const ac = new AbortController();
    ac.abort();
    await expect(client.connect(credentials, ac.signal)).rejects.toBeInstanceOf(
      CancelledError,
    );
    expect(ImapFlowCtor).not.toHaveBeenCalled();
  });
});

describe('ImapClient.listFolders', () => {
  it('returns flat list including shared namespaces', async () => {
    flowMock.list.mockResolvedValueOnce([
      {
        path: 'INBOX',
        delimiter: '/',
        flags: new Set(['\\HasNoChildren']),
        specialUse: '\\Inbox',
      },
      {
        path: 'Sent',
        delimiter: '/',
        flags: new Set(['\\HasNoChildren']),
        specialUse: '\\Sent',
      },
      {
        path: 'Shared/team-engineering',
        delimiter: '/',
        flags: new Set(['\\HasNoChildren', '\\Shared']),
      },
    ]);
    const client = new ImapClient();
    await client.connect(credentials);
    const folders = await client.listFolders();
    expect(flowMock.list).toHaveBeenCalledWith({ listNamespaces: true });
    expect(folders).toHaveLength(3);
    expect(folders[0]?.specialUse).toBe('\\Inbox');
    const shared = folders.find((f) => f.path === 'Shared/team-engineering');
    expect(shared?.flags).toContain('\\Shared');
    expect(shared?.specialUse).toBeUndefined();
  });

  it('throws when not connected', async () => {
    const client = new ImapClient();
    await expect(client.listFolders()).rejects.toBeInstanceOf(NetworkError);
  });
});

describe('ImapClient.getFolderState', () => {
  it('returns uidvalidity / uidnext / exists', async () => {
    flowMock.status.mockResolvedValueOnce({
      uidValidity: 12345,
      uidNext: 678,
      messages: 2_400,
    });
    const client = new ImapClient();
    await client.connect(credentials);
    const state = await client.getFolderState('INBOX');
    expect(state).toEqual({ uidvalidity: 12345, uidnext: 678, exists: 2_400 });
  });

  it('throws FolderNotFoundError when the server signals nonexistent', async () => {
    flowMock.status.mockRejectedValueOnce(
      Object.assign(new Error('Mailbox does not exist'), { code: 'NoSuchMailbox' }),
    );
    const client = new ImapClient();
    await client.connect(credentials);
    await expect(client.getFolderState('Missing')).rejects.toBeInstanceOf(
      FolderNotFoundError,
    );
  });
});

describe('ImapClient.fetchHeaders', () => {
  it('yields nothing for an empty range', async () => {
    flowMock.mailboxOpen.mockResolvedValueOnce({ path: 'INBOX' });
    flowMock.fetch.mockReturnValueOnce(fromArray([]));
    const client = new ImapClient();
    await client.connect(credentials);
    const out = [];
    for await (const h of client.fetchHeaders('INBOX', '1:10')) out.push(h);
    expect(out).toEqual([]);
    expect(flowMock.mailboxOpen).toHaveBeenCalledWith('INBOX', { readOnly: true });
    expect(flowMock.mailboxClose).toHaveBeenCalled();
  });

  it('yields a single header row', async () => {
    flowMock.mailboxOpen.mockResolvedValueOnce({ path: 'INBOX' });
    flowMock.fetch.mockReturnValueOnce(fromArray([makeMessage(42)]));
    const client = new ImapClient();
    await client.connect(credentials);
    const out = [];
    for await (const h of client.fetchHeaders('INBOX', { min: 42, max: 42 })) {
      out.push(h);
    }
    expect(out).toHaveLength(1);
    expect(out[0]?.uid).toBe(42);
    expect(out[0]?.headers.get('from')).toContain('sender42@example.com');
    expect(out[0]?.flags.has('\\Seen')).toBe(true);
  });

  it('yields many header rows in order', async () => {
    flowMock.mailboxOpen.mockResolvedValueOnce({ path: 'INBOX' });
    flowMock.fetch.mockReturnValueOnce(
      fromArray([makeMessage(1), makeMessage(2), makeMessage(3)]),
    );
    const client = new ImapClient();
    await client.connect(credentials);
    const uids: number[] = [];
    for await (const h of client.fetchHeaders('INBOX', [1, 2, 3])) {
      uids.push(h.uid);
    }
    expect(uids).toEqual([1, 2, 3]);
  });

  it('passes BODY.PEEK[HEADER]-equivalent fetch options', async () => {
    flowMock.mailboxOpen.mockResolvedValueOnce({ path: 'INBOX' });
    flowMock.fetch.mockReturnValueOnce(fromArray([]));
    const client = new ImapClient();
    await client.connect(credentials);
    for await (const _ of client.fetchHeaders('INBOX', '1:5')) {
      void _;
    }
    expect(flowMock.fetch).toHaveBeenCalledWith(
      '1:5',
      { uid: true, internalDate: true, flags: true, headers: true },
      { uid: true },
    );
  });

  it('throws FolderNotFoundError when mailboxOpen fails with not-found', async () => {
    flowMock.mailboxOpen.mockRejectedValueOnce(
      Object.assign(new Error('Mailbox does not exist'), { code: 'NoSuchMailbox' }),
    );
    const client = new ImapClient();
    await client.connect(credentials);
    const it = client.fetchHeaders('Missing', '1:*');
    await expect(it.next()).rejects.toBeInstanceOf(FolderNotFoundError);
  });

  it('cancels mid-stream when AbortSignal fires', async () => {
    flowMock.mailboxOpen.mockResolvedValueOnce({ path: 'INBOX' });
    let yielded = 0;
    async function* slow() {
      for (let i = 1; i <= 10; i += 1) {
        yielded = i;
        yield makeMessage(i);
        await new Promise((r) => setImmediate(r));
      }
    }
    flowMock.fetch.mockReturnValueOnce(slow());

    const client = new ImapClient();
    await client.connect(credentials);

    const ac = new AbortController();
    const out: number[] = [];
    const promise = (async () => {
      for await (const h of client.fetchHeaders('INBOX', '1:10', ac.signal)) {
        out.push(h.uid);
        if (out.length === 2) ac.abort();
      }
    })();

    await expect(promise).rejects.toBeInstanceOf(CancelledError);
    expect(out.length).toBeLessThan(10);
    expect(yielded).toBeLessThan(10);
    expect(flowMock.mailboxClose).toHaveBeenCalled();
  });
});
