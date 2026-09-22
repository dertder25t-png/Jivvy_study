// Stage 2 — rule-based rewrite ($0, no model, runs on the device).
//
// Turns each Stage-1 candidate into a card that Stage 3's rules accept: a short term and a
// standalone one-sentence definition (≤25 words), or a fill-in-the-blank when the passage is a
// fact about someone/something rather than a definition. It only trims and reshapes the
// student's own words — it never adds facts. Anything it can't clean up still goes to Stage 3,
// which rejects it with a reason, so the funnel stays honest.
import type { Candidate } from './extract';
import type { RewriteResponse } from './pipeline';
import { LIMITS, isCompound } from './reject';
import { PRONOUNS, STOPWORDS, capitalize, containsStemmed, stemmedTokens, stripMarkdown, wordCount, words } from './text';

export const RULES_MODEL = 'rules';
export const RULES_VERSION = 'rules-v1';

type Card = RewriteResponse['cards'][number];

/** How much each extraction pattern tends to be a clean definition to begin with. */
const BASE_CONFIDENCE: Record<string, number> = {
  glossary_row: 0.9,
  bold_term: 0.9,
  is_defined_as: 0.9,
  colon_def: 0.85,
  named_list_item: 0.85,
  heading_body: 0.8,
  parenthetical_def: 0.75,
};

// ---------------------------------------------------------------- sentences

const ABBREV = /\b(e\.g|i\.e|etc|vs|cf|approx|Dr|Mr|Mrs|Ms|Prof|St|Jr|Sr|No|Fig|al)\./gi;
const DOT = '~#~'; // stands in for abbreviation dots while splitting

export function sentences(s: string): string[] {
  const guarded = s.replace(ABBREV, (m) => m.replace(/\./g, DOT));
  const parts = guarded.split(/([.!?]+["')\]”]?)\s+(?=[A-Z0-9("'“])/);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const t = (parts[i] + (parts[i + 1] ?? '')).replace(new RegExp(DOT, 'g'), '.').trim();
    if (t) out.push(t);
  }
  return out;
}

// ---------------------------------------------------------------- clean-up steps

/** Connectors left between a term and its explanation: ": is", "— refers to", "(i.e. …". */
const LEAD_IN =
  /^(?:[:=,\-–—]+\s*)?(?:(?:is|are|was|were)\s+(?:defined as|known as|called|referred to as|described as)|can be defined as|refers? to|means?|denotes?|is|are|i\.e\.,?|meaning|defined as|which (?:is|are|means))\s+/i;

const LINK_VERB = '(?:is|are|was|were|refers? to|means|can be defined as|(?:is|are) defined as|(?:is|are) known as)';
const SUBJECT_VERB = new RegExp(`^(.{1,80}?)\\s+${LINK_VERB}\\s+(.+)$`, 'i');

const META_PREFIXES = [
  /^according to [^,]{1,60},\s*/i,
  /^(?:in|from) (?:the|this|today's) (?:lecture|class|reading|text|chapter|notes|slides)[^,]{0,30},\s*/i,
  /^as (?:mentioned|discussed|noted|stated) (?:in|by|above|earlier)[^,]{0,40},\s*/i,
  /^(?:the )?(?:professor|instructor|teacher|lecturer|author|text|textbook|book|lecture|slides?|reading)\s+(?:says|said|explains|explained|states|stated|notes|noted|mentions|mentioned|describes|described|defines|defined)\s+(?:that\s+|it\s+as\s+|them\s+as\s+)?/i,
];
const META_SUFFIX = /,?\s*(?:according to|as (?:mentioned|discussed|noted|stated) (?:in|by))\s+[^.,;]{1,60}(?=[.;!?]?$)/i;

const ASIDE = /\s*\((?:e\.g\.|i\.e\.|see|ex\.?|for example|cf\.|p\.|pg\.|ch\.|slide|lecture)[^()]*\)/gi;

const DANGLING = new Set(['it', 'its', 'they', 'them', 'their', 'he', 'she', 'him', 'his', 'her']);

function sameThing(a: string, b: string): boolean {
  return stemmedTokens(a).join(' ') === stemmedTokens(b).join(' ');
}

/** "Operant conditioning is a type of…" / "It is a type of…" / "This process refers to…" → "a type of…" */
function dropSubject(sentence: string, term: string): string {
  const m = sentence.match(SUBJECT_VERB);
  if (!m) return sentence;
  const subject = m[1].replace(/^(?:the|a|an)\s+/i, '').trim();
  const sw = words(subject).map((w) => w.toLowerCase());
  const pronounSubject = sw.length > 0 && sw.length <= 3 && PRONOUNS.has(sw[0]);
  const termSubject = sameThing(subject, term) || (containsStemmed(subject, term) && sw.length <= wordCount(term) + 1);
  return pronounSubject || termSubject ? m[2] : sentence;
}

function stripMeta(s: string): string {
  let t = s;
  for (const re of META_PREFIXES) t = t.replace(re, '');
  return t.replace(META_SUFFIX, '');
}

/** The first independent clause of "A; B" / "A, and B" when B is its own sentence. */
function firstClause(s: string): string {
  if (!isCompound(s)) return s;
  return s.split(/;\s+|,\s+(?:and|but|or|so|yet)\s+/i)[0];
}

/** Clause breaks. "Strong" ones end a thought (which…, because…, ; —); commas may sit inside a list. */
const STRONG_BOUNDARY =
  /\s*(?:;|\s[-–—]\s)\s*|,?\s+(?=(?:which|where|whereas|while|because|such as|including|for example|e\.g\.|especially|although|though|unless|so that)\b)/gi;
const ANY_BOUNDARY = /\s*(?:[,;:]|\s[-–—]\s)\s*/g;

/** Longest prefix ending at a clause boundary that fits `max` words, keeps ≥ `min`, and doesn't end on "of"/"in"/"the". */
function prefixAtBoundary(s: string, max: number, min = 4, before = s.length): string | null {
  for (const re of [STRONG_BOUNDARY, ANY_BOUNDARY]) {
    let best: string | null = null;
    for (const m of s.matchAll(re)) {
      if (m.index! > before) break;
      const prefix = s.slice(0, m.index).trim();
      const w = words(prefix);
      const last = w[w.length - 1]?.toLowerCase() ?? '';
      if (w.length >= min && w.length <= max && !STOPWORDS.has(last)) best = prefix;
    }
    if (best) return best;
  }
  return null;
}

/** Bring a definition under the word limit without cutting mid-phrase. */
function shorten(s: string): { text: string; cut: boolean } {
  const max = LIMITS.maxDefinitionWords;
  if (wordCount(s) <= max) return { text: s, cut: false };
  const noParens = s.replace(/\s*\([^()]*\)/g, '');
  if (wordCount(noParens) <= max) return { text: noParens, cut: true };
  const prefix = prefixAtBoundary(noParens, max);
  return { text: prefix ?? noParens, cut: true };
}

/**
 * A card has to stand alone. Possessive "its/their" becomes "the" ("weakened by its consequences" →
 * "by the consequences"); for anything else, cut the definition before the first "it/they/he…" if we can.
 */
function dropDanglingPronouns(s: string): { text: string; cut: boolean } {
  let text = s.replace(/\b(?:its|their)\b/gi, (m) => (m[0] === m[0].toUpperCase() ? 'The' : 'the'));
  let cut = text !== s;
  for (const m of text.matchAll(/[A-Za-z][A-Za-z'’]*/g)) {
    if (!DANGLING.has(m[0].toLowerCase())) continue;
    const prefix = prefixAtBoundary(text, LIMITS.maxDefinitionWords, 3, m.index);
    if (prefix) {
      text = prefix;
      cut = true;
    }
    break;
  }
  return { text, cut };
}

function asSentence(s: string): string {
  const t = s.trim().replace(/[\s,;:\-–—]+$/, '');
  if (!t) return '';
  return capitalize(/[.!?]$/.test(t) ? t : t + '.');
}

function cleanTerm(raw: string): string {
  return capitalize(
    stripMarkdown(raw)
      .replace(/^(?:the|a|an)\s+/i, '')
      .replace(/[.:;,!?]+$/, '')
      .trim(),
  );
}

// ---------------------------------------------------------------- fact cards (cloze)

const FACT_VERBS = new Set([
  'studied', 'developed', 'discovered', 'invented', 'proposed', 'founded', 'wrote', 'created', 'showed', 'argued',
  'led', 'introduced', 'coined', 'won', 'signed', 'ended', 'began', 'started', 'established', 'built', 'designed',
  'described', 'demonstrated', 'identified', 'published', 'ruled', 'defeated', 'fought', 'formulated', 'pioneered',
  'believed', 'claimed', 'theorized', 'observed', 'conducted', 'named', 'caused', 'became',
]);

/** "B. F. Skinner", "Pavlov", "Treaty of Versailles" — capitalised words, stopwords allowed in between. */
function looksLikeName(term: string): boolean {
  const w = words(term);
  if (w.length === 0 || w.length > 5) return false;
  return /^[A-Z]/.test(w[0]) && w.every((x) => /^[A-Z]/.test(x) || STOPWORDS.has(x.toLowerCase()));
}

/** "Pavlov – studied classical conditioning in dogs" is a fact about Pavlov, not a definition. */
function factCard(c: Candidate, term: string, body: string, confidence: number): Card | null {
  const verb = words(body)[0]?.toLowerCase();
  if (!verb || !FACT_VERBS.has(verb) || !looksLikeName(term)) return null;
  const clause = shorten(firstClause(stripMeta(sentences(body)[0] ?? body))).text.replace(/[\s.,;:]+$/, '');
  const rest = clause.charAt(0).toLowerCase() + clause.slice(1);
  const topicWords = words(rest).slice(1, 5); // skip the verb: "studied classical conditioning using…"
  while (topicWords.length && STOPWORDS.has(topicWords[0].toLowerCase())) topicWords.shift();
  while (topicWords.length && STOPWORDS.has(topicWords[topicWords.length - 1].toLowerCase())) topicWords.pop();
  const topic = topicWords.join(' ');
  return {
    candidate_id: c.id,
    term: capitalize(topic || term),
    definition: `${term} ${rest}.`,
    card_type: 'cloze',
    cloze_text: `{{c1::${term}}} ${rest}.`,
    confidence,
  };
}

/** Last resort for a definition that repeats its own term: blank the term out instead. */
function circularCloze(c: Candidate, term: string, definition: string, confidence: number): Card | null {
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const verb = /s$/i.test(term) && !/ss$/i.test(term) ? 'are' : 'is';
  const body = definition.charAt(0).toLowerCase() + definition.slice(1);
  const sentence = `${term} ${verb} ${body}`;
  const occurrences = sentence.match(new RegExp(`\\b${esc}\\b`, 'gi'))?.length ?? 0;
  if (occurrences > 2) return null;
  return {
    candidate_id: c.id,
    term,
    definition: sentence,
    card_type: 'cloze',
    cloze_text: sentence.replace(new RegExp(`\\b${esc}\\b`, 'gi'), (m) => `{{c1::${m}}}`),
    confidence: confidence - 0.1,
  };
}

// ---------------------------------------------------------------- main

export function rewriteCandidate(c: Candidate): Card | null {
  if (!c.term_hint || !c.body_hint) return null;
  const term = cleanTerm(c.term_hint);
  if (wordCount(term) === 0) return null;
  let confidence = BASE_CONFIDENCE[c.pattern_type] ?? 0.75;

  const fact = factCard(c, term, c.body_hint, confidence);
  if (fact) return fact;

  // First sentence of the explanation, minus connectors, "the professor says", "It is", asides.
  let def = sentences(stripMarkdown(c.body_hint))[0] ?? '';
  def = stripMeta(def);
  def = def.replace(LEAD_IN, '');
  def = dropSubject(def, term);
  def = def.replace(LEAD_IN, '');
  def = def.replace(ASIDE, '');

  const clause = firstClause(def);
  if (clause !== def) confidence -= 0.05;
  def = clause;

  const short = shorten(def);
  if (short.cut) confidence -= 0.1;
  def = short.text;

  const pron = dropDanglingPronouns(def);
  if (pron.cut) confidence -= 0.1;
  def = pron.text;

  def = asSentence(def);
  if (!def) return null;
  if (wordCount(def) < 3) confidence -= 0.2; // bare synonyms make weak cards

  if (containsStemmed(def, term)) {
    const cz = circularCloze(c, term, def.replace(/\.$/, ''), confidence);
    if (cz) return cz;
  }

  return { candidate_id: c.id, term, definition: def, card_type: 'term_def', cloze_text: null, confidence };
}

/** Stage 2 for a whole note. Same shape the old model call returned, so Stages 3–4 are unchanged. */
export function rewriteLocally(candidates: Candidate[]): RewriteResponse {
  const cards: Card[] = [];
  for (const c of candidates) {
    const card = rewriteCandidate(c);
    if (card) cards.push({ ...card, confidence: Math.max(0, Math.min(1, Number(card.confidence.toFixed(2)))) });
  }
  return { cards, model: RULES_MODEL, prompt_version: RULES_VERSION, raw_output: { cards } };
}
