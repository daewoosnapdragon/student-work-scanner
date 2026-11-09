@echo off
rem Puts a "Student Work Scanner" shortcut on the Desktop that you can pin to
rem the taskbar: right-click it, Show more options, Pin to taskbar.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0make-shortcut.ps1"
pause
