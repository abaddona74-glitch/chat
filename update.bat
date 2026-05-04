@echo off
setlocal

REM Root-level helper to run desktop updater from anywhere in the repo.
set "SCRIPT_DIR=%~dp0"
set "DESKTOP_DIR=%SCRIPT_DIR%apps\wails-desktop"

if not exist "%DESKTOP_DIR%\update.bat" (
  echo [ERROR] Desktop update script topilmadi:
  echo         "%DESKTOP_DIR%\update.bat"
  exit /b 1
)

pushd "%DESKTOP_DIR%" || exit /b 1
call update.bat %*
set "RC=%ERRORLEVEL%"
popd

exit /b %RC%
