import React, { useState } from 'react';
import { View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { correctionFactor, effortMinutes, startBy, capacityBefore } from '@/core/estimation';
import { describeLate, lateStatus } from '@/core/policies';
import { formatMinutes, relativeTime, addDaysYmd, localDateString, zonedToUtc } from '@/core/time';
import { courseScale, formatPercent, gradeBand } from '@/core/grades';
import { useSemester } from '@/data/derived';
import { dismissAssignment, logMetric, recordGrade, updateAssignment } from '@/data/actions';
import { Badge, Button, Card, Chip, Empty, Field, Row, Screen, Section, T } from '@/ui/components';
import { useColors } from '@/ui/theme';
import { dueLabel } from '@/ui/rows';
import { useSafeBack } from '@/ui/nav';

const ESTIMATES = [30, 60, 120, 240, 480];
const ACTUALS = [15, 30, 60, 120, 240];
const DUE_CHIPS: Array<{ label: string; days: number }> = [
  { label: 'Today', days: 0 }, { label: 'Tomorrow', days: 1 }, { label: '3 days', days: 3 },
  { label: '1 week', days: 7 }, { label: '2 weeks', days: 14 },
];

export default function AssignmentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const sem = useSemester();
  const router = useRouter();
  const back = useSafeBack('/');
  const c = useColors();
  const a = sem.rows.assignments.find((x) => x.id === id);
  const [earned, setEarned] = useState('');
  const [possible, setPossible] = useState('');
  const [showGrade, setShowGrade] = useState(false);

  if (!a) return <Screen><Empty title="Not found" body="This item may have been removed." /></Screen>;

  const course = sem.courseById.get(a.course_id);
  const ob = sem.obligations.find((o) => o.refId === a.id && o.kind === 'assignment');
  const comps = sem.componentsByCourse.get(a.course_id) ?? [];
  const comp = comps.find((k) => k.id === a.component_id);
  const exam = sem.rows.exams.find((e) => e.assignment_id === a.id);
  const today = localDateString(sem.now, sem.tz);

  const dueAt = ob?.dueAt ?? (a.due_at ? new Date(a.due_at) : null);
  const done = a.status === 'submitted' || a.status === 'graded' || a.status === 'dismissed';
  const isExam = a.type === 'exam';

  // ---- effort & start date ----
  const factor = correctionFactor(sem.samples, a.type);
  const effort = effortMinutes(a, sem.samples);
  const startPlan = dueAt && !done && !isExam ? startBy(dueAt, effort, sem.now, 90) : null;
  const capacity =
    dueAt && !done && !isExam
      ? capacityBefore(
          { dueAt, effort, id: a.id },
          sem.obligations.filter((o) => !o.done && o.kind === 'assignment').map((o) => ({ dueAt: o.dueAt, effort: effortMinutes({ type: o.type, estimated_minutes: o.estimatedMinutes }, sem.samples), id: o.refId })),
          sem.now, sem.tz, 90,
        )
      : null;

  // ---- late ----
  const late =
    dueAt && dueAt < sem.now && !done && a.type !== 'exam'
      ? lateStatus(dueAt, sem.policies.get(a.course_id)?.late_policy, sem.now)
      : null;

  const setDue = (days: number) =>
    updateAssignment(a, { due_at: zonedToUtc(addDaysYmd(today, days), '23:59', sem.tz).toISOString(), due_is_approximate: false });

  const finish = (minutes?: number) => {
    updateAssignment(a, { status: 'submitted', ...(minutes ? { actual_minutes: minutes } : {}) });
    if (minutes && a.estimated_minutes) logMetric('estimate_logged', { type: a.type, estimated: a.estimated_minutes, actual: minutes });
  };

  const saveGrade = () => {
    const e = Number(earned);
    const p = Number(possible || a.points_possible || 100);
    if (Number.isNaN(e) || Number.isNaN(p) || p <= 0) return;
    recordGrade(a, e, p);
    setShowGrade(false);
  };

  const grade = sem.grades.get(a.course_id);
  const pct = a.points_earned != null && a.points_possible ? (a.points_earned / a.points_possible) * 100 : null;

  return (
    <Screen>
      <Stack.Screen options={{ title: course?.code ?? '', headerTintColor: course?.color }} />
      <View style={{ gap: 6 }}>
        <T variant="title">{a.title}</T>
        <Row style={{ flexWrap: 'wrap' }}>
          {course ? <Badge label={course.name} tone="alt" /> : null}
          <Badge label={a.type} tone="alt" />
          {comp ? <Badge label={`${comp.name} · ${Math.round(comp.weight * 100)}%`} tone="primary" /> : null}
          {ob && ob.impact >= 1.5 ? <Badge label={`~${Math.round(ob.impact)}% of your grade`} tone="warn" /> : null}
        </Row>
        <T muted>{ob ? dueLabel(ob, sem.now, sem.tz) : 'No date yet'}{a.due_is_approximate && dueAt ? ' (the syllabus only gave a week)' : ''}</T>
      </View>

      {a.status === 'graded' && pct != null ? (
        <Card tone="good">
          <T variant="label" color={c.good}>Graded</T>
          <T variant="title">{a.points_earned}/{a.points_possible} · {formatPercent(pct)}</T>
          {grade?.percent != null ? (
            <T muted>
              Our estimate of your course grade is now {formatPercent(grade.percent)} ({gradeBand(grade.percent, courseScale(course)).letter}).
              {course?.official_grade ? ' Your college’s official number updates on its own schedule.' : ' Your college’s portal has the official number.'}
            </T>
          ) : null}
          <Button title="Change grade" small variant="ghost" onPress={() => { setEarned(String(a.points_earned)); setPossible(String(a.points_possible)); setShowGrade(true); }} />
        </Card>
      ) : null}

      {late ? (
        <Card tone={late.state === 'late_open' ? 'good' : 'alt'}>
          <T variant="heading">{describeLate(late) ?? ''}</T>
          {late.state === 'late_open' ? <T variant="small" muted>Handing it in now is almost always better than skipping it.</T> : <T variant="small" muted>You could still email the professor — some allow exceptions.</T>}
          <Row style={{ flexWrap: 'wrap' }}>
            {late.state === 'late_open' ? <Button title="I handed it in" small onPress={() => finish()} /> : null}
            <Button title="Draft an email" small variant="secondary" onPress={() => router.push(`/email?courseId=${a.course_id}&assignmentId=${a.id}`)} />
            {late.state !== 'late_open' ? <Button title="Let it go" small variant="ghost" onPress={() => { dismissAssignment(a); back(); }} /> : null}
          </Row>
        </Card>
      ) : null}

      {/* ---------------- date (only when the syllabus didn't give an exact one) ---------------- */}
      {!done && (!dueAt || a.due_is_approximate) ? (
        <Section title="When is it due?">
          <Row style={{ flexWrap: 'wrap' }}>
            {DUE_CHIPS.map((d) => <Chip key={d.label} label={d.label} small onPress={() => setDue(d.days)} />)}
          </Row>
          <T variant="small" muted>The syllabus only gave a rough date. Pick the real one when you learn it.</T>
        </Section>
      ) : null}

      {/* ---------------- status ---------------- */}
      {!done || a.status === 'submitted' ? (
        <Section title="Status">
          <Row style={{ flexWrap: 'wrap' }}>
            <Chip label="Not started" selected={a.status === 'todo'} onPress={() => updateAssignment(a, { status: 'todo' })} />
            <Chip label="Working on it" selected={a.status === 'in_progress'} onPress={() => updateAssignment(a, { status: 'in_progress' })} />
            <Chip label="Done" selected={a.status === 'submitted'} onPress={() => finish()} />
          </Row>
        </Section>
      ) : null}

      {/* ---------------- how long ---------------- */}
      {!isExam && !done ? (
        <Section title="How long will it take?">
          <Card>
            <Row style={{ flexWrap: 'wrap' }}>
              {ESTIMATES.map((m) => (
                <Chip key={m} label={formatMinutes(m)} small selected={a.estimated_minutes === m} onPress={() => updateAssignment(a, { estimated_minutes: m })} />
              ))}
            </Row>
            {factor.samples > 0 && Math.abs(factor.factor - 1) > 0.15 ? (
              <T variant="small">
                Your {a.type}s tend to run ~{factor.factor.toFixed(1)}× your estimate. Plan for about {formatMinutes(effort)}.
              </T>
            ) : (
              <T variant="small" muted>Plan for about {formatMinutes(effort)}. Tell us how long things really take and we'll adjust for you.</T>
            )}
            {startPlan ? (
              <T variant="body" style={{ fontWeight: '600' }}>
                {startPlan.startNow ? 'Start now — ' : `Start ${relativeTime(startPlan.startAt, sem.now, sem.tz)} — `}
                about {startPlan.daysNeeded} day{startPlan.daysNeeded === 1 ? '' : 's'} of ~90 min.
              </T>
            ) : null}
            {capacity && capacity.deficitMinutes > 0 ? (
              <T variant="small" color={c.warn}>
                This needs ~{formatMinutes(capacity.neededMinutes)}, and you have about {formatMinutes(capacity.availableMinutes)} unclaimed before it's due. Start early or ask for slack.
              </T>
            ) : null}
          </Card>
        </Section>
      ) : null}

      {/* ---------------- after done ---------------- */}
      {a.status === 'submitted' && !a.actual_minutes && !isExam ? (
        <Section title="How long did it actually take?">
          <Row style={{ flexWrap: 'wrap' }}>
            {ACTUALS.map((m) => <Chip key={m} label={formatMinutes(m)} small onPress={() => updateAssignment(a, { actual_minutes: m })} />)}
          </Row>
          <T variant="small" muted>One tap — this is how we learn your real pace.</T>
        </Section>
      ) : null}

      {/* ---------------- grade entry ---------------- */}
      {(a.status !== 'graded' || showGrade) && a.status !== 'dismissed' ? (
        <Section title={a.status === 'graded' ? 'Edit grade' : 'Got a grade back?'}>
          {showGrade || a.status === 'submitted' || isExam ? (
            <Card>
              <Row>
                <View style={{ flex: 1 }}><Field label="Points earned" value={earned} onChangeText={setEarned} keyboardType="decimal-pad" placeholder="87" /></View>
                <T muted style={{ marginTop: 18 }}>/</T>
                <View style={{ flex: 1 }}><Field label="Out of" value={possible} onChangeText={setPossible} keyboardType="decimal-pad" placeholder={String(a.points_possible ?? 100)} /></View>
              </Row>
              <Button title="Save grade" onPress={saveGrade} disabled={earned.trim() === ''} />
            </Card>
          ) : (
            <Button title="Enter a grade" variant="secondary" onPress={() => setShowGrade(true)} />
          )}
        </Section>
      ) : null}

      {comps.length > 0 && !a.component_id ? (
        <Section title="Which part of the grade is this?">
          <Row style={{ flexWrap: 'wrap' }}>
            {comps.map((k) => <Chip key={k.id} label={k.name} small onPress={() => updateAssignment(a, { component_id: k.id })} />)}
          </Row>
        </Section>
      ) : null}

      {isExam && exam ? <Button title="See what it covers" variant="secondary" onPress={() => router.push(`/course/${a.course_id}`)} /> : null}
      {!done ? <Button title="Not applicable — remove it" variant="ghost" small onPress={() => { dismissAssignment(a); back(); }} /> : null}
    </Screen>
  );
}
