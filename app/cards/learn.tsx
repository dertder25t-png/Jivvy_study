import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { inScope } from '@/core/session';
import {
  calculateRecommendedPocketSize, dueForReview, finishedInPocket, learnOrder, learnScopeKey, newShuffleSeed, nextReviewAt,
  pocketStats, resumePoint, studiedToday, type StudyDirection,
} from '@/core/learning';
import { addDaysYmd, localDateString, relativeTime, zonedToUtc } from '@/core/time';
import { markLearned, restartLearning, reviewCard, setLearnPocket, setLearnSettings, startLearning } from '@/data/actions';
import { useCardAdvice } from '@/data/cardAdvice';
import { useSemester } from '@/data/derived';
import { prefs } from '@/data/prefs';
import { Button, Empty, Screen } from '@/ui/components';
import { useSafeBack } from '@/ui/nav';
import PocketSetup from './learn-components/PocketSetup';
import LearningCard from './learn-components/LearningCard';
import PocketSummary from './learn-components/PocketSummary';
import FlashcardPicker from './learn-components/FlashcardPicker';
import FlashcardDrill from './learn-components/FlashcardDrill';

type Phase = 'learning' | 'summary' | 'options' | 'pick' | 'flashcards';

/**
 * Learn mode. The first time you learn a set it asks how (pocket size, what to type); after that it goes
 * straight back to where you left off — on any device. Each pocket starts with the cards you've already
 * learned that are due for review (so what you learned on day 1 is still there on day 9), then new cards.
 * Cards you're not sure of can be drilled as flashcards without leaving Learn.
 */
export default function LearnMode() {
  const params = useLocalSearchParams<{
    courseId?: string;
    examId?: string;
    noteId?: string;
    topics?: string;
  }>();
  const sem = useSemester();
  const router = useRouter();
  const goBack = useSafeBack('/study');
  const advice = useCardAdvice();

  const [phase, setPhase] = useState<Phase>('learning');
  /** The pocket just finished, for its summary. */
  const [finished, setFinished] = useState<string[]>([]);
  /** Flashcards: what's ticked to start with, what's being drilled, and where "back" goes. */
  const [preset, setPreset] = useState<string[]>([]);
  const [drill, setDrill] = useState<string[]>([]);
  const [returnTo, setReturnTo] = useState<Phase>('learning');

  const scope = useMemo(
    () => ({
      courseId: params.courseId ?? undefined,
      examId: params.examId ?? undefined,
      noteId: params.noteId ?? undefined,
      topicIds: params.topics ? [params.topics] : undefined,
    }),
    [params.courseId, params.examId, params.noteId, params.topics],
  );
  const scopeKey = learnScopeKey(scope);
  const progress = sem.rows.learn_progress.find((p) => p.scope_key === scopeKey) ?? null;

  const inSet = useMemo(() => inScope(sem.cards, scope, sem.examTargets), [sem.cards, scope, sem.examTargets]);
  const seed = progress?.shuffle_seed ?? null;
  const pool = useMemo(() => learnOrder(inSet.map((k) => k.card), seed), [inSet, seed]);
  const ids = useMemo(() => pool.map((c) => c.id), [pool]);

  const today = localDateString(sem.now, sem.tz);
  const due = useMemo(
    () => (progress ? dueForReview(inSet, progress.done, zonedToUtc(addDaysYmd(today, 1), '00:00', sem.tz)) : []),
    [inSet, progress, today, sem.tz],
  );
  const todays = useMemo(
    () => studiedToday(inSet, today, (iso) => localDateString(new Date(iso), sem.tz)),
    [inSet, today, sem.tz],
  );
  const point = progress ? resumePoint(ids, progress, due) : null;
  const pocketKey = point?.pocket.join(',') ?? '';

  const examDate = useMemo(() => {
    if (params.examId) {
      const exam = sem.rows.exams.find((e) => e.id === params.examId);
      if (exam) return new Date(exam.happens_at);
    }
    // No syllabus exam picked — fall back to this set's own test date, if it has one.
    if (params.noteId) {
      const note = sem.rows.notes.find((n) => n.id === params.noteId);
      if (note?.test_date) return new Date(note.test_date);
    }
    return null;
  }, [params.examId, params.noteId, sem.rows.exams, sem.rows.notes]);

  const remaining = point?.remaining ?? pool.length;
  const recommendation = useMemo(
    () => calculateRecommendedPocketSize(remaining, examDate, sem.now),
    [remaining, examDate, sem.now],
  );

  // A freshly picked pocket is saved (with its start time), so every device resumes this same one.
  useEffect(() => {
    if (phase !== 'learning' || !progress || !point?.isNew) return;
    setLearnPocket(progress, point.pocket);
  }, [phase, progress, pocketKey, point?.isNew]); // eslint-disable-line react-hooks/exhaustive-deps

  if (pool.length === 0) {
    return (
      <Screen maxWidth={760}>
        <Empty
          title="No cards to study"
          body="Make some from a note (open a note and tap the cards button), or add your own."
          action={<Button title="Add cards" onPress={() => router.replace('/cards/new')} />}
        />
      </Screen>
    );
  }

  const restart = () => {
    if (!progress) return;
    const go = () => {
      restartLearning(progress);
      setPhase('learning');
    };
    const msg = 'You’ll go back to the first card. Your review history is kept.';
    if (Platform.OS === 'web') {
      if (window.confirm(`Start this set over?\n\n${msg}`)) go();
    } else {
      Alert.alert('Start this set over?', msg, [{ text: 'Cancel', style: 'cancel' }, { text: 'Start over', onPress: go }]);
    }
  };

  const review = () => {
    const q = new URLSearchParams({ order: 'smart', limit: String(pool.length) });
    if (scope.courseId) q.set('courseId', scope.courseId);
    if (scope.examId) q.set('examId', scope.examId);
    if (scope.noteId) q.set('noteId', scope.noteId);
    if (params.topics) q.set('topics', params.topics);
    router.replace(`/cards/review?${q.toString()}`);
  };

  const openFlashcards = (ticked: string[], from: Phase) => {
    setPreset(ticked);
    setReturnTo(from);
    setPhase('pick');
  };

  const setAdvice = scope.noteId ? advice.bySet.get(scope.noteId)?.length ?? 0 : 0;
  const adviceLink = setAdvice > 0 ? { count: setAdvice, onOpen: () => router.push(`/cards/check?noteId=${scope.noteId}`) } : undefined;

  if (!progress || !point) {
    const remembered = prefs.get().learnPocketSize;
    return (
      <PocketSetup
        recommendation={recommendation}
        totalCards={pool.length}
        initialSize={remembered && remembered <= pool.length ? remembered : recommendation.recommended}
        initialDirection={prefs.get().learnDirection}
        initialShuffle={prefs.get().learnShuffle}
        onStart={(size: number, direction: StudyDirection, shuffle: boolean) => startLearning(scopeKey, { pocketSize: size, direction, shuffle })}
        advice={adviceLink}
      />
    );
  }

  if (phase === 'pick') {
    return (
      <FlashcardPicker
        cards={pool}
        todayIds={todays.all}
        preselected={preset}
        onStart={(chosen) => {
          setDrill(chosen);
          setPhase('flashcards');
        }}
        onCancel={() => setPhase(returnTo)}
      />
    );
  }

  if (phase === 'flashcards') {
    return (
      <FlashcardDrill
        ids={drill}
        cards={pool}
        shuffle={seed !== null}
        direction={progress.direction}
        onMiss={(cardId) => {
          // Not sure of it after all: it's due again soon, so Learn brings it back later today.
          const card = pool.find((k) => k.id === cardId);
          if (card) reviewCard(card, 1);
        }}
        onBack={() => setPhase(returnTo === 'summary' ? 'summary' : 'learning')}
        onDone={goBack}
      />
    );
  }

  if (phase === 'options') {
    return (
      <PocketSetup
        recommendation={recommendation}
        totalCards={pool.length}
        initialSize={progress.pocket_size}
        initialDirection={progress.direction}
        initialShuffle={seed !== null}
        onStart={(size, direction, shuffle) => {
          setLearnSettings(progress, { pocket_size: size, direction, shuffle_seed: shuffle ? seed ?? newShuffleSeed() : null });
          setPhase('learning');
        }}
        editing={{
          learned: point.learned,
          onRestart: restart,
          onReshuffle: () => {
            setLearnSettings(progress, { shuffle_seed: newShuffleSeed() });
            setPhase('learning');
          },
          onCancel: () => setPhase('learning'),
        }}
        advice={adviceLink}
      />
    );
  }

  if (phase === 'summary' || point.complete) {
    const shown = phase === 'summary' ? finished : progress.pocket;
    const retried = shown.filter((id) => finishedInPocket(progress, id) && (progress.done[id].misses ?? 0) > 0);
    const next = nextReviewAt(inSet, progress.done);
    return (
      <PocketSummary
        stats={pocketStats(shown, progress)}
        complete={point.complete}
        dueWaiting={due.length}
        unlearned={point.remaining}
        total={point.total}
        pocketSize={progress.pocket_size}
        nextReviewIn={next ? relativeTime(next, sem.now, sem.tz) : null}
        retried={retried.length}
        shuffled={seed !== null}
        onNextPocket={(size) => {
          if (size !== progress.pocket_size) setLearnSettings(progress, { pocket_size: size });
          setPhase('learning');
        }}
        onFlashcards={() => openFlashcards(retried.length > 0 ? retried : todays.shaky, phase === 'summary' ? 'summary' : 'learning')}
        onRedo={(shuffle) => {
          // Everything's learned, so there's nothing to lose — no "are you sure?".
          restartLearning(progress, { shuffle });
          setPhase('learning');
        }}
        onReview={review}
        onEndSession={goBack}
      />
    );
  }

  const reviewIds = new Set(point.pocket.filter((id) => progress.done[id] && !finishedInPocket(progress, id)));
  const startedAt = progress.pocket_started_at ? Date.parse(progress.pocket_started_at) : 0;
  return (
    <LearningCard
      key={`${pocketKey}@${startedAt}`}
      pocket={point.pocket}
      queue={point.queue}
      reviewIds={reviewIds}
      cards={pool}
      direction={progress.direction}
      learned={point.learned}
      total={point.total}
      onFinished={(cardId, mark) => {
        // A card learned before this pocket (and so shown again as a spaced review).
        const review = Boolean(progress.done[cardId]) && !finishedInPocket(progress, cardId);
        markLearned(scopeKey, cardId, { ...mark, review, at: new Date().toISOString() });
      }}
      onPocketComplete={() => {
        setFinished(point.pocket);
        setPhase('summary');
      }}
      onOptions={() => setPhase('options')}
      onFlashcards={() => openFlashcards(todays.shaky, 'learning')}
    />
  );
}
