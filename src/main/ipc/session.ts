/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import type { Credentials } from '../../shared/domain.js';
import { ImapClient } from '../imap/client.js';
import { getDb } from '../db/singleton.js';
import type { Db } from '../db/connection.js';

// Per-window session state. Holds the IMAP credentials submitted via
// imap.testConnection (kept only in main-process memory per CLAUDE.md §3),
// plus an ImapClient instance reused across folders.list / scan.start.

interface ActiveScan {
  readonly runId: string;
  readonly controller: AbortController;
}

let credentials: Credentials | null = null;
let client: ImapClient | null = null;
const scans = new Map<string, ActiveScan>();

export function setCredentials(creds: Credentials): void {
  credentials = creds;
}

export function hasCredentials(): boolean {
  return credentials !== null;
}

export function getCredentials(): Credentials {
  if (!credentials) throw new Error('No active IMAP session — call imap.testConnection first');
  return credentials;
}

export async function ensureClient(): Promise<ImapClient> {
  if (client && client.isConnected()) return client;
  if (!client) client = new ImapClient();
  await client.connect(getCredentials());
  return client;
}

export async function disconnect(): Promise<void> {
  for (const s of scans.values()) s.controller.abort();
  scans.clear();
  if (client) {
    try {
      await client.disconnect();
    } catch {
      /* ignore */
    }
  }
  client = null;
  credentials = null;
}

export function db(): Db {
  return getDb();
}

export function registerScan(runId: string, controller: AbortController): void {
  scans.set(runId, { runId, controller });
}

export function cancelScan(runId: string): boolean {
  const s = scans.get(runId);
  if (!s) return false;
  s.controller.abort();
  scans.delete(runId);
  return true;
}

export function clearScan(runId: string): void {
  scans.delete(runId);
}
