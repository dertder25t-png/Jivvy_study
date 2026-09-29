import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Badge, Button, Empty, ProgressBar, Row, Screen, T } from '@/ui/components';
import { useLayout } from '@/ui/layout';
import { radius, space, useColors } from '@/ui/theme';
import { reviewCard } from '@/data/actions';
import type { Card as CardType } from '@/types/db';
import type { StudyDirection } from '@/core/learning';
import { checkAnswer, directionForCard, gradeToRating, type AnswerCheck } from '@/core/learning';
import { stripPartLabel } from '@/core/flashcards/cardCheck';

type Phase = 'visible' | 'hidden';
type Grade = 'easy' | 'good' | 'struggling';

interface LearningCardProps {
  /** The whole pocket, in order (for "3 of 10 done"). */
  pocket: string[];
  /** The pocket's cards not finished yet, in order. */
  queue: string[];
  /** Cards in the pocket that are spaced reviews of cards learned before. */
  reviewIds: ReadonlySet<string>;
  cards: CardType[];
  direction: StudyDirection;
  /** Overall progress under the pocket bar: today's plan, or how much of the set is learned. */
  progressLine: string;
  /** A card stuck (Good or Easy) — saved right away, so progress survives leaving mid-pocket. */
  onFinished: (cardId: string, mark: { grade: 'easy' | 'good'; accuracy: number; misses: number; review: boolean }) => void;
  onPocketComplete: () => void;
  onOptions: () => void;
  onFlashcards: () => void;
}

// The browser's own focus ring clashes with ours (we recolor the border instead).
const NO_RING = (Platform.OS === 'web' ? { outlineStyle: 'none', outlineWidth: 0 } : {}) as object;

/**
 * One pocket of Learn mode. A new card: copy the answer while it's shown, then type it from memory. A card
 * you've learned before (a review) skips the copy step — you go straight to recalling it, to see whether
 * you really know it. Enter checks what you typed: right passes the card; wrong shows the answer and sends
 * the card to the back of the pocket, where it starts with the copy step again and keeps coming back until
 * it sticks — so a pocket only ends when you've got every card in it.
 */
export default function LearningCard({
  pocket, queue: initialQueue, reviewIds, cards, direction, progressLine, onFinished, onPocketComplete, onOptions, onFlashcards,
}: LearningCardProps) {
  const c = useColors();
  const { isPhone } = useLayout();
  const [focused, setFocused] = useState(false);
  const cardMap = new Map(cards.map((card) => [card.id, card]));

  const [queue, setQueue] = useState(() => initialQueue.filter((id) => cardMap.has(id)));
  const [misses, setMisses] = useState<Record<string, number>>({});
  // A review card starts with recall — no peeking at the answer first — until it's been missed.
  const startPhase = (id: string | undefined, missed: Record<string, number>): Phase =>
    id && reviewIds.has(id) && !(missed[id] > 0) ? 'hidden' : 'visible';
  const [phase, setPhase] = useState<Phase>(() => startPhase(queue[0], {}));
  const [visibleText, setVisibleText] = useState('');
  const [hiddenText, setHiddenText] = useState('');
  const [result, setResult] = useState<AnswerCheck | null>(null);
  const [showReveal, setShowReveal] = useState(false);
  /** Peeked at the answer before checking. */
  const [hinted, setHinted] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(4);
  const [round, setRound] = useState(0); // bumps per card shown, so a card that comes straight back restarts
  const hiddenInputRef = useRef<TextInput>(null);

  const currentCardId = queue[0];
  const currentCard = cardMap.get(currentCardId);
  const cardDirection = currentCard ? directionForCard(direction, currentCard.id) : 'term_to_def';
  const prompt = currentCard ? (cardDirection === 'term_to_def' ? currentCard.term : currentCard.definition) : '';
  const answer = currentCard ? (cardDirection === 'term_to_def' ? currentCard.definition : currentCard.term) : '';
  const answerLabel = cardDirection === 'term_to_def' ? 'definition' : 'term';
  const doneCount = pocket.length - queue.length;
  const missedBefore = (misses[currentCardId] ?? 0) > 0;
  const isReview = reviewIds.has(currentCardId);

  // The answer stays up for a few seconds while you copy it, then hides.
  useEffect(() => {
    if (phase !== 'visible' || !currentCard) return;
    if (timeRemaining <= 0) {
      setPhase('hidden');
      return;
    }
    const t = setTimeout(() => setTimeRemaining((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, currentCard, round, timeRemaining]);

  // Once it's time to recall, put the cursor in the box.
  useEffect(() => {
    if (phase !== 'hidden' || result) return;
    const t = setTimeout(() => hiddenInputRef.current?.focus(), 150);
    return () => clearTimeout(t);
  }, [phase, round, result]);

  const nextCard = (nextId: string | undefined, missed: Record<string, number>) => {
    setPhase(startPhase(nextId, missed));
    setVisibleText('');
    setHiddenText('');
    setShowReveal(false);
    setHinted(false);
    setResult(null);
    setTimeRemaining(4);
    setRound((r) => r + 1);
  };

  /** Enter: check what was typed against the real answer. */
  const handleCheck = (text = hiddenText) => {
    if (result || !currentCard) return;
    // A split card's "(1–3 of 9)" label isn't part of what you have to recall.
    setResult(checkAnswer(text, stripPartLabel(answer)));
  };

  const handleGrade = (grade: Grade, score: number) => {
    if (!currentCard) return;
    reviewCard(currentCard, gradeToRating(grade));
    if (grade === 'struggling') {
      // Back of the line: it comes round again after the others (or right away if it's the last one).
      const missed = { ...misses, [currentCardId]: (misses[currentCardId] ?? 0) + 1 };
      const nextQueue = [...queue.slice(1), queue[0]];
      setMisses(missed);
      setQueue(nextQueue);
      nextCard(nextQueue[0], missed);
      return;
    }
    onFinished(currentCardId, { grade, accuracy: score, misses: misses[currentCardId] ?? 0, review: isReview });
    if (queue.length <= 1) {
      onPocketComplete();
      return;
    }
    setQueue((q) => q.slice(1));
    nextCard(queue[1], misses);
  };

  /**
   * What the check means for the schedule. Right passes (Easy only when a review was recalled cold, first
   * try, near word-for-word); wrong or almost sends it round again. Peeking at the answer first counts
   * as struggling, whatever you type — you didn't recall it.
   */
  const autoGrade = (r: AnswerCheck): Grade => {
    if (r.verdict !== 'right') return 'struggling';
    if (hinted) return 'struggling';
    return isReview && !hinted && !missedBefore && r.score >= 0.95 ? 'easy' : 'good';
  };

  const handleContinue = (override = false) => {
    if (!result) return;
    if (override) handleGrade('good', Math.max(result.score, 0.8));
    else handleGrade(autoGrade(result), result.score);
  };

  // Enter moves on from the result (the box is locked by then, so listen on the page).
  const continueRef = useRef(handleContinue);
  continueRef.current = handleContinue;
  useEffect(() => {
    if (Platform.OS !== 'web' || !result) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        continueRef.current();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [result]);

  if (!currentCard) {
    return <Screen maxWidth={760}><Empty title="No card to show" /></Screen>;
  }

  const verdictColor = result ? (result.verdict === 'right' ? c.good : result.verdict === 'close' ? c.warn : c.danger) : c.border;

  const input = (hidden: boolean) => (
    <TextInput
      key={`${hidden ? 'hidden' : 'visible'}-${round}`}
      ref={hidden ? hiddenInputRef : undefined}
      autoFocus
      editable={!hidden || !result}
      value={hidden ? hiddenText : visibleText}
      onChangeText={(t) => {
        if (!hidden) return setVisibleText(t);
        // Phones have no Shift+Enter: a new line at the end means "check".
        if (Platform.OS !== 'web' && t.endsWith('\n') && t.trim().length > 0) return handleCheck(t.trimEnd());
        setHiddenText(t);
      }}
      onKeyPress={
        hidden && Platform.OS === 'web'
          ? (e) => {
              const ne = e.nativeEvent as unknown as { key: string; shiftKey?: boolean };
              if (ne.key === 'Enter' && !ne.shiftKey) {
                (e as unknown as { preventDefault: () => void }).preventDefault();
                handleCheck();
              }
            }
          : undefined
      }
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      placeholder={hidden ? `Type the ${answerLabel} from memory, then press Enter…` : `Type the ${answerLabel}…`}
      placeholderTextColor={c.muted}
      multiline
      style={[
        {
          minHeight: 96, padding: space.md, borderRadius: radius.md, borderWidth: 1.5,
          borderColor: hidden && result ? verdictColor : focused ? c.primary : c.border,
          backgroundColor: c.bg, color: c.text,
          fontSize: 17, lineHeight: 24, textAlignVertical: 'top',
        },
        NO_RING,
      ]}
    />
  );

  const answerBox = (
    <View style={{ backgroundColor: c.surfaceAlt, padding: space.md, borderRadius: radius.md, borderLeftWidth: 3, borderLeftColor: c.primary, gap: 4 }}>
      <T variant="label" muted>Answer</T>
      <T style={{ lineHeight: 24 }}>{answer}</T>
    </View>
  );

  const outcome = result ? autoGrade(result) : null;

  return (
    <Screen
      maxWidth={680}
      footer={phase === 'visible' ? <Button title="I've got it — hide it" onPress={() => setPhase('hidden')} variant="secondary" /> : undefined}
    >
      <View style={{ gap: space.lg, paddingTop: isPhone ? space.xl : space.xxl * 1.5 }}>
        <View style={{ gap: 6 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <T variant="small" muted>{doneCount} of {pocket.length} done in this pocket</T>
            {phase === 'visible' ? <T variant="small" muted>Hides in {timeRemaining}s</T> : null}
          </Row>
          <ProgressBar value={doneCount / Math.max(1, pocket.length)} />
          <Row style={{ justifyContent: 'space-between' }}>
            <T variant="small" muted style={{ flex: 1 }}>{progressLine}</T>
            <Row gap={space.md}>
              <Pressable onPress={onFlashcards} accessibilityRole="button" hitSlop={8}>
                <T variant="small" color={c.primary} style={{ fontWeight: '600' }}>Flashcards</T>
              </Pressable>
              <Pressable onPress={onOptions} accessibilityRole="button" hitSlop={8}>
                <T variant="small" color={c.primary} style={{ fontWeight: '600' }}>Options</T>
              </Pressable>
            </Row>
          </Row>
        </View>

        {/* One card: the question on top, where you answer it underneath. The question is framed as one so it
            never reads as the answer — especially in Mixed, where the side flips per card. */}
        <View style={{ borderRadius: radius.lg, overflow: 'hidden', backgroundColor: c.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border }}>
          <View style={{ backgroundColor: c.primary, paddingHorizontal: space.xl, paddingVertical: isPhone ? space.xl : space.xxl, gap: space.sm }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <T variant="label" style={{ color: c.onPrimary, opacity: 0.75 }}>
                {cardDirection === 'term_to_def' ? 'What does this term mean?' : 'Which term matches this definition?'}
              </T>
              {missedBefore ? <Badge label="Again" /> : isReview ? <Badge label="Review" /> : null}
            </Row>
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
                <T variant="small" muted style={{ fontWeight: '600' }}>
                  {isReview && !missedBefore ? `Do you remember the ${answerLabel}? Type it from memory` : `Now type the ${answerLabel} from memory`}
                </T>
                {input(true)}
                {result || showReveal ? (
                  answerBox
                ) : (
                  <Pressable
                    onPress={() => {
                      setShowReveal(true);
                      setHinted(true);
                    }}
                    accessibilityRole="button"
                    hitSlop={8}
                    style={{ alignSelf: 'flex-start' }}
                  >
                    <T variant="small" color={c.primary} style={{ fontWeight: '600' }}>Show the {answerLabel}</T>
                  </Pressable>
                )}
              </>
            )}
          </View>
        </View>

        {phase === 'hidden' && !result ? <Button title="Check" onPress={() => handleCheck()} /> : null}

        {phase === 'hidden' && result ? (
          <View style={{ gap: space.sm }}>
            <T style={{ fontWeight: '700', textAlign: 'center', color: verdictColor }}>
              {result.verdict === 'right' ? 'Right' : result.verdict === 'close' ? 'Almost' : 'Not quite'}
            </T>
            {result.verdict !== 'right' && result.missing.length > 0 ? (
              <T variant="small" muted style={{ textAlign: 'center' }}>Missing: {result.missing.join(', ')}</T>
            ) : null}
            <T variant="small" muted style={{ textAlign: 'center' }}>
              {outcome === 'struggling'
                ? result.verdict === 'right'
                  ? 'You looked at the answer first, so this one comes back to try again.'
                  : 'This one comes back later in the pocket — you’ll copy it once more, then try again.'
                : outcome === 'easy'
                  ? 'Recalled cold — nice. It’ll wait longer before you see it again.'
                  : 'Got it.'}
            </T>
            <Button title="Continue" onPress={() => handleContinue()} />
            {result.verdict !== 'right' ? (
              <Button title="I was actually right" variant="secondary" onPress={() => handleContinue(true)} />
            ) : null}
          </View>
        ) : null}
      </View>
    </Screen>
  );
}
