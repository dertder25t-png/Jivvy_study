import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Button, Card, Row, Screen, Section, T } from '@/ui/components';
import { useColors } from '@/ui/theme';
import type { PocketStats } from '@/core/learning';

interface PocketSummaryProps {
  stats: PocketStats;
  /** Cards of the set not finished yet this round. */
  remaining: number;
  total: number;
  pocketSize: number;
  onNextPocket: (size: number) => void;
  onRestart: () => void;
  onReview: () => void;
  onEndSession: () => void;
}

export default function PocketSummary({
  stats,
  remaining,
  total,
  pocketSize,
  onNextPocket,
  onRestart,
  onReview,
  onEndSession,
}: PocketSummaryProps) {
  const c = useColors();
  const [nextSize, setNextSize] = useState(pocketSize);
  const finishedSet = remaining === 0;

  const presets = [...new Set([5, 10, 15, 20, pocketSize])].filter((n) => n > 0 && n <= Math.max(remaining, pocketSize)).sort((a, b) => a - b);
  const willStudy = Math.min(nextSize, remaining);

  return (
    <Screen maxWidth={760}>
      <View style={{ gap: 12 }}>
        <Section title={finishedSet ? 'Set complete! 🎉' : 'Pocket Complete! 🎉'}>
          <T>
            {finishedSet
              ? `You've learned all ${total} cards in this set. They'll come back in Review when they're due.`
              : `Great work! ${total - remaining} of ${total} cards learned — your place is saved, so you can stop any time.`}
          </T>
        </Section>

        <View style={{ gap: 12 }}>
          <Card style={{ padding: 16, backgroundColor: c.surface }}>
            <View style={{ alignItems: 'center' }}>
              <T variant="title" style={{ fontSize: 32, marginBottom: 4 }}>
                {stats.completed}
              </T>
              <T style={{ color: c.muted }}>Cards completed</T>
            </View>
          </Card>

          <Card>
            <View style={{ gap: 8 }}>
              <T variant="heading" style={{ marginBottom: 4 }}>Self-ratings</T>

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

              {stats.struggling > 0 && (
                <Row style={{ justifyContent: 'space-between' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <T style={{ fontSize: 18 }}>💪</T>
                    <T>Struggling</T>
                  </View>
                  <T style={{ fontWeight: '600' }}>{stats.struggling}</T>
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

        {!finishedSet && (
          <Card>
            <View style={{ gap: 12 }}>
              <View>
                <T variant="heading" style={{ marginBottom: 4 }}>
                  Keep learning ({remaining} cards left)
                </T>
                <T variant="small" muted>
                  Next pocket: {willStudy} cards
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
          {finishedSet ? (
            <>
              <Button title="Done" onPress={onEndSession} variant="primary" />
              <Button title="Review these cards" onPress={onReview} variant="secondary" />
              <Button title="Start this set over" onPress={onRestart} variant="ghost" />
            </>
          ) : (
            <>
              <Button title={`Continue with ${willStudy} more cards`} onPress={() => onNextPocket(nextSize)} variant="primary" />
              <Button title="Stop here for now" onPress={onEndSession} variant="secondary" />
            </>
          )}
        </View>

        <Card style={{ backgroundColor: c.surface }}>
          <T variant="small" muted style={{ lineHeight: 20 }}>
            <T variant="small" style={{ fontWeight: '600' }}>💡 Tip: </T>
            Coming back to these cards in a few hours will help lock them in long-term. Consider
            reviewing the struggling cards later today.
          </T>
        </Card>
      </View>
    </Screen>
  );
}
