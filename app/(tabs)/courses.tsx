import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { courseScale, formatPercent, gradeBand, officialPercent } from '@/core/grades';
import { useSemester } from '@/data/derived';
import { Button, Card, Dot, Empty, Row, Screen, T } from '@/ui/components';
import { dueLabel } from '@/ui/rows';

export default function Courses() {
  const sem = useSemester();
  const router = useRouter();

  return (
    <Screen>
      {sem.rows.courses.length === 0 ? (
        <Empty
          title="No courses yet"
          body="Upload a syllabus and the course, its deadlines and its grade breakdown are created for you."
          action={<Button title="Add a syllabus" onPress={() => router.push('/syllabus/add')} />}
        />
      ) : null}

      {sem.rows.courses.map((course) => {
        const grade = sem.grades.get(course.id);
        const next = sem.obligations
          .filter((o) => o.courseId === course.id && !o.done && o.dueAt && o.dueAt > sem.now && o.kind !== 'waiting_on')
          .sort((a, b) => a.dueAt!.getTime() - b.dueAt!.getTime())[0];
        return (
          <Card key={course.id} accent={course.color} onPress={() => router.push(`/course/${course.id}`)}>
            <Row style={{ justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <T variant="heading">{course.name}</T>
                <T variant="small" muted>{[course.code, course.instructor_name].filter(Boolean).join(' · ')}</T>
              </View>
              {(() => {
                const scale = courseScale(course);
                const official = course.official_grade ?? null;
                const op = officialPercent(official, scale);
                const shown = op ?? grade?.percent ?? null;
                if (shown == null) return <T variant="small" muted>No grades yet</T>;
                return (
                  <View style={{ alignItems: 'flex-end' }}>
                    <T variant="title">{official?.percent != null ? formatPercent(official.percent) : official?.letter ?? formatPercent(shown)}</T>
                    <T variant="small" muted>{official ? 'official' : `${gradeBand(shown, scale).letter} · estimate`}</T>
                  </View>
                );
              })()}
            </Row>
            {next ? (
              <Row>
                <Dot color={course.color} size={8} />
                <T variant="small" muted style={{ flex: 1 }} numberOfLines={1}>Next: {next.title} · {dueLabel(next, sem.now, sem.tz)}</T>
              </Row>
            ) : null}
          </Card>
        );
      })}

      {sem.rows.courses.length > 0 ? (
        <Button title="Add another syllabus" variant="secondary" onPress={() => router.push('/syllabus/add')} />
      ) : null}
    </Screen>
  );
}
