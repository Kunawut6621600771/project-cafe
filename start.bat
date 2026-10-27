@echo off
chcp 65001 >nul
title ผู้ชายขายน้ำ - เปิดระบบ
cd /d "%~dp0"

echo ============================================
echo   ผู้ชายขายน้ำ - กำลังเปิดระบบ...
echo ============================================
echo.

REM ---- 1) เช็คว่า Docker Desktop เปิดอยู่หรือยัง ----
docker info >nul 2>&1
if errorlevel 1 (
    echo [1/3] Docker Desktop ยังไม่เปิด กำลังเปิดให้...
    start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    echo       รอ Docker เริ่มทำงาน (อาจใช้เวลาถึง 1 นาที)...
    :waitdocker
    timeout /t 3 /nobreak >nul
    docker info >nul 2>&1
    if errorlevel 1 goto waitdocker
    echo       Docker พร้อมแล้ว
) else (
    echo [1/3] Docker Desktop เปิดอยู่แล้ว
)
echo.

REM ---- 2) เปิดฐานข้อมูล (PostgreSQL) และเครื่องมือดูฐานข้อมูล (Adminer) ----
echo [2/3] กำลังเปิดฐานข้อมูล...
docker start espresso-postgres >nul 2>&1
docker start espresso-adminer >nul 2>&1
timeout /t 3 /nobreak >nul
echo       ฐานข้อมูลพร้อมแล้ว (ดูข้อมูลได้ที่ http://localhost:8080)
echo.

REM ---- 3) เปิดเซิร์ฟเวอร์หลังบ้าน ----
echo [3/3] กำลังเปิดเซิร์ฟเวอร์...
echo       เว็บร้านกาแฟ: http://localhost:3000
echo       ดูฐานข้อมูล  : http://localhost:8080
echo ============================================
echo.
REM ---- LINE : เปิด tunnel ให้ LINE ส่ง webhook เข้ามาได้ (ถ้าติดตั้ง cloudflared ไว้) ----
if exist "C:\Program Files (x86)\cloudflared\cloudflared.exe" (
    start "LINE Tunnel" cmd /k "timeout /t 5 /nobreak >nul & npm run line:tunnel"
)
npm start
