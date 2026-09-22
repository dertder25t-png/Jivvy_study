// Verifies the Supabase env vars actually point at a live project.
//
// A mistyped project ref fails DNS, which surfaces in the app as the generic
// "Can't reach the server" — indistinguishable from being offline. The ref is
// also embedded in the anon key's JWT, so the two can be cross-checked without
// contacting anyone.
//
//   node scripts/check-supabase.mjs           # checks .env.local, then .env
//   node scripts/check-supabase.mjs <url> <key>   # checks values directly
//                                                 # (use to vet Vercel's values)

import { readFileSync } from 'node:fs';

const read = (file) => {
  try {
    return readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  } catch {
    return null;
  }
};

const pick = (text, name) => text?.match(new RegExp(`^${name}=(.+)$`, 'm'))?.[1].trim();

function fromEnvFiles() {
  for (const file of ['.env.local', '.env']) {
    const text = read(file);
    const url = pick(text, 'EXPO_PUBLIC_SUPABASE_URL');
    const key = pick(text, 'EXPO_PUBLIC_SUPABASE_ANON_KEY');
    if (url && key) return { url, key, source: file };
  }
  return null;
}

const refFromKey = (key) => {
  const payload = key.split('.')[1];
  if (!payload) throw new Error('anon key is not a JWT');
  return JSON.parse(Buffer.from(payload, 'base64url')).ref;
};

const [argUrl, argKey] = process.argv.slice(2);
const config = argUrl && argKey
  ? { url: argUrl, key: argKey, source: 'command line' }
  : fromEnvFiles();

if (!config) {
  console.error('No Supabase config found. Set EXPO_PUBLIC_SUPABASE_URL and');
  console.error('EXPO_PUBLIC_SUPABASE_ANON_KEY in .env.local, or pass them as arguments.');
  process.exit(1);
}

const { url, key, source } = config;
console.log(`Checking Supabase config from ${source}\n`);

const urlRef = new URL(url).hostname.split('.')[0];
const keyRef = refFromKey(key);

console.log(`  url ref : ${urlRef}`);
console.log(`  key ref : ${keyRef}`);

if (urlRef !== keyRef) {
  console.error(`\n✗ Project ref mismatch.`);
  console.error(`  The URL says "${urlRef}" but the anon key was issued for "${keyRef}".`);
  console.error(`  The key is authoritative — the URL should be https://${keyRef}.supabase.co`);
  process.exit(1);
}

const res = await fetch(`${url}/auth/v1/health`, { headers: { apikey: key } }).catch((e) => e);

if (res instanceof Error) {
  console.error(`\n✗ Could not reach ${url}`);
  console.error(`  ${res.cause?.code === 'ENOTFOUND' ? 'Host does not resolve.' : res.message}`);
  process.exit(1);
}
if (!res.ok) {
  console.error(`\n✗ Auth service returned HTTP ${res.status}`);
  console.error(`  ${(await res.text()).slice(0, 200)}`);
  process.exit(1);
}

console.log(`\n✓ ${(await res.json()).name} is reachable and the anon key is accepted.`);
