import React, { useMemo, useState } from ‘react’;
import { Switch, View } from ‘react-native’;
import { useLocalSearchParams, useRouter } from ‘expo-router’;
import { cardsFor, inScope, minutesFor, paceSecondsPerCard, studyAdvice, type StudyOrder } from ‘@/core/session’;
import { relativeTime } from ‘@/core/time’;
import { useSemester } from ‘@/data/derived’;
import { Button, Card, Chip, Empty, Row, Screen, Section, T } from ‘@/ui/components’;
import { useColors } from ‘@/ui/theme’;

type StudyMode = ‘learn’ | ‘review’;

const MINUTE_CHOICES = [5, 10, 15, 30];
const ORDERS: Array<{ key: StudyOrder; label: string; hint: string }> = [
  { key: ‘smart’, label: ‘Smart’, hint: ‘What’s due first, then your weakest cards.’ },
  { key: ‘weakest’, label: ‘Weakest first’, hint: ‘Ignores the schedule — the cards you know least.’ },
  { key: ‘shuffle’, label: ‘Shuffle’, hint: ‘Random order, good for a final run-through.’ },
];

const MODES: Array<{ key: StudyMode; label: string; hint: string }> = [
  { key: ‘learn’, label: ‘Learn Mode’, hint: ‘Type definitions twice: visible then from memory. Great for retention!’ },
  { key: ‘review’, label: ‘Review Mode’, hint: ‘Spaced repetition with SM-2 algorithm. Optimize when to review each card.’ },
];

/**
 * Study whenever you want, however you want. Nothing here is locked behind the review schedule;
 * the guidance is advice you can ignore.
 */
export default function StudySetup() {
  const params = useLocalSearchParams<{ courseId?: string; examId?: string }>();
  const sem = useSemester();
  const router = useRouter();
  const c = useColors();
  const { now, tz } = sem;

  const [mode, setMode] = useState<StudyMode>('review');
  const [courseId, setCourseId] = useState<string | null>(params.courseId ?? null);
  const [topicId, setTopicId] = useState<string | null>(null);
  const [examId, setExamId] = useState<string | null>(params.examId ?? null);
  const [order, setOrder] = useState<StudyOrder>('smart');
  const [minutes, setMinutes] = useState<number | 'all'>(10);
  const [counts, setCounts] = useState(true);

  const pace = useMemo(() => paceSecondsPerCard(sem.rows.card_reviews), [sem.rows.card_reviews]);

  const scope = useMemo(
    () => ({ courseId, examId, topicIds: topicId ? [topicId] : undefined }),
    [courseId, examId, topicId],
  );
  const pool = useMemo(() => inScope(sem.cards, scope, sem.examTargets), [sem.cards, scope, sem.examTargets]);
  const advice = useMemo(() => studyAdvice({ pool, examTargets: sem.examTargets, now, tz, pace }), [pool, sem.examTargets, now, tz, pace]);

  const limit = minutes === 'all' ? pool.length : Math.min(pool.length, cardsFor(minutes, pace));
  const estMinutes = minutesFor(limit, pace);

  const topics = courseId ? (sem.topicsByCourse.get(courseId) ?? []).filter((t) => sem.cards.some((k) => k.card.topic_id === t.id && (k.card.status === 'accepted' || k.card.status === 'edited'))) : [];
  const exams = sem.examTargets
    .filter((e) => e.at > now)
    .filter((e) => !courseId || sem.rows.exams.find((x) => x.id === e.examId)?.course_id === courseId)
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(0, 4);

  if (sem.cards.filter((k) => k.card.status === 'accepted' || k.card.status === 'edited').length === 0) {
    return (
      <Screen>
        <Empty
          title="No cards to study yet"
          body="Make some from a note (open a note and tap the cards button), or add your own."
          action={<Button title="Add cards" onPress={() => router.replace('/cards/new')} />}
        />
      </Screen>
    );
  }

  const start = () => {
    const q = new URLSearchParams();
    if (courseId) q.set('courseId', courseId);
    if (examId) q.set('examId', examId);
    if (topicId) q.set('topics', topicId);
    q.set('limit', String(Math.max(1, limit)));
    q.set('order', order);
    if (!counts) q.set('practice', '1');

    const target = mode === 'learn' ? '/cards/learn' : '/cards/review';
    router.push(`${target}?${q.toString()}`);
  };

  return (
    <Screen
      footer={
        <View style={{ gap: 6 }}>
          <Button
            title={
              pool.length === 0
                ? 'No cards match'
                : mode === 'learn'
                  ? `Start Learning · ${pool.length} card${pool.length === 1 ? '' : 's'}`
                  : `Start · ${limit} card${limit === 1 ? '' : 's'} · about ${estMinutes} min`
            }
            onPress={start}
            disabled={pool.length === 0}
          />
        </View>
      }
    >
      <T muted>Study whenever you like — nothing here is locked to the schedule. Suggestions below are just that.</T>

      {/* ---------------- mode ---------------- */}
      <Section title="Study style">
        <Row style={{ flexWrap: 'wrap' }}>
          {MODES.map((m) => (
            <Chip key={m.key} label={m.label} selected={mode === m.key} onPress={() => setMode(m.key)} />
          ))}
        </Row>
        <T variant="small" muted>{MODES.find((m) => m.key === mode)?.hint}</T>
      </Section>

      {/* ---------------- what ---------------- */}
      <Section title="What to study">
        <Row style={{ flexWrap: 'wrap' }}>
          <Chip label="Everything" selected={!courseId} onPress={() => { setCourseId(null); setTopicId(null); setExamId(null); }} />
          {sem.rows.courses.map((k) => (
            <Chip key={k.id} label={k.code ?? k.name} color={k.color} selected={courseId === k.id} onPress={() => { setCourseId(k.id); setTopicId(null); setExamId(null); }} />
          ))}
        </Row>
        {topics.length > 0 ? (
          <>
            <T variant="label" muted style={{ marginTop: 6 }}>Or one week</T>
            <Row style={{ flexWrap: 'wrap' }}>
              {topics.map((t) => (
                <Chip key={t.id} small label={`${t.week_no != null ? `Wk ${t.week_no}` : ''} ${t.title}`.trim()} selected={topicId === t.id} onPress={() => { setTopicId(topicId === t.id ? null : t.id); setExamId(null); }} />
              ))}
            </Row>
          </>
        ) : null}
        {exams.length > 0 ? (
          <>
            <T variant="label" muted style={{ marginTop: 6 }}>Or get ready for a test</T>
            <Row style={{ flexWrap: 'wrap' }}>
              {exams.map((e) => (
                <Chip key={e.examId} small label={`${e.title} · ${relativeTime(e.at, now, tz)}`} selected={examId === e.examId} onPress={() => { setExamId(examId === e.examId ? null : e.examId); setTopicId(null); }} />
              ))}
            </Row>
          </>
        ) : null}
        <T variant="small" muted>
          {advice.stats.total} card{advice.stats.total === 1 ? '' : 's'}
          {advice.stats.due > 0 ? ` · ${advice.stats.due} due` : ''}
          {advice.stats.neverSeen > 0 ? ` · ${advice.stats.neverSeen} new` : ''}
        </T>
      </Section>

      {mode === 'review' && (
        <>
          {/* ---------------- how long ---------------- */}
          <Section title="How long">
            <Row style={{ flexWrap: 'wrap' }}>
              {MINUTE_CHOICES.map((m) => (
                <Chip key={m} label={`${m} min`} selected={minutes === m} onPress={() => setMinutes(m)} />
              ))}
              <Chip label={`All ${pool.length}`} selected={minutes === 'all'} onPress={() => setMinutes('all')} />
            </Row>
            <T variant="small" muted>
              {pool.length === 0 ? 'Nothing in this selection.' : `That's ${limit} card${limit === 1 ? '' : 's'}, about ${estMinutes} min at your pace (~${pace}s a card).`}
            </T>
          </Section>

          {/* ---------------- order ---------------- */}
          <Section title="Order">
            <Row style={{ flexWrap: 'wrap' }}>
              {ORDERS.map((o) => <Chip key={o.key} label={o.label} selected={order === o.key} onPress={() => setOrder(o.key)} />)}
            </Row>
            <T variant="small" muted>{ORDERS.find((o) => o.key === order)?.hint}</T>
          </Section>
        </>
      )}

      {/* ---------------- schedule ---------------- */}
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <T variant="body" style={{ fontWeight: '600' }}>Count this toward my schedule</T>
            <T variant="small" muted>
              {counts
                ? 'Your ratings help plan future reviews. Studying early is safe — it never pushes a card’s next review further away.'
                : 'Practice only: nothing you do here changes your review schedule.'}
            </T>
          </View>
          <Switch value={counts} onValueChange={setCounts} />
        </Row>
      </Card>

      {/* ---------------- guidance ---------------- */}
      <Card tone="primary">
        <T variant="label" color={c.primary}>How much time is worth spending</T>
        {advice.lines.map((l, i) => <T key={i} variant="small">{l}</T>)}
        <T variant="small" muted>Just a guide — study for as long or as little as you like.</T>
      </Card>
    </Screen>
  );
}
