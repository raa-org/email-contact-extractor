/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { app, BrowserWindow, shell } from 'electron';
import log from 'electron-log/main';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { registerIpcHandlers } from './ipc/handlers.js';
import * as session from './ipc/session.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

log.transports.file.level = 'info';
log.transports.console.level = 'info';
// Bump from the electron-log default (1 MB) — a single scan with full
// pipeline instrumentation lands at ~200 KB, so 1 MB rotates every
// ~5 scans, which is too aggressive for the forensic shape these logs
// have. 10 MB keeps the rotation behaviour (rename to .old.log, retain
// last archive) but lets us hold ~50 scans before the cycle.
log.transports.file.maxSize = 10 * 1024 * 1024;
log.info(
  `=== contact-extractor v${app.getVersion()} ` +
    `electron=${process.versions['electron'] ?? '?'} ` +
    `node=${process.versions['node'] ?? '?'} ` +
    `os=${process.platform}/${process.arch} ===`,
);

process.on('uncaughtException', (err) => {
  log.error('[main] uncaughtException', err);
});
process.on('unhandledRejection', (err) => {
  log.error('[main] unhandledRejection', err);
});

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  log.info('[main] createWindow');
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    // Below this, the Results DataGrid (~1040px of column minWidths + page
    // padding) and the drill-down dialog (~1200px of columns) start to
    // either overflow horizontally or compress past readable widths.
    // Keeps a little room for split-screen / docking without breaking the
    // layout.
    minWidth: 1100,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow = window;

  window.on('ready-to-show', () => {
    window.show();
  });

  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });

  window.webContents.on(
    'render-process-gone',
    (_evt, details) => {
      log.error('[main] render-process-gone', details);
    },
  );

  window.webContents.on('preload-error', (_evt, preloadPath, error) => {
    log.error(`[main] preload-error at ${preloadPath}`, error);
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    log.info(`[main] loading renderer URL ${process.env['ELECTRON_RENDERER_URL']}`);
    void window.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    const renderer = join(__dirname, '../renderer/index.html');
    log.info(`[main] loading renderer file ${renderer}`);
    void window.loadFile(renderer);
  }
}

registerIpcHandlers(() => mainWindow);

void app.whenReady().then(() => {
  log.info('[main] app ready');
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  log.info('[main] window-all-closed');
  void session.disconnect().finally(() => {
    if (process.platform !== 'darwin') app.quit();
  });
});

app.on('before-quit', () => {
  log.info('[main] before-quit');
  void session.disconnect();
});
