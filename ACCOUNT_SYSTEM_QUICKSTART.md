# Account System - Quick Start Reference

## For Users

### Creating an Account
1. Open the app
2. Click "Create account"
3. Enter email and password (8+ chars)
4. Optionally enter your name
5. Check your email for 6-digit code
6. Enter code in the app
7. Done! Your semester is now backed up

### Signing In
1. Click "Sign in"
2. Enter email and password
3. Done!

### Forgot Password
1. On Sign in screen
2. Click "Forgot password?"
3. Enter your email
4. Check email for code
5. Enter code
6. Set new password
7. You're signed back in

### Changing Password (After Signing In)
1. Go to Account tab
2. Click "Password" section
3. Enter new password (8+ chars)
4. Click "Update password"

### Downloading Your Data
1. Go to Account tab
2. Click "Download my data"
3. Save the JSON file
4. This is your backup copy

### Deleting Your Account
1. Go to Account tab
2. Scroll to "Danger zone"
3. Click "Delete my account…"
4. Read the warning
5. Type "DELETE" exactly
6. Click "Delete forever"
7. Your account and all data are permanently deleted

---

## For Developers

### Import the Account Service
```typescript
import {
  currentAccount,
  signInWithPassword,
  signUpWithPassword,
  sendSignInCode,
  verifyCode,
  changePassword,
  saveProfile,
  deleteAccount,
  downloadMyData,
  importLocalData,
} from '@/data/account';
```

### Check if User is Signed In
```typescript
import { store } from '@/data/store';

if (store.mode === 'supabase') {
  // User is signed in
  const userId = store.userId;
  console.log(`Signed in as: ${userId}`);
} else {
  // User is in guest mode
  console.log('Guest mode');
}
```

### Get Current User Info
```typescript
const account = await currentAccount();
console.log(account);
// {
//   email: "user@example.com",
//   name: "Alex Smith",
//   createdAt: "2024-01-15T10:30:00Z"
// }
```

### Create an Account
```typescript
const result = await signUpWithPassword({
  email: 'newuser@example.com',
  password: 'SecurePass123!',
  name: 'Jane Doe'  // optional
});

if (result === 'signed_in') {
  // User email didn't need confirmation
} else if (result === 'needs_code') {
  // User needs to verify email
  // Show code entry screen
}
```

### Sign In
```typescript
try {
  await signInWithPassword('user@example.com', 'password');
  // Success! App will restart
} catch (e) {
  const friendly = friendlyAuthError(e);
  console.error(friendly);
  // "That email and password don't match. Check them, or use a code instead."
}
```

### Send Sign-In Code
```typescript
// For password reset or code-based signin
await sendSignInCode('user@example.com');
// User receives 6-digit code via email
```

### Verify One-Time Code
```typescript
await verifyCode('user@example.com', '123456', 'email');
// type: 'email' for password reset signin
// type: 'signup' for account confirmation
```

### Update Profile
```typescript
await saveProfile({
  name: 'Jane Doe',
  timezone: 'America/Chicago'
});
```

### Change Password
```typescript
try {
  await changePassword('NewPassword123!');
  console.log('Password updated!');
} catch (e) {
  console.error(friendlyAuthError(e));
}
```

### Export User Data
```typescript
// Get JSON string
const json = exportJson();

// Or trigger download/share
await downloadMyData();
```

### Import Local Data to Account
```typescript
if (store.mode === 'supabase') {
  const result = await importLocalData();
  console.log(`Imported ${result.imported}, skipped ${result.skipped}`);
}
```

### Delete Account
```typescript
try {
  await deleteAccount();
  // User signed out, app restarted
} catch (e) {
  console.error(friendlyAuthError(e));
}
```

### Password Validation
```typescript
import { passwordProblems, passwordStrength, isValidEmail } from '@/core/auth';

// Check for problems
const problems = passwordProblems('password');
console.log(problems); // ["That is a very common password."]

// Get strength (0-3)
const strength = passwordStrength('MySecurePass123!');
console.log(strength); // 3 (strong)

// Validate email
if (isValidEmail('user@example.com')) {
  // Valid email
}
```

### User-Friendly Error Messages
```typescript
import { friendlyAuthError } from '@/data/account';

try {
  await signInWithPassword(email, password);
} catch (error) {
  // Convert to user-friendly message
  const message = friendlyAuthError(error);
  showAlert(message);
  // Examples:
  // "That email and password don't match. Check them, or use a code instead."
  // "Confirm your email first — we sent you a code."
  // "Too many tries. Wait a minute, then try again."
}
```

### Listen to Auth State Changes
```typescript
import { getSupabase } from '@/data/supabase';

getSupabase().auth.onAuthStateChange((event) => {
  console.log('Auth event:', event);
  // 'SIGNED_IN' | 'SIGNED_OUT' | 'USER_UPDATED' | 'TOKEN_REFRESHED' | 'INITIAL_SESSION'
});
```

### Access Supabase Client
```typescript
import { getSupabase, isSupabaseConfigured } from '@/data/supabase';

if (isSupabaseConfigured) {
  const sb = getSupabase();
  // Use for custom queries
  const { data } = await sb.from('courses').select('*');
}
```

### Check Offline Write Status
```typescript
import { store } from '@/data/store';

const pendingWrites = store.outbox.length;
if (pendingWrites > 0) {
  console.log(`${pendingWrites} changes pending sync`);
}
```

---

## Configuration

### Environment Variables
```bash
# .env.local
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### Enable/Disable Authentication
The app automatically detects if Supabase is configured:
- If configured: Auth screen shown, accounts enabled
- If not configured: Guest mode only (demo)

### To disable accounts:
```bash
# Remove from .env.local or set empty
# EXPO_PUBLIC_SUPABASE_URL=
# EXPO_PUBLIC_SUPABASE_ANON_KEY=
```

---

## Common Patterns

### Pattern 1: Sign Up or Sign In
```typescript
export async function signUpOrSignIn(email: string, password: string) {
  try {
    // Try sign up first
    const result = await signUpWithPassword({ email, password });
    if (result === 'needs_code') {
      return 'verify_email';
    }
    return 'signed_in';
  } catch (error) {
    if (String(error).includes('already')) {
      // Email exists, try sign in
      await signInWithPassword(email, password);
      return 'signed_in';
    }
    throw error;
  }
}
```

### Pattern 2: Ensure Signed In
```typescript
function ProtectedComponent() {
  if (store.mode !== 'supabase') {
    return <Navigate to="/auth" />;
  }
  return <YourComponent />;
}
```

### Pattern 3: Handle Auth Errors Gracefully
```typescript
const tryAuth = async (fn: () => Promise<void>) => {
  try {
    await fn();
  } catch (e) {
    showError(friendlyAuthError(e));
  }
};

// Usage
await tryAuth(() => signInWithPassword(email, password));
```

### Pattern 4: Validate Before Submit
```typescript
const canSubmit = () => {
  return (
    isValidEmail(email) &&
    password.length >= 8 &&
    passwordProblems(password).length === 0
  );
};

<Button disabled={!canSubmit()} onPress={submit} />
```

### Pattern 5: Show Auth Status
```typescript
function AuthStatus() {
  const [account, setAccount] = useState(null);
  
  useEffect(() => {
    if (store.mode === 'supabase') {
      currentAccount().then(setAccount);
    }
  }, []);
  
  return (
    <Text>
      {account?.name || account?.email || 'No account'}
    </Text>
  );
}
```

---

## File Map

| File | Purpose |
|------|---------|
| `src/core/auth.ts` | Validation & errors (no network) |
| `src/data/account.ts` | Account operations (network calls) |
| `src/data/supabase.ts` | Supabase client setup |
| `src/data/boot.ts` | App initialization & auth detection |
| `src/ui/AuthScreen.tsx` | Sign in / create account UI |
| `app/account.tsx` | Account settings screen |
| `supabase/migrations/*.sql` | Database schema |
| `supabase/functions/delete-account/` | Account deletion handler |

---

## Debugging

### See Auth State
```typescript
// Browser console
localStorage.getItem('sb-user')    // Current user
localStorage.getItem('sb-session') // Auth token
```

### Enable Debug Logging
```typescript
// Add to any file
localStorage.setItem('debug', 'supabase:*');
console.clear();
// Reload page
```

### Check Network Requests
DevTools → Network → Filter "supabase"
- Look for `/auth/v1/signup` (create account)
- Look for `/auth/v1/token` (sign in)
- Look for `/auth/v1/user` (get current user)

### Check Database
1. Go to Supabase Dashboard
2. SQL Editor
3. Run:
```sql
SELECT id, email, created_at FROM auth.users;
SELECT id, email, timezone FROM public.users;
```

---

## TypeScript Types

```typescript
// Account info
interface AccountInfo {
  email: string | null;
  name: string | null;
  createdAt: string | null;
}

// Code kind for verification
type CodeKind = 'signup' | 'email';

// Local data offer
interface LocalDataOffer {
  courses: number;
  notes: number;
  cards: number;
}

// Boot state
type BootState = 
  | { status: 'ready'; comeback: boolean }
  | { status: 'needs_auth' }
  | { status: 'error'; message: string };

// Store mode
type StoreMode = 'supabase' | 'local';
```

---

## Performance Tips

1. **Lazy load auth**: Only call `currentAccount()` when needed
2. **Batch writes**: Queue changes, sync once
3. **Cache account**: Store result to avoid repeated fetches
4. **Offline first**: Build assuming offline, validate online
5. **Don't block UI**: Async all network calls

---

## Security Best Practices

1. **Never log credentials**: Passwords, tokens, codes
2. **Never send to tracking**: Analytics, third parties
3. **Use HTTPS**: Always in production
4. **Validate on backend**: Don't trust client validation
5. **Rotate tokens**: Let Supabase handle auto-refresh
6. **Clear on logout**: Use `signOut()` to clear session
7. **Rate limit**: Supabase handles auth rate limiting
8. **No secrets in code**: Use environment variables

---

## API Overview

### Authentication
- `signUpWithPassword()` - Create account
- `signInWithPassword()` - Sign in with password
- `sendSignInCode()` - Email one-time code
- `verifyCode()` - Verify code
- `changePassword()` - Change password

### Profile
- `currentAccount()` - Get signed-in user info
- `saveProfile()` - Update name, timezone
- `deleteAccount()` - Permanently delete account

### Data
- `exportJson()` - Export all data as JSON
- `downloadMyData()` - Save/share data file
- `importLocalData()` - Import device data to account
- `readLocalRows()` - Read local device data

### Validation
- `isValidEmail()` - Email format check
- `passwordProblems()` - Password issue list
- `passwordStrength()` - Strength rating 0-3
- `friendlyAuthError()` - Convert error to message
- `initials()` - Get avatar initials
- `normalizeEmail()` - Normalize email

---

## Next Steps

1. ✅ Review `ACCOUNT_SYSTEM_GUIDE.md` for architecture
2. ✅ Review `ACCOUNT_SYSTEM_TESTING.md` for testing
3. ✅ Run through test scenarios
4. ✅ Test on multiple browsers
5. ✅ Deploy to staging
6. ✅ Do user acceptance testing
7. ✅ Deploy to production

---

**Version**: 1.0  
**Status**: Production Ready ✅  
**Last Updated**: 2026-09-21
