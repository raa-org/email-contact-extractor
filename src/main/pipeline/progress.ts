/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import type { ScanProgress } from '../../shared/domain.js';

export interface ThrottledProgress {
  readonly emit: (event: ScanProgress) => void;
  readonly flush: () => void;
}

// Throttles progress events so the renderer's IPC inbox isn't flooded.
// Default cadence: 10 events/sec (interval 100 ms). The latest pending
// event always wins — older ones are coalesced. flush() forces an
// immediate emit of any queued event (useful at the end of the scan).
export function createThrottledProgress(
  sink: (event: ScanProgress) => void,
  intervalMs: number = 100,
  now: () => number = () => Date.now(),
): ThrottledProgress {
  let lastEmittedAt = 0;
  let pending: ScanProgress | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function fire(event: ScanProgress): void {
    lastEmittedAt = now();
    pending = null;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    sink(event);
  }

  function emit(event: ScanProgress): void {
    const elapsed = now() - lastEmittedAt;
    if (elapsed >= intervalMs) {
      fire(event);
      return;
    }
    pending = event;
    if (timer === null) {
      timer = setTimeout(() => {
        timer = null;
        if (pending !== null) fire(pending);
      }, intervalMs - elapsed);
    }
  }

  function flush(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending !== null) fire(pending);
  }

  return { emit, flush };
}
