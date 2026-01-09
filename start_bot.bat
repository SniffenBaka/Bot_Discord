@echo off
color a
chcp 65001 >nul
title Sol Bi - Discord Bot
cd /d "C:\Users\PC\Documents\Bot_Discord"
echo ===============================================
echo 🚀 Đang khởi động bot Discord Sol Bi...
echo ===============================================
echo.

:: Kiểm tra Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ❌ Node.js chưa được cài đặt hoặc chưa có trong PATH!
    echo 👉 Hãy tải tại: https://nodejs.org/
    pause
    exit /b
)

:: Chạy bot
node index_V2.js

echo.
echo 🛑 Bot đã dừng (hoặc bị lỗi). Nhấn Enter để thoát...
pause