/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { createReducer } from 'typesafe-actions';
import type {
  ContactRow,
  FolderInfo,
  ScanDirectionMode,
  ScanProgress,
} from '../../../../../shared/domain.js';
import { DEFAULT_AUTOMATION_LOCAL_PARTS } from '../../../../../shared/heuristics-config.js';
import * as a from './actions.js';
import * as session from '../session/actions.js';
import * as accounts from '../accounts/actions.js';

export type ScanStatus = 'idle' | 'running' | 'done' | 'cancelled' | 'error';

export interface ScanState {
  readonly folders: readonly FolderInfo[];
  readonly foldersLoading: boolean;
  readonly foldersError: string | null;
  readonly selectedFolders: readonly string[];
  // Snapshot of `folderInclude` from the most recent scan.start.request.
  // Drill-down (ContactMessagesDialog) reads this — not the live
  // selectedFolders — so the dialog stays consistent with the scan that
  // produced the visible contact list, even if the user has since changed
  // checkboxes without rerunning. `null` until the first scan.
  readonly lastRunFolders: readonly string[] | null;
  // Filter knobs. Persist across Results→Scan navigation so the user can
  // tweak one rule rather than retyping the whole set. Word/tag filters
  // are split by direction so the user can target the counterpart's text
  // separately from their own outbound replies.
  readonly includeDomains: readonly string[];
  readonly excludeDomains: readonly string[];
  readonly automationLocalParts: readonly string[];
  readonly includeWordsInbound: readonly string[];
  readonly excludeWordsInbound: readonly string[];
  readonly includeWordsOutbound: readonly string[];
  readonly excludeWordsOutbound: readonly string[];
  readonly directionMode: ScanDirectionMode;
  readonly minMessages: number;
  // Opt-in to deep scan: fetch + encrypt + filter on message bodies.
  readonly parseBodies: boolean;
  readonly status: ScanStatus;
  readonly runId: string | null;
  readonly progress: ScanProgress | null;
  readonly contactsCount: number;
  readonly error: string | null;
  // Append-only stream of contacts emitted by SCAN_SNAPSHOT_UPDATED.
  // Cleared on every new start.request so the previous run's results
  // don't leak into the new one.
  readonly snapshotContacts: readonly ContactRow[];
  // Emails that just landed in the most recent snapshot — drives the
  // fade-in animation in ResultsScreen. Cleared after the animation
  // window expires (the screen owns the timer).
  readonly latestSnapshotEmails: readonly string[];
}

// Bi-directional needs at least one outbound folder, otherwise countOut=0
// for everyone and the rule yields zero contacts. Sent is the canonical
// outbound folder, so we auto-include it when bi is active. Detection:
//   1) IMAP `\Sent` special-use (the right answer when the server bothers).
//   2) Path-name fallback ('Sent', 'Sent Items', 'Sent Messages', case-
//      insensitive) for servers that don't advertise the flag — e.g. some
//      legacy on-prem IMAP servers.
const SENT_PATH_REGEX = /^\s*sent(\s+(items|messages|mail))?\s*$/i;
export function findSentFolder(
  folders: readonly FolderInfo[],
): FolderInfo | undefined {
  return (
    folders.find((f) => f.specialUse === '\\Sent') ??
    folders.find((f) => SENT_PATH_REGEX.test(f.path))
  );
}
// Sent is mandatory while the direction filter is on:
//   - bi:   without Sent, countOut=0 → empty result.
//   - one:  without Sent, outbound-only contacts (we wrote to them, no
//           reply) silently disappear from the result.
// In 'off' the user has explicitly opted out of direction-based filtering,
// so we don't lock Sent — it's their call whether to include it.
function ensureSentSelected(
  selected: readonly string[],
  folders: readonly FolderInfo[],
  mode: ScanDirectionMode,
): readonly string[] {
  if (mode === 'off') return selected;
  const sent = findSentFolder(folders);
  if (!sent || selected.includes(sent.path)) return selected;
  return [...selected, sent.path];
}

// Factory defaults for the Filters block. Used as initial state and as the
// target of scan/resetFilters. excludeDomains starts empty: your own
// domains are deployment-specific, so add them on the Scan screen (or they
// get picked up as counterparties).
export const DEFAULT_SCAN_FILTERS = {
  includeDomains: [] as readonly string[],
  excludeDomains: [] as readonly string[],
  automationLocalParts: DEFAULT_AUTOMATION_LOCAL_PARTS,
  includeWordsInbound: [] as readonly string[],
  excludeWordsInbound: ['unsubscribe', 'remove'] as readonly string[],
  includeWordsOutbound: [] as readonly string[],
  excludeWordsOutbound: [] as readonly string[],
  directionMode: 'bi' as ScanDirectionMode,
  minMessages: 2,
  parseBodies: true,
} as const;

// All six chip-list filter fields share the same readonly-string-array
// shape. The reducer-handler factory below lets each setX action wire to
// its target field with a single literal call instead of repeating the
// `(state, action) => ({ ...state, foo: action.payload })` skeleton.
type ChipListField =
  | 'includeDomains'
  | 'excludeDomains'
  | 'automationLocalParts'
  | 'includeWordsInbound'
  | 'excludeWordsInbound'
  | 'includeWordsOutbound'
  | 'excludeWordsOutbound';

function setField<K extends ChipListField>(field: K) {
  return (
    state: ScanState,
    action: { payload: readonly string[] },
  ): ScanState => ({ ...state, [field]: action.payload });
}

export const initialState: ScanState = {
  folders: [],
  foldersLoading: false,
  foldersError: null,
  selectedFolders: [],
  lastRunFolders: null,
  ...DEFAULT_SCAN_FILTERS,
  status: 'idle',
  runId: null,
  progress: null,
  contactsCount: 0,
  error: null,
  snapshotContacts: [],
  latestSnapshotEmails: [],
};

export const scanReducer = createReducer<ScanState>(initialState)
  .handleAction(a.fetchFolders.request, (state) => ({
    ...state,
    foldersLoading: true,
    foldersError: null,
  }))
  .handleAction(a.fetchFolders.success, (state, action) => {
    const baseSelection =
      state.selectedFolders.length > 0
        ? state.selectedFolders
        : action.payload.folders.map((f) => f.path);
    return {
      ...state,
      foldersLoading: false,
      folders: action.payload.folders,
      selectedFolders: ensureSentSelected(
        baseSelection,
        action.payload.folders,
        state.directionMode,
      ),
    };
  })
  .handleAction(a.fetchFolders.failure, (state, action) => ({
    ...state,
    foldersLoading: false,
    foldersError: action.payload.error,
  }))
  .handleAction(a.setSelectedFolders, (state, action) => ({
    ...state,
    // Snap-back so any path that bypasses the disabled UI checkbox can't
    // drop Sent while a direction filter is active. No-op in 'off' mode.
    selectedFolders: ensureSentSelected(action.payload, state.folders, state.directionMode),
  }))
  // Six chip-list filters share the same shape: replace `state[field]` with
  // the action payload, leave everything else untouched. `setField` factors
  // out the boilerplate so each handler is one declarative line.
  .handleAction(a.setIncludeDomains, setField('includeDomains'))
  .handleAction(a.setExcludeDomains, setField('excludeDomains'))
  .handleAction(a.setAutomationLocalParts, setField('automationLocalParts'))
  .handleAction(a.setIncludeWordsInbound, setField('includeWordsInbound'))
  .handleAction(a.setExcludeWordsInbound, setField('excludeWordsInbound'))
  .handleAction(a.setIncludeWordsOutbound, setField('includeWordsOutbound'))
  .handleAction(a.setExcludeWordsOutbound, setField('excludeWordsOutbound'))
  .handleAction(a.setDirectionMode, (state, action) => ({
    ...state,
    directionMode: action.payload,
    // Switching INTO bi/one auto-adds Sent if the user is missing it.
    // Switching INTO 'off' is a no-op for selection — we don't strip
    // Sent (no reason to), just stop enforcing it.
    selectedFolders: ensureSentSelected(state.selectedFolders, state.folders, action.payload),
  }))
  .handleAction(a.setMinMessages, (state, action) => ({
    ...state,
    minMessages: action.payload,
  }))
  .handleAction(a.setParseBodies, (state, action) => ({
    ...state,
    parseBodies: action.payload,
  }))
  .handleAction(a.hydrateFilters, (state, action) => ({
    ...state,
    ...action.payload,
  }))
  .handleAction(a.resetFilters, (state) => ({
    ...state,
    ...DEFAULT_SCAN_FILTERS,
  }))
  .handleAction(a.resetCacheState, (state) => ({
    ...state,
    status: 'idle',
    runId: null,
    progress: null,
    contactsCount: 0,
    error: null,
    snapshotContacts: [],
    latestSnapshotEmails: [],
    lastRunFolders: null,
  }))
  .handleAction(a.start.request, (state, action) => ({
    ...state,
    status: 'running',
    error: null,
    progress: null,
    contactsCount: 0,
    snapshotContacts: [],
    latestSnapshotEmails: [],
    // Snapshot the folder list AT THE MOMENT the scan starts so drill-down
    // doesn't drift if the user toggles checkboxes mid-run or after.
    lastRunFolders: action.payload.folderInclude ?? null,
  }))
  .handleAction(a.start.success, (state, action) => ({
    ...state,
    status: 'done',
    runId: action.payload.runId,
    contactsCount: action.payload.contactsCount,
  }))
  .handleAction(a.start.failure, (state, action) => ({
    ...state,
    status: 'error',
    error: action.payload.error,
  }))
  .handleAction(a.progress, (state, action) => {
    const rest = (({ runId, ...other }) => other)(action.payload);
    return { ...state, progress: rest };
  })
  .handleAction(a.snapshotAppended, (state, action) => ({
    ...state,
    snapshotContacts: [...state.snapshotContacts, ...action.payload.contacts],
    latestSnapshotEmails: action.payload.contacts.map((c) => c.email),
  }))
  .handleAction(a.cancelDone, (state) => ({
    ...state,
    status: 'cancelled',
  }))
  // Active-session change ⇒ wipe scan slice. ResultsScreen treats
  // `snapshotContacts.length > 0` as "we have stream data, skip cold fetch",
  // so without this the next account would inherit the previous one's
  // streamed contacts. Mirrors contacts.reducer's reset triggers — every
  // path that flips who's logged in is covered here.
  .handleAction(
    [
      a.reset,
      session.clear,
      session.setActive,
      accounts.useSaved.success,
      accounts.remove.success,
    ],
    () => initialState,
  );
