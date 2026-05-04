@echo off
setlocal

if exist "F:\Project\chat\tools\jdk17\jdk-17.0.18+8\bin\java.exe" set "JAVA_HOME=F:\Project\chat\tools\jdk17\jdk-17.0.18+8"
if defined JAVA_HOME goto run_build
if exist "D:\Jdk21\bin\java.exe" set "JAVA_HOME=D:\Jdk21"
if defined JAVA_HOME goto run_build
if defined JAVA_HOME if exist "%JAVA_HOME%\bin\java.exe" goto run_build
if exist "D:\Jdk\bin\java.exe" set "JAVA_HOME=D:\Jdk"
if defined JAVA_HOME goto run_build
for /f "usebackq delims=" %%D in (`powershell -NoProfile -Command "$candidates = @(); if (Test-Path '%ProgramFiles%\Java') { $candidates += Get-ChildItem '%ProgramFiles%\Java' -Directory | Where-Object { $_.Name -in @('jdk-21', 'jdk-21.0.10', 'latest') -or $_.Name -like 'jdk-*' } }; ($candidates | Sort-Object Name | Select-Object -First 1).FullName"`) do set "JAVA_HOME=%%D"

if not defined JAVA_HOME (
  echo Could not find a compatible JDK. Set JAVA_HOME to JDK 21.
  exit /b 1
)

if not exist "%JAVA_HOME%\bin\java.exe" (
  echo Invalid JAVA_HOME: %JAVA_HOME%
  exit /b 1
)

:run_build
set "PATH=%JAVA_HOME%\bin;%PATH%"
echo Using JAVA_HOME=%JAVA_HOME%

call npm run android:build
if errorlevel 1 exit /b 1

echo Applying Android plugin Java compatibility patch...
powershell -NoProfile -Command "$f='android\capacitor-cordova-android-plugins\build.gradle'; if (Test-Path $f) { $txt=(Get-Content -Raw $f).Replace('JavaVersion.VERSION_21','JavaVersion.VERSION_17'); [System.IO.File]::WriteAllText($f, $txt, [System.Text.UTF8Encoding]::new($false)) }"

cd /d android
call gradlew.bat assembleDebug
