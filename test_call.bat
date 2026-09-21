@echo off
setlocal
title Real Group Call 2-Way Audio Test
color 0b

echo =======================================================
echo    Group Call Real Live Audio & Speaking Test
echo =======================================================
echo.
echo 1) Tekshirilmoqda: Chat server (port 4000)...

netstat -ano | findstr :4000 >nul 2>&1
if errorlevel 1 (
    echo [!] Server ishlamayapti, fon rejimida yoqilmoqda...
    start /b "" npm run dev:server >nul 2>&1
    timeout /t 3 /nobreak >nul
) else (
    echo [+] Server ishlab turibdi (port 4000).
)

echo.
echo 2) Test boshlanmoqda (2 ta oyna ekranda yonma-yon ochiladi)...
echo    Chapda: Alice (User 1)
echo    O'ngda: Bob (User 2)
echo.

node "%~dp0tools\run_real_ui_call_test.mjs"

echo.
echo =======================================================
echo Test yakunlandi. Oynalar ekranda ochiq turibdi.
echo Chiqish uchun istalgan tugmani bosing...
pause >nul
