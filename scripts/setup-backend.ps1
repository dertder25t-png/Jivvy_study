# Study App - one-time backend setup.
#
# You do two things by hand first (they need YOUR accounts, so nobody can do them for you):
#   1. Create a free Supabase project at https://supabase.com  (Project name: anything. Save the database password.)
#
# Then run this file. It logs you in, creates the database, deploys the server functions, and writes
# the .env file the app needs. Nothing is sent anywhere else. No AI or API keys are involved.

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

function Step([string]$n, [string]$text) {
  Write-Host ''
  Write-Host "[$n] $text" -ForegroundColor Cyan
}

function Cli {
  # Runs the Supabase CLI through npx (no install needed) and stops if it fails.
  Write-Host ('  > supabase ' + ($args -join ' ')) -ForegroundColor DarkGray
  & npx --yes supabase @args
  if ($LASTEXITCODE -ne 0) { throw "That step failed: supabase $($args -join ' ')" }
}

Write-Host ''
Write-Host 'Study App - backend setup' -ForegroundColor Green
Write-Host 'This takes about five minutes. You can stop any time with Ctrl+C and run it again; every step is safe to repeat.'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js is not installed. Get the LTS version from https://nodejs.org and run this again.' }
if (-not (Test-Path 'node_modules')) {
  Step '0/6' 'Installing the app first (one time)'
  & npm install
  if ($LASTEXITCODE -ne 0) { throw 'npm install failed.' }
}

# ---------------------------------------------------------------- 1. project
Step '1/6' 'Which Supabase project?'
Write-Host '  In the Supabase dashboard open your project -> Project Settings -> General -> "Reference ID".'
$ref = (Read-Host '  Paste the Reference ID').Trim()
if ($ref -notmatch '^[a-z0-9]{15,30}$') { throw "That doesn't look like a project Reference ID (it is ~20 lowercase letters/numbers, not the project name)." }

# ---------------------------------------------------------------- 2. login + link
Step '2/6' 'Logging in to Supabase (a browser window will open - approve it)'
Cli login
Step '3/6' 'Linking this folder to your project (it will ask for the database password you chose)'
Cli link --project-ref $ref

# ---------------------------------------------------------------- 3. database
Step '4/6' 'Creating your database (tables, privacy rules, file storage)'
Cli db push

# ---------------------------------------------------------------- 4. functions
Step '5/6' 'Server functions'
foreach ($fn in @('parse-syllabus', 'delete-account')) {
  Cli functions deploy $fn --project-ref $ref --use-api
}

# ---------------------------------------------------------------- 5. .env
Step '6/6' 'Writing the .env file the app reads'
$anon = $null
try {
  $json = (& npx --yes supabase projects api-keys --project-ref $ref -o json) -join "`n"
  $anon = ($json | ConvertFrom-Json | Where-Object { $_.name -eq 'anon' } | Select-Object -First 1).api_key
} catch { $anon = $null }
if (-not $anon) {
  Write-Host '  Could not fetch the key automatically.'
  Write-Host '  In the dashboard: Project Settings -> API Keys -> copy the "anon" / "public" key (NOT the service_role key).'
  $anon = (Read-Host '  Paste the anon key').Trim()
}
$lines = @("EXPO_PUBLIC_SUPABASE_URL=https://$ref.supabase.co", "EXPO_PUBLIC_SUPABASE_ANON_KEY=$anon")
Set-Content -Path '.env' -Value $lines -Encoding ascii
Write-Host '  Saved .env' -ForegroundColor Green

Write-Host ''
Write-Host 'Backend is ready.' -ForegroundColor Green
Write-Host ''
Write-Host 'Two settings left, in the Supabase dashboard (Authentication section) - see SETUP.md, step 4:'
Write-Host '  - Turn OFF "Confirm email" (simplest for personal use), or add {{ .Token }} to the email templates.'
Write-Host '  - Nothing else is required.'
Write-Host ''
Write-Host 'Then double-click "Start Study App (computer).bat" - you will see a sign-in screen.' -ForegroundColor Green
