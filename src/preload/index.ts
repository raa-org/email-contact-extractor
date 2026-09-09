/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
// IMPORTANT: only import from a zero-dependency module. Sandboxed preload
// scripts cannot require() npm packages at runtime, so any transitive
// import of zod (or anything else from node_modules) breaks the bundle.
import { channels } from '../shared/channels.js';

type Unsubscribe = () => void;

function logged<T extends unknown[], R>(
  name: string,
  fn: (...args: T) => Promise<R>,
): (...args: T) => Promise<R> {
  return async (...args) => {
    // eslint-disable-next-line no-console
    console.log(`[preload] -> ${name}`);
    try {
      const result = await fn(...args);
      // eslint-disable-next-line no-console
      console.log(`[preload] <- ${name} ok`);
      return result;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[preload] <- ${name} err`, err);
      throw err;
    }
  };
}

const api = {
  ping: logged('ping', () => ipcRenderer.invoke(channels.appPing)),
  imap: {
    testConnection: logged('imap.testConnection', (req: unknown) =>
      ipcRenderer.invoke(channels.imapTestConnection, req),
    ),
    connectSaved: logged('imap.connectSaved', (req: unknown) =>
      ipcRenderer.invoke(channels.imapConnectSaved, req),
    ),
  },
  folders: {
    list: logged('folders.list', () => ipcRenderer.invoke(channels.foldersList, {})),
  },
  scan: {
    start: logged('scan.start', (req: unknown) => ipcRenderer.invoke(channels.scanStart, req)),
    cancel: logged('scan.cancel', (req: unknown) =>
      ipcRenderer.invoke(channels.scanCancel, req),
    ),
    onProgress: (cb: (payload: unknown) => void): Unsubscribe => {
      const listener = (_e: IpcRendererEvent, payload: unknown): void => cb(payload);
      ipcRenderer.on(channels.scanSubscribeProgress, listener);
      return () => {
        ipcRenderer.removeListener(channels.scanSubscribeProgress, listener);
      };
    },
    onSnapshotUpdated: (cb: (payload: unknown) => void): Unsubscribe => {
      const listener = (_e: IpcRendererEvent, payload: unknown): void => cb(payload);
      ipcRenderer.on(channels.scanSnapshotUpdated, listener);
      return () => {
        ipcRenderer.removeListener(channels.scanSnapshotUpdated, listener);
      };
    },
  },
  scanPreferences: {
    get: logged('scan.filterPreferences.get', () =>
      ipcRenderer.invoke(channels.scanFilterPreferencesGet, {}),
    ),
    save: logged('scan.filterPreferences.save', (req: unknown) =>
      ipcRenderer.invoke(channels.scanFilterPreferencesSave, req),
    ),
    clear: logged('scan.filterPreferences.clear', () =>
      ipcRenderer.invoke(channels.scanFilterPreferencesClear, {}),
    ),
  },
  contacts: {
    list: logged('contacts.list', (req: unknown) =>
      ipcRenderer.invoke(channels.contactsList, req),
    ),
  },
  messages: {
    forAddress: logged('messages.forAddress', (req: unknown) =>
      ipcRenderer.invoke(channels.messagesForAddress, req),
    ),
  },
  export: {
    run: logged('export.run', (req: unknown) => ipcRenderer.invoke(channels.exportRun, req)),
    getDefaultDir: logged('export.getDefaultDir', () =>
      ipcRenderer.invoke(channels.exportGetDefaultDir, {}),
    ),
  },
  dialog: {
    showSave: logged('dialog.showSave', (req: unknown) =>
      ipcRenderer.invoke(channels.dialogShowSave, req),
    ),
  },
  session: {
    disconnect: logged('session.disconnect', () =>
      ipcRenderer.invoke(channels.sessionDisconnect, {}),
    ),
  },
  accounts: {
    list: logged('accounts.list', () => ipcRenderer.invoke(channels.accountsList, {})),
    delete: logged('accounts.delete', (req: unknown) =>
      ipcRenderer.invoke(channels.accountsDelete, req),
    ),
    getLast: logged('accounts.getLast', () =>
      ipcRenderer.invoke(channels.accountsGetLast, {}),
    ),
  },
  cache: {
    reset: logged('cache.reset', () => ipcRenderer.invoke(channels.cacheReset, {})),
  },
  app: {
    showLogs: logged('app.showLogs', () => ipcRenderer.invoke(channels.appShowLogs, {})),
  },
} as const;

export type Api = typeof api;

contextBridge.exposeInMainWorld('api', api);

// eslint-disable-next-line no-console
console.log('[preload] window.api exposed');
