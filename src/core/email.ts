// Email drafter (§5.2): pre-filled with course, instructor, the relevant
// assignment and the syllabus's own policy text — so the hard part
// (staring at a blank message to a professor) is already done.
import type { Assignment, Course, CoursePolicy, LatePolicy } from '@/types/db';
import { relativeTime } from './time';

export type EmailKind = 'extension' | 'policy_question' | 'absence' | 'grade_question' | 'office_hours';

export const EMAIL_KINDS: Array<{ kind: EmailKind; label: string; needsAssignment: boolean }> = [
  { kind: 'extension', label: 'Ask for an extension', needsAssignment: true },
  { kind: 'policy_question', label: 'Ask about a policy', needsAssignment: false },
  { kind: 'absence', label: 'Tell them I missed class', needsAssignment: false },
  { kind: 'grade_question', label: 'Ask about a grade', needsAssignment: true },
  { kind: 'office_hours', label: 'Ask for office hours', needsAssignment: false },
];

/** Plain-English restatement of the syllabus late policy, or null if there isn't one. */
export function describeLatePolicy(p: LatePolicy | undefined | null): string | null {
  if (!p || (p.accepted == null && p.window_hours == null && p.penalty_per_day == null && !p.notes)) return null;
  if (p.accepted === false) return 'The syllabus says late work is not accepted.';
  const bits: string[] = ['The syllabus allows late work'];
  if (p.window_hours != null) {
    bits.push(
      p.window_hours % 24 === 0
        ? `for up to ${p.window_hours / 24} day${p.window_hours === 24 ? '' : 's'} after the deadline`
        : `for up to ${p.window_hours} hours after the deadline`,
    );
  }
  if (p.penalty_per_day != null) bits.push(`with a ${Math.round(p.penalty_per_day * 100)}% penalty per day`);
  return bits.join(' ') + '.' + (p.notes ? ` ${p.notes}` : '');
}

export interface Draft {
  to: string;
  subject: string;
  body: string;
}

export function draftEmail(args: {
  kind: EmailKind;
  course: Course;
  policy?: CoursePolicy;
  assignment?: Assignment | null;
  studentName?: string;
  now: Date;
  tz: string;
}): Draft {
  const { kind, course, policy, assignment, studentName, now, tz } = args;
  const code = course.code ?? course.name;
  const greeting = course.instructor_name ? `Hi ${course.instructor_name},` : 'Hello,';
  const sign = `Thank you,\n${studentName ?? '[Your name]'}\n${course.name}${course.section ? `, Section ${course.section}` : ''}`;
  const policyLine = describeLatePolicy(policy?.late_policy);
  const what = assignment?.title ?? '[assignment]';
  const due = assignment?.due_at ? relativeTime(assignment.due_at, now, tz) : null;

  let subject = '';
  let body = '';
  switch (kind) {
    case 'extension':
      subject = `${code}: extension request for ${what}`;
      body = [
        greeting,
        '',
        `I'm in your ${code} class and I'm writing about "${what}"${due ? ` (due ${due})` : ''}. I'm having trouble finishing it on time because [brief reason].`,
        '',
        policyLine ? `${policyLine} I wanted to ask whether an extension is possible, or if late submission under that policy would be the best route.` : 'Would it be possible to get a short extension? I can turn it in by [date you can commit to].',
        '',
        sign,
      ].join('\n');
      break;
    case 'policy_question':
      subject = `${code}: quick question about the syllabus`;
      body = [greeting, '', `I'm in your ${code} class and had a question about [policy or topic].`, policyLine ? `I read: "${policyLine}" — could you confirm how that applies to [situation]?` : 'Could you clarify how that works?', '', sign].join('\n');
      break;
    case 'absence':
      subject = `${code}: I missed class`;
      body = [greeting, '', `I wasn't able to make it to ${code} on [day] because [brief reason]. Is there anything I should catch up on, or anything due that I should know about?`, '', sign].join('\n');
      break;
    case 'grade_question':
      subject = `${code}: question about my grade on ${what}`;
      body = [greeting, '', `I'd like to understand my grade on "${what}" a bit better. Could we go over it, or could you point me to where I lost points?`, '', sign].join('\n');
      break;
    case 'office_hours':
      subject = `${code}: office hours`;
      body = [greeting, '', `I'd like to come to office hours to talk about [topic]. When would be a good time this week?`, '', sign].join('\n');
      break;
  }
  return { to: course.instructor_email ?? '', subject, body };
}
