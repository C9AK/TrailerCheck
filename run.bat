@echo off
rem UGL Trailer Check - one-command setup + launch.
rem First run installs everything (needs internet); later runs start in seconds.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run-all.ps1"
if errorlevel 1 (
  echo.
  echo Something went wrong - read the message above.
  pause
)
