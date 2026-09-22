import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { deleteCard } from '@/data/actions';
import { useSemester } from '@/data/derived';
import { Badge, Button, Card, Empty, Row, Screen, Section, T } from '@/ui/components';

export default function Deck() {
  const sem = useSemester();
  const router = useRouter();
  const cards = sem.rows.cards.filter((k) => k.status !== 'rejected');

  if (cards.length === 0) {
    return (
      <Screen>
        <Empty title="No cards yet" body="Make them from a note, or add your own." action={<Button title="Add a card" onPress={() => router.push('/cards/new')} />} />
      </Screen>
    );
  }

  const unsorted = cards.filter((k) => !k.course_id);

  const renderGroup = (key: string, title: string, list: typeof cards, accent?: string) => {
    if (list.length === 0) return null;
    const pending = list.filter((k) => k.status === 'pending').length;
    return (
      <Section key={key} title={`${title} · ${list.length - pending}${pending ? ` (+${pending} waiting)` : ''}`}>
        <View style={{ gap: 8 }}>
          {list.filter((k) => k.status !== 'pending').map((k) => (
            <Card key={k.id} accent={accent}>
              <Row style={{ justifyContent: 'space-between' }}>
                <T variant="body" style={{ fontWeight: '600', flex: 1 }}>{k.term}</T>
                {k.origin === 'generated' ? <Badge label="from notes" /> : <Badge label="manual" />}
              </Row>
              <T variant="small" muted>{k.definition}</T>
              <Button title="Delete" small variant="ghost" onPress={() => deleteCard(k)} />
            </Card>
          ))}
        </View>
      </Section>
    );
  };

  return (
    <Screen>
      {sem.rows.courses.map((course) => renderGroup(course.id, course.code ?? course.name, cards.filter((k) => k.course_id === course.id), course.color))}
      {renderGroup('unsorted', 'No class', unsorted)}
    </Screen>
  );
}
