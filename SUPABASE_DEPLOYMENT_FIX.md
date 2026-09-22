# Fixing "Can't Reach Server" Error on Live Deployment

## Problem
When trying to sign up or sign in on the live (Vercel) deployment, you get:
```
Can't reach the server. Check your connection and try again.
```

This means the app can't connect to Supabase.

## Root Causes & Solutions

### ✅ Solution 1: Add Environment Variables to Vercel (MOST LIKELY)

The environment variables are set in `.env.local` but NOT in Vercel's deployment settings.

**Steps:**

1. Go to your Vercel project dashboard
   - URL: https://vercel.com/dashboard

2. Find your project "Jivvy_study" (or whatever it's named)

3. Click on "Settings" tab

4. Go to "Environment Variables" section

5. Add these two variables:
   ```
   Name: EXPO_PUBLIC_SUPABASE_URL
   Value: https://yvsqppvjxspppzabjmful.supabase.co
   ```

   ```
   Name: EXPO_PUBLIC_SUPABASE_ANON_KEY
   Value: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl2c3FwcHZqeHNwcHphYmptZnVsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk4NDAwNjYsImV4cCI6MjEwNTQxNjA2Nn0.S6xRv9YEDCCDR7_FlCRx9DemM16JOVqVPy0xfHZbMvg
   ```

6. Click "Save"

7. Redeploy the project:
   - Go to "Deployments" tab
   - Click the latest deployment
   - Click "Redeploy" button

8. Wait for deployment to complete (~2-3 minutes)

9. Test: Try signing up again

---

### ✅ Solution 2: Verify Supabase Auth URL Configuration

If Solution 1 didn't work, check Supabase settings:

1. Go to Supabase Dashboard
   - URL: https://supabase.com

2. Select your project "yvsqppvjxspppzabjmful"

3. Go to Settings → Authentication

4. Under "URL Configuration", check "Redirect URLs" includes:
   ```
   http://localhost:8081/
   http://localhost:8081/*
   https://YOUR-VERCEL-URL/*
   https://YOUR-VERCEL-URL
   ```

   Replace `YOUR-VERCEL-URL` with your actual Vercel domain (e.g., `jivvy-study.vercel.app`)

5. If missing, add them and save

---

### ✅ Solution 3: Test Supabase Connectivity

Create a test to verify the connection works:

**Add this temporary function to `src/data/supabase.ts`:**

```typescript
export async function testSupabaseConnection() {
  try {
    const client = getSupabase();
    const { data, error } = await client
      .from('users')
      .select('id')
      .limit(1);
    
    if (error) {
      console.error('Supabase error:', error);
      return { ok: false, error: error.message };
    }
    
    console.log('✅ Supabase connected!');
    return { ok: true, data };
  } catch (e) {
    console.error('Connection failed:', e);
    return { ok: false, error: String(e) };
  }
}
```

**Test in browser console:**

```javascript
// In browser DevTools console
import { testSupabaseConnection } from '@/data/supabase';
const result = await testSupabaseConnection();
console.log(result);
```

---

### ✅ Solution 4: Check Network Issues

**In browser DevTools:**

1. Open DevTools (F12)
2. Go to Network tab
3. Try to sign in
4. Look for requests to `supabase.co`
5. Check if they return 200 or error codes

**Common errors:**
- `403 Forbidden` → API key issue
- `404 Not Found` → Wrong URL
- `CORS error` → URL not in Supabase whitelist
- `Connection timeout` → Network/firewall issue

---

## Quick Checklist

- [ ] Environment variables added to Vercel
- [ ] Project redeployed after adding env vars
- [ ] Supabase Auth redirect URLs configured
- [ ] Can reach https://yvsqppvjxspppzabjmful.supabase.co in browser
- [ ] Network requests show 200 status (not 403/404)
- [ ] Tried signing up with new account
- [ ] Tried signing in with existing account

---

## Debugging Steps

### Step 1: Verify Variables Are Set

On Vercel deployment, open DevTools console and run:

```javascript
console.log('URL:', process.env.EXPO_PUBLIC_SUPABASE_URL);
console.log('Key:', process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
```

Should show the values, not `undefined`.

### Step 2: Test Supabase Health

Visit this URL in your browser to test Supabase:
```
https://yvsqppvjxspppzabjmful.supabase.co/rest/v1/
```

Should return JSON (not "Can't reach server").

### Step 3: Check CORS Headers

In DevTools Network tab, look for request to Supabase:
- Click the request
- Go to "Response Headers"
- Should have: `access-control-allow-origin: *`

---

## If Still Not Working

### Check Vercel Logs

1. Go to Vercel Dashboard → Your Project
2. Click "Deployments" tab
3. Click latest deployment
4. Click "Logs" (or "Function Logs")
5. Look for errors related to Supabase

### Check Supabase Logs

1. Go to Supabase Dashboard → Your Project
2. Click "Logs" (in left sidebar)
3. Look for failed auth requests
4. Check "API" logs for errors

### Network Issues

1. Check if your ISP/firewall blocks Supabase
2. Try from different network/VPN
3. Try on mobile hotspot

---

## Expected Behavior After Fix

### Should See:
- ✅ Auth screen loads (already works)
- ✅ Email field accepts input (already works)
- ✅ Can enter password (already works)
- ✅ Click "Create account" → No error
- ✅ Email received with verification code
- ✅ Can sign up and sign in successfully

### Should NOT See:
- ❌ "Can't reach the server" error
- ❌ Blank screen after clicking submit
- ❌ Network errors in console

---

## Complete Deployment Checklist

### Vercel Setup
- [ ] Project created on Vercel
- [ ] Connected to GitHub repo
- [ ] Environment variables added (EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY)
- [ ] Build command: `npm run build:web`
- [ ] Output directory: `dist`
- [ ] Deployed successfully (no build errors)

### Supabase Setup
- [ ] Project created on Supabase
- [ ] Auth enabled
- [ ] Email confirmation turned on
- [ ] Database migrations ran (tables created)
- [ ] Redirect URLs configured (includes Vercel domain)
- [ ] API accessible from outside

### Testing
- [ ] Can sign up on live server
- [ ] Can receive confirmation email
- [ ] Can sign in with password
- [ ] Can sign in with code (forgot password)
- [ ] Can update profile
- [ ] Can download data
- [ ] Can sign out
- [ ] Can delete account

---

## Quick Fix Script

If you have access to Vercel CLI, run this:

```bash
# Install Vercel CLI
npm install -g vercel

# Link to your project
vercel link

# Set environment variables
vercel env add EXPO_PUBLIC_SUPABASE_URL
vercel env add EXPO_PUBLIC_SUPABASE_ANON_KEY

# Pull env vars locally
vercel env pull

# Redeploy
vercel --prod
```

---

## Support

If still getting "Can't reach server" after trying all steps:

1. Check Vercel deployment logs for build errors
2. Check Supabase project status (not paused)
3. Verify internet connection
4. Try incognito/private browsing (clear cookies)
5. Try different browser
6. Contact Supabase support if endpoint is down

---

**Last Updated**: 2026-09-22  
**Severity**: High (blocks beta testing)  
**Status**: Fixable with environment variables
