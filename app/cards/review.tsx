import React, { useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { clozeBlanked } from '@/core/flashcards/reject';
import { intervalLabel, isEarly, nextExamFor, nextReview, stateFromReviews } from '@/core/scheduling';
import { buildSession, type StudyOrder } from '@/core/session';
import { relativeTime } from '@/core/time';
import { reviewCard } from '@/data/actions';
import { useSemester } from '@/data/derived';
import { Button, Card, Empty, ProgressBar, Row, Screen, T } from '@/ui/components';
import { useColors } from '@/ui/theme';
import type { Rating } from '@/types/db';
import { useSafeBack } from '@/ui/nav';

const RATINGS: Array<{ r: Rating; label: string }> = [
  { r: 1, label: 'Again' }, { r: 2, label: 'Hard' }, { r: 3, label: 'Good' }, { r: 4, label: 'Easy' },
];

/**
 * A study session. Anything can be studied at any time — the schedule only orders the cards
 * ("smart") and never limits them. `practice=1` skips saving ratings entirely.
 */
export default function ReviewSession() {
  const p = useLocalSearchParams<{
    examId?: string; courseId?: string; noteId?: string; topics?: string; limit?: string; order?: string; practice?: string;
  }>();
  const sem = useSemester();
  const router = useRouter();
  const goBack = useSafeBack('/study');
  const c = useColors();
  const practice = p.practice === '1';
  const exam = p.examId ? sem.examTargets.find((e) => e.examId === p.examId) : undefined;

  // The queue is fixed when the session starts, so ratings don't reshuffle it under the student.
  const initial = useMemo<string[]>(() => {
    const order = (['smart', 'weakest', 'shuffle'].includes(p.order ?? '') ? p.order : exam ? 'weakest' : 'smart') as StudyOrder;
    const limit = Number(p.limit) > 0 ? Number(p.limit) : exam ? 15 : 20;
    return buildSession({
      cards: sem.cards,
      scope: {
        courseId: p.courseId ?? null,
        examId: p.examId ?? null,
        noteId: p.noteId ?? null,
        topicIds: p.topics ? p.topics.split(',') : undefined,
      },
      order,
      limit,
      now: new Date(),
      examTargets: sem.examTargets,
    }).map((k) => k.card.id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const startedAt = useRef(Date.now());
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [again, setAgain] = useState<string[]>([]);
  const [tally, setTally] = useState<Record<Rating, number>>({ 1: 0, 2: 0, 3: 0, 4: 0 });

  const queue = [...initial, ...again];
  const cardId = queue[index];
  const item = sem.cards.find((k) => k.card.id === cardId);

  if (queue.length === 0) {
    return (
      <Screen maxWidth={760}>
        <Empty
          title="No cards match"
          body="There's nothing in that selection yet. Try a wider one, or make cards from a note."
          action={<Button title="Choose something else" onPress={() => router.replace('/cards/setup')} />}
        />
      </Screen>
    );
  }

  if (!item) {
    const done = Object.values(tally).reduce((a, b) => a + b, 0);
    const mins = Math.max(1, Math.round((Date.now() - startedAt.current) / 60_000));
    return (
      <Screen maxWidth={760}>
        <Card tone="good">
          <T variant="title">Nice — session done</T>
          <T muted>
            {done} rating{done === 1 ? '' : 's'} in about {mins} min.
            {tally[1] > 0 ? ` ${tally[1]} to look at again — they'll come back soon.` : ' Nothing missed.'}
          </T>
          <T variant="small" muted>{practice ? 'Practice only — your schedule wasn’t changed.' : 'Your ratings have updated your review schedule.'}</T>
        </Card>
        <Button title="Study more" onPress={() => router.replace('/cards/setup')} />
        <Button title="Done" variant="secondary" onPress={goBack} />
      </Screen>
    );
  }

  const { card, reviews } = item;
  const now = new Date();
  const examFor = exam ? { at: exam.at } : nextExamFor(card.topic_id, sem.examTargets, now);
  const state = stateFromReviews(reviews);
  const early = isEarly(state, now, state.dueAt);
  const preview = (r: Rating) => {
    const s = nextReview(state, r, now, examFor?.at, { dueAt: state.dueAt });
    return intervalLabel((s.due_at.getTime() - now.getTime()) / 86_400_000);
  };

  const rate = (r: Rating) => {
    if (!practice) reviewCard(card, r);
    if (r === 1) setAgain((a) => [...a, card.id]);
    setTally((t) => ({ ...t, [r]: t[r] + 1 }));
    setRevealed(false);
    setIndex((i) => i + 1);
  };

  const front = card.card_type === 'cloze' ? clozeBlanked(card.cloze_text ?? card.definition) : card.term;
  const back = card.card_type === 'cloze' ? clozeBlanked(card.cloze_text ?? card.definition, true) : card.definition;

  return (
    <Screen maxWidth={760}
      footer={
        revealed ? (
          <Row>
            {RATINGS.map(({ r, label }) => (
              <View key={r} style={{ flex: 1 }}>
                <Button title={label} variant={r >= 3 ? 'primary' : 'secondary'} onPress={() => rate(r)} small />
                <T variant="small" muted style={{ textAlign: 'center', marginTop: 4 }}>{practice ? '—' : preview(r)}</T>
              </View>
            ))}
          </Row>
        ) : (
          <Button title="Show answer" onPress={() => setRevealed(true)} />
        )
      }
    >
      <Stack.Screen options={{ title: exam ? `Ready for ${exam.title}` : practice ? 'Practice' : 'Study' }} />
      {exam ? (
        <T variant="small" muted>
          {relativeTime(exam.at, sem.now, sem.tz) === 'tomorrow' ? 'Test tomorrow' : `Test ${relativeTime(exam.at, sem.now, sem.tz)}`} — the cards you’re weakest on, first.
        </T>
      ) : null}
      <ProgressBar value={index / queue.length} />
      <Row style={{ justifyContent: 'space-between' }}>
        <T variant="small" muted>{index + 1} of {queue.length}</T>
        {practice ? <T variant="small" muted>practice — not saved</T> : early ? <T variant="small" muted>studying ahead — safe</T> : null}
      </Row>

      <Card style={{ minHeight: 260, justifyContent: 'center', padding: 24 }}>
        <T variant="label" muted>{card.card_type === 'cloze' ? 'Fill in the blank' : 'What is…'}</T>
        <T variant="title">{front}</T>
        {revealed ? (
          <>
            <View style={{ height: 1, backgroundColor: c.border, marginVertical: 12 }} />
            <T variant="body">{back}</T>
          </>
        ) : null}
      </Card>
    </Screen>
  );
}
