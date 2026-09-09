/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest';
import { isBidirectional } from '../../../../src/main/classifier/rules/is-bidirectional.js';
import { DEFAULT_BIDIRECTIONALITY_THRESHOLD } from '../../../../src/shared/heuristics-config.js';

describe('isBidirectional', () => {
  it('positive: 1 in, 1 out (default threshold)', () => {
    expect(isBidirectional(1, 1, DEFAULT_BIDIRECTIONALITY_THRESHOLD)).toBe(true);
  });

  it('positive: 5 in, 3 out', () => {
    expect(isBidirectional(5, 3, DEFAULT_BIDIRECTIONALITY_THRESHOLD)).toBe(true);
  });

  it('negative: only inbound (default threshold)', () => {
    expect(isBidirectional(10, 0, DEFAULT_BIDIRECTIONALITY_THRESHOLD)).toBe(false);
  });

  it('negative: only outbound', () => {
    expect(isBidirectional(0, 10, DEFAULT_BIDIRECTIONALITY_THRESHOLD)).toBe(false);
  });

  it('negative: zero everywhere', () => {
    expect(isBidirectional(0, 0, DEFAULT_BIDIRECTIONALITY_THRESHOLD)).toBe(false);
  });

  it('respects custom threshold (minIn=2)', () => {
    const threshold = { minIn: 2, minOut: 1, minTotal: 3 };
    expect(isBidirectional(1, 1, threshold)).toBe(false);
    expect(isBidirectional(2, 1, threshold)).toBe(true);
  });

  it('respects custom threshold minTotal', () => {
    const threshold = { minIn: 1, minOut: 1, minTotal: 5 };
    expect(isBidirectional(2, 2, threshold)).toBe(false);
    expect(isBidirectional(3, 2, threshold)).toBe(true);
  });

  it('rejects non-finite counts (NaN/Infinity)', () => {
    expect(isBidirectional(Number.NaN, 1, DEFAULT_BIDIRECTIONALITY_THRESHOLD)).toBe(false);
    expect(isBidirectional(1, Number.POSITIVE_INFINITY, DEFAULT_BIDIRECTIONALITY_THRESHOLD)).toBe(false);
  });
});
