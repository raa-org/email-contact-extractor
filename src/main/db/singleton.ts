/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { app } from 'electron';
import { join } from 'node:path';
import { closeDb, openDb, type Db } from './connection.js';

let instance: Db | null = null;

export function getDb(): Db {
  if (instance) return instance;
  const path = join(app.getPath('userData'), 'contact-extractor.db');
  instance = openDb(path);
  return instance;
}

export function closeSingleton(): void {
  if (!instance) return;
  closeDb(instance);
  instance = null;
}
