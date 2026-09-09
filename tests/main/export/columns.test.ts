/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest';
import {
  COLUMN_REGISTRY,
  DEFAULT_COLUMNS,
  resolveColumns,
} from '../../../src/main/export/columns.js';
import { makeContact } from './_helpers.js';

describe('column registry', () => {
  it('exposes 8 columns with the labels from the task spec', () => {
    expect(Object.keys(COLUMN_REGISTRY)).toHaveLength(8);
    expect(COLUMN_REGISTRY.email.label).toBe('Email');
    expect(COLUMN_REGISTRY.displayNames.label).toBe('Display Names');
    expect(COLUMN_REGISTRY.firstSeenUtc.label).toBe('First Message');
    expect(COLUMN_REGISTRY.lastSeenUtc.label).toBe('Last Message');
    expect(COLUMN_REGISTRY.total.label).toBe('Total Messages');
    expect(COLUMN_REGISTRY.countIn.label).toBe('Inbound');
    expect(COLUMN_REGISTRY.countOut.label).toBe('Outbound');
    expect(COLUMN_REGISTRY.subjectsSample.label).toBe('Sample Subjects');
  });

  it('marks all columns as visible by default', () => {
    for (const def of Object.values(COLUMN_REGISTRY)) {
      expect(def.defaultVisible).toBe(true);
    }
  });

  it('default order matches the spec', () => {
    expect([...DEFAULT_COLUMNS]).toEqual([
      'email',
      'displayNames',
      'firstSeenUtc',
      'lastSeenUtc',
      'total',
      'countIn',
      'countOut',
      'subjectsSample',
    ]);
  });

  it('resolveColumns falls back to defaults on empty/missing input', () => {
    expect(resolveColumns().map((c) => c.id)).toEqual([...DEFAULT_COLUMNS]);
    expect(resolveColumns([]).map((c) => c.id)).toEqual([...DEFAULT_COLUMNS]);
  });

  it('resolveColumns preserves user-supplied order', () => {
    const got = resolveColumns(['total', 'email', 'subjectsSample']);
    expect(got.map((c) => c.id)).toEqual(['total', 'email', 'subjectsSample']);
  });

  it('joins arrays in displayNames and subjectsSample getters', () => {
    const c = makeContact({
      displayNames: ['Jane', 'J. Doe'],
      subjectsSample: ['Greetings', 'Re: Greetings'],
    });
    expect(COLUMN_REGISTRY.displayNames.getter(c)).toBe('Jane, J. Doe');
    expect(COLUMN_REGISTRY.subjectsSample.getter(c)).toBe('Greetings | Re: Greetings');
  });

  it('numeric getters return numbers (not strings)', () => {
    const c = makeContact({ total: 42, countIn: 30, countOut: 12 });
    expect(COLUMN_REGISTRY.total.getter(c)).toBe(42);
    expect(COLUMN_REGISTRY.countIn.getter(c)).toBe(30);
    expect(COLUMN_REGISTRY.countOut.getter(c)).toBe(12);
  });
});
