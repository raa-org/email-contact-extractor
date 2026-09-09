/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

// Metrics for a single scan run. Captured as a flat append-only log of
// span-start / span-end / event records, then flushed to JSONL on disk.
//
// The JSONL file is grep-able and trivially diff-able across runs — the
// header line carries version/commit/scenario, every other line is one
// record. Spans nest naturally via the spanId returned from startSpan;
// nesting is visual (parent finished after child), not enforced.
//
// All collector methods are sync — performance.now() readings are taken
// inline so we never blame an unrelated `await` for an aggregation stall.

export interface MetricsHeader {
  // package.json version of contact-extractor when the run started
  readonly version: string;
  // short git commit, or 'unknown' when not in a checkout
  readonly commit: string;
  // ISO 8601, when the collector was created
  readonly startedAt: string;
  // UUID propagated through the pipeline so log lines + metrics agree
  readonly runId: string;
  // free-form tag — 'live' (in-app), 'bench-e2e', 'bench-micro', 'test'
  readonly scenario: string;
  // node version + os/arch — captured once per run for context
  readonly platform: string;
  // ScanOptions or other context the caller wants in the file's first line
  readonly options?: Record<string, unknown>;
}

export type MetricsKind = 'span-start' | 'span-end' | 'event';

export interface MetricsRecord {
  readonly ts: number;
  readonly elapsedMs: number;
  readonly kind: MetricsKind;
  readonly name: string;
  readonly spanId?: string;
  readonly parentSpanId?: string;
  readonly durationMs?: number;
  readonly meta?: Record<string, unknown>;
}

export interface MetricsCollector {
  // Start a span. Returns the end function — call it to record duration.
  // Optional meta is attached to the start record. End-meta is supplied
  // separately to the returned function so callers can record results
  // (rows produced, ms breakdown, …).
  startSpan(
    name: string,
    meta?: Record<string, unknown>,
  ): (endMeta?: Record<string, unknown>) => void;
  event(name: string, meta?: Record<string, unknown>): void;
  snapshot(): readonly MetricsRecord[];
  flush(filePath: string): Promise<void>;
  readonly header: MetricsHeader;
}

// Single shared no-op collector used when callers don't supply one. All
// methods are O(1) and allocate nothing — safe to keep on hot ingest path.
const NOOP_END = (): void => undefined;
const NOOP_HEADER: MetricsHeader = {
  version: '',
  commit: '',
  startedAt: '',
  runId: '',
  scenario: 'noop',
  platform: '',
};
export const NOOP_METRICS: MetricsCollector = {
  startSpan: () => NOOP_END,
  event: () => undefined,
  snapshot: () => [],
  flush: async () => undefined,
  header: NOOP_HEADER,
};

export function createMetricsCollector(header: MetricsHeader): MetricsCollector {
  const records: MetricsRecord[] = [];
  const t0 = performance.now();
  const stack: string[] = [];

  function elapsed(): number {
    return performance.now() - t0;
  }

  function startSpan(
    name: string,
    meta?: Record<string, unknown>,
  ): (endMeta?: Record<string, unknown>) => void {
    const spanId = randomUUID();
    const startedAt = performance.now();
    const parentSpanId = stack[stack.length - 1];
    stack.push(spanId);
    const startRec: MetricsRecord = {
      ts: Date.now(),
      elapsedMs: elapsed(),
      kind: 'span-start',
      name,
      spanId,
      ...(parentSpanId !== undefined ? { parentSpanId } : {}),
      ...(meta ? { meta } : {}),
    };
    records.push(startRec);
    return (endMeta?: Record<string, unknown>): void => {
      const idx = stack.lastIndexOf(spanId);
      if (idx !== -1) stack.splice(idx, 1);
      const durationMs = performance.now() - startedAt;
      const endRec: MetricsRecord = {
        ts: Date.now(),
        elapsedMs: elapsed(),
        kind: 'span-end',
        name,
        spanId,
        ...(parentSpanId !== undefined ? { parentSpanId } : {}),
        durationMs,
        ...(endMeta ? { meta: endMeta } : {}),
      };
      records.push(endRec);
    };
  }

  function event(name: string, meta?: Record<string, unknown>): void {
    const parentSpanId = stack[stack.length - 1];
    const rec: MetricsRecord = {
      ts: Date.now(),
      elapsedMs: elapsed(),
      kind: 'event',
      name,
      ...(parentSpanId !== undefined ? { parentSpanId } : {}),
      ...(meta ? { meta } : {}),
    };
    records.push(rec);
  }

  async function flush(filePath: string): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });
    const lines: string[] = [JSON.stringify({ kind: 'header', ...header })];
    for (const r of records) lines.push(JSON.stringify(r));
    lines.push('');
    await writeFile(filePath, lines.join('\n'), 'utf8');
  }

  return {
    startSpan,
    event,
    snapshot: () => records,
    flush,
    header,
  };
}

// Resolves the runtime environment string ("node=x.y.z os=darwin/arm64").
// Cheap; safe to call inside the header construction.
export function describePlatform(): string {
  const node = process.versions['node'] ?? '?';
  return `node=${node} os=${process.platform}/${process.arch}`;
}

// Aggregate span durations by name from a metrics snapshot. Useful for
// the runScan summary line at the end of a scan: caller folds the result
// into one log statement so a grep on the final summary gives every
// phase's wall time without parsing the full JSONL stream.
export function aggregateDurationsByName(
  records: readonly MetricsRecord[],
): Map<string, { count: number; totalMs: number }> {
  const out = new Map<string, { count: number; totalMs: number }>();
  for (const r of records) {
    if (r.kind !== 'span-end' || r.durationMs === undefined) continue;
    const cur = out.get(r.name);
    if (cur) {
      cur.count += 1;
      cur.totalMs += r.durationMs;
    } else {
      out.set(r.name, { count: 1, totalMs: r.durationMs });
    }
  }
  return out;
}
