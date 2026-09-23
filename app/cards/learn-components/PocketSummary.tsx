import React, { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Button, Card, Row, Screen, Section, T } from '@/ui/components';
import { useColors } from '@/ui/theme';
import { prefs } from '@/data/prefs';
import type { Card as CardType } from '@/types/db';
import type { LearnSession, PocketRecommendation } from '@/core/learning';
import { getPocketStats } from '@/core/learning';

interface PocketSummaryProps {
  session: LearnSession;
  cards: CardType[];
  recommendation: PocketRecommendation;
  onNextPocket: (size: number) => void;
  onEndSession: () => void;
}

export default function PocketSummary({
  session,
  cards,
  recommendation,
  onNextPocket,
  onEndSession,
}: PocketSummaryProps) {
  const c = useColors();
  const remembered = prefs.get().learnPocketSize;
  const [nextSize, setNextSize] = useState(remembered && remembered <= cards.length ? remembered : recommendation.recommended);
  const stats = getPocketStats(session);

  const remainingCards = cards.length - (session.currentIndex + session.pocketSize);
  const presets = [5, 10, 15, 20].filter((n) => n <= remainingCards && n > 0);

  const chooseNext = (size: number) => {
    setNextSize(size);
    prefs.set({ learnPocketSize: size });
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 24 }}>
        <Section title="Pocket Complete! 🎉">
          <T>Great work! Here's how you did.</T>
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
                  % of definition words you recalled from memory
                </T>
              </View>
            </View>
          </Card>
        </View>

        {remainingCards > 0 && (
          <Card>
            <View style={{ gap: 12 }}>
              <View>
                <T variant="heading" style={{ marginBottom: 4 }}>
                  Keep learning ({remainingCards} cards left)
                </T>
                <T variant="small" muted>
                  Next pocket: {nextSize} cards
                </T>
              </View>

              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {presets.map((size) => (
                  <Pressable
                    key={size}
                    onPress={() => chooseNext(size)}
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
          {remainingCards > 0 && (
            <Button
              title={`Continue with ${nextSize} more cards`}
              onPress={() => onNextPocket(nextSize)}
              variant="primary"
            />
          )}
          <Button
            title={remainingCards > 0 ? 'End session' : 'All done!'}
            onPress={onEndSession}
            variant={remainingCards > 0 ? 'secondary' : 'primary'}
          />
        </View>

        <Card style={{ backgroundColor: c.surface }}>
          <T variant="small" muted style={{ lineHeight: 20 }}>
            <T variant="small" style={{ fontWeight: '600' }}>💡 Tip: </T>
            Coming back to these cards in a few hours will help lock them in long-term. Consider
            reviewing the struggling cards later today.
          </T>
        </Card>
      </ScrollView>
    </Screen>
  );
}
