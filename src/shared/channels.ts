/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

// IPC channel names — kept in a zero-dependency module so the sandboxed
// preload script can bundle them inline without pulling in zod.
// ipc-contracts.ts re-exports these for convenience.

export const APP_PING = 'app.ping' as const;
export const IMAP_TEST_CONNECTION = 'imap.testConnection' as const;
export const IMAP_CONNECT_SAVED = 'imap.connectSaved' as const;
export const SCAN_START = 'scan.start' as const;
export const SCAN_CANCEL = 'scan.cancel' as const;
export const SCAN_SUBSCRIBE_PROGRESS = 'scan.subscribeProgress' as const;
export const SCAN_SNAPSHOT_UPDATED = 'scan.snapshotUpdated' as const;
export const SCAN_FILTER_PREFERENCES_GET = 'scan.filterPreferences.get' as const;
export const SCAN_FILTER_PREFERENCES_SAVE = 'scan.filterPreferences.save' as const;
export const SCAN_FILTER_PREFERENCES_CLEAR = 'scan.filterPreferences.clear' as const;
export const CONTACTS_LIST = 'contacts.list' as const;
export const MESSAGES_FOR_ADDRESS = 'messages.forAddress' as const;
export const EXPORT_RUN = 'export.run' as const;
export const EXPORT_GET_DEFAULT_DIR = 'export.getDefaultDir' as const;
export const FOLDERS_LIST = 'folders.list' as const;
export const DIALOG_SHOW_SAVE = 'dialog.showSave' as const;
export const SESSION_DISCONNECT = 'session.disconnect' as const;
export const ACCOUNTS_LIST = 'accounts.list' as const;
export const ACCOUNTS_DELETE = 'accounts.delete' as const;
export const ACCOUNTS_GET_LAST = 'accounts.getLast' as const;
export const CACHE_RESET = 'cache.reset' as const;
export const APP_SHOW_LOGS = 'app.showLogs' as const;

export const channels = {
  appPing: APP_PING,
  imapTestConnection: IMAP_TEST_CONNECTION,
  imapConnectSaved: IMAP_CONNECT_SAVED,
  scanStart: SCAN_START,
  scanCancel: SCAN_CANCEL,
  scanSubscribeProgress: SCAN_SUBSCRIBE_PROGRESS,
  scanSnapshotUpdated: SCAN_SNAPSHOT_UPDATED,
  scanFilterPreferencesGet: SCAN_FILTER_PREFERENCES_GET,
  scanFilterPreferencesSave: SCAN_FILTER_PREFERENCES_SAVE,
  scanFilterPreferencesClear: SCAN_FILTER_PREFERENCES_CLEAR,
  contactsList: CONTACTS_LIST,
  messagesForAddress: MESSAGES_FOR_ADDRESS,
  exportRun: EXPORT_RUN,
  exportGetDefaultDir: EXPORT_GET_DEFAULT_DIR,
  foldersList: FOLDERS_LIST,
  dialogShowSave: DIALOG_SHOW_SAVE,
  sessionDisconnect: SESSION_DISCONNECT,
  accountsList: ACCOUNTS_LIST,
  accountsDelete: ACCOUNTS_DELETE,
  accountsGetLast: ACCOUNTS_GET_LAST,
  cacheReset: CACHE_RESET,
  appShowLogs: APP_SHOW_LOGS,
} as const;

export type ChannelName = (typeof channels)[keyof typeof channels];
