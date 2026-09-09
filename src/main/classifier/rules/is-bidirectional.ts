/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import {
  type BidirectionalityThreshold,
} from '../../../shared/heuristics-config.js';

// True when the contact has at least minIn inbound AND minOut outbound
// AND minTotal combined messages with the user. The default threshold
// (1, 1, 2) requires at least one message in each direction.
export function isBidirectional(
  countIn: number,
  countOut: number,
  threshold: BidirectionalityThreshold,
): boolean {
  if (!Number.isFinite(countIn) || !Number.isFinite(countOut)) return false;
  if (countIn < threshold.minIn) return false;
  if (countOut < threshold.minOut) return false;
  if (countIn + countOut < threshold.minTotal) return false;
  return true;
}
