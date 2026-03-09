@echo off
echo Bench Toss Server
echo Activating Virtual Environment...
call venv\Scripts\activate.bat
echo Starting Server...
python server.py
pause
