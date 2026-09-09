/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { z } from 'zod';
import {
  ContactRow,
  Credentials,
  ExportOptions,
  FolderInfo,
  Protocol,
  ScanOptions,
  ScanProgress,
} from './domain.js';
import {
  ACCOUNTS_DELETE,
  ACCOUNTS_GET_LAST,
  ACCOUNTS_LIST,
  APP_PING,
  APP_SHOW_LOGS,
  CACHE_RESET,
  CONTACTS_LIST,
  DIALOG_SHOW_SAVE,
  EXPORT_GET_DEFAULT_DIR,
  EXPORT_RUN,
  FOLDERS_LIST,
  IMAP_CONNECT_SAVED,
  IMAP_TEST_CONNECTION,
  MESSAGES_FOR_ADDRESS,
  SCAN_CANCEL,
  SCAN_FILTER_PREFERENCES_CLEAR,
  SCAN_FILTER_PREFERENCES_GET,
  SCAN_FILTER_PREFERENCES_SAVE,
  SCAN_SNAPSHOT_UPDATED,
  SCAN_START,
  SCAN_SUBSCRIBE_PROGRESS,
  SESSION_DISCONNECT,
  channels,
  type ChannelName,
} from './channels.js';

export {
  ACCOUNTS_DELETE,
  ACCOUNTS_GET_LAST,
  ACCOUNTS_LIST,
  APP_PING,
  APP_SHOW_LOGS,
  CACHE_RESET,
  CONTACTS_LIST,
  DIALOG_SHOW_SAVE,
  EXPORT_RUN,
  FOLDERS_LIST,
  EXPORT_GET_DEFAULT_DIR,
  IMAP_CONNECT_SAVED,
  IMAP_TEST_CONNECTION,
  MESSAGES_FOR_ADDRESS,
  SCAN_CANCEL,
  SCAN_FILTER_PREFERENCES_CLEAR,
  SCAN_FILTER_PREFERENCES_GET,
  SCAN_FILTER_PREFERENCES_SAVE,
  SCAN_SNAPSHOT_UPDATED,
  SCAN_START,
  SCAN_SUBSCRIBE_PROGRESS,
  SESSION_DISCONNECT,
  channels,
  type ChannelName,
};

export const AppPingRequest = z.object({});
export const AppPingResponse = z.object({ message: z.string() });
export type AppPingRequest = z.infer<typeof AppPingRequest>;
export type AppPingResponse = z.infer<typeof AppPingResponse>;

// rememberMe is the user-facing "Remember me" checkbox. Defaulting to true
// keeps the auto-resume UX working when older renderer builds still call
// testConnection without an explicit flag.
// rememberMe is the user-facing "Remember me" checkbox. Defaulting to true
// keeps the auto-resume UX working when older renderer builds still call
// testConnection without an explicit flag.
export const ImapTestConnectionRequest = Credentials.extend({
  rememberMe: z.boolean().default(true),
});
export const ImapTestConnectionResponse = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), capabilities: z.array(z.string()) }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type ImapTestConnectionRequest = z.infer<typeof ImapTestConnectionRequest>;
export type ImapTestConnectionResponse = z.infer<typeof ImapTestConnectionResponse>;

// Re-test a saved account by id. Decryption + Credentials reassembly happens
// in main; the renderer never sees the password. Same response shape as
// imap.testConnection so the renderer can treat it as a drop-in equivalent.
export const ImapConnectSavedRequest = z.object({
  accountId: z.number().int().positive(),
});
export const ImapConnectSavedResponse = ImapTestConnectionResponse;
export type ImapConnectSavedRequest = z.infer<typeof ImapConnectSavedRequest>;
export type ImapConnectSavedResponse = z.infer<typeof ImapConnectSavedResponse>;

// scan.start uses the credentials the main process cached during a
// successful imap.testConnection — the renderer never resends the password
// after the initial submission.
export const ScanStartRequest = z.object({ options: ScanOptions });
export const ScanStartResponse = z.object({
  runId: z.string().min(1),
  contactsCount: z.number().int().nonnegative(),
});
export type ScanStartRequest = z.infer<typeof ScanStartRequest>;
export type ScanStartResponse = z.infer<typeof ScanStartResponse>;

export const FoldersListRequest = z.object({});
export const FoldersListResponse = z.object({ folders: z.array(FolderInfo) });
export type FoldersListRequest = z.infer<typeof FoldersListRequest>;
export type FoldersListResponse = z.infer<typeof FoldersListResponse>;

export const DialogShowSaveRequest = z.object({
  defaultPath: z.string().optional(),
  filters: z
    .array(
      z.object({
        name: z.string(),
        extensions: z.array(z.string()),
      }),
    )
    .optional(),
});
export const DialogShowSaveResponse = z.object({
  canceled: z.boolean(),
  filePath: z.string().optional(),
});
export type DialogShowSaveRequest = z.infer<typeof DialogShowSaveRequest>;
export type DialogShowSaveResponse = z.infer<typeof DialogShowSaveResponse>;

export const SessionDisconnectRequest = z.object({});
export const SessionDisconnectResponse = z.object({ ok: z.boolean() });
export type SessionDisconnectRequest = z.infer<typeof SessionDisconnectRequest>;
export type SessionDisconnectResponse = z.infer<typeof SessionDisconnectResponse>;

export const ScanCancelRequest = z.object({ runId: z.string().min(1) });
export const ScanCancelResponse = z.object({ ok: z.boolean() });
export type ScanCancelRequest = z.infer<typeof ScanCancelRequest>;
export type ScanCancelResponse = z.infer<typeof ScanCancelResponse>;

export const ScanSubscribeProgressRequest = z.object({ runId: z.string().min(1) });
export const ScanSubscribeProgressResponse = ScanProgress.extend({
  runId: z.string().min(1),
});
export type ScanSubscribeProgressRequest = z.infer<typeof ScanSubscribeProgressRequest>;
export type ScanSubscribeProgressResponse = z.infer<typeof ScanSubscribeProgressResponse>;

// Per-folder snapshot delta. Contains only contacts that became "kept"
// since the last snapshot — kept-membership is monotonic in our heuristics
// (counts only grow, automation/role can only become "engaged"), so the
// renderer can append rows without re-sorting or removing previous ones.
export const ScanSnapshotUpdatedResponse = z.object({
  runId: z.string().min(1),
  contacts: z.array(ContactRow),
});
export type ScanSnapshotUpdatedResponse = z.infer<typeof ScanSnapshotUpdatedResponse>;

const ScanFilterPreferencesV1Filters = z.object({
  includeDomains: z.array(z.string()),
  excludeDomains: z.array(z.string()),
  automationLocalParts: z.array(z.string()),
  includeWordsInbound: z.array(z.string()),
  excludeWordsInbound: z.array(z.string()),
  includeWordsOutbound: z.array(z.string()),
  excludeWordsOutbound: z.array(z.string()),
  directionMode: ScanOptions.shape.directionMode,
  minMessages: ScanOptions.shape.minMessages,
  parseBodies: ScanOptions.shape.parseBodies,
}).strict();

export const ScanFilterPreferencesV1 = z.object({
  version: z.literal(1),
  filters: ScanFilterPreferencesV1Filters,
}).strict();
export type ScanFilterPreferencesV1 = z.infer<typeof ScanFilterPreferencesV1>;

export const ScanFilterPreferencesGetRequest = z.object({});
export const ScanFilterPreferencesGetResponse = z.object({
  preferences: ScanFilterPreferencesV1.nullable(),
});
export type ScanFilterPreferencesGetRequest = z.infer<typeof ScanFilterPreferencesGetRequest>;
export type ScanFilterPreferencesGetResponse = z.infer<typeof ScanFilterPreferencesGetResponse>;

export const ScanFilterPreferencesSaveRequest = z.object({
  preferences: ScanFilterPreferencesV1,
});
export const ScanFilterPreferencesSaveResponse = z.object({ ok: z.boolean() });
export type ScanFilterPreferencesSaveRequest = z.infer<typeof ScanFilterPreferencesSaveRequest>;
export type ScanFilterPreferencesSaveResponse = z.infer<typeof ScanFilterPreferencesSaveResponse>;

export const ScanFilterPreferencesClearRequest = z.object({});
export const ScanFilterPreferencesClearResponse = z.object({ ok: z.boolean() });
export type ScanFilterPreferencesClearRequest = z.infer<typeof ScanFilterPreferencesClearRequest>;
export type ScanFilterPreferencesClearResponse = z.infer<typeof ScanFilterPreferencesClearResponse>;

export const ContactsListFilter = z.object({
  query: z.string().optional(),
  domains: z.array(z.string()).optional(),
});
export const ContactsListPagination = z.object({
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive().max(1000),
});
export const ContactsListRequest = z.object({
  filter: ContactsListFilter.optional(),
  pagination: ContactsListPagination,
});
export const ContactsListResponse = z.object({
  rows: z.array(ContactRow),
  total: z.number().int().nonnegative(),
});
export type ContactsListFilter = z.infer<typeof ContactsListFilter>;
export type ContactsListPagination = z.infer<typeof ContactsListPagination>;
export type ContactsListRequest = z.infer<typeof ContactsListRequest>;
export type ContactsListResponse = z.infer<typeof ContactsListResponse>;

// Per-contact drill-down: every message in our local cache that contributed
// to a given email's aggregate. Inbound matched on from_addr; outbound
// matched on to_json/cc_json (substring of `"<email>"`). direction='self'
// excluded — same as the aggregator.
export const MessagesForAddressRequest = z.object({
  email: z.string().min(1),
  // Folder paths the most recent scan covered. Drill-down is strict-scope:
  // only messages from these folders are returned, matching the aggregator's
  // scope exactly. Empty / omitted = unscoped (account-wide cache) — used by
  // tests and any caller that hasn't run a scan yet.
  folderInclude: z.array(z.string()).optional(),
});
export const MessageDrilldownRow = z.object({
  folder: z.string(),
  uid: z.number().int().nonnegative(),
  dateUtc: z.string().nullable(),
  subject: z.string().nullable(),
  direction: z.enum(['in', 'out']),
  fromAddr: z.string().nullable(),
  fromName: z.string().nullable(),
  hasListUnsubscribe: z.boolean(),
  hasListId: z.boolean(),
  // Derived bit set during the deep-scan body pass when the body matches
  // the inline-unsubscribe regex; surfaces alongside other auto-flag chips.
  hasInlineUnsubscribe: z.boolean(),
  autoSubmitted: z.string().nullable(),
  precedence: z.string().nullable(),
});
export const MessagesForAddressResponse = z.object({
  rows: z.array(MessageDrilldownRow),
  truncated: z.boolean(),
});
export type MessagesForAddressRequest = z.infer<typeof MessagesForAddressRequest>;
export type MessageDrilldownRow = z.infer<typeof MessageDrilldownRow>;
export type MessagesForAddressResponse = z.infer<typeof MessagesForAddressResponse>;

export const ExportRunRequest = ExportOptions;
export const ExportRunResponse = z.object({
  ok: z.boolean(),
  filePath: z.string().min(1),
  rowsExported: z.number().int().nonnegative(),
});
export type ExportRunRequest = z.infer<typeof ExportRunRequest>;
export type ExportRunResponse = z.infer<typeof ExportRunResponse>;

// Resolves the directory the next export should default to: the
// user's last successful export folder if we have one, otherwise
// the OS Downloads folder.
export const ExportGetDefaultDirRequest = z.object({});
export const ExportGetDefaultDirResponse = z.object({ dir: z.string().min(1) });
export type ExportGetDefaultDirRequest = z.infer<typeof ExportGetDefaultDirRequest>;
export type ExportGetDefaultDirResponse = z.infer<typeof ExportGetDefaultDirResponse>;

// Account summary intentionally never carries the password — it's the
// renderer-facing view of a saved IMAP/SMTP account, used for the bootstrap
// flow and the saved-accounts UI in ConnectScreen.
export const AccountSummary = z.object({
  id: z.number().int().positive(),
  host: z.string().min(1),
  username: z.string().min(1),
  protocol: Protocol.nullable(),
  port: z.number().int().min(1).max(65535).nullable(),
  tls: z.boolean().nullable(),
  hasPassword: z.boolean(),
  lastUsedAt: z.number().int().nonnegative().nullable(),
});
export type AccountSummary = z.infer<typeof AccountSummary>;

export const AccountsListRequest = z.object({});
export const AccountsListResponse = z.object({ accounts: z.array(AccountSummary) });
export type AccountsListRequest = z.infer<typeof AccountsListRequest>;
export type AccountsListResponse = z.infer<typeof AccountsListResponse>;

export const AccountsDeleteRequest = z.object({ id: z.number().int().positive() });
export const AccountsDeleteResponse = z.object({ ok: z.boolean() });
export type AccountsDeleteRequest = z.infer<typeof AccountsDeleteRequest>;
export type AccountsDeleteResponse = z.infer<typeof AccountsDeleteResponse>;

export const AccountsGetLastRequest = z.object({});
export const AccountsGetLastResponse = z.object({
  account: AccountSummary.nullable(),
});
export type AccountsGetLastRequest = z.infer<typeof AccountsGetLastRequest>;
export type AccountsGetLastResponse = z.infer<typeof AccountsGetLastResponse>;

// Wipes the local scan cache (messages, folders, addresses, encrypted
// message bodies) but PRESERVES `accounts` so saved logins / encrypted
// password blobs survive — the user can immediately re-scan without
// re-entering credentials. Settings (last export dir, etc.) also survive.
export const CacheResetRequest = z.object({});
export const CacheResetResponse = z.object({ ok: z.boolean() });
export type CacheResetRequest = z.infer<typeof CacheResetRequest>;
export type CacheResetResponse = z.infer<typeof CacheResetResponse>;

// Reveals the local log file in the OS file manager (Finder / Explorer).
// No payload — main process resolves the path from electron-log itself
// and invokes shell.showItemInFolder. Useful as a one-click "grab the
// logs after a crash" action in the AppHeader.
export const AppShowLogsRequest = z.object({});
export const AppShowLogsResponse = z.object({ ok: z.boolean() });
export type AppShowLogsRequest = z.infer<typeof AppShowLogsRequest>;
export type AppShowLogsResponse = z.infer<typeof AppShowLogsResponse>;

