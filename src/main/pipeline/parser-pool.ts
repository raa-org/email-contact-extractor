/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

// Parallel-mailparser abstraction for the deep-scan body pass.
//
// Two implementations behind the same `Parser` interface:
//
//   • createInlineParser() — calls mailparser on the caller's thread.
//     Default for unit tests and for environments where worker_threads
//     aren't viable (e.g. an Electron build without a worker entry).
//     Behaviour-identical to the pre-pool code path.
//
//   • createWorkerParserPool(size, scriptPath) — round-robin pool of
//     `size` worker_threads, each running `parser-worker.js`. The
//     deep-scan loop fires parse requests in parallel; the pool's
//     internal queue cushions bursts. Used in production where moving
//     mailparser's HTML tokenisation off the main thread is the
//     headline win.
//
// Same `parse(buf): Promise<{ text, parseMs }>` signature for both —
// the caller (body-scan.ts) is unaware of the implementation.

import { Worker } from 'node:worker_threads';
import { simpleParser } from 'mailparser';
import type { PipelineLogger } from './logger.js';

export interface ParseResult {
  readonly text: string;
  readonly parseMs: number;
}

export interface Parser {
  parse(source: Buffer): Promise<ParseResult>;
  close(): Promise<void>;
  // Telemetry. `kind` tells callers what's actually running so the
  // span / log line can record it ("inline" vs "worker-pool size=4").
  readonly kind: 'inline' | 'worker-pool';
  readonly size: number;
}

const PARSER_OPTS = {
  skipImageLinks: true,
  skipTextLinks: true,
  skipTextToHtml: true,
  maxHtmlLengthToParse: 1024 * 1024,
} as const;

// In-process implementation. mailparser is awaitable on this thread,
// so semantics match exactly what body-scan used to do before the
// worker pool existed. Useful for unit tests and as a defensive
// fallback if worker spin-up fails at runtime.
export function createInlineParser(): Parser {
  return {
    kind: 'inline',
    size: 1,
    async parse(source: Buffer): Promise<ParseResult> {
      const t0 = performance.now();
      const parsed = await simpleParser(source, PARSER_OPTS);
      const parseMs = performance.now() - t0;
      const text =
        typeof parsed.text === 'string' && parsed.text.length > 0
          ? parsed.text
          : '';
      return { text, parseMs };
    },
    async close(): Promise<void> {
      /* nothing to close */
    },
  };
}

interface PendingParse {
  readonly resolve: (r: ParseResult) => void;
  readonly reject: (err: Error) => void;
}

interface WorkerSlot {
  readonly worker: Worker;
  // In-flight requests keyed by the parent-generated message id. We
  // dispatch round-robin so a single worker may carry multiple
  // pending replies — the id-correlation is what untangles them.
  readonly pending: Map<number, PendingParse>;
}

// Wall-clock cap on a single parse round-trip. On dev / unpacked
// builds workers reply in low double-digit ms; on asar-packaged
// builds we've observed workers swallowing requests silently with no
// reply ever (deep-scan stuck at `processed=0`). Rather than let that
// hang the whole scan indefinitely, we reject the parse promise
// after `PARSE_TIMEOUT_MS` and the body-scan caller logs a
// `body-scan-parse-error` + skips that message. A handful of skipped
// bodies is recoverable; an indefinite hang is not.
const PARSE_TIMEOUT_MS = 30_000;

// Round-robin worker pool. Each parse request gets a unique id; the
// worker echoes the id back on its reply so we know which promise to
// settle. Round-robin (not least-busy) keeps allocation O(1) per
// request and is fine for our workload — parse times are within ~2×
// of each other (HTML payload variance), so simple distribution
// stays balanced.
//
// `scriptPath` must be a fully-resolved absolute path to the compiled
// `parser-worker.js`. Caller is responsible for picking it up from
// the right place (electron-vite emits it next to main/index.js).
export function createWorkerParserPool(
  size: number,
  scriptPath: string,
  logger?: PipelineLogger,
): Parser {
  if (size < 1) throw new Error('parser pool size must be >= 1');
  let nextId = 0;
  let cursor = 0;
  const slots: WorkerSlot[] = [];
  const spawnedAt = performance.now();
  for (let i = 0; i < size; i += 1) {
    const worker = new Worker(scriptPath);
    const pending = new Map<number, PendingParse>();
    worker.on('message', (msg: { event?: string; id?: number; text?: string; parseMs?: number; error?: string }) => {
      // Readiness ping. The worker sends this once it has loaded
      // mailparser and is sitting on `parentPort.on('message')`. On
      // packaged builds where the workers hang, this never fires for
      // some/all slots — which is exactly the diagnostic we want.
      if (msg.event === 'ready') {
        logger?.info('parser-worker-ready', {
          slot: i,
          elapsedMs: (performance.now() - spawnedAt).toFixed(0),
        });
        return;
      }
      if (typeof msg.id !== 'number') return;
      const slot = slots[i];
      if (!slot) return;
      const p = slot.pending.get(msg.id);
      if (!p) return;
      slot.pending.delete(msg.id);
      if (typeof msg.error === 'string') {
        p.reject(new Error(msg.error));
      } else if (typeof msg.text === 'string' && typeof msg.parseMs === 'number') {
        p.resolve({ text: msg.text, parseMs: msg.parseMs });
      } else {
        p.reject(new Error('malformed parser worker reply'));
      }
    });
    // If a worker dies unexpectedly (OOM, native crash inside
    // mailparser on a pathological MIME), we reject every pending
    // request that landed in its lap. Caller's catch arm in body-scan
    // logs `body-scan-parse-error` and skips the body — same as the
    // previous in-process behaviour.
    worker.on('error', (err) => {
      const slot = slots[i];
      if (!slot) return;
      for (const p of slot.pending.values()) p.reject(err);
      slot.pending.clear();
    });
    worker.on('exit', (code) => {
      const slot = slots[i];
      if (!slot) return;
      if (slot.pending.size === 0) return;
      const err = new Error(`parser worker exited unexpectedly code=${code}`);
      for (const p of slot.pending.values()) p.reject(err);
      slot.pending.clear();
    });
    slots.push({ worker, pending });
  }

  let closed = false;

  return {
    kind: 'worker-pool',
    size,
    async parse(source: Buffer): Promise<ParseResult> {
      if (closed) throw new Error('parser pool is closed');
      const id = nextId++;
      const slotIdx = cursor;
      cursor = (cursor + 1) % slots.length;
      const slot = slots[slotIdx];
      if (!slot) throw new Error('parser pool slot missing');
      return new Promise<ParseResult>((resolve, reject) => {
        // Timeout guard. If the worker doesn't reply in time we treat
        // the request as dead — settle the promise with an error so
        // body-scan logs `body-scan-parse-error` and skips. The worker
        // may eventually reply later; the pending-Map lookup in the
        // worker's `message` handler will find no entry and silently
        // drop, which is fine — better a missing body than a stuck
        // scan.
        const timer = setTimeout(() => {
          if (!slot.pending.has(id)) return;
          slot.pending.delete(id);
          reject(new Error(`parser worker timeout after ${PARSE_TIMEOUT_MS} ms`));
        }, PARSE_TIMEOUT_MS);
        // Unref so a stuck worker doesn't keep the Electron process
        // alive after the scan tears down the pool.
        timer.unref();
        slot.pending.set(id, {
          resolve: (r) => {
            clearTimeout(timer);
            resolve(r);
          },
          reject: (e) => {
            clearTimeout(timer);
            reject(e);
          },
        });
        // Plain structured clone — no `transferList`. We tried
        // transferring `source.buffer` for zero-copy delivery, but on
        // a real 100k scan the late chunks came through with
        // `Buffer.isBuffer === false` on the worker side and got
        // rejected en masse: imapflow's internal Buffer pool reuses
        // ArrayBuffer slabs across messages, so once we had
        // transferred enough underlying buffers the remaining views
        // got served from detached / Uint8Array-tagged sources.
        slot.worker.postMessage({ id, source });
      });
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      // Reject every in-flight request before tearing down workers so
      // callers awaiting them get a clean error instead of hanging.
      const closeErr = new Error('parser pool closed');
      for (const slot of slots) {
        for (const p of slot.pending.values()) p.reject(closeErr);
        slot.pending.clear();
      }
      await Promise.all(slots.map((s) => s.worker.terminate()));
    },
  };
}

// Resolve the parser-worker script path from the location of the
// running main bundle. electron-vite emits every `main` entry into the
// same `out/main/` directory, so the worker sits as a sibling to
// `index.js`. Caller passes `import.meta.url` from the main entry; we
// resolve `./parser-worker.js` against it.
export function defaultWorkerScriptPath(mainModuleUrl: string): string {
  const url = new URL('./parser-worker.js', mainModuleUrl);
  return url.pathname;
}
