/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest';
import type { ZodType } from 'zod';
import {
  ContactRow,
  Credentials,
  Direction,
  EmailAddress,
  ExportFormat,
  ExportOptions,
  FolderInfo,
  ScanOptions,
  ScanPhase,
  ScanProgress,
  Sensitive,
  ServerPreset,
} from '../../src/shared/domain.js';
import { DEFAULT_AUTOMATION_LOCAL_PARTS } from '../../src/shared/heuristics-config.js';
import {
  AppPingRequest,
  AppPingResponse,
  ContactsListPagination,
  ContactsListRequest,
  ContactsListResponse,
  ExportRunRequest,
  ExportRunResponse,
  ImapTestConnectionRequest,
  ImapTestConnectionResponse,
  ScanCancelRequest,
  ScanCancelResponse,
  ScanFilterPreferencesSaveRequest,
  ScanStartRequest,
  ScanStartResponse,
  ScanSubscribeProgressRequest,
  ScanSubscribeProgressResponse,
  channels,
} from '../../src/shared/ipc-contracts.js';

const credentialsSample = {
  host: 'imap.example.com',
  port: 993,
  tls: true,
  username: 'user@example.com',
  password: Sensitive.parse('super-secret-password'),
};

const scanOptionsSample = {
  folderInclude: ['INBOX', 'Sent'],
  folderExclude: ['Spam'],
  includeDomains: [],
  excludeDomains: ['example.com'],
  includeWordsInbound: [],
  excludeWordsInbound: [],
  includeWordsOutbound: [],
  excludeWordsOutbound: [],
  automationLocalParts: [...DEFAULT_AUTOMATION_LOCAL_PARTS],
  directionMode: 'bi' as const,
  minMessages: 2,
  parseBodies: false,
};

const contactRowSample = {
  email: 'jane.doe@example.com',
  firstSeenUtc: '2025-01-04T10:00:00.000Z',
  lastSeenUtc: '2026-04-20T08:30:00.000Z',
  countIn: 12,
  countOut: 8,
  total: 20,
  subjectsSample: ['Re: contract', 'Q1 review'],
  displayNames: ['Jane Doe', 'J. Doe'],
};

const scanProgressSample = {
  phase: 'fetching' as const,
  currentFolder: 'INBOX',
  processed: 1234,
  total: 50_000,
  etaSeconds: 600,
};

const exportOptionsSample = {
  format: 'xlsx' as const,
  columns: ['email', 'firstSeenUtc', 'total'] as const,
  filePath: '/tmp/contacts.xlsx',
};

interface RoundTripCase<T> {
  readonly name: string;
  readonly schema: ZodType<T>;
  readonly value: unknown;
}

const cases: ReadonlyArray<RoundTripCase<unknown>> = [
  {
    name: 'EmailAddress',
    schema: EmailAddress,
    value: { email: 'foo@bar.com', name: 'Foo' },
  },
  { name: 'Direction', schema: Direction, value: 'in' },
  {
    name: 'ServerPreset',
    schema: ServerPreset,
    value: {
      id: 'mail',
      label: 'imap.example.com',
      host: 'imap.example.com',
      port: 993,
      tls: true,
      supportsSso: false,
    },
  },
  { name: 'Credentials', schema: Credentials, value: credentialsSample },
  {
    name: 'FolderInfo',
    schema: FolderInfo,
    value: { path: 'INBOX/2024', delimiter: '/', flags: ['\\HasNoChildren'], specialUse: '\\Inbox' },
  },
  { name: 'ContactRow', schema: ContactRow, value: contactRowSample },
  { name: 'ScanOptions', schema: ScanOptions, value: scanOptionsSample },
  { name: 'ScanPhase', schema: ScanPhase, value: 'fetching' },
  { name: 'ScanProgress', schema: ScanProgress, value: scanProgressSample },
  { name: 'ExportFormat', schema: ExportFormat, value: 'csv' },
  { name: 'ExportOptions', schema: ExportOptions, value: exportOptionsSample },
  { name: 'AppPingRequest', schema: AppPingRequest, value: {} },
  { name: 'AppPingResponse', schema: AppPingResponse, value: { message: 'pong' } },
  {
    name: 'ImapTestConnectionRequest',
    schema: ImapTestConnectionRequest,
    value: credentialsSample,
  },
  {
    name: 'ImapTestConnectionResponse (ok)',
    schema: ImapTestConnectionResponse,
    value: { ok: true, capabilities: ['IMAP4rev1', 'IDLE'] },
  },
  {
    name: 'ImapTestConnectionResponse (error)',
    schema: ImapTestConnectionResponse,
    value: { ok: false, error: 'auth failed' },
  },
  {
    name: 'ScanStartRequest',
    schema: ScanStartRequest,
    value: { options: scanOptionsSample },
  },
  {
    name: 'ScanStartResponse',
    schema: ScanStartResponse,
    value: { runId: 'run-1', contactsCount: 42 },
  },
  { name: 'ScanCancelRequest', schema: ScanCancelRequest, value: { runId: 'run-1' } },
  { name: 'ScanCancelResponse', schema: ScanCancelResponse, value: { ok: true } },
  {
    name: 'ScanSubscribeProgressRequest',
    schema: ScanSubscribeProgressRequest,
    value: { runId: 'run-1' },
  },
  {
    name: 'ScanSubscribeProgressResponse',
    schema: ScanSubscribeProgressResponse,
    value: { ...scanProgressSample, runId: 'run-1' },
  },
  {
    name: 'ContactsListPagination',
    schema: ContactsListPagination,
    value: { offset: 0, limit: 100 },
  },
  {
    name: 'ContactsListRequest',
    schema: ContactsListRequest,
    value: {
      filter: { query: 'acme', domains: ['acme.com'] },
      pagination: { offset: 0, limit: 50 },
    },
  },
  {
    name: 'ContactsListResponse',
    schema: ContactsListResponse,
    value: { rows: [contactRowSample], total: 1 },
  },
  { name: 'ExportRunRequest', schema: ExportRunRequest, value: exportOptionsSample },
  {
    name: 'ExportRunResponse',
    schema: ExportRunResponse,
    value: { ok: true, filePath: '/tmp/contacts.xlsx', rowsExported: 42 },
  },
];

describe('shared contracts round-trip', () => {
  for (const c of cases) {
    it(`round-trips ${c.name}`, () => {
      const parsed = c.schema.parse(c.value);
      const json = JSON.stringify(parsed);
      const reparsed = c.schema.parse(JSON.parse(json));
      expect(reparsed).toEqual(parsed);
    });
  }

  it('rejects invalid email in EmailAddress', () => {
    expect(() => EmailAddress.parse({ email: 'not-an-email' })).toThrow();
  });

  it('rejects out-of-range port in ServerPreset', () => {
    expect(() =>
      ServerPreset.parse({
        id: 'x',
        label: 'x',
        host: 'x',
        port: 99999,
        tls: true,
        supportsSso: false,
      }),
    ).toThrow();
  });

  it('rejects ImapTestConnectionResponse with mixed shape', () => {
    expect(() =>
      ImapTestConnectionResponse.parse({ ok: true, error: 'should not be here' }),
    ).toThrow();
  });

  it('rejects ScanFilterPreferencesSaveRequest with unknown top-level preferences key', () => {
    const malformed = {
      preferences: {
        version: 1,
        filters: {
          includeDomains: [],
          excludeDomains: [],
          automationLocalParts: [],
          includeWordsInbound: [],
          excludeWordsInbound: [],
          includeWordsOutbound: [],
          excludeWordsOutbound: [],
          directionMode: 'bi' as const,
          minMessages: 2,
          parseBodies: false,
        },
        unknownTopLevel: true,
      },
    };
    expect(() => ScanFilterPreferencesSaveRequest.parse(malformed)).toThrow();
  });

  it('rejects ScanFilterPreferencesSaveRequest with unknown nested filter key', () => {
    const malformed = {
      preferences: {
        version: 1,
        filters: {
          includeDomains: [],
          excludeDomains: [],
          automationLocalParts: [],
          includeWordsInbound: [],
          excludeWordsInbound: [],
          includeWordsOutbound: [],
          excludeWordsOutbound: [],
          directionMode: 'bi' as const,
          minMessages: 2,
          parseBodies: false,
          unknownFilterKey: 'x',
        },
      },
    };
    expect(() => ScanFilterPreferencesSaveRequest.parse(malformed)).toThrow();
  });

  it('applies default automation local-parts to ScanOptions', () => {
    const parsed = ScanOptions.parse({});
    expect(parsed.automationLocalParts).toEqual(DEFAULT_AUTOMATION_LOCAL_PARTS);
  });

  it('exposes channel name constants matching the contract values', () => {
    expect(channels.appPing).toBe('app.ping');
    expect(channels.imapTestConnection).toBe('imap.testConnection');
    expect(channels.scanStart).toBe('scan.start');
    expect(channels.scanCancel).toBe('scan.cancel');
    expect(channels.scanSubscribeProgress).toBe('scan.subscribeProgress');
    expect(channels.contactsList).toBe('contacts.list');
    expect(channels.exportRun).toBe('export.run');
  });
});
