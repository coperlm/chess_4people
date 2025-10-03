@echo off
chcp 65001 >nul
title 创建四人象棋便携版

echo ========================================
echo    四人象棋 - 创建便携版可执行程序
echo ========================================
echo.

REM 创建输出目录
set OUTPUT_DIR=四人象棋便携版
if exist "%OUTPUT_DIR%" (
    echo 清理旧的输出目录...
    rmdir /s /q "%OUTPUT_DIR%"
)
mkdir "%OUTPUT_DIR%"

echo [1/5] 复制游戏文件...
REM 复制所有必要文件
xcopy /E /I /Y "js" "%OUTPUT_DIR%\js\" >nul
xcopy /E /I /Y "styles" "%OUTPUT_DIR%\styles\" >nul
xcopy /E /I /Y "css" "%OUTPUT_DIR%\css\" >nul
copy /Y "index.html" "%OUTPUT_DIR%\" >nul
copy /Y "server.js" "%OUTPUT_DIR%\" >nul
copy /Y "package.json" "%OUTPUT_DIR%\" >nul

echo [2/5] 创建启动脚本...

REM 创建简单的HTML启动器
(
echo ^<!DOCTYPE html^>
echo ^<html^>
echo ^<head^>
echo     ^<meta charset="UTF-8"^>
echo     ^<meta http-equiv="refresh" content="0; url=index.html"^>
echo     ^<title^>四人象棋^</title^>
echo ^</head^>
echo ^<body^>
echo     ^<h2^>正在启动游戏...^</h2^>
echo     ^<p^>如果没有自动跳转，请^<a href="index.html"^>点击这里^</a^>^</p^>
echo ^</body^>
echo ^</html^>
) > "%OUTPUT_DIR%\启动游戏.html"

REM 创建带服务器的启动脚本
(
echo @echo off
echo title 四人象棋
echo echo 正在启动游戏...
echo echo.
echo start "" "启动游戏.html"
echo echo 游戏已在浏览器中打开！
echo echo.
echo echo 按任意键关闭此窗口...
echo pause ^>nul
) > "%OUTPUT_DIR%\运行游戏.bat"

echo [3/5] 创建说明文件...

(
echo 四人象棋 - 使用说明
echo ==================
echo.
echo 快速开始：
echo 1. 双击"启动游戏.html"即可开始游戏
echo 2. 或者双击"运行游戏.bat"
echo.
echo 游戏特点：
echo - 四人对战象棋
echo - 纯本地运行，无需网络
echo - 无需安装任何软件
echo.
echo 注意事项：
echo - 请确保所有文件保持在同一文件夹中
echo - 建议使用Chrome、Firefox、Edge等现代浏览器
echo.
echo 制作时间：%date% %time%
) > "%OUTPUT_DIR%\使用说明.txt"

echo [4/5] 创建桌面快捷方式脚本...

(
echo Set oWS = WScript.CreateObject^("WScript.Shell"^)
echo sLinkFile = oWS.ExpandEnvironmentStrings^("%%USERPROFILE%%\Desktop\四人象棋.lnk"^)
echo Set oLink = oWS.CreateShortcut^(sLinkFile^)
echo oLink.TargetPath = oWS.CurrentDirectory ^& "\启动游戏.html"
echo oLink.WorkingDirectory = oWS.CurrentDirectory
echo oLink.Description = "四人象棋游戏"
echo oLink.Save
echo WScript.Echo "桌面快捷方式创建成功！"
) > "%OUTPUT_DIR%\创建桌面快捷方式.vbs"

echo [5/5] 完成打包...

echo.
echo ========================================
echo ✅ 便携版创建成功！
echo ========================================
echo.
echo 📁 位置: %OUTPUT_DIR%
echo.
echo 🎮 使用方法：
echo    1. 进入文件夹
echo    2. 双击"启动游戏.html"开始游戏
echo.
echo 📦 分发方法：
echo    - 直接压缩整个文件夹发送给朋友
echo    - 接收者解压后即可直接游玩
echo    - 无需安装Node.js或任何其他软件！
echo.
echo ========================================
echo.
echo 是否现在创建桌面快捷方式？(Y/N)
set /p CREATE_SHORTCUT=

if /i "%CREATE_SHORTCUT%"=="Y" (
    cd "%OUTPUT_DIR%"
    cscript //nologo "创建桌面快捷方式.vbs"
    cd ..
)

echo.
echo 按任意键打开文件夹...
pause >nul
explorer "%OUTPUT_DIR%"
