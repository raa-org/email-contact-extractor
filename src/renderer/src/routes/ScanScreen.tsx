/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { findSentFolder, type ScanStatus } from '../store/features/scan/reducer.js';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Collapse,
  CircularProgress,
  Fade,
  FormControl,
  FormControlLabel,
  LinearProgress,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useAppDispatch, useAppSelector } from '../store/hooks.js';
import * as scan from '../store/features/scan/actions.js';
import { ChipListInput } from '../components/ChipListInput.js';
import { FilterFieldSet } from '../components/FilterFieldSet.js';
import { WordFilterChips } from '../components/WordFilterChips.js';
import { formatCount } from '../../../shared/format-count.js';
import { describeProgress, useStableLabel } from '../lib/progress-label.js';

export function ScanScreen() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const {
    folders,
    foldersLoading,
    foldersError,
    selectedFolders,
    includeDomains,
    excludeDomains,
    automationLocalParts,
    includeWordsInbound,
    excludeWordsInbound,
    includeWordsOutbound,
    excludeWordsOutbound,
    directionMode,
    minMessages,
    parseBodies,
    status,
    progress,
    error,
  } = useAppSelector((s) => s.scan);
  // Block scan-start while a cache reset is in flight: the IPC layer
  // wipes messages/folders/addresses inside one transaction, and a
  // concurrent scan would race for the same rows + risk losing the
  // headers that were just being ingested.
  const cacheResetting = useAppSelector((s) => s.cache.resetting);
  const [automationCollapsed, setAutomationCollapsed] = useState(false);

  useEffect(() => {
    if (folders.length === 0 && !foldersLoading && foldersError === null) {
      dispatch(scan.fetchFolders.request());
    }
  }, [folders.length, foldersLoading, foldersError, dispatch]);

  // Hand off to /results only on the *transition* into 'running' (i.e.
  // the user just clicked Start on this screen). Mounting with a non-idle
  // status — e.g. user came back from /results to reconfigure for a new
  // scan — must NOT bounce them straight back. The original idle→running
  // case still fires because prev starts as 'idle' on a fresh mount.
  const prevStatusRef = useRef<ScanStatus>(status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if (status === 'running' && prev !== 'running') {
      navigate('/results');
    }
  }, [status, navigate]);

  const inboxOnly =
    selectedFolders.length === 1 && selectedFolders[0]?.toUpperCase() === 'INBOX';
  const sentFolder = useMemo(() => findSentFolder(folders), [folders]);

  const toggleFolder = (path: string): void => {
    const next = selectedFolders.includes(path)
      ? selectedFolders.filter((p) => p !== path)
      : [...selectedFolders, path];
    dispatch(scan.setSelectedFolders(next));
  };

  const selectAll = (): void => {
    dispatch(scan.setSelectedFolders(folders.map((f) => f.path)));
  };
  const selectNone = (): void => {
    dispatch(scan.setSelectedFolders([]));
  };
  const selectInbox = (): void => {
    const inbox = folders.find((f) => f.path.toUpperCase() === 'INBOX');
    if (inbox) dispatch(scan.setSelectedFolders([inbox.path]));
  };

  // Domains are stored lowercased to match the aggregate filter; words
  // keep the user's original casing (subject matching is itself
  // case-insensitive at the pipeline level, but the chip should display
  // exactly what the user typed).
  const addIncludeDomain = (v: string): void => {
    dispatch(scan.setIncludeDomains([...includeDomains, v.toLowerCase()]));
  };
  const removeIncludeDomain = (v: string): void => {
    dispatch(scan.setIncludeDomains(includeDomains.filter((x) => x !== v)));
  };
  const addExcludeDomain = (v: string): void => {
    dispatch(scan.setExcludeDomains([...excludeDomains, v.toLowerCase()]));
  };
  const removeExcludeDomain = (v: string): void => {
    dispatch(scan.setExcludeDomains(excludeDomains.filter((x) => x !== v)));
  };
  const addAutomationLocalPart = (v: string): void => {
    dispatch(scan.setAutomationLocalParts([...automationLocalParts, v.toLowerCase()]));
  };
  const removeAutomationLocalPart = (v: string): void => {
    dispatch(scan.setAutomationLocalParts(automationLocalParts.filter((x) => x !== v)));
  };

  const handleStart = (): void => {
    dispatch(
      scan.start.request({
        folderInclude: [...selectedFolders],
        includeDomains: [...includeDomains],
        excludeDomains: [...excludeDomains],
        automationLocalParts: [...automationLocalParts],
        includeWordsInbound: [...includeWordsInbound],
        excludeWordsInbound: [...excludeWordsInbound],
        includeWordsOutbound: [...includeWordsOutbound],
        excludeWordsOutbound: [...excludeWordsOutbound],
        directionMode,
        minMessages,
        parseBodies,
      }),
    );
  };

  const handleCancel = (): void => {
    dispatch(scan.cancel());
  };

  // Live label from raw progress + dwell-time stabilisation: hot-cache
  // scans transition through fetching → aggregating → classifying in
  // <300 ms total, and we want each label to be readable rather than
  // smeared. The hook coalesces fast updates while the chip / typography
  // is mid-fade, then commits the latest one.
  const liveLabel = useMemo(() => describeProgress(progress), [progress]);
  const progressLabel = useStableLabel(liveLabel) ?? 'Preparing…';

  // Determinate progress only when we know the total. The body-scan
  // warmup emit and the connecting/enumerating phases all carry total=0;
  // the bar then shows indeterminate animation instead of sitting at 0%.
  const hasDeterminateTotal = !!progress && progress.total > 0;
  const percent = hasDeterminateTotal
    ? Math.min(100, Math.round((progress.processed / progress.total) * 100))
    : 0;
  const automationSummary =
    automationLocalParts.length > 0
      ? `${formatCount(automationLocalParts.length)} local-part${automationLocalParts.length === 1 ? '' : 's'}`
      : 'No automation local-parts';

  return (
    <Box sx={{ p: 4, maxWidth: 800, mx: 'auto' }}>
      <Stack spacing={3}>
        <Typography variant="h4">Scan</Typography>

        <Box>
          <Typography variant="h6" gutterBottom>
            Folders
          </Typography>
          {foldersError !== null && <Alert severity="error">{foldersError}</Alert>}
          {foldersError === null && (
            <>
              <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
                <Button
                  size="small"
                  onClick={
                    selectedFolders.length === folders.length ? selectNone : selectAll
                  }
                  disabled={folders.length === 0}
                >
                  {selectedFolders.length === folders.length ? 'Unselect all' : 'Select all'}
                </Button>
                <Button
                  size="small"
                  onClick={selectInbox}
                  disabled={inboxOnly || folders.length === 0}
                >
                  Inbox only
                </Button>
              </Stack>
              <Box
                sx={{
                  maxHeight: 240,
                  overflow: 'auto',
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: 1,
                }}
              >
                {folders.length === 0 ? (
                  <Stack
                    direction="row"
                    spacing={1.5}
                    sx={{ alignItems: 'center', justifyContent: 'center', py: 3 }}
                  >
                    <CircularProgress size={18} />
                    <Typography variant="body2" color="text.secondary">
                      Loading folders…
                    </Typography>
                  </Stack>
                ) : (
                  <List dense aria-label="folder list">
                    {folders.map((f) => {
                      const isSent = f === sentFolder;
                      const sentLocked = isSent && directionMode !== 'off';
                      return (
                        <ListItem
                          key={f.path}
                          disablePadding
                          secondaryAction={
                            sentLocked ? (
                              <Tooltip title="Locked while a Direction filter is active. Sent is the only folder with outbound messages, so the scan needs it in scope. Disable Direction to untick.">
                                <InfoOutlinedIcon
                                  fontSize="small"
                                  color="info"
                                  aria-label="Sent folder is required while Direction filter is active"
                                  sx={{ mr: 1 }}
                                />
                              </Tooltip>
                            ) : null
                          }
                        >
                          <ListItemButton
                            onClick={() => {
                              if (sentLocked) return;
                              toggleFolder(f.path);
                            }}
                            disabled={sentLocked}
                            dense
                          >
                            <ListItemIcon>
                              <Checkbox
                                edge="start"
                                checked={selectedFolders.includes(f.path)}
                                disabled={sentLocked}
                                tabIndex={-1}
                                disableRipple
                              />
                            </ListItemIcon>
                            <ListItemText
                              primary={f.path}
                              secondary={f.specialUse ?? ''}
                            />
                          </ListItemButton>
                        </ListItem>
                      );
                    })}
                  </List>
                )}
              </Box>
            </>
          )}
        </Box>

        <Box
          sx={{
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
            p: 2,
          }}
        >
          <Stack direction="row" sx={{ alignItems: 'center', mb: 1.5 }}>
            <Typography variant="h6" sx={{ flex: 1 }}>
              Filters
            </Typography>
            <Button
              size="small"
              onClick={() => dispatch(scan.resetFilters())}
            >
              Reset Filters
            </Button>
          </Stack>

          <Stack spacing={2}>
            <FilterFieldSet
              title="Direction"
              helperText="(click the active option again to disable)"
            >
              <FormControl>
                <RadioGroup
                  row
                  // RadioGroup expects a string value for one of its children;
                  // pass empty string when the filter is disabled so neither
                  // radio is selected.
                  value={directionMode === 'off' ? '' : directionMode}
                >
                  <FormControlLabel
                    value="bi"
                    control={
                      <Radio
                        size="small"
                        onClick={() =>
                          dispatch(
                            scan.setDirectionMode(directionMode === 'bi' ? 'off' : 'bi'),
                          )
                        }
                      />
                    }
                    label="Bi-directional (dialogue, ≥1 each side)"
                  />
                  <FormControlLabel
                    value="one"
                    control={
                      <Radio
                        size="small"
                        onClick={() =>
                          dispatch(
                            scan.setDirectionMode(directionMode === 'one' ? 'off' : 'one'),
                          )
                        }
                      />
                    }
                    label="One-directional (any side)"
                  />
                </RadioGroup>
                <TextField
                  size="small"
                  label="Min messages total"
                  type="number"
                  value={minMessages}
                  onChange={(e) => {
                    const n = Number.parseInt(e.target.value, 10);
                    if (Number.isFinite(n) && n >= 1) {
                      dispatch(scan.setMinMessages(n));
                    }
                  }}
                  disabled={directionMode === 'off'}
                  helperText={
                    directionMode === 'off'
                      ? 'No effect while Direction filter is disabled'
                      : ' '
                  }
                  slotProps={{ htmlInput: { min: 1, step: 1 } }}
                  sx={{ maxWidth: 240, mt: 1 }}
                />
              </FormControl>
            </FilterFieldSet>

            <FilterFieldSet
              title="Include domains"
              helperText="Whitelist; empty means all domains are allowed."
            >
              <ChipListInput
                label="Include domains (whitelist; empty = all)"
                placeholder="example.com"
                values={includeDomains}
                onAdd={addIncludeDomain}
                onRemove={removeIncludeDomain}
              />
            </FilterFieldSet>

            <FilterFieldSet
              title="Exclude domains"
              helperText="Contacts from these domains are excluded from the scan results."
            >
              <ChipListInput
                label="Exclude domains"
                placeholder="example.com"
                values={excludeDomains}
                onAdd={addExcludeDomain}
                onRemove={removeExcludeDomain}
              />
            </FilterFieldSet>

            <FilterFieldSet
              title="Automation local-parts"
              helperText="Exact email local-parts treated as automation addresses for this scan, for example support, billing, admin, or calendar."
            >
              <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}
              >
                <Typography variant="caption" color="text.secondary">
                  {automationSummary}
                </Typography>
                <Button
                  size="small"
                  variant="text"
                  endIcon={automationCollapsed ? <ExpandMoreIcon /> : <ExpandLessIcon />}
                  aria-expanded={!automationCollapsed}
                  aria-controls="automation-local-parts-panel"
                  aria-label={
                    automationCollapsed
                      ? 'Expand automation local-parts'
                      : 'Collapse automation local-parts'
                  }
                  onClick={() => setAutomationCollapsed((prev) => !prev)}
                >
                  {automationCollapsed ? 'Expand' : 'Collapse'}
                </Button>
              </Stack>
              <Collapse
                in={!automationCollapsed}
                id="automation-local-parts-panel"
                unmountOnExit
              >
                <ChipListInput
                  label="Automation local-parts"
                  placeholder="noreply"
                  values={automationLocalParts}
                  onAdd={addAutomationLocalPart}
                  onRemove={removeAutomationLocalPart}
                />
              </Collapse>
            </FilterFieldSet>
            <WordFilterChips
              parseBodies={parseBodies}
              inboundInclude={includeWordsInbound}
              inboundExclude={excludeWordsInbound}
              outboundInclude={includeWordsOutbound}
              outboundExclude={excludeWordsOutbound}
              onInboundIncludeChange={(v) => dispatch(scan.setIncludeWordsInbound(v))}
              onInboundExcludeChange={(v) => dispatch(scan.setExcludeWordsInbound(v))}
              onOutboundIncludeChange={(v) => dispatch(scan.setIncludeWordsOutbound(v))}
              onOutboundExcludeChange={(v) => dispatch(scan.setExcludeWordsOutbound(v))}
            />

            <Box>
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={parseBodies}
                    onChange={(e) => dispatch(scan.setParseBodies(e.target.checked))}
                  />
                }
                label="Parse message bodies"
              />
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block', ml: 4, mt: -0.5 }}
              >
                Required for body-text matching of Include/Exclude words.
                Bodies are fetched in a second pass only for contacts that
                pass the header filters and stored encrypted on disk, never
                in plain text.
              </Typography>
            </Box>
          </Stack>
        </Box>

        {status === 'running' && (
          <Box>
            {/* Fade the phase label on every transition: the `key` on the
                inner Typography forces a remount so MUI's Fade replays
                its 220ms in-out cubic-bezier. Without the key the same
                <Typography> is reused and the new text snaps in instantly,
                which reads as twitchy when phases change every couple of
                seconds (connecting → enumerating → fetching → …). */}
            <Fade key={progressLabel} in={true} timeout={220}>
              <Typography variant="body2" gutterBottom>
                {progressLabel}
              </Typography>
            </Fade>
            <LinearProgress
              variant={hasDeterminateTotal ? 'determinate' : 'indeterminate'}
              value={percent}
              sx={{
                // MUI's default 4ms transition on the bar makes the value
                // jump look choppy on per-message ticks. 200ms ease-out
                // gives the bar time to glide from one tick to the next
                // without lagging behind the actual processed count.
                '& .MuiLinearProgress-bar': {
                  transition: 'transform 200ms ease-out',
                },
              }}
            />
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                // tabular-nums keeps digit columns the same width so the
                // counter doesn't jiggle as it ticks through 1.0K → 1.1K →
                // 1.2K. Without this, proportional digits shift the
                // following text horizontally on every change.
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {progress && hasDeterminateTotal
                ? `${formatCount(progress.processed)} / ${formatCount(progress.total)}` +
                  (progress.etaSeconds !== undefined ? ` · ETA ${progress.etaSeconds}s` : '')
                : ''}
            </Typography>
          </Box>
        )}

        {status === 'error' && error !== null && (
          <Alert severity="error">{error}</Alert>
        )}

        <Stack direction="row" spacing={2}>
          <Tooltip
            title={
              cacheResetting
                ? 'Cache is being cleared — wait for the reset to finish'
                : ''
            }
            disableHoverListener={!cacheResetting}
          >
            <span>
              <Button
                variant="contained"
                onClick={handleStart}
                disabled={
                  status === 'running' ||
                  selectedFolders.length === 0 ||
                  cacheResetting
                }
              >
                {cacheResetting ? 'Clearing cache…' : 'Start scan'}
              </Button>
            </span>
          </Tooltip>
          <Button
            variant="outlined"
            color="warning"
            onClick={handleCancel}
            disabled={status !== 'running'}
          >
            Cancel
          </Button>
        </Stack>

      </Stack>
    </Box>
  );
}
