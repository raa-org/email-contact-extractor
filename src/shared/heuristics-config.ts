/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

// Domains treated as "ours" and therefore never counted as counterparties.
// Empty by default — fill it in from the Scan screen for your organisation.
export const DEFAULT_INTERNAL_DOMAINS: readonly string[] = [];

export const DEFAULT_AUTOMATION_LOCAL_PARTS: readonly string[] = [
  'noreply',
  'no-reply',
  'donotreply',
  'do-not-reply',
  'notification',
  'notifications',
  'alert',
  'alerts',
  'mailer-daemon',
  'bounce',
  'bounces',
  'postmaster',
  'root',
  'daemon',
  'automated',
  'system',
  'support',
  'billing',
  'admin',
  'assistant',
  'legal',
  'hr',
  'reception',
  'calendar',
  'connect',
];

const AUTOMATION_LOCAL_PART_PREFIX_REGEX_SOURCE = '^(?:noreply-|no-reply-)';

function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function automationLocalPartRegexFromList(localParts: readonly string[]): RegExp {
  const normalized = [...new Set(localParts.map((value) => value.trim().toLowerCase()))].filter(
    (value) => value.length > 0,
  );
  const exactMatchSource =
    normalized.length > 0
      ? `^(?:${normalized.map(escapeRegexLiteral).join('|')})$`
      : '(?!)';
  return new RegExp(`${exactMatchSource}|${AUTOMATION_LOCAL_PART_PREFIX_REGEX_SOURCE}`, 'i');
}

export const DEFAULT_AUTOMATION_LOCAL_PART_REGEX = automationLocalPartRegexFromList(
  DEFAULT_AUTOMATION_LOCAL_PARTS,
);

// "Reply-with-Unsubscribe" detector for body text. Strict on purpose so
// plain mentions in conversational mail ("I tried to unsubscribe but it
// didn't work") don't false-match. Triggers only when an instruction-y
// cue (`reply`/`send`/`email`) appears within ~60 chars of `unsubscribe`,
// in either order — catches "Reply with Unsubscribe", "Please reply with
// 'Unsubscribe'", "To unsubscribe, reply to this email", etc.
export const DEFAULT_INLINE_UNSUBSCRIBE_REGEX =
  /\b(?:reply|send|email)\b[\s\S]{0,60}\bunsubscribe\b|\bunsubscribe\b[\s\S]{0,60}\b(?:reply|email)\b/i;

export interface BidirectionalityThreshold {
  readonly minIn: number;
  readonly minOut: number;
  readonly minTotal: number;
}

export const DEFAULT_BIDIRECTIONALITY_THRESHOLD: BidirectionalityThreshold = {
  minIn: 1,
  minOut: 1,
  minTotal: 2,
};

export interface HeuristicsConfig {
  readonly automationLocalPartRegex: RegExp;
  readonly inlineUnsubscribeRegex: RegExp;
  readonly bidirectionality: BidirectionalityThreshold;
}

export const DEFAULT_HEURISTICS_CONFIG: HeuristicsConfig = {
  automationLocalPartRegex: DEFAULT_AUTOMATION_LOCAL_PART_REGEX,
  inlineUnsubscribeRegex: DEFAULT_INLINE_UNSUBSCRIBE_REGEX,
  bidirectionality: DEFAULT_BIDIRECTIONALITY_THRESHOLD,
};

export interface ScanHeuristicsOptions {
  readonly automationLocalParts: readonly string[];
  readonly directionMode: 'one' | 'bi' | 'off';
  readonly minMessages: number;
}

// Builds the runtime classifier config for one scan from the user-approved
// scan options. Callers may pass a base config for tests/bench overrides;
// per-scan values from ScanOptions always win for automation + direction.
export function heuristicsConfigFromScanOptions(
  opts: ScanHeuristicsOptions,
  baseConfig: HeuristicsConfig = DEFAULT_HEURISTICS_CONFIG,
): HeuristicsConfig {
  return {
    ...baseConfig,
    automationLocalPartRegex: automationLocalPartRegexFromList(opts.automationLocalParts),
    bidirectionality: bidirectionalityFromScanOptions(opts),
  };
}

// Builds a per-scan HeuristicsConfig from the user's scan options. The
// `directionMode` + `minMessages` knobs override `bidirectionality` only;
// the regex-based automation rule and the default `internalDomains` list
// stay on whatever the base config carries
// (caller may pass DEFAULT_HEURISTICS_CONFIG or one with overrides).
//
// `excludeDomains` from scan options is NOT routed through `internalDomains`
// here — domain whitelist/blacklist is applied at the aggregate level (in
// scan-runner) so it can drop contacts before classification, with the
// 'internal-domain' classifier rule continuing to mean exactly what it did
// before (the user's own organization).
export function bidirectionalityFromScanOptions(opts: {
  readonly directionMode: 'one' | 'bi' | 'off';
  readonly minMessages: number;
}): BidirectionalityThreshold {
  // 'bi'  — both sides ≥ 1, total ≥ minMessages.
  // 'one' — any side, total ≥ minMessages.
  // 'off' — bidirectionality rule disabled. minMessages is part of the
  //   same UI block as the Direction radio (the Filters panel groups them
  //   together as "Direction"), so the user's "no Direction filter"
  //   selection neutralises minMessages too: thresholds collapse to zero
  //   and is-bidirectional becomes a tautology — every contact passes.
  if (opts.directionMode === 'bi') {
    return { minIn: 1, minOut: 1, minTotal: opts.minMessages };
  }
  if (opts.directionMode === 'one') {
    return { minIn: 0, minOut: 0, minTotal: opts.minMessages };
  }
  return { minIn: 0, minOut: 0, minTotal: 0 };
}
