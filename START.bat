@echo off
chcp 65001 >nul
title Transkript - laeuft
cd /d "%~dp0"

python -c "import flask, faster_whisper, sounddevice" >nul 2>&1
if errorlevel 1 (
    echo.
    echo   Es fehlen noch Programmteile.
    echo   Bitte zuerst installieren.bat doppelklicken.
    echo.
    pause
    exit /b 1
)

python app.py

echo.
echo   Das Programm wurde beendet.
pause
