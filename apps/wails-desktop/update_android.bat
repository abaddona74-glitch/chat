@echo off
setlocal

cd /d "%~dp0frontend"
call update_android.bat %*
