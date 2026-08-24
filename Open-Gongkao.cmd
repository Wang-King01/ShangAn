@echo off
chcp 65001 >nul
title Gongkao Manager - Start or Repair
echo Checking and repairing Gongkao Manager...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Gongkao.ps1" -OpenBrowser
if errorlevel 1 (
  echo.
  echo Repair failed. Read the message above or open:
  echo %~dp0logs\last-start-error.txt
  echo.
  pause
  exit /b 1
)
echo Ready. This window will close automatically.
timeout /t 2 /nobreak >nul
