// The parse contract lives in the shared edge-function folder so the server and
// the app can never disagree about its shape.
export {
  ASSIGNMENT_TYPES,
  SYLLABUS_PARSE_VERSION,
  coerceParsed,
  type ParsedSyllabus,
} from '../../../supabase/functions/_shared/syllabus-schema';
