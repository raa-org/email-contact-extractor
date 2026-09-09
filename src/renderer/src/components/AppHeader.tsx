/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import {
  Alert,
  AppBar,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Snackbar,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material';
import DeleteSweepOutlinedIcon from '@mui/icons-material/DeleteSweepOutlined';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import SwitchAccountIcon from '@mui/icons-material/SwitchAccount';
import { useAppDispatch, useAppSelector } from '../store/hooks.js';
import * as scanActions from '../store/features/scan/actions.js';
import * as contactsActions from '../store/features/contacts/actions.js';
import * as cacheActions from '../store/features/cache/actions.js';
import * as sessionActions from '../store/features/session/actions.js';
import { disconnectSession, showLogs } from '../ipc-client.js';

// Tiny header that surfaces the active account and a "Switch" button so
// the user can always get back to ConnectScreen — without it, after the
// bootstrap auto-resume, there is no path back to the saved-accounts
// panel until they go through scan/results.
//
// Renders nothing while the bootstrap splash is still up (no session),
// and on /connect itself (the user is already managing accounts there).
export function AppHeader() {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useAppDispatch();
  const active = useAppSelector((s) => s.session.active);
  const bootstrapPhase = useAppSelector((s) => s.bootstrap.phase);
  const scanStatus = useAppSelector((s) => s.scan.status);
  const cacheResetting = useAppSelector((s) => s.cache.resetting);
  const cacheResultSeq = useAppSelector((s) => s.cache.resultSeq);
  const cacheLastResult = useAppSelector((s) => s.cache.lastResult);
  const cacheError = useAppSelector((s) => s.cache.error);

  const [resetOpen, setResetOpen] = useState(false);
  const [resetToast, setResetToast] = useState<
    { message: string; severity: 'success' | 'error' } | null
  >(null);
  // Anchor for the overflow menu that hosts low-frequency admin actions
  // (currently just "Open Logs Folder"). Keeping it behind a "⋮" button
  // means the toolbar isn't a wall of icons; new diagnostic actions can
  // join the menu without further visual noise.
  const [moreAnchor, setMoreAnchor] = useState<null | HTMLElement>(null);

  // Surface the epic's success/failure as a toast. We key the effect on
  // `resultSeq` (a monotonic counter the cache reducer bumps each time)
  // so two consecutive identical results still re-fire — useEffect would
  // skip them otherwise. The first render lands on `seq === 0` and we
  // skip until the first real bump.
  useEffect(() => {
    if (cacheResultSeq === 0) return;
    if (cacheLastResult === 'success') {
      setResetToast({ message: 'Scan cache cleared', severity: 'success' });
    } else if (cacheLastResult === 'error') {
      setResetToast({
        message: `Could not reset cache: ${cacheError ?? 'unknown error'}`,
        severity: 'error',
      });
    }
  }, [cacheResultSeq, cacheLastResult, cacheError]);

  if (bootstrapPhase !== 'done') return null;
  if (location.pathname === '/connect') return null;

  const handleResetCache = (): void => {
    // Pure synchronous handler — no awaits, so React commits the dialog
    // close + Redux blanking + route change in one render before the
    // IPC even leaves the renderer. The cache epic owns the actual
    // SQLite wipe and dispatches success/failure; the toast is wired
    // up via useEffect on s.cache.resultSeq.
    setResetOpen(false);
    dispatch(scanActions.resetCacheState());
    dispatch(contactsActions.reset());
    if (location.pathname !== '/scan' && location.pathname !== '/connect') {
      navigate('/scan');
    }
    dispatch(cacheActions.reset.request());
  };

  return (
    <AppBar
      position="static"
      color="default"
      elevation={0}
      sx={{ borderBottom: 1, borderColor: 'divider' }}
    >
      <Toolbar variant="dense">
        <Typography variant="subtitle2" sx={{ flexGrow: 0, mr: 2 }}>
          Contact Extractor
        </Typography>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {active && (
            <Typography
              variant="body2"
              color="text.secondary"
              noWrap
              sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}
            >
              {active.username} <Box component="span" sx={{ opacity: 0.6 }}>·</Box>{' '}
              {active.host}
            </Typography>
          )}
        </Box>
        <Button
          size="small"
          startIcon={<SwitchAccountIcon fontSize="small" />}
          onClick={() => {
            // Clear every renderer slice that could leak the previous
            // account's data into the next session: scan progress &
            // streamed snapshot contacts, the paginated contacts cache
            // (whose ResultsScreen guard skips re-fetching when rows are
            // already populated), and the header's "active" indicator.
            // Also fire a session.disconnect IPC so the main process
            // drops account A's IMAP client + credentials before the
            // user authenticates as account B.
            dispatch(scanActions.reset());
            dispatch(contactsActions.reset());
            dispatch(sessionActions.clear());
            void disconnectSession();
            navigate('/connect');
          }}
        >
          Switch account
        </Button>
        <Tooltip title="More">
          <IconButton
            size="small"
            aria-label="More"
            onClick={(e) => setMoreAnchor(e.currentTarget)}
            sx={{ ml: 0.5 }}
          >
            <MoreVertIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Menu
          anchorEl={moreAnchor}
          open={moreAnchor !== null}
          onClose={() => setMoreAnchor(null)}
          slotProps={{ paper: { sx: { minWidth: 220 } } }}
        >
          <MenuItem
            onClick={() => {
              setMoreAnchor(null);
              void showLogs();
            }}
          >
            <ListItemIcon>
              <DescriptionOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Open Logs Folder</ListItemText>
          </MenuItem>
          <MenuItem
            onClick={() => {
              setMoreAnchor(null);
              setResetOpen(true);
            }}
            disabled={scanStatus === 'running' || cacheResetting}
          >
            <ListItemIcon>
              <DeleteSweepOutlinedIcon fontSize="small" sx={{ ml: 0.22 }} />
            </ListItemIcon>
            <ListItemText>
              {cacheResetting ? 'Clearing cache…' : 'Reset Cache'}
            </ListItemText>
          </MenuItem>
        </Menu>
      </Toolbar>

      <Dialog
        open={resetOpen}
        onClose={() => (cacheResetting ? null : setResetOpen(false))}
        // Snap the dialog away on confirm. The default 225ms exit fade
        // lets the user keep watching the (now stale) Results table
        // behind the dimming backdrop, which reads as a delay even
        // though the route already changed under the hood.
        transitionDuration={{ enter: 225, exit: 0 }}
      >
        <DialogTitle>Reset scan cache?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This will permanently delete all locally-cached messages, folder
            UID checkpoints, aggregated addresses, and the encrypted message
            body cache. Saved logins and your filter settings remain intact.
            The next scan will fetch from scratch.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setResetOpen(false)} disabled={cacheResetting}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={handleResetCache}
            disabled={cacheResetting}
          >
            {cacheResetting ? 'Clearing…' : 'Reset cache'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={resetToast !== null}
        autoHideDuration={3000}
        onClose={() => setResetToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {resetToast !== null ? (
          <Alert severity={resetToast.severity} onClose={() => setResetToast(null)}>
            {resetToast.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </AppBar>
  );
}
