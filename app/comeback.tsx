import React, { useEffect, useMemo } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { buildComeback } from '@/core/triage';
import { describeLate } from '@/core/policies';
import { relativeTime } from '@/core/time';
import { dismissMany, logMetric } from '@/data/actions';
import { useSemester } from '@/data/derived';
import { impactLabel, dueLabel } from '@/ui/rows';
import { Badge, Button, Card, Empty, Row, Screen, Section, T } from '@/ui/components';
import { useColors } from '@/ui/theme';

/**
 * Never open on a wall of 40 red overdue items — that produces shame, which
 * produces deletion. Three calm sections, sorted by grade impact.
 */
export default function Comeback() {
  const sem = useSemester();
  const router = useRouter();
  const c = useColors();

  const plan = useMemo(
    () => buildComeback({ obligations: sem.obligations, policies: sem.policies, now: sem.now }),
    [sem.obligations, sem.policies, sem.now],
  );

  useEffect(() => {
    logMetric('comeback_shown', { salvageable: plan.salvageable.length, dead: plan.dead.length });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const deadByCourse = useMemo(() => {
    const m = new Map<string, typeof plan.dead>();
    for (const o of plan.dead) {
      const k = o.courseId ?? 'none';
      m.set(k, [...(m.get(k) ?? []), o]);
    }
    return [...m.entries()];
  }, [plan]);

  const clearDead = (ids: string[]) => {
    const rows = sem.rows.assignments.filter((a) => ids.includes(`assignment:${a.id}`));
    dismissMany(rows);
  };

  const nothing = plan.salvageable.length === 0 && plan.dead.length === 0 && !plan.oneThing;

  return (
    <Screen footer={<Button title="Take me to my list" onPress={() => router.replace('/')} />}>
      <View style={{ gap: 4 }}>
        <T variant="title">Welcome back.</T>
        <T muted>No judgment — here's what's actually worth your time, biggest first.</T>
      </View>

      {nothing ? <Empty title="You're all caught up" body="Nothing slipped. Nice." /> : null}

      {plan.salvageable.length > 0 ? (
        <Section title="Still salvageable">
          {plan.salvageable.map(({ obligation: o, late }) => (
            <Card key={o.id} tone="good" onPress={() => router.push(`/assignment/${o.refId}`)}>
              <Row style={{ justifyContent: 'space-between' }}>
                <T variant="heading" style={{ flex: 1 }}>{o.title}</T>
                {impactLabel(o.impact) ? <Badge label={impactLabel(o.impact)!} tone="good" /> : null}
              </Row>
              <T variant="small" muted>{sem.courseName(o.courseId)} · was due {relativeTime(o.dueAt!, sem.now, sem.tz)}</T>
              <T variant="body" style={{ fontWeight: '600' }}>{describeLate(late)}</T>
            </Card>
          ))}
        </Section>
      ) : null}

      {plan.oneThing ? (
        <Section title="The one thing that matters today">
          <Card tone="primary" onPress={() => plan.oneThing!.kind === 'assignment' && router.push(`/assignment/${plan.oneThing!.refId}`)}>
            <T variant="title">{plan.oneThing.title}</T>
            <T muted>{sem.courseName(plan.oneThing.courseId)} · {dueLabel(plan.oneThing, sem.now, sem.tz)}{impactLabel(plan.oneThing.impact) ? ` · ${impactLabel(plan.oneThing.impact)}` : ''}</T>
            <T variant="small" color={c.primary}>Just this one. The rest can wait.</T>
          </Card>
        </Section>
      ) : null}

      {plan.dead.length > 0 ? (
        <Section title="Water under the bridge">
          <Card tone="alt">
            <T variant="small" muted>
              These have passed and can't be handed in. Clearing them keeps your list honest — it doesn't change any grades.
            </T>
            {deadByCourse.map(([courseId, list]) => (
              <Row key={courseId} style={{ justifyContent: 'space-between' }}>
                <T variant="body" style={{ flex: 1 }}>
                  {courseId === 'none' ? 'Other' : sem.courseName(courseId)} · {list.length} item{list.length === 1 ? '' : 's'}
                </T>
                <Button title="Clear" small variant="secondary" onPress={() => clearDead(list.map((o) => o.id))} />
              </Row>
            ))}
            {deadByCourse.length > 1 ? <Button title={`Clear all ${plan.dead.length}`} onPress={() => clearDead(plan.dead.map((o) => o.id))} /> : null}
          </Card>
        </Section>
      ) : null}
    </Screen>
  );
}
