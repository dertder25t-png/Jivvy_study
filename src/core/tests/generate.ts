// Stage 2 of test generation: generate question stems from concepts (template-based, $0).
// Uses question templates instead of AI to minimize cost.

import type { QuestionCandidate } from './extract';

export type QuestionType = 'short_answer' | 'essay' | 'multiple_choice' | 'fill_blank' | 'true_false';

export interface GeneratedQuestion {
  concept: string;
  question_type: QuestionType;
  question_text: string;
  context: string;
  answer_blank?: string; // For fill-in-the-blank
  difficulty: 'easy' | 'medium' | 'hard';
  candidate_id?: string;
}

const QUESTION_TEMPLATES = [
  // Short answer
  {
    type: 'short_answer' as const,
    templates: [
      'Define {concept}.',
      'What is {concept}?',
      'Explain {concept} in your own words.',
      'Describe {concept}.',
      'What does {concept} mean?',
    ],
    difficulty: 'easy' as const,
  },
  // Fill in the blank (from context)
  {
    type: 'fill_blank' as const,
    templates: [
      '{concept} is a process where ___.',
      'The term {concept} refers to ___.',
      '{concept} can be defined as ___.',
      '{{blank}} is an example of {concept}.',
    ],
    difficulty: 'medium' as const,
  },
  // Essay
  {
    type: 'essay' as const,
    templates: [
      'Discuss the significance of {concept}.',
      'Explain how {concept} works and why it matters.',
      'Analyze {concept} and provide examples.',
      'What is the relationship between {concept} and other concepts we\'ve learned?',
    ],
    difficulty: 'hard' as const,
  },
  // True/False
  {
    type: 'true_false' as const,
    templates: [
      '{concept} is a fundamental concept in this course.',
      '{concept} is related to the topics we\'ve covered.',
      '{concept} can be observed in real-world situations.',
    ],
    difficulty: 'easy' as const,
  },
];

function pickRandomTemplate(templates: string[]): string {
  return templates[Math.floor(Math.random() * templates.length)];
}

function capitalizeFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatConcept(concept: string): string {
  return concept.toLowerCase().replace(/^[a-z]/, c => c.toUpperCase());
}

/** Generate question stems for a candidate concept. */
export function generateQuestions(candidate: QuestionCandidate): GeneratedQuestion[] {
  const questions: GeneratedQuestion[] = [];
  const concept = formatConcept(candidate.concept);

  // Generate 3-4 questions per concept with varied types
  const templates = QUESTION_TEMPLATES;

  for (const template of templates) {
    const questionTemplate = pickRandomTemplate(template.templates);
    let questionText = questionTemplate
      .replace(/{concept}/gi, concept)
      .replace(/{{blank}}/gi, concept);

    // Ensure it ends with proper punctuation
    if (!questionText.match(/[.!?]$/)) {
      questionText += '.';
    }

    questions.push({
      concept: candidate.concept,
      question_type: template.type,
      question_text: questionText,
      context: candidate.context,
      difficulty: template.difficulty,
      candidate_id: `${candidate.span_start}-${candidate.span_end}`,
    });
  }

  return questions;
}

/** Generate all questions from candidates. */
export function generateAllQuestions(candidates: QuestionCandidate[]): GeneratedQuestion[] {
  const allQuestions: GeneratedQuestion[] = [];

  for (const candidate of candidates) {
    const questions = generateQuestions(candidate);
    allQuestions.push(...questions);
  }

  // Shuffle to mix question types
  return allQuestions.sort(() => Math.random() - 0.5);
}

/** Stage 3: Simple programmatic filtering rules ($0) */
export interface QuestionIssue {
  questionId: string;
  rule: string;
  severity: 'warn' | 'error';
}

export function filterQuestions(questions: GeneratedQuestion[]): { kept: GeneratedQuestion[]; rejected: QuestionIssue[] } {
  const kept: GeneratedQuestion[] = [];
  const rejected: QuestionIssue[] = [];
  const seenQuestions = new Set<string>();

  for (const q of questions) {
    const qKey = q.question_text.toLowerCase();

    // Reject duplicates
    if (seenQuestions.has(qKey)) {
      rejected.push({
        questionId: `${q.concept}-${q.question_type}`,
        rule: 'duplicate_question',
        severity: 'error',
      });
      continue;
    }
    seenQuestions.add(qKey);

    // Reject if question is too short or malformed
    if (q.question_text.length < 10 || q.question_text.length > 500) {
      rejected.push({
        questionId: `${q.concept}-${q.question_type}`,
        rule: 'malformed_question',
        severity: 'error',
      });
      continue;
    }

    kept.push(q);
  }

  return { kept, rejected };
}
