// Text extraction for uploaded syllabi.
//   PDF  → unpdf (pdf.js build for serverless)      DOCX → mammoth      TXT/MD → decode
//   Image, or a PDF with no text layer → no text; the caller asks the student to paste the text instead.
//
// Note: there is no OCR engine in the edge runtime. A hosted OCR step could slot in here.
import { extractText, getDocumentProxy } from 'npm:unpdf';
import mammoth from 'npm:mammoth';
import { Buffer } from 'node:buffer';

export type Extracted =
  | { kind: 'text'; text: string }
  | { kind: 'image'; mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' }
  | { kind: 'pdf_no_text' };

const MIN_TEXT_CHARS = 200; // below this a PDF is treated as scanned

export async function extract(bytes: Uint8Array, mime: string, fileName = ''): Promise<Extracted> {
  const name = fileName.toLowerCase();
  const m = mime.toLowerCase();

  if (m.startsWith('image/') || /\.(png|jpe?g|gif|webp|heic)$/.test(name)) {
    const mediaType = m === 'image/png' || name.endsWith('.png') ? 'image/png'
      : m === 'image/webp' || name.endsWith('.webp') ? 'image/webp'
      : m === 'image/gif' || name.endsWith('.gif') ? 'image/gif'
      : 'image/jpeg';
    return { kind: 'image', mediaType };
  }

  if (m === 'application/pdf' || name.endsWith('.pdf')) {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: true });
    const t = (Array.isArray(text) ? text.join('\n') : text).trim();
    return t.length >= MIN_TEXT_CHARS ? { kind: 'text', text: t } : { kind: 'pdf_no_text' };
  }

  if (m.includes('wordprocessingml') || name.endsWith('.docx')) {
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return { kind: 'text', text: value.trim() };
  }

  return { kind: 'text', text: new TextDecoder().decode(bytes).trim() };
}
