/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest';
import { isInlineUnsubscribe } from '../../../../src/main/classifier/rules/is-inline-unsubscribe.js';
import { DEFAULT_INLINE_UNSUBSCRIBE_REGEX } from '../../../../src/shared/heuristics-config.js';

const RX = DEFAULT_INLINE_UNSUBSCRIBE_REGEX;

describe('isInlineUnsubscribe', () => {
  it('matches `Reply with "Unsubscribe"` instruction', () => {
    expect(isInlineUnsubscribe(null, 'Please reply with "Unsubscribe" to opt out', RX)).toBe(
      true,
    );
  });

  it('matches `reply with unsubscribe` without quotes', () => {
    expect(isInlineUnsubscribe(null, 'reply with unsubscribe to leave', RX)).toBe(true);
  });

  it('matches `to unsubscribe …. reply …`', () => {
    expect(
      isInlineUnsubscribe(
        null,
        'To unsubscribe, simply reply to this email with the word UNSUBSCRIBE.',
        RX,
      ),
    ).toBe(true);
  });

  it('matches when the cue lives in the subject', () => {
    expect(
      isInlineUnsubscribe('Reply with Unsubscribe to opt out', null, RX),
    ).toBe(true);
  });

  it('does NOT match a passing mention without an instruction cue', () => {
    expect(
      isInlineUnsubscribe(
        null,
        'I tried to unsubscribe from their newsletter but it kept coming.',
        RX,
      ),
    ).toBe(false);
  });

  it('does NOT match the bare word `unsubscribe`', () => {
    expect(isInlineUnsubscribe(null, 'unsubscribe', RX)).toBe(false);
  });

  it('returns false when both subject and body are null', () => {
    expect(isInlineUnsubscribe(null, null, RX)).toBe(false);
  });

  it('returns false on whitespace-only haystack', () => {
    expect(isInlineUnsubscribe('  ', '\n\t', RX)).toBe(false);
  });
});
