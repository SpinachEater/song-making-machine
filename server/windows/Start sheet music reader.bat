@echo off
title Sheet music reader
cd /d "%~dp0"
set "PYTHONUTF8=1"

rem ---- Find Python (homr works best with 3.12 or 3.11) ----
set "PY="
py -3.12 -V >nul 2>nul && set "PY=py -3.12"
if not defined PY (py -3.11 -V >nul 2>nul && set "PY=py -3.11")
if not defined PY (py -3 -V >nul 2>nul && set "PY=py -3")
if not defined PY (python -V >nul 2>nul && set "PY=python")
if not defined PY goto :nopython

rem ---- First time only: install the reader (about 5 minutes) ----
if exist ".venv\Scripts\homr.exe" goto :run
echo.
echo  First-time setup: installing the sheet music reader.
echo  This downloads about 300 MB and takes around 5 minutes. Please wait...
echo.
%PY% -m venv .venv || goto :fail
".venv\Scripts\python.exe" -m pip install --upgrade pip || goto :fail
".venv\Scripts\python.exe" -m pip install "homr[cpu]==0.7.1" || goto :fail
".venv\Scripts\homr.exe" --init || goto :fail

:run
set "PATH=%~dp0.venv\Scripts;%PATH%"
cls
echo.
echo  ======================================================
echo   The sheet music reader is running.
echo   Keep this window open while you use Photo to Sheet Music.
echo   Close this window to stop the reader.
echo  ======================================================
echo.
start "" "https://spinacheater.github.io/song-making-machine/docs/photo.html"
".venv\Scripts\python.exe" omr_server.py
pause
exit /b 0

:nopython
echo.
echo  Python is not installed on this computer.
echo  Your browser will open the Python download page. Install it, and on the
echo  first screen tick "Add python.exe to PATH". Then double-click this file again.
echo.
start "" "https://www.python.org/downloads/windows/"
pause
exit /b 1

:fail
echo.
echo  Something went wrong during setup. Take a screenshot of this window and
echo  send it to Claude. Deleting the .venv folder here and trying again can also help.
echo.
pause
exit /b 1
