# Getting Study App running

Three levels. Start at the first; move down when you want more.

| | What you get | Accounts needed | Time |
|---|---|---|---|
| **A. Try it** | Everything except reading your own syllabus files. Data stays in your browser. | none | 2 min |
| **B. Real setup** | Sign-in, sync, backup, syllabus reading, smart flashcards | Supabase (free) + Anthropic (pay-as-you-go, cents) | ~15 min |
| **C. Use it anywhere** | Open it on your phone from anywhere, add it to your home screen | a free web host | ~5 min more |

---

## A. Try it right now (no accounts)

Double-click **`Start Study App (computer).bat`** in this folder.

- First time only: it installs what the app needs (a few minutes). It needs [Node.js](https://nodejs.org) (the "LTS" download) — if that's missing the window tells you.
- Your browser opens on the app. Keep the black window open while you use it; close it to stop.
- Tap **Use without an account** (if shown), then **Load a sample semester** to look around, or **Add a syllabus** → paste text.

Your data lives in that browser on this computer. Clearing the browser's site data erases it — use **More → Account → Download my data** for a backup.

**On your phone instead:** double-click **`Start Study App (phone).bat`**, install the free **Expo Go** app, put the phone on the same Wi-Fi as the computer, and scan the QR code. (The computer has to stay on and running.)

---

## B. Real setup: accounts, sync, syllabus reading

Do this once. You need two accounts — I can't create them for you, they have to be yours.

### 1. Create a free Supabase project
1. Go to <https://supabase.com> → sign up → **New project**.
2. Pick any name, choose a region near you, and **write down the database password** you set.
3. When it finishes, open **Project Settings → General** and copy the **Reference ID** (about 20 letters/numbers).

### 2. Get an Anthropic API key (for reading syllabi + writing smart flashcards)
1. <https://console.anthropic.com> → sign up → add a few dollars of credit → **API Keys** → create one (starts with `sk-ant-`).
2. Skip this if you like — everything else works without it; syllabus files and AI card rewrites just won't.

Cost is small: a syllabus costs cents to read, and once one classmate has uploaded the same document it's free for everyone after them.

### 3. Run the setup script
Open a terminal in this folder (in File Explorer: click the address bar, type `cmd`, Enter) and run:

```
npm run backend:setup
```

It asks for the Reference ID and your key, logs you in to Supabase (a browser tab opens — approve it), creates the database and privacy rules, deploys the server functions, and writes the `.env` file. Every step is safe to repeat if something goes wrong.

### 4. Two settings in the Supabase dashboard
Open your project → **Authentication**:

1. **Sign In / Providers → Email**: for personal use, turn **"Confirm email" OFF**. (If you leave it on, also open **Emails → Templates → "Confirm signup"** and **"Magic Link"** and make sure each contains `{{ .Token }}` — the app asks for that 6-digit code.)
2. That's it. Password sign-in works out of the box.

> Supabase's built-in email sender is rate-limited (a handful of emails per hour). It's plenty when confirmation is off and you sign in with a password. If you'll rely on emailed codes a lot, add a free custom sender under **Authentication → SMTP Settings** (Resend has a free tier).

### 5. Start the app
Double-click **`Start Study App (computer).bat`** again. You'll see **Sign in / Create account**. Create your account, and if you'd already added things while trying it out, you'll be offered **"Bring your data into your account?"**.

---

## C. Use it anywhere (phone home screen, no computer running)

The app can be published as a private web app and installed on your phone like a normal app.

1. Make sure step B is done (the `.env` file must exist *before* building — the keys get baked in).
2. Build it:
   ```
   npm run build:web
   ```
   That creates a `dist` folder.
3. Publish `dist` for free — easiest: go to <https://app.netlify.com/drop> and **drag the `dist` folder onto the page**. You get a web address like `https://something.netlify.app`. (Vercel and Cloudflare Pages work too; the needed rewrite rules are already included.)
4. On your phone, open that address in the browser:
   - **iPhone (Safari):** Share → **Add to Home Screen**.
   - **Android (Chrome):** menu → **Install app** / **Add to Home screen**.

To update later: change things, run `npm run build:web` again, drag the new `dist` folder to the same Netlify site.

**Worth knowing about the web version:** reminders (push notifications) don't work in a web app — they need the real phone app. Everything else does. The real phone app (App Store / Play Store) is possible later but costs money and time (Apple's developer program is $99/year); it isn't needed to start using this.

---

## If something goes wrong

| You see | Try |
|---|---|
| "Node.js is needed" | Install the LTS version from <https://nodejs.org>, then run the launcher again. |
| Blank page for ~20 seconds on first open | Normal — it's building. Wait, then refresh. |
| Can't sign in / "Can't reach the server" | Check the `.env` file has both lines filled in, then restart the launcher. |
| "That code isn't right" | Use the *newest* email; older codes stop working. |
| Signed in but syllabus upload fails | Re-run `npm run backend:setup` and paste your Anthropic key (step 5 of the script). |
| Phone can't find the app (option A, phone) | Same Wi-Fi? Allow the Windows firewall prompt, or use option C instead. |
| Forgot your password | On the sign-in screen tap **Forgot password?**, sign in with the emailed code, then set a new one under **More → Account**. |

## What's private

Each account can only ever read its own rows (enforced in the database, not just the app). Your Anthropic key lives only in Supabase's server secrets — never in the app. **More → Account** lets you download everything or delete the account and all its data permanently.
