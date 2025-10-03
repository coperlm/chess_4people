@echo off
chcp 65001 >nul
title 四人象棋服务器 - 支持手机访问

echo.
echo ========================================
echo    🎮 四人象棋服务器启动工具
echo ========================================
echo.
echo 📱 本工具支持手机访问游戏！
echo.
echo 使用说明：
echo 1. 确保电脑和手机连接同一个WiFi
echo 2. 启动后会显示手机访问地址
echo 3. 在手机浏览器输入地址即可游玩
echo.
echo ========================================
echo.

REM 检查Node.js是否安装
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ❌ 错误：未检测到Node.js
    echo.
    echo 解决方案：
    echo 1. 安装Node.js: https://nodejs.org
    echo 2. 或直接双击 index.html 文件（不支持手机访问）
    echo.
    pause
    exit /b 1
)

echo ✅ Node.js 已安装
echo.

REM 检查server.js是否存在
if not exist "server.js" (
    echo ❌ 错误：找不到 server.js 文件
    echo 请确保在正确的目录下运行此脚本
    echo.
    pause
    exit /b 1
)

echo 🚀 正在启动服务器...
echo.
echo ⚠️  重要提示：
echo    - 如果弹出防火墙提示，请点击"允许访问"
echo    - 这样手机才能连接到电脑
echo.
echo ========================================
echo.

REM 启动服务器
node server.js

REM 如果服务器意外退出
echo.
echo ========================================
echo 服务器已停止
echo ========================================
echo.
pause
