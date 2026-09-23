import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Button, Empty, ProgressBar, Row, Screen, T } from '@/ui/components';
import { useLayout } from '@/ui/layout';
import { radius, space, useColors } from '@/ui/theme';
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

// The browser's own focus ring clashes with ours (we recolor the border instead).
const NO_RING = (Platform.OS === 'web' ? { outlineStyle: 'none', outlineWidth: 0 } : {}) as object;

export default function LearningCard({ session, cards, direction, onPocketComplete }: LearningCardProps) {
  const c = useColors();
  const { isPhone } = useLayout();
  const [focused, setFocused] = useState(false);
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

  const input = (hidden: boolean) => (
    <TextInput
      key={hidden ? 'hidden' : 'visible'}
      ref={hidden ? hiddenInputRef : undefined}
      autoFocus={!hidden}
      value={hidden ? hiddenText : visibleText}
      onChangeText={hidden ? setHiddenText : setVisibleText}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      placeholder={hidden ? `Type the ${answerLabel} from memory…` : `Type the ${answerLabel}…`}
      placeholderTextColor={c.muted}
      multiline
      style={[
        {
          minHeight: 96, padding: space.md, borderRadius: radius.md, borderWidth: 1.5,
          borderColor: focused ? c.primary : c.border, backgroundColor: c.bg, color: c.text,
          fontSize: 17, lineHeight: 24, textAlignVertical: 'top',
        },
        NO_RING,
      ]}
    />
  );

  return (
    <Screen
      maxWidth={680}
      footer={phase === 'visible' ? <Button title="I've got it — hide it" onPress={handleManualHide} variant="secondary" /> : undefined}
    >
      <View style={{ gap: space.lg, paddingTop: isPhone ? space.xl : space.xxl * 1.5 }}>
        <View style={{ gap: 6 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <T variant="small" muted>Card {currentCardIndex + 1} of {pocket.length}</T>
            {phase === 'visible' ? <T variant="small" muted>Hides in {timeRemaining}s</T> : null}
          </Row>
          <ProgressBar value={currentCardIndex / pocket.length} />
        </View>

        {/* One card: the question on top, where you answer it underneath. The question is framed as one so it
            never reads as the answer — especially in Mixed, where the side flips per card. */}
        <View style={{ borderRadius: radius.lg, overflow: 'hidden', backgroundColor: c.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border }}>
          <View style={{ backgroundColor: c.primary, paddingHorizontal: space.xl, paddingVertical: isPhone ? space.xl : space.xxl, gap: space.sm }}>
            <T variant="label" style={{ color: c.onPrimary, opacity: 0.75 }}>
              {cardDirection === 'term_to_def' ? 'What does this term mean?' : 'Which term matches this definition?'}
            </T>
            <T variant="title" style={{ color: c.onPrimary }}>{prompt}</T>
          </View>

          <View style={{ padding: space.lg, gap: space.md }}>
            {phase === 'visible' ? (
              <>
                <T variant="small" muted style={{ fontWeight: '600' }}>Copy the {answerLabel} while you can see it</T>
                <View style={{ backgroundColor: c.surfaceAlt, padding: space.md, borderRadius: radius.md }}>
                  <T style={{ lineHeight: 24 }}>{answer}</T>
                </View>
                {input(false)}
              </>
            ) : (
              <>
                <T variant="small" muted style={{ fontWeight: '600' }}>Now type the {answerLabel} from memory</T>
                {input(true)}
                {showReveal ? (
                  <View style={{ backgroundColor: c.surfaceAlt, padding: space.md, borderRadius: radius.md, borderLeftWidth: 3, borderLeftColor: c.primary, gap: 4 }}>
                    <T variant="label" muted>Answer</T>
                    <T style={{ lineHeight: 24 }}>{answer}</T>
                  </View>
                ) : (
                  <Pressable onPress={handleReveal} accessibilityRole="button" hitSlop={8} style={{ alignSelf: 'flex-start' }}>
                    <T variant="small" color={c.primary} style={{ fontWeight: '600' }}>Show the {answerLabel}</T>
                  </Pressable>
                )}
              </>
            )}
          </View>
        </View>

        {phase === 'hidden' ? (
          <View style={{ gap: space.sm }}>
            <T variant="small" muted style={{ textAlign: 'center' }}>How did you do?</T>
            <Row gap={space.sm}>
              <Button title="Struggling" variant="secondary" onPress={() => handleGrade('struggling')} style={{ flex: 1 }} />
              <Button title="Good" variant="secondary" onPress={() => handleGrade('good')} style={{ flex: 1 }} />
              <Button title="Easy" onPress={() => handleGrade('easy')} style={{ flex: 1 }} />
            </Row>
          </View>
        ) : null}
      </View>
    </Screen>
  );
}
