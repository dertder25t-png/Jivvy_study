export interface ImportedNote {
  title: string;
  body: string;
  filename: string;
}

/** Detect file type from filename */
export function getFileType(filename: string): 'text' | 'markdown' | 'docx' | 'pdf' | 'unknown' {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'txt':
      return 'text';
    case 'md':
    case 'markdown':
      return 'markdown';
    case 'docx':
      return 'docx';
    case 'pdf':
      return 'pdf';
    default:
      return 'unknown';
  }
}

/** Parse text content (handles txt and markdown) */
export function parseTextFile(content: string, filename: string): ImportedNote {
  // Extract title from filename
  const title = filename.split('.')[0].replace(/[-_]/g, ' ').trim();

  return {
    title,
    body: content.trim(),
    filename,
  };
}

export interface QuizletCard {
  term: string;
  definition: string;
}

/** Splits a CSV/TSV row on `delim`, respecting double-quoted fields (which may contain the delimiter). */
function splitDelimited(line: string, delim: string): string[] {
  const parts: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delim && !inQuotes) {
      parts.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  parts.push(cur);
  return parts.map((s) => s.trim());
}

/** Parse CSV (or TSV, with delim: '\t') content: one card per row, `term,definition`. */
export function parseCSV(content: string, delim = ','): QuizletCard[] {
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const cards: QuizletCard[] = [];

  // Skip header if present (only when there's more than one row — a single row is always data).
  let startIdx = 0;
  if (lines.length > 1 && /^(term|word|front|question)\b/i.test(lines[0])) {
    startIdx = 1;
  }

  for (let i = startIdx; i < lines.length; i++) {
    const parts = splitDelimited(lines[i], delim).map((s) => s.replace(/^"(.*)"$/, '$1'));
    if (parts.length >= 2 && parts[0]) {
      cards.push({ term: parts[0], definition: parts.slice(1).join(delim === ',' ? ', ' : ' ') });
    }
  }

  return cards;
}

/** Parse TSV content (tab-separated) — the format Quizlet's own export/import uses. */
export function parseTSV(content: string): QuizletCard[] {
  return parseCSV(content, '\t');
}

/** Parse JSON content: Quizlet's export shape, and a handful of other common shapes. */
export function parseJSON(content: string): QuizletCard[] {
  try {
    const data = JSON.parse(content);

    const fromArray = (arr: unknown[]): QuizletCard[] =>
      arr
        .map((item): QuizletCard | null => {
          if (Array.isArray(item)) {
            // ['term', 'definition'] tuples
            return item.length >= 2 ? { term: String(item[0]), definition: String(item.slice(1).join(', ')) } : null;
          }
          if (item && typeof item === 'object') {
            const o = item as Record<string, unknown>;
            const term = o.term ?? o.word ?? o.q ?? o.question ?? o.front ?? o.text;
            const definition = o.definition ?? o.def ?? o.a ?? o.answer ?? o.back ?? o.meaning;
            if (term != null && definition != null) return { term: String(term), definition: String(definition) };
          }
          return null;
        })
        .filter((c): c is QuizletCard => c != null);

    if (Array.isArray(data)) return fromArray(data);

    // Common wrapper keys used by various export tools.
    for (const key of ['flashcards', 'cards', 'terms', 'items']) {
      if (Array.isArray(data?.[key])) return fromArray(data[key]);
    }
    if (data?.studySet && Array.isArray(data.studySet.terms)) return fromArray(data.studySet.terms);

    return [];
  } catch {
    return [];
  }
}

const PASTE_SEPARATORS = ['\t', ',', ' - ', ' — ', '::', ':', '|'];

/**
 * Parses freeform pasted text into cards: one card per row, term and definition split by a
 * delimiter. Mirrors Quizlet's own "import" box (tab between term/definition, newline between
 * cards by default), but both delimiters are configurable for other export formats.
 */
export function parseQuizletPaste(text: string, termSep = '\t', cardSep = '\n'): QuizletCard[] {
  const rows = cardSep === '\n' ? text.split(/\r?\n/) : text.split(cardSep);
  const tryOrder = [termSep, ...PASTE_SEPARATORS.filter((s) => s !== termSep)];

  const cards: QuizletCard[] = [];
  for (const raw of rows) {
    const row = raw.trim();
    if (!row) continue;

    let split: { idx: number; sep: string } | null = null;
    for (const sep of tryOrder) {
      const idx = row.indexOf(sep);
      if (idx > 0) {
        split = { idx, sep };
        break;
      }
    }
    if (!split) continue;

    const term = row.slice(0, split.idx).trim();
    const definition = row.slice(split.idx + split.sep.length).trim();
    if (term && definition) cards.push({ term, definition });
  }
  return cards;
}

/** Extract plain text from HTML (for DOCX conversion) */
export function htmlToPlainText(html: string): string {
  // Remove script and style elements
  let text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

  // Convert block elements to newlines
  text = text.replace(/<\/?(p|div|br|li|ul|ol|h[1-6])\b[^>]*>/gi, '\n');

  // Remove other HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode HTML entities
  const textarea = typeof document !== 'undefined' ? document.createElement('textarea') : null;
  if (textarea) {
    textarea.innerHTML = text;
    text = textarea.value;
  } else {
    // Fallback for non-browser environments
    text = text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  // Clean up whitespace
  text = text.replace(/\n\n+/g, '\n\n');
  text = text.split('\n').map(line => line.trim()).filter(line => line).join('\n');

  return text.trim();
}

/** Validate imported notes */
export function validateImportedNote(note: ImportedNote): boolean {
  return note.body.trim().length > 0;
}

/** Validate imported cards */
export function validateImportedCard(card: QuizletCard): boolean {
  return card.term.trim().length > 0 && card.definition.trim().length > 0;
}
