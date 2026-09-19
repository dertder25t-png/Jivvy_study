import { describe, expect, it } from 'vitest';
import { friendlyAuthError, initials, isValidEmail, normalizeEmail, passwordProblems, passwordStrength } from './auth';
import { IMPORT_ORDER, buildExport, exportFileName, hasMeaningfulData, prepareImport } from './exportData';

describe('email + password checks', () => {
  it('validates and normalizes emails', () => {
    expect(isValidEmail('  Alex@School.EDU ')).toBe(true);
    expect(normalizeEmail('  Alex@School.EDU ')).toBe('alex@school.edu');
    for (const bad of ['', 'alex', 'alex@', '@school.edu', 'a b@c.com', 'a@b']) expect(isValidEmail(bad)).toBe(false);
  });
  it('explains password problems in plain words', () => {
    expect(passwordProblems('short')).toEqual(['Use at least 8 characters.']);
    expect(passwordProblems('aaaaaaaaaa')[0]).toContain('one character repeated');
    expect(passwordProblems('Password123')[0]).toContain('common');
    expect(passwordProblems('correct horse battery')).toEqual([]);
  });
  it('rates strength sensibly', () => {
    expect(passwordStrength('')).toBe(0);
    expect(passwordStrength('short')).toBe(1);
    expect(passwordStrength('longenough')).toBe(2);
    expect(passwordStrength('correct horse battery staple')).toBe(3);
  });
});

describe('friendly auth errors', () => {
  it.each([
    ['Invalid login credentials', "don't match"],
    ['Email not confirmed', 'Confirm your email'],
    ['User already registered', 'already has an account'],
    ['Token has expired or is invalid', 'expired'],
    ['Email rate limit exceeded', 'Too many tries'],
    ['Failed to fetch', "Can't reach the server"],
    ['AuthRetryableFetchError', "Can't reach the server"],
    ['Password should be at least 6 characters', 'too weak'],
  ])('%s → plain language', (raw, expected) => {
    expect(friendlyAuthError(new Error(raw))).toContain(expected);
  });
  it('never dumps a giant raw error at the user', () => {
    expect(friendlyAuthError(new Error('x'.repeat(500)))).toBe('Something went wrong. Please try again.');
    expect(friendlyAuthError(undefined)).toBe('Something went wrong. Please try again.');
  });
});

describe('avatar initials', () => {
  it('uses names and email local-parts', () => {
    expect(initials('alex.smith@school.edu')).toBe('AS');
    expect(initials('Alex')).toBe('AL');
    expect(initials('')).toBe('?');
  });
});

describe('export', () => {
  it('lists every table in a stable, parent-first order', () => {
    const e = buildExport({ courses: [{ id: 'c1' }] }, new Date('2026-09-19T12:00:00Z'));
    expect(Object.keys(e.tables)).toEqual(IMPORT_ORDER);
    expect(e.counts.courses).toBe(1);
    expect(e.counts.notes).toBe(0);
    expect(exportFileName(new Date('2026-09-19T12:00:00Z'))).toBe('study-app-data-2026-09-19.json');
    expect(IMPORT_ORDER.indexOf('courses')).toBeLessThan(IMPORT_ORDER.indexOf('assignments'));
    expect(IMPORT_ORDER.indexOf('notes')).toBeLessThan(IMPORT_ORDER.indexOf('cards'));
  });
});

describe('importing device data into an account', () => {
  const local = {
    terms: [{ id: 't1' }],
    courses: [{ id: 'c1', term_id: 't1' }, { id: 'c2', term_id: 'ghost' }],
    grade_components: [{ id: 'g1', course_id: 'c1' }],
    assignments: [
      { id: 'a1', course_id: 'c1', component_id: 'g1' },
      { id: 'a2', course_id: 'c1', component_id: 'missing' }, // dangling optional link → cleared
      { id: 'a3', course_id: 'nope', component_id: null }, // required parent gone → dropped
    ],
    topics: [{ id: 'p1', course_id: 'c1' }],
    exams: [{ id: 'e1', course_id: 'c1', assignment_id: 'a1' }],
    exam_coverage: [{ exam_id: 'e1', topic_id: 'p1' }, { exam_id: 'e1', topic_id: 'zzz' }],
    notes: [{ id: 'n1', course_id: 'c1', topic_id: 'p1' }],
    cards: [{ id: 'k1', course_id: 'c1', topic_id: 'p1', source_note_id: 'n1' }],
    card_reviews: [{ id: 'r1', card_id: 'k1' }, { id: 'r2', card_id: 'gone' }],
  };

  it('keeps a consistent graph and reports what it dropped', () => {
    const p = prepareImport(local);
    expect(p.rows.courses!.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(p.rows.courses!.find((c) => c.id === 'c2')!.term_id).toBeNull(); // optional link cleared
    expect(p.rows.assignments!.map((a) => a.id)).toEqual(['a1', 'a2']);
    expect(p.rows.assignments!.find((a) => a.id === 'a2')!.component_id).toBeNull();
    expect(p.rows.exam_coverage).toHaveLength(1);
    expect(p.rows.card_reviews!.map((r) => r.id)).toEqual(['r1']);
    expect(p.skipped).toBe(3); // a3, the bad coverage row, r2
    expect(p.imported).toBe(Object.values(p.rows).flat().length);
  });

  it('is idempotent: rows the account already has are skipped', () => {
    const first = prepareImport(local);
    const second = prepareImport(local, first.rows);
    expect(second.imported).toBe(0);
    expect(second.skipped).toBeGreaterThan(0);
  });

  it('treats a course, note or card as meaningful data', () => {
    expect(hasMeaningfulData({})).toBe(false);
    expect(hasMeaningfulData({ terms: [{ id: 't' }] })).toBe(false);
    expect(hasMeaningfulData({ courses: [{ id: 'c' }] })).toBe(true);
  });
});
