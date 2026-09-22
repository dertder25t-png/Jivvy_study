import { describe, expect, it } from 'vitest';
import { coerceParsed } from '../../supabase/functions/_shared/syllabus-schema';
import { courseBuffers } from './policies';
import { mkAssignment, mkComponent, mkCourse } from './testutil';

describe('coerceParsed (defends against old / partial cached parses)', () => {
  it('fills defaults', () => {
    const p = coerceParsed({ course: { name: 'Bio' }, assignments: [{ title: 'HW', type: 'homework' }] });
    expect(p.assignments[0]).toMatchObject({ title: 'HW', type: 'other', due_date: null, due_is_approximate: false });
    expect(p.exams).toEqual([]);
    expect(p.policies.late.accepted).toBeNull();
  });
  it('rejects a parse with no course name', () => {
    expect(() => coerceParsed({})).toThrow();
    expect(() => coerceParsed({ course: {} })).toThrow();
  });
  it('drops malformed rows instead of crashing', () => {
    const p = coerceParsed({ course: { name: 'X' }, grade_components: [{ name: 'A', weight: 'lots' }, { name: 'B', weight: 0.5 }], assignments: [null, { nope: 1 }] });
    expect(p.grade_components.map((c) => c.name)).toEqual(['B']);
    expect(p.assignments).toEqual([]);
  });
});

describe('drop-lowest buffers count missed work as a spent drop', () => {
  const NOW = new Date('2026-09-19T15:00:00Z');
  it('reports the drop as used on a lapsed assignment', () => {
    const course = mkCourse();
    const labs = mkComponent(course.id, { name: 'Lab reports', drop_lowest: 1 });
    const missed = mkAssignment(course.id, { title: 'Lab report 2', component_id: labs.id, due_at: '2026-09-01T00:00:00Z' });
    const policy = { course_id: course.id, late_policy: { accepted: true, window_hours: 48, penalty_per_day: 0.2 }, attendance_policy: {}, notes: null };
    const [b] = courseBuffers({ components: [labs], assignments: [missed], policy, absences: [], now: NOW });
    expect(b.detail).toContain('Already used on a missed one (Lab report 2)');
  });
  it('says nothing spent when nothing lapsed', () => {
    const course = mkCourse();
    const labs = mkComponent(course.id, { name: 'Lab reports', drop_lowest: 2 });
    const future = mkAssignment(course.id, { component_id: labs.id, due_at: '2026-10-01T00:00:00Z' });
    const [b] = courseBuffers({ components: [labs], assignments: [future], policy: undefined, absences: [], now: NOW });
    expect(b.detail).toContain('Nothing spent yet');
  });
});
