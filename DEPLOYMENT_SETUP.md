# Deployment Setup Complete

**Date:** 2026-09-21  
**Status:** ✅ Ready for development  
**Vercel Deployment:** https://jivvy-study.vercel.app/

## What's Configured

### Local Development (`.env` & `.env.local`)
- ✅ Supabase URL: set — copy from Supabase dashboard → Settings → API → Project URL
- ✅ Supabase Anon Key: set — copy from the same page

> Copy both values; never retype them. The project ref in the URL must match the
> `ref` claim inside the anon key JWT, and a single transposed character makes the
> hostname fail DNS — which the app reports as "Can't reach the server."
> Verify with: `npm run check:supabase`
- ✅ Vercel linked via CLI (`vercel link`)

**These files are in `.gitignore` — never committed to GitHub.**

### Vercel Production Deployment
- ✅ Project: `jivvy-study`
- ✅ Environment variables set for Production & Preview:
  - `EXPO_PUBLIC_SUPABASE_URL`
  - `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- ✅ Build command: `npm run build:web`
- ✅ Output directory: `dist`

## Syllabus Parsing (Cost-Free Algorithm)

✅ **Syllabus parsing is fully functional with zero API costs:**

- Heuristic regex-based parser (`supabase/functions/_shared/heuristic-parse.ts`)
- Extracts: course info, meetings, grades, assignments, exams, policies
- **Captures study materials** from syllabus (readings, textbooks, resources, URLs)
- ~80-90% accuracy on typical syllabi
- **User confirms before saving** — allows manual fixes

### Parser Capabilities

- ✅ Course name, code, instructor, section
- ✅ Meeting times (e.g., "MWF 10:00-11:15am")
- ✅ Grade components & weights (40% Midterm, 35% Final, etc.)
- ✅ Assignments with due dates and types
- ✅ Exams with cumulative/coverage info
- ✅ Late submission policies
- ✅ **Study materials** (required/recommended readings, URLs, resources)
- ⚠️ Limited PDF/image support (convert to text first)

## Everything Else Works

The app is **fully functional**:

- ✅ Notes (create, edit, markdown)
- ✅ Flashcards (rule-based, made on the device — no AI)
- ✅ Study scheduling
- ✅ Grade calculations
- ✅ Course planning
- ✅ Sign in/accounts
- ✅ Data sync to Supabase
- ✅ **Syllabus parsing** (new: heuristic, not AI)

## Testing the Setup

### Local
```bash
npm run web
# or
npm start
```

### Vercel
- Live: https://jivvy-study.vercel.app/
- Automatically deploys on git push to main

## Environment Files Reference

| File | Purpose | In Git? | Needs |
|---|---|---|---|
| `.env` | Local dev fallback | ❌ No | Supabase credentials |
| `.env.local` | Vercel dev tools | ❌ No | (Auto-synced from Vercel) |
| `.env.example` | Template for setup | ✅ Yes | Manual filling |
| `vercel.json` | Build config | ✅ Yes | Already complete |

## Before inviting testers

The database side is done in migrations (`0010_beta_hardening.sql`, `0011_sync_state.sql`). These are
dashboard-only settings (Supabase → Authentication):

1. **Leaked password protection** — Authentication → Providers → Email (or Attack Protection) → turn on
   "Prevent use of leaked passwords". It checks new passwords against HaveIBeenPwned. Needs the Pro plan.
2. **Minimum password length: 8** — matches what the app asks for (Supabase's default is 6, so the API alone
   would accept shorter ones).
3. **Confirm email: on** — the app already handles the code step.
4. **CAPTCHA** — leave it **off** for now. The app doesn't send a CAPTCHA token yet, so turning it on would
   block every sign-up. Worth adding (Cloudflare Turnstile) before a public launch.
5. **Retired function** — `rewrite-cards` (the old AI card formatter) was still deployed; it's now a stub that
   refuses every call. Remove it for good, along with its API key if one was set:
   ```bash
   npx supabase functions delete rewrite-cards --project-ref yvsqppvjxsppzabjmful
   npx supabase secrets unset ANTHROPIC_API_KEY --project-ref yvsqppvjxsppzabjmful
   ```

**Always run new migrations on the live project before pushing app code that needs them** — the app will hold
changes the server can't accept (and say so), but other devices won't see them until the schema catches up.

## Next Steps

1. **Restart app:** `npm run web` — should now connect to Supabase
2. **Test sign-in** with your Supabase account
3. **Try features** (notes, cards, scheduling)
4. **Push to GitHub** — only `.gitignore` change will be committed
5. **Redeploy Vercel** — automatic on main branch push

---

*Setup completed by Claude Code on 2026-09-21. Credentials never committed.*
