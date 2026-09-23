// "Today's study plan": what to do today to be ready for each upcoming test, with a button straight
// into it. What you've already done today comes off, so the card can actually reach "done".
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { isPrepDone, prepHref, prepMinutes, prepSentence, type PrepTask } from '@/core/testPrep';
import { relativeTime } from '@/core/time';
import { Button, Card, Dot, Row, T } from './components';
import { useLayout } from './layout';
import { space, useColors } from './theme';

export function TodayPlan({ prep, now, tz, pace }: { prep: PrepTask[]; now: Date; tz: string; pace: number }) {
  const router = useRouter();
  const c = useColors();
  const { isPhone } = useLayout();
  const today = prep.filter((t) => t.dayOffset === 0);
  if (today.length === 0) return null;

  const left = today.filter((t) => !isPrepDone(t));
  const minutes = left.reduce((s, t) => s + prepMinutes(t, pace), 0);

  return (
    <Card tone={left.length > 0 ? 'primary' : 'good'}>
      <T variant="label" color={left.length > 0 ? c.primary : c.good}>
        {left.length > 0 ? `Today's study plan · about ${minutes} min` : "Today's study plan · all done"}
      </T>
      {today.map((t, i) => {
        const done = isPrepDone(t);
        const soFar = [t.doneNew ? `${t.doneNew} learned` : '', t.doneReview ? `${t.doneReview} reviewed` : ''].filter(Boolean).join(' · ');
        return (
          <View
            key={t.target.key}
            style={{ gap: 6, paddingTop: i > 0 ? space.sm : 0, borderTopWidth: i > 0 ? StyleSheet.hairlineWidth : 0, borderTopColor: c.border }}
          >
            <Row gap={8}>
              <Dot color={t.target.color} size={9} />
              <T variant="heading" style={{ flex: 1 }} numberOfLines={1}>{t.target.title}</T>
              <T variant="small" muted>Test {relativeTime(t.target.testAt, now, tz)}</T>
            </Row>
            <T variant="body">{prepSentence(t)}</T>
            {soFar && !done ? <T variant="small" muted>So far today: {soFar}</T> : null}
            {!done ? (
              <View style={isPhone ? { gap: space.sm } : { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
                {t.newCards > 0 ? (
                  <Button title={`Learn ${t.newCards} new`} small onPress={() => router.push(prepHref(t, 'learn'))} />
                ) : null}
                {t.reviewCards > 0 ? (
                  <Button
                    title={t.kind === 'learn' ? `Review ${t.reviewCards}` : `Go through all ${t.reviewCards}`}
                    small
                    variant={t.newCards > 0 ? 'secondary' : 'primary'}
                    onPress={() => router.push(prepHref(t, 'review'))}
                  />
                ) : null}
              </View>
            ) : null}
          </View>
        );
      })}
    </Card>
  );
}
