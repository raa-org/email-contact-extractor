/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest';
import { isAutomationLocalPart } from '../../../../src/main/classifier/rules/is-automation-localpart.js';
import {
  DEFAULT_AUTOMATION_LOCAL_PART_REGEX,
  automationLocalPartRegexFromList,
} from '../../../../src/shared/heuristics-config.js';

describe('isAutomationLocalPart', () => {
  it('positive: noreply / no-reply / donotreply', () => {
    expect(isAutomationLocalPart('noreply@x.com', DEFAULT_AUTOMATION_LOCAL_PART_REGEX)).toBe(true);
    expect(isAutomationLocalPart('no-reply@x.com', DEFAULT_AUTOMATION_LOCAL_PART_REGEX)).toBe(true);
    expect(isAutomationLocalPart('donotreply@x.com', DEFAULT_AUTOMATION_LOCAL_PART_REGEX)).toBe(true);
    expect(isAutomationLocalPart('do-not-reply@x.com', DEFAULT_AUTOMATION_LOCAL_PART_REGEX)).toBe(true);
  });

  it('positive: notifications / alerts / mailer-daemon', () => {
    expect(isAutomationLocalPart('notifications@x.com', DEFAULT_AUTOMATION_LOCAL_PART_REGEX)).toBe(true);
    expect(isAutomationLocalPart('alert@x.com', DEFAULT_AUTOMATION_LOCAL_PART_REGEX)).toBe(true);
    expect(isAutomationLocalPart('alerts@x.com', DEFAULT_AUTOMATION_LOCAL_PART_REGEX)).toBe(true);
    expect(isAutomationLocalPart('mailer-daemon@x.com', DEFAULT_AUTOMATION_LOCAL_PART_REGEX)).toBe(true);
  });

  it('positive: noreply- prefix', () => {
    expect(isAutomationLocalPart('noreply-12345@x.com', DEFAULT_AUTOMATION_LOCAL_PART_REGEX)).toBe(true);
    expect(isAutomationLocalPart('no-reply-deadbeef@x.com', DEFAULT_AUTOMATION_LOCAL_PART_REGEX)).toBe(true);
  });

  it('positive: postmaster / bounce / system', () => {
    expect(isAutomationLocalPart('postmaster@x.com', DEFAULT_AUTOMATION_LOCAL_PART_REGEX)).toBe(true);
    expect(isAutomationLocalPart('bounces@x.com', DEFAULT_AUTOMATION_LOCAL_PART_REGEX)).toBe(true);
    expect(isAutomationLocalPart('system@x.com', DEFAULT_AUTOMATION_LOCAL_PART_REGEX)).toBe(true);
  });

  it('negative: human local part', () => {
    expect(isAutomationLocalPart('jane.doe@x.com', DEFAULT_AUTOMATION_LOCAL_PART_REGEX)).toBe(false);
    expect(isAutomationLocalPart('alice@example.com', DEFAULT_AUTOMATION_LOCAL_PART_REGEX)).toBe(false);
  });

  it('case-insensitive', () => {
    expect(isAutomationLocalPart('NoReply@x.com', DEFAULT_AUTOMATION_LOCAL_PART_REGEX)).toBe(true);
    expect(isAutomationLocalPart('NOTIFICATIONS@x.com', DEFAULT_AUTOMATION_LOCAL_PART_REGEX)).toBe(true);
  });

  it('edge: empty string and malformed input', () => {
    expect(isAutomationLocalPart('', DEFAULT_AUTOMATION_LOCAL_PART_REGEX)).toBe(false);
    expect(isAutomationLocalPart('not-an-email', DEFAULT_AUTOMATION_LOCAL_PART_REGEX)).toBe(false);
  });

  it('respects an injected regex', () => {
    expect(isAutomationLocalPart('robot@x.com', /^robot$/i)).toBe(true);
    expect(isAutomationLocalPart('alice@x.com', /^robot$/i)).toBe(false);
  });

  it('builds exact local-part matching while preserving noreply prefix handling', () => {
    const regex = automationLocalPartRegexFromList(['robot']);
    expect(isAutomationLocalPart('robot@x.com', regex)).toBe(true);
    expect(isAutomationLocalPart('support@x.com', regex)).toBe(false);
    expect(isAutomationLocalPart('noreply-123@x.com', regex)).toBe(true);
  });
});
