@echo off
REM Start the MEO website on this Windows computer.
cd /d "%~dp0"
if "%MEO_ADMIN_TOKEN%"=="" set /p MEO_ADMIN_TOKEN=Choose an admin password for the staff dashboard: 
echo.
echo Website:   http://localhost:8080
echo Dashboard: http://localhost:8080/admin.html
echo Close this window to stop the server.
start "" http://localhost:8080
dist\meo_server.exe --port 8080
pause
