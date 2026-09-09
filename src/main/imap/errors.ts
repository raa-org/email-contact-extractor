/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

export type ImapErrorTag =
  | 'AuthError'
  | 'NetworkError'
  | 'FolderNotFoundError'
  | 'CancelledError';

export class AuthError extends Error {
  readonly tag: 'AuthError' = 'AuthError';
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'AuthError';
  }
}

export class NetworkError extends Error {
  readonly tag: 'NetworkError' = 'NetworkError';
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'NetworkError';
  }
}

export class FolderNotFoundError extends Error {
  readonly tag: 'FolderNotFoundError' = 'FolderNotFoundError';
  constructor(
    readonly folderPath: string,
    message: string = `IMAP folder not found: ${folderPath}`,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'FolderNotFoundError';
  }
}

export class CancelledError extends Error {
  readonly tag: 'CancelledError' = 'CancelledError';
  constructor(message: string = 'IMAP operation cancelled') {
    super(message);
    this.name = 'CancelledError';
  }
}

export type ImapError =
  | AuthError
  | NetworkError
  | FolderNotFoundError
  | CancelledError;

export function isImapError(err: unknown): err is ImapError {
  return (
    err instanceof AuthError ||
    err instanceof NetworkError ||
    err instanceof FolderNotFoundError ||
    err instanceof CancelledError
  );
}

// Codes that we consider worth retrying with a fresh connection.
// 'NoConnection' is imapflow's own marker for "you tried to use a dead client";
// the rest are standard libuv socket-level errors. Auth and folder-not-found
// are intentionally absent — those won't get fixed by reconnecting.
const TRANSIENT_NETWORK_CODES: ReadonlySet<string> = new Set([
  'NoConnection',
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENETDOWN',
]);

export function isTransientNetworkError(err: unknown): boolean {
  if (err instanceof AuthError || err instanceof FolderNotFoundError) return false;
  if (err instanceof CancelledError) return false;
  if (err instanceof NetworkError) {
    // Bare NetworkError without a cause comes from our own "ImapClient is not
    // connected" path — that *is* the transient case we want to recover from.
    return err.cause === undefined ? true : isTransientNetworkError(err.cause);
  }
  if (typeof err === 'object' && err !== null) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string' && TRANSIENT_NETWORK_CODES.has(code)) return true;
  }
  return false;
}

// Pretty one-liner suitable for user-facing errors and logs. Pulls out the
// nested `code` if present so messages read like "ETIMEDOUT: connection
// timed out". Avoids the noisy stack and class-name prefixes we'd otherwise
// get from String(err).
export function describeError(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    return typeof code === 'string' && code.length > 0
      ? `${code}: ${err.message}`
      : err.message;
  }
  return String(err);
}
