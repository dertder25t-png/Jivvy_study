# Deployment Setup Complete

**Date:** 2026-09-21  
**Status:** ✅ Ready for development  
**Vercel Deployment:** https://jivvy-study.vercel.app/

## What's Configured

### Local Development (`.env` & `.env.local`)
- ✅ Supabase URL: `https://yvsqppvjxspppzabjmful.supabase.co`
- ✅ Supabase Anon Key: Set
- ✅ Vercel linked via CLI (`vercel link`)

**These files are in `.gitignore` — never committed to GitHub.**

### Vercel Production Deployment
- ✅ Project: `jivvy-study`
- ✅ Environment variables set for Production & Preview:
  - `EXPO_PUBLIC_SUPABASE_URL`
  - `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- ✅ Build command: `npm run build:web`
- ✅ Output directory: `dist`

## What Works Without API Key

The app is **fully functional** without the Anthropic API key:

- ✅ Notes (create, edit, markdown)
- ✅ Flashcards (local heuristic extraction)
- ✅ Study scheduling
- ✅ Grade calculations
- ✅ Course planning
- ✅ Sign in/accounts
- ✅ Data sync to Supabase

## What's Disabled Without API Key

- ❌ **Syllabus parsing from files** (parse-syllabus edge function needs `ANTHROPIC_API_KEY`)
- ❌ **Smart card rewriting with Claude** (falls back to local heuristic)

*User can still paste syllabus text manually as a workaround.*

## To Enable Syllabus Parsing Later

When ready to add the AI feature, set the Anthropic API key in Supabase:

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```

This is a one-time setup in Supabase (not committed to any repository).

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

## Next Steps

1. **Restart app:** `npm run web` — should now connect to Supabase
2. **Test sign-in** with your Supabase account
3. **Try features** (notes, cards, scheduling)
4. **Push to GitHub** — only `.gitignore` change will be committed
5. **Redeploy Vercel** — automatic on main branch push

---

*Setup completed by Claude Code on 2026-09-21. Credentials never committed.*
