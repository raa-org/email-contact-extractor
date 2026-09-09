/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

// Pipeline logger abstraction. Decoupled from electron-log so the same
// code paths can run under:
//   • Electron main (electron-log/main → ~/Library/Logs/contact-extractor/main.log)
//   • Bench harness (Node + vitest, no Electron) → stdout via console
//   • Unit tests → noop, no output
//
// All log lines are emitted at one of three levels, with a structured
// payload. Callers compose lines as `name + key=value pairs` so the
// resulting log file is grep-able and column-extractable with awk.

export type LogLevel = 'info' | 'warn' | 'error';

export interface PipelineLogger {
  // runId is captured on construction; every emit is prefixed `[scan run=<id>]`.
  readonly runId: string;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  // Convenience for phase boundaries — emits the same shape as info() but
  // tagged with a fixed prefix so grep "[phase]" returns the timeline.
  phaseStart(name: string, fields?: Record<string, unknown>): void;
  phaseEnd(name: string, durationMs: number, fields?: Record<string, unknown>): void;
  // Periodic in-phase ping. Stricter cadence is the caller's job — this
  // function never throttles itself.
  heartbeat(name: string, fields?: Record<string, unknown>): void;
}

// Sink is the only thing implementations differ on. Keeps PipelineLogger
// itself a pure formatter.
export interface LogSink {
  write(level: LogLevel, line: string): void;
}

// Format a fields map as ` key=value key2="value with space"`, ordered as
// inserted. Strings get quoted if they contain whitespace or `=`; numbers
// and booleans go through unchanged; objects via JSON.stringify (short).
// `null` / `undefined` render as `<none>` so a missing field is visible
// rather than silently dropped.
function fmtField(value: unknown): string {
  if (value === null || value === undefined) return '<none>';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '<nonfinite>';
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') {
    if (value.length === 0) return '""';
    if (/[\s="']/.test(value)) {
      // Escape embedded quotes; keep it cheap, this isn't a JSON serializer.
      return `"${value.replace(/"/g, '\\"')}"`;
    }
    return value;
  }
  // Arrays / objects — JSON.stringify with a length cap so logging a
  // gigantic Set doesn't blow up the line. 500 chars is enough context;
  // truncated lines get an explicit suffix so analysis can tell.
  try {
    const json = JSON.stringify(value);
    return json.length > 500 ? `${json.slice(0, 500)}…` : json;
  } catch {
    return '<unserialisable>';
  }
}

function fmtFields(fields: Record<string, unknown> | undefined): string {
  if (!fields) return '';
  const parts: string[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(`${k}=${fmtField(v)}`);
  return parts.length > 0 ? ` ${parts.join(' ')}` : '';
}

class StructuredLogger implements PipelineLogger {
  constructor(
    public readonly runId: string,
    private readonly sink: LogSink,
  ) {}

  info(message: string, fields?: Record<string, unknown>): void {
    this.sink.write('info', `[scan run=${this.runId}] ${message}${fmtFields(fields)}`);
  }

  warn(message: string, fields?: Record<string, unknown>): void {
    this.sink.write('warn', `[scan run=${this.runId}] ${message}${fmtFields(fields)}`);
  }

  error(message: string, fields?: Record<string, unknown>): void {
    this.sink.write('error', `[scan run=${this.runId}] ${message}${fmtFields(fields)}`);
  }

  phaseStart(name: string, fields?: Record<string, unknown>): void {
    this.info(`[phase] start name=${name}`, fields);
  }

  phaseEnd(name: string, durationMs: number, fields?: Record<string, unknown>): void {
    this.info(`[phase] end name=${name} duration_ms=${durationMs.toFixed(1)}`, fields);
  }

  heartbeat(name: string, fields?: Record<string, unknown>): void {
    this.info(`[phase] heartbeat name=${name}`, fields);
  }
}

// Sink that drops everything. Used by unit tests so assertions don't have
// to manage log noise. Also serves as the export default for callers that
// haven't opted in to a real logger.
const NOOP_SINK: LogSink = {
  write: (): void => undefined,
};

// stdout-based sink. Output stays line-buffered and goes through Node's
// process.stdout — same channel vitest captures into its test stdout
// section. Use this from the bench harness.
class ConsoleSink implements LogSink {
  write(level: LogLevel, line: string): void {
    if (level === 'error') process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
  }
}

export function makeNoopLogger(runId: string): PipelineLogger {
  return new StructuredLogger(runId, NOOP_SINK);
}

export function makeConsoleLogger(runId: string): PipelineLogger {
  return new StructuredLogger(runId, new ConsoleSink());
}

// Build a logger backed by electron-log/main. Kept behind a factory
// because importing 'electron-log/main' eagerly at module load forces
// every consumer (incl. unit tests) into the electron-log ESM pipeline.
// The IPC handler calls this; the bench harness uses makeConsoleLogger
// instead, so its run never imports electron-log.
export async function makeElectronLogger(runId: string): Promise<PipelineLogger> {
  const mod = (await import('electron-log/main.js')) as {
    default?: { info?: (msg: string) => void; warn?: (msg: string) => void; error?: (msg: string) => void };
    info?: (msg: string) => void;
    warn?: (msg: string) => void;
    error?: (msg: string) => void;
  };
  const elog = mod.default ?? mod;
  const sink: LogSink = {
    write(level: LogLevel, line: string): void {
      if (level === 'error' && elog.error) elog.error(line);
      else if (level === 'warn' && elog.warn) elog.warn(line);
      else if (elog.info) elog.info(line);
    },
  };
  return new StructuredLogger(runId, sink);
}

// Synchronous variant for places that already have an electron-log
// instance in scope (IPC handlers). Avoids the async hop and the second
// dynamic import on every scan.
export function makeElectronLoggerFrom(
  runId: string,
  elog: { info: (msg: string) => void; warn?: (msg: string) => void; error?: (msg: string) => void },
): PipelineLogger {
  const sink: LogSink = {
    write(level: LogLevel, line: string): void {
      if (level === 'error' && elog.error) elog.error(line);
      else if (level === 'warn' && elog.warn) elog.warn(line);
      else elog.info(line);
    },
  };
  return new StructuredLogger(runId, sink);
}

// Helper for computing a phase's rate field. `units` is whatever the
// phase is producing — "msgs", "addresses", "bodies". Returns a
// formatted "<rate> <units>/s" string so the call site doesn't repeat
// the divide-by-zero check.
export function formatRate(count: number, durationMs: number, units: string): string {
  if (durationMs <= 0) return `0 ${units}/s`;
  const rate = (count * 1000) / durationMs;
  return `${rate.toFixed(0)} ${units}/s`;
}

import type { MetricsCollector } from './metrics.js';

// Bundle one phase's instrumentation: opens a metrics span AND logs
// `phaseStart/phaseEnd` lines through the structured logger. Returns
// the end function — call it with optional end-meta to close both.
// The returned function yields the phase duration in ms so callers can
// fold it into derived fields (rates, summaries) without measuring
// twice.
export function tracePhase(
  logger: PipelineLogger,
  metrics: MetricsCollector,
  name: string,
  startMeta?: Record<string, unknown>,
): (endMeta?: Record<string, unknown>) => number {
  logger.phaseStart(name, startMeta);
  const startedAt = performance.now();
  const endSpan = metrics.startSpan(name, startMeta);
  let closed = false;
  return function endPhase(endMeta?: Record<string, unknown>): number {
    if (closed) return 0;
    closed = true;
    const durationMs = performance.now() - startedAt;
    endSpan(endMeta);
    logger.phaseEnd(name, durationMs, endMeta);
    return durationMs;
  };
}
