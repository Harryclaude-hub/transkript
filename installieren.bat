@echo off
chcp 65001 >nul
title Transkript - Installation
cd /d "%~dp0"

echo.
echo ==========================================================
echo   TRANSKRIPT - einmalige Installation
echo ==========================================================
echo.
echo   Das dauert beim ersten Mal 5 bis 15 Minuten.
echo   Es werden rund 1,5 GB heruntergeladen.
echo   Bitte das Fenster offen lassen.
echo.

python --version >nul 2>&1
if errorlevel 1 (
    echo   FEHLER: Python wurde nicht gefunden.
    echo   Bitte Python von python.org installieren
    echo   und dabei "Add Python to PATH" ankreuzen.
    echo.
    pause
    exit /b 1
)

echo   [1/3] pip wird aktualisiert ...
python -m pip install --upgrade pip --quiet --disable-pip-version-check

echo   [2/3] Programmteile werden installiert ...
rem  av wird bewusst auf 13.1.0 festgenagelt. Neuere Fassungen werden von
rem  Windows Smart App Control blockiert, dann startet die Erkennung nicht.
python -m pip install --disable-pip-version-check ^
    "faster-whisper>=1.0.3" ^
    "av==13.1.0" ^
    "soundfile>=0.12" ^
    "sounddevice>=0.4.6" ^
    "sherpa-onnx>=1.10" ^
    "numpy>=1.26" ^
    "flask>=3.0" ^
    "reportlab>=4.0" ^
    "python-docx>=1.1"

if errorlevel 1 (
    echo.
    echo   FEHLER bei der Installation. Meldung oben lesen.
    echo.
    pause
    exit /b 1
)

echo   [3/4] Sprachmodelle werden vorgeladen ...
python vorladen.py

echo   [4/4] Modelle fuer Stimmen und Toene werden geholt ...
python modelle_holen.py

echo.
echo ==========================================================
echo   FERTIG. Jetzt START.bat doppelklicken.
echo ==========================================================
echo.
pause
