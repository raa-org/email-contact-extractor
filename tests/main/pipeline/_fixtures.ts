/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import type { Credentials, FolderInfo } from '../../../src/shared/domain.js';
import { Sensitive } from '../../../src/shared/domain.js';
import type {
  FetchHeadersOpts,
  FolderState,
  ImapClientLike,
  RawHeader,
  UidRange,
} from '../../../src/main/imap/client.js';

export interface FakeMessage {
  readonly uid: number;
  readonly dateMs: number;
  readonly headers: Map<string, string>;
  // Optional plain-text body. The fake client serves it as
  // RawHeader.source (raw RFC-822) only when fetchHeaders is called with
  // withBody=true — mirrors what imapflow does with `source: true`.
  readonly body?: string;
}

export interface FakeFolder {
  readonly path: string;
  readonly uidvalidity: number;
  readonly flags?: readonly string[];
  readonly specialUse?: string;
  messages: FakeMessage[];
}

export interface Fixture {
  folders: FakeFolder[];
  // Hooks for cancellation testing
  onFetchYield?: (folder: string, uid: number) => void;
}

export const TEST_CREDENTIALS: Credentials = {
  protocol: 'imap',
  host: 'mail.test.local',
  port: 993,
  tls: true,
  username: 'me@example.com',
  password: Sensitive.parse('not-a-real-password'),
};

const MY_ADDRESS = 'me@example.com';

function H(entries: Record<string, string>): Map<string, string> {
  const m = new Map<string, string>();
  for (const [k, v] of Object.entries(entries)) m.set(k.toLowerCase(), v);
  return m;
}

const BASE_DATE = Date.UTC(2024, 0, 1, 9, 0, 0);
function dateAt(uid: number): number {
  return BASE_DATE + uid * 60_000; // one minute per uid
}

let inboxUid = 0;
let sentUid = 0;
let archiveUid = 0;
let spamUid = 0;

function legitInbound(senderEmail: string, senderName: string, subject: string): FakeMessage {
  inboxUid += 1;
  return {
    uid: inboxUid,
    dateMs: dateAt(inboxUid),
    headers: H({
      from: `"${senderName}" <${senderEmail}>`,
      to: MY_ADDRESS,
      date: new Date(dateAt(inboxUid)).toUTCString(),
      subject,
      'message-id': `<inbox-${inboxUid}@external.com>`,
    }),
  };
}

function legitSent(toEmail: string, subject: string): FakeMessage {
  sentUid += 1;
  return {
    uid: sentUid,
    dateMs: dateAt(sentUid + 100_000),
    headers: H({
      from: MY_ADDRESS,
      to: toEmail,
      date: new Date(dateAt(sentUid + 100_000)).toUTCString(),
      subject,
      'message-id': `<sent-${sentUid}@example.com>`,
    }),
  };
}

function newsletter(senderEmail: string, subject: string): FakeMessage {
  spamUid += 1;
  return {
    uid: spamUid,
    dateMs: dateAt(spamUid + 200_000),
    headers: H({
      from: `"Newsletter" <${senderEmail}>`,
      to: MY_ADDRESS,
      date: new Date(dateAt(spamUid + 200_000)).toUTCString(),
      subject,
      'list-unsubscribe': '<mailto:unsubscribe@news.example.com>',
      precedence: 'bulk',
      'message-id': `<news-${spamUid}@news.example.com>`,
    }),
  };
}

function noreply(senderEmail: string, subject: string): FakeMessage {
  inboxUid += 1;
  return {
    uid: inboxUid,
    dateMs: dateAt(inboxUid),
    headers: H({
      from: senderEmail,
      to: MY_ADDRESS,
      date: new Date(dateAt(inboxUid)).toUTCString(),
      subject,
      'message-id': `<noreply-${inboxUid}@bank.com>`,
    }),
  };
}

function internalInbound(senderEmail: string, subject: string): FakeMessage {
  inboxUid += 1;
  return {
    uid: inboxUid,
    dateMs: dateAt(inboxUid),
    headers: H({
      from: senderEmail,
      to: MY_ADDRESS,
      date: new Date(dateAt(inboxUid)).toUTCString(),
      subject,
      'message-id': `<internal-${inboxUid}@example.com>`,
    }),
  };
}

function archiveInbound(senderEmail: string, senderName: string, subject: string): FakeMessage {
  archiveUid += 1;
  return {
    uid: archiveUid,
    dateMs: dateAt(archiveUid + 50_000),
    headers: H({
      from: `"${senderName}" <${senderEmail}>`,
      to: MY_ADDRESS,
      date: new Date(dateAt(archiveUid + 50_000)).toUTCString(),
      subject,
      'message-id': `<archive-${archiveUid}@external.com>`,
    }),
  };
}

export function buildFixture(): Fixture {
  inboxUid = 0;
  sentUid = 0;
  archiveUid = 0;
  spamUid = 0;

  const inboxMessages: FakeMessage[] = [];
  const sentMessages: FakeMessage[] = [];
  const archiveMessages: FakeMessage[] = [];
  const spamMessages: FakeMessage[] = [];

  // Three legit counterparties — bidirectional in both INBOX and Sent.
  for (let i = 0; i < 15; i += 1) {
    inboxMessages.push(legitInbound('partner1@acme.com', 'Partner One', `Acme #${i}`));
  }
  for (let i = 0; i < 10; i += 1) {
    inboxMessages.push(legitInbound('partner2@beta.io', 'Partner Two', `Beta #${i}`));
  }
  for (let i = 0; i < 10; i += 1) {
    inboxMessages.push(legitInbound('partner3@gamma.co', 'Partner Three', `Gamma #${i}`));
  }
  for (let i = 0; i < 5; i += 1) {
    sentMessages.push(legitSent('partner1@acme.com', `Re: Acme #${i}`));
  }
  for (let i = 0; i < 5; i += 1) {
    sentMessages.push(legitSent('partner2@beta.io', `Re: Beta #${i}`));
  }
  for (let i = 0; i < 5; i += 1) {
    sentMessages.push(legitSent('partner3@gamma.co', `Re: Gamma #${i}`));
  }

  // Newsletter senders — inbound only, automated.
  for (let i = 0; i < 12; i += 1) {
    spamMessages.push(newsletter('news@news.example.com', `Weekly #${i}`));
  }
  for (let i = 0; i < 8; i += 1) {
    spamMessages.push(newsletter('updates@list.example.com', `Update #${i}`));
  }

  // noreply automation localpart — inbound only.
  for (let i = 0; i < 8; i += 1) {
    inboxMessages.push(noreply('noreply@bank.com', `Statement #${i}`));
  }

  // Role address WITHOUT user reply.
  for (let i = 0; i < 8; i += 1) {
    inboxMessages.push(legitInbound('support@vendor.com', 'Vendor Support', `Ticket #${i}`));
  }

  // Role address WITH user reply (role-with-reply rescue).
  for (let i = 0; i < 4; i += 1) {
    inboxMessages.push(legitInbound('support@helpful.io', 'Helpful Support', `Issue #${i}`));
  }
  for (let i = 0; i < 3; i += 1) {
    sentMessages.push(legitSent('support@helpful.io', `Re: Issue #${i}`));
  }

  // Internal traffic (must be filtered out).
  for (let i = 0; i < 10; i += 1) {
    inboxMessages.push(internalInbound('colleague@internal.test', `HR memo #${i}`));
  }
  for (let i = 0; i < 5; i += 1) {
    sentMessages.push(legitSent('colleague@internal.test', `Re: HR #${i}`));
  }

  // Archive: more inbound from partner1.
  for (let i = 0; i < 20; i += 1) {
    archiveMessages.push(archiveInbound('partner1@acme.com', 'Partner One', `Old Acme #${i}`));
  }
  for (let i = 0; i < 20; i += 1) {
    archiveMessages.push(archiveInbound('partner2@beta.io', 'Partner Two', `Old Beta #${i}`));
  }

  return {
    folders: [
      {
        path: 'INBOX',
        uidvalidity: 1000,
        specialUse: '\\Inbox',
        messages: inboxMessages,
      },
      {
        path: 'Sent',
        uidvalidity: 1001,
        specialUse: '\\Sent',
        messages: sentMessages,
      },
      {
        path: 'Archive',
        uidvalidity: 1002,
        messages: archiveMessages,
      },
      {
        path: 'Spam',
        uidvalidity: 1003,
        specialUse: '\\Junk',
        messages: spamMessages,
      },
    ],
  };
}

export function fixtureMessageCount(f: Fixture): number {
  return f.folders.reduce((s, fld) => s + fld.messages.length, 0);
}

export class FakeImapClient implements ImapClientLike {
  private connected = false;

  constructor(private readonly fixture: Fixture) {}

  isConnected(): boolean {
    return this.connected;
  }

  async connect(_credentials: Credentials, _signal?: AbortSignal): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async listFolders(_signal?: AbortSignal): Promise<FolderInfo[]> {
    return this.fixture.folders.map((f) => {
      const base: FolderInfo = {
        path: f.path,
        delimiter: '/',
        flags: [...(f.flags ?? [])],
      };
      return f.specialUse ? { ...base, specialUse: f.specialUse } : base;
    });
  }

  async getFolderState(folderPath: string, _signal?: AbortSignal): Promise<FolderState> {
    const f = this.fixture.folders.find((x) => x.path === folderPath);
    if (!f) throw new Error(`unknown folder: ${folderPath}`);
    const maxUid = f.messages.reduce((m, msg) => Math.max(m, msg.uid), 0);
    return {
      uidvalidity: f.uidvalidity,
      uidnext: maxUid + 1,
      exists: f.messages.length,
    };
  }

  async *fetchHeaders(
    folderPath: string,
    range: UidRange,
    signal?: AbortSignal,
    opts?: FetchHeadersOpts,
  ): AsyncGenerator<RawHeader, void, void> {
    const f = this.fixture.folders.find((x) => x.path === folderPath);
    if (!f) throw new Error(`unknown folder: ${folderPath}`);
    const minUid = rangeMin(range);
    for (const msg of f.messages) {
      if (msg.uid < minUid) continue;
      if (signal?.aborted) return;
      this.fixture.onFetchYield?.(folderPath, msg.uid);
      if (signal?.aborted) return;
      // Emulate imapflow's `source: true` — when the caller asks for the
      // body, hand back a synthetic RFC-822 buffer the pipeline can pass
      // to mailparser. Fixtures supply plain text in `body`.
      const source =
        opts?.withBody && msg.body !== undefined
          ? Buffer.from(`Subject: ${msg.headers.get('subject') ?? ''}\r\n\r\n${msg.body}`, 'utf8')
          : null;
      yield {
        uid: msg.uid,
        internalDate: new Date(msg.dateMs),
        flags: new Set<string>(),
        headers: msg.headers,
        source,
      };
    }
  }

  async listLiveUids(
    folderPath: string,
    signal?: AbortSignal,
  ): Promise<readonly number[]> {
    if (signal?.aborted) return [];
    const f = this.fixture.folders.find((x) => x.path === folderPath);
    if (!f) throw new Error(`unknown folder: ${folderPath}`);
    return f.messages.map((m) => m.uid);
  }
}

function rangeMin(range: UidRange): number {
  if (typeof range === 'string') {
    const colon = range.indexOf(':');
    return Number.parseInt(colon === -1 ? range : range.slice(0, colon), 10) || 1;
  }
  if (Array.isArray(range)) return Math.min(...range);
  return (range as { min: number }).min;
}
