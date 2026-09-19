// Sign-in helpers: validation and plain-language errors. Pure, no network.

export const MIN_PASSWORD = 8;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidEmail(raw: string): boolean {
  return EMAIL.test(normalizeEmail(raw));
}

/** What's wrong with a password, in words a person can act on. Empty array = fine. */
export function passwordProblems(pw: string): string[] {
  const out: string[] = [];
  if (pw.length < MIN_PASSWORD) out.push(`Use at least ${MIN_PASSWORD} characters.`);
  if (pw.length >= MIN_PASSWORD && /^(.)\1+$/.test(pw)) out.push('That is one character repeated — pick something less guessable.');
  if (/^(password|12345678|qwertyui|letmein1|iloveyou)/i.test(pw)) out.push('That is a very common password.');
  return out;
}

/** 0–3 for a small strength meter. Length matters most; mixing character types helps. */
export function passwordStrength(pw: string): 0 | 1 | 2 | 3 {
  if (passwordProblems(pw).length > 0) return pw.length === 0 ? 0 : 1;
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (pw.length >= 14 || (pw.length >= 10 && kinds >= 3)) return 3;
  return pw.length >= 10 || kinds >= 3 ? 2 : 1;
}

/** Turns backend / network errors into something calm and specific. */
export function friendlyAuthError(err: unknown): string {
  const raw = String((err as { message?: string })?.message ?? err ?? '');
  const m = raw.toLowerCase();
  if (m.includes('invalid login') || m.includes('invalid credentials')) return "That email and password don't match. Check them, or use a code instead.";
  if (m.includes('email not confirmed')) return 'Confirm your email first — we sent you a code.';
  if (m.includes('already registered') || m.includes('already been registered') || m.includes('already exists')) {
    return 'That email already has an account. Sign in instead.';
  }
  if (m.includes('token has expired') || m.includes('otp_expired') || m.includes('expired')) return 'That code has expired. Ask for a new one.';
  if (m.includes('invalid') && (m.includes('token') || m.includes('otp'))) return "That code isn't right. Check the latest email and try again.";
  if (m.includes('rate limit') || m.includes('too many') || m.includes('security purposes')) return 'Too many tries. Wait a minute, then try again.';
  if (m.includes('signups not allowed') || m.includes('signup is disabled')) return 'New accounts are turned off on this server.';
  if (m.includes('user not found') || m.includes('not found')) return "We couldn't find an account with that email.";
  if (m.includes('password should be') || m.includes('weak password')) return 'That password is too weak. Try a longer one.';
  if (m.includes('same password') || m.includes('different from the old')) return 'Pick a password different from your current one.';
  if (m.includes('failed to fetch') || m.includes('network') || m.includes('retryable') || m.includes('load failed') || m.includes('fetch')) {
    return "Can't reach the server. Check your connection and try again.";
  }
  return raw && raw.length < 140 ? raw : 'Something went wrong. Please try again.';
}

/** "alex.smith@school.edu" → "AS" for the avatar circle. */
export function initials(nameOrEmail: string): string {
  const base = nameOrEmail.split('@')[0].replace(/[._-]+/g, ' ').trim();
  const parts = base.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
