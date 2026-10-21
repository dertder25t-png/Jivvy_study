import React, { useState } from 'react';
import { View } from 'react-native';
import { Button, Card, Chip, Row, Screen, Section, T } from '@/ui/components';
import { useColors } from '@/ui/theme';
import type { PocketStats } from '@/core/learning';

interface PocketSummaryProps {
  stats: PocketStats;
  /** Nothing new left to learn and nothing due for review right now. */
  complete: boolean;
  /** For the next pocket: cards due for review, and new cards available (with a plan: new ones left today). */
  dueWaiting: number;
  unlearned: number;
  /** Every card in the set has been learned (so it can be redone). */
  allLearned: boolean;
  total: number;
  /** When a study plan is in charge: today's share and what's next. */
  plan?: {
    doneToday: number;
    totalToday: number;
    tomorrow: number | null;
    /** The test, as a phrase ("in 3 days"); null for a set with no test date. */
    testIn: string | null;
    /** Already learning ahead of the plan. */
    ahead: boolean;
    /** Cards not studied yet at all. */
    unseen: number;
    onLearnAhead: () => void;
  };
  /** "tomorrow", "in 3 days" — when the next review comes due, once everything's done. */
  nextReviewIn: string | null;
  /** Cards in this pocket that needed another go. */
  retried: number;
  /** The set is gone through in shuffled order. */
  shuffled: boolean;
  onNextPocket: () => void;
  onFlashcards: () => void;
  /** Go through the whole set again from the start (optionally shuffled). */
  onRedo: (shuffle: boolean) => void;
  onReview: () => void;
  /** Cards you've had trouble with: go through just those, typed or as flashcards. */
  trouble?: { count: number; onPractice: () => void; onFlashcards: () => void };
  onEndSession: () => void;
}

const cards = (n: number) => `${n} card${n === 1 ? '' : 's'}`;

export default function PocketSummary({
  stats, complete, dueWaiting, unlearned, allLearned, total, plan, nextReviewIn, retried, shuffled,
  onNextPocket, onFlashcards, onRedo, onReview, trouble, onEndSession,
}: PocketSummaryProps) {
  const c = useColors();
  const [redoShuffled, setRedoShuffled] = useState(shuffled);

  const nextLabel = [dueWaiting ? `${dueWaiting} review${dueWaiting === 1 ? '' : 's'}` : '', unlearned ? `${unlearned} new` : '']
    .filter(Boolean).join(' + ');
  const doneForToday = Boolean(plan && complete);

  let title = complete ? 'All caught up! 🎉' : 'Nice work! 🎉';
  let body = complete
    ? `You've learned all ${total} cards and nothing's due for review right now.${nextReviewIn ? ` Next review ${nextReviewIn} — cards come back in Learn on their own, spaced out so they stick.` : ''}`
    : `Great work! ${total - unlearned} of ${total} cards learned — your place is saved, so you can stop any time.`;
  if (plan && doneForToday) {
    title = 'Done for today! 🎉';
    body = plan.ahead && plan.unseen === 0 && dueWaiting === 0
      ? `You've been through every card.${plan.testIn ? ` Your test is ${plan.testIn} —` : ''} Reviews come back in Learn as they fall due.`
      : `That's today's plan done${plan.totalToday ? ` — ${plan.totalToday} card${plan.totalToday === 1 ? '' : 's'}` : ''}. ${
          plan.testIn
            ? `${plan.tomorrow ? `About ${plan.tomorrow} tomorrow` : 'Nothing more is planned before the test'}, and the test is ${plan.testIn}.`
            : 'The rest of the set, and the reviews that fall due, come back tomorrow.'
        }`;
  } else if (plan) {
    body = plan.ahead
      ? `Learning ahead of your plan — your place is saved, so you can stop any time.${plan.testIn ? ` The test is ${plan.testIn}.` : ''}`
      : `${Math.min(plan.doneToday, plan.totalToday)} of ${plan.totalToday} of today's plan done — your place is saved, so you can stop any time.`;
  }

  return (
    <Screen maxWidth={760}>
      <View style={{ gap: 12 }}>
        <Section title={title}>
          <T>{body}</T>
        </Section>

        {plan && doneForToday && plan.unseen > 0 && !plan.ahead ? (
          <Card tone="primary">
            <View style={{ gap: 8 }}>
              <T variant="heading">Want to get ahead?</T>
              <T variant="small">
                {plan.unseen} card{plan.unseen === 1 ? '' : 's'} you haven't learned yet. Learning some now means fewer on the
                days just before the test.
              </T>
              <Button title="Learn ahead" small onPress={plan.onLearnAhead} style={{ alignSelf: 'flex-start' }} />
            </View>
          </Card>
        ) : null}

        {stats.completed > 0 ? (
          <View style={{ gap: 12 }}>
            <Card style={{ padding: 16, backgroundColor: c.surface }}>
              <View style={{ alignItems: 'center' }}>
                <T variant="title" style={{ fontSize: 32, marginBottom: 4 }}>
                  {stats.completed}
                </T>
                <T style={{ color: c.muted }}>
                  {stats.reviews > 0 ? `Cards done · ${stats.reviews} review${stats.reviews === 1 ? '' : 's'}, ${stats.completed - stats.reviews} new` : 'Cards completed'}
                </T>
              </View>
            </Card>

            <Card>
              <View style={{ gap: 8 }}>
                <T variant="heading" style={{ marginBottom: 4 }}>How it went</T>

                {stats.easy > 0 && (
                  <Row style={{ justifyContent: 'space-between' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <T style={{ fontSize: 18 }}>✅</T>
                      <T>Easy</T>
                    </View>
                    <T style={{ fontWeight: '600' }}>{stats.easy}</T>
                  </Row>
                )}

                {stats.good > 0 && (
                  <Row style={{ justifyContent: 'space-between' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <T style={{ fontSize: 18 }}>👍</T>
                      <T>Good</T>
                    </View>
                    <T style={{ fontWeight: '600' }}>{stats.good}</T>
                  </Row>
                )}

                {stats.retried > 0 && (
                  <Row style={{ justifyContent: 'space-between' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <T style={{ fontSize: 18 }}>💪</T>
                      <T>Needed another try</T>
                    </View>
                    <T style={{ fontWeight: '600' }}>{stats.retried}</T>
                  </Row>
                )}

                <View style={{ marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: c.border }}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <T>Avg. accuracy (hidden phase)</T>
                    <T style={{ fontWeight: '600' }}>
                      {Math.round(stats.averageAccuracy * 100)}%
                    </T>
                  </Row>
                  <T variant="small" muted style={{ marginTop: 4 }}>
                    % of the answer's words you recalled from memory
                  </T>
                </View>
              </View>
            </Card>
          </View>
        ) : null}

        {trouble ? (
          <Card tone="warn">
            <View style={{ gap: 8 }}>
              <T variant="heading">Trouble cards: {trouble.count}</T>
              <T variant="small">
                Cards you've missed and haven't got right twice in a row since. Go through just these — each one drops
                off the list once you've recalled it twice.
              </T>
              <Row style={{ flexWrap: 'wrap' }}>
                <Button title="Practice just these" small onPress={trouble.onPractice} />
                <Button title="As flashcards" small variant="secondary" onPress={trouble.onFlashcards} />
              </Row>
            </View>
          </Card>
        ) : null}

        <Card tone="alt">
          <View style={{ gap: 8 }}>
            <T variant="heading">Not feeling sure about some of them?</T>
            <T variant="small" muted>
              {retried > 0
                ? `Flip through the ${cards(retried)} you missed (or pick others) until every one's a "Got it".`
                : 'Pick any cards from today and flip through them until every one\'s a "Got it".'}
            </T>
            <Button title="Go over them as flashcards" variant="secondary" small onPress={onFlashcards} style={{ alignSelf: 'flex-start' }} />
          </View>
        </Card>

        {allLearned ? (
          <Card tone="primary">
            <View style={{ gap: 8 }}>
              <T variant="heading">Redo this set</T>
              <T variant="small">
                Go through all {total} cards again from the start — good before a test. Your review schedule is kept, so
                nothing you've learned is lost.
              </T>
              <Row style={{ flexWrap: 'wrap' }}>
                <Chip label="In order" selected={!redoShuffled} onPress={() => setRedoShuffled(false)} />
                <Chip label={shuffled ? 'Shuffled (new order)' : 'Shuffled'} selected={redoShuffled} onPress={() => setRedoShuffled(true)} />
              </Row>
              <Button title="Redo this set" onPress={() => onRedo(redoShuffled)} style={{ alignSelf: 'flex-start' }} />
            </View>
          </Card>
        ) : null}

        {!complete && (
          <Card>
            <View style={{ gap: 12 }}>
              <View>
                <T variant="heading" style={{ marginBottom: 4 }}>
                  Keep going
                </T>
                <T variant="small" muted>
                  {plan
                    ? `${dueWaiting > 0 ? `${cards(dueWaiting)} due for review, ` : ''}${unlearned} new ${plan.ahead ? 'left to learn' : 'left today'}. `
                    : dueWaiting > 0 ? `${cards(dueWaiting)} due for review, ${unlearned} not learned yet. ` : `${unlearned} not learned yet. `}
                  Next up: {nextLabel || cards(0)}
                </T>
              </View>

            </View>
          </Card>
        )}

        <View style={{ gap: 8 }}>
          {complete ? (
            <>
              <Button title="Flip through the whole set" onPress={onReview} variant="secondary" />
              <Button title="Done" onPress={onEndSession} variant="ghost" />
            </>
          ) : (
            <>
              <Button title={`Continue · ${nextLabel || 'keep going'}`} onPress={onNextPocket} variant="primary" />
              <Button title="Stop here for now" onPress={onEndSession} variant="secondary" />
            </>
          )}
        </View>

        <Card style={{ backgroundColor: c.surface }}>
          <T variant="small" muted style={{ lineHeight: 20 }}>
            <T variant="small" style={{ fontWeight: '600' }}>💡 How it sticks: </T>
            Cards you've learned come back in Learn on their own — the next day, then a few days later — spaced so each one
            gets another look before your test. Missed ones come back sooner.
          </T>
        </Card>
      </View>
    </Screen>
  );
}
