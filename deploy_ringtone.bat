@echo off
setlocal

REM Ringtone deploy helper for AWS server.
REM Server info shu yerda ushlanadi.

set "SCRIPT_DIR=%~dp0"
set "SERVER=maxava"
set "REMOTE_DIR=/opt/chat/apps/server/uploads/ringtones"
set "REMOTE_MP3=%REMOTE_DIR%/ringtone.mp3"
set "REMOTE_VERSION=%REMOTE_DIR%/version.json"
set "REMOTE_RINGTONE_META=%REMOTE_DIR%/ringtone.json"

set "SOURCE_MP3=%SCRIPT_DIR%joyful-iphone-message-alert-sound-material.mp3"
set "SOURCE_VERSION=%SCRIPT_DIR%apps\server\uploads\ringtones\version.json"
set "SOURCE_RINGTONE_META=%SCRIPT_DIR%apps\server\uploads\ringtones\ringtone.json"

echo ================================
echo   Chat Ringtone Deploy
echo ================================
echo Server: %SERVER%
echo Remote: %REMOTE_DIR%
echo.

if not exist "%SOURCE_MP3%" (
  echo [ERROR] Source mp3 topilmadi:
  echo         "%SOURCE_MP3%"
  exit /b 1
)

if not exist "%SOURCE_VERSION%" (
  echo [ERROR] version.json topilmadi:
  echo         "%SOURCE_VERSION%"
  exit /b 1
)

if not exist "%SOURCE_RINGTONE_META%" (
  echo [ERROR] ringtone.json topilmadi:
  echo         "%SOURCE_RINGTONE_META%"
  exit /b 1
)

ssh %SERVER% "mkdir -p %REMOTE_DIR%" || exit /b 1

echo [1/3] ringtone.mp3 yuborilmoqda...
scp "%SOURCE_MP3%" %SERVER%:%REMOTE_MP3%
if errorlevel 1 (
  echo [ERROR] mp3 upload xato.
  exit /b 1
)

echo [2/3] version.json yuborilmoqda...
scp "%SOURCE_VERSION%" %SERVER%:%REMOTE_VERSION%
if errorlevel 1 (
  echo [ERROR] version.json upload xato.
  exit /b 1
)

echo [3/3] ringtone.json yuborilmoqda...
scp "%SOURCE_RINGTONE_META%" %SERVER%:%REMOTE_RINGTONE_META%
if errorlevel 1 (
  echo [ERROR] ringtone.json upload xato.
  exit /b 1
)

echo.
echo ================================
echo   TAYYOR: ringtone serverga yuklandi
echo ================================
echo   MP3: %REMOTE_MP3%
echo   Meta: %REMOTE_VERSION%
echo ================================
exit /b 0