import React, { useEffect, useRef, useState } from 'react';
import { TextInput, View } from 'react-native';
import { Button, Card, Empty, Row, Screen, T } from '@/ui/components';
import { useColors } from '@/ui/theme';
import { reviewCard } from '@/data/actions';
import type { Card as CardType } from '@/types/db';
import type { LearnSession, StudyDirection } from '@/core/learning';
import { directionForCard, gradeToRating, recordTypingAttempt, updateSelfGrade } from '@/core/learning';

interface LearningCardProps {
  session: LearnSession;
  cards: CardType[];
  direction: StudyDirection;
  onPocketComplete: () => void;
}

type Phase = 'visible' | 'hidden' | 'feedback';
type Grade = 'easy' | 'good' | 'struggling';

export default function LearningCard({ session, cards, direction, onPocketComplete }: LearningCardProps) {
  const c = useColors();
  const cardMap = new Map(cards.map((card) => [card.id, card]));

  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('visible');
  const [visibleText, setVisibleText] = useState('');
  const [hiddenText, setHiddenText] = useState('');
  const [showReveal, setShowReveal] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(4);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hiddenInputRef = useRef<TextInput>(null);

  const pocket = session.cardIds.slice(0, session.pocketSize);
  const currentCardId = pocket[currentCardIndex];
  const currentCard = cardMap.get(currentCardId);
  const cardDirection = currentCard ? directionForCard(direction, currentCard.id) : 'term_to_def';
  const prompt = currentCard ? (cardDirection === 'term_to_def' ? currentCard.term : currentCard.definition) : '';
  const answer = currentCard ? (cardDirection === 'term_to_def' ? currentCard.definition : currentCard.term) : '';
  const answerLabel = cardDirection === 'term_to_def' ? 'definition' : 'term';

  const progress = `${currentCardIndex + 1}/${pocket.length}`;
  const pocketProgress = `${session.completedCards.size + 1}/${pocket.length}`;

  useEffect(() => {
    if (phase !== 'visible' || !currentCard) return;

    timerRef.current = setInterval(() => {
      setTimeRemaining((t) => {
        if (t <= 1) {
          clearInterval(timerRef.current!);
          setPhase('hidden');
          setTimeRemaining(0);
          setTimeout(() => hiddenInputRef.current?.focus(), 200);
          return 0;
        }
        return t - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [phase, currentCard]);

  if (!currentCard) {
    return <Screen maxWidth={760}><Empty title="No card to show" /></Screen>;
  }

  const handleManualHide = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setPhase('hidden');
    setTimeout(() => hiddenInputRef.current?.focus(), 200);
  };

  const handleReveal = () => {
    setShowReveal(true);
  };

  const handleGrade = (grade: Grade) => {
    recordTypingAttempt(session, currentCardId, visibleText, hiddenText, answer);
    updateSelfGrade(session, currentCardId, grade);
    reviewCard(currentCard, gradeToRating(grade));

    if (currentCardIndex < pocket.length - 1) {
      setCurrentCardIndex(currentCardIndex + 1);
      setPhase('visible');
      setVisibleText('');
      setHiddenText('');
      setShowReveal(false);
      setTimeRemaining(4);
    } else {
      onPocketComplete();
    }
  };

  return (
    <Screen maxWidth={760}
      footer={
        phase === 'visible' && (
          <Button
            title="Ready to hide"
            onPress={handleManualHide}
            variant="secondary"
          />
        )
      }
    >
      <View style={{ gap: 12 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <T variant="small" style={{ fontWeight: '600' }}>Card {progress}</T>
          <T variant="small" muted>Pocket: {pocketProgress}</T>
        </Row>

        <Card style={{ backgroundColor: c.primary, padding: 16 }}>
          <T variant="title" style={{ color: c.onPrimary, marginBottom: 8 }}>
            {prompt}
          </T>
          <T variant="small" style={{ color: c.onPrimary, opacity: 0.8 }}>
            {cardDirection === 'term_to_def' ? 'Term' : 'Definition'}
          </T>
        </Card>

        {phase === 'visible' && (
          <Card>
            <View style={{ gap: 12 }}>
              <View>
                <T variant="heading" style={{ marginBottom: 8 }}>
                  Phase 1: Type while you can see it
                </T>
                <T variant="small" muted style={{ marginBottom: 12 }}>
                  Time remaining: {timeRemaining}s — then it hides
                </T>

                <View style={{ backgroundColor: c.surface, padding: 12, borderRadius: 6, marginBottom: 12 }}>
                  <T style={{ lineHeight: 20 }}>
                    {answer}
                  </T>
                </View>

                <TextInput
                  style={{
                    borderWidth: 1,
                    borderColor: c.border,
                    borderRadius: 6,
                    padding: 12,
                    minHeight: 100,
                    backgroundColor: c.bg,
                    color: c.text,
                    fontSize: 16,
                  }}
                  placeholder={`Type the ${answerLabel} here...`}
                  placeholderTextColor={c.muted}
                  multiline
                  value={visibleText}
                  onChangeText={setVisibleText}
                  autoFocus
                />
              </View>

              <T variant="small" muted style={{ fontStyle: 'italic' }}>
                Hint: Try to capture the key concepts, not word-for-word
              </T>
            </View>
          </Card>
        )}

        {phase === 'hidden' && (
          <Card>
            <View style={{ gap: 12 }}>
              <View>
                <T variant="heading" style={{ marginBottom: 8 }}>
                  Phase 2: From memory ({answerLabel} is hidden)
                </T>
                <T variant="small" muted style={{ marginBottom: 12 }}>
                  Recall and type what you remember...
                </T>

                <TextInput
                  ref={hiddenInputRef}
                  style={{
                    borderWidth: 1,
                    borderColor: c.border,
                    borderRadius: 6,
                    padding: 12,
                    minHeight: 100,
                    backgroundColor: c.bg,
                    color: c.text,
                    fontSize: 16,
                  }}
                  placeholder="Type from memory..."
                  placeholderTextColor={c.muted}
                  multiline
                  value={hiddenText}
                  onChangeText={setHiddenText}
                />

                {!showReveal && (
                  <Button
                    title={`Reveal ${answerLabel}`}
                    onPress={handleReveal}
                    variant="secondary"
                    small
                  />
                )}

                {showReveal && (
                  <View
                    style={{
                      backgroundColor: c.surface,
                      padding: 12,
                      borderRadius: 6,
                      borderLeftWidth: 3,
                      borderLeftColor: c.primary,
                    }}
                  >
                    <T variant="small" style={{ fontWeight: '600', marginBottom: 4, color: c.muted }}>
                      Actual {answerLabel}:
                    </T>
                    <T style={{ lineHeight: 20 }}>
                      {answer}
                    </T>
                  </View>
                )}
              </View>

              <View style={{ gap: 8, marginTop: 12 }}>
                <T variant="heading">How did you do?</T>
                <View style={{ gap: 6 }}>
                  <Button
                    title="Easy — I got it"
                    onPress={() => handleGrade('easy')}
                    variant="primary"
                  />
                  <Button
                    title="Good — mostly right"
                    onPress={() => handleGrade('good')}
                    variant="secondary"
                  />
                  <Button
                    title="Struggling — need more practice"
                    onPress={() => handleGrade('struggling')}
                    variant="secondary"
                  />
                </View>
              </View>
            </View>
          </Card>
        )}
      </View>
    </Screen>
  );
}
