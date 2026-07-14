@echo off
echo Stopping existing node processes...
taskkill /f /im node.exe 2>nul
timeout /t 2 /nobreak >nul
echo Starting dev server...
cd /d "%~dp0"
node dev-server.mjs
