@echo off
title Student Work Scanner
rem Starts the scanner and opens it in the browser. Keep this window open while
rem scanning; closing it stops the folder watcher.
cd /d "%~dp0.."

rem The folder the scanner saves into. Change this line if yours is elsewhere.
if not defined SWS_INBOX set "SWS_INBOX=%USERPROFILE%\Desktop\scan"

if not exist "dist\server\index.js" (
  echo Building for the first time...
  call npm run build
)

start "" /min cmd /c "timeout /t 3 >nul & start http://localhost:4710"
echo Watching "%SWS_INBOX%". The app is at http://localhost:4710
node --no-warnings=ExperimentalWarning dist\server\index.js
echo.
echo The scanner stopped. Press any key to close this window.
pause >nul
