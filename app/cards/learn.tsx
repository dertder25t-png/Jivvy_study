import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { inScope } from '@/core/session';
import {
  calculateRecommendedPocketSize, learnOrder, learnScopeKey, pocketStats, resumePoint, type StudyDirection,
} from '@/core/learning';
import { markLearned, restartLearning, setLearnPocket, setLearnSettings, startLearning } from '@/data/actions';
import { useSemester } from '@/data/derived';
import { prefs } from '@/data/prefs';
import { Button, Empty, Screen } from '@/ui/components';
import PocketSetup from './learn-components/PocketSetup';
import LearningCard from './learn-components/LearningCard';
import PocketSummary from './learn-components/PocketSummary';

type Phase = 'learning' | 'summary' | 'options';

/**
 * Learn mode. The first time you learn a set it asks how (pocket size, what to type); after that it
 * goes straight back to the next card you haven't finished — on any device — until you start over.
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

  const [phase, setPhase] = useState<Phase>('learning');
  /** The pocket just finished, for its summary. */
  const [finished, setFinished] = useState<string[]>([]);

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

  const pool = useMemo(
    () => learnOrder(inScope(sem.cards, scope, sem.examTargets).map((k) => k.card)),
    [sem.cards, scope, sem.examTargets],
  );
  const ids = useMemo(() => pool.map((c) => c.id), [pool]);
  const point = progress ? resumePoint(ids, progress) : null;
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

  // A freshly picked pocket is saved, so every device resumes this same one.
  useEffect(() => {
    if (phase !== 'learning' || !progress || !point || point.pocket.length === 0) return;
    if (progress.pocket.join(',') !== pocketKey) setLearnPocket(progress, point.pocket);
  }, [phase, progress, pocketKey]); // eslint-disable-line react-hooks/exhaustive-deps

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

  if (!progress || !point) {
    const remembered = prefs.get().learnPocketSize;
    return (
      <PocketSetup
        recommendation={recommendation}
        totalCards={pool.length}
        initialSize={remembered && remembered <= pool.length ? remembered : recommendation.recommended}
        initialDirection={prefs.get().learnDirection}
        onStart={(size: number, direction: StudyDirection) => startLearning(scopeKey, { pocketSize: size, direction })}
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
        onStart={(size, direction) => {
          setLearnSettings(progress, { pocket_size: size, direction });
          setPhase('learning');
        }}
        editing={{ learned: point.learned, onRestart: restart, onCancel: () => setPhase('learning') }}
      />
    );
  }

  if (phase === 'summary' || point.complete) {
    const shown = phase === 'summary' ? finished : ids;
    return (
      <PocketSummary
        stats={pocketStats(shown, progress.done)}
        remaining={point.remaining}
        total={point.total}
        pocketSize={progress.pocket_size}
        onNextPocket={(size) => {
          if (size !== progress.pocket_size) setLearnSettings(progress, { pocket_size: size });
          setPhase('learning');
        }}
        onRestart={restart}
        onReview={review}
        onEndSession={() => router.back()}
      />
    );
  }

  return (
    <LearningCard
      key={pocketKey}
      pocket={point.pocket}
      startIndex={point.position}
      cards={pool}
      direction={progress.direction}
      learned={point.learned}
      total={point.total}
      onGraded={(cardId, grade, accuracy) => markLearned(scopeKey, cardId, { grade, accuracy, at: new Date().toISOString() })}
      onPocketComplete={() => {
        setFinished(point.pocket);
        setPhase('summary');
      }}
      onOptions={() => setPhase('options')}
    />
  );
}
