@echo off
setlocal

set ROOT_DIR=%~dp0
set EXE_PATH=%ROOT_DIR%build\bin\ChatDesktop.exe
set FALLBACK_EXE=%ROOT_DIR%wails-desktop.exe
set SERVER=aws
set REMOTE_DIR=/opt/chat/server/updates
set REMOTE_EXE_PATH=%REMOTE_DIR%/ChatDesktop.exe

set NEW_VER=%~1
set NOTES=%~2

echo ================================
echo   Chat Desktop - Auto Update
echo ================================
echo.

if "%NEW_VER%"=="" set /p NEW_VER=Yangi versiya raqamini kiriting (masalan 1.8.9): 
if "%NOTES%"=="" set /p NOTES=O'zgarishlar haqida qisqacha (Enter = bo'sh): 

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
scp "%EXE_PATH%" %SERVER%:%REMOTE_EXE_PATH%
if errorlevel 1 (
    echo UPLOAD XATOLIK! SSH ni tekshiring.
    pause
    exit /b 1
)
echo Yuklandi!
echo.

:: 3. Serverdagi version.json
echo [3/3] version.json serverda yangilanmoqda...
scp "version.json" %SERVER%:%REMOTE_DIR%/version.json
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
echo ================================
pause
