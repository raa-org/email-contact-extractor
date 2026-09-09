/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describePlatform, type MetricsHeader } from '../../src/main/pipeline/metrics.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Repo root resolved from this file's location so the bench harness
// works regardless of cwd. `benchmarks/_lib/run-header.ts` is two dirs
// below the repo root.
const REPO_ROOT = resolve(__dirname, '..', '..');

function readVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'),
    ) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function readCommit(): string {
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return sha.length > 0 ? sha : 'unknown';
  } catch {
    return 'unknown';
  }
}

export interface MakeHeaderArgs {
  readonly scenario: string;
  readonly options?: Record<string, unknown>;
  readonly runId?: string;
}

export function makeRunHeader(args: MakeHeaderArgs): MetricsHeader {
  const header: MetricsHeader = {
    version: readVersion(),
    commit: readCommit(),
    startedAt: new Date().toISOString(),
    runId: args.runId ?? randomUUID(),
    scenario: args.scenario,
    platform: describePlatform(),
    ...(args.options ? { options: args.options } : {}),
  };
  return header;
}

// Output filename pattern: `<scenario>__v<version>__<commitShort>__<isoTs>.jsonl`.
// Sortable by lexical order so `ls benchmarks/out/` reads chronologically.
// Colons in ISO timestamps replaced with `-` for cross-OS filename safety.
export function buildOutputPath(header: MetricsHeader): string {
  const tsSafe = header.startedAt.replace(/:/g, '-');
  const filename = `${header.scenario}__v${header.version}__${header.commit}__${tsSafe}.jsonl`;
  return resolve(REPO_ROOT, 'benchmarks', 'out', filename);
}
