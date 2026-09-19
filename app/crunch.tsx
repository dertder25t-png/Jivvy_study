import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { crunchHeadline, crunchWhen } from '@/core/collisions';
import { effortMinutes, startBy } from '@/core/estimation';
import { formatMinutes, relativeTime } from '@/core/time';
import { useSemester } from '@/data/derived';
import { Badge, Card, Dot, Empty, ProgressBar, Row, Screen, T } from '@/ui/components';
import { useColors } from '@/ui/theme';

/** The screenshot-and-post moment: see the brutal week seven weeks early, not during it. */
export default function Crunch() {
  const sem = useSemester();
  const router = useRouter();
  const c = useColors();
  const maxHours = Math.max(1, ...sem.crunch.map((w) => w.hours));

  if (sem.crunch.length === 0) {
    return (
      <Screen>
        <Empty title="No collisions in sight" body="We look across all your courses for weeks where exams, papers and projects pile up. Nothing heavy is stacked right now." />
      </Screen>
    );
  }

  return (
    <Screen>
      <T muted>Weeks where a lot lands at once, across every course — with time to get ahead of them.</T>
      {sem.crunch.map((w) => (
        <Card key={w.weekStart} tone={w.severity === 'crunch' ? 'warn' : 'surface'}>
          <Row style={{ justifyContent: 'space-between' }}>
            <T variant="heading">{crunchWhen(w).replace(/^./, (x) => x.toUpperCase())}</T>
            <Badge label={w.severity === 'crunch' ? 'Crunch week' : 'Heavy week'} tone={w.severity === 'crunch' ? 'warn' : 'alt'} />
          </Row>
          <T variant="body">{crunchHeadline(w)}.</T>
          <ProgressBar value={w.hours / maxHours} color={c.warn} />
          <T variant="small" muted>About {formatMinutes(w.hours * 60)} of work landing this week.</T>

          <View style={{ gap: 8, marginTop: 6 }}>
            {w.items.map((o) => {
              const course = o.courseId ? sem.courseById.get(o.courseId) : undefined;
              const effort = effortMinutes({ type: o.type, estimated_minutes: o.estimatedMinutes }, sem.samples);
              const start = o.type === 'exam' ? null : startBy(o.dueAt!, effort, sem.now, 90);
              return (
                <Row key={o.id} gap={10} style={{ alignItems: 'flex-start' }}>
                  <View style={{ marginTop: 7 }}><Dot color={course?.color ?? c.muted} size={8} /></View>
                  <View style={{ flex: 1 }}>
                    <T variant="body" style={{ fontWeight: '600' }} onPress={() => o.kind === 'assignment' && router.push(`/assignment/${o.refId}`)}>{o.title}</T>
                    <T variant="small" muted>
                      {course?.code ?? ''} · {relativeTime(o.dueAt!, sem.now, sem.tz)}
                      {start ? ` · start ${start.startNow ? 'now' : relativeTime(start.startAt, sem.now, sem.tz)}` : ''}
                    </T>
                  </View>
                  <Badge label={o.type} />
                </Row>
              );
            })}
          </View>
        </Card>
      ))}
      <T variant="small" muted>We'll nudge you once, about 10 days before a crunch week — and remind you when it's time to start each big piece.</T>
    </Screen>
  );
}
