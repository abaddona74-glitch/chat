@echo off
setlocal

set ROOT_DIR=%~dp0
set EXE_PATH=%ROOT_DIR%build\bin\ChatDesktop.exe
set FALLBACK_EXE=%ROOT_DIR%wails-desktop.exe
set SERVER=maxava
set REMOTE_DIR=/opt/chat/apps/server/updates
set REMOTE_HISTORY_DIR=%REMOTE_DIR%/history
set REMOTE_EXE_PATH=%REMOTE_DIR%/ChatDesktop.exe
set REMOTE_CURRENT_VER=
set REMOTE_VERSION_JSON=%TEMP%\chat-remote-version.json

set "NEW_VER=%~1"
set "NOTES=%~2"

echo ================================
echo   Chat Desktop - Auto Update
echo ================================
echo.

if not defined NEW_VER set /p NEW_VER=Yangi versiya raqamini kiriting (masalan 1.8.9): 
if not defined NOTES set /p NOTES=O'zgarishlar haqida qisqacha (Enter = bo'sh): 

echo [+] Versiya fayllari yangilanmoqda: %NEW_VER%
node update_version.js "%NEW_VER%" "%NOTES%"

:: 1. Build
echo [1/3] Wails build qilinmoqda (DevTools yoqilgan, konsolsiz)...
cd /d "%ROOT_DIR%"
call wails build -devtools -clean
if errorlevel 1 (
    echo BUILD XATOLIK! Tekshiring.
    pause
    exit /b 1
)
echo Build tayyor!
echo.

:: 2.5. Current remote version history ga saqlanmoqda
if exist "%REMOTE_VERSION_JSON%" del "%REMOTE_VERSION_JSON%"
scp -O %SERVER%:%REMOTE_DIR%/version.json "%REMOTE_VERSION_JSON%" >nul 2>nul
if exist "%REMOTE_VERSION_JSON%" (
    for /f "usebackq delims=" %%v in (`powershell -NoProfile -Command "try { $json = Get-Content -Raw '%REMOTE_VERSION_JSON%' | ConvertFrom-Json; if ($json.version) { $json.version } } catch { }"`) do set REMOTE_CURRENT_VER=%%v
    del "%REMOTE_VERSION_JSON%"
)
if defined REMOTE_CURRENT_VER (
    echo [+] Server history arxivlanmoqda: %REMOTE_CURRENT_VER%
    ssh %SERVER% "if [ -f %REMOTE_DIR%/version.json ] && [ -f %REMOTE_DIR%/ChatDesktop.exe ]; then mkdir -p %REMOTE_HISTORY_DIR%/%REMOTE_CURRENT_VER% && cp %REMOTE_DIR%/version.json %REMOTE_HISTORY_DIR%/%REMOTE_CURRENT_VER%/version.json && cp %REMOTE_DIR%/ChatDesktop.exe %REMOTE_HISTORY_DIR%/%REMOTE_CURRENT_VER%/ChatDesktop.exe; fi"
)

echo.

:: 2. Upload
echo [2/3] Serverga yuborilmoqda...
if not exist "%EXE_PATH%" (
    if exist "%FALLBACK_EXE%" (
        set EXE_PATH=%FALLBACK_EXE%
    )
)
if not exist "%EXE_PATH%" (
    echo EXE topilmadi:
    echo   %EXE_PATH%
    echo   %FALLBACK_EXE%
    pause
    exit /b 1
)
scp -O "%EXE_PATH%" %SERVER%:%REMOTE_EXE_PATH%
if errorlevel 1 (
    echo UPLOAD XATOLIK! SSH ni tekshiring.
    pause
    exit /b 1
)
echo Yuklandi!
echo.

echo [2.5/3] History nusxasi serverga yuborilmoqda...
ssh %SERVER% "mkdir -p %REMOTE_HISTORY_DIR%/%NEW_VER%"
if errorlevel 1 (
    echo HISTORY FOLDER XATOLIK!
    pause
    exit /b 1
)
scp -O "%EXE_PATH%" %SERVER%:%REMOTE_HISTORY_DIR%/%NEW_VER%/ChatDesktop.exe
if errorlevel 1 (
    echo HISTORY EXE UPLOAD XATOLIK!
    pause
    exit /b 1
)
scp -O "version.json" %SERVER%:%REMOTE_HISTORY_DIR%/%NEW_VER%/version.json
if errorlevel 1 (
    echo HISTORY VERSION XATOLIK!
    pause
    exit /b 1
)
echo History saqlandi!
echo.

:: 3. Serverdagi version.json
echo [3/3] version.json serverda yangilanmoqda...
scp -O "version.json" %SERVER%:%REMOTE_DIR%/version.json
if errorlevel 1 (
    echo VERSION UPDATE XATOLIK!
    pause
    exit /b 1
)

echo.
echo ================================
echo   TAYYOR! v%NEW_VER% serverga yuklandi
echo ================================
echo   Foydalanuvchilar ilovani ochganda
echo   avtomatik yangilanish taklif qilinadi.
echo   History nusxalar ham saqlandi.
echo ================================
pause
