/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { z } from 'zod';
import { DEFAULT_AUTOMATION_LOCAL_PARTS } from './heuristics-config.js';

// Addresses come out of other people's message headers, not out of a form we
// control, so the schema only guarantees "non-empty string that looks like an
// address" — it is not a format gate. zod's `z.email()` rejects local parts
// that RFC 5321 allows (`=` among them), and a single such counterparty —
// e.g. the VERP address `a+b=c.io@notifybf1.hubspot.com` HubSpot sends from —
// used to fail ScanSnapshotUpdatedResponse.parse and abort the entire scan.
const MailboxAddress = z.string().min(3).includes('@');

export const EmailAddress = z.object({
  email: MailboxAddress,
  name: z.string().min(1).optional(),
});
export type EmailAddress = z.infer<typeof EmailAddress>;

export const Direction = z.enum(['in', 'out', 'self']);
export type Direction = z.infer<typeof Direction>;

export const Protocol = z.enum(['imap', 'smtp']);
export type Protocol = z.infer<typeof Protocol>;

export const ServerPreset = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  tls: z.boolean(),
  supportsSso: z.boolean(),
  // Optional ports per protocol; the connect form picks one based on the
  // protocol selector. If absent, falls back to the generic `port`.
  imapPort: z.number().int().min(1).max(65535).optional(),
  smtpPort: z.number().int().min(1).max(65535).optional(),
});
export type ServerPreset = z.infer<typeof ServerPreset>;

const SENSITIVE_BRAND = Symbol('Sensitive');
export type SensitiveBrand = typeof SENSITIVE_BRAND;
export const Sensitive = z.string().min(1).brand<'Sensitive'>();
export type Sensitive = z.infer<typeof Sensitive>;

// Single grep-able escape hatch for handing a `Sensitive` value to an
// API that takes a plain `string` (safeStorage cipher, imapflow login).
// Use this — never reach for `as unknown as string` inline — so the
// brand stays meaningful: every callsite where the password leaves its
// branded prison is auditable in one search.
export function revealSensitive(value: Sensitive): string {
  return value as unknown as string;
}

export const Credentials = z.object({
  protocol: Protocol.default('imap'),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  tls: z.boolean(),
  username: z.string().min(1),
  password: Sensitive,
});
export type Credentials = z.infer<typeof Credentials>;

export const FolderInfo = z.object({
  path: z.string().min(1),
  delimiter: z.string(),
  flags: z.array(z.string()),
  specialUse: z.string().optional(),
});
export type FolderInfo = z.infer<typeof FolderInfo>;

export const ContactRow = z.object({
  email: MailboxAddress,
  firstSeenUtc: z.iso.datetime({ offset: true }),
  lastSeenUtc: z.iso.datetime({ offset: true }),
  countIn: z.number().int().nonnegative(),
  countOut: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  subjectsSample: z.array(z.string()),
  displayNames: z.array(z.string()),
});
export type ContactRow = z.infer<typeof ContactRow>;

// Direction mode for the bidirectionality rule. 'one' = at least
// `minMessages` messages total regardless of who sent them; 'bi' = the
// classic dialogue requirement (≥1 in AND ≥1 out, total ≥ minMessages).
// `'off'` disables the direction-based bidirectionality rule entirely:
// the classifier accepts contacts with any in/out distribution, equivalent
// to the `'one'` rule with the side minima set to zero. The Sent-folder
// lock in the Scan UI also drops in this mode — see ensureSentSelected
// in the scan reducer for why the lock is conditional.
export const ScanDirectionMode = z.enum(['one', 'bi', 'off']);
export type ScanDirectionMode = z.infer<typeof ScanDirectionMode>;

export const ScanOptions = z.object({
  folderInclude: z.array(z.string()).optional(),
  folderExclude: z.array(z.string()).optional(),
  // Domain whitelist / blacklist applied to the contact's email domain.
  // Empty includeDomains = no whitelist (all domains pass); empty
  // excludeDomains = no blacklist. Both start empty — your own domains are
  // deployment-specific and belong in the Scan screen's filters.
  includeDomains: z.array(z.string()).default([]),
  excludeDomains: z.array(z.string()).default([]),
  // Subject + body substring filters, split by message direction so the
  // user can target their counterpart's text without it triggering on
  // their own outbound replies (and vice versa). Case-insensitive. Empty
  // list = no filter on that channel. Body matching strips quoted-reply
  // chains (`On … wrote:`, `>` lines, Outlook divider) so a word that
  // only appears in a quoted history doesn't count.
  //   • include: keep iff ≥1 message in that direction matches.
  //   • exclude: drop if any message in that direction matches.
  includeWordsInbound: z.array(z.string()).default([]),
  excludeWordsInbound: z.array(z.string()).default([]),
  includeWordsOutbound: z.array(z.string()).default([]),
  excludeWordsOutbound: z.array(z.string()).default([]),
  automationLocalParts: z.array(z.string()).default([...DEFAULT_AUTOMATION_LOCAL_PARTS]),
  // Bidirectionality threshold knob.
  directionMode: ScanDirectionMode.default('bi'),
  minMessages: z.number().int().min(1).default(2),
  // Opt-in to fetching message bodies during scan. When true: the
  // pipeline runs a second pass that pulls bodies for kept-candidate
  // contacts, encrypts them via safeStorage into `message_bodies`, and
  // applies Include/Exclude word filters + the inline-unsubscribe
  // detector against subject + body. Default false to preserve the
  // fast / metadata-only scan.
  parseBodies: z.boolean().default(false),
});
export type ScanOptions = z.infer<typeof ScanOptions>;

// Pipeline phases ordered by their canonical lifecycle. `fetching` covers
// the per-folder header ingest (Pass 1); `fetching-bodies` is the deep-scan
// second pass (Pass 2) for kept-candidate contacts. They're separate enum
// values because the renderer renders them with different labels and the
// counters mean different things — header processed/total is per-folder
// progress, body processed/total is "of the kept-contact body fetch list".
export const ScanPhase = z.enum([
  'connecting',
  'enumerating',
  'fetching',
  'fetching-bodies',
  'aggregating',
  'classifying',
  'done',
  'error',
]);
export type ScanPhase = z.infer<typeof ScanPhase>;

export const ScanProgress = z.object({
  phase: ScanPhase,
  currentFolder: z.string().optional(),
  processed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  etaSeconds: z.number().nonnegative().optional(),
});
export type ScanProgress = z.infer<typeof ScanProgress>;

export const ExportFormat = z.enum(['xlsx', 'csv']);
export type ExportFormat = z.infer<typeof ExportFormat>;

export const ExportColumn = z.enum([
  'email',
  'firstSeenUtc',
  'lastSeenUtc',
  'countIn',
  'countOut',
  'total',
  'subjectsSample',
  'displayNames',
]);
export type ExportColumn = z.infer<typeof ExportColumn>;

export const ExportOptions = z.object({
  format: ExportFormat,
  columns: z.array(ExportColumn).min(1),
  filePath: z.string().min(1),
});
export type ExportOptions = z.infer<typeof ExportOptions>;
