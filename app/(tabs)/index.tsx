import React, { useMemo } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { BUCKET_LABEL, bucketFor, type Bucket } from '@/core/time';
import { crunchHeadline, crunchWhen } from '@/core/collisions';
import { oneThingToday } from '@/core/triage';
import { useSemester } from '@/data/derived';
import { addSampleSemester } from '@/data/actions';
import { Button, Card, Empty, Row, Screen, Section, T } from '@/ui/components';
import { ObligationRow, dueLabel, impactLabel } from '@/ui/rows';
import { store } from '@/data/store';
import { ImportOffer } from '@/ui/ImportOffer';
import { SyncProblemBanner } from '@/ui/SyncBanner';
import { TodayPlan } from '@/ui/TodayPlan';
import { Columns, useLayout } from '@/ui/layout';
import { useColors } from '@/ui/theme';

const ORDER: Bucket[] = ['today', 'tomorrow', 'this_week', 'next_week', 'later'];

export default function ComingUp() {
  const sem = useSemester();
  const router = useRouter();
  const c = useColors();
  const { isDesktop, isPhone } = useLayout();
  const { now, tz } = sem;

  const { buckets, undated, pastDue, hiddenLater } = useMemo(() => {
    const open = sem.obligations.filter((o) => !o.done && o.kind !== 'waiting_on');
    const buckets = new Map<Bucket, typeof open>();
    const undated: typeof open = [];
    let pastDue = 0;
    for (const o of open) {
      if (!o.dueAt) {
        undated.push(o);
        continue;
      }
      const b = bucketFor(o.dueAt, now, tz);
      if (b === 'overdue') {
        pastDue++;
        continue;
      }
      buckets.set(b, [...(buckets.get(b) ?? []), o]);
    }
    for (const list of buckets.values()) list.sort((a, b) => a.dueAt!.getTime() - b.dueAt!.getTime());
    const later = buckets.get('later') ?? [];
    if (later.length > 8) buckets.set('later', later.slice(0, 8));
    return { buckets, undated, pastDue, hiddenLater: Math.max(0, later.length - 8) };
  }, [sem.obligations, now, tz]);

  const one = useMemo(() => oneThingToday(sem.obligations, now), [sem.obligations, now]);
  const crunch = sem.crunch.find((w) => w.weeksAway <= 6);
  const dueWaiting = sem.rows.waiting_on.filter((w) => !w.resolved_at && new Date(w.nudge_at) <= now);

  if (sem.rows.courses.length === 0) {
    return (
      <Screen maxWidth={640}>
        <SyncProblemBanner />
        <ImportOffer />
        <TodayPlan prep={sem.prep} now={now} tz={tz} pace={sem.pace} />
        <View style={{ height: isDesktop ? 48 : 24 }} />
        <T variant="big">Your semester{'\n'}builds itself.</T>
        <T muted>Drop in a syllabus and every deadline, exam, grade weight and late policy shows up here — no typing.</T>
        <Button title="Add a syllabus" onPress={() => router.push('/syllabus/add')} style={{ alignSelf: isPhone ? 'stretch' : 'flex-start' }} />
        {store.mode === 'local' ? (
          <Card tone="alt">
            <T variant="heading">Just looking around?</T>
            <T variant="small" muted>Load a sample semester (two courses) to see how everything fits together.</T>
            <Button title="Load a sample semester" variant="secondary" onPress={() => addSampleSemester(new Date())} style={{ alignSelf: isPhone ? 'stretch' : 'flex-start' }} />
          </Card>
        ) : null}
      </Screen>
    );
  }

  const focus = one ? (
    <Card tone="primary" onPress={() => (one.kind === 'assignment' ? router.push(`/assignment/${one.refId}`) : undefined)}>
      <T variant="label" color={c.primary}>The one thing that matters</T>
      <T variant="title">{one.title}</T>
      <T muted>
        {sem.courseName(one.courseId)} · {dueLabel(one, now, tz)}
        {impactLabel(one.impact) ? ` · ${impactLabel(one.impact)}` : ''}
      </T>
    </Card>
  ) : null;

  const todayPlan = <TodayPlan prep={sem.prep} now={now} tz={tz} pace={sem.pace} />;

  const alerts = (
    <>
      {crunch ? (
        <Card tone="warn" onPress={() => router.push('/crunch')}>
          <T variant="label" color={c.warn}>Heads up — {crunchWhen(crunch)}</T>
          <T variant="heading">{crunchHeadline(crunch)}</T>
          <T variant="small" muted>See the week and plan around it.</T>
        </Card>
      ) : null}

      {sem.inboxCount > 0 ? (
        <Card onPress={() => router.push('/notes')}>
          <Row style={{ justifyContent: 'space-between' }}>
            <T variant="body" style={{ flex: 1 }}>{sem.inboxCount} note{sem.inboxCount === 1 ? '' : 's'} could use a quick confirm</T>
            <T variant="small" color={c.primary} style={{ fontWeight: '600' }}>Review</T>
          </Row>
        </Card>
      ) : null}

      {dueWaiting.length > 0 ? (
        <Card onPress={() => router.push('/waiting')}>
          <T variant="body">Time to follow up on: {dueWaiting[0].what}{dueWaiting.length > 1 ? ` (+${dueWaiting.length - 1})` : ''}</T>
        </Card>
      ) : null}

      {pastDue > 0 ? (
        <Card tone="alt" onPress={() => router.push('/comeback')}>
          <T variant="body">{pastDue} thing{pastDue === 1 ? ' is' : 's are'} past due</T>
          <T variant="small" muted>See what's still salvageable — some of it usually is.</T>
        </Card>
      ) : null}
    </>
  );

  const timeline = (
    <>
      {ORDER.map((b) => {
        const list = buckets.get(b);
        if (!list?.length) return null;
        return (
          <Section key={b} title={BUCKET_LABEL[b]}>
            <View style={{ gap: 8 }}>
              {list.map((o) => <ObligationRow key={o.id} o={o} sem={sem} />)}
              {b === 'later' && hiddenLater > 0 ? <T variant="small" muted>+{hiddenLater} more further out</T> : null}
            </View>
          </Section>
        );
      })}

      {undated.length > 0 ? (
        <Section title="Date not set yet">
          <View style={{ gap: 8 }}>
            {undated.slice(0, 5).map((o) => <ObligationRow key={o.id} o={o} sem={sem} />)}
          </View>
        </Section>
      ) : null}

      {sem.obligations.filter((o) => !o.done && o.kind !== 'waiting_on').length === 0 ? (
        <Empty title="Nothing coming up" body="Enjoy it. New work shows up here as soon as it's on a syllabus or you capture it." />
      ) : null}
    </>
  );

  return (
    <Screen>
      <SyncProblemBanner />
      <ImportOffer />
      {isDesktop && (crunch || sem.inboxCount > 0 || dueWaiting.length > 0 || pastDue > 0) ? (
        <Columns main={<>{focus}{todayPlan}{timeline}</>} side={alerts} sideWidth={340} />
      ) : (
        <>
          {focus}
          {todayPlan}
          {alerts}
          {timeline}
        </>
      )}
    </Screen>
  );
}
