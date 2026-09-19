import React, { useState } from 'react';
import { View } from 'react-native';
import { addWaitingOn, deleteWaitingOn, resolveWaitingOn } from '@/data/actions';
import { useSemester } from '@/data/derived';
import { Button, Card, Chip, Empty, Field, Row, Screen, Section, T } from '@/ui/components';
import { relativeTime } from '@/core/time';

const NUDGES = [{ label: '1 day', d: 1 }, { label: '3 days', d: 3 }, { label: '1 week', d: 7 }];

/** Loose ends: anything sent out that you're waiting to hear back on. Built generic (course optional). */
export default function Waiting() {
  const sem = useSemester();
  const [what, setWhat] = useState('');
  const [days, setDays] = useState(3);
  const [courseId, setCourseId] = useState<string | null>(null);
  const open = sem.rows.waiting_on.filter((w) => !w.resolved_at).sort((a, b) => a.nudge_at.localeCompare(b.nudge_at));

  return (
    <Screen>
      <Card>
        <Field label="Waiting to hear back on" value={what} onChangeText={setWhat} placeholder="e.g. Emailed Dr. Reyes about an extension" />
        <Row style={{ flexWrap: 'wrap' }}>
          <T variant="small" muted>Nudge me in</T>
          {NUDGES.map((n) => <Chip key={n.d} label={n.label} small selected={days === n.d} onPress={() => setDays(n.d)} />)}
        </Row>
        <Row style={{ flexWrap: 'wrap' }}>
          {sem.rows.courses.map((k) => <Chip key={k.id} label={k.code ?? k.name} small selected={courseId === k.id} color={k.color} onPress={() => setCourseId(courseId === k.id ? null : k.id)} />)}
        </Row>
        <Button
          title="Add"
          disabled={!what.trim()}
          onPress={() => { addWaitingOn({ what: what.trim(), courseId, nudgeInDays: days }); setWhat(''); }}
        />
      </Card>

      <Section title="Still waiting">
        {open.length === 0 ? <Empty title="Nothing pending" body="When you email a professor from here, it lands on this list with a reminder to follow up." /> : null}
        <View style={{ gap: 8 }}>
          {open.map((w) => {
            const due = new Date(w.nudge_at) <= sem.now;
            return (
              <Card key={w.id} tone={due ? 'warn' : 'surface'}>
                <T variant="body" style={{ fontWeight: '600' }}>{w.what}</T>
                <T variant="small" muted>
                  Sent {relativeTime(w.sent_at, sem.now, sem.tz)} · {due ? 'time to follow up' : `follow up ${relativeTime(w.nudge_at, sem.now, sem.tz)}`}
                </T>
                <Row>
                  <Button title="Got a reply" small onPress={() => resolveWaitingOn(w)} />
                  <Button title="Remove" small variant="ghost" onPress={() => deleteWaitingOn(w)} />
                </Row>
              </Card>
            );
          })}
        </View>
      </Section>
    </Screen>
  );
}
