import React from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { needsConfirmation } from '@/core/notes';
import { relativeTime } from '@/core/time';
import { fileNote } from '@/data/actions';
import { useSemester } from '@/data/derived';
import { Button, Card, Chip, Dot, Empty, Row, Screen, Section, T } from '@/ui/components';
import type { Note } from '@/types/db';

function preview(n: Note): string {
  const first = n.body.trim().split('\n').find((l) => l.trim()) ?? '';
  return (n.title || first).replace(/[#*_`]/g, '').slice(0, 90) || 'Empty note';
}

export default function Notes() {
  const sem = useSemester();
  const router = useRouter();
  const notes = [...sem.rows.notes].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const inbox = notes.filter(needsConfirmation);
  const filed = notes.filter((n) => !needsConfirmation(n));
  const courses = sem.rows.courses;

  const confirmAllGuesses = () => {
    for (const n of inbox) if (n.course_id && n.course_inferred) fileNote(n, n.course_id);
  };
  const guesses = inbox.filter((n) => n.course_id && n.course_inferred);

  return (
    <Screen>
      <Row gap={8}>
        <Button title="New note" onPress={() => router.push('/note/new')} style={{ flex: 1 }} />
        <Button title="Import" variant="ghost" onPress={() => router.push('/import')} style={{ flex: 1 }} />
      </Row>

      {inbox.length > 0 ? (
        <Section
          title={`Inbox · ${inbox.length}`}
          right={guesses.length > 1 ? <Button title="Confirm all guesses" small variant="ghost" onPress={confirmAllGuesses} /> : undefined}
        >
          <View style={{ gap: 8 }}>
            {inbox.map((n) => {
              const guess = n.course_id ? sem.courseById.get(n.course_id) : undefined;
              return (
                <Card key={n.id}>
                  {/* the text opens the note; the chips below are separate buttons (buttons can't nest) */}
                  <Pressable onPress={() => router.push(`/note/${n.id}`)} accessibilityRole="button" style={{ gap: 4 }}>
                    <T variant="body" numberOfLines={2}>{preview(n)}</T>
                    <T variant="small" muted>{relativeTime(n.created_at, sem.now, sem.tz)} · {guess ? `Looks like ${guess.code ?? guess.name}?` : 'Which class is this for?'}</T>
                  </Pressable>
                  <Row style={{ flexWrap: 'wrap' }}>
                    {guess ? <Chip label={`Yes, ${guess.code ?? guess.name}`} small selected color={guess.color} onPress={() => fileNote(n, guess.id)} /> : null}
                    {courses.filter((c) => c.id !== guess?.id).map((c) => (
                      <Chip key={c.id} label={c.code ?? c.name} small onPress={() => fileNote(n, c.id)} />
                    ))}
                  </Row>
                </Card>
              );
            })}
          </View>
        </Section>
      ) : null}

      <Section title="Notes">
        <View style={{ gap: 8 }}>
          {filed.length === 0 && inbox.length === 0 ? (
            <Empty title="Nothing captured yet" body="Tap + anywhere to jot something down. It files itself by class and week." />
          ) : null}
          {filed.map((n) => {
            const course = n.course_id ? sem.courseById.get(n.course_id) : undefined;
            const topic = n.topic_id ? sem.rows.topics.find((t) => t.id === n.topic_id) : undefined;
            return (
              <Card key={n.id} accent={course?.color} onPress={() => router.push(`/note/${n.id}`)}>
                <T variant="body" style={{ fontWeight: '600' }} numberOfLines={2}>{preview(n)}</T>
                <Row gap={6}>
                  <Dot color={course?.color ?? '#999'} size={8} />
                  <T variant="small" muted numberOfLines={1}>
                    {[course?.code ?? course?.name, topic ? `Wk ${topic.week_no ?? ''} ${topic.title}`.trim() : null, relativeTime(n.created_at, sem.now, sem.tz)].filter(Boolean).join(' · ')}
                  </T>
                </Row>
              </Card>
            );
          })}
        </View>
      </Section>
    </Screen>
  );
}
