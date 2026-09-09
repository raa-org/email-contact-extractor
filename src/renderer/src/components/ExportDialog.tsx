/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import {
  ExportColumn,
  type ExportFormat,
} from '../../../shared/domain.js';
import {
  getDefaultExportDir,
  runExport,
  showSaveDialog,
} from '../ipc-client.js';

interface Props {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSuccess: (msg: string) => void;
  readonly onError: (msg: string) => void;
}

// Mirror of the Results DataGrid columns (src/renderer/src/routes/
// ResultsScreen.tsx). The export must contain exactly what the user sees
// in the table — no more, no less. Keep this list in step with that
// component until Phase 2 introduces a dynamic column registry.
const DEFAULT_COLUMN_LIST: readonly string[] = [
  'email',
  'displayNames',
  'firstSeenUtc',
  'lastSeenUtc',
  'total',
  'countIn',
  'countOut',
];

// Returns YYYY-MM-DD_HH-MM-SS in the user's local time. Filename-safe
// (no colons or path separators) and human-readable so the file lands
// in the user's folder with a recognisable timestamp.
function formatTimestamp(d: Date): string {
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
  );
}

function defaultFilename(format: ExportFormat, ts: Date): string {
  return `contact_list_${formatTimestamp(ts)}.${format}`;
}

// Replaces only the trailing extension on an existing path. Used when the
// user flips the Format dropdown — we keep their chosen directory + the
// timestamp portion intact and just swap .xlsx ↔ .csv.
function swapExtension(path: string, format: ExportFormat): string {
  return path.replace(/\.[^./\\]+$/, `.${format}`);
}

export function ExportDialog({ open, onClose, onSuccess, onError }: Props) {
  const [format, setFormat] = useState<ExportFormat>('xlsx');
  const [filePath, setFilePath] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // On open: resolve the default export directory (last-used or
  // ~/Downloads) and seed filePath with a timestamped filename. The
  // dependency on `open` makes the dialog regenerate the timestamp every
  // time it's reopened, so re-exports never collide with stale paths.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    getDefaultExportDir()
      .then((dir) => {
        if (cancelled) return;
        const filename = defaultFilename(format, new Date());
        // Forward slash works as separator in Electron save-dialog
        // defaultPath on every OS we target; node:path is a main-side
        // module not available in the sandboxed renderer.
        setFilePath(`${dir.replace(/[\\/]+$/, '')}/${filename}`);
      })
      .catch(() => {
        // Don't block the dialog — leave the field empty and let the
        // user Browse / type. The Export button stays disabled until a
        // path is set, so we won't run with garbage either way.
        if (!cancelled) setFilePath('');
      });
    return () => {
      cancelled = true;
    };
    // Depends ONLY on `open`: changing format mid-dialog must not stomp
    // the user's edits — the format-effect below handles that via an
    // extension-only swap.
  }, [open]);

  // Format change → swap only the extension on whatever path we currently
  // have, preserving the user's directory + filename body.
  useEffect(() => {
    setFilePath((prev) => (prev.length === 0 ? prev : swapExtension(prev, format)));
  }, [format]);

  const handlePick = async (): Promise<void> => {
    setError(null);
    const result = await showSaveDialog({
      defaultPath: filePath,
      filters:
        format === 'xlsx'
          ? [{ name: 'Excel', extensions: ['xlsx'] }]
          : [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (!result.canceled && result.filePath) setFilePath(result.filePath);
  };

  const handleExport = async (): Promise<void> => {
    if (!filePath) return;
    setSubmitting(true);
    setError(null);
    try {
      const validColumns = DEFAULT_COLUMN_LIST.map((c) => ExportColumn.parse(c));
      const result = await runExport({
        format,
        filePath,
        columns: validColumns,
      });
      onSuccess(`Exported ${result.rowsExported} rows to ${result.filePath}`);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      onError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      aria-labelledby="export-title"
    >
      <DialogTitle id="export-title">Export contacts</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <FormControl fullWidth>
            <InputLabel id="format-label">Format</InputLabel>
            <Select
              labelId="format-label"
              label="Format"
              value={format}
              onChange={(e) => setFormat(e.target.value as ExportFormat)}
            >
              <MenuItem value="xlsx">XLSX (Excel)</MenuItem>
              <MenuItem value="csv">CSV (UTF-8 with BOM)</MenuItem>
            </Select>
          </FormControl>
          <TextField
            fullWidth
            label="File path"
            value={filePath}
            onChange={(e) => {
              setFilePath(e.target.value);
            }}
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <Tooltip title="Browse…">
                      <IconButton
                        onClick={handlePick}
                        edge="end"
                        size="small"
                        aria-label="Browse"
                      >
                        <FolderOpenIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </InputAdornment>
                ),
              },
            }}
          />
          <Typography variant="caption" color="text.secondary">
            Columns: {DEFAULT_COLUMN_LIST.join(', ')}
          </Typography>
          {error !== null && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleExport}
          disabled={submitting || filePath.length === 0}
        >
          {submitting ? 'Exporting…' : 'Export'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
