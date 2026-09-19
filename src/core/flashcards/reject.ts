// Stage 3 — programmatic rejection ($0). Runs before a human sees anything.
// Guardrails in code, not in the prompt: the prompt is a suggestion, this is a rule.
import { PRONOUNS, STOPWORDS, containsStemmed, similarity, stem, wordCount, words } from './text';

export type RejectReason =
  | 'circular'
  | 'too_long'
  | 'term_too_long'
  | 'term_is_sentence'
  | 'compound'
  | 'duplicate'
  | 'degenerate_term'
  | 'meta_language'
  | 'pronoun'
  | 'invalid_cloze'
  | 'low_confidence'
  | 'empty_output';

export interface CardDraft {
  term: string;
  definition: string;
  card_type: 'term_def' | 'cloze';
  cloze_text: string | null;
  confidence: number;
}

export interface ExistingCard {
  term: string;
  definition: string;
}

export const LIMITS = {
  maxDefinitionWords: 25,
  maxTermWords: 6,
  /** Same (or near-identical) term AND a broadly similar definition → same card twice. */
  sameTermSimilarity: 0.9,
  sameTermDefinitionSimilarity: 0.5,
  /**
   * Identical definition under a different label → a synonym card. Must be exactly identical:
   * flipping one word ("increases"/"decreases") is a contrast pair, not a duplicate.
   */
  sameDefinitionSimilarity: 1,
  minConfidence: 0.6,
  maxClozeAnswerWords: 6,
};

const META = [
  /\bthe (?:lecture|lecturer|professor|instructor|teacher|speaker|author|authors|text|textbook|reading|slide|slides|notes|passage|article|chapter) (?:explains?|says?|states?|mentions?|discusses?|describes?|notes?|defines?|talks? about|covers?)\b/i,
  /\baccording to\b/i,
  /^(?:in|from) (?:the|this|today's) (?:lecture|class|reading|text|chapter|notes|slides)\b/i,
  /\b(?:as (?:mentioned|discussed|noted|stated) (?:in|by|above|earlier))\b/i,
  /\b(?:the professor|the instructor|the author)\b/i,
];

const SUBJECT_START = /^(?:the|a|an|it|they|he|she|we|this|that|these|those|its|their|[A-Z][a-z]+)\b/;
const AUX = /\b(?:is|are|was|were|has|have|had|can|will|does|do|must|should|may|might|occurs?|happens?|refers?|makes?|uses?|involves?|causes?|leads?)\b|\w+(?:s|ed|ing)\b/;

/** Two independent clauses joined by a coordinating conjunction or semicolon. */
export function isCompound(definition: string): boolean {
  const parts = definition.split(/;\s+|,\s+(?:and|but|or|so|yet)\s+/i);
  if (parts.length < 2) return false;
  // Every clause after the first must look like its own sentence: ≥4 words and a subject + verb.
  return parts.slice(1).some((p) => {
    const t = p.trim();
    return wordCount(t) >= 4 && SUBJECT_START.test(t) && AUX.test(t.split(/\s+/).slice(1).join(' '));
  });
}

const CLOZE = /\{\{c(\d+)::(.+?)\}\}/g;

export function clozeAnswers(text: string): string[] {
  return [...text.matchAll(CLOZE)].map((m) => m[2]);
}

export function clozeBlanked(text: string, reveal = false): string {
  return text.replace(CLOZE, (_, _n, ans) => (reveal ? ans : '[…]'));
}

export function checkCard(
  card: Partial<CardDraft> | null | undefined,
  existing: ExistingCard[],
  minConfidence = LIMITS.minConfidence,
): RejectReason | null {
  const term = (card?.term ?? '').trim();
  const definition = (card?.definition ?? '').trim();
  if (!card || !term || !definition) return 'empty_output';

  const isCloze = card.card_type === 'cloze';

  // circular: definition contains the term (case + stem insensitive)
  if (!isCloze && containsStemmed(definition, term)) return 'circular';

  if (wordCount(definition) > LIMITS.maxDefinitionWords) return 'too_long';
  if (wordCount(term) > LIMITS.maxTermWords) return 'term_too_long';
  if (/[.!?;:]$/.test(term)) return 'term_is_sentence';
  if (isCompound(definition)) return 'compound';

  // Judge duplicates mainly by TERM. Near-identical definitions under different terms are usually
  // contrast pairs ("increases" vs "decreases", positive vs negative reinforcement) — keep those.
  const dup = existing.some((e) => {
    const termSim = similarity(term, e.term);
    const defSim = similarity(definition, e.definition);
    return (
      (termSim >= LIMITS.sameTermSimilarity && defSim >= LIMITS.sameTermDefinitionSimilarity) ||
      defSim >= LIMITS.sameDefinitionSimilarity
    );
  });
  if (dup) return 'duplicate';

  const tw = words(term);
  if (
    tw.length === 0 ||
    term.length < 2 ||
    tw.every((w) => STOPWORDS.has(w.toLowerCase())) ||
    (tw.length <= 2 && PRONOUNS.has(tw[0].toLowerCase())) ||
    /^[\d\s.,-]+$/.test(term)
  ) {
    return 'degenerate_term';
  }

  if (META.some((re) => re.test(definition))) return 'meta_language';

  // "no pronouns" — a definition must stand alone on a flashcard, so no dangling references back to
  // something else (it / they / he / this…). Generic "we"/"you" ("what we know about the world") is
  // fine: it points at nothing outside the card.
  const defWords = words(definition).map((w) => w.toLowerCase());
  const danglingPronouns = new Set(['it', 'its', 'they', 'them', 'their', 'he', 'she', 'him', 'his', 'her']);
  if (defWords.some((w) => danglingPronouns.has(w)) || ['this', 'that', 'these', 'those'].includes(defWords[0] ?? '')) {
    return 'pronoun';
  }

  if (isCloze) {
    const text = card.cloze_text ?? '';
    const answers = clozeAnswers(text);
    if (
      answers.length < 1 ||
      answers.length > 2 ||
      answers.some((a) => wordCount(a) > LIMITS.maxClozeAnswerWords || a.trim() === '') ||
      wordCount(clozeBlanked(text)) < 4
    ) {
      return 'invalid_cloze';
    }
  }

  if ((card.confidence ?? 0) < minConfidence) return 'low_confidence';
  return null;
}

// Re-exported so callers don't need to know about the stemmer.
export { stem };
