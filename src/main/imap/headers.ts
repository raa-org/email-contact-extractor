/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { simpleParser, type AddressObject } from 'mailparser';

export interface ParsedAddress {
  readonly email: string;
  readonly name?: string;
}

export interface ParsedHeaders {
  readonly from: ParsedAddress | null;
  readonly to: readonly ParsedAddress[];
  readonly cc: readonly ParsedAddress[];
  readonly date: Date | null;
  readonly subject: string | null;
  readonly messageId: string | null;
  readonly inReplyTo: string | null;
  readonly references: readonly string[];
  readonly autoSubmitted: string | null;
  readonly precedence: string | null;
  readonly listUnsubscribe: string | null;
  readonly listId: string | null;
  readonly hasListUnsubscribe: boolean;
  readonly hasListId: boolean;
  // Derived bit, NOT set by the header parser itself — the deep-scan
  // pipeline flips this to true when the body matches the
  // inline-unsubscribe regex. For header-only scans it stays false.
  readonly hasInlineUnsubscribe: boolean;
}

const WANTED_HEADERS = [
  'from',
  'to',
  'cc',
  'date',
  'subject',
  'message-id',
  'in-reply-to',
  'references',
  'auto-submitted',
  'precedence',
  'list-unsubscribe',
  'list-id',
] as const;

function getCi(headers: ReadonlyMap<string, string>, name: string): string | null {
  return headers.get(name.toLowerCase()) ?? null;
}

function addressesFromObject(
  obj: AddressObject | AddressObject[] | undefined,
): ParsedAddress[] {
  if (!obj) return [];
  const arr = Array.isArray(obj) ? obj : [obj];
  const out: ParsedAddress[] = [];
  for (const item of arr) {
    for (const v of item.value ?? []) {
      if (!v.address) continue;
      const trimmedName = typeof v.name === 'string' ? v.name.trim() : '';
      out.push(trimmedName ? { email: v.address, name: trimmedName } : { email: v.address });
    }
  }
  return out;
}

export async function parseHeaders(
  headers: ReadonlyMap<string, string>,
): Promise<ParsedHeaders> {
  const lines: string[] = [];
  for (const key of WANTED_HEADERS) {
    const v = headers.get(key);
    if (v !== undefined && v !== '') lines.push(`${key}: ${v}`);
  }
  const fakeMessage = lines.length === 0 ? '\r\n\r\n' : `${lines.join('\r\n')}\r\n\r\n`;
  const parsed = await simpleParser(fakeMessage);

  const from = addressesFromObject(parsed.from)[0] ?? null;
  const to = addressesFromObject(parsed.to);
  const cc = addressesFromObject(parsed.cc);

  let references: string[] = [];
  if (parsed.references) {
    references = Array.isArray(parsed.references)
      ? parsed.references
      : parsed.references.split(/\s+/).filter(Boolean);
  }

  const listUnsubscribe = getCi(headers, 'list-unsubscribe');
  const listId = getCi(headers, 'list-id');
  const autoSubmitted = getCi(headers, 'auto-submitted');
  const precedence = getCi(headers, 'precedence');

  return {
    from,
    to,
    cc,
    date: parsed.date ?? null,
    subject: typeof parsed.subject === 'string' ? parsed.subject : null,
    messageId: parsed.messageId ?? null,
    inReplyTo: parsed.inReplyTo ?? null,
    references,
    autoSubmitted,
    precedence,
    listUnsubscribe,
    listId,
    hasListUnsubscribe: listUnsubscribe !== null,
    hasListId: listId !== null,
    // Default false — only the deep-scan body pass flips this when the
    // inline-unsubscribe regex hits.
    hasInlineUnsubscribe: false,
  };
}

export {
  domainPart,
  localPart,
  normalizeEmail,
} from '../../shared/email-normalize.js';
