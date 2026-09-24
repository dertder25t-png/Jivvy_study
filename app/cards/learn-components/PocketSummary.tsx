import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
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
    testIn: string;
    /** Already learning ahead of the plan. */
    ahead: boolean;
    /** Cards not studied yet at all. */
    unseen: number;
    onLearnAhead: () => void;
  };
  pocketSize: number;
  /** "tomorrow", "in 3 days" — when the next review comes due, once everything's done. */
  nextReviewIn: string | null;
  /** Cards in this pocket that needed another go. */
  retried: number;
  /** The set is gone through in shuffled order. */
  shuffled: boolean;
  onNextPocket: (size: number) => void;
  onFlashcards: () => void;
  /** Go through the whole set again from the start (optionally shuffled). */
  onRedo: (shuffle: boolean) => void;
  onReview: () => void;
  onEndSession: () => void;
}

const cards = (n: number) => `${n} card${n === 1 ? '' : 's'}`;

export default function PocketSummary({
  stats, complete, dueWaiting, unlearned, allLearned, total, plan, pocketSize, nextReviewIn, retried, shuffled,
  onNextPocket, onFlashcards, onRedo, onReview, onEndSession,
}: PocketSummaryProps) {
  const c = useColors();
  const [nextSize, setNextSize] = useState(pocketSize);
  const [redoShuffled, setRedoShuffled] = useState(shuffled);
  const left = dueWaiting + unlearned;

  // The next pocket: reviews that are due come first, then new cards.
  const nextReviews = Math.min(nextSize, dueWaiting);
  const nextNew = Math.min(nextSize - nextReviews, unlearned);
  const nextLabel = [nextReviews ? `${nextReviews} review${nextReviews === 1 ? '' : 's'}` : '', nextNew ? `${nextNew} new` : '']
    .filter(Boolean).join(' + ');
  const presets = [...new Set([5, 10, 15, 20, pocketSize])].filter((n) => n > 0 && n <= Math.max(left, pocketSize)).sort((a, b) => a - b);
  const doneForToday = Boolean(plan && complete);

  let title = complete ? 'All caught up! 🎉' : 'Pocket Complete! 🎉';
  let body = complete
    ? `You've learned all ${total} cards and nothing's due for review right now.${nextReviewIn ? ` Next review ${nextReviewIn} — cards come back in Learn on their own, spaced out so they stick.` : ''}`
    : `Great work! ${total - unlearned} of ${total} cards learned — your place is saved, so you can stop any time.`;
  if (plan && doneForToday) {
    title = 'Done for today! 🎉';
    body = plan.ahead && plan.unseen === 0 && dueWaiting === 0
      ? `You've been through every card. Your test is ${plan.testIn} — reviews come back in Learn as they fall due.`
      : `That's today's plan done${plan.totalToday ? ` — ${plan.totalToday} card${plan.totalToday === 1 ? '' : 's'}` : ''}. ${
          plan.tomorrow ? `About ${plan.tomorrow} tomorrow` : 'Nothing more is planned before the test'
        }, and the test is ${plan.testIn}.`;
  } else if (plan) {
    body = plan.ahead
      ? `Learning ahead of your plan — your place is saved, so you can stop any time. The test is ${plan.testIn}.`
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
                  Next pocket: {nextLabel || cards(0)}
                </T>
              </View>

              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {presets.map((size) => (
                  <Pressable
                    key={size}
                    onPress={() => setNextSize(size)}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      borderRadius: 6,
                      backgroundColor: nextSize === size ? c.primary : c.surface,
                      borderColor: nextSize === size ? c.primary : c.border,
                      borderWidth: 1,
                    }}
                  >
                    <T
                      style={{
                        color: nextSize === size ? c.onPrimary : c.text,
                        fontWeight: '500',
                        fontSize: 14,
                      }}
                    >
                      {size}
                    </T>
                  </Pressable>
                ))}
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
              <Button title={`Continue · ${nextLabel || 'next pocket'}`} onPress={() => onNextPocket(nextSize)} variant="primary" />
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
