/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join } from 'node:path';
import { app, dialog, ipcMain, shell, type BrowserWindow } from 'electron';
import log from 'electron-log/main';
import { ZodError } from 'zod';
import {
  ACCOUNTS_DELETE,
  ACCOUNTS_GET_LAST,
  ACCOUNTS_LIST,
  APP_PING,
  APP_SHOW_LOGS,
  AccountSummary,
  AccountsDeleteRequest,
  AccountsDeleteResponse,
  AccountsGetLastRequest,
  AccountsGetLastResponse,
  AccountsListRequest,
  AccountsListResponse,
  AppPingResponse,
  AppShowLogsRequest,
  AppShowLogsResponse,
  CACHE_RESET,
  CacheResetRequest,
  CacheResetResponse,
  CONTACTS_LIST,
  ContactsListRequest,
  ContactsListResponse,
  DIALOG_SHOW_SAVE,
  DialogShowSaveRequest,
  DialogShowSaveResponse,
  EXPORT_GET_DEFAULT_DIR,
  EXPORT_RUN,
  ExportGetDefaultDirRequest,
  ExportGetDefaultDirResponse,
  ExportRunRequest,
  ExportRunResponse,
  FOLDERS_LIST,
  FoldersListRequest,
  FoldersListResponse,
  IMAP_CONNECT_SAVED,
  IMAP_TEST_CONNECTION,
  ImapConnectSavedRequest,
  ImapConnectSavedResponse,
  ImapTestConnectionRequest,
  ImapTestConnectionResponse,
  MESSAGES_FOR_ADDRESS,
  MessagesForAddressRequest,
  MessagesForAddressResponse,
  type MessageDrilldownRow,
  SCAN_CANCEL,
  SCAN_FILTER_PREFERENCES_CLEAR,
  SCAN_FILTER_PREFERENCES_GET,
  SCAN_FILTER_PREFERENCES_SAVE,
  SCAN_SNAPSHOT_UPDATED,
  SCAN_START,
  SCAN_SUBSCRIBE_PROGRESS,
  ScanCancelRequest,
  ScanCancelResponse,
  ScanFilterPreferencesClearRequest,
  ScanFilterPreferencesClearResponse,
  ScanFilterPreferencesGetRequest,
  ScanFilterPreferencesGetResponse,
  ScanFilterPreferencesSaveRequest,
  ScanFilterPreferencesSaveResponse,
  ScanFilterPreferencesV1,
  ScanSnapshotUpdatedResponse,
  ScanStartRequest,
  ScanStartResponse,
  SESSION_DISCONNECT,
  SessionDisconnectRequest,
  SessionDisconnectResponse,
} from '../../shared/ipc-contracts.js';
import { Credentials, revealSensitive, type ContactRow } from '../../shared/domain.js';
import { ImapClient } from '../imap/client.js';
import { isImapError } from '../imap/errors.js';
import { runScan } from '../pipeline/scan-runner.js';
import { makeElectronLoggerFrom } from '../pipeline/logger.js';
import {
  createMetricsCollector,
  describePlatform,
} from '../pipeline/metrics.js';
import {
  createWorkerParserPool,
  defaultWorkerScriptPath,
  type Parser,
} from '../pipeline/parser-pool.js';
import {
  createImapPool,
  type ImapConnectionPool,
} from '../imap/connection-pool.js';
import { cpus } from 'node:os';
import {
  readImapPoolSize,
  readParserPoolSize,
} from '../../shared/env-config.js';
import { runExport } from '../export/exporter.js';
import {
  listAddresses,
  type AddressRow,
} from '../db/addresses.repo.js';
import {
  listMessagesForContact,
  type MessageWithFolder,
} from '../db/messages.repo.js';
import { listFoldersByAccount } from '../db/folders.repo.js';
import { deleteSetting, getSetting, setSetting } from '../db/settings.repo.js';
import {
  clearPasswordBlob,
  deleteAccount,
  findAccountByHostUsername,
  getAccountById,
  getLastUsedWithPassword,
  getPasswordBlob,
  listAccounts,
  markLastUsed,
  setPasswordBlob,
  upsertAccount,
  type AccountRow,
} from '../db/accounts.repo.js';
import {
  CredentialEncryptionUnavailableError,
  electronSafeStorageCipher,
  type CredentialCipher,
} from '../security/safe-storage.js';
import * as session from './session.js';

function accountRowToSummary(a: AccountRow): AccountSummary {
  return AccountSummary.parse({
    id: a.id,
    host: a.host,
    username: a.username,
    protocol: a.protocol,
    port: a.port,
    tls: a.tls,
    hasPassword: a.hasPassword,
    lastUsedAt: a.lastUsedAt,
  });
}

// Single shared cipher instance — wraps Electron safeStorage. Decoupled
// behind a CredentialCipher interface so unit tests can substitute a fake.
const cipher: CredentialCipher = electronSafeStorageCipher;

// Soft cap on a single CONTACTS_LIST / EXPORT_RUN read. Kept high enough
// that real mailboxes never hit it; protects against a future bug that
// would otherwise stream 1M+ rows over IPC and stall the renderer.
const CONTACTS_HARD_LIMIT = 100_000;
// Drill-down ceiling: we ask the DB for one more than the cap so we can
// tell the renderer "the cap was hit, there may be more" without a
// second COUNT(*) round-trip.
const DRILLDOWN_CAP = 500;
const DRILLDOWN_FETCH_LIMIT = DRILLDOWN_CAP + 1;

function scanFilterPreferencesSettingKey(): `scan_filter_prefs:${string}` | null {
  if (!session.hasCredentials()) return null;
  const creds = session.getCredentials();
  const scope = `${creds.host.toLowerCase()}::${creds.username.toLowerCase()}`;
  return `scan_filter_prefs:${scope}`;
}

function persistCredentialsAfterTest(creds: Credentials, rememberMe: boolean): void {
  const db = session.db();
  if (!rememberMe) {
    // Honour user opt-out: drop any blob we may have previously stored for
    // this (host, username) so the bootstrap flow won't auto-resume into
    // a credential the user no longer wants persisted. We only clear the
    // blob (not the row) — the account stays in the saved-accounts list
    // with hasPassword=false, the user can re-tick "remember" any time.
    const existing = findAccountByHostUsername(db, creds.host, creds.username);
    if (existing && existing.hasPassword) {
      clearPasswordBlob(db, existing.id);
      log.info(`[ipc] cleared saved blob for account id=${existing.id} (rememberMe=false)`);
    }
    return;
  }
  if (!cipher.isAvailable()) {
    throw new CredentialEncryptionUnavailableError();
  }
  const blob = cipher.encrypt(revealSensitive(creds.password));
  const row = upsertAccount(db, {
    host: creds.host,
    username: creds.username,
    myAddresses: [],
    port: creds.port,
    tls: creds.tls,
    protocol: creds.protocol,
  });
  setPasswordBlob(db, row.id, blob);
  markLastUsed(db, row.id, Date.now());
  log.info(`[ipc] persisted credentials for account id=${row.id}`);
}

function decryptSavedAccount(
  db: import('../db/connection.js').Db,
  id: number,
  cipher: CredentialCipher,
): Credentials {
  const row = getAccountById(db, id);
  if (!row) throw new Error(`Saved account ${id} not found`);
  if (row.protocol === null || row.port === null || row.tls === null) {
    throw new Error('Saved account is missing connection metadata – please reconnect');
  }
  const blob = getPasswordBlob(db, id);
  if (!blob) throw new Error('Saved account has no stored credential');
  if (!cipher.isAvailable()) throw new CredentialEncryptionUnavailableError();
  const password = cipher.decrypt(blob);
  return Credentials.parse({
    protocol: row.protocol,
    host: row.host,
    port: row.port,
    tls: row.tls,
    username: row.username,
    password,
  });
}

function addressToContactRow(a: AddressRow): ContactRow {
  return {
    email: a.emailNormalized,
    firstSeenUtc: new Date(a.firstSeenUtc).toISOString(),
    lastSeenUtc: new Date(a.lastSeenUtc).toISOString(),
    countIn: a.countIn,
    countOut: a.countOut,
    total: a.countIn + a.countOut,
    subjectsSample: [...a.subjectsSample],
    displayNames: [...a.displayNames],
  };
}

function errorMessage(err: unknown): string {
  if (isImapError(err)) {
    const cause = err.cause;
    if (cause) {
      const causeMsg = cause instanceof Error ? cause.message : String(cause);
      const code =
        typeof cause === 'object' && cause !== null && 'code' in cause
          ? String((cause as { code?: unknown }).code)
          : null;
      return code ? `${err.message}: ${causeMsg} (${code})` : `${err.message}: ${causeMsg}`;
    }
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

function validationErrorSummary(err: unknown): string {
  if (err instanceof ZodError) {
    return err.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
        return `${path}: ${issue.message}`;
      })
      .join('; ');
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

async function testImap(creds: Credentials): Promise<{ capabilities: string[] }> {
  // Username is intentionally omitted from the log per CLAUDE.md §6 —
  // logs are persisted on disk and email addresses are PII.
  log.info(
    `[ipc] testConnection IMAP host=${creds.host}:${creds.port} tls=${creds.tls}`,
  );
  const probe = new ImapClient();
  try {
    await probe.connect(creds);
    await probe.disconnect();
    return { capabilities: ['IMAP4rev1'] };
  } catch (err) {
    try {
      await probe.disconnect();
    } catch {
      /* ignore */
    }
    throw err;
  }
}

export function registerIpcHandlers(getMainWindow: () => BrowserWindow | null): void {
  log.info('[ipc] registering handlers');
  registerAppHandlers();
  registerConnectionHandlers();
  registerAccountHandlers();
  registerScanPreferenceHandlers();
  registerFolderHandlers();
  registerScanHandlers(getMainWindow);
  registerMessageHandlers();
  registerExportHandlers(getMainWindow);
  registerCacheHandlers();
}

// Account-scoped filter preference persistence for the Scan screen.
// Versioned payload lives in settings; only filter knobs are stored.
function registerScanPreferenceHandlers(): void {
  ipcMain.handle(SCAN_FILTER_PREFERENCES_GET, async (_evt, raw) => {
    ScanFilterPreferencesGetRequest.parse(raw);
    const key = scanFilterPreferencesSettingKey();
    if (key === null) {
      return ScanFilterPreferencesGetResponse.parse({ preferences: null });
    }
    const stored = getSetting(session.db(), key);
    if (stored === null) {
      return ScanFilterPreferencesGetResponse.parse({ preferences: null });
    }
    try {
      const parsed = ScanFilterPreferencesV1.parse(JSON.parse(stored));
      return ScanFilterPreferencesGetResponse.parse({ preferences: parsed });
    } catch (err) {
      log.warn(
        `[ipc] scan.filterPreferences.get ignored malformed persisted preferences key=${key}: ${validationErrorSummary(err)}`,
      );
      return ScanFilterPreferencesGetResponse.parse({ preferences: null });
    }
  });

  ipcMain.handle(SCAN_FILTER_PREFERENCES_SAVE, async (_evt, raw) => {
    let req: ScanFilterPreferencesSaveRequest;
    try {
      req = ScanFilterPreferencesSaveRequest.parse(raw);
    } catch (err) {
      log.warn(
        `[ipc] scan.filterPreferences.save rejected invalid request payload: ${validationErrorSummary(err)}`,
      );
      throw err;
    }
    const key = scanFilterPreferencesSettingKey();
    if (key === null) {
      throw new Error('scan.filterPreferences.save requires an active session');
    }
    const preferences = ScanFilterPreferencesV1.parse(req.preferences);
    setSetting(session.db(), key, JSON.stringify(preferences));
    return ScanFilterPreferencesSaveResponse.parse({ ok: true });
  });

  ipcMain.handle(SCAN_FILTER_PREFERENCES_CLEAR, async (_evt, raw) => {
    ScanFilterPreferencesClearRequest.parse(raw);
    const key = scanFilterPreferencesSettingKey();
    if (key === null) {
      return ScanFilterPreferencesClearResponse.parse({ ok: true });
    }
    deleteSetting(session.db(), key);
    return ScanFilterPreferencesClearResponse.parse({ ok: true });
  });
}

// app-level health check. Trivial; lives at the top because it has no
// dependencies on session state.
function registerAppHandlers(): void {
  ipcMain.handle(APP_PING, () => AppPingResponse.parse({ message: 'pong from main' }));

  // Reveals the rotating log file in Finder / Explorer so the user can
  // grab it for a bug report after a crash. We resolve the path from
  // electron-log itself and use `showItemInFolder` (highlights the file
  // without opening it) — safer than `openPath` which would launch the
  // user's default text editor on a potentially huge file.
  ipcMain.handle(APP_SHOW_LOGS, async (_evt, raw) => {
    AppShowLogsRequest.parse(raw);
    const file = log.transports.file.getFile();
    log.info(`[ipc] app.showLogs path=${file.path}`);
    shell.showItemInFolder(file.path);
    return AppShowLogsResponse.parse({ ok: true });
  });
}

// Connection lifecycle: testing fresh credentials, reconnecting via a
// saved blob, and disconnecting the active session. None of these touch
// the renderer window.
function registerConnectionHandlers(): void {
  ipcMain.handle(IMAP_TEST_CONNECTION, async (_evt, raw) => {
    log.info('[ipc] testConnection invoked');
    let parsed: ImapTestConnectionRequest;
    try {
      parsed = ImapTestConnectionRequest.parse(raw);
    } catch (err) {
      log.error('[ipc] testConnection bad payload', err);
      return ImapTestConnectionResponse.parse({
        ok: false,
        error: `Invalid request: ${errorMessage(err)}`,
      });
    }
    const { rememberMe, ...creds } = parsed;
    try {
      const { capabilities } = await testImap(creds);
      session.setCredentials(creds);
      // Persist creds only after we've confirmed they actually work, and
      // only if the user opted in. Encryption errors (e.g. transient
      // safeStorage unavailability) are logged but never block the user
      // from continuing — the in-memory session is what powers the scan.
      try {
        persistCredentialsAfterTest(creds, rememberMe);
      } catch (err) {
        log.warn(
          `[ipc] testConnection: credential persistence failed: ${errorMessage(err)}`,
          err,
        );
      }
      log.info(
        `[ipc] testConnection ok (${creds.protocol}) rememberMe=${rememberMe}`,
      );
      return ImapTestConnectionResponse.parse({ ok: true, capabilities });
    } catch (err) {
      const msg = errorMessage(err);
      log.warn(`[ipc] testConnection failed (${creds.protocol}): ${msg}`, err);
      return ImapTestConnectionResponse.parse({ ok: false, error: msg });
    }
  });

  ipcMain.handle(SESSION_DISCONNECT, async (_evt, raw) => {
    SessionDisconnectRequest.parse(raw);
    log.info('[ipc] session.disconnect');
    await session.disconnect();
    return SessionDisconnectResponse.parse({ ok: true });
  });

  ipcMain.handle(IMAP_CONNECT_SAVED, async (_evt, raw) => {
    let req: ImapConnectSavedRequest;
    try {
      req = ImapConnectSavedRequest.parse(raw);
    } catch (err) {
      log.error('[ipc] connectSaved bad payload', err);
      return ImapConnectSavedResponse.parse({
        ok: false,
        error: `Invalid request: ${errorMessage(err)}`,
      });
    }
    log.info(`[ipc] connectSaved id=${req.accountId}`);
    try {
      const creds = decryptSavedAccount(session.db(), req.accountId, cipher);
      const { capabilities } = await testImap(creds);
      session.setCredentials(creds);
      markLastUsed(session.db(), req.accountId, Date.now());
      return ImapConnectSavedResponse.parse({ ok: true, capabilities });
    } catch (err) {
      const msg = errorMessage(err);
      log.warn(`[ipc] connectSaved failed: ${msg}`, err);
      return ImapConnectSavedResponse.parse({ ok: false, error: msg });
    }
  });
}

// Saved-account metadata for the connect screen. The password blob
// itself is never exposed — the renderer sees only `hasPassword: boolean`
// and reconnects via the connectSaved handler above, which decrypts in
// main.
function registerAccountHandlers(): void {
  ipcMain.handle(ACCOUNTS_LIST, async (_evt, raw) => {
    AccountsListRequest.parse(raw);
    const rows = listAccounts(session.db());
    return AccountsListResponse.parse({
      accounts: rows.map(accountRowToSummary),
    });
  });

  ipcMain.handle(ACCOUNTS_DELETE, async (_evt, raw) => {
    const { id } = AccountsDeleteRequest.parse(raw);
    log.info(`[ipc] accounts.delete id=${id}`);
    deleteAccount(session.db(), id);
    return AccountsDeleteResponse.parse({ ok: true });
  });

  ipcMain.handle(ACCOUNTS_GET_LAST, async (_evt, raw) => {
    AccountsGetLastRequest.parse(raw);
    const row = getLastUsedWithPassword(session.db());
    return AccountsGetLastResponse.parse({
      account: row ? accountRowToSummary(row) : null,
    });
  });
}

// Folder listing — only used by the Scan screen's pre-flight, but lives
// in its own group so the relationship to FOLDERS_LIST is obvious.
function registerFolderHandlers(): void {
  ipcMain.handle(FOLDERS_LIST, async (_evt, raw) => {
    log.info('[ipc] folders.list invoked');
    FoldersListRequest.parse(raw);
    if (session.hasCredentials() && session.getCredentials().protocol !== 'imap') {
      throw new Error('folders.list requires an IMAP session');
    }
    const client = await session.ensureClient();
    const folders = await client.listFolders();
    log.info(`[ipc] folders.list returned ${folders.length} folders`);
    return FoldersListResponse.parse({ folders });
  });
}

// Scan lifecycle: start (long-running, with progress + snapshot pushes
// back to the renderer window) and cancel.
function registerScanHandlers(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle(SCAN_START, async (_evt, raw) => {
    const { options } = ScanStartRequest.parse(raw);
    if (session.getCredentials().protocol !== 'imap') {
      throw new Error('scan requires an IMAP session');
    }
    const runId = randomUUID();
    const controller = new AbortController();
    session.registerScan(runId, controller);
    const selectedFoldersCount = options.folderInclude?.length ?? 'all';
    const optionsForLog = {
      parseBodies: options.parseBodies,
      directionMode: options.directionMode,
      minMessagesTotal: options.minMessages,
      includeDomains: options.includeDomains,
      excludeDomains: options.excludeDomains,
      automationLocalParts: options.automationLocalParts,
      wordFilters: {
        inbound: {
          include: options.includeWordsInbound,
          exclude: options.excludeWordsInbound,
        },
        outbound: {
          include: options.includeWordsOutbound,
          exclude: options.excludeWordsOutbound,
        },
      },
    };
    log.info(
      `[ipc] scan.start runId=${runId}` +
        ` folders=${selectedFoldersCount}` +
        ` options=${JSON.stringify(optionsForLog)}`,
    );
    // Build the pipeline logger early so the parser pool (created
    // outside the inner try/finally) can route its diagnostic
    // `parser-worker-ready` pings through electron-log too.
    const pipelineLogger = makeElectronLoggerFrom(runId, log);
    // Worker-thread parser pool for the deep-scan body pass. Default
    // OFF (PARSER_POOL_SIZE=0) — on asar-packaged builds we've seen the
    // workers silently fail to return their parse replies, leaving the
    // scan hung at `processed=0` while bodies queue indefinitely. The
    // inline parser path (Phase A baseline) is proven on every build
    // we've shipped. Enable the pool with `PARSER_POOL_SIZE=4` (or any
    // 1..8) in environments where workers are known to work — typically
    // an unpacked dev build (`npm run dev`).
    let pipelineParser: Parser | undefined;
    if (options.parseBodies) {
      const poolSize = readParserPoolSize();
      if (poolSize === 0) {
        log.info('[ipc] scan.start parser=inline (PARSER_POOL_SIZE=0)');
      } else {
        const cpuCount = cpus().length;
        try {
          pipelineParser = createWorkerParserPool(
            poolSize,
            defaultWorkerScriptPath(import.meta.url),
            pipelineLogger,
          );
          log.info(
            `[ipc] scan.start parser-pool size=${poolSize} (cpus=${cpuCount})`,
          );
        } catch (err) {
          // Worker spin-up failed (missing parser-worker.js after a bad
          // build, sandbox policy, etc.). Degrade to inline parsing —
          // body-scan's default — so the scan still runs.
          log.warn(
            `[ipc] scan.start parser-pool unavailable, falling back to inline parser: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          pipelineParser = undefined;
        }
      }
    }
    // IMAP connection pool for parallel folder fetch. Pool size comes
    // from `IMAP_POOL_SIZE` env (default 2, see src/shared/env-config.ts).
    // Spin-up failure falls back to serialised ingest on
    // session.ensureClient() — same shape as 0.1.x.
    let pipelineImapPool: ImapConnectionPool | undefined;
    {
      const poolSize = readImapPoolSize();
      try {
        pipelineImapPool = await createImapPool({
          size: poolSize,
          credentials: session.getCredentials(),
          signal: controller.signal,
        });
        log.info(`[ipc] scan.start imap-pool size=${poolSize}`);
      } catch (err) {
        log.warn(
          `[ipc] scan.start imap-pool unavailable, falling back to single connection: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        pipelineImapPool = undefined;
      }
    }
    try {
      // Always materialise a session client too — folders.list / cancel
      // / non-pool callers expect `session.ensureClient()` to work
      // during the scan. The pool's connections are owned by the pool
      // and torn down in this handler's `finally`.
      const client = await session.ensureClient();
      // pipelineLogger is created earlier so the parser pool can route
      // its `parser-worker-ready` diagnostic pings through electron-log
      // before the runScan-side instrumentation kicks in. Reused here.
      // In-memory metrics collector: never flushed to disk in production,
      // but its snapshot drives the `summary` log line at the end of the
      // run (otherwise that line shows zeros — every phase records into
      // NOOP_METRICS which has an empty snapshot). Cost is negligible —
      // hundreds of records per run, all in-memory, dropped on return.
      const pipelineMetrics = createMetricsCollector({
        version: app.getVersion(),
        commit: 'live',
        startedAt: new Date().toISOString(),
        runId,
        scenario: 'live',
        platform: describePlatform(),
        options: {
          parseBodies: options.parseBodies,
          directionMode: options.directionMode,
          minMessages: options.minMessages,
          folderInclude: options.folderInclude?.length ?? 0,
        },
      });
      const result = await runScan(
        {
          runId,
          credentials: session.getCredentials(),
          options,
          onProgress: (p) => {
            const win = getMainWindow();
            win?.webContents.send(SCAN_SUBSCRIBE_PROGRESS, { ...p, runId });
          },
          onSnapshot: (rows) => {
            const win = getMainWindow();
            const payload = ScanSnapshotUpdatedResponse.parse({
              runId,
              contacts: rows.map(addressToContactRow),
            });
            win?.webContents.send(SCAN_SNAPSHOT_UPDATED, payload);
          },
          signal: controller.signal,
        },
        {
          db: session.db(),
          client,
          log: pipelineLogger,
          metrics: pipelineMetrics,
          ...(pipelineParser ? { parser: pipelineParser } : {}),
          ...(pipelineImapPool ? { pool: pipelineImapPool } : {}),
        },
      );
      log.info(`[ipc] scan.start done runId=${runId} contacts=${result.contactsCount}`);
      return ScanStartResponse.parse({
        runId,
        contactsCount: result.contactsCount,
      });
    } catch (err) {
      log.error(
        `[ipc] scan.start failed runId=${runId}: ${
          err instanceof Error ? err.stack ?? err.message : String(err)
        }`,
        err,
      );
      throw err;
    } finally {
      session.clearScan(runId);
      if (pipelineParser) {
        try {
          await pipelineParser.close();
        } catch (err) {
          log.warn(
            `[ipc] scan.start parser-pool close error: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
      if (pipelineImapPool) {
        try {
          await pipelineImapPool.close();
        } catch (err) {
          log.warn(
            `[ipc] scan.start imap-pool close error: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    }
  });

  ipcMain.handle(SCAN_CANCEL, async (_evt, raw) => {
    const { runId } = ScanCancelRequest.parse(raw);
    log.info(`[ipc] scan.cancel runId=${runId}`);
    return ScanCancelResponse.parse({ ok: session.cancelScan(runId) });
  });
}

// Read paths into the addresses + messages tables for the Results screen
// and drill-down. No mutation; safe to call any number of times.
function registerMessageHandlers(): void {
  ipcMain.handle(CONTACTS_LIST, async (_evt, raw) => {
    const req = ContactsListRequest.parse(raw);
    const filter: { query?: string; domains?: readonly string[] } = {};
    if (req.filter?.query !== undefined) filter.query = req.filter.query;
    if (req.filter?.domains !== undefined) filter.domains = req.filter.domains;
    // Scope every listing to the currently-connected account. Without a
    // session (e.g. between disconnect and re-login) there's nothing to
    // show; return an empty page rather than leak the previous account's
    // addresses table contents.
    const creds = session.hasCredentials() ? session.getCredentials() : null;
    if (creds === null) {
      return ContactsListResponse.parse({ rows: [], total: 0 });
    }
    const account = findAccountByHostUsername(session.db(), creds.host, creds.username);
    if (account === null) {
      return ContactsListResponse.parse({ rows: [], total: 0 });
    }
    const all = listAddresses(session.db(), account.id, filter, {
      offset: 0,
      limit: CONTACTS_HARD_LIMIT,
    });
    const kept = all.rows.filter((a) => a.tags.includes('kept'));
    const offset = req.pagination.offset;
    const limit = req.pagination.limit;
    const sliced = kept.slice(offset, offset + limit);
    return ContactsListResponse.parse({
      rows: sliced.map(addressToContactRow),
      total: kept.length,
    });
  });

  ipcMain.handle(MESSAGES_FOR_ADDRESS, async (_evt, raw) => {
    const req = MessagesForAddressRequest.parse(raw);
    const creds = session.getCredentials();
    const db = session.db();
    const account = findAccountByHostUsername(db, creds.host, creds.username);
    if (!account) throw new Error('No active account session');
    // Translate folder paths from the renderer (which knows them by name)
    // into the folder IDs the SQL helper needs. Drops paths that no longer
    // map to a cached folder row — defensive against stale renderer state
    // after a folder rename / cache reset. Empty / omitted = unscoped.
    let folderIds: ReadonlySet<number> | undefined;
    if (req.folderInclude && req.folderInclude.length > 0) {
      const allFolders = listFoldersByAccount(db, account.id);
      const wanted = new Set(req.folderInclude);
      folderIds = new Set(
        allFolders.filter((f) => wanted.has(f.path)).map((f) => f.id),
      );
    }
    // Fetch one extra row over the cap so we can tell the renderer "more
    // exist, list was truncated" without a second COUNT(*) round-trip.
    // Then JS-dedup by message_id (Gmail All-Mail can return the same
    // message under multiple folders) and slice to the cap.
    const fetched = listMessagesForContact(
      db,
      account.id,
      req.email,
      DRILLDOWN_FETCH_LIMIT,
      folderIds,
    );
    const truncated = fetched.length > DRILLDOWN_CAP;
    const seen = new Set<string>();
    const dedup: MessageWithFolder[] = [];
    for (const r of fetched) {
      if (r.messageId !== null) {
        if (seen.has(r.messageId)) continue;
        seen.add(r.messageId);
      }
      dedup.push(r);
      if (dedup.length >= DRILLDOWN_CAP) break;
    }
    const rows: MessageDrilldownRow[] = dedup.map((m) => ({
      folder: m.folderPath,
      uid: m.uid,
      dateUtc: m.dateUtc !== null ? new Date(m.dateUtc).toISOString() : null,
      subject: m.subject,
      // SQL already excludes 'self' — assert via narrowing.
      direction: m.direction === 'in' ? 'in' : 'out',
      fromAddr: m.fromAddr,
      fromName: m.fromName,
      hasListUnsubscribe: m.hasListUnsubscribe,
      hasListId: m.hasListId,
      hasInlineUnsubscribe: m.hasInlineUnsubscribe,
      autoSubmitted: m.autoSubmitted,
      precedence: m.precedence,
    }));
    log.info(`[ipc] messages.forAddress returned ${rows.length} rows (truncated=${truncated})`);
    return MessagesForAddressResponse.parse({ rows, truncated });
  });
}

// File export: writing the contacts table to xlsx/csv, retrieving the
// last-used directory, and the native save dialog. The dialog handler
// needs the main BrowserWindow to anchor the modal correctly.
function registerExportHandlers(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle(EXPORT_RUN, async (_evt, raw) => {
    const options = ExportRunRequest.parse(raw);
    // Don't log filePath — it can include the user's home directory and
    // file-naming patterns that leak structure. Format + column count is
    // enough for diagnostics.
    log.info(
      `[ipc] export.run format=${options.format} cols=${options.columns.length}`,
    );
    const creds = session.getCredentials();
    const account = findAccountByHostUsername(session.db(), creds.host, creds.username);
    if (account === null) {
      throw new Error('export.run: no active account session');
    }
    const all = listAddresses(session.db(), account.id, {}, {
      offset: 0,
      limit: CONTACTS_HARD_LIMIT,
    });
    const kept = all.rows.filter((a) => a.tags.includes('kept'));
    const contactRows = kept.map(addressToContactRow);
    const result = await runExport(contactRows, options);
    log.info(`[ipc] export.run wrote ${result.rowsExported} rows`);
    // Remember where the user just exported to, so the next save dialog
    // opens in the same directory. Best-effort — failure here MUST NOT
    // block the export response the renderer is waiting on.
    try {
      setSetting(session.db(), 'default_export_dir', dirname(result.filePath));
    } catch (err) {
      log.warn('[ipc] export.run: could not persist default_export_dir', err);
    }
    return ExportRunResponse.parse({
      ok: true,
      filePath: result.filePath,
      rowsExported: result.rowsExported,
    });
  });

  ipcMain.handle(EXPORT_GET_DEFAULT_DIR, async (_evt, raw) => {
    ExportGetDefaultDirRequest.parse(raw);
    const stored = getSetting(session.db(), 'default_export_dir');
    const dir = stored ?? app.getPath('downloads');
    return ExportGetDefaultDirResponse.parse({ dir });
  });

  ipcMain.handle(DIALOG_SHOW_SAVE, async (_evt, raw) => {
    const req = DialogShowSaveRequest.parse(raw);
    const win = getMainWindow();
    const opts: Electron.SaveDialogOptions = {};
    // Pre-fill the directory: when the renderer passes only a bare
    // suggested filename (no path separator), resolve it against the
    // user's last-used export directory, falling back to ~/Downloads.
    // If the renderer passed an absolute path, respect it as-is.
    if (req.defaultPath !== undefined) {
      if (isAbsolute(req.defaultPath)) {
        opts.defaultPath = req.defaultPath;
      } else {
        const stored = getSetting(session.db(), 'default_export_dir');
        const dir = stored ?? app.getPath('downloads');
        opts.defaultPath = join(dir, req.defaultPath);
      }
    }
    if (req.filters !== undefined)
      opts.filters = req.filters.map((f) => ({
        name: f.name,
        extensions: [...f.extensions],
      }));
    const result = win
      ? await dialog.showSaveDialog(win, opts)
      : await dialog.showSaveDialog(opts);
    const response: { canceled: boolean; filePath?: string } = {
      canceled: result.canceled,
    };
    if (result.filePath !== undefined) response.filePath = result.filePath;
    return DialogShowSaveResponse.parse(response);
  });
}

// Wipes scan cache rows in one transaction. Accounts (and their saved
// password blobs) plus settings stay intact so the user can re-scan
// immediately without reconnecting. ON DELETE CASCADE on
// message_bodies(message_id) means clearing messages also drops bodies,
// but we DELETE explicitly anyway in case the cascade ever changes.
function registerCacheHandlers(): void {
  ipcMain.handle(CACHE_RESET, async (_evt, raw) => {
    CacheResetRequest.parse(raw);
    log.info('[ipc] cache.reset');
    const db = session.db();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec('DELETE FROM message_bodies');
      db.exec('DELETE FROM messages');
      db.exec('DELETE FROM folders');
      db.exec('DELETE FROM addresses');
      db.exec('COMMIT');
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* ignore */
      }
      log.error('[ipc] cache.reset failed', err);
      throw err;
    }
    return CacheResetResponse.parse({ ok: true });
  });
}
