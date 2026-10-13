@echo off
set "ELECTRON_RUN_AS_NODE="
if not exist "%~dp0node_modules\electron\dist\electron.exe" (
  echo Please run npm install with Node.js 22.12 or newer first.
  pause
  exit /b 1
)
if not exist "%~dp0src\ui\vendor\tutor\ai-chat-2.jsx" (
  echo Please configure REACTBITS_LICENSE_KEY in .env.local and run npm run setup-ui first.
  pause
  exit /b 1
)
pushd "%~dp0"
set "ELECTRON_RUN_AS_NODE=1"
"%~dp0node_modules\electron\dist\electron.exe" "%~dp0node_modules\vite\bin\vite.js" build
if errorlevel 1 (
  set "ELECTRON_RUN_AS_NODE="
  popd
  pause
  exit /b 1
)
set "ELECTRON_RUN_AS_NODE="
popd
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0"
