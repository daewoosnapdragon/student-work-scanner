@echo off
title Update Student Work Scanner
rem Fetches the latest version, installs anything new, rebuilds, and closes a
rem running scanner so the next start runs the new version.
cd /d "%~dp0.."
echo Closing the scanner if it is running...
taskkill /FI "WINDOWTITLE eq Student Work Scanner*" /T /F >nul 2>&1
echo Updating...
git pull || goto :fail
call npm install || goto :fail
call npm run build || goto :fail
echo.
echo Updated. Start the scanner from the taskbar as usual.
pause >nul
exit /b 0
:fail
echo.
echo Something went wrong above. Copy the text in this window and send it to Claude.
pause >nul
