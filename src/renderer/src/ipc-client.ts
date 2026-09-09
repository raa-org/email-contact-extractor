/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import {
  AccountsDeleteRequest,
  AccountsDeleteResponse,
  AccountsGetLastResponse,
  AccountsListResponse,
  AppShowLogsResponse,
  CacheResetResponse,
  ContactsListRequest,
  ContactsListResponse,
  type MessageDrilldownRow,
  MessagesForAddressRequest,
  MessagesForAddressResponse,
  DialogShowSaveRequest,
  DialogShowSaveResponse,
  ExportGetDefaultDirResponse,
  ExportRunRequest,
  ExportRunResponse,
  FoldersListResponse,
  ImapConnectSavedRequest,
  ImapConnectSavedResponse,
  ImapTestConnectionRequest,
  ImapTestConnectionResponse,
  ScanCancelRequest,
  ScanCancelResponse,
  ScanFilterPreferencesClearResponse,
  ScanFilterPreferencesGetResponse,
  ScanFilterPreferencesSaveRequest,
  ScanFilterPreferencesSaveResponse,
  type ScanFilterPreferencesV1,
  ScanSnapshotUpdatedResponse,
  ScanStartRequest,
  ScanStartResponse,
  ScanSubscribeProgressResponse,
  SessionDisconnectResponse,
  type AccountSummary,
} from '../../shared/ipc-contracts.js';
import type {
  ContactRow,
  Credentials,
  ExportOptions,
  FolderInfo,
  ScanOptions,
  ScanProgress,
} from '../../shared/domain.js';

// Renderer-side typed wrapper. Validates every request and response
// against the same zod schemas main uses.

export async function testConnection(
  credentials: Credentials,
  rememberMe: boolean,
): Promise<{ ok: true; capabilities: string[] } | { ok: false; error: string }> {
  const validated = ImapTestConnectionRequest.parse({ ...credentials, rememberMe });
  const raw = await window.api.imap.testConnection(validated);
  const parsed = ImapTestConnectionResponse.parse(raw);
  return parsed.ok
    ? { ok: true, capabilities: [...parsed.capabilities] }
    : { ok: false, error: parsed.error };
}

export async function connectSavedAccount(
  accountId: number,
): Promise<{ ok: true; capabilities: string[] } | { ok: false; error: string }> {
  const validated = ImapConnectSavedRequest.parse({ accountId });
  const raw = await window.api.imap.connectSaved(validated);
  const parsed = ImapConnectSavedResponse.parse(raw);
  return parsed.ok
    ? { ok: true, capabilities: [...parsed.capabilities] }
    : { ok: false, error: parsed.error };
}

export async function listAccounts(): Promise<readonly AccountSummary[]> {
  const raw = await window.api.accounts.list();
  return AccountsListResponse.parse(raw).accounts;
}

export async function deleteAccount(id: number): Promise<{ ok: boolean }> {
  const validated = AccountsDeleteRequest.parse({ id });
  const raw = await window.api.accounts.delete(validated);
  return AccountsDeleteResponse.parse(raw);
}

export async function getLastAccount(): Promise<AccountSummary | null> {
  const raw = await window.api.accounts.getLast();
  return AccountsGetLastResponse.parse(raw).account;
}

export async function listFolders(): Promise<readonly FolderInfo[]> {
  const raw = await window.api.folders.list();
  return FoldersListResponse.parse(raw).folders;
}

export async function scanStart(
  options: ScanOptions,
): Promise<{ runId: string; contactsCount: number }> {
  const validated = ScanStartRequest.parse({ options });
  const raw = await window.api.scan.start(validated);
  return ScanStartResponse.parse(raw);
}

export async function scanCancel(runId: string): Promise<{ ok: boolean }> {
  const validated = ScanCancelRequest.parse({ runId });
  const raw = await window.api.scan.cancel(validated);
  return ScanCancelResponse.parse(raw);
}

export function onScanProgress(
  cb: (payload: ScanProgress & { runId: string }) => void,
): () => void {
  return window.api.scan.onProgress((raw) => {
    const parsed = ScanSubscribeProgressResponse.parse(raw);
    cb(parsed);
  });
}

export function onScanSnapshotUpdated(
  cb: (payload: { runId: string; contacts: readonly ContactRow[] }) => void,
): () => void {
  return window.api.scan.onSnapshotUpdated((raw) => {
    const parsed = ScanSnapshotUpdatedResponse.parse(raw);
    cb(parsed);
  });
}

export async function listContacts(
  filter: { query?: string },
  pagination: { offset: number; limit: number },
): Promise<{ rows: readonly ContactRow[]; total: number }> {
  const requestObj: { filter?: { query: string }; pagination: { offset: number; limit: number } } = {
    pagination,
  };
  if (filter.query) requestObj.filter = { query: filter.query };
  const validated = ContactsListRequest.parse(requestObj);
  const raw = await window.api.contacts.list(validated);
  return ContactsListResponse.parse(raw);
}

export async function listMessagesForAddress(
  email: string,
  folderInclude?: readonly string[] | null,
): Promise<{ rows: readonly MessageDrilldownRow[]; truncated: boolean }> {
  const requestObj: { email: string; folderInclude?: string[] } = { email };
  if (folderInclude && folderInclude.length > 0) {
    requestObj.folderInclude = [...folderInclude];
  }
  const validated = MessagesForAddressRequest.parse(requestObj);
  const raw = await window.api.messages.forAddress(validated);
  return MessagesForAddressResponse.parse(raw);
}

export async function runExport(
  options: ExportOptions,
): Promise<{ ok: boolean; filePath: string; rowsExported: number }> {
  const validated = ExportRunRequest.parse(options);
  const raw = await window.api.export.run(validated);
  return ExportRunResponse.parse(raw);
}

export async function getDefaultExportDir(): Promise<string> {
  const raw = await window.api.export.getDefaultDir();
  return ExportGetDefaultDirResponse.parse(raw).dir;
}

export async function showSaveDialog(req: {
  defaultPath?: string;
  filters?: ReadonlyArray<{ name: string; extensions: readonly string[] }>;
}): Promise<{ canceled: boolean; filePath?: string }> {
  const validatedReq: { defaultPath?: string; filters?: { name: string; extensions: string[] }[] } = {};
  if (req.defaultPath !== undefined) validatedReq.defaultPath = req.defaultPath;
  if (req.filters !== undefined)
    validatedReq.filters = req.filters.map((f) => ({ name: f.name, extensions: [...f.extensions] }));
  const validated = DialogShowSaveRequest.parse(validatedReq);
  const raw = await window.api.dialog.showSave(validated);
  const parsed = DialogShowSaveResponse.parse(raw);
  const result: { canceled: boolean; filePath?: string } = { canceled: parsed.canceled };
  if (parsed.filePath !== undefined) result.filePath = parsed.filePath;
  return result;
}

export async function disconnectSession(): Promise<{ ok: boolean }> {
  const raw = await window.api.session.disconnect();
  return SessionDisconnectResponse.parse(raw);
}

export async function showLogs(): Promise<{ ok: boolean }> {
  const raw = await window.api.app.showLogs();
  return AppShowLogsResponse.parse(raw);
}

export async function resetCache(): Promise<{ ok: boolean }> {
  const raw = await window.api.cache.reset();
  return CacheResetResponse.parse(raw);
}

export async function getScanFilterPreferences(): Promise<ScanFilterPreferencesV1 | null> {
  const raw = await window.api.scanPreferences.get();
  return ScanFilterPreferencesGetResponse.parse(raw).preferences;
}

export async function saveScanFilterPreferences(
  preferences: ScanFilterPreferencesV1,
): Promise<{ ok: boolean }> {
  const validated = ScanFilterPreferencesSaveRequest.parse({ preferences });
  const raw = await window.api.scanPreferences.save(validated);
  return ScanFilterPreferencesSaveResponse.parse(raw);
}

export async function clearScanFilterPreferences(): Promise<{ ok: boolean }> {
  const raw = await window.api.scanPreferences.clear();
  return ScanFilterPreferencesClearResponse.parse(raw);
}
