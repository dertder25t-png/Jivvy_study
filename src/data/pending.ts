// Hand-off between "Add a syllabus" and "Look right?" — too large / non-serializable for route params.
import type { NormalizedSyllabus } from '@/core/syllabus/normalize';
import type { ParsedSyllabus } from '@/core/syllabus/types';

export interface PendingParse {
  result: {
    parsed: ParsedSyllabus | null;
    contentHash: string | null;
    cacheHit: boolean;
    rawText: string | null;
    filePath: string | null;
  };
  normalized: NormalizedSyllabus;
  termId: string;
}

let pending: PendingParse | null = null;

export const pendingParse = {
  set: (p: PendingParse | null) => {
    pending = p;
  },
  get: () => pending,
};
