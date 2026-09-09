/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Box, CircularProgress, Stack, Typography } from '@mui/material';
import { useAppDispatch, useAppSelector } from '../store/hooks.js';
import * as bootstrap from '../store/features/bootstrap/actions.js';

// Drives the auto-resume flow on app start. Renders a centred splash while
// main rehydrates the saved credential; once the outcome is known either
// redirects to /scan (auto-connected) or hands control to the normal
// router (which lands on /connect with the form prefilled by the
// bootstrapPrefillEpic).
export function BootstrapGate({ children }: { children: ReactNode }) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const phase = useAppSelector((s) => s.bootstrap.phase);
  const outcome = useAppSelector((s) => s.bootstrap.outcome);

  // React.StrictMode (dev) runs effects twice, which would dispatch
  // bootstrap.start two times — the epic is not idempotent, so we'd hit
  // accounts.getLast / imap.connectSaved twice and end up with two
  // bootstrap.done actions, two distinct `outcome` references, and two
  // navigate('/scan') calls in the next effect.
  const bootstrapDispatchedRef = useRef(false);
  useEffect(() => {
    if (bootstrapDispatchedRef.current) return;
    if (phase === 'idle') {
      bootstrapDispatchedRef.current = true;
      dispatch(bootstrap.start());
    }
  }, [dispatch, phase]);

  // useNavigate's reference is recreated on each route change in
  // react-router v7. Including it in the dep array (which is required
  // by exhaustive-deps) made this effect re-fire after every navigation,
  // and since `phase === 'done' && outcome.kind === 'connected'` stays
  // true forever, it kept yanking the user back to /scan. The result
  // was a Scan ⇄ Results render storm. The ref guard makes the
  // auto-resume hand-off a strict one-shot per gate instance.
  const handedOffRef = useRef(false);
  useEffect(() => {
    if (handedOffRef.current) return;
    if (phase !== 'done' || outcome === null) return;
    handedOffRef.current = true;
    if (outcome.kind === 'connected') {
      navigate('/scan', { replace: true });
    }
  }, [phase, outcome, navigate]);

  if (phase !== 'done') {
    return (
      <Box
        role="status"
        aria-label="Restoring last session"
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Stack spacing={2} sx={{ alignItems: 'center' }}>
          <CircularProgress />
          <Typography variant="body2" color="text.secondary">
            Restoring last session…
          </Typography>
        </Stack>
      </Box>
    );
  }

  return <>{children}</>;
}
