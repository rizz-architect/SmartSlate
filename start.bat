@echo off
title SmartSlate - Starting...

echo Checking MongoDB...
sc query MongoDB | find "RUNNING" >nul 2>&1
if errorlevel 1 (
    echo Starting MongoDB service...
    net start MongoDB >nul 2>&1
    if errorlevel 1 (
        echo MongoDB service not found. Trying mongod directly...
        start /min "MongoDB" mongod --dbpath "C:\data\db"
        timeout /t 3 >nul
    )
)
echo MongoDB: OK

echo Starting SmartSlate...
cd /d %~dp0backend
python app.py

pause
