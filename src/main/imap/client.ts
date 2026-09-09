/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { ImapFlow, type FetchMessageObject, type ListResponse } from 'imapflow';
import type { Credentials, FolderInfo } from '../../shared/domain.js';
import { revealSensitive } from '../../shared/domain.js';
import { BODY_CAP_BYTES } from '../db/message-bodies.repo.js';
import {
  AuthError,
  CancelledError,
  FolderNotFoundError,
  NetworkError,
} from './errors.js';

export interface RawHeader {
  readonly uid: number;
  readonly internalDate: Date;
  readonly headers: Map<string, string>;
  readonly flags: ReadonlySet<string>;
  // Populated only when the caller asks for it via FetchHeadersOpts.withBody.
  // Holds the raw RFC-822 source so the pipeline can hand it to mailparser
  // for plain-text extraction. Default header-only fetches leave this null.
  readonly source: Buffer | null;
}

export interface FetchHeadersOpts {
  readonly withBody?: boolean;
}

export interface FolderState {
  readonly uidvalidity: number;
  readonly uidnext: number;
  readonly exists: number;
}

export type UidRange =
  | string
  | { readonly min: number; readonly max?: number }
  | readonly number[];

function rangeToImap(range: UidRange): string {
  if (typeof range === 'string') {
    if (range.length === 0) throw new Error('UID range string is empty');
    return range;
  }
  if (Array.isArray(range)) {
    if (range.length === 0) throw new Error('UID range array is empty');
    return range.join(',');
  }
  const obj = range as { min: number; max?: number };
  if (!Number.isFinite(obj.min)) throw new Error('UID range.min is invalid');
  return obj.max === undefined ? `${obj.min}:*` : `${obj.min}:${obj.max}`;
}

function checkAbort(signal: AbortSignal | undefined, message?: string): void {
  if (signal?.aborted) throw new CancelledError(message ?? 'IMAP operation cancelled');
}

function looksLikeAuthError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as Record<string, unknown>;
  if (e['authenticationFailed'] === true) return true;
  if (e['code'] === 'EAUTH' || e['code'] === 'AUTHENTICATIONFAILED') return true;
  if (e['responseStatus'] === 'NO' && typeof e['response'] === 'string' && /auth/i.test(e['response'] as string)) return true;
  if (typeof e['message'] === 'string' && /(authentic|invalid credentials|login failed)/i.test(e['message'] as string)) {
    return true;
  }
  return false;
}

function looksLikeFolderNotFound(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as Record<string, unknown>;
  if (e['code'] === 'NoSuchMailbox' || e['code'] === 'NONEXISTENT') return true;
  if (typeof e['message'] === 'string' && /(no such|nonexistent|does not exist|not found)/i.test(e['message'] as string)) {
    return true;
  }
  return false;
}

function flattenHeaderMap(map: Map<string, string | string[]>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of map) {
    const v = Array.isArray(value) ? value[value.length - 1] : value;
    if (typeof v !== 'string' || v.length === 0) continue;
    out.set(key.toLowerCase(), v);
  }
  return out;
}

// Parse a raw RFC-822 header block. imapflow's fetch({ headers: true })
// returns headers as a Buffer (e.g. "Name: value\r\n…"), not a Map. Iterating
// the Buffer with destructuring is what blew up earlier with
// "is not iterable" — Buffers iterate as bytes, not [key,value] pairs.
function parseRfc822Headers(buf: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  const text = buf.toString('utf8');
  const lines = text.split(/\r?\n/);
  let name: string | null = null;
  let value = '';
  const commit = (): void => {
    if (name !== null) {
      const trimmed = value.trim();
      if (trimmed.length > 0) out.set(name.toLowerCase(), trimmed);
    }
    name = null;
    value = '';
  };
  for (const line of lines) {
    if (line.length === 0) continue;
    if (/^[ \t]/.test(line)) {
      value += ' ' + line.trim();
      continue;
    }
    commit();
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    name = line.slice(0, colon);
    value = line.slice(colon + 1).trim();
  }
  commit();
  return out;
}

function extractHeaders(value: unknown): Map<string, string> {
  if (value === null || value === undefined) return new Map();
  if (value instanceof Map) {
    return flattenHeaderMap(value as Map<string, string | string[]>);
  }
  if (Buffer.isBuffer(value)) {
    return parseRfc822Headers(value);
  }
  if (typeof value === 'string') {
    return parseRfc822Headers(Buffer.from(value, 'utf8'));
  }
  if (typeof value === 'object') {
    const out = new Map<string, string>();
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === 'string' && v.length > 0) {
        out.set(k.toLowerCase(), v);
      } else if (Array.isArray(v) && v.length > 0) {
        const last = v[v.length - 1];
        if (typeof last === 'string' && last.length > 0) out.set(k.toLowerCase(), last);
      }
    }
    return out;
  }
  return new Map();
}

function toStringArray(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string');
  }
  if (value instanceof Set) {
    return Array.from(value).filter((v): v is string => typeof v === 'string');
  }
  const candidate = value as { [Symbol.iterator]?: unknown };
  if (typeof candidate[Symbol.iterator] === 'function') {
    try {
      return Array.from(value as Iterable<unknown>).filter(
        (v): v is string => typeof v === 'string',
      );
    } catch {
      return [];
    }
  }
  return [];
}

function toFolderInfo(box: ListResponse): FolderInfo {
  const flags = toStringArray(box.flags);
  const base: FolderInfo = {
    path: box.path,
    delimiter: box.delimiter ?? '/',
    flags,
  };
  return box.specialUse ? { ...base, specialUse: box.specialUse } : base;
}

// Structural type the pipeline depends on. The real ImapClient implements
// this shape; tests can pass any object that does. Keeps the pipeline free
// of imapflow imports for testability.
export interface ImapClientLike {
  isConnected(): boolean;
  connect(credentials: Credentials, signal?: AbortSignal): Promise<void>;
  disconnect(): Promise<void>;
  listFolders(signal?: AbortSignal): Promise<FolderInfo[]>;
  getFolderState(folderPath: string, signal?: AbortSignal): Promise<FolderState>;
  fetchHeaders(
    folderPath: string,
    range: UidRange,
    signal?: AbortSignal,
    opts?: FetchHeadersOpts,
  ): AsyncIterable<RawHeader>;
  // Returns the full live UID set for `folderPath` — used by the
  // ingestion phase to detect messages that disappeared on the server
  // (expunged / moved). Cheap compared to fetchHeaders: a SEARCH ALL
  // sends one IMAP command and the response is just integers, so even
  // a 50k-message folder fits in ~200 KB.
  listLiveUids(
    folderPath: string,
    signal?: AbortSignal,
  ): Promise<readonly number[]>;
}

export class ImapClient implements ImapClientLike {
  private client: ImapFlow | null = null;

  isConnected(): boolean {
    return this.client !== null;
  }

  async connect(credentials: Credentials, signal?: AbortSignal): Promise<void> {
    checkAbort(signal, 'connect cancelled before start');
    if (this.client) {
      throw new NetworkError('ImapClient.connect called while already connected');
    }
    const client = new ImapFlow({
      host: credentials.host,
      port: credentials.port,
      secure: credentials.tls,
      auth: {
        user: credentials.username,
        pass: revealSensitive(credentials.password),
      },
      logger: false,
      emitLogs: false,
    });
    // Register listeners BEFORE connect() so we never miss a 'close' event
    // that could fire between connect resolution and our own assignment of
    // `this.client`. The `this.client === client` guard makes the listener
    // a no-op on every instance except the currently active one — important
    // because old instances stay alive long enough for graceful logout to
    // also fire 'close'.
    client.on('close', () => {
      if (this.client === client) this.client = null;
    });
    client.on('error', () => {
      if (this.client === client) this.client = null;
    });
    try {
      await client.connect();
      this.client = client;
    } catch (err) {
      try {
        await client.logout();
      } catch {
        /* ignore */
      }
      if (looksLikeAuthError(err)) {
        throw new AuthError(
          `IMAP authentication failed for ${credentials.username}@${credentials.host}:${credentials.port}`,
          err,
        );
      }
      throw new NetworkError(
        `Failed to connect to ${credentials.host}:${credentials.port} (tls=${credentials.tls})`,
        err,
      );
    }
  }

  async disconnect(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (!client) return;
    try {
      await client.logout();
    } catch {
      /* connection may already be down — graceful no-op */
    }
  }

  async listFolders(signal?: AbortSignal): Promise<FolderInfo[]> {
    const client = this.requireClient();
    checkAbort(signal, 'listFolders cancelled');
    try {
      const list = await client.list({ listNamespaces: true } as never);
      return list.map(toFolderInfo);
    } catch (err) {
      throw new NetworkError('Failed to list IMAP folders', err);
    }
  }

  async getFolderState(folderPath: string, signal?: AbortSignal): Promise<FolderState> {
    const client = this.requireClient();
    checkAbort(signal, 'getFolderState cancelled');
    try {
      const status = await client.status(folderPath, {
        uidValidity: true,
        uidNext: true,
        messages: true,
      });
      return {
        uidvalidity: Number(status.uidValidity ?? 0),
        uidnext: Number(status.uidNext ?? 0),
        exists: Number(status.messages ?? 0),
      };
    } catch (err) {
      if (looksLikeFolderNotFound(err)) {
        throw new FolderNotFoundError(folderPath, undefined, err);
      }
      throw new NetworkError(`Failed to read folder state for '${folderPath}'`, err);
    }
  }

  async *fetchHeaders(
    folderPath: string,
    range: UidRange,
    signal?: AbortSignal,
    opts?: FetchHeadersOpts,
  ): AsyncGenerator<RawHeader, void, void> {
    const client = this.requireClient();
    checkAbort(signal, 'fetchHeaders cancelled before start');

    try {
      await client.mailboxOpen(folderPath, { readOnly: true });
    } catch (err) {
      if (looksLikeFolderNotFound(err)) {
        throw new FolderNotFoundError(folderPath, undefined, err);
      }
      throw new NetworkError(`Failed to open folder '${folderPath}'`, err);
    }

    try {
      const rangeStr = rangeToImap(range);
      // `source: { maxLength }` asks imapflow for at most the first N bytes
      // of `BODY.PEEK[]`. text/plain conventionally lies near the top of a
      // multipart message (multipart/alternative wrapper, text/plain →
      // text/html → attachments), so capping at BODY_CAP_BYTES (256 KB)
      // captures the text our classifier needs while leaving attachment
      // payloads on the server. Pass 1 of the scan asks for headers only;
      // only the deep-scan body pass sets `withBody`. Same number is used
      // for the post-parse plaintext cap in message-bodies.repo so a body
      // can't exceed it at any pipeline stage.
      const fetchSpec: Record<string, boolean | { maxLength: number }> = {
        uid: true,
        internalDate: true,
        flags: true,
        headers: true,
      };
      if (opts?.withBody) fetchSpec['source'] = { maxLength: BODY_CAP_BYTES };
      const iter = client.fetch(
        rangeStr,
        fetchSpec as never,
        { uid: true },
      ) as AsyncIterable<FetchMessageObject>;

      for await (const msg of iter) {
        if (signal?.aborted) {
          throw new CancelledError(`fetchHeaders on '${folderPath}' cancelled mid-stream`);
        }
        const ts = msg.internalDate;
        const internalDate =
          ts instanceof Date ? ts : typeof ts === 'string' ? new Date(ts) : new Date(0);
        const source =
          opts?.withBody && Buffer.isBuffer((msg as { source?: unknown }).source)
            ? ((msg as { source: Buffer }).source)
            : null;
        yield {
          uid: Number(msg.uid),
          internalDate,
          flags: new Set(toStringArray(msg.flags)),
          headers: extractHeaders(msg.headers),
          source,
        };
      }
    } finally {
      try {
        await client.mailboxClose();
      } catch {
        /* ignore — mailbox may have already closed */
      }
    }
  }

  async listLiveUids(
    folderPath: string,
    signal?: AbortSignal,
  ): Promise<readonly number[]> {
    const client = this.requireClient();
    checkAbort(signal, 'listLiveUids cancelled before start');
    try {
      await client.mailboxOpen(folderPath, { readOnly: true });
    } catch (err) {
      if (looksLikeFolderNotFound(err)) {
        throw new FolderNotFoundError(folderPath, undefined, err);
      }
      throw new NetworkError(`Failed to open folder '${folderPath}'`, err);
    }
    try {
      // imapflow's `search({ all: true }, { uid: true })` issues a UID
      // SEARCH ALL and returns the matched UIDs. Faster than fetching
      // headers since the server doesn't have to ship anything past the
      // UID itself.
      const result = (await client.search({ all: true } as never, {
        uid: true,
      })) as readonly number[] | false;
      checkAbort(signal, 'listLiveUids cancelled mid-flight');
      // imapflow returns false on empty search; normalise to [].
      return result === false ? [] : result.map((u) => Number(u));
    } catch (err) {
      throw new NetworkError(
        `Failed to list live UIDs for '${folderPath}'`,
        err,
      );
    } finally {
      try {
        await client.mailboxClose();
      } catch {
        /* ignore */
      }
    }
  }

  private requireClient(): ImapFlow {
    if (!this.client) {
      throw new NetworkError('ImapClient is not connected');
    }
    return this.client;
  }
}
