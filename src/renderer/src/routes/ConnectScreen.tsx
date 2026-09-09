/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import { Sensitive } from '../../../shared/domain.js';
import type { AccountSummary } from '../../../shared/ipc-contracts.js';
import { useAppDispatch, useAppSelector } from '../store/hooks.js';
import * as connection from '../store/features/connection/actions.js';
import * as accounts from '../store/features/accounts/actions.js';
import * as session from '../store/features/session/actions.js';
import {
  SERVER_PRESETS,
  defaultPortFor,
} from '../store/features/connection/reducer.js';

function formatLastUsed(ts: number | null): string {
  if (ts === null) return 'never used';
  const d = new Date(ts);
  return `last used ${d.toLocaleString()}`;
}

export function ConnectScreen() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { form, testing, testStatus, error } = useAppSelector(
    (s) => s.connection,
  );
  const savedList = useAppSelector((s) => s.accounts.list);
  const accountsLoading = useAppSelector((s) => s.accounts.loading);
  const busyIdList = useAppSelector((s) => s.accounts.busyIds);
  const useSavedError = useAppSelector((s) => s.accounts.useSavedError);
  const navigateToScan = useAppSelector((s) => s.accounts.navigateToScan);

  // Refresh the saved-accounts list whenever the user lands on ConnectScreen
  // — they may have just deleted an account, finished a fresh scan, or come
  // back after a Switch action so the list might be stale.
  useEffect(() => {
    dispatch(accounts.fetch.request());
  }, [dispatch]);

  // useSaved.success drives an explicit hand-off to /scan (one-click "Use"
  // semantics, in contrast to "Test connection" which still routes through
  // the Continue button so the user can review the success state first).
  useEffect(() => {
    if (navigateToScan) {
      navigate('/scan', { replace: true });
      dispatch(accounts.navigationConsumed());
    }
  }, [navigateToScan, navigate, dispatch]);

  const isCustom = form.presetId === 'custom';
  const canTest =
    form.host.trim().length > 0 &&
    form.username.trim().length > 0 &&
    form.password.length > 0 &&
    Number.isFinite(form.port) &&
    form.port > 0;

  const handlePresetChange = (id: string): void => {
    const preset = SERVER_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    dispatch(
      connection.updateForm({
        presetId: id,
        host: preset.id === 'custom' ? form.host : preset.host,
        port: defaultPortFor(preset),
        tls: preset.tls,
      }),
    );
  };

  const handleTest = (): void => {
    if (!canTest) return;
    dispatch(
      connection.test.request({
        protocol: 'imap',
        host: form.host.trim(),
        port: form.port,
        tls: form.tls,
        username: form.username.trim(),
        password: Sensitive.parse(form.password),
        rememberMe: form.rememberMe,
      }),
    );
  };

  const handleContinue = (): void => {
    // Test passed and the user committed to this account — flip the
    // active session before routing so AppHeader picks it up immediately.
    dispatch(
      session.setActive({
        username: form.username.trim(),
        host: form.host.trim(),
      }),
    );
    navigate('/scan');
  };

  const handleUseSaved = (acc: AccountSummary): void => {
    dispatch(accounts.useSaved.request({ account: acc }));
  };

  const handleDelete = (acc: AccountSummary): void => {
    dispatch(accounts.remove.request({ id: acc.id }));
  };

  const continueDisabled = testStatus !== 'success';

  return (
    <Box sx={{ p: 4, maxWidth: 640, mx: 'auto' }}>
      <Stack spacing={3}>
        <Typography variant="h4">Connect</Typography>

        {savedList.length > 0 && (
          <Box aria-label="saved accounts">
            <Typography variant="h6" gutterBottom>
              Saved accounts
            </Typography>
            {useSavedError !== null && (
              <Alert severity="error" sx={{ mb: 1 }} role="alert">
                {useSavedError}
              </Alert>
            )}
            <List
              dense
              sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 0 }}
            >
              {savedList.map((acc) => {
                const busy = busyIdList.includes(acc.id);
                return (
                  <ListItem
                    key={acc.id}
                    secondaryAction={
                      <Stack direction="row" spacing={1}>
                        <Button
                          size="small"
                          variant="contained"
                          onClick={() => handleUseSaved(acc)}
                          disabled={busy || !acc.hasPassword}
                          aria-label={`Use ${acc.username}`}
                        >
                          {busy ? <CircularProgress size={18} /> : 'Use'}
                        </Button>
                        <Tooltip title="Forget this account">
                          <span>
                            <IconButton
                              size="small"
                              onClick={() => handleDelete(acc)}
                              disabled={busy}
                              aria-label={`Forget ${acc.username}`}
                            >
                              <DeleteOutlineIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                      </Stack>
                    }
                  >
                    <ListItemText
                      primary={`${acc.username} @ ${acc.host}`}
                      secondary={[
                        acc.port !== null ? `:${acc.port}` : '',
                        acc.tls ? ' · TLS' : '',
                        ' · ',
                        formatLastUsed(acc.lastUsedAt),
                      ].join('')}
                    />
                  </ListItem>
                );
              })}
            </List>
            <Divider sx={{ mt: 3 }}>
              <Typography variant="caption" color="text.secondary">
                or add a new account
              </Typography>
            </Divider>
          </Box>
        )}

        <Stack
          spacing={3}
          component="form"
          onSubmit={(e) => e.preventDefault()}
          aria-label="connect form"
        >
          <FormControl fullWidth>
            <InputLabel id="preset-label">Server preset</InputLabel>
            <Select
              labelId="preset-label"
              label="Server preset"
              value={form.presetId}
              onChange={(e) => handlePresetChange(e.target.value)}
            >
              {SERVER_PRESETS.map((p) => (
                <MenuItem key={p.id} value={p.id}>
                  {p.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Stack direction="row" spacing={2}>
            <TextField
              label="Host"
              value={form.host}
              disabled={!isCustom}
              onChange={(e) => {
                dispatch(connection.updateForm({ host: e.target.value }));
              }}
              sx={{ flex: 1 }}
            />
            <TextField
              label="Port"
              type="number"
              value={form.port}
              onChange={(e) => {
                dispatch(connection.updateForm({ port: Number(e.target.value) || 0 }));
              }}
              sx={{ width: 140 }}
            />
          </Stack>

          <TextField
            label="Username"
            value={form.username}
            onChange={(e) => {
              dispatch(connection.updateForm({ username: e.target.value }));
            }}
            autoComplete="username"
          />

          <TextField
            label="Password"
            type="password"
            value={form.password}
            onChange={(e) => {
              dispatch(connection.updateForm({ password: e.target.value }));
            }}
            autoComplete="current-password"
          />

          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={form.tls}
                  onChange={(e) => {
                    dispatch(connection.updateForm({ tls: e.target.checked }));
                  }}
                />
              }
              label="Use TLS / STARTTLS"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={form.rememberMe}
                  onChange={(e) => {
                    dispatch(connection.updateForm({ rememberMe: e.target.checked }));
                  }}
                />
              }
              label="Remember me on this device"
            />
          </Box>

          {testStatus === 'success' && (
            <Alert severity="success" role="status">
              IMAP connection successful — you can continue.
            </Alert>
          )}
          {testStatus === 'error' && error !== null && (
            <Alert severity="error" role="alert">
              {error}
            </Alert>
          )}

          <Stack direction="row" spacing={2}>
            <Button
              variant="outlined"
              onClick={handleTest}
              disabled={!canTest || testing}
              type="button"
            >
              {testing ? 'Testing…' : 'Test connection'}
            </Button>
            <Button
              variant="contained"
              onClick={handleContinue}
              disabled={continueDisabled}
              type="button"
            >
              Continue
            </Button>
            {accountsLoading && (
              <Box sx={{ display: 'flex', alignItems: 'center', pl: 1 }}>
                <CircularProgress size={18} />
              </Box>
            )}
          </Stack>
        </Stack>
      </Stack>
    </Box>
  );
}
