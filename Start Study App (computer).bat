@echo off
title Study App
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is needed to run Study App. Install the "LTS" version from https://nodejs.org , then run this again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo First run: installing what the app needs. This takes a few minutes, once.
  call npm install
  if errorlevel 1 ( echo Install failed. & pause & exit /b 1 )
)

echo.
echo Starting Study App. Your browser will open in a moment.
echo Keep this window open while you use the app; close it to stop.
echo.
call npx expo start --web --port 8081
pause
