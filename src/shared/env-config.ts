/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

// Single source of truth for environment-variable settings consumed
// by this codebase. Centralising readers here keeps the rest of the
// project off `process.env[...]` so that:
//
//   • the full env surface is auditable in one file (grep here, not
//     across src/, tests/, benchmarks/),
//   • parsing + defaults live in one place (no drift between
//     "default = 2" in one caller and "default = 4" in another),
//   • new variables get a typed signature and a documented default
//     before they're consumed.
//
// Every exported name corresponds to one env var (or a small typed
// bundle thereof). Document each one inline so this file alone tells
// the whole story.
//
// NOT covered here:
//   • `ELECTRON_RENDERER_URL` — supplied by `electron-vite dev`, only
//     read by `src/main/index.ts`. Vite's contract, not ours.

// ──────────────────────────────────────────────────────────────────
//   Production knobs (read by Electron main process)
// ──────────────────────────────────────────────────────────────────

const DEFAULT_IMAP_POOL_SIZE = 2;
const MAX_IMAP_POOL_SIZE = 4;

// `PARSER_POOL_SIZE` — number of worker_threads in the mailparser pool.
//
//   0 (default) → no pool; deep-scan uses `createInlineParser()` on the
//     main thread. Slower, but proven to work on every packaged build.
//   N ≥ 1       → spin up N workers. Faster on a dev / unpacked build
//     (~5× on cyrus.local), but on asar-packaged production builds
//     (mac dmg, win portable) workers can silently fail to return —
//     scan hangs at `processed=0` while bodies queue up. Treat this
//     as an opt-in performance flag for environments where you've
//     verified workers actually run. Hard-capped at 8.
//
// Default is off because every Phase A optimisation (classify SQL,
// body-scan batched writes, etc.) is still in effect with the inline
// parser. On the user's prod mail server inline gives a working scan;
// turning the pool on currently risks an indefinite hang on the deep
// scan, which is strictly worse than slower-but-finishes.
const DEFAULT_PARSER_POOL_SIZE = 0;
const MAX_PARSER_POOL_SIZE = 8;

export function readParserPoolSize(): number {
  const raw = process.env['PARSER_POOL_SIZE'];
  if (raw === undefined || raw.length === 0) return DEFAULT_PARSER_POOL_SIZE;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_PARSER_POOL_SIZE;
  return Math.min(MAX_PARSER_POOL_SIZE, n);
}

// `IMAP_POOL_SIZE` (production), `BENCH_IMAP_POOL_SIZE` (bench alias).
//
// Number of parallel IMAP connections runScan spins up for fan-out
// ingest + deep-scan. Default 2 — every public IMAP service we've
// validated against (Cyrus, Gmail, Outlook) accepts at least that
// without throttling. Hard-capped at 4 because the IPC handler
// enforces a ceiling regardless of what env says, and 4+ rarely
// helps over 4 once mailparser/DB writers saturate the main loop.
//
// Sysadmins who know their server can raise it to 4 with
// `IMAP_POOL_SIZE=4 npm run dev`; anything bigger or non-numeric
// silently falls back to the default rather than failing the scan.
export function readImapPoolSize(): number {
  const raw = process.env['IMAP_POOL_SIZE'] ?? process.env['BENCH_IMAP_POOL_SIZE'];
  if (raw === undefined || raw.length === 0) return DEFAULT_IMAP_POOL_SIZE;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_IMAP_POOL_SIZE;
  return Math.min(MAX_IMAP_POOL_SIZE, n);
}

// ──────────────────────────────────────────────────────────────────
//   Benchmark harness knobs (read by `benchmarks/**/*.bench.ts`)
// ──────────────────────────────────────────────────────────────────

// Strict required-trio for the E2E bench. If any of the three is
// missing we return `null` and the bench `it.skip`s — keeps CI runs
// safe to invoke without an IMAP secret.
export interface BenchImapCredentials {
  readonly host: string;
  readonly port: number;
  readonly tls: boolean;
  readonly user: string;
  readonly pass: string;
}

// `BENCH_IMAP_HOST`, `BENCH_IMAP_PORT`, `BENCH_IMAP_TLS`,
// `BENCH_IMAP_USER`, `BENCH_IMAP_PASS`.
// PORT defaults to 993 (IMAPS), TLS defaults to true.
export function readBenchImapCredentials(): BenchImapCredentials | null {
  const host = readNonEmpty('BENCH_IMAP_HOST');
  const user = readNonEmpty('BENCH_IMAP_USER');
  const pass = readNonEmpty('BENCH_IMAP_PASS');
  if (host === undefined || user === undefined || pass === undefined) return null;
  return {
    host,
    user,
    pass,
    port: Number.parseInt(readNonEmpty('BENCH_IMAP_PORT') ?? '993', 10),
    tls: readBool('BENCH_IMAP_TLS', true),
  };
}

// `BENCH_PARSE_BODIES` — boolean, default false. Drives the e2e scan's
// `parseBodies` flag.
export function readBenchParseBodies(): boolean {
  return readBool('BENCH_PARSE_BODIES', false);
}

// `BENCH_FOLDERS` — comma-separated folder paths to scope the e2e
// scan to, or `undefined` to scan every folder the IMAP server lists.
export function readBenchFolderInclude(): readonly string[] | undefined {
  const raw = readNonEmpty('BENCH_FOLDERS');
  if (raw === undefined) return undefined;
  const parts = raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  return parts.length > 0 ? parts : undefined;
}

// Bench-aggregate shape knobs — `BENCH_FOLDERS_COUNT` (note the
// `_COUNT` suffix to keep it distinct from the e2e `BENCH_FOLDERS`
// string list), `BENCH_MESSAGES_PER_FOLDER`, `BENCH_CONTACTS`. Each
// falls back to `defaults` when missing or unparseable so a stray
// typo in the shell doesn't silently flatten the synthetic mailbox.
export interface BenchAggregateShape {
  readonly folders: number;
  readonly messagesPerFolder: number;
  readonly contacts: number;
}

export function readBenchAggregateShape(
  defaults: BenchAggregateShape,
): BenchAggregateShape {
  return {
    folders: readPositiveInt('BENCH_FOLDERS_COUNT') ?? defaults.folders,
    messagesPerFolder:
      readPositiveInt('BENCH_MESSAGES_PER_FOLDER') ?? defaults.messagesPerFolder,
    contacts: readPositiveInt('BENCH_CONTACTS') ?? defaults.contacts,
  };
}

// Backward-compat alias: the original bench-aggregate read
// `BENCH_FOLDERS` (no `_COUNT`) as a numeric. We renamed to keep e2e
// and aggregate from sharing a name with different types; this
// helper keeps the old name working for whoever has it in their
// shell history.
export function readBenchAggregateShapeWithLegacy(
  defaults: BenchAggregateShape,
): BenchAggregateShape {
  const fromNew = readBenchAggregateShape(defaults);
  const legacyFolders = readPositiveInt('BENCH_FOLDERS');
  return legacyFolders !== undefined ? { ...fromNew, folders: legacyFolders } : fromNew;
}

// ──────────────────────────────────────────────────────────────────
//   Helpers
// ──────────────────────────────────────────────────────────────────

function readNonEmpty(name: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v.length === 0 ? undefined : v;
}

function readBool(name: string, defaultValue: boolean): boolean {
  const v = readNonEmpty(name);
  if (v === undefined) return defaultValue;
  return /^(1|true|yes|on)$/i.test(v);
}

function readPositiveInt(name: string): number | undefined {
  const v = readNonEmpty(name);
  if (v === undefined) return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
