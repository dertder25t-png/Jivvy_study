import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { summarizeParse, type NormalizedSyllabus } from '@/core/syllabus/normalize';
import { describeLatePolicy } from '@/core/email';
import { localDateString, zonedParts, zonedToUtc } from '@/core/time';
import { commitSyllabus } from '@/data/actions';
import { pendingParse } from '@/data/pending';
import { prefs } from '@/data/prefs';
import { ensurePermission } from '@/notifications/schedule';
import { Badge, Button, Card, Divider, Empty, Field, Row, Screen, Section, T } from '@/ui/components';
import { useColors } from '@/ui/theme';
import { DateField, PercentField } from '@/ui/fields';
import { useSafeBack } from '@/ui/nav';

const pad = (n: number) => String(n).padStart(2, '0');

export default function ReviewParse() {
  const router = useRouter();
  const back = useSafeBack('/syllabus/add');
  const c = useColors();
  const pending = pendingParse.get();
  const tz = prefs.get().tz;
  const [n, setN] = useState<NormalizedSyllabus | null>(pending?.normalized ?? null);
  const [edits, setEdits] = useState<Record<string, number>>({});
  const [showAll, setShowAll] = useState(false);

  const bump = (field: string) => setEdits((e) => ({ ...e, [field]: (e[field] ?? 0) + 1 }));

  const weightTotal = useMemo(() => Math.round((n?.components.reduce((s, k) => s + k.weight, 0) ?? 0) * 100), [n]);

  if (!pending || !n) {
    return <Screen><Empty title="Nothing to review" body="Start from “Add a syllabus”." action={<Button title="Go back" onPress={back} />} /></Screen>;
  }

  const patch = (fn: (draft: NormalizedSyllabus) => NormalizedSyllabus) => setN((cur) => (cur ? fn(cur) : cur));

  const setDate = (iso: string | null, ymd: string): string | null => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return iso;
    const t = iso ? zonedParts(new Date(iso), tz) : null;
    const time = t ? `${pad(t.h)}:${pad(t.min)}` : '23:59';
    const d = zonedToUtc(ymd, time, tz);
    return Number.isNaN(d.getTime()) ? iso : d.toISOString();
  };
  const ymdOf = (iso: string | null) => (iso ? localDateString(new Date(iso), tz) : '');

  const confirm = () => {
    commitSyllabus({
      normalized: n,
      parsed: pending.result.parsed,
      rawText: pending.result.rawText,
      contentHash: pending.result.contentHash,
      filePath: pending.result.filePath,
      cacheHit: pending.result.cacheHit,
      edits,
      termId: pending.termId,
    });
    pendingParse.set(null);
    void ensurePermission();
    if (router.canDismiss()) router.dismissAll();
    router.replace('/');
  };

  const shown = showAll ? n.assignments : n.assignments.slice(0, 8);
  const late = describeLatePolicy(n.late_policy);
  const totalEdits = Object.values(edits).reduce((s, x) => s + x, 0);

  return (
    <Screen footer={<Button title="Looks right — build my semester" onPress={confirm} />}>
      <Card tone="primary">
        <T variant="label" color={c.primary}>Here's what we found</T>
        <T variant="title">{summarizeParse(n)}</T>
        <T muted>Look right? Fix anything off below — nothing is saved until you confirm.{pending.result.cacheHit ? ' (A classmate already uploaded this one, so this was instant.)' : ''}</T>
      </Card>

      {n.issues.length > 0 ? (
        <Card tone="warn">
          {n.issues.map((i, k) => (
            <T key={k} variant="small">{i.severity === 'warn' ? '⚠︎ ' : '• '}{i.message}</T>
          ))}
        </Card>
      ) : null}

      <Section title="Course">
        <Card>
          <Field label="Name" value={n.course.name} onChangeText={(v) => patch((d) => ({ ...d, course: { ...d.course, name: v } }))} onBlur={() => bump('course_name')} />
          <Row>
            <View style={{ flex: 1 }}><Field label="Code" value={n.course.code ?? ''} onChangeText={(v) => patch((d) => ({ ...d, course: { ...d.course, code: v || null } }))} onBlur={() => bump('course_code')} /></View>
            <View style={{ flex: 1 }}><Field label="Instructor" value={n.course.instructor_name ?? ''} onChangeText={(v) => patch((d) => ({ ...d, course: { ...d.course, instructor_name: v || null } }))} onBlur={() => bump('instructor')} /></View>
          </Row>
          <Field label="Instructor email" value={n.course.instructor_email ?? ''} autoCapitalize="none" keyboardType="email-address" onChangeText={(v) => patch((d) => ({ ...d, course: { ...d.course, instructor_email: v || null } }))} onBlur={() => bump('instructor_email')} />
        </Card>
      </Section>

      <Section title="Grade breakdown" right={<Badge label={`${weightTotal}%`} tone={Math.abs(weightTotal - 100) <= 2 ? 'good' : 'warn'} />}>
        <Card>
          {n.components.length === 0 ? <T variant="small" muted>None found.</T> : null}
          {n.components.map((k, i) => (
            <View key={k.key}>
              {i > 0 ? <Divider /> : null}
              <Row style={{ paddingVertical: 4 }}>
                <T style={{ flex: 1 }}>{k.name}{k.drop_lowest ? ` (drop ${k.drop_lowest})` : ''}{k.expected_count ? ` · ×${k.expected_count}` : ''}</T>
                <PercentField
                  value={k.weight}
                  onCommit={(num) => {
                    patch((d) => ({ ...d, components: d.components.map((x) => (x.key === k.key ? { ...x, weight: num / 100 } : x)) }));
                    bump('weight');
                  }}
                />
                <T muted>%</T>
              </Row>
            </View>
          ))}
        </Card>
      </Section>

      {n.exams.length > 0 ? (
        <Section title="Exams">
          <Card>
            {n.exams.map((e, i) => (
              <View key={i}>
                {i > 0 ? <Divider /> : null}
                <Row style={{ paddingVertical: 4 }}>
                  <View style={{ flex: 1 }}>
                    <T style={{ fontWeight: '600' }}>{e.title}</T>
                    <T variant="small" muted>
                      {e.topic_indexes.length} topic{e.topic_indexes.length === 1 ? '' : 's'}{e.coverage_inferred ? ' (guessed)' : ''}{e.is_cumulative ? ' · cumulative' : ''}
                    </T>
                  </View>
                  <DateField
                    value={ymdOf(e.happens_at)}
                    onCommit={(v) => {
                      const iso = setDate(e.happens_at, v);
                      if (iso && iso !== e.happens_at) {
                        patch((d) => ({
                          ...d,
                          exams: d.exams.map((x, xi) => (xi === i ? { ...x, happens_at: iso } : x)),
                          assignments: d.assignments.map((a, ai) => (ai === e.assignment_index ? { ...a, due_at: iso } : a)),
                        }));
                        bump('exam_date');
                      }
                    }}
                  />
                </Row>
              </View>
            ))}
          </Card>
        </Section>
      ) : null}

      {n.quizzes.length > 0 ? (
        <Section title={`Quizzes (${n.quizzes.length})`}>
          <Card>
            {n.quizzes.map((q, i) => (
              <View key={i}>
                {i > 0 ? <Divider /> : null}
                <Row style={{ paddingVertical: 4 }}>
                  <View style={{ flex: 1 }}>
                    <Field
                      value={q.title}
                      onChangeText={(v) => patch((d) => ({ ...d, quizzes: d.quizzes.map((x, xi) => (xi === i ? { ...x, title: v } : x)) }))}
                      onBlur={() => bump('quiz_title')}
                    />
                    <T variant="small" muted>
                      {q.type ? `${q.type} · ` : ''}{q.frequency || 'one-time'}{q.points_possible ? ` · ${q.points_possible} pts` : ''}
                    </T>
                  </View>
                  <DateField
                    value={ymdOf(q.due_at)}
                    placeholder="YYYY-MM-DD"
                    onCommit={(v) => {
                      const iso = setDate(q.due_at, v);
                      if (iso !== q.due_at) {
                        patch((d) => ({ ...d, quizzes: d.quizzes.map((x, xi) => (xi === i ? { ...x, due_at: iso, due_is_approximate: false } : x)) }));
                        bump('quiz_date');
                      }
                    }}
                  />
                </Row>
              </View>
            ))}
          </Card>
        </Section>
      ) : null}

      <Section title={`Assignments (${n.assignments.filter((a) => a.type !== 'exam').length})`}>
        <Card>
          {shown.map((a, i) => {
            if (a.type === 'exam') return null;
            const realIndex = i;
            return (
              <View key={realIndex}>
                {i > 0 ? <Divider /> : null}
                <Row style={{ paddingVertical: 4 }}>
                  <View style={{ flex: 1 }}>
                    <Field
                      value={a.title}
                      onChangeText={(v) => patch((d) => ({ ...d, assignments: d.assignments.map((x, xi) => (xi === realIndex ? { ...x, title: v } : x)) }))}
                      onBlur={() => bump('assignment_title')}
                    />
                    {a.due_is_approximate ? <T variant="small" color={c.warn}>Approximate — check the date</T> : null}
                  </View>
                  <DateField
                    value={ymdOf(a.due_at)}
                    placeholder="YYYY-MM-DD"
                    onCommit={(v) => {
                      const iso = setDate(a.due_at, v);
                      if (iso !== a.due_at) {
                        patch((d) => ({ ...d, assignments: d.assignments.map((x, xi) => (xi === realIndex ? { ...x, due_at: iso, due_is_approximate: false } : x)) }));
                        bump('assignment_date');
                      }
                    }}
                  />
                  <Pressable
                    accessibilityLabel={`Remove ${a.title}`}
                    hitSlop={8}
                    onPress={() => {
                      patch((d) => ({
                        ...d,
                        assignments: d.assignments.filter((_, xi) => xi !== realIndex),
                        // keep exam → assignment links pointing at the right rows
                        exams: d.exams.map((e) => ({ ...e, assignment_index: e.assignment_index > realIndex ? e.assignment_index - 1 : e.assignment_index })),
                      }));
                      bump('assignment_removed');
                    }}
                  >
                    <T muted style={{ fontSize: 22, paddingHorizontal: 6 }}>×</T>
                  </Pressable>
                </Row>
              </View>
            );
          })}
          {n.assignments.length > 8 ? (
            <Button title={showAll ? 'Show fewer' : `Show all ${n.assignments.length}`} variant="ghost" small onPress={() => setShowAll((v) => !v)} />
          ) : null}
        </Card>
      </Section>

      <Section title="Policies">
        <Card>
          <T variant="small">{late ?? 'No late policy found.'}</T>
          {n.attendance_policy.allowed_absences != null ? (
            <T variant="small">Attendance: {n.attendance_policy.allowed_absences} absences allowed{n.attendance_policy.penalty ? ` — ${n.attendance_policy.penalty}` : ''}</T>
          ) : null}
          {n.policy_notes ? <T variant="small" muted>{n.policy_notes}</T> : null}
          {n.components.some((k) => k.drop_lowest > 0) ? <T variant="small">Drop-lowest rules found and will be tracked for you.</T> : null}
        </Card>
      </Section>

      <T variant="small" muted>{totalEdits > 0 ? `${totalEdits} edit${totalEdits === 1 ? '' : 's'} so far.` : 'No edits yet.'} Topics: {n.topics.length} weeks.</T>
    </Screen>
  );
}
