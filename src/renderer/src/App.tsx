/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { useMemo } from 'react';
import { Provider } from 'react-redux';
import { HashRouter, Navigate, Route, Routes } from 'react-router';
import { CssBaseline, ThemeProvider, useMediaQuery } from '@mui/material';
import { ErrorBoundary } from './error-boundary.js';
import { createStore } from './store/index.js';
import { pickTheme } from './theme.js';
import { ConnectScreen } from './routes/ConnectScreen.js';
import { ScanScreen } from './routes/ScanScreen.js';
import { ResultsScreen } from './routes/ResultsScreen.js';
import { BootstrapGate } from './components/BootstrapGate.js';
import { AppHeader } from './components/AppHeader.js';

const store = createStore();

export function App() {
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const theme = useMemo(() => pickTheme(prefersDark), [prefersDark]);

  return (
    <Provider store={store}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <ErrorBoundary>
          <HashRouter>
            <BootstrapGate>
              <AppHeader />
              <Routes>
                <Route path="/" element={<Navigate to="/connect" replace />} />
                <Route path="/connect" element={<ConnectScreen />} />
                <Route path="/scan" element={<ScanScreen />} />
                <Route path="/results" element={<ResultsScreen />} />
                <Route path="*" element={<Navigate to="/connect" replace />} />
              </Routes>
            </BootstrapGate>
          </HashRouter>
        </ErrorBoundary>
      </ThemeProvider>
    </Provider>
  );
}
