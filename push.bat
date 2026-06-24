@echo off
cd /d "%~dp0"
echo Pushing naar GitHub...
git push origin main
if %ERRORLEVEL% NEQ 0 (
  echo.
  echo Push mislukt. Controleer je internetverbinding of GitHub credentials.
  pause
  exit /b 1
)
echo.
echo Klaar! Netlify deployt automatisch.
pause
