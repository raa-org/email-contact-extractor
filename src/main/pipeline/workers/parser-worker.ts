/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

// Worker entry for mailparser offload. Receives an RFC-822 source
// buffer, returns the extracted text/plain slab plus the parse
// duration. Stays small on purpose — the only reason this exists is to
// move `simpleParser`'s HTML-tokenisation CPU out of the main process,
// which on a 100k mailbox sits at ~80% of the deep-scan wall time.
//
// Protocol (message shape — id-correlated, fire-and-forget):
//
//   parent → worker: { id, source: Buffer | Uint8Array }
//   worker → parent: { id, text: string, parseMs: number }
//                  | { id, error: string }
//
// Why we accept Uint8Array as well: structured clone of a Buffer
// strips its Node-specific prototype tag, so `Buffer.isBuffer(msg.source)`
// is `false` on the receiving side even though the bytes round-tripped
// cleanly. Wrapping the typed array back into a Buffer here keeps
// mailparser's input contract happy without forcing the parent to pay
// for a deep copy before sending.

import { parentPort } from 'node:worker_threads';
import { simpleParser } from 'mailparser';

// Mirror body-scan.ts's PARSER_OPTS so behaviour is identical on the
// worker side. Keeping the constant local instead of importing avoids
// pulling the whole body-scan module (and its electron-log /
// imapflow / better-sqlite3 deps) into the worker.
const PARSER_OPTS = {
  skipImageLinks: true,
  skipTextLinks: true,
  skipTextToHtml: true,
  maxHtmlLengthToParse: 1024 * 1024,
} as const;

interface InboundMessage {
  readonly id: number;
  readonly source: Uint8Array | Buffer;
}

if (!parentPort) {
  throw new Error('parser-worker started without a parent port');
}

// Readiness ping. Sent as soon as the worker has loaded mailparser
// and registered its message listener — without it the parent has no
// way to distinguish "worker mid-init" from "worker crashed silently
// on startup" (which is what we suspect is happening on asar-packaged
// builds where the deep-scan hangs at processed=0). Parent logs each
// ready ping so a forensic check answers "which of the N workers
// actually came up?".
parentPort.postMessage({ event: 'ready' });

parentPort.on('message', async (msg: InboundMessage) => {
  // Defensive: drop malformed messages instead of crashing the worker.
  // A crashed worker stalls the pool — the parent's request would sit
  // unresolved until the pool times out.
  if (typeof msg?.id !== 'number') {
    parentPort?.postMessage({ id: -1, error: 'invalid message: no id' });
    return;
  }
  const view = msg.source;
  if (!ArrayBuffer.isView(view)) {
    parentPort?.postMessage({
      id: msg.id,
      error: 'invalid message: source is not a typed array',
    });
    return;
  }
  // Structured clone hands us a Uint8Array; wrap it back into a Buffer
  // (cheap — no copy, just a tag flip) so mailparser's internal
  // `Buffer.isBuffer` checks short-circuit.
  const buf = Buffer.isBuffer(view)
    ? view
    : Buffer.from(view.buffer, view.byteOffset, view.byteLength);
  const t0 = performance.now();
  try {
    const parsed = await simpleParser(buf, PARSER_OPTS);
    const parseMs = performance.now() - t0;
    const text =
      typeof parsed.text === 'string' && parsed.text.length > 0
        ? parsed.text
        : '';
    parentPort?.postMessage({ id: msg.id, text, parseMs });
  } catch (err) {
    parentPort?.postMessage({
      id: msg.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});
