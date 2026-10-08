@echo off
rem bootquest CLI shim. Add <BootQuest repo>\bin to PATH, then run `bootquest status`
rem from any project directory. Resolved relative to this file (%~dp0), so the repo
rem can move. Equivalent to `node --import tsx cli/src/main.ts`, except tsx is loaded
rem from the repo's node_modules (cli/bootquest.mjs) instead of from the cwd.
node "%~dp0..\cli\bootquest.mjs" %*
exit /b %ERRORLEVEL%
