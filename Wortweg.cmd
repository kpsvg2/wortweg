@echo off
title Wortweg
cd /d "%~dp0"
if exist "runtime\node.exe" set "PATH=%~dp0runtime;%PATH%"
where node >nul 2>nul || set "PATH=%PATH%;%ProgramFiles%\nodejs"
where node >nul 2>nul || (echo Node.js not found. Install it from https://nodejs.org and try again. & pause & exit /b 1)
node server\launch.mjs || pause
