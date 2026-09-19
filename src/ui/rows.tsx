import React from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { Obligation } from '@/core/obligations';
import { clockTime, dayDiff, formatMinutes, relativeTime } from '@/core/time';
import type { Semester } from '@/data/derived';
import { updateAssignment } from '@/data/actions';
import { store } from '@/data/store';
import { Badge, Dot, T } from './components';
import { radius, space, useColors } from './theme';

export function dueLabel(o: Obligation, now: Date, tz: string): string {
  if (!o.dueAt) return 'no date yet';
  const rel = relativeTime(o.dueAt, now, tz);
  const days = dayDiff(o.dueAt, now, tz);
  const base = o.approximate ? `around ${rel}` : rel;
  if (!o.approximate && (days === 0 || days === 1) && o.dueAt.getTime() > now.getTime()) {
    return `${days === 0 ? 'today' : 'tomorrow'}, ${clockTime(o.dueAt, tz)}`;
  }
  return base;
}

export function impactLabel(impact: number): string | null {
  if (impact < 1.5) return null;
  return `~${Math.round(impact)}% of grade`;
}

export function ObligationRow({ o, sem, showCheck = true }: { o: Obligation; sem: Semester; showCheck?: boolean }) {
  const c = useColors();
  const router = useRouter();
  const course = o.courseId ? sem.courseById.get(o.courseId) : undefined;
  const impact = impactLabel(o.impact);

  const open = () => {
    if (o.kind === 'assignment') router.push(`/assignment/${o.refId}`);
    else if (o.courseId) router.push(`/course/${o.courseId}`);
  };
  const markDone = () => {
    const a = store.all('assignments').find((x) => x.id === o.refId);
    if (a) updateAssignment(a, { status: 'submitted' });
  };

  return (
    <Pressable
      onPress={open}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, paddingHorizontal: space.lg,
        backgroundColor: c.surface, borderRadius: radius.md, opacity: pressed ? 0.75 : 1,
        borderWidth: 1, borderColor: c.border,
      })}
    >
      {showCheck && o.kind === 'assignment' ? (
        <Pressable
          onPress={markDone}
          hitSlop={10}
          accessibilityRole="checkbox"
          accessibilityLabel={`Mark ${o.title} done`}
          style={{ width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: course?.color ?? c.muted }}
        />
      ) : (
        <Dot color={course?.color ?? c.muted} />
      )}
      <View style={{ flex: 1, gap: 2 }}>
        <T variant="body" style={{ fontWeight: '600' }} numberOfLines={2}>{o.title}</T>
        <T variant="small" muted numberOfLines={2}>
          {[
            course ? course.code ?? course.name : null,
            dueLabel(o, sem.now, sem.tz),
            o.kind === 'assignment' && o.type !== 'exam' ? `~${formatMinutes(o.estimatedMinutes)}` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </T>
      </View>
      {o.type === 'exam' ? <Badge label="Exam" tone="primary" /> : impact ? <Badge label={impact} tone="alt" /> : null}
    </Pressable>
  );
}
