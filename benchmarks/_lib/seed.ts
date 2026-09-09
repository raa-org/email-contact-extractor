/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import type { Db } from '../../src/main/db/connection.js';
import { upsertAccount } from '../../src/main/db/accounts.repo.js';
import { upsertFolder } from '../../src/main/db/folders.repo.js';
import { bulkInsertMessages, type NewMessage } from '../../src/main/db/messages.repo.js';

// Mailbox-shape parameters for the synthetic dataset. Defaults model the
// failing 100k-mailbox shape: 5 folders (INBOX + Sent + 3 archives), ~3k
// distinct counterparties, half of them automated/role addresses that
// should be filtered, ~5% chance per message of carrying inline-list-id /
// list-unsubscribe headers.
export interface SeedShape {
  readonly username: string;
  readonly host: string;
  readonly folders: readonly string[];
  readonly messagesPerFolder: number;
  readonly distinctContacts: number;
  // Probability (0..1) the from address falls in the "automated" pool
  // (noreply@, mailer-daemon@, etc.). Drives how many addresses the
  // classifier eventually filters out.
  readonly automatedRatio: number;
  // Probability (0..1) the message is outbound (direction='out'). Half &
  // half is the worst-case for the bidirectionality rule and the
  // aggregator's recipient fan-out.
  readonly outboundRatio: number;
  // Inline header presence — list-unsubscribe / list-id / precedence. Models
  // the volume of newsletter-flavoured traffic that the rule engine has
  // to filter.
  readonly listMailRatio: number;
}

export const DEFAULT_SHAPE: SeedShape = {
  username: 'tester@example.com',
  host: 'imap.example.com',
  folders: ['INBOX', 'Sent', 'Archive', 'Newsletters', 'Misc'],
  messagesPerFolder: 20000,
  distinctContacts: 3000,
  automatedRatio: 0.4,
  outboundRatio: 0.4,
  listMailRatio: 0.15,
};

interface ContactPool {
  readonly genuine: readonly string[];
  readonly automated: readonly string[];
}

function buildContacts(distinct: number, automatedRatio: number): ContactPool {
  const automated: string[] = [];
  const genuine: string[] = [];
  const automatedTarget = Math.floor(distinct * automatedRatio);
  const automationLocals = [
    'noreply',
    'no-reply',
    'donotreply',
    'notifications',
    'alerts',
    'mailer-daemon',
    'support',
    'newsletter',
    'marketing',
    'info',
  ];
  for (let i = 0; i < distinct; i += 1) {
    const isAutomated = i < automatedTarget;
    if (isAutomated) {
      const local = automationLocals[i % automationLocals.length] ?? 'noreply';
      automated.push(`${local}+${i}@example${i % 100}.com`);
    } else {
      genuine.push(`person${i}@partner${i % 250}.com`);
    }
  }
  return { genuine, automated };
}

// Mulberry32 PRNG — deterministic, no deps. Same seed → same dataset, so
// run-to-run comparisons measure code changes, not stochastic noise.
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return function next(): number {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted<T>(
  rng: () => number,
  primary: readonly T[],
  secondary: readonly T[],
  primaryProb: number,
): T {
  if (primary.length === 0) {
    if (secondary.length === 0) {
      throw new Error('seed: cannot pick from two empty pools');
    }
    return secondary[Math.floor(rng() * secondary.length)] as T;
  }
  if (secondary.length === 0) return primary[Math.floor(rng() * primary.length)] as T;
  const useAutomated = rng() < primaryProb;
  const pool = useAutomated ? primary : secondary;
  return pool[Math.floor(rng() * pool.length)] as T;
}

export interface SeededAccount {
  readonly accountId: number;
  readonly folderIds: ReadonlySet<number>;
  readonly myAddresses: ReadonlySet<string>;
  readonly totalMessages: number;
}

// Seeds an in-memory or temp-file SQLite database with a synthetic mailbox
// matching `shape`. Returns the account/folder ids the bench will pass to
// the aggregator. ContactsByDirection are correlated with direction so the
// bidirectional rule has something to keep — half of genuine contacts get
// at least one inbound + one outbound message.
export function seedSyntheticMailbox(db: Db, shape: SeedShape, seed = 0xc0ffee): SeededAccount {
  const rng = mulberry32(seed);
  const account = upsertAccount(db, {
    host: shape.host,
    username: shape.username,
    myAddresses: [shape.username],
  });
  const folderIds = new Set<number>();
  const folderRows = shape.folders.map((path, idx) => {
    const row = upsertFolder(db, {
      accountId: account.id,
      path,
      uidvalidity: 1000 + idx,
    });
    folderIds.add(row.id);
    return row;
  });

  const { genuine, automated } = buildContacts(shape.distinctContacts, shape.automatedRatio);
  const myAddresses = new Set([shape.username]);
  let totalMessages = 0;

  // Insert per folder in chunks so we don't hold 100k objects in JS memory
  // longer than necessary. 5k per chunk keeps each transaction snappy
  // (~100 ms on commodity hardware).
  const CHUNK = 5000;
  for (let folderIdx = 0; folderIdx < folderRows.length; folderIdx += 1) {
    const folder = folderRows[folderIdx];
    if (!folder) continue;
    for (let i = 0; i < shape.messagesPerFolder; i += CHUNK) {
      const remaining = Math.min(CHUNK, shape.messagesPerFolder - i);
      const batch: NewMessage[] = [];
      for (let j = 0; j < remaining; j += 1) {
        const uid = i + j + 1;
        // Counterpart is most often a "genuine" contact; outbound and
        // inbound messages share the pool so the aggregator sees both
        // directions for the same email — the precondition for keeping
        // a contact under the bidirectional rule.
        const isOutbound = rng() < shape.outboundRatio;
        const counterpart = pickWeighted(rng, automated, genuine, shape.automatedRatio);
        const subject = `Bench message ${folderIdx}-${uid}`;
        const fromAddr = isOutbound ? shape.username : counterpart;
        const to = isOutbound ? [counterpart] : [shape.username];
        const isList = rng() < shape.listMailRatio;
        batch.push({
          accountId: account.id,
          folderId: folder.id,
          uid,
          messageId: `<bench-${folderIdx}-${uid}@example.com>`,
          inReplyTo: null,
          references: null,
          dateUtc: 1_700_000_000_000 + folderIdx * 86_400_000 + uid * 1000,
          fromAddr,
          fromName: isOutbound ? 'Tester' : `Counterpart ${counterpart}`,
          to,
          cc: null,
          subject,
          hasListUnsubscribe: isList,
          hasListId: isList,
          precedence: isList ? 'bulk' : null,
          autoSubmitted: null,
          direction: isOutbound ? 'out' : 'in',
        });
      }
      bulkInsertMessages(db, batch);
      totalMessages += batch.length;
    }
  }

  return {
    accountId: account.id,
    folderIds,
    myAddresses,
    totalMessages,
  };
}
