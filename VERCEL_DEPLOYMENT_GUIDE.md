# Complete Vercel Deployment Guide

## Overview

This guide walks through deploying your Study App to Vercel with full Supabase integration for the live account system.

---

## Prerequisites

✅ GitHub account (repo already set up)  
✅ Vercel account (free tier works)  
✅ Supabase project (already created)  
✅ Environment variables ready  

---

## Step-by-Step Deployment

### Step 1: Connect Vercel to GitHub

1. Go to https://vercel.com
2. Click "New Project"
3. Click "Import Git Repository"
4. Find "dertder25t-png/Jivvy_study" (search for it)
5. Click "Import"
6. Select project name (can keep "Jivvy_study")
7. Click "Continue"

### Step 2: Configure Build Settings

On the "Configure" page:

**Build Command:**
```
npm run build:web
```

**Output Directory:**
```
dist
```

**Install Command:**
```
npm ci
```

Leave other settings as default.

### Step 3: Add Environment Variables (CRITICAL!)

This is where most deployments fail. On the same "Configure" page:

1. Scroll to "Environment Variables" section
2. Click to expand
3. Add first variable:
   - Name: `EXPO_PUBLIC_SUPABASE_URL`
   - Value: `https://yvsqppvjxspppzabjmful.supabase.co`
   - Click "Add"

4. Add second variable:
   - Name: `EXPO_PUBLIC_SUPABASE_ANON_KEY`
   - Value: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl2c3FwcHZqeHNwcHphYmptZnVsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk4NDAwNjYsImV4cCI6MjEwNTQxNjA2Nn0.S6xRv9YEDCCDR7_FlCRx9DemM16JOVqVPy0xfHZbMvg`
   - Click "Add"

5. Verify both variables are added and visible

### Step 4: Deploy

1. Click "Deploy" button
2. Wait for deployment to complete (2-5 minutes)
3. Should show "✅ Production" when done
4. Note the deployment URL (usually `jivvy-study.vercel.app`)

### Step 5: Update Supabase Auth Settings

IMPORTANT: After deployment, you must whitelist the Vercel URL in Supabase.

1. Go to https://supabase.com
2. Select your project
3. Go to **Settings** → **Authentication**
4. Scroll to **URL Configuration** section
5. In "Redirect URLs", add:
   ```
   https://YOUR-VERCEL-URL
   https://YOUR-VERCEL-URL/
   https://YOUR-VERCEL-URL/*
   ```
   Replace `YOUR-VERCEL-URL` with your actual URL (e.g., `jivvy-study.vercel.app`)

6. Click "Save"

### Step 6: Test the Deployment

1. Visit your deployed URL: `https://YOUR-VERCEL-URL`
2. You should see the auth screen
3. Try creating an account:
   - Enter email: `testuser@example.com`
   - Enter password: `TestPass123!`
   - Click "Create account"
4. Check your email for verification code
5. Enter code in app
6. Should successfully sign up!

---

## Updating After Deployment

When you push changes to GitHub:

### Option A: Automatic Deployment
Vercel automatically deploys when you push to main:
```bash
git push origin main
```
Wait ~2-3 minutes for deployment.

### Option B: Manual Redeploy
1. Go to Vercel Dashboard
2. Click "Deployments" tab
3. Click latest deployment
4. Click "Redeploy"
5. Confirm redeploy

### Option C: Vercel CLI
```bash
npm install -g vercel
vercel --prod
```

---

## Environment Variables Reference

### Required Variables
These MUST be set in Vercel for auth to work:

```
EXPO_PUBLIC_SUPABASE_URL
EXPO_PUBLIC_SUPABASE_ANON_KEY
```

### Optional Variables
For future use:

```
# Not currently needed, but good to have:
NEXT_PUBLIC_APP_NAME=Jivvy Study
NEXT_PUBLIC_API_URL=https://your-domain.com/api
```

---

## Troubleshooting Deployment

### Build Fails

**Error: "npm run build:web failed"**

1. Check local build works: `npm run build:web`
2. Fix TypeScript errors first
3. Push fixed code to GitHub
4. Trigger redeploy

### Auth Not Working After Deploy

**Error: "Can't reach the server"**

1. Verify env vars set in Vercel
2. Check they're spelled exactly: `EXPO_PUBLIC_SUPABASE_URL` (with underscores!)
3. Redeploy after adding env vars
4. Wait 5 minutes for deployment to finish
5. Clear browser cache: Ctrl+Shift+Del
6. Test in incognito/private window

### "Error 404 on page"

1. Make sure output directory is `dist`
2. Make sure rewrites are configured in `vercel.json`
3. Check `vercel.json` exists in root

### Blank White Page

1. Check browser console (F12) for errors
2. Check Vercel deployment logs for build errors
3. Make sure `npm run typecheck` passes locally
4. Check environment variables are set

### Slow Performance

1. Check if Supabase is responding slowly
2. Check database query performance in Supabase
3. Optimize images/assets
4. Use Vercel analytics to identify bottlenecks

---

## Monitoring & Logs

### View Deployment Logs

1. Go to Vercel Dashboard
2. Click "Deployments" tab
3. Click a deployment
4. Click "Logs" to see build output
5. Click "Runtime Logs" to see application errors

### Check for Errors

Look for:
- ❌ Build failures (red X)
- ❌ Environment variable warnings
- ❌ Failed API calls to Supabase
- ❌ JavaScript errors in console

### View Performance

1. Click "Analytics" tab in Vercel
2. Monitor:
   - Response time
   - Error rate
   - CPU usage
   - Memory usage

---

## Custom Domain Setup (Optional)

To use a custom domain instead of `vercel.app`:

1. Buy domain (Vercel, Namecheap, GoDaddy, etc.)
2. In Vercel, go to Settings → Domains
3. Add your domain
4. Follow DNS setup instructions
5. Wait 24 hours for DNS to propagate
6. Update Supabase redirect URLs with new domain

---

## Continuous Deployment Workflow

### Local Development
```bash
# Make changes
git add .
git commit -m "Fix: description"
git push origin main
```

### Automatic Deployment
1. GitHub receives push
2. Vercel webhook triggered
3. Vercel pulls latest code
4. Runs build: `npm run build:web`
5. Deploys to production
6. Website updated live (~2-3 min)

### Test New Deployment
1. Visit deployed URL
2. Test auth flows
3. Check browser console for errors
4. Monitor Vercel logs

---

## Rollback (Undo a Deployment)

If something breaks after deployment:

1. Go to Vercel Dashboard
2. Click "Deployments"
3. Find previous working deployment
4. Click three dots (...)
5. Click "Promote to Production"
6. Wait for rollback to complete

Or revert locally:
```bash
git revert HEAD  # Creates new commit that undoes changes
git push origin main
```

---

## Environment Variable Security

### Best Practices

✅ DO:
- Store in Vercel (not in code)
- Use `.env.local` for local development only
- Keep keys secret
- Rotate keys periodically

❌ DON'T:
- Commit `.env.local` to git
- Share keys in Slack/email
- Use same keys everywhere
- Log keys to console

### Protecting Secrets

Supabase anon key is public (for frontend use):
- It's meant to be exposed in browser
- Has limited permissions (RLS enforced)
- Can't access sensitive data

Service role key (NEVER expose):
- Keep only on backend/server
- Can bypass RLS
- Like a database password

---

## Deployment Checklist

Before deploying:

- [ ] `npm run typecheck` passes locally
- [ ] `npm run build:web` builds successfully
- [ ] Tested auth flows locally
- [ ] Environment variables correct in `.env.local`
- [ ] No console errors in browser
- [ ] No secrets committed to git

On Vercel:

- [ ] Project connected to GitHub
- [ ] Environment variables set in Vercel
- [ ] Build command: `npm run build:web`
- [ ] Output directory: `dist`
- [ ] Deployment successful (no errors)

On Supabase:

- [ ] Project running (not paused)
- [ ] Auth enabled
- [ ] Vercel URL added to redirect URLs
- [ ] Email sending configured
- [ ] Database migrations applied

After deployment:

- [ ] Can visit deployed URL
- [ ] Auth screen shows
- [ ] Can create account
- [ ] Can receive email
- [ ] Can sign in/sign out
- [ ] No "Can't reach server" errors

---

## Cost Estimation

### Vercel (Free Tier Includes)
- ✅ Unlimited deployments
- ✅ Automatic SSL/HTTPS
- ✅ Custom domains
- ✅ Bandwidth: 100GB/month
- ✅ Functions (edge): included

### Supabase (Free Tier Includes)
- ✅ Database: 500MB
- ✅ Storage: 1GB
- ✅ Auth: unlimited users
- ✅ API calls: unlimited
- ✅ Bandwidth: 2GB/month

**Total Cost: $0** for hobby/testing  
**Scaling**: Both have affordable paid tiers

---

## Performance Optimization

### Reduce Build Time
```bash
# Analyze bundle size
npm run build:web -- --analyze
```

### Improve Runtime Performance
- Minimize database queries
- Use pagination for large datasets
- Cache auth state locally
- Debounce rapid submissions

### Monitor with Vercel Analytics
1. Enable Analytics in Vercel dashboard
2. Check Core Web Vitals
3. Monitor error rates
4. Track response times

---

## Support & Escalation

### If Deployment Fails

1. Check Vercel logs (Deployments → Logs)
2. Check build output for errors
3. Verify environment variables
4. Try redeploying
5. Check GitHub Actions if using

### If Auth Doesn't Work

1. Verify env vars in Vercel
2. Check Supabase project status
3. Check redirect URLs in Supabase
4. Clear browser cache
5. Try incognito window

### Get Help

- **Vercel Docs**: https://vercel.com/docs
- **Supabase Docs**: https://supabase.com/docs
- **Expo Docs**: https://docs.expo.dev/

---

## Next Steps After Deployment

1. ✅ **Beta Testing**
   - Invite testers to live URL
   - Have them create accounts
   - Collect feedback

2. ✅ **Monitor in Production**
   - Check Vercel logs daily
   - Monitor Supabase metrics
   - Track user signup rate

3. ✅ **Iterate & Improve**
   - Fix bugs found in testing
   - Add requested features
   - Optimize performance

4. ✅ **Scale to Users**
   - Plan upgrade timeline
   - Set up payment (if needed)
   - Prepare for growth

---

**Last Updated**: 2026-09-22  
**Status**: Ready to Deploy ✅  
**Estimated Deployment Time**: 10-15 minutes
