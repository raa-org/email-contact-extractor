/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest';
import {
  classifyContact,
  type ContactSummary,
} from '../../../src/main/classifier/classify-contact.js';
import type { ParsedHeaders } from '../../../src/main/imap/headers.js';
import {
  DEFAULT_AUTOMATION_LOCAL_PART_REGEX,
  DEFAULT_BIDIRECTIONALITY_THRESHOLD,
  DEFAULT_INLINE_UNSUBSCRIBE_REGEX,
  type HeuristicsConfig,
} from '../../../src/shared/heuristics-config.js';

function H(overrides: Partial<ParsedHeaders>): ParsedHeaders {
  return {
    from: null,
    to: [],
    cc: [],
    date: null,
    subject: null,
    messageId: null,
    inReplyTo: null,
    references: [],
    autoSubmitted: null,
    precedence: null,
    listUnsubscribe: null,
    listId: null,
    hasListUnsubscribe: false,
    hasListId: false,
    hasInlineUnsubscribe: false,
    ...overrides,
  };
}

const automatedHeaders = H({ hasListUnsubscribe: true, precedence: 'bulk' });
const humanHeaders = H({ subject: 'Project update' });

function summary(overrides: Partial<ContactSummary>): ContactSummary {
  return {
    emailNormalized: 'jane@example.com',
    countIn: 1,
    countOut: 1,
    sampleMessages: [humanHeaders],
    ...overrides,
  };
}

const defaultConfig: HeuristicsConfig = {
  automationLocalPartRegex: DEFAULT_AUTOMATION_LOCAL_PART_REGEX,
  inlineUnsubscribeRegex: DEFAULT_INLINE_UNSUBSCRIBE_REGEX,
  bidirectionality: DEFAULT_BIDIRECTIONALITY_THRESHOLD,
};

interface Case {
  readonly name: string;
  readonly input: ContactSummary;
  readonly keep: boolean;
  readonly expectedReasons: readonly string[];
}

const cases: readonly Case[] = [
  {
    name: 'legit external bidirectional contact → keep',
    input: summary({}),
    keep: true,
    expectedReasons: [],
  },
  {
    name: 'inbound only → not bidirectional',
    input: summary({ countIn: 5, countOut: 0 }),
    keep: false,
    expectedReasons: ['not-bidirectional'],
  },
  {
    name: 'outbound only → not bidirectional',
    input: summary({ countIn: 0, countOut: 3 }),
    keep: false,
    expectedReasons: ['not-bidirectional'],
  },
  {
    name: 'single message total → not bidirectional',
    input: summary({ countIn: 1, countOut: 0 }),
    keep: false,
    expectedReasons: ['not-bidirectional'],
  },
  {
    name: 'noreply local part → drop (automation-localpart)',
    input: summary({ emailNormalized: 'noreply@vendor.com' }),
    keep: false,
    expectedReasons: ['automation-localpart'],
  },
  {
    name: 'noreply- prefix → drop',
    input: summary({ emailNormalized: 'noreply-12345@vendor.com' }),
    keep: false,
    expectedReasons: ['automation-localpart'],
  },
  {
    name: 'all messages automated (newsletter) → drop',
    input: summary({
      emailNormalized: 'team@news.example.com',
      sampleMessages: [automatedHeaders, automatedHeaders],
    }),
    keep: false,
    expectedReasons: ['all-messages-automated'],
  },
  {
    name: 'one legit message rescues automated contact',
    input: summary({
      emailNormalized: 'team@news.example.com',
      sampleMessages: [automatedHeaders, humanHeaders],
    }),
    keep: true,
    expectedReasons: [],
  },
  {
    name: 'support local part → drop (automation-localpart)',
    input: summary({
      emailNormalized: 'support@vendor.com',
    }),
    keep: false,
    expectedReasons: ['automation-localpart'],
  },
  {
    name: 'billing local part → drop (automation-localpart)',
    input: summary({
      emailNormalized: 'billing@vendor.com',
    }),
    keep: false,
    expectedReasons: ['automation-localpart'],
  },
  {
    name: 'assistant local part → drop (automation-localpart)',
    input: summary({
      emailNormalized: 'assistant@vendor.com',
    }),
    keep: false,
    expectedReasons: ['automation-localpart'],
  },
  {
    name: 'reception local part → drop (automation-localpart)',
    input: summary({
      emailNormalized: 'reception@vendor.com',
    }),
    keep: false,
    expectedReasons: ['automation-localpart'],
  },
  {
    name: 'calendar local part → drop (automation-localpart)',
    input: summary({
      emailNormalized: 'calendar@vendor.com',
    }),
    keep: false,
    expectedReasons: ['automation-localpart'],
  },
  {
    name: 'newsletter from a noreply within bidirectional metrics → drop',
    input: summary({
      emailNormalized: 'noreply@news.example.com',
      sampleMessages: [automatedHeaders],
    }),
    keep: false,
    expectedReasons: ['automation-localpart'],
  },
  {
    name: 'gmail user with +tag normalized → keep when external & bidirectional',
    input: summary({ emailNormalized: 'partner@gmail.com' }),
    keep: true,
    expectedReasons: [],
  },
  {
    name: 'multi-fail: one-way + automation local part',
    input: summary({
      emailNormalized: 'support@news.example.com',
      countIn: 0,
      countOut: 5,
      sampleMessages: [automatedHeaders],
    }),
    keep: false,
    expectedReasons: ['not-bidirectional', 'automation-localpart'],
  },
];

describe('classifyContact', () => {
  it.each(cases)('$name', ({ input, keep, expectedReasons }) => {
    const result = classifyContact(input, defaultConfig);
    expect(result.keep).toBe(keep);
    expect([...result.reasons].sort()).toEqual([...expectedReasons].sort());
  });

  it('uses an injected config when provided', () => {
    const result = classifyContact(
      summary({ countIn: 1, countOut: 1 }),
      {
        automationLocalPartRegex: /^never-match$/,
        inlineUnsubscribeRegex: /^never-match$/,
        // Bumped threshold makes the otherwise-legit 1+1 contact fail.
        bidirectionality: { minIn: 1, minOut: 1, minTotal: 5 },
      },
    );
    expect(result.keep).toBe(false);
    expect(result.reasons).toContain('not-bidirectional');
  });
});
