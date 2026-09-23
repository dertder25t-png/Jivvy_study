import React, { useEffect, useState } from 'react';
import { Linking, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { EMAIL_KINDS, draftEmail, type EmailKind } from '@/core/email';
import { addWaitingOn } from '@/data/actions';
import { useSemester } from '@/data/derived';
import { prefs } from '@/data/prefs';
import { Button, Card, Chip, Empty, Field, Row, Screen, Section, T } from '@/ui/components';

export default function EmailProfessor() {
  const params = useLocalSearchParams<{ courseId?: string; assignmentId?: string }>();
  const sem = useSemester();
  const router = useRouter();
  const [courseId, setCourseId] = useState<string | null>(params.courseId ?? sem.rows.courses[0]?.id ?? null);
  const [assignmentId, setAssignmentId] = useState<string | null>(params.assignmentId ?? null);
  const [kind, setKind] = useState<EmailKind>(params.assignmentId ? 'extension' : 'policy_question');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [copied, setCopied] = useState(false);

  const course = courseId ? sem.courseById.get(courseId) : undefined;
  const assignments = sem.rows.assignments.filter((a) => a.course_id === courseId && a.status !== 'dismissed' && a.status !== 'graded');
  const assignment = assignments.find((a) => a.id === assignmentId) ?? null;
  const needsAssignment = EMAIL_KINDS.find((k) => k.kind === kind)?.needsAssignment ?? false;

  useEffect(() => {
    if (!course) return;
    const d = draftEmail({
      kind, course, policy: sem.policies.get(course.id), assignment, studentName: prefs.get().studentName || undefined,
      now: new Date(), tz: sem.tz,
    });
    setSubject(d.subject);
    setBody(d.body);
    // regenerate only when the inputs change, never on every data tick (would erase edits)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, courseId, assignmentId]);

  if (sem.rows.courses.length === 0) return <Screen maxWidth={760}><Empty title="Add a course first" /></Screen>;

  const to = course?.instructor_email ?? '';
  const open = async () => {
    const url = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    try {
      await Linking.openURL(url);
    } catch {
      await copy();
    }
  };
  const copy = async () => {
    await Clipboard.setStringAsync(`To: ${to}\nSubject: ${subject}\n\n${body}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const markSent = () => {
    const what = `Emailed ${course?.instructor_name ?? 'my professor'} re: ${assignment ? assignment.title : EMAIL_KINDS.find((k) => k.kind === kind)?.label.toLowerCase()}`;
    addWaitingOn({ what, courseId, nudgeInDays: 3 });
    router.replace('/waiting');
  };

  return (
    <Screen maxWidth={760}>
      <Section title="Course">
        <Row style={{ flexWrap: 'wrap' }}>
          {sem.rows.courses.map((k) => (
            <Chip key={k.id} label={k.code ?? k.name} selected={k.id === courseId} color={k.color} onPress={() => { setCourseId(k.id); setAssignmentId(null); }} />
          ))}
        </Row>
      </Section>

      <Section title="What's it about?">
        <Row style={{ flexWrap: 'wrap' }}>
          {EMAIL_KINDS.map((k) => <Chip key={k.kind} label={k.label} small selected={k.kind === kind} onPress={() => setKind(k.kind)} />)}
        </Row>
      </Section>

      {needsAssignment ? (
        <Section title="Which assignment?">
          <Row style={{ flexWrap: 'wrap' }}>
            {assignments.slice(0, 12).map((a) => <Chip key={a.id} label={a.title} small selected={a.id === assignmentId} onPress={() => setAssignmentId(a.id)} />)}
          </Row>
        </Section>
      ) : null}

      {!to ? <Card tone="warn"><T variant="small">No email address found for this professor. You can still copy the draft.</T></Card> : null}

      <Card>
        <Field label="To" value={to} editable={false} />
        <Field label="Subject" value={subject} onChangeText={setSubject} />
        <Field label="Message" value={body} onChangeText={setBody} multiline style={{ minHeight: 260 }} />
      </Card>
      <T variant="small" muted>Fill in the [brackets], then send it from your own email. Nothing is sent from here.</T>

      <Row style={{ flexWrap: 'wrap' }}>
        {Platform.OS !== 'web' || to ? <Button title="Open in email app" onPress={open} /> : null}
        <Button title={copied ? 'Copied' : 'Copy'} variant="secondary" onPress={copy} />
      </Row>
      <Button title="I sent it — remind me if they don't reply" variant="ghost" onPress={markSent} />
    </Screen>
  );
}
