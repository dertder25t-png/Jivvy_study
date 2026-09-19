import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { crunchHeadline, crunchWhen } from '@/core/collisions';
import { useSemester } from '@/data/derived';
import { store } from '@/data/store';
import { Badge, Card, Row, Screen, T } from '@/ui/components';

export default function More() {
  const sem = useSemester();
  const router = useRouter();
  const waiting = sem.rows.waiting_on.filter((w) => !w.resolved_at).length;
  const crunch = sem.crunch[0];

  const Item = ({ title, sub, href, badge }: { title: string; sub: string; href: string; badge?: string }) => (
    <Card onPress={() => router.push(href as never)}>
      <Row style={{ justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <T variant="heading">{title}</T>
          <T variant="small" muted>{sub}</T>
        </View>
        {badge ? <Badge label={badge} tone="warn" /> : null}
      </Row>
    </Card>
  );

  return (
    <Screen>
      <Item
        title="Account"
        sub={store.mode === 'supabase' ? 'Signed in — profile, password, your data.' : 'Not signed in — create an account to sync and back up.'}
        href="/account"
      />
      <Item
        title="Crunch forecast"
        sub={crunch ? `${crunchHeadline(crunch)} — ${crunchWhen(crunch)}` : 'No heavy weeks on the horizon.'}
        href="/crunch"
        badge={crunch ? crunchWhen(crunch) : undefined}
      />
      <Item title="Catch up" sub="What's still salvageable, what to let go, and the one thing worth doing today." href="/comeback" />
      <Item title="Email a professor" sub="Pre-filled with your course, the assignment and the real policy text." href="/email" />
      <Item title="Waiting on" sub="Emails and requests you're expecting an answer to." href="/waiting" badge={waiting ? String(waiting) : undefined} />
      <Item title="Settings" sub="Reminders, study time, account." href="/settings" />
    </Screen>
  );
}
