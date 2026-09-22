import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { inScope } from '@/core/session';
import { useSemester } from '@/data/derived';
import { Button, Empty, Screen, T } from '@/ui/components';
import { useColors } from '@/ui/theme';
import { calculateRecommendedPocketSize, createLearnSession, type LearnSession } from '@/core/learning';
import PocketSetup from './learn-components/PocketSetup';
import LearningCard from './learn-components/LearningCard';
import PocketSummary from './learn-components/PocketSummary';

type Phase = 'setup' | 'learning' | 'summary';

export default function LearnMode() {
  const params = useLocalSearchParams<{
    courseId?: string;
    examId?: string;
    topics?: string;
    limit?: string;
    order?: string;
  }>();
  const sem = useSemester();
  const router = useRouter();
  const c = useColors();

  const [phase, setPhase] = useState<Phase>('setup');
  const [session, setSession] = useState<LearnSession | null>(null);
  const [pocketSize, setPocketSize] = useState<number | null>(null);

  const scope = useMemo(
    () => ({
      courseId: params.courseId ?? undefined,
      examId: params.examId ?? undefined,
      topicIds: params.topics ? [params.topics] : undefined,
    }),
    [params.courseId, params.examId, params.topics],
  );

  const pool = useMemo(
    () =>
      inScope(sem.cards, scope, sem.examTargets)
        .map((k) => k.card)
        .filter((c) => c.status === 'accepted' || c.status === 'edited'),
    [sem.cards, scope, sem.examTargets],
  );

  const examDate = useMemo(() => {
    if (!params.examId) return null;
    const exam = sem.rows.exams.find((e) => e.id === params.examId);
    return exam ? new Date(exam.happens_at) : null;
  }, [params.examId, sem.rows.exams]);

  const recommendation = useMemo(
    () => calculateRecommendedPocketSize(pool.length, examDate, sem.now),
    [pool.length, examDate, sem.now],
  );

  if (pool.length === 0) {
    return (
      <Screen>
        <Empty
          title="No cards to study"
          body="Make some from a note (open a note and tap the cards button), or add your own."
          action={<Button title="Add cards" onPress={() => router.replace('/cards/new')} />}
        />
      </Screen>
    );
  }

  const handleStartLearning = (size: number) => {
    const cardIds = pool.slice(0, Math.min(size, pool.length)).map((c) => c.id);
    const newSession = createLearnSession(cardIds, size);
    setSession(newSession);
    setPocketSize(size);
    setPhase('learning');
  };

  const handlePocketComplete = () => {
    setPhase('summary');
  };

  const handleNextPocket = (newSize: number) => {
    if (session) {
      const nextStart = session.currentIndex;
      const remaining = pool.slice(nextStart, nextStart + newSize);
      if (remaining.length > 0) {
        const cardIds = remaining.map((c) => c.id);
        const newSession = createLearnSession(cardIds, newSize);
        setSession(newSession);
        setPocketSize(newSize);
        setPhase('learning');
      } else {
        router.back();
      }
    }
  };

  const handleEndSession = () => {
    router.back();
  };

  if (phase === 'setup') {
    return (
      <PocketSetup
        recommendation={recommendation}
        totalCards={pool.length}
        onStart={handleStartLearning}
      />
    );
  }

  if (phase === 'summary' && session) {
    return (
      <PocketSummary
        session={session}
        cards={pool}
        recommendation={recommendation}
        onNextPocket={handleNextPocket}
        onEndSession={handleEndSession}
      />
    );
  }

  if (phase === 'learning' && session) {
    return (
      <LearningCard
        session={session}
        cards={pool}
        onPocketComplete={handlePocketComplete}
      />
    );
  }

  return <Screen />;
}
