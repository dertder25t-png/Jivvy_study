// Switches the Supabase auth emails from confirmation LINKS to 6-digit CODES,
// which is what the app's AuthScreen actually asks for, and points Site URL at
// production so generated links stop 404ing.
//
// Patches only the fields below via the Management API — every other auth
// setting is left exactly as-is. Prints before/after so the change is visible.
//
//   node scripts/fix-auth-emails.mjs --token sbp_xxx
//   node scripts/fix-auth-emails.mjs --token sbp_xxx --dry-run
//
// Token: https://supabase.com/dashboard/account/tokens  ("Generate new token")

const PROJECT_REF = 'yvsqppvjxsppzabjmful';
const SITE_URL = 'https://jivvy-study.vercel.app';

const args = process.argv.slice(2);
const token = args[args.indexOf('--token') + 1] ?? process.env.SUPABASE_ACCESS_TOKEN;
const dryRun = args.includes('--dry-run');

if (!token || token.startsWith('--')) {
  console.error('Missing access token.\n');
  console.error('  1. Open https://supabase.com/dashboard/account/tokens');
  console.error('  2. Generate new token, copy it (starts with sbp_)');
  console.error('  3. node scripts/fix-auth-emails.mjs --token sbp_xxx');
  process.exit(1);
}

const codeBlock = (label) => `<h2>${label}</h2>
<p>Enter this code in the app:</p>
<p style="font-size:28px;letter-spacing:6px;font-weight:700;margin:16px 0">{{ .Token }}</p>
<p style="color:#666;font-size:13px">If the code stops working, tap Resend in the app. If you didn't request it, you can ignore this email.</p>`;

const patch = {
  // "Confirm signup" — used by signUpWithPassword() -> verifyOtp({ type: 'signup' })
  mailer_subjects_confirmation: '{{ .Token }} is your Jivvy code',
  mailer_templates_confirmation_content: codeBlock('Confirm your email address'),

  // "Magic Link" — used by sendSignInCode() -> verifyOtp({ type: 'email' }),
  // which is the forgot-password path
  mailer_subjects_magic_link: '{{ .Token }} is your Jivvy sign-in code',
  mailer_templates_magic_link_content: codeBlock('Your sign-in code'),

  // Links built from Site URL were 404ing
  site_url: SITE_URL,
  uri_allow_list: [SITE_URL, `${SITE_URL}/**`, 'http://localhost:8081', 'http://localhost:8081/**'].join(','),
};

const api = async (method, body) => {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body && { body: JSON.stringify(body) }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(
      res.status === 401
        ? 'Token rejected (401). Generate a fresh one at supabase.com/dashboard/account/tokens'
        : res.status === 403
          ? `No access to project ${PROJECT_REF} (403). Is the token from the right account?`
          : `HTTP ${res.status}: ${detail.slice(0, 300)}`,
    );
  }
  return res.json();
};

const summarise = (cfg) => ({
  site_url: cfg.site_url,
  confirmation_subject: cfg.mailer_subjects_confirmation,
  confirmation_sends: /{{\s*\.Token\s*}}/.test(cfg.mailer_templates_confirmation_content ?? '')
    ? 'CODE'
    : 'LINK',
  magic_link_sends: /{{\s*\.Token\s*}}/.test(cfg.mailer_templates_magic_link_content ?? '')
    ? 'CODE'
    : 'LINK',
});

async function main() {
  console.log(`Project ${PROJECT_REF}\n`);

  console.log('BEFORE');
  console.table(summarise(await api('GET')));

  if (dryRun) {
    console.log('\n--dry-run: nothing changed.');
    return 0;
  }

  await api('PATCH', patch);
  const after = summarise(await api('GET'));
  console.log('\nAFTER');
  console.table(after);

  const ok = after.confirmation_sends === 'CODE' && after.magic_link_sends === 'CODE';
  console.log(
    ok
      ? '\n✓ Both emails now send a 6-digit code. Sign up again to confirm.'
      : '\n✗ Templates did not change — check the dashboard.',
  );
  return ok ? 0 : 1;
}

try {
  process.exitCode = await main();
} catch (e) {
  console.error(`\n✗ ${e.message}`);
  process.exitCode = 1;
}
