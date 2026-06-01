@echo off
cd /d "%~dp0"
echo Starting DC Water Dashboard at http://localhost:8080
echo Press Ctrl+C to stop.
python -m http.server 8080
