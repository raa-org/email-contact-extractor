/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import type { Db } from '../db/connection.js';
import {
  getSamplesByFromAddrsBulk,
  iterateByAccount,
  type MessageRow,
} from '../db/messages.repo.js';
import {
  iterateAllAddresses,
  replaceAllAddresses,
  setAddressTags,
  type AddressRow,
  type AddressUpsertFull,
} from '../db/addresses.repo.js';
import { classifyContact, type ContactSummary } from '../classifier/classify-contact.js';
import { isDomainInList } from '../classifier/rules/is-domain-in-list.js';
import { stripQuotedReply } from '../classifier/strip-quoted-reply.js';
import type { ParsedHeaders } from '../imap/headers.js';
import type { HeuristicsConfig } from '../../shared/heuristics-config.js';
import { NOOP_METRICS, type MetricsCollector } from './metrics.js';
import {
  formatRate,
  makeNoopLogger,
  tracePhase,
  type PipelineLogger,
} from './logger.js';

// Heartbeat cadence for the aggregator's row-by-row scan. Roughly one
// event per second on 100k mailbox (~50–100k rows/s on commodity hw).
// Granular enough to localise a stall; not so granular that a clean
// pass spams the metrics file.
const AGG_HEARTBEAT_EVERY = 10000;
// Classify heartbeat — addresses are typically 1–10% of message count,
// so a smaller cadence keeps the cardinality similar.
const CLASSIFY_HEARTBEAT_EVERY = 500;

// Subjects we keep on each address row for preview / export — small
// enough that the SQLite addresses row stays compact, large enough to
// give the user a sense of the recent topic mix.
const SUBJECTS_CAP = 5;
// Per-contact sample headers fed into the classifier. Five is enough to
// detect "every-message-automated" without scanning the entire history.
const SAMPLES_CAP = 5;

export interface AggregationScanOpts {
  readonly includeDomains: readonly string[];
  readonly excludeDomains: readonly string[];
  readonly includeWordsInbound: readonly string[];
  readonly excludeWordsInbound: readonly string[];
  readonly includeWordsOutbound: readonly string[];
  readonly excludeWordsOutbound: readonly string[];
}

// Aggregate per CONTACT (the other party), not per from_addr:
//   - inbound  → contact = from_addr (countIn += 1)
//   - outbound → contact = each recipient in to/cc (countOut += 1 per
//     recipient), excluding the user's own addresses
//   - self drafts → ignored
// This is what makes the bidirectionality rule meaningful.
//
// Scope rule (strict): we ONLY iterate messages whose folder_id is in
// `folderIds` — the folders the user picked for THIS scan. Counts,
// subjects, and include/exclude word matches come exclusively from the
// selected folders. Practical consequences:
//   • selecting INBOX only → countOut is 0 (Sent isn't in scope), so the
//     bi-directional rule yields zero contacts. The user must pick at
//     least one inbound + one outbound folder, OR switch to one-directional.
//   • selecting an empty folder gives zero — what the user expects too.
//   • bodies, classifier samples, and the role-address reply-check are
//     scoped the same way (see classifyAndPersistAddresses + deepScanBodies).
//
// Filter knobs from scanOpts (all hard cutoffs applied at the end so they
// never appear in the addresses table; "filtered:" tags remain reserved
// for classifier reasons that the user cares to see):
//   • includeDomains       — whitelist on the contact's email domain.
//   • excludeDomains       — blacklist (subdomain-aware via isDomainInList).
//   • include/exclude words are split by direction (Inbound/Outbound) so the
//     user can say e.g. "drop contacts who *replied* with `unsubscribe`"
//     without their own outbound replies that mention the same word
//     accidentally counting against the contact. For each direction the rule
//     is symmetric:
//       • include — keep iff ≥1 message in that direction matches.
//       • exclude — drop if ANY message in that direction matches.
//     Matching is case-insensitive (both sides pre-lowercased) and runs
//     against the subject; the body is added when deep scan provided one,
//     after `stripQuotedReply` cuts the previous-letter chain so a word in
//     a quoted reply doesn't trigger.
//
// Dedup by Message-ID: Gmail-style servers keep a copy of every message in
// \All Mail in addition to INBOX/Sent, so the same physical message appears
// under different (folder_id, uid) pairs. Counting both inflates count_in /
// count_out. Messages without a Message-ID header are kept as-is — there is
// no reliable key to dedupe them.
export function rebuildAddressesAggregate(
  db: Db,
  accountId: number,
  myAddresses: ReadonlySet<string>,
  folderIds: ReadonlySet<number>,
  scanOpts: AggregationScanOpts,
  // Optional per-message body lookup. Active only on the deep-scan
  // re-aggregation pass. When given, the include/exclude word matchers
  // get a wider haystack (`subject + " " + body`); without it the
  // matchers stay subject-only — keeps Pass 1 / non-deep-scan paths
  // byte-identical to the previous implementation.
  bodyMatcher?: (messageId: number) => string | null,
  logger: PipelineLogger = makeNoopLogger('agg'),
  metrics: MetricsCollector = NOOP_METRICS,
): void {
  interface Aggregate {
    displayNames: Set<string>;
    firstSeen: number;
    lastSeen: number;
    countIn: number;
    countOut: number;
    subjects: string[];
  }
  interface FilterAccum {
    hasIncludeInbound: boolean;
    hasExcludeInbound: boolean;
    hasIncludeOutbound: boolean;
    hasExcludeOutbound: boolean;
  }
  const agg = new Map<string, Aggregate>();
  const seenMessageIds = new Set<string>();
  const filterAccum = new Map<string, FilterAccum>();

  // Lower-cased / trimmed filter inputs, computed once.
  const lower = (xs: readonly string[]): string[] =>
    xs.map((w) => w.trim().toLowerCase()).filter((w) => w.length > 0);
  const incIn = lower(scanOpts.includeWordsInbound);
  const excIn = lower(scanOpts.excludeWordsInbound);
  const incOut = lower(scanOpts.includeWordsOutbound);
  const excOut = lower(scanOpts.excludeWordsOutbound);

  function noteFilters(
    email: string,
    subject: string | null,
    body: string | null,
    side: 'in' | 'out',
  ): void {
    let f = filterAccum.get(email);
    if (!f) {
      f = {
        hasIncludeInbound: false,
        hasExcludeInbound: false,
        hasIncludeOutbound: false,
        hasExcludeOutbound: false,
      };
      filterAccum.set(email, f);
    }
    // Subject as-is, body with quoted-reply chain stripped so a word that
    // only appears in `On … wrote:` history doesn't count for either side.
    const cleanedBody = body !== null ? stripQuotedReply(body) : '';
    const haystack = (
      cleanedBody.length > 0 ? `${subject ?? ''} ${cleanedBody}` : (subject ?? '')
    ).toLowerCase();
    const inc = side === 'in' ? incIn : incOut;
    const exc = side === 'in' ? excIn : excOut;
    if (inc.length > 0) {
      if (side === 'in' && !f.hasIncludeInbound && inc.some((w) => haystack.includes(w))) {
        f.hasIncludeInbound = true;
      } else if (side === 'out' && !f.hasIncludeOutbound && inc.some((w) => haystack.includes(w))) {
        f.hasIncludeOutbound = true;
      }
    }
    if (exc.length > 0) {
      if (side === 'in' && !f.hasExcludeInbound && exc.some((w) => haystack.includes(w))) {
        f.hasExcludeInbound = true;
      } else if (side === 'out' && !f.hasExcludeOutbound && exc.some((w) => haystack.includes(w))) {
        f.hasExcludeOutbound = true;
      }
    }
  }

  function touch(
    email: string,
    msg: {
      id: number;
      dateUtc: number | null;
      subject: string | null;
      fromName: string | null;
    },
    side: 'in' | 'out',
  ): void {
    let a = agg.get(email);
    if (!a) {
      a = {
        displayNames: new Set<string>(),
        firstSeen: Number.POSITIVE_INFINITY,
        lastSeen: 0,
        countIn: 0,
        countOut: 0,
        subjects: [],
      };
      agg.set(email, a);
    }
    if (side === 'in') {
      a.countIn += 1;
      if (msg.fromName) a.displayNames.add(msg.fromName);
    } else {
      a.countOut += 1;
    }
    if (msg.dateUtc !== null) {
      if (msg.dateUtc < a.firstSeen) a.firstSeen = msg.dateUtc;
      if (msg.dateUtc > a.lastSeen) a.lastSeen = msg.dateUtc;
    }
    if (msg.subject && a.subjects.length < SUBJECTS_CAP && !a.subjects.includes(msg.subject)) {
      a.subjects.push(msg.subject);
    }
    const body = bodyMatcher ? bodyMatcher(msg.id) : null;
    noteFilters(email, msg.subject, body, side);
  }

  const endIter = tracePhase(logger, metrics, 'aggregate.iterateMessages', {
    folderScope: folderIds.size,
    withBodyMatcher: bodyMatcher !== undefined,
  });
  const iterStart = performance.now();
  let scanned = 0;
  let deduped = 0;
  let inboundCount = 0;
  let outboundCount = 0;
  for (const msg of iterateByAccount(db, accountId, folderIds)) {
    scanned += 1;
    if (msg.direction === 'self') {
      // still counts in the heartbeat denominator below
    } else if (msg.messageId !== null && seenMessageIds.has(msg.messageId)) {
      deduped += 1;
    } else {
      if (msg.messageId !== null) seenMessageIds.add(msg.messageId);
      if (msg.direction === 'in') {
        if (msg.fromAddr) {
          touch(msg.fromAddr, msg, 'in');
          inboundCount += 1;
        }
      } else {
        // outbound: every external recipient is a contact
        const recipients = [...(msg.to ?? []), ...(msg.cc ?? [])];
        for (const r of recipients) {
          if (!r) continue;
          if (myAddresses.has(r)) continue;
          touch(r, msg, 'out');
          outboundCount += 1;
        }
      }
    }
    if (scanned % AGG_HEARTBEAT_EVERY === 0) {
      const elapsed = performance.now() - iterStart;
      logger.heartbeat('aggregate.iterateMessages', {
        scanned,
        deduped,
        addresses: agg.size,
        inbound: inboundCount,
        outbound: outboundCount,
        rate: formatRate(scanned, elapsed, 'rows'),
      });
    }
  }
  endIter({
    scanned,
    deduped,
    addresses: agg.size,
    inbound: inboundCount,
    outbound: outboundCount,
  });

  const endBuild = tracePhase(logger, metrics, 'aggregate.buildRows', {
    addresses: agg.size,
  });
  const rows: AddressUpsertFull[] = [];
  for (const [email, a] of agg) {
    // Domain whitelist / blacklist (subdomain-aware via isDomainInList).
    if (
      scanOpts.includeDomains.length > 0 &&
      !isDomainInList(email, scanOpts.includeDomains)
    ) {
      continue;
    }
    if (isDomainInList(email, scanOpts.excludeDomains)) continue;

    // Direction-specific word filters. Each side enforces independently:
    // include keeps if any matching message exists in that direction; exclude
    // drops on any matching message in that direction.
    const f = filterAccum.get(email);
    if (f) {
      if (incIn.length > 0 && !f.hasIncludeInbound) continue;
      if (incOut.length > 0 && !f.hasIncludeOutbound) continue;
      if (excIn.length > 0 && f.hasExcludeInbound) continue;
      if (excOut.length > 0 && f.hasExcludeOutbound) continue;
    }

    rows.push({
      emailNormalized: email,
      displayNames: [...a.displayNames],
      firstSeenUtc: a.firstSeen === Number.POSITIVE_INFINITY ? 0 : a.firstSeen,
      lastSeenUtc: a.lastSeen,
      countIn: a.countIn,
      countOut: a.countOut,
      subjectsSample: a.subjects,
    });
  }
  endBuild({ kept: rows.length, dropped: agg.size - rows.length });

  const endReplace = tracePhase(logger, metrics, 'aggregate.replaceAll', {
    rows: rows.length,
  });
  replaceAllAddresses(db, accountId, rows);
  endReplace();
}

// Classify every address currently in the addresses table, persist tags,
// and return both the kept-email set (for snapshot-delta computation) and
// a map of email→AddressRow (so callers can ship the just-kept rows over
// IPC without re-querying the DB). Sample lookup and the role-with-reply
// rescue check are scoped to `folderIds` — the same scope the aggregator
// uses — so a contact can't be "saved" by a live message in an out-of-scope
// folder, keeping classification consistent with what the user picked.
export function classifyAndPersistAddresses(
  db: Db,
  accountId: number,
  folderIds: ReadonlySet<number>,
  config: HeuristicsConfig,
  checkAbort: () => void,
  logger: PipelineLogger = makeNoopLogger('classify'),
  metrics: MetricsCollector = NOOP_METRICS,
): { keptEmails: Set<string>; rowsByEmail: Map<string, AddressRow> } {
  const endLoad = tracePhase(logger, metrics, 'classify.loadAddresses');
  const allAddresses = [...iterateAllAddresses(db, accountId)];
  endLoad({ count: allAddresses.length });

  // Pre-load samples + replied-set in two bulk queries. Replaces the
  // previous N+1: O(addresses × SQL) → O(1 SQL total). On the 100k
  // bench this collapsed ~8.5 s spent in sample lookups into
  // sub-second prep. Sample lookup uses ROW_NUMBER() to slice
  // top-K per from_addr.
  const emailList = allAddresses.map((a) => a.emailNormalized);
  const endSamples = tracePhase(logger, metrics, 'classify.bulkSamples', {
    addresses: emailList.length,
  });
  const samplesByEmail = getSamplesByFromAddrsBulk(
    db,
    accountId,
    emailList,
    SAMPLES_CAP,
    folderIds,
  );
  endSamples({ contactsWithSamples: samplesByEmail.size });

  const keptEmails = new Set<string>();
  const rowsByEmail = new Map<string, AddressRow>();
  // Pure-CPU breakdown for what's left after the bulk SQL completes:
  // build the classifier summary, run the rule engine, persist tags.
  // No per-address SQL lookups; samples are zero-cost map reads.
  let classifyMs = 0;
  let writeMs = 0;
  let processedAddrs = 0;
  for (const addr of allAddresses) {
    checkAbort();
    const t0 = performance.now();
    const samples = samplesByEmail.get(addr.emailNormalized) ?? [];
    const sampleHeaders = samples.map(messageToParsedHeaders);
    const summary: ContactSummary = {
      emailNormalized: addr.emailNormalized,
      countIn: addr.countIn,
      countOut: addr.countOut,
      sampleMessages: sampleHeaders,
    };
    const result = classifyContact(summary, config);
    const t1 = performance.now();
    classifyMs += t1 - t0;
    const tags = result.keep ? ['kept'] : result.reasons.map((r) => `filtered:${r}`);
    setAddressTags(db, accountId, addr.emailNormalized, tags);
    writeMs += performance.now() - t1;
    if (result.keep) {
      keptEmails.add(addr.emailNormalized);
      rowsByEmail.set(addr.emailNormalized, addr);
    }
    processedAddrs += 1;
    if (processedAddrs % CLASSIFY_HEARTBEAT_EVERY === 0) {
      logger.heartbeat('classify', {
        processed: processedAddrs,
        total: allAddresses.length,
        kept: keptEmails.size,
        classify_ms: classifyMs.toFixed(0),
        write_ms: writeMs.toFixed(0),
      });
    }
  }
  logger.info('classify-summary', {
    addresses: allAddresses.length,
    kept: keptEmails.size,
    classify_ms: classifyMs.toFixed(0),
    write_ms: writeMs.toFixed(0),
  });
  metrics.event('classify.summary', {
    addresses: allAddresses.length,
    kept: keptEmails.size,
    classifyMs,
    writeMs,
  });
  return { keptEmails, rowsByEmail };
}

function messageToParsedHeaders(msg: MessageRow): ParsedHeaders {
  const from = msg.fromAddr
    ? msg.fromName
      ? { email: msg.fromAddr, name: msg.fromName }
      : { email: msg.fromAddr }
    : null;
  return {
    from,
    to: (msg.to ?? []).map((e) => ({ email: e })),
    cc: (msg.cc ?? []).map((e) => ({ email: e })),
    date: msg.dateUtc !== null ? new Date(msg.dateUtc) : null,
    subject: msg.subject,
    messageId: msg.messageId,
    inReplyTo: msg.inReplyTo,
    references: msg.references ?? [],
    autoSubmitted: msg.autoSubmitted,
    precedence: msg.precedence,
    listUnsubscribe: msg.hasListUnsubscribe ? 'present' : null,
    listId: msg.hasListId ? 'present' : null,
    hasListUnsubscribe: msg.hasListUnsubscribe,
    hasListId: msg.hasListId,
    hasInlineUnsubscribe: msg.hasInlineUnsubscribe,
  };
}
