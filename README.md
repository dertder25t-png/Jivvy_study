# Study App

> Working title. The app does the work; it is not a container the student fills.
> Upload your syllabi once and your semester already exists — deadlines, grade weights, late
> policies, topic schedule, exam coverage. Notes file themselves, flashcards come from those notes,
> and review is scheduled backward from the exam date.

Built from `study-app-build-spec.md` (v1). React Native + Expo (SDK 57) · Supabase · no AI: every step is deterministic code.

> **New here? Read [SETUP.md](SETUP.md)** — plain-language steps to run the app, turn on accounts, and put it on your phone.

## Try it in 60 seconds (no backend needed)

```bash
npm install
npm run web        # or: npm start, then scan the QR with Expo Go
```

With no Supabase config the app runs in **demo mode**: everything is stored on the device. Tap
**Load a sample semester** for two courses (always "week 4", with a crunch week coming up), then try:
capture a note with **+**, open a note → **Make flashcards**, the **Crunch forecast** (More tab), the
**Catch up** view, and a course's **What do I need?** grade calculator.

> Demo mode can't read *your* syllabus files — that needs the backend below. Everything else works.

## Run it for real (Supabase)

1. Create a Supabase project. Run **every** file in [`supabase/migrations/`](supabase/migrations) in order
   (SQL editor, or `supabase db push`). `0001_init.sql` creates every table from spec §4, RLS on all of them, and
   the private `syllabi` storage bucket; the later ones add columns the app writes. **Run new migrations before
   deploying the app that needs them** — if the server is missing a column, saves are held on the device (and
   the app says so) until it's there.
2. In Supabase → Authentication → Providers, enable **Email** (the app uses one-time codes, no passwords).
   Make sure the email template includes the `{{ .Token }}` code.
3. Deploy the edge functions (no API keys needed):
   ```bash
   supabase functions deploy parse-syllabus
   supabase functions deploy delete-account
   ```
4. `cp .env.example .env` and fill `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`
   (the **anon** key only — the service-role key never goes in the app).


## How the spec maps to the code

| Spec | Where |
|---|---|
| §1 the unbroken chain | `src/data/actions.ts` (`commitSyllabus` → topics/coverage; `createNote` → auto-filed; `reviewCard` → scheduled toward the exam) |
| §4 data model | `supabase/migrations/0001_init.sql`, mirrored by `src/types/db.ts` |
| §5.1 syllabus parsing | `supabase/functions/parse-syllabus`, `_shared/extract.ts` (pdf/docx text), `_shared/syllabus-schema.ts` (the contract), `src/core/syllabus/normalize.ts` (dates, coverage, issues), `app/syllabus/review.tsx` (confirm before saving) |
| §5.2 work the app does | `src/core/estimation.ts` (personal correction factor, start-by dates), `studyPlan.ts`, `grades.ts` (what-do-I-need), `policies.ts` (late windows, buffers), `collisions.ts`, `email.ts`, `triage.ts` |
| §5.3 notes | `src/core/notes.ts` (explicit course → class schedule → keywords/instructor name). The note page `app/note/[id].tsx` is an open, borderless writing surface (plain text + markdown, autosave) with a rendered **reading view** (`src/core/markdown.ts`, `src/ui/Markdown.tsx`: headings, lists, callouts, highlights, tables) and a **flashcard panel on the left** (`src/ui/NoteCardsPanel.tsx`) that docks on wide screens and slides over on phones |
| §5.4 quick capture | `app/capture.tsx` + the **+** button on every tab |
| §5.5 comeback | `src/core/triage.ts`, `app/comeback.tsx` (shown automatically after ≥4 days away) |
| §5.6 notifications | `src/core/notifications.ts` (≤3/day cap, ranked by grade impact, allowed types only), `src/notifications/schedule.ts` |
| §6 flashcard pipeline | Stage 1 `src/core/flashcards/extract.ts` · Stage 2 `rewrite.ts` (rule-based, on the device) · Stage 3 `reject.ts` · Stage 4 `app/cards/generate.tsx` · glue `pipeline.ts` |
| §6.7 exam-aware scheduling | `src/core/scheduling.ts` (`nextReview` compresses to land before the exam) |
| §9 metrics | `metric_events` table (parse edits, cache hits, comeback shown, auto-rejections) + `generation_events` |

Design rules are enforced in code, not just copy: relative time everywhere (`src/core/time.ts`), no
streaks (none exist), a hard 3-per-day notification cap (tested), no red for overdue work.

## Writing notes

Notes open like a page, not a form: big title, one wide column, no boxes. Existing notes open in **reading
view** (rendered markdown); tap the page, the pencil in the top bar, or press **Ctrl/⌘+E** to edit. Writing
view shows the raw markdown — it isn't a live-preview editor (that would need a rich-text engine, which the
spec rules out), so rendering happens in reading view.

The **flashcard button** at the top-left slides the card panel in and out. It shows how many definitions your
note contains as you type, makes cards on demand, lets you keep/edit/skip them in place, and add your own.
Your choice (open/closed) is remembered; it defaults to open on wide screens and closed on phones.

## Grades: your college's system is the official record

Many colleges keep official grade totals in their own system, not Canvas, and this app can't read it (and a
Canvas connection wouldn't have helped). So the app is honest about what its number is:

- **Estimated grade** is worked out from the grades *you've entered*, and says so.
- **Official grade** — copy in what your college's portal shows (a percent, a letter, or both) from a course's
  *Grading setup* screen. It then leads the course page and the Courses list, with our estimate underneath and a
  plain-language note if they disagree ("your college's number is 7.6 points lower…").
- When you've given a percent, **"What do I need?" lines its math up with your college's number** instead of ours.
- **Grading scale per course** (plain A–F, plus/minus, or your own cutoffs) drives letters and targets.
- **Grade weights are editable** (name, weight, drop-lowest, add/remove) for when the college counts things
  differently than the syllabus.

Logic: `src/core/grades.ts` (`courseScale`, `reconcile`, `calibrationOffset`); UI: `app/grading/[id].tsx`;
schema: `supabase/migrations/0002_grading.sql` (run it after 0001).

## Studying whenever you want

Cards are never locked behind the review schedule. **Study → Start** always gives you a session (what's due first,
topped up with your weakest cards), and **Choose what to study** lets you pick scope (everything, a course, one
week, an exam's topics, a single note), length (5/10/15/30 min or all), order (smart / weakest first / shuffle),
and whether it **counts toward your schedule** or is **practice only** (nothing saved).

Optional guidance, never a limit: how long due cards take at *your* pace, and for an upcoming exam roughly how
many minutes of card review are worth spending overall and per day. **Studying early is safe:** an early "good"
or "easy" leaves a card's next review exactly where it was, so cramming never pushes reviews out.
Logic: `src/core/session.ts`, `src/core/scheduling.ts` (`isEarly`); UI: `app/cards/setup.tsx`, `app/cards/review.tsx`.

**Learn mode remembers your place — and what you've learned stays learned.** It asks for pocket size and what to
type once per set, then always resumes where you left off, on any device. Each pocket starts with the cards you've
already learned that are **due for review** (spaced out and squeezed to land before the test date, so a card from
day 1 is still solid on day 9), then new ones. **Struggling** sends a card to the back of the pocket until you get
it, and brings it back sooner on the following days. Not sure about some cards? **Flashcards** (from the pocket
summary, or the link while learning) lets you pick today's shaky ones and flip through them until each is a
"Got it" — misses come back in Learn later that day. **Start this set over** is under **Options**.
**With a test date, the study plan runs Learn.** For a set with an upcoming test (or a syllabus exam you have cards
for) Learn skips setup and serves exactly today's share from the plan — the reviews that are due (wherever you
studied them) and the number of new cards the plan set for today — then says you're done for the day, with an
option to learn ahead. Sets without a test date ask once how you'd like to study.

Learn can go through a set **shuffled** (the same order on all your devices; a new one each time you redo it), and a
finished set can be **redone** from the start (review history is kept).
Logic: `src/core/learning.ts` (+ `scheduling.ts`); progress is the synced `learn_progress` table.

**Card check** (on the device, no AI) suggests fixes that make a set easier to learn: split long lists into groups
of about three and long answers into one idea per card (labelled "(1–3 of 9)"; the first part keeps its study
history), delete duplicate copies (the oldest is kept), blank out an answer that gives itself away, swap a card
whose question is on the answer side, and flag very long or often-missed cards to reword. Every suggestion shows
exactly what it will do; nothing changes until you apply it. Find it on the Study tab, under each set in Your cards,
and in Learn's setup. Logic: `src/core/flashcards/cardCheck.ts`.

**A plan for every test.** Give a set a test date (or have a syllabus exam with cards) and each day gets its share:
learn some new cards, review what's due, and go through everything the day before. It shows as **Today's study
plan** on Home and Study, fills in the **study calendar**, and sends one reminder a day at your **study time**
(Settings). Logic: `src/core/testPrep.ts`.

## Syncing across devices

Every change is saved on the device first and sent to your account right away; if a send fails it waits in an
outbox and is still shown (never hidden) until the server has it. The app picks up other devices' changes when it
opens or comes back to the front, every 30 s while on screen, and when the connection returns. Each check is one
tiny request for the account's change counter (`sync_state`, bumped by triggers on every write — migration 0011);
everything is downloaded again only when *another* device changed something. Study settings (daily minutes, study
time, Learn defaults) follow the account too. If the server keeps refusing a change, a banner says so and
**Settings → Data** shows why; after a day it's dropped so the rest can sync.
Logic: `src/data/store.ts`, `src/data/sync.ts`, `src/data/prefsSync.ts`.

## Security model

Every table has row-level security: a signed-in student reads and writes only their own rows, and a signed-out
client (the public anon key) can't touch any table. On their own `users` row a student can change only their time
zone (not `plan`, `email` or `school_id`). The shared parse cache is server-only, uploads are limited to documents
and photos up to 12 MB in the student's own folder, and no privileged database function is reachable over the
API. See `supabase/migrations/0010_beta_hardening.sql`, and the dashboard-only settings in
[DEPLOYMENT_SETUP.md](DEPLOYMENT_SETUP.md#before-inviting-testers).

## Accounts

- **Sign in / create account** with email + password, or an emailed one-time code (also how you recover a forgotten
  password: sign in with the code, then set a new one under More → Account). **Use without an account** keeps
  everything on the device.
- **More → Account**: profile (name, time zone), change password, **download all your data** (JSON), sign out, and
  **delete the account and everything in it** (server function `delete-account`; the database cascades from the
  auth user, uploaded syllabi are removed first).
- **Bring your data over:** if you used the app on a device before signing up, you're offered a one-tap import that
  keeps everything consistent and is safe to repeat (`src/core/exportData.ts` `prepareImport`).
- Logic: `src/core/auth.ts` (validation, friendly errors), `src/data/account.ts`, `src/data/boot.ts`,
  `src/ui/AuthScreen.tsx`, `app/account.tsx`.

## Architecture in one paragraph

`src/core/**` is pure TypeScript with no React or network — every rule above lives there and is unit
tested. `src/data/store.ts` holds the user's whole semester in memory behind a swappable backend
(on-device for demo/offline, Supabase for accounts) with an outbox so offline writes survive.
Screens (`app/**`, expo-router) read derived state from `useSemester()` and call `src/data/actions.ts`.
The server side is two small Deno edge functions; Stage 1 and Stage 3 of the flashcard pipeline run in
the app so only Stage 2 (formatting) ever costs money.

## Tests

```bash
npm test           # tests over src/core (vitest)
npm run typecheck
```

Covered: study-session building, time guidance and early-review scheduling, grading scales and official-grade reconciliation, the markdown reader, relative-time/timezone/DST math, grade math and drop-lowest, late windows, crunch forecast,
comeback triage, SM-2 with exam compression, study plan, notification budget, note routing,
syllabus normalization (year fixing, week→date, coverage inference), the whole flashcard pipeline
(extract patterns, the rule-based rewrite, every rejection rule, contrast-pair regression).

**Not covered by tests:** the Deno edge functions (they need a Supabase project) and the React
screens beyond a manual smoke test. See "Verified vs. not" below.

## Verified vs. not

Verified here: unit tests, `tsc --strict`, production Hermes bundles for **iOS and Android**
(`expo export`), and the demo flow driven in a browser (load semester → home, crunch, comeback, course
grades, note → 9 candidates → cards → approve → review session).

**Not verified — needs you:** anything touching a live Supabase project (syllabus parse,
auth, sync, cache), push notifications on a real device, the photo/camera/document
pickers on a device, and swipe gestures on touch (buttons work everywhere; swipe was only coded), and the note screen's on-device keyboard behaviour (verified in a browser at desktop and phone widths).

## Deliberately not built (spec §2 and where v1 stops)

Canvas, BYOK, business mode, collaboration, a block editor, templates, AI chat/summaries — per the spec.

Also not in this first pass, and worth knowing:

- **Home-screen widget, share sheet, and voice capture (§5.4).** These need native modules and a
  development build (`expo-dev-client`), not Expo Go. In-app capture is instant and your keyboard's mic
  button gives voice-to-text for free; the router is ready for `captured_via: 'widget' | 'share' | 'voice'`.
- **Scanned PDFs and photos (§5.1).** There's no OCR engine in the edge runtime, so files without a text
  layer can't be read; the student is asked to paste the text. A hosted OCR step can slot into `_shared/extract.ts`.
- **Free-tier limits / billing (§8).** `users.plan` exists; nothing enforces 1–2 courses yet.
- **Onboarding tour and offline UX polish (Phase 6).** Empty states exist; there's no guided tour.
- **App icon / splash / store setup.** Bundle ID is the placeholder `com.example.studyapp`.

## Decisions I made where the spec left a choice (§12)

1. **Name / bundle ID** — placeholder "Study App", `com.example.studyapp`. Change in `app.json`.
2. **No AI** — syllabus parsing (`_shared/heuristic-parse.ts`) and card rewriting
   (`src/core/flashcards/rewrite.ts`) are both rule-based, so there's no model cost, no API key, and no
   note text leaves the device to make flashcards. Everything is reviewed by the student before saving.
3. **Cloze** — yes. `{{c1::answer}}` syntax; validated in Stage 3 (`invalid_cloze`).
4. **Class meeting times** — extracted from the syllabus into `courses.meetings` (a column I added), used
   for schedule-based note filing.
5. **Grade entry** — manual: points earned / possible on the assignment screen, and grade math recomputes
   on every render.

Schema additions beyond §4: `users.plan`, `courses.meetings`, `metric_events`, and `content_cache` is
keyed on (hash, kind, parse_version, school) so a version bump or another school never collides.

## Privacy

Flashcards are made entirely on the device, so note text is never sent to a server to make them. The
shared cache holds parsed syllabus structure only (spec §10).

## Project layout

```
app/                 expo-router screens (tabs: Coming · Courses · Notes · Study · More)
src/core/            pure logic + tests — the rules
src/data/            store, backends (local / supabase), actions, derived state
src/api/             edge-function client (syllabus parsing)
src/ui/              theme + small component kit
supabase/migrations  schema + RLS
supabase/functions   parse-syllabus, delete-account, _shared (heuristic parser, schema, extract, cache)
```
