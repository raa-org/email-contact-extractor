/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { createAction, createAsyncAction } from 'typesafe-actions';
import type {
  ContactRow,
  FolderInfo,
  ScanDirectionMode,
  ScanOptions,
  ScanProgress,
} from '../../../../../shared/domain.js';

export const fetchFolders = createAsyncAction(
  'scan/folders/request',
  'scan/folders/success',
  'scan/folders/failure',
)<undefined, { folders: readonly FolderInfo[] }, { error: string }>();

export const setSelectedFolders = createAction('scan/setSelectedFolders')<readonly string[]>();
export const setIncludeDomains = createAction('scan/setIncludeDomains')<readonly string[]>();
export const setExcludeDomains = createAction('scan/setExcludeDomains')<readonly string[]>();
export const setAutomationLocalParts = createAction(
  'scan/setAutomationLocalParts',
)<readonly string[]>();
export const setIncludeWordsInbound = createAction(
  'scan/setIncludeWordsInbound',
)<readonly string[]>();
export const setExcludeWordsInbound = createAction(
  'scan/setExcludeWordsInbound',
)<readonly string[]>();
export const setIncludeWordsOutbound = createAction(
  'scan/setIncludeWordsOutbound',
)<readonly string[]>();
export const setExcludeWordsOutbound = createAction(
  'scan/setExcludeWordsOutbound',
)<readonly string[]>();
export const setDirectionMode = createAction('scan/setDirectionMode')<ScanDirectionMode>();
export const setMinMessages = createAction('scan/setMinMessages')<number>();
export const setParseBodies = createAction('scan/setParseBodies')<boolean>();
export const hydrateFilters = createAction('scan/hydrateFilters')<{
  includeDomains: readonly string[];
  excludeDomains: readonly string[];
  automationLocalParts: readonly string[];
  includeWordsInbound: readonly string[];
  excludeWordsInbound: readonly string[];
  includeWordsOutbound: readonly string[];
  excludeWordsOutbound: readonly string[];
  directionMode: ScanDirectionMode;
  minMessages: number;
  parseBodies: boolean;
}>();
// Snaps every filter knob in this slice back to factory defaults; does NOT
// touch selectedFolders since folder choice is conceptually separate.
export const resetFilters = createAction('scan/resetFilters')();
// Clears cached runtime/results fields after cache.reset, but keeps
// selected folders + filter preferences untouched.
export const resetCacheState = createAction('scan/resetCacheState')();

export const start = createAsyncAction(
  'scan/start/request',
  'scan/start/success',
  'scan/start/failure',
)<ScanOptions, { runId: string; contactsCount: number }, { error: string }>();

export const progress = createAction('scan/progress')<ScanProgress & { runId: string }>();

// Per-folder delta of newly-kept contacts. Comes from the SCAN_SNAPSHOT_UPDATED
// channel; kept-membership is monotonic so the renderer can append in
// insertion order without re-sorting or removing previous rows.
export const snapshotAppended = createAction('scan/snapshotAppended')<{
  runId: string;
  contacts: readonly ContactRow[];
}>();

export const cancel = createAction('scan/cancel')();
export const cancelDone = createAction('scan/cancelDone')();
export const reset = createAction('scan/reset')();
