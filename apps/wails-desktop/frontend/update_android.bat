@echo off
setlocal EnableExtensions

set ROOT=F:\Project\chat\apps\wails-desktop\frontend
set APK_PATH=%ROOT%\android\app\build\outputs\apk\debug\app-debug.apk
set SERVER=aws
set REMOTE_DIR=/opt/chat/server/updates/android
set UPDATE_NOTIFY_URL=https://mytelegramchat.ddns.net/update/android/notify
set UPDATE_NOTIFY_TOKEN=
set TEMP_JSON=%TEMP%\chatmobile-version-%RANDOM%%RANDOM%.json

echo ================================
echo   Chat Mobile - Android Update
echo ================================
echo.

echo [1/6] APK build qilinmoqda...
cd /d %ROOT%
call npm run android:apk:win
if errorlevel 1 (
    echo BUILD XATOLIK! Tekshiring.
    if exist "%TEMP_JSON%" del "%TEMP_JSON%"
    pause
    exit /b 1
)
echo Build tayyor!
echo.

echo [2/6] Version metadata tayyorlanmoqda...
for /f "usebackq delims=" %%v in (`powershell -NoProfile -Command "$version = (Get-Content -Raw 'package.json' | ConvertFrom-Json).version; $notes = Read-Host 'Ozgarishlar haqida qisqacha'; $payload = @{ version = $version; notes = $notes } | ConvertTo-Json -Compress; [System.IO.File]::WriteAllText('%TEMP_JSON%', $payload, [System.Text.UTF8Encoding]::new($false)); Write-Output $version"`) do set APP_VERSION=%%v
if not defined APP_VERSION (
    echo VERSION XATOLIK!
    if exist "%TEMP_JSON%" del "%TEMP_JSON%"
    pause
    exit /b 1
)
echo Versiya: %APP_VERSION%
echo.

echo [3/6] Server papkasi tayyorlanmoqda...
ssh %SERVER% "mkdir -p %REMOTE_DIR%"
if errorlevel 1 (
    echo SSH XATOLIK! aws alias ni tekshiring.
    if exist "%TEMP_JSON%" del "%TEMP_JSON%"
    pause
    exit /b 1
)
echo Tayyor!
echo.

echo [4/6] APK serverga yuborilmoqda...
scp "%APK_PATH%" %SERVER%:%REMOTE_DIR%/ChatMobile.apk
if errorlevel 1 (
    echo APK UPLOAD XATOLIK!
    if exist "%TEMP_JSON%" del "%TEMP_JSON%"
    pause
    exit /b 1
)
echo APK yuklandi!
echo.

echo [5/6] version.json serverga yuborilmoqda...
scp "%TEMP_JSON%" %SERVER%:%REMOTE_DIR%/version.json
if exist "%TEMP_JSON%" del "%TEMP_JSON%"
if errorlevel 1 (
    echo VERSION UPLOAD XATOLIK!
    pause
    exit /b 1
)

echo.
echo [6/6] Firebase update notification yuborilmoqda...
if defined UPDATE_NOTIFY_TOKEN (
    powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -Method Post -Uri '%UPDATE_NOTIFY_URL%' -Headers @{ 'x-update-notify-token' = '%UPDATE_NOTIFY_TOKEN%' } | Out-Null; exit 0 } catch { Write-Host $_.Exception.Message; exit 1 }"
) else (
    powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -Method Post -Uri '%UPDATE_NOTIFY_URL%' | Out-Null; exit 0 } catch { Write-Host $_.Exception.Message; exit 1 }"
)
if errorlevel 1 (
    echo UPDATE PUSH YUBORISHDA XATOLIK!
    echo Eslatma: serverda UPDATE_NOTIFY_TOKEN sozlangan bo'lsa shu faylda UPDATE_NOTIFY_TOKEN ni to'ldiring.
    pause
    exit /b 1
)

echo.
echo ================================
echo   TAYYOR! v%APP_VERSION% serverga yuklandi
echo ================================
echo   Android ilova yangilanishni
echo   serverdan tekshiradi va update
echo   push notification ham yuboriladi.
echo ================================
pause
