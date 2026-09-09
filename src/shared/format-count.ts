/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

// Compact, twitter-style numeric formatter for UI counters that may
// scale into thousands or millions (messages processed during a scan,
// contacts kept after classification). Up to 999 we show the exact
// number; from 1 000 we switch to a 1-decimal form within each tier
// (1.0–999.9), advancing to the next tier at 1 000:
//   1.1K, 9.9K, 12.5K, 99.9K, 100.5K, 999.9K, 1M, 1.5M, 99.9M, 100.5M…
// The trailing zero is dropped on whole numbers so 1 000 reads "1K"
// not "1.0K", 100 000 reads "100K", and 1 000 000 reads "1M".
//
// Decimal granularity through the entire 1.0–999.9 band lets the
// progress chip move visibly on every tick: 100K → 100.5K → 101K
// rather than freezing at 100K for 999 messages of real progress.
//
// Truncation rather than rounding keeps the value monotonically
// non-decreasing during a live progress tick — `Math.floor` ensures we
// never round 9 999 up to "10K" then back down to "9.9K" on the next
// tick.
const TIERS: readonly { v: number; s: string }[] = [
  { v: 1e9, s: 'B' },
  { v: 1e6, s: 'M' },
  { v: 1e3, s: 'K' },
];

export function formatCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0';
  if (n < 1000) return String(Math.floor(n));
  for (const { v, s } of TIERS) {
    if (n >= v) {
      const x = n / v;
      // 1.0–999.9 band, uniform across all tiers. Drop the trailing
      // zero so integer-in-tier values read clean: 100 000 → "100K",
      // 500 000 → "500K", 1 000 000 → "1M" (next tier).
      const r = Math.floor(x * 10) / 10;
      return Number.isInteger(r) ? `${r}${s}` : `${r.toFixed(1)}${s}`;
    }
  }
  return String(Math.floor(n));
}
