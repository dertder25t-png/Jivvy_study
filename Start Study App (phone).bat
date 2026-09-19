@echo off
title Study App (phone)
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is needed. Install the "LTS" version from https://nodejs.org , then run this again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo First run: installing what the app needs. This takes a few minutes, once.
  call npm install
  if errorlevel 1 ( echo Install failed. & pause & exit /b 1 )
)

echo.
echo 1. Install the free "Expo Go" app on your phone.
echo 2. Put your phone on the SAME Wi-Fi as this computer.
echo 3. Scan the QR code below (Camera app on iPhone, Expo Go on Android).
echo    If Windows asks about the firewall, choose "Allow".
echo Keep this window open while you use the app.
echo.
call npx expo start --lan
pause
