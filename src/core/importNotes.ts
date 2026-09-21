import { Platform } from 'react-native';

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

/** Parse CSV content */
export interface QuizletCard {
  term: string;
  definition: string;
}

export function parseCSV(content: string): QuizletCard[] {
  const lines = content.split('\n').map(line => line.trim()).filter(line => line);
  const cards: QuizletCard[] = [];

  // Skip header if present
  let startIdx = 0;
  if (lines.length > 0 && (lines[0].toLowerCase().includes('term') || lines[0].toLowerCase().includes('word'))) {
    startIdx = 1;
  }

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    // Split by comma, but handle quoted values
    const parts = line.split(',').map(s => s.trim().replace(/^"(.*)"$/, '$1'));

    if (parts.length >= 2) {
      cards.push({
        term: parts[0],
        definition: parts.slice(1).join(','), // Handle multi-part definitions
      });
    } else if (parts.length === 1 && parts[0]) {
      // Single value per line - assume term, wait for next line for definition
      // For basic MVP, skip this format
    }
  }

  return cards;
}

/** Parse JSON content (Quizlet export format) */
export function parseJSON(content: string): QuizletCard[] {
  try {
    const data = JSON.parse(content);

    // Handle Quizlet export format
    if (data.flashcards && Array.isArray(data.flashcards)) {
      return data.flashcards.map((card: any) => ({
        term: card.word || card.term || '',
        definition: card.definition || card.def || '',
      }));
    }

    // Handle array of objects with term/definition
    if (Array.isArray(data)) {
      return data.map((item: any) => ({
        term: item.term || item.word || item.q || '',
        definition: item.definition || item.def || item.a || '',
      }));
    }

    return [];
  } catch {
    return [];
  }
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
