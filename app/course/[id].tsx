import React, { useMemo, useState } from 'react';
import { Alert, Platform, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { bandByLetter, calibrationOffset, courseScale, formatPercent, gradeBand, neededOnComponent, officialPercent, reconcile, targetBands } from '@/core/grades';
import { attendanceBuffer, courseBuffers } from '@/core/policies';
import { coverageGaps } from '@/core/notes';
import { addDaysYmd, localDateString, relativeDay, relativeTime, zonedToUtc } from '@/core/time';
import { useSemester } from '@/data/derived';
import { addAbsence, addAssignment, deleteCourse, removeAbsence } from '@/data/actions';
import { Badge, Button, Card, Chip, Divider, Empty, Field, ProgressBar, Row, Screen, Section, T } from '@/ui/components';
import { ObligationRow } from '@/ui/rows';
import { useColors } from '@/ui/theme';

const DUE_CHIPS: Array<{ label: string; days: number }> = [
  { label: 'Today', days: 0 }, { label: 'Tomorrow', days: 1 }, { label: '3 days', days: 3 },
  { label: '1 week', days: 7 }, { label: '2 weeks', days: 14 },
];

export default function CourseDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const sem = useSemester();
  const router = useRouter();
  const c = useColors();
  const course = sem.courseById.get(id);

  const components = sem.componentsByCourse.get(id) ?? [];
  const assignments = sem.assignmentsByCourse.get(id) ?? [];
  const topics = (sem.topicsByCourse.get(id) ?? []).slice().sort((a, b) => (a.week_no ?? 0) - (b.week_no ?? 0));
  const exams = (sem.examsByCourse.get(id) ?? []).slice().sort((a, b) => a.happens_at.localeCompare(b.happens_at));
  const policy = sem.policies.get(id);
  const absences = sem.rows.absences.filter((a) => a.course_id === id);
  const grade = sem.grades.get(id);

  // ---- "what do I need" ----
  const pending = components.filter((k) => assignments.some((a) => a.component_id === k.id && a.status !== 'graded' && a.status !== 'dismissed'));
  const defaultComp = pending.find((k) => /final/i.test(k.name)) ?? [...pending].sort((a, b) => b.weight - a.weight)[0];
  const [compId, setCompId] = useState<string | null>(null);
  const [targetLetter, setTargetLetter] = useState<string | null>(null);
  const activeComp = components.find((k) => k.id === (compId ?? defaultComp?.id));
  // The college's own system is the official record. Prefer its number when the student has entered it.
  const scale = courseScale(course);
  const official = course?.official_grade ?? null;
  const officialPct = officialPercent(official, scale);
  const rec = reconcile(grade?.percent ?? null, official, scale);
  const calibration = calibrationOffset(grade?.percent ?? null, official);
  const standing = officialPct ?? grade?.percent ?? null;
  const currentLetter = standing != null ? gradeBand(standing, scale).letter : targetBands(scale)[0]?.letter ?? 'A';
  const target = bandByLetter(targetLetter ?? currentLetter, scale) ?? targetBands(scale)[0];
  const needed = activeComp && target ? neededOnComponent(components, assignments, activeComp.id, target.floor, calibration) : null;

  const buffers = useMemo(
    () => courseBuffers({ components, assignments, policy, absences, now: sem.now }),
    [components, assignments, policy, absences, sem.now],
  );
  const att = attendanceBuffer(policy?.attendance_policy, absences);

  // ---- current topic ----
  const today = localDateString(sem.now, sem.tz);
  const currentTopic = topics.find((t) => t.starts_on && t.starts_on <= today && (t.ends_on ?? t.starts_on) >= today);

  // ---- add assignment ----
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [dueDays, setDueDays] = useState<number | null>(null);
  const submitAssignment = () => {
    if (!title.trim()) return;
    addAssignment({
      course_id: id,
      title: title.trim(),
      due_at: dueDays != null ? zonedToUtc(addDaysYmd(today, dueDays), '23:59', sem.tz).toISOString() : null,
      due_is_approximate: dueDays == null,
    });
    setTitle('');
    setDueDays(null);
    setAdding(false);
  };

  const confirmDelete = () => {
    const go = () => {
      deleteCourse(id);
      router.replace('/courses');
    };
    if (Platform.OS === 'web') {
      if (window.confirm(`Delete ${course?.name} and everything in it?`)) go();
    } else {
      Alert.alert('Delete this course?', 'Its assignments, topics, notes links and cards go with it.', [
        { text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: go },
      ]);
    }
  };

  if (!course) return <Screen><Empty title="Course not found" /></Screen>;

  const open = sem.obligations
    .filter((o) => o.courseId === id && !o.done && o.kind !== 'waiting_on')
    .sort((a, b) => (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity));

  return (
    <Screen>
      <Stack.Screen options={{ title: course.code ?? course.name, headerTintColor: course.color }} />

      <View style={{ gap: 4 }}>
        <T variant="title">{course.name}</T>
        <T muted>{[course.instructor_name, course.section ? `Section ${course.section}` : null].filter(Boolean).join(' · ')}</T>
      </View>

      {/* ---------------- grade ---------------- */}
      <Card accent={course.color}>
        {official ? (
          <>
            <T variant="label" muted>Official grade · from your college</T>
            <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
              <T variant="big">{officialPct != null && official.percent != null ? formatPercent(official.percent) : official.letter}</T>
              <Badge label={official.letter ?? (officialPct != null ? gradeBand(officialPct, scale).letter : '')} tone="primary" />
            </Row>
            <T variant="small" muted>Updated {relativeTime(official.as_of, sem.now, sem.tz)}</T>
            {grade?.percent != null ? (
              <T variant="small" muted>Our estimate from the grades you've entered: {formatPercent(grade.percent)} ({gradeBand(grade.percent, scale).letter})</T>
            ) : null}
            {rec.message ? <T variant="small" color={rec.kind === 'close' ? c.good : c.warn}>{rec.message}</T> : null}
          </>
        ) : (
          <>
            <T variant="label" muted>Estimated grade</T>
            <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
              <T variant="big">{formatPercent(grade?.percent ?? null)}</T>
              {grade?.percent != null ? <Badge label={gradeBand(grade.percent, scale).letter} tone="alt" /> : null}
            </Row>
            <T variant="small" muted>
              Worked out from the grades you've entered{grade && grade.totalWeight > 0 ? ` (${Math.round((grade.gradedWeight / grade.totalWeight) * 100)}% of the course so far)` : ''}.
              Your college's system is the official number — add it for the real picture.
            </T>
          </>
        )}

        {components.length === 0 ? (
          <T variant="small" muted>No grade breakdown yet. It comes from the syllabus.</T>
        ) : (
          <View style={{ gap: 10, marginTop: 6 }}>
            {grade!.results.map((r) => (
              <View key={r.component.id} style={{ gap: 4 }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <T variant="small" style={{ fontWeight: '600' }}>{r.component.name} · {Math.round(r.component.weight * 100)}%</T>
                  <T variant="small" muted>
                    {r.percent != null ? formatPercent(r.percent) : 'not graded'}
                    {r.totalCount > 0 ? ` · ${r.gradedCount}/${r.totalCount}` : ''}
                  </T>
                </Row>
                <ProgressBar value={(r.percent ?? 0) / 100} color={course.color} />
              </View>
            ))}
          </View>
        )}
        <Row style={{ flexWrap: 'wrap', marginTop: 4 }}>
          <Button title={official ? 'Update official grade' : 'Enter official grade'} small variant="secondary" onPress={() => router.push(`/grading/${id}`)} />
          <Button title="Grading setup" small variant="ghost" onPress={() => router.push(`/grading/${id}`)} />
        </Row>
      </Card>

      {/* ---------------- what do I need ---------------- */}
      {activeComp && grade && target ? (
        <Card tone="primary">
          <T variant="label" color={c.primary}>What do I need?</T>
          <Row style={{ flexWrap: 'wrap' }}>
            {targetBands(scale).map((b) => (
              <Chip key={b.letter} label={b.letter} small selected={b.letter === target.letter} onPress={() => setTargetLetter(b.letter)} />
            ))}
          </Row>
          {pending.length > 1 ? (
            <Row style={{ flexWrap: 'wrap' }}>
              {pending.map((k) => (
                <Chip key={k.id} label={k.name} small selected={k.id === activeComp.id} onPress={() => setCompId(k.id)} />
              ))}
            </Row>
          ) : null}
          {needed ? (
            <T variant="heading">
              {needed.status === 'secured'
                ? `You've already locked in a ${target.letter} — even a zero on ${activeComp.name.toLowerCase()} won't change it.`
                : needed.status === 'out_of_reach'
                  ? `A ${target.letter} is out of reach now (you'd need ${Math.round(needed.needed)}% on ${activeComp.name.toLowerCase()}). Try a lower target.`
                  : `To finish with a ${target.letter}, you need about ${Math.ceil(needed.needed)}% on the remaining ${activeComp.name.toLowerCase()}.`}
            </T>
          ) : (
            <T variant="small" muted>Nothing left to grade in {activeComp.name}.</T>
          )}
          <T variant="small" muted>
            Assumes the rest of the ungraded work lands near your current average.
            {calibration !== 0 ? " Lined up with your college's number." : ''}
          </T>
        </Card>
      ) : null}

      {/* ---------------- buffers ---------------- */}
      {buffers.length > 0 || att.allowed != null ? (
        <Section title="Your buffers">
          <Card>
            {buffers.map((b, i) => (
              <View key={i} style={{ gap: 2 }}>
                {i > 0 ? <Divider /> : null}
                <T variant="body" style={{ fontWeight: '600' }}>{b.label}</T>
                <T variant="small" muted>{b.detail}</T>
              </View>
            ))}
            {att.allowed != null ? (
              <Row style={{ marginTop: 6 }}>
                <Button title="Log an absence" small variant="secondary" onPress={() => addAbsence(id)} />
                {absences.length > 0 ? <Button title="Undo last" small variant="ghost" onPress={() => removeAbsence(absences[absences.length - 1])} /> : null}
              </Row>
            ) : null}
          </Card>
        </Section>
      ) : null}

      {/* ---------------- exams ---------------- */}
      {exams.length > 0 ? (
        <Section title="Exams">
          {exams.map((e) => {
            const target = sem.examTargets.find((t) => t.examId === e.id);
            const ids = [...(target?.topicIds ?? [])];
            const gaps = coverageGaps({ topicIds: ids, topics, notes: sem.rows.notes.filter((n) => n.course_id === id) });
            const past = new Date(e.happens_at) < sem.now;
            return (
              <Card key={e.id}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <T variant="heading">{e.title}</T>
                  <T variant="small" muted>{relativeTime(e.happens_at, sem.now, sem.tz)}</T>
                </Row>
                <T variant="small" muted>
                  {ids.length > 0 ? `Covers ${ids.length} topic${ids.length === 1 ? '' : 's'}` : 'Coverage not listed'}
                  {e.is_cumulative ? ' · cumulative' : ''}
                  {e.location ? ` · ${e.location}` : ''}
                </T>
                {!past && gaps.length > 0 ? (
                  <T variant="small" color={c.warn}>
                    No notes yet for {gaps.length} of them: {gaps.slice(0, 3).map((g) => g.title).join(', ')}{gaps.length > 3 ? '…' : ''}
                  </T>
                ) : null}
                {!past ? <Button title="Review cards for this" small variant="secondary" onPress={() => router.push(`/cards/review?examId=${e.id}`)} /> : null}
              </Card>
            );
          })}
        </Section>
      ) : null}

      {/* ---------------- what's open ---------------- */}
      <Section title="Open in this course" right={<Button title="Add" small variant="ghost" onPress={() => setAdding((v) => !v)} />}>
        {adding ? (
          <Card>
            <Field label="What is it?" value={title} onChangeText={setTitle} placeholder="e.g. Problem set 3" autoFocus />
            <T variant="label" muted>Due</T>
            <Row style={{ flexWrap: 'wrap' }}>
              {DUE_CHIPS.map((d) => (
                <Chip key={d.label} label={d.label} small selected={dueDays === d.days} onPress={() => setDueDays(dueDays === d.days ? null : d.days)} />
              ))}
            </Row>
            <Button title="Add" onPress={submitAssignment} disabled={!title.trim()} />
          </Card>
        ) : null}
        <View style={{ gap: 8 }}>
          {open.slice(0, 12).map((o) => <ObligationRow key={o.id} o={o} sem={sem} />)}
          {open.length === 0 ? <T variant="small" muted>All caught up in this course.</T> : null}
          {open.length > 12 ? <T variant="small" muted>+{open.length - 12} more</T> : null}
        </View>
      </Section>

      {/* ---------------- topic schedule ---------------- */}
      {topics.length > 0 ? (
        <Section title="Weekly topics">
          <Card>
            {topics.map((t, i) => {
              const isNow = currentTopic?.id === t.id;
              const notes = sem.rows.notes.filter((n) => n.topic_id === t.id).length;
              const cards = sem.rows.cards.filter((k) => k.topic_id === t.id && k.status !== 'rejected' && k.status !== 'pending').length;
              return (
                <View key={t.id} style={{ gap: 2, opacity: t.ends_on && t.ends_on < today ? 0.7 : 1 }}>
                  {i > 0 ? <Divider /> : null}
                  <Row style={{ justifyContent: 'space-between' }}>
                    <T variant="body" style={{ fontWeight: isNow ? '700' : '500', flex: 1 }}>
                      {t.week_no != null ? `Wk ${t.week_no} · ` : ''}{t.title}
                    </T>
                    {isNow ? <Badge label="this week" tone="primary" /> : t.starts_on ? <T variant="small" muted>{relativeDay(t.starts_on, sem.now, sem.tz)}</T> : null}
                  </Row>
                  {t.readings || notes || cards ? (
                    <T variant="small" muted>
                      {[t.readings, notes ? `${notes} note${notes === 1 ? '' : 's'}` : null, cards ? `${cards} card${cards === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')}
                    </T>
                  ) : null}
                </View>
              );
            })}
          </Card>
        </Section>
      ) : null}

      <Section title="Tools">
        <Row style={{ flexWrap: 'wrap' }}>
          <Button title="Email the professor" variant="secondary" onPress={() => router.push(`/email?courseId=${id}`)} />
          <Button title="Add cards" variant="secondary" onPress={() => router.push(`/cards/new?courseId=${id}`)} />
        </Row>
      </Section>

      <Button title="Delete this course" variant="danger" small onPress={confirmDelete} />
    </Screen>
  );
}
