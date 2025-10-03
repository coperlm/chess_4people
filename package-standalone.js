// 打包脚本 - 将游戏打包为独立可执行文件
const fs = require('fs');
const path = require('path');

console.log('📦 开始准备打包...\n');

// 创建打包说明文件
const instructions = `
# 四人象棋 - 打包说明

## 方法1: 使用 Electron 打包（推荐）

### 步骤：

1. 安装依赖：
   npm install --save-dev electron electron-builder

2. 修改 package.json，添加以下内容：
   {
     "main": "electron-main.js",
     "scripts": {
       "start": "electron .",
       "build:win": "electron-builder --win",
       "build:mac": "electron-builder --mac",
       "build:linux": "electron-builder --linux"
     },
     "build": {
       "appId": "com.chess.fourplayer",
       "productName": "四人象棋",
       "directories": {
         "output": "dist"
       },
       "files": [
         "**/*",
         "!node_modules/**/*",
         "!dist/**/*"
       ],
       "win": {
         "target": "nsis",
         "icon": "icon.ico"
       }
     }
   }

3. 运行打包命令：
   npm run build:win

4. 生成的可执行文件在 dist 文件夹中

## 方法2: 使用本地Web服务器（无需安装）

已为您创建 start-game.bat 文件，双击即可运行！

## 方法3: 纯静态HTML（最简单）

直接双击 index.html 文件即可在浏览器中游玩
（注意：某些功能可能受到浏览器安全限制）
`;

fs.writeFileSync('PACKAGING.md', instructions);
console.log('✅ 已创建打包说明文件: PACKAGING.md\n');

// 创建 Electron 主进程文件
const electronMain = `const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    },
    icon: path.join(__dirname, 'icon.png'),
    title: '四人象棋 - Four Player Chinese Chess'
  });

  win.loadFile('index.html');
  
  // 开发模式下打开开发者工具
  // win.webContents.openDevTools();
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
`;

fs.writeFileSync('electron-main.js', electronMain);
console.log('✅ 已创建 Electron 主进程文件: electron-main.js\n');

// 创建 Windows 批处理启动文件
const batchScript = `@echo off
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
`;

fs.writeFileSync('start-game.bat', batchScript);
console.log('✅ 已创建 Windows 启动文件: start-game.bat\n');

// 创建简化的 package.json（如果不存在）
const packageJsonPath = 'package.json';
let packageJson;

if (fs.existsSync(packageJsonPath)) {
  packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
} else {
  packageJson = {
    "name": "four-player-chess",
    "version": "1.0.0",
    "description": "四人象棋单机版游戏",
    "main": "electron-main.js"
  };
}

// 添加打包相关的配置
packageJson.scripts = packageJson.scripts || {};
packageJson.scripts.start = "electron .";
packageJson.scripts["build:win"] = "electron-builder --win";
packageJson.scripts["build:mac"] = "electron-builder --mac";
packageJson.scripts["build:linux"] = "electron-builder --linux";
packageJson.scripts.serve = "http-server -p 8080";

packageJson.build = {
  "appId": "com.chess.fourplayer",
  "productName": "四人象棋",
  "directories": {
    "output": "dist"
  },
  "files": [
    "**/*",
    "!node_modules/**/*",
    "!dist/**/*",
    "!.git/**/*",
    "!*.md",
    "!package-standalone.js"
  ],
  "win": {
    "target": ["nsis", "portable"],
    "icon": "icon.ico"
  },
  "mac": {
    "target": "dmg",
    "icon": "icon.icns"
  },
  "linux": {
    "target": "AppImage",
    "icon": "icon.png"
  }
};

fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
console.log('✅ 已更新 package.json 配置\n');

console.log('========================================');
console.log('✨ 打包准备完成！\n');
console.log('📖 请查看 PACKAGING.md 了解详细打包步骤\n');
console.log('🚀 快速开始：');
console.log('   1. 双击 start-game.bat 立即游玩');
console.log('   2. 或运行: npm install --save-dev electron electron-builder');
console.log('   3. 然后运行: npm run build:win');
console.log('========================================');
