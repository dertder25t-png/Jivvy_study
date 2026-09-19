import React, { useMemo } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { coverageGaps } from '@/core/notes';
import { cardStrength, dueQueue, examReviewQueue } from '@/core/scheduling';
import { minutesFor, paceSecondsPerCard, studyAdvice } from '@/core/session';
import { formatPercent } from '@/core/grades';
import { MS, relativeDay, relativeTime } from '@/core/time';
import { useSemester } from '@/data/derived';
import { Badge, Button, Card, Empty, Row, Screen, Section, T } from '@/ui/components';
import { useColors } from '@/ui/theme';

export default function Study() {
  const sem = useSemester();
  const router = useRouter();
  const c = useColors();
  const { now, tz } = sem;

  const live = useMemo(() => sem.cards.filter((k) => k.card.status !== 'pending' && k.card.status !== 'rejected'), [sem.cards]);
  const due = useMemo(() => dueQueue(live, now), [live, now]);
  const pace = useMemo(() => paceSecondsPerCard(sem.rows.card_reviews), [sem.rows.card_reviews]);
  const advice = useMemo(() => studyAdvice({ pool: live, examTargets: sem.examTargets, now, tz, pace }), [live, sem.examTargets, now, tz, pace]);
  // "Start" clears what's due and tops up to a worthwhile session with the weakest cards — never locked to the schedule.
  const quickLimit = Math.min(live.length, Math.min(40, Math.max(10, due.length)));

  const upcoming = useMemo(
    () => sem.examTargets.filter((e) => e.at > now).sort((a, b) => a.at.getTime() - b.at.getTime()),
    [sem.examTargets, now],
  );

  const examCard = useMemo(() => {
    for (const e of upcoming) {
      if (e.at.getTime() - now.getTime() > 14 * MS.DAY) break;
      const q = examReviewQueue({ cards: live, exam: e, now, limit: 15 });
      if (q.length > 0) return { exam: e, count: q.length };
    }
    return null;
  }, [upcoming, live, now]);

  const pendingByNote = useMemo(() => {
    const m = new Map<string, number>();
    for (const k of sem.rows.cards) if (k.status === 'pending' && k.source_note_id) m.set(k.source_note_id, (m.get(k.source_note_id) ?? 0) + 1);
    return [...m.entries()];
  }, [sem.rows.cards]);

  // Show what's coming in the next ~10 days; if nothing is that close, still show the first couple
  // so the plan is visibly there ("In 2 weeks · 30 min …") rather than absent.
  const soon = sem.sessions.filter((s) => s.dayOffset <= 10).slice(0, 6);
  const plan = soon.length > 0 ? soon : sem.sessions.slice(0, 2);

  // ---- coverage gaps ("Exam 2 covers 6 topics. You have no notes for 2 of them.") ----
  const gaps = useMemo(
    () =>
      upcoming
        .filter((e) => e.at.getTime() - now.getTime() <= 28 * MS.DAY)
        .map((e) => {
          const exam = sem.rows.exams.find((x) => x.id === e.examId)!;
          const topics = sem.topicsByCourse.get(exam.course_id) ?? [];
          const missing = coverageGaps({ topicIds: [...e.topicIds], topics, notes: sem.rows.notes.filter((n) => n.course_id === exam.course_id) });
          return { e, exam, total: e.topicIds.size, missing };
        })
        .filter((g) => g.missing.length > 0),
    [upcoming, sem, now],
  );

  // ---- staleness ("Week 3 material untouched since week 3, with a cumulative final coming") ----
  const stale = useMemo(() => {
    const out: Array<{ title: string; weeks: number; exam: string }> = [];
    const seen = new Set<string>();
    for (const e of upcoming) {
      for (const tid of e.topicIds) {
        if (seen.has(tid)) continue;
        seen.add(tid);
        const topic = sem.rows.topics.find((t) => t.id === tid);
        if (!topic?.starts_on || new Date(`${topic.starts_on}T12:00:00Z`) > now) continue;
        const touches: number[] = [new Date(`${topic.starts_on}T12:00:00Z`).getTime()];
        for (const k of live) if (k.card.topic_id === tid) for (const r of k.reviews) touches.push(new Date(r.reviewed_at).getTime());
        for (const n of sem.rows.notes) if (n.topic_id === tid) touches.push(new Date(n.updated_at).getTime());
        const days = (now.getTime() - Math.max(...touches)) / MS.DAY;
        if (days >= 14) out.push({ title: `${topic.week_no != null ? `Wk ${topic.week_no}: ` : ''}${topic.title}`, weeks: Math.round(days / 7), exam: e.title });
      }
    }
    return out.sort((a, b) => b.weeks - a.weeks).slice(0, 3);
  }, [upcoming, sem, live, now]);

  // ---- post-exam loop ----
  const postExam = useMemo(() => {
    const out: Array<{ title: string; pct: number; weak: string[] }> = [];
    for (const a of sem.rows.assignments) {
      if (a.type !== 'exam' || a.status !== 'graded' || a.points_earned == null || !a.points_possible) continue;
      const exam = sem.rows.exams.find((x) => x.assignment_id === a.id);
      if (!exam || now.getTime() - new Date(exam.happens_at).getTime() > 21 * MS.DAY) continue;
      const cover = sem.examTargets.find((t) => t.examId === exam.id);
      const ranked = [...(cover?.topicIds ?? [])]
        .map((tid) => {
          const cs = live.filter((k) => k.card.topic_id === tid);
          const s = cs.length ? cs.reduce((x, k) => x + cardStrength(k.reviews, now), 0) / cs.length : 0;
          return { title: sem.rows.topics.find((t) => t.id === tid)?.title ?? '', s };
        })
        .sort((x, y) => x.s - y.s)
        .slice(0, 3)
        .map((x) => x.title)
        .filter(Boolean);
      out.push({ title: exam.title, pct: (a.points_earned / a.points_possible) * 100, weak: ranked });
    }
    return out;
  }, [sem, live, now]);

  const nothing = live.length === 0 && pendingByNote.length === 0;

  return (
    <Screen>
      {examCard ? (
        <Card tone="primary">
          <T variant="label" color={c.primary}>Test {relativeTime(examCard.exam.at, now, tz)}</T>
          <T variant="title">{examCard.exam.title}: the {examCard.count} cards you're weakest on</T>
          <Button title={`Start (${examCard.count} cards)`} onPress={() => router.push(`/cards/review?examId=${examCard.exam.examId}`)} />
        </Card>
      ) : null}

      {live.length > 0 ? (
        <Card>
          <T variant="heading">Study</T>
          <T variant="body">{advice.lines[0]}</T>
          <Row style={{ flexWrap: 'wrap' }}>
            <Button
              title={`Start · ${quickLimit} card${quickLimit === 1 ? '' : 's'} · ~${minutesFor(quickLimit, pace)} min`}
              variant={examCard ? 'secondary' : 'primary'}
              onPress={() => router.push(`/cards/review?limit=${quickLimit}&order=smart`)}
            />
            <Button title="Choose what to study" variant="secondary" onPress={() => router.push('/cards/setup')} />
          </Row>
          {advice.lines.slice(1, 2).map((l) => <T key={l} variant="small" muted>{l}</T>)}
          <T variant="small" muted>Optional — study whenever you like, for as long as you like.</T>
        </Card>
      ) : null}

      {pendingByNote.map(([noteId, n]) => (
        <Card key={noteId} tone="warn" onPress={() => router.push(`/cards/generate?noteId=${noteId}`)}>
          <T variant="heading">{n} new card{n === 1 ? '' : 's'} waiting for your OK</T>
          <T variant="small" muted>About 90 seconds — and it counts as a first study pass.</T>
        </Card>
      ))}

      {plan.length > 0 ? (
        <Section title="Your plan">
          <Card>
            {plan.map((s, i) => (
              <View key={`${s.examId}-${s.date}-${s.kind}-${i}`} style={{ gap: 2, paddingVertical: 4 }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <T variant="body" style={{ fontWeight: '600' }}>{s.dayOffset === 0 ? 'Today' : relativeDay(s.date, now, tz)} · {s.minutes} min</T>
                  <Badge label={s.examTitle} />
                </Row>
                <T variant="small" muted>{s.what}</T>
                <Row>
                  {s.kind === 'add_notes' ? (
                    <Button title="Add notes" small variant="ghost" onPress={() => router.push(`/note/new?courseId=${s.courseId}`)} />
                  ) : (
                    <Button title="Start" small variant="ghost" onPress={() => router.push(`/cards/review?examId=${s.examId}`)} />
                  )}
                </Row>
              </View>
            ))}
          </Card>
        </Section>
      ) : null}

      {postExam.map((p) => (
        <Card key={p.title} tone="good">
          <T variant="label" color={c.good}>{p.title} · {formatPercent(p.pct, 0)}</T>
          <T variant="body">
            {p.weak.length > 0 ? `Your cards were weakest on ${p.weak.join(', ')} going in. Those will lead your next study plan.` : 'Nice work getting through it.'}
          </T>
        </Card>
      ))}

      {gaps.length > 0 ? (
        <Section title="Gaps to fill">
          {gaps.slice(0, 3).map((g) => (
            <Card key={g.e.examId}>
              <T variant="body">
                {g.e.title} covers {g.total} topics. You have no notes for {g.missing.length} of them.
              </T>
              <T variant="small" muted>{g.missing.slice(0, 3).map((t) => t.title).join(' · ')}{g.missing.length > 3 ? '…' : ''}</T>
              <Button title="Add notes" small variant="secondary" onPress={() => router.push(`/note/new?courseId=${g.exam.course_id}`)} />
            </Card>
          ))}
        </Section>
      ) : null}

      {stale.length > 0 ? (
        <Section title="Getting rusty">
          <Card>
            {stale.map((s) => (
              <T key={s.title} variant="small">
                {s.title} — untouched for {s.weeks} weeks, and it's on {s.exam}.
              </T>
            ))}
          </Card>
        </Section>
      ) : null}

      {nothing && plan.length === 0 ? (
        <Empty
          title="Cards start from your notes"
          body="Write or capture notes with bolded terms or “Term: meaning” lines, then make cards from any note in one tap. Or add your own."
        />
      ) : null}

      <Row style={{ flexWrap: 'wrap' }}>
        <Button title="Add cards" variant="secondary" onPress={() => router.push('/cards/new')} />
        <Button title={`Your cards (${live.length})`} variant="ghost" onPress={() => router.push('/cards/deck')} />
      </Row>
    </Screen>
  );
}
