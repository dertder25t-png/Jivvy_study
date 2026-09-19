// Small text utilities shared by extraction and rejection. No dependencies.

export const STOPWORDS = new Set(
  (
    'a an the and or but if then else of to in on at by for with without from into onto over under about as is are was were be been being ' +
    'do does did have has had it its it\'s this that these those there here they them their he she his her him we us our you your i me my ' +
    'what which who whom whose when where why how not no yes so than too very can could will would shall should may might must also just'
  ).split(/\s+/),
);

export const PRONOUNS = new Set([
  'it', 'its', 'they', 'them', 'their', 'theirs', 'he', 'she', 'him', 'his', 'her', 'hers',
  'we', 'us', 'our', 'ours', 'you', 'your', 'yours', 'i', 'me', 'my', 'this', 'that', 'these', 'those', 'which',
]);

export function words(s: string): string[] {
  return s.match(/[A-Za-z0-9][A-Za-z0-9'’\-]*/g) ?? [];
}

export function wordCount(s: string): number {
  return words(s).length;
}

/** Light suffix stemmer — enough for "conditioning"/"conditioned"/"conditions". */
export function stem(word: string): string {
  let w = word.toLowerCase().replace(/['’]s$/, '');
  if (w.length <= 3) return w;
  const undouble = (x: string) => (/([b-df-hj-np-tv-z])\1$/.test(x) ? x.slice(0, -1) : x);
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
  if (w.endsWith('sses')) return w.slice(0, -2);
  if (w.endsWith('ing') && w.length > 5) return undouble(w.slice(0, -3));
  if (w.endsWith('ed') && w.length > 4) return undouble(w.slice(0, -2));
  if (w.endsWith('es') && w.length > 4 && /(s|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) return w.slice(0, -1);
  return w;
}

export function stemmedTokens(s: string): string[] {
  return words(s).map(stem);
}

/** Is `needle` (as a contiguous stemmed token sequence) present in `haystack`? */
export function containsStemmed(haystack: string, needle: string): boolean {
  const h = stemmedTokens(haystack);
  const n = stemmedTokens(needle);
  if (n.length === 0) return false;
  outer: for (let i = 0; i + n.length <= h.length; i++) {
    for (let j = 0; j < n.length; j++) if (h[i + j] !== n[j]) continue outer;
    return true;
  }
  return false;
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

export function normalize(s: string): string {
  return words(s).map((w) => w.toLowerCase()).join(' ');
}

/** 1 = identical, 0 = nothing in common (normalized Levenshtein on normalized text). */
export function similarity(a: string, b: string): number {
  const x = normalize(a);
  const y = normalize(b);
  const max = Math.max(x.length, y.length);
  if (max === 0) return 1;
  return 1 - levenshtein(x, y) / max;
}

/** Remove markdown decoration so hints read as plain text. */
export function stripMarkdown(s: string): string {
  return s
    .replace(/^\s*#{1,6}\s+/, '')
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^*\w])([*_])([^*_\n]+?)\2(?![*\w])/g, '$1$3')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
