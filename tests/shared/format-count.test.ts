/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest';
import { formatCount } from '../../src/shared/format-count.js';

describe('formatCount', () => {
  it.each([
    [0, '0'],
    [1, '1'],
    [42, '42'],
    [999, '999'],
    [1000, '1K'],
    [1100, '1.1K'],
    [1199, '1.1K'], // truncates, doesn't round up
    [9900, '9.9K'],
    [9999, '9.9K'], // boundary: still in 1-decimal band
    [10_000, '10K'], // integer in tier — trailing zero dropped
    [10_500, '10.5K'],
    [42_000, '42K'],
    [42_300, '42.3K'],
    [99_900, '99.9K'],
    [99_999, '99.9K'],
    [100_000, '100K'], // integer in tier, trailing zero dropped
    [100_500, '100.5K'], // decimal band extends through 999.9K
    [500_000, '500K'],
    [500_500, '500.5K'],
    [999_000, '999K'],
    [999_500, '999.5K'],
    [999_999, '999.9K'], // last point before crossover to next tier
    [1_000_000, '1M'],
    [1_500_000, '1.5M'],
    [9_999_999, '9.9M'],
    [10_000_000, '10M'],
    [12_500_000, '12.5M'],
    [99_999_999, '99.9M'],
    [100_000_000, '100M'],
    [150_500_000, '150.5M'], // M-tier mirrors K-tier exactly
    [999_999_999, '999.9M'],
    [1_000_000_000, '1B'],
    [1_200_000_000, '1.2B'],
  ])('%i → %s', (input, expected) => {
    expect(formatCount(input)).toBe(expected);
  });

  it('clamps negative / non-finite to "0"', () => {
    expect(formatCount(-1)).toBe('0');
    expect(formatCount(Number.NaN)).toBe('0');
    expect(formatCount(Number.POSITIVE_INFINITY)).toBe('0');
  });

  it('floors fractional inputs', () => {
    expect(formatCount(99.7)).toBe('99');
  });
});
