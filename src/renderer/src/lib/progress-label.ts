/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useRef, useState } from 'react';
import type { ScanPhase, ScanProgress } from '../../../shared/domain.js';

// Map raw pipeline phases to short, human-readable labels. Owned here so
// ScanScreen and ResultsScreen render the same vocabulary without
// drifting. The renderer-side translation layer means main-process emits
// can stay short tokens (`fetching-bodies`) without leaking into the UI.
const PHASE_VERBS: Record<ScanPhase, string> = {
  connecting: 'Connecting',
  enumerating: 'Listing folders',
  fetching: 'Caching headers',
  'fetching-bodies': 'Caching message bodies',
  aggregating: 'Aggregating contacts',
  classifying: 'Classifying contacts',
  done: 'Done',
  error: 'Error',
};

// Compose the full label including the per-folder context the pipeline
// passes through `currentFolder`. The fetching phases attach a folder
// path (or "<folder> · N contacts" for body-scan); the rest are
// pipeline-level and don't need a suffix.
export function describeProgress(p: ScanProgress | null): string {
  if (p === null) return 'Preparing…';
  const head = PHASE_VERBS[p.phase] ?? p.phase;
  const showFolder = p.phase === 'fetching' || p.phase === 'fetching-bodies';
  return showFolder && p.currentFolder ? `${head} – ${p.currentFolder}` : head;
}

// Minimum time (ms) the user must be able to read each phase label
// before another one replaces it. On a hot cache, the pipeline can
// transit four phases in <300 ms — without dwell the UI flickers
// through unreadable text. 600 ms is the lower bound where a label is
// reliably legible without making fast scans feel laggy.
const DEFAULT_MIN_DWELL_MS = 600;

// Returns a "sticky" version of the live label: updates immediately when
// the input changes after `minDwellMs` of stability, otherwise queues
// the update on a single trailing timer. If the input changes again
// while a timer is pending, only the LATEST value is shown — interim
// fast-flipping phases get coalesced. When the input becomes null
// (scan ended, no progress event) we apply the change synchronously
// so the chip can dismiss without a stale "Aggregating…" tail.
export function useStableLabel(
  live: string | null,
  minDwellMs: number = DEFAULT_MIN_DWELL_MS,
): string | null {
  const [visible, setVisible] = useState<string | null>(live);
  const lastChangeAtRef = useRef<number>(Date.now());
  const pendingRef = useRef<{ value: string | null; timer: number } | null>(null);

  useEffect(() => {
    return () => {
      if (pendingRef.current !== null) {
        window.clearTimeout(pendingRef.current.timer);
        pendingRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    // No change → nothing to do. (Treat any pending value as the truth
    // we're driving toward; if `live` matches it, just keep waiting.)
    if (live === visible && pendingRef.current === null) return;
    if (pendingRef.current !== null && pendingRef.current.value === live) return;

    // Going to null = "scan ended / progress cleared" — apply immediately
    // so terminal chips ("Scan complete", success styling) don't sit
    // behind a stale phase label.
    if (live === null) {
      if (pendingRef.current !== null) {
        window.clearTimeout(pendingRef.current.timer);
        pendingRef.current = null;
      }
      setVisible(null);
      lastChangeAtRef.current = Date.now();
      return;
    }

    const now = Date.now();
    const elapsed = now - lastChangeAtRef.current;

    if (elapsed >= minDwellMs && pendingRef.current === null) {
      // Visible has been stable long enough; flip immediately.
      setVisible(live);
      lastChangeAtRef.current = now;
      return;
    }

    // Update the queued value to the freshest input. If a timer is
    // already running, leave it alone — when it fires it'll pick up
    // whichever value is in `pendingRef`.
    if (pendingRef.current !== null) {
      pendingRef.current.value = live;
      return;
    }

    const wait = Math.max(0, minDwellMs - elapsed);
    const timer = window.setTimeout(() => {
      const value = pendingRef.current?.value ?? live;
      pendingRef.current = null;
      setVisible(value);
      lastChangeAtRef.current = Date.now();
    }, wait);
    pendingRef.current = { value: live, timer };
  }, [live, visible, minDwellMs]);

  return visible;
}
