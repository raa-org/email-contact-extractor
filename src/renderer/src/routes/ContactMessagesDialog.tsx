/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Snackbar,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { DataGrid, type GridColDef } from '@mui/x-data-grid';
import type { MessageDrilldownRow } from '../../../shared/ipc-contracts.js';
import { listMessagesForAddress } from '../ipc-client.js';
import { useAppSelector } from '../store/hooks.js';

interface Props {
  readonly email: string | null;
  readonly onClose: () => void;
}

interface DialogRow extends MessageDrilldownRow {
  readonly id: string;
}

const DATAGRID_SX = { height: 540, width: '100%' } as const;

function AutoFlagsCell({ row }: { row: DialogRow }) {
  const chips: Array<{ label: string; color: 'warning' | 'default' }> = [];
  if (row.hasListUnsubscribe) chips.push({ label: 'unsubscribe', color: 'warning' });
  if (row.hasListId) chips.push({ label: 'list-id', color: 'warning' });
  if (row.hasInlineUnsubscribe) chips.push({ label: 'inline-unsubscribe', color: 'warning' });
  if (row.autoSubmitted !== null && row.autoSubmitted.toLowerCase() !== 'no') {
    chips.push({ label: `auto-submitted: ${row.autoSubmitted}`, color: 'warning' });
  }
  if (row.precedence !== null) {
    chips.push({ label: `precedence: ${row.precedence}`, color: 'warning' });
  }
  if (chips.length === 0) return null;
  return (
    <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
      {chips.map((c) => (
        <Chip key={c.label} label={c.label} size="small" color={c.color} variant="outlined" />
      ))}
    </Stack>
  );
}

export function ContactMessagesDialog({ email, onClose }: Props) {
  const [rows, setRows] = useState<readonly DialogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [toast, setToast] = useState<{ message: string; severity: 'success' | 'warning' } | null>(
    null,
  );
  // Pulled from the scan slice so the dialog scope matches the scan that
  // produced the visible contact list, not whatever the user has clicked
  // in the Folders panel since. `null` before the first scan → unscoped
  // (acts on the full local cache).
  const lastRunFolders = useAppSelector((s) => s.scan.lastRunFolders);

  useEffect(() => {
    if (email === null) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setRows([]);
    setTruncated(false);
    listMessagesForAddress(email, lastRunFolders)
      .then((res) => {
        if (cancelled) return;
        setRows(
          res.rows.map((r, i) => ({ ...r, id: `${r.folder}-${r.uid}-${i}` })),
        );
        setTruncated(res.truncated);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [email, lastRunFolders]);

  const subtitle = useMemo(() => {
    const base = `Inbound matched on From; outbound on To/Cc. Newest first.`;
    if (truncated) return `${base} Showing first 500 — more exist.`;
    return `${base} ${rows.length} message${rows.length === 1 ? '' : 's'}.`;
  }, [rows.length, truncated]);

  // Columns are constructed inside the component so the copy handler can
  // close over `setToast` without leaking renderer state to module scope.
  const columns = useMemo<GridColDef<DialogRow>[]>(() => {
    const handleCopySubject = async (subject: string): Promise<void> => {
      try {
        await navigator.clipboard.writeText(subject);
        setToast({ message: 'Subject copied', severity: 'success' });
      } catch (err) {
        setToast({
          message: `Could not copy subject: ${err instanceof Error ? err.message : String(err)}`,
          severity: 'warning',
        });
      }
    };
    return [
      {
        field: 'dateUtc',
        headerName: 'Date',
        width: 180,
        valueGetter: (_v, row) =>
          row.dateUtc ? new Date(row.dateUtc).toLocaleString() : '—',
      },
      {
        field: 'direction',
        headerName: 'Dir',
        width: 80,
        renderCell: (p) => (
          <Chip
            label={p.row.direction}
            size="small"
            color={p.row.direction === 'in' ? 'info' : 'success'}
            variant="outlined"
          />
        ),
      },
      { field: 'folder', headerName: 'Folder', flex: 1, minWidth: 180 },
      { field: 'uid', headerName: 'UID', type: 'number', width: 100 },
      { field: 'fromAddr', headerName: 'From', flex: 1.2, minWidth: 200 },
      {
        field: 'subject',
        headerName: 'Subject',
        flex: 1.5,
        minWidth: 240,
        // Subject text plus a trailing copy-icon button. Clicking the icon
        // copies the subject so the user can paste it into Thunderbird's
        // search to locate this message.
        renderCell: (p) => {
          const subject = p.row.subject;
          const hasSubject = subject !== null && subject.length > 0;
          return (
            <Stack
              direction="row"
              spacing={0.5}
              sx={{ alignItems: 'center', width: '100%', minWidth: 0 }}
            >
              <Box
                component="span"
                sx={{
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {hasSubject ? subject : ''}
              </Box>
              <Tooltip title={hasSubject ? 'Copy subject' : 'No subject to copy'}>
                <span>
                  <IconButton
                    size="small"
                    edge="end"
                    aria-label="Copy subject"
                    disabled={!hasSubject}
                    onClick={() => {
                      if (hasSubject) void handleCopySubject(subject);
                    }}
                  >
                    <ContentCopyIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </Stack>
          );
        },
      },
      {
        field: 'flags',
        headerName: 'Auto-flags',
        flex: 1,
        minWidth: 220,
        sortable: false,
        renderHeader: () => (
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            <Box component="span" sx={{ fontWeight: 500 }}>
              Auto-flags
            </Box>
            <Tooltip
              title={
                'Email automation headers present on this message. Each chip = one signal: ' +
                '"unsubscribe" → List-Unsubscribe header set; ' +
                '"list-id" → List-Id header set (mailing list / group); ' +
                '"inline-unsubscribe" → body matches reply-to-unsubscribe pattern; ' +
                '"auto-submitted: <value>" → Auto-Submitted header is set and not "no"; ' +
                '"precedence: <value>" → Precedence header set (typically bulk/list/junk). ' +
                'A contact is only ruled "automated" by the classifier when EVERY one of ' +
                'their messages carries at least one such flag.'
              }
            >
              <InfoOutlinedIcon
                aria-label="Auto-flags help"
                sx={{ color: 'text.secondary', cursor: 'help', fontSize: 14 }}
              />
            </Tooltip>
          </Stack>
        ),
        renderCell: (p) => <AutoFlagsCell row={p.row} />,
      },
    ];
  }, []);

  return (
    <>
      <Dialog open={email !== null} onClose={onClose} maxWidth="lg" fullWidth>
        <DialogTitle>
          <Stack spacing={0.5}>
            <Typography variant="h6">{email ?? ''}</Typography>
            <Typography variant="caption" color="text.secondary">
              {subtitle}
            </Typography>
          </Stack>
        </DialogTitle>
        <DialogContent dividers>
          {loading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress size={28} />
            </Box>
          )}
          {error !== null && <Alert severity="error">{error}</Alert>}
          {!loading && error === null && (
            <Box sx={DATAGRID_SX}>
              <DataGrid
                rows={rows}
                columns={columns}
                density="compact"
                disableRowSelectionOnClick
                pageSizeOptions={[25, 50, 100]}
                initialState={{ pagination: { paginationModel: { pageSize: 50 } } }}
              />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Close</Button>
        </DialogActions>
      </Dialog>
      <Snackbar
        open={toast !== null}
        autoHideDuration={3000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {toast !== null ? (
          <Alert severity={toast.severity} onClose={() => setToast(null)}>
            {toast.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </>
  );
}
