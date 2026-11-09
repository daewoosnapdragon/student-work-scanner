@echo off
title Update Student Work Scanner
rem Fetches the latest version, installs anything new, and rebuilds.
rem Close the scanner window first if it is running.
cd /d "%~dp0.."
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
