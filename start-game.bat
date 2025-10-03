@echo off
title 四人象棋游戏
echo ========================================
echo    四人象棋 - Four Player Chinese Chess
echo ========================================
echo.
echo 正在启动游戏服务器...
echo.
echo 游戏将在浏览器中自动打开
echo 地址: http://localhost:8080
echo.
echo 关闭此窗口将停止游戏
echo ========================================
echo.

start http://localhost:8080
npx http-server -p 8080 -c-1
