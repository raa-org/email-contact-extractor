/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Fade,
  IconButton,
  Snackbar,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import {
  DataGrid,
  type GridColDef,
  type GridRowClassNameParams,
} from '@mui/x-data-grid';
import { useAppDispatch, useAppSelector } from '../store/hooks.js';
import * as contacts from '../store/features/contacts/actions.js';
import { ExportDialog } from '../components/ExportDialog.js';
import { ContactMessagesDialog } from './ContactMessagesDialog.js';
import { formatCount } from '../../../shared/format-count.js';
import { describeProgress, useStableLabel } from '../lib/progress-label.js';

// Renders an ISO timestamp in the user's locale + timezone. Empty/falsy
// values become an em-dash so the cell never reads as a misleading "1970".
function formatLocalDateTime(iso: unknown): string {
  if (typeof iso !== 'string' || iso.length === 0) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

const columns: GridColDef[] = [
  { field: 'email', headerName: 'Email', flex: 1.5, minWidth: 220 },
  {
    field: 'displayNames',
    headerName: 'Display Names',
    flex: 1.2,
    minWidth: 180,
    valueGetter: (_v, row: { displayNames: readonly string[] }) =>
      row.displayNames.join(', '),
  },
  {
    field: 'firstSeenUtc',
    headerName: 'First contact',
    flex: 1,
    minWidth: 180,
    valueFormatter: formatLocalDateTime,
  },
  {
    field: 'lastSeenUtc',
    headerName: 'Last contact',
    flex: 1,
    minWidth: 180,
    valueFormatter: formatLocalDateTime,
  },
  { field: 'total', headerName: 'Total', type: 'number', width: 100 },
  { field: 'countIn', headerName: 'In', type: 'number', width: 90 },
  { field: 'countOut', headerName: 'Out', type: 'number', width: 90 },
];

const PAGE_SIZE = 50;
const PAGE_SIZE_OPTIONS = [25, 50, 100];
const INITIAL_PAGINATION = {
  pagination: { paginationModel: { pageSize: PAGE_SIZE } },
};

// Module-level sx so emotion doesn't re-hash + re-inject keyframes on every
// progress tick (a hot stream produces ~10 renders/second). Re-injecting
// the @keyframes is what was making the table appear to "blink" — the
// underlying styles were being torn down and rebuilt.
//
// The `transition: opacity` cooperates with the inline `opacity` prop
// below so the cold-fetch loading state (after Reset Cache, or first
// landing on Results) cross-fades instead of snapping. 280ms is short
// enough to feel responsive, long enough to look intentional.
//
// The `nth-of-type` overrides on `.MuiSkeleton-root` pin each cell's
// skeleton to a deterministic width per column index. The default MUI X
// skeleton loading overlay assigns a random `Math.random()` width to
// every cell every render, which on a multi-tick loading state reads as
// the placeholders "jumping". The widths below echo the rough text-
// length distribution of real rows (email is wide, In/Out columns are
// tight numbers) so the silhouette still looks tabular.
const DATAGRID_CONTAINER_SX = {
  height: 540,
  width: '100%',
  transition: 'opacity 280ms ease-in-out',
  '@keyframes flashIn': {
    '0%': { backgroundColor: 'rgba(76, 175, 80, 0.35)' },
    '100%': { backgroundColor: 'transparent' },
  },
  '& .row--fresh': {
    animation: 'flashIn 1200ms ease-out',
  },
  // Pulse keyframe applied universally to skeleton bars below. MUI's
  // Skeleton normally pulses by default, but DataGrid v9's
  // GridSkeletonCell renders its inner skeleton without an explicit
  // `animation` prop and on some MUI builds the cells end up static.
  // Asserting our own keyframe here makes the loading state always
  // read as "alive" without depending on the slot internals.
  '@keyframes skeletonPulse': {
    '0%, 100%': { opacity: 1 },
    '50%': { opacity: 0.4 },
  },
  // MUI X writes the random width inline as `style="width: 67%"`, so a
  // class-only override loses on specificity — `!important` is required.
  // We target `data-field` instead of `:nth-of-type` because the skeleton
  // cell DOM doesn't carry `role="cell"`, only the data-field attribute
  // and the `MuiDataGrid-cellSkeleton` class.
  '& .MuiSkeleton-root': {
    width: '70% !important',
    animation: 'skeletonPulse 1.5s ease-in-out infinite',
  },
  '& [data-field="email"] .MuiSkeleton-root': { width: '85% !important' },
  '& [data-field="displayNames"] .MuiSkeleton-root': { width: '70% !important' },
  '& [data-field="firstSeenUtc"] .MuiSkeleton-root': { width: '60% !important' },
  '& [data-field="lastSeenUtc"] .MuiSkeleton-root': { width: '60% !important' },
  '& [data-field="total"] .MuiSkeleton-root': { width: '40% !important' },
  '& [data-field="countIn"] .MuiSkeleton-root': { width: '40% !important' },
  '& [data-field="countOut"] .MuiSkeleton-root': { width: '40% !important' },
} as const;

// ScanStatusChip subscribes to ONLY the high-frequency progress slice so
// that progress ticks (~10/s) re-render this small leaf component instead
// of the entire ResultsScreen. Wrapped in memo so a parent re-render
// doesn't pull it along. Granular selectors (phase / processed / total /
// currentFolder) keep the re-render scope minimal — Redux skips updates
// when the individually selected primitive hasn't changed.
const ScanStatusChip = memo(function ScanStatusChip() {
  const status = useAppSelector((s) => s.scan.status);
  const phase = useAppSelector((s) => s.scan.progress?.phase ?? null);
  const currentFolder = useAppSelector(
    (s) => s.scan.progress?.currentFolder ?? null,
  );
  const processed = useAppSelector((s) => s.scan.progress?.processed ?? 0);
  const total = useAppSelector((s) => s.scan.progress?.total ?? 0);

  // Live label derived from phase + currentFolder, then run through
  // useStableLabel: on a hot cache the pipeline can transit four phases
  // in <300 ms — without dwell, the chip text flickers through
  // unreadable strings (visible as a blur). The stable hook coalesces
  // fast updates so each label gets at least ~600 ms of screen time.
  // When status flips off 'running', live becomes null and the hook
  // applies that synchronously so the terminal chip swaps in without
  // lag.
  const liveLabel =
    status === 'running' && phase !== null
      ? describeProgress({ phase, currentFolder: currentFolder ?? undefined, processed, total })
      : null;
  const stableLabel = useStableLabel(liveLabel);

  if (status === 'running') {
    // Show "X / Y" only once we know `total`. The connecting /
    // enumerating / body-warmup emits carry total=0 — drop the count
    // suffix in those windows so the chip never reads as "0 / 0".
    const counts =
      total > 0 ? ` · ${formatCount(processed)} / ${formatCount(total)}` : '';
    return (
      <Fade key={stableLabel ?? 'starting'} in={true} timeout={220}>
        <Chip
          icon={<CircularProgress size={14} />}
          color="info"
          variant="outlined"
          label={`Scan in progress · ${stableLabel ?? 'starting'}${counts}`}
          size="small"
          sx={{ '& .MuiChip-label': { fontVariantNumeric: 'tabular-nums' } }}
        />
      </Fade>
    );
  }
  if (status === 'done') {
    return <Chip color="success" label="Scan complete" size="small" />;
  }
  if (status === 'cancelled') {
    return <Chip color="warning" label="Scan cancelled" size="small" />;
  }
  if (status === 'error') {
    return <Chip color="error" label="Scan failed" size="small" />;
  }
  return null;
});

export function ResultsScreen() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  // Granular selectors: each one only re-renders this component when ITS
  // value changes. Subscribing to the whole `s.scan` slice would trigger
  // a full re-render on every progress tick (~10/s) because the slice
  // reference changes even when nothing visible to this screen does.
  const fallbackRows = useAppSelector((s) => s.contacts.rows);
  const fallbackTotal = useAppSelector((s) => s.contacts.total);
  const fallbackLoading = useAppSelector((s) => s.contacts.loading);
  const fallbackError = useAppSelector((s) => s.contacts.error);
  const scanStatus = useAppSelector((s) => s.scan.status);
  const snapshotContacts = useAppSelector((s) => s.scan.snapshotContacts);
  const latestSnapshotEmails = useAppSelector((s) => s.scan.latestSnapshotEmails);
  const scanError = useAppSelector((s) => s.scan.error);

  const [exportOpen, setExportOpen] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState<string | null>(null);
  const [toast, setToast] = useState<
    { severity: 'success' | 'error'; message: string } | null
  >(null);
  // Sliding window of emails that landed in a snapshot delta within the
  // last ~FLASH_LIFETIME_MS. The DataGrid uses this to apply the
  // `row--fresh` class so the green flashIn keyframe runs once on
  // arrival. We REMOVE entries after the animation completes — keeping
  // the class on a row indefinitely would cause DataGrid's row
  // virtualisation to replay the flash every time the user scrolled the
  // row back into view. The lifetime is wider than the keyframe (1200ms)
  // so an in-progress animation always finishes naturally.
  const [freshEmails, setFreshEmails] = useState<ReadonlySet<string>>(new Set());
  const [query, setLocalQuery] = useState('');

  const hasStreamData = scanStatus !== 'idle' || snapshotContacts.length > 0;

  useEffect(() => {
    // Only fire the cold paginated fetch ONCE — without the error guard,
    // a fetch failure flips loading back to false with rows still empty,
    // which retriggers this effect and produces an infinite retry loop.
    if (
      !hasStreamData &&
      fallbackRows.length === 0 &&
      !fallbackLoading &&
      fallbackError === null
    ) {
      dispatch(contacts.fetch.request({ offset: 0, limit: PAGE_SIZE }));
    }
  }, [hasStreamData, fallbackRows.length, fallbackLoading, fallbackError, dispatch]);

  useEffect(() => {
    if (latestSnapshotEmails.length === 0) return;
    const justAdded = [...latestSnapshotEmails];
    setFreshEmails((prev) => {
      const next = new Set(prev);
      for (const e of justAdded) next.add(e);
      return next;
    });
    // 1500ms covers the 1200ms flashIn keyframe with a small buffer.
    // Past that point, the row's class no longer carries the animation
    // so DataGrid virtualisation re-mounts on scroll don't replay the
    // green flash.
    const timer = window.setTimeout(() => {
      setFreshEmails((prev) => {
        const next = new Set(prev);
        for (const e of justAdded) next.delete(e);
        return next;
      });
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [latestSnapshotEmails]);

  const sourceRows = hasStreamData ? snapshotContacts : fallbackRows;
  const filtered = useMemo(() => {
    if (!query) return sourceRows;
    const q = query.toLowerCase();
    return sourceRows.filter(
      (r) =>
        r.email.toLowerCase().includes(q) ||
        r.displayNames.some((n) => n.toLowerCase().includes(q)),
    );
  }, [sourceRows, query]);

  // Memoized row data so DataGrid sees a stable reference until the
  // underlying contacts list actually changes.
  const dataRows = useMemo(
    () => filtered.map((r, i) => ({ id: `${r.email}-${i}`, ...r })),
    [filtered],
  );
  const totalCount = hasStreamData ? snapshotContacts.length : fallbackTotal;

  const getRowClassName = useCallback(
    (params: GridRowClassNameParams) =>
      freshEmails.has((params.row as { email: string }).email) ? 'row--fresh' : '',
    [freshEmails],
  );

  return (
    <Box sx={{ p: 4, maxWidth: 1200, mx: 'auto' }}>
      <Stack spacing={2}>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          <Tooltip title="Back to Scan">
            <IconButton onClick={() => navigate('/scan')} size="small">
              <ArrowBackIcon />
            </IconButton>
          </Tooltip>
          <Typography variant="h4">Results</Typography>
          <ScanStatusChip />
        </Stack>

        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          <TextField
            size="small"
            label="Search"
            placeholder="email, name…"
            value={query}
            onChange={(e) => setLocalQuery(e.target.value)}
            sx={{ flex: 1, maxWidth: 360 }}
          />
          <Typography variant="body2" color="text.secondary">
            {formatCount(filtered.length)} of {formatCount(totalCount)} contacts
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Button
            variant="contained"
            onClick={() => setExportOpen(true)}
            disabled={fallbackLoading || totalCount === 0}
          >
            Export…
          </Button>
        </Stack>

        {scanError !== null && <Alert severity="error">{scanError}</Alert>}
        {fallbackError !== null && !hasStreamData && (
          <Alert severity="error">{fallbackError}</Alert>
        )}

        <Box
          sx={DATAGRID_CONTAINER_SX}
          // Fade the table while a cold fetch is in flight (Reset Cache,
          // or first arrival on Results). Inline `style` instead of `sx`
          // on purpose — re-spreading DATAGRID_CONTAINER_SX would change
          // the emotion hash on every render and re-inject the
          // `@keyframes skeletonPulse` rule, restarting every cell's
          // animation out of sync.
          style={{
            opacity: !hasStreamData && fallbackLoading ? 0.5 : 1,
          }}
        >
          <DataGrid
            rows={dataRows}
            columns={columns}
            loading={!hasStreamData && fallbackLoading}
            disableRowSelectionOnClick
            initialState={INITIAL_PAGINATION}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            getRowClassName={getRowClassName}
            onRowClick={(p) =>
              setSelectedEmail((p.row as { email: string }).email)
            }
            sx={{ '& .MuiDataGrid-row': { cursor: 'pointer' } }}
          />
        </Box>
      </Stack>

      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        onSuccess={(message) => setToast({ severity: 'success', message })}
        onError={(message) => setToast({ severity: 'error', message })}
      />

      <ContactMessagesDialog
        email={selectedEmail}
        onClose={() => setSelectedEmail(null)}
      />

      <Snackbar
        open={toast !== null}
        autoHideDuration={5000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {toast ? (
          <Alert severity={toast.severity} onClose={() => setToast(null)}>
            {toast.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </Box>
  );
}
