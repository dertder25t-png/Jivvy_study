# Complete User Account System Implementation Guide

## Overview
Your study app has a **fully functional user account system** integrated with Supabase. This document provides complete documentation of all features, how they work, and how to use them.

## System Architecture

### Authentication Stack
- **Supabase Auth**: Handles user registration, sign-in, and password management
- **Storage Layer**: AsyncStorage for offline persistence and session management
- **Backend**: PostgreSQL with Row-Level Security (RLS) for data privacy
- **Edge Functions**: Delete account function for cascading deletion
- **Storage Bucket**: File uploads for syllabi

### Current Status
✅ Email/Password authentication
✅ One-time code authentication (for sign-in and password reset)
✅ Account creation with optional name
✅ Profile management (name, timezone)
✅ Password change
✅ Account deletion with data cascade
✅ Data export/download
✅ Local data import to account
✅ Offline-first architecture
✅ Session persistence

## Key Files & Components

### Authentication Core (`src/core/auth.ts`)
Provides validation and error handling (no network calls):
- `isValidEmail(email)` - Email validation
- `normalizeEmail(email)` - Normalize for case-insensitive comparison
- `passwordProblems(pw)` - Returns array of password issues
- `passwordStrength(pw)` - Returns 0-3 strength rating
- `friendlyAuthError(err)` - Converts backend errors to user-friendly messages
- `initials(nameOrEmail)` - Creates avatar initials (e.g., "AS" for alex.smith@school.edu)

### Account Service (`src/data/account.ts`)
Core account operations:

**Authentication Functions:**
- `signUpWithPassword({email, password, name})` - Creates new account
  - Returns `'signed_in'` or `'needs_code'` for email confirmation
  - Throws error if email already registered
  
- `signInWithPassword(email, password)` - Password-based sign-in
  - Case-insensitive email handling
  
- `sendSignInCode(email)` - Email one-time code
  - Used for sign-in after password reset
  - Only for existing accounts
  
- `verifyCode(email, code, type)` - Verify one-time code
  - Types: `'signup'` or `'email'`
  - Code is 6 digits
  
- `resendSignupCode(email)` - Resend sign-up confirmation code

**Account Management:**
- `currentAccount()` - Get current user's info
  - Returns: `{email, name, createdAt}`
  - Returns `null` if not signed in
  
- `saveProfile({name, timezone})` - Update profile
  - Updates Auth metadata and users table
  - Also updates local prefs
  
- `changePassword(newPassword)` - Change password
  - Requires current session
  
- `deleteAccount()` - Permanently delete account
  - Requires `confirm: 'DELETE'` in request
  - Cascades to all user data
  - Clears uploaded files first
  - Called via Supabase Edge Function

**Data Operations:**
- `exportJson(now?)` - Export all user data as JSON
  - Includes all courses, notes, cards, grades
  - Portable format for backup or migration
  
- `downloadMyData()` - Save data file
  - Web: triggers download
  - Mobile: opens share sheet
  
- `readLocalRows()` - Read locally stored data (guest mode)
  - Fetches from AsyncStorage
  
- `importLocalData()` - Bring device data into account
  - Deduplicates and merges data
  - Handles conflicts gracefully
  - Returns `{imported, skipped}` count

### Supabase Client (`src/data/supabase.ts`)
Single client instance with proper configuration:
```typescript
const client = createClient(url, anonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  }
});
```

### Boot Process (`src/data/boot.ts`)
App initialization with automatic mode selection:

1. Load device preferences
2. Check Supabase configuration
3. Detect existing session
4. Load appropriate backend:
   - Signed in → Supabase backend (synced account)
   - Guest mode → Local backend (this device only)
   - No backend configured → Local demo mode
5. Initialize store and outbox
6. Return boot state: `ready`, `needs_auth`, or `error`

### UI Component - AuthScreen (`src/ui/AuthScreen.tsx`)
Complete auth UI with:
- Sign in / Create account tabs
- Email validation
- Password strength meter
- One-time code verification
- Forgot password flow
- Guest mode option
- User-friendly error messages

### Account Page (`app/account.tsx`)
Settings screen showing:
- **Who** section: Display name, email, sign-in status
- **Profile** section: Edit name and timezone
- **Password** section: Change password with strength meter
- **Your data** section: Download all data
- **Sign out** button
- **Danger zone**: Delete account with confirmation

### Database Schema (`supabase/migrations/0001_init.sql`)
Key tables for the account system:
- `public.users` - User profiles and account info
- `auth.users` - Supabase auth records
- Row-Level Security policies ensure users only access their own data

### Edge Functions
- `delete-account` - Handles account deletion securely
  - Removes uploaded syllabi from storage
  - Cascades deletion to all user data via foreign keys
  - Logs deletion events

## Authentication Flows

### Sign Up Flow
```
User enters email + password + optional name
                    ↓
         signUpWithPassword()
                    ↓
      Supabase Auth creates user
                    ↓
    Email confirmation enabled?
         ↙                        ↘
      YES                          NO
       ↓                           ↓
  returns 'needs_code'       returns 'signed_in'
       ↓                           ↓
Show code verify UI        App restarts in account
       ↓
User enters 6-digit code
       ↓
  verifyCode('signup')
       ↓
App restarts in account
```

### Sign In Flow
```
User enters email + password
         ↓
signInWithPassword()
         ↓
  Check credentials
     ↙      ↘
VALID      INVALID
  ↓          ↓
Success   Friendly error
          (case-insensitive)
```

### Forgot Password Flow
```
User clicks "Forgot password?"
         ↓
  sendSignInCode(email)
         ↓
   6-digit code emailed
         ↓
 User enters code
         ↓
verifyCode(email, code, 'email')
         ↓
   App restarts signed in
         ↓
User goes to Account → Password
         ↓
    Sets new password
```

### Data Import Flow (Device → Account)
```
Guest mode with local data
         ↓
Sign up / sign in
         ↓
Boot detects local data
         ↓
Shows "Import your data?" offer
         ↓
User clicks "Import"
         ↓
importLocalData()
  - Deduplicates against account data
  - Imports in dependency order (courses, then notes, etc)
  - Chunks in batches of 400 for performance
         ↓
  Confirms import count
```

## Error Handling

All auth operations go through `friendlyAuthError()` which converts backend errors to plain language:

| Backend Error | User Message |
|---|---|
| `invalid login` | "That email and password don't match..." |
| `email not confirmed` | "Confirm your email first..." |
| `already exists` | "That email already has an account..." |
| `token has expired` | "That code has expired..." |
| `invalid token/otp` | "That code isn't right..." |
| `rate limit` | "Too many tries. Wait a minute..." |
| `user not found` | "We couldn't find an account..." |
| `weak password` | "That password is too weak..." |
| Network errors | "Can't reach the server..." |

## Configuration

### Environment Variables (`.env.local`)
```bash
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

If not configured: app runs in demo mode (local device only, no accounts)

### Authentication Settings (in Supabase Dashboard)
1. **Email Confirmation**: Currently enabled
   - New signups need email verification
   - Users already confirmed can sign back in with code
   
2. **Email Templates**: Customize in dashboard
   - Confirmation email
   - Password reset email
   
3. **Redirect URLs**: Set in dashboard
   - Web: `http://localhost:8081` (development)
   - Production: Set during deployment

## Password Requirements

- Minimum: 8 characters
- Checks for:
  - Single character repeated (e.g., "aaaaaaaa")
  - Common passwords (e.g., "password", "12345678", "qwertyui")
- Strength meter (0-3):
  - 0 = Empty
  - 1 = Weak (<10 chars, limited character types)
  - 2 = Okay (10+ chars or mixed types)
  - 3 = Strong (14+ chars or 10+ with 3+ character types)

## Data Privacy & Security

### Session Management
- Sessions persisted to device storage
- Auto-refresh tokens before expiry
- Session cleared on sign out
- Offline writes queued in outbox

### Row-Level Security (RLS)
All tables have RLS policies:
- Users can only see their own records
- `user_id` set server-side to prevent tampering
- Foreign key cascades delete all related data

### File Uploads
- Uploaded syllabi stored under `{user_id}/` prefix
- Deleted when account is deleted
- Signed URLs for access

### Password Reset
- One-time codes valid for a limited time
- Code shown only in email
- Cannot reuse old passwords

## Testing & Verification

### Quick Test Checklist
- [ ] Open app, see "Sign in / Create account"
- [ ] Try invalid password (shows strength meter)
- [ ] Try weak password (shows problems)
- [ ] Create account with valid password (email sent)
- [ ] Enter code from email, verify sign-in
- [ ] Click Account tab, see profile
- [ ] Edit name and timezone, click Save
- [ ] Try change password (shows strength meter)
- [ ] Try reset password (code emailed)
- [ ] Download data (JSON file)
- [ ] Sign out and back in
- [ ] Delete account with confirmation

### Offline Testing
- [ ] Make changes while offline
- [ ] Sign out and back in
- [ ] Changes synced automatically
- [ ] Outbox queues writes if offline

## Common Issues & Fixes

### Issue: "Confirm your email first"
**Cause**: New signup waiting for email verification
**Fix**: Check email for 6-digit code, enter in app

### Issue: "That email already has an account"
**Cause**: Email registered previously
**Fix**: Sign in instead of create account, or use different email

### Issue: "Too many tries"
**Cause**: Rate limit from too many auth attempts
**Fix**: Wait 1 minute, then try again

### Issue: "Can't reach the server"
**Cause**: Network connection issue
**Fix**: Check internet, verify Supabase is running, try again

### Issue: App blank after login
**Cause**: Session loaded but store not hydrated
**Fix**: Should auto-resolve in ~2-3 seconds

### Issue: Data not syncing
**Cause**: Offline or connection issue
**Fix**: 
- Check internet connection
- Foreground app to trigger flush
- Check browser console for errors
- Verify Supabase connection

## API Reference

### Types
```typescript
type CodeKind = 'signup' | 'email';

interface AccountInfo {
  email: string | null;
  name: string | null;
  createdAt: string | null;
}

interface LocalDataOffer {
  courses: number;
  notes: number;
  cards: number;
}
```

### Hooks
```typescript
useLocalDataOffer(): LocalDataOffer | null
// Returns data import offer when signed in with local data
```

## Deployment

### Supabase Project Setup
1. Create project on supabase.com
2. Copy URL and anon key
3. Add to `.env.local` or deployment platform
4. Run migrations
5. Configure email templates

### Vercel Deployment
1. Add env vars to Vercel project
2. Auth will work with production URL
3. Update redirect URLs in Supabase

## Next Steps / Future Enhancements

Potential improvements to consider:
- [ ] Social login (Google, GitHub)
- [ ] Two-factor authentication
- [ ] Profile pictures
- [ ] Team/class sharing
- [ ] Backup to cloud storage
- [ ] Account recovery options
- [ ] Login activity log
- [ ] Device management

## Support

For issues:
1. Check the "Common Issues" section above
2. Review Supabase logs
3. Check browser console for errors
4. Verify environment variables are set
5. Test with fresh browser session (clear cookies)

## Glossary

- **RLS** - Row-Level Security: database policies preventing unauthorized access
- **One-time code** - 6-digit code emailed for email-based auth
- **Outbox** - Local queue of writes made while offline, synced when online
- **Session** - Auth state with JWT token, persisted to device
- **Cascading delete** - Foreign key constraint deletes related records
- **PostgREST** - REST API auto-generated from Postgres schema

---

**Last Updated**: 2026-09-21
**Account System Version**: 1.0 (Complete)
**Status**: Production Ready ✅
